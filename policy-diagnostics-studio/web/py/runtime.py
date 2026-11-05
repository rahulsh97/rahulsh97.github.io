"""Browser runtime for the Studio's research engine (runs in Pyodide).

- Opens an in-memory DuckDB with the same tables the engine expects (countries, sources) and an `observations` view
  over the per-indicator Parquet files that have been fetched so far. The engine's fixed SQL runs unchanged.
- Before any observations query, checks that the indicators it filters on are loaded; if not, raises NeedResource so
  JavaScript can fetch them, then the call is replayed (queries are deterministic, so replays give identical results).
- `dispatch(path, body)` mirrors the local HTTP API (pipeline/research/server.py): same functions, same JSON shapes,
  same error codes (422 invalid/declined, 503 AI unavailable, 500 internal) — so the existing pages work unchanged.
"""
from __future__ import annotations

import json
import traceback

import duckdb

from pipeline.research import econometrics as M
from pipeline.research import engine as E
from pipeline.research import planner as P
from pipeline.research.ai import api as AI
from pipeline.research.ai import llm

DATA = "/studio/data"
INDEX = json.load(open(f"{DATA}/index.json"))["indicators"]
LOADED: set[str] = set()
_con = duckdb.connect()
_con.execute(f"CREATE TABLE countries AS SELECT * FROM read_parquet('{DATA}/countries.parquet')")
_con.execute(f"CREATE TABLE sources AS SELECT * FROM read_parquet('{DATA}/sources.parquet')")


def refresh_view():
    files = [f"{DATA}/obs/_empty.parquet"] + [f"{DATA}/obs/{INDEX[i]['file']}" for i in sorted(LOADED)]
    _con.execute(f"CREATE OR REPLACE VIEW observations AS SELECT * FROM read_parquet({json.dumps(files)})")


def mark_loaded(ids: list[str]):
    LOADED.update(i for i in ids if i in INDEX)
    refresh_view()


refresh_view()
E._con = _con
E._cache["catalogue"] = _con.execute(f"SELECT * FROM read_parquet('{DATA}/catalogue.parquet')").df()
_engine_query = E.query


def _guarded_query(sql, params=None):
    ids = []
    if sql in (E.SQL_OBSERVATIONS, E.SQL_BREAKDOWNS):
        ids = [params[0]]
    elif sql in (E.SQL_AVAILABILITY, E.SQL_COVERAGE):
        ids = list(params[0])
    missing = sorted({i for i in ids if i in INDEX and i not in LOADED})
    if missing:
        raise llm.NeedResource({"kind": "data", "ids": missing, "files": [INDEX[i]["file"] for i in missing],
                                "bytes": sum(INDEX[i]["bytes"] for i in missing)})
    return _engine_query(sql, params)


E.query = _guarded_query          # engine functions resolve `query` at call time, so they all go through the guard


def meta() -> dict:
    C = E.countries()
    return {"countries": C.to_dict("records"),
            "regions": sorted(C.region.dropna().unique().tolist()), "income_groups": sorted(C.income_group.dropna().unique().tolist()),
            "methods": M.METHODS, "transforms": {k: v[0] for k, v in E.TRANSFORMS.items()}, "levels": ["ADM0"],
            "vocabulary": [{"pattern": rx, "indicator_id": ind, "name": n} for rx, ind, n in P.VOCAB],
            "thresholds": {"min_n": M.MIN_N, "min_df_resid": M.MIN_DF_RESID, "min_clusters": M.MIN_CLUSTERS, "warn_clusters": M.WARN_CLUSTERS},
            "limits": E.LIMITS, "runtime": "browser"}


ROUTES = {
    ("GET", "research/meta"): lambda q, b: meta(),
    ("GET", "research/indicators"): lambda q, b: {"results": E.search_indicators(str(q.get("q", ""))[:200], "ADM0")},
    ("GET", "research/indicator"): lambda q, b: {"indicator": E.indicator_info(str(q.get("id", "")), "ADM0")},
    ("POST", "research/draft"): lambda q, b: P.draft(str(b.get("question", ""))),
    ("POST", "research/preview"): lambda q, b: P.preview(b.get("spec") or {}),
    ("POST", "research/run"): lambda q, b: P.execute(b.get("plan") or {}),
    ("GET", "assistant/status"): lambda q, b: AI.status(),
    ("POST", "assistant/plan"): lambda q, b: AI.plan(b), ("POST", "assistant/revise"): lambda q, b: AI.revise(b),
    ("POST", "assistant/choose"): lambda q, b: AI.choose(b), ("POST", "assistant/edit"): lambda q, b: AI.edit(b),
    ("POST", "assistant/run"): lambda q, b: AI.run(b), ("POST", "assistant/explain"): lambda q, b: AI.explain(b),
    ("POST", "assistant/fallback"): lambda q, b: AI.fallback(b),
}


def _clean(o):
    if isinstance(o, float):
        return None if o != o or o in (float("inf"), float("-inf")) else o
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


def dispatch(method: str, path: str, query_json: str, body_json: str) -> str:
    """Returns JSON: {status, body} for a finished call, or {need} when data or a model answer is required first."""
    fn = ROUTES.get((method, path))
    if fn is None:
        return json.dumps({"status": 404, "body": {"error": "not found"}})
    try:
        out = fn(json.loads(query_json or "{}"), json.loads(body_json or "{}"))
        return json.dumps({"status": 200, "body": _clean(out)}, default=str, allow_nan=False)
    except llm.NeedResource as n:
        return json.dumps({"need": n.need}, default=str)
    except E.SpecError as e:
        return json.dumps({"status": 422, "body": {"error": "invalid", "issues": e.issues}}, default=str)
    except M.Declined as d:
        return json.dumps({"status": 422, "body": {"error": "declined", "issues": [{"code": "declined", "message": r} for r in d.reasons]}})
    except AI.Unavailable as u:
        return json.dumps({"status": 503, "body": {"error": "ai_unavailable", "issues": [{"code": "ai_unavailable", "message": str(u)}], "status": AI.status()}}, default=str)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return json.dumps({"status": 500, "body": {"error": "internal", "issues": [{"code": "internal", "message": f"The request could not be completed ({type(e).__name__})."}]}})


def store_llm(key: str, result_json: str):
    llm.CACHE[key] = json.loads(result_json)


def set_model_state(available: bool, reason: str = ""):
    llm.STATE.update(available=bool(available), reason=reason or llm.STATE["reason"])
    AI._llm_state["starting"] = False
    AI._llm_state["status"] = None if available else {"reason": reason}


_WEBLLM_INFO = dict(llm.MODEL)


def set_model_info(info_json: str):
    """Describe the active model (Cloudflare Worker, or '' for the in-browser WebLLM model) in transcripts and status."""
    llm.MODEL.clear()
    llm.MODEL.update(json.loads(info_json) if info_json else _WEBLLM_INFO)
