"""HTTP-facing functions for the AI Research Assistant (dispatched by pipeline/research/server.py).

Sessions live in memory (local, single user). Each session keeps the conversation: the current proposed plan, the
plans that were run, their results and explanations. Approval is required before execution, and an acknowledgement
when the plan carries inference warnings. Plans edited in the interface are rebuilt and revalidated server-side.
"""
from __future__ import annotations

import copy
import secrets
import threading
import time
from collections import OrderedDict

from pipeline.research import engine as E
from pipeline.research import planner as P
from pipeline.research.ai import assistant as A
from pipeline.research.ai import llm

_sessions: OrderedDict[str, dict] = OrderedDict()
_lock = threading.Lock()
_llm_state = {"starting": False, "status": None}


class Unavailable(RuntimeError):
    pass


def start_llm_async():
    def go():
        _llm_state["starting"] = True
        _llm_state["status"] = llm.start()
        _llm_state["starting"] = False
    threading.Thread(target=go, daemon=True).start()


def status() -> dict:
    s = llm.status()
    if not s["available"] and _llm_state["starting"]:
        s["reason"] = "The local model is loading (about 20 seconds)."
        s["loading"] = True
    elif not s["available"] and _llm_state["status"]:
        s["reason"] = _llm_state["status"].get("reason", s.get("reason"))
    return s


def _session(sid: str | None) -> dict:
    with _lock:
        if sid and sid in _sessions:
            _sessions.move_to_end(sid)
            return _sessions[sid]
    raise E.SpecError([{"code": "session", "message": "This conversation has expired; ask the question again."}])


def _new(view: dict) -> str:
    sid = secrets.token_urlsafe(12)
    with _lock:
        _sessions[sid] = {"view": view, "history": [{"t": time.strftime("%H:%M:%S"), "event": "question", "text": view["draft"]["question"]}], "runs": []}
        while len(_sessions) > 30:
            _sessions.popitem(last=False)
    return sid


def _public(view: dict, sid: str) -> dict:
    v = copy.deepcopy(view)
    return {"session": sid, **v}


def _need_model():
    if not llm.status()["available"]:
        raise Unavailable(status().get("reason") or "The local model is not running.")


def plan(body: dict) -> dict:
    _need_model()
    try:
        view = A.plan(str(body.get("question", "")))
    except llm.LLMError as e:
        raise Unavailable(str(e)) from e
    return _public(view, _new(view))


def revise(body: dict) -> dict:
    _need_model()
    s = _session(body.get("session"))
    try:
        view = A.revise(s["view"], str(body.get("followup", "")))
    except llm.LLMError as e:
        raise Unavailable(str(e)) from e
    s["history"].append({"t": time.strftime("%H:%M:%S"), "event": "follow-up", "text": view["revision"]["followup"], "changes": view["revision"]["log"]})
    s["view"] = view
    return _public(view, body["session"])


def choose(body: dict) -> dict:
    s = _session(body.get("session"))
    s["view"] = A.choose(s["view"], str(body.get("phrase", "")), str(body.get("indicator_id", "")))
    s["history"].append({"t": time.strftime("%H:%M:%S"), "event": "indicator chosen", "text": f"{body.get('phrase')} -> {body.get('indicator_id')}"})
    return _public(s["view"], body["session"])


def edit(body: dict) -> dict:
    """Manual edits to the proposed plan (countries, years, analyses, model); deterministic rebuild and validation."""
    s = _session(body.get("session"))
    d = copy.deepcopy(s["view"]["draft"])
    e = body.get("edits") or {}
    if "countries" in e:
        known = set(E.countries().iso3)
        d["countries"] = [c for c in e["countries"] if c in known]
    if "years" in e:
        try:
            d["years"] = [int(e["years"][0]), int(e["years"][1])]
        except (TypeError, ValueError, IndexError):
            raise E.SpecError([{"code": "years", "message": "Give a start and end year."}])
    if "analyses" in e:
        d["analyses"] = [a for a in e["analyses"] if a in A.ANALYSES]
    if "model" in e and e["model"]:
        m = {**(d.get("model") or {}), **{k: v for k, v in e["model"].items() if k in ("method", "entity_effects", "time_effects", "se", "y")}}
        if m.get("method") not in ("ols", "panel_fe"):
            raise E.SpecError([{"code": "method", "message": "Choose OLS or panel fixed effects."}])
        m["y_confirmed"] = bool(m.get("y"))
        d["model"] = m
        if "regression" not in d["analyses"]:
            d["analyses"].append("regression")
    clar = [c for c in s["view"]["clarifications"] if c["field"] not in ("countries", "years", "method", "y") and not ("model" in e and c["field"] == "y")]
    view = A.build(d, s["view"]["notes"], clar)
    view["ai"] = s["view"].get("ai")
    s["view"] = view
    s["history"].append({"t": time.strftime("%H:%M:%S"), "event": "plan edited", "text": str(e)[:300]})
    return _public(view, body["session"])


def run(body: dict) -> dict:
    s = _session(body.get("session"))
    view = s["view"]
    if body.get("plan_hash") != view["plan_hash"]:
        raise E.SpecError([{"code": "stale", "message": "The plan changed since it was shown; review it again before approving."}])
    if not view["ready"]:
        raise E.SpecError([{"code": "not_ready", "message": "Resolve the open questions in the plan first."}] + view["issues"])
    if view["approvals_required"] and not body.get("acknowledged"):
        raise E.SpecError([{"code": "acknowledge", "message": "Acknowledge the inference warning before running."}])
    out = A.run(view, bool(body.get("approved")))
    s["history"].append({"t": time.strftime("%H:%M:%S"), "event": "approved and run", "text": view["plan_hash"],
                         **({"acknowledged": view["approvals_required"]} if view["approvals_required"] else {})})
    rid = len(s["runs"])
    prev = s["runs"][-1] if s["runs"] else None
    comparison = None
    if prev:
        comparison = {"previous_run": prev["id"], "same_data": prev["out"]["dataset"]["provenance"]["data_sha256"] == out["dataset"]["provenance"]["data_sha256"],
                      "changes": view.get("revision", {}).get("log") if view.get("revision") else None,
                      "previous": _coefs(prev["out"]), "current": _coefs(out)}
    s["runs"].append({"id": rid, "view": copy.deepcopy(view), "out": out, "explanation": None})
    out["downloads"].update(A.package(view, out, None, s["history"]))
    return {"session": body["session"], "run": rid, "result": out, "comparison": comparison}


def _coefs(out):
    est = next((x for x in out["steps"] if x["op"] == "estimate"), None)
    if not est or est["status"] != "ok":
        return None
    r = est["result"]
    return {"spec": r["spec"], "n": r["n"], "coefficients": [{k: c[k] for k in ("term", "coef", "se", "p_value", "ci_low", "ci_high")} for c in r["coefficients"]]}


def explain(body: dict) -> dict:
    _need_model()
    s = _session(body.get("session"))
    r = s["runs"][int(body.get("run", -1))]
    r["explanation"] = A.explain(r["out"])
    s["history"].append({"t": time.strftime("%H:%M:%S"), "event": "interpretation", "text": f"run {r['id']}"})
    files = A.package(r["view"], r["out"], r["explanation"], s["history"])
    return {"explanation": r["explanation"], "downloads": files}


def fallback(body: dict) -> dict:
    """Without the model: the existing rule-based draft (clearly labelled), for the manual workbench."""
    return {"draft": P.draft(str(body.get("question", ""))), "label": "Rule-based draft (no language model)"}
