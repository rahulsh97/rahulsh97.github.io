"""Transparent multi-step analytical planner.

A plan is JSON made only of whitelisted operations with validated parameters:

    retrieve         -> dataset specification (countries, indicators, breakdowns, transformations, years, level)
    build_panel      -> unit × year table (no parameters; no imputation)
    describe         -> descriptive statistics for named variables
    compare_trends   -> per-unit first/last/change/average growth for one variable
    correlate        -> Pearson correlations (complete cases)
    panel_diagnostics-> balance, gaps, within/between variation, missingness by unit
    estimate         -> ols | panel_fe (other registered methods are declined until validated)

`draft(question)` turns a question into a draft plan with a deterministic rule-based parser (country names, a
documented vocabulary of indicator phrases mapped to catalogue codes, year ranges, method keywords). It is not a
language model; anything it cannot resolve is listed in `unresolved` for the user to complete in the form, and the
user can edit every step before running. `execute(plan)` validates again and runs the operations; it never runs
generated code or SQL.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from pipeline.research import econometrics as M
from pipeline.research import engine as E

OPS = ["retrieve", "build_panel", "describe", "compare_trends", "correlate", "panel_diagnostics", "estimate"]
MAX_STEPS = 12

# Documented vocabulary: phrase pattern -> (catalogue indicator, default variable name). Shown in the plan for review.
VOCAB = [
    (r"gdp per capita growth|per capita (gdp|income) growth", "wb_wdi:NY.GDP.PCAP.KD.ZG", "gdppc_growth"),
    (r"gdp per capita|income per (capita|person)|per capita (gdp|income)", "wb_wdi:NY.GDP.PCAP.KD", "gdppc"),
    (r"gdp growth|economic growth|output growth|growth rate", "wb_wdi:NY.GDP.MKTP.KD.ZG", "gdp_growth"),
    (r"inflation|consumer prices", "wb_wdi:FP.CPI.TOTL.ZG", "inflation"),
    (r"unemployment", "wb_wdi:SL.UEM.TOTL.ZS", "unemployment"),
    (r"trade openness|openness|trade share|\btrade\b", "wb_wdi:NE.TRD.GNFS.ZS", "trade"),
    (r"\bexports\b", "wb_wdi:NE.EXP.GNFS.ZS", "exports"),
    (r"\bimports\b", "wb_wdi:NE.IMP.GNFS.ZS", "imports"),
    (r"foreign direct investment|\bfdi\b", "wb_wdi:BX.KLT.DINV.WD.GD.ZS", "fdi"),
    (r"investment|capital formation", "wb_wdi:NE.GDI.TOTL.ZS", "investment"),
    (r"government (consumption|spending|expenditure)|public spending", "wb_wdi:NE.CON.GOVT.ZS", "gov_consumption"),
    (r"tax revenue|\btaxes\b", "wb_wdi:GC.TAX.TOTL.GD.ZS", "tax_revenue"),
    (r"government debt|public debt|\bdebt\b", "wb_wdi:GC.DOD.TOTL.GD.ZS", "gov_debt"),
    (r"private credit|domestic credit|\bcredit\b", "wb_wdi:FS.AST.PRVT.GD.ZS", "private_credit"),
    (r"\baid\b|\boda\b|development assistance", "wb_wdi:DT.ODA.ODAT.GN.ZS", "oda"),
    (r"life expectancy", "wb_wdi:SP.DYN.LE00.IN", "life_expectancy"),
    (r"fertility", "wb_wdi:SP.DYN.TFRT.IN", "fertility"),
    (r"child mortality|under-?5 mortality|under-?five mortality", "wb_wdi:SH.DYN.MORT", "u5_mortality"),
    (r"urbani[sz]ation|urban population|urban share", "wb_wdi:SP.URB.TOTL.IN.ZS", "urban"),
    (r"population growth", "wb_wdi:SP.POP.GROW", "pop_growth"),
    (r"\bpopulation\b", "wb_wdi:SP.POP.TOTL", "population"),
    (r"electricity", "wb_wdi:EG.ELC.ACCS.ZS", "electricity_access"),
    (r"health (spending|expenditure)", "wb_wdi:SH.XPD.CHEX.GD.ZS", "health_exp"),
    (r"manufacturing", "wb_wdi:NV.IND.MANF.ZS", "manufacturing"),
    (r"agricultur", "wb_wdi:NV.AGR.TOTL.ZS", "agriculture"),
    (r"savings", "wb_wdi:NY.GNS.ICTR.ZS", "savings"),
    (r"current account", "wb_wdi:BN.CAB.XOKA.GD.ZS", "current_account"),
    (r"gini|inequality", "wb_wdi:SI.POV.GINI", "gini"),
    (r"poverty", "wb_wdi:SI.POV.DDAY", "poverty_300"),
    (r"secondary (school )?enrol+ment|school enrol+ment|enrol+ment", "wb_wdi:SE.SEC.ENRR", "secondary_enrolment"),
    (r"\bgrowth\b", "wb_wdi:NY.GDP.MKTP.KD.ZG", "gdp_growth"),   # bare "growth" read as real GDP growth (shown for review)
]
ALIASES = {"us": "USA", "u.s.": "USA", "usa": "USA", "united states": "USA", "america": "USA", "uk": "GBR", "britain": "GBR",
           "united kingdom": "GBR", "south korea": "KOR", "korea": "KOR", "russia": "RUS", "iran": "IRN", "egypt": "EGY",
           "vietnam": "VNM", "viet nam": "VNM", "turkey": "TUR", "turkiye": "TUR", "drc": "COD", "dr congo": "COD",
           "democratic republic of the congo": "COD", "venezuela": "VEN", "yemen": "YEM", "syria": "SYR", "laos": "LAO",
           "kyrgyzstan": "KGZ", "slovakia": "SVK", "gambia": "GMB", "bahamas": "BHS", "ivory coast": "CIV", "cote d'ivoire": "CIV",
           "czech republic": "CZE", "czechia": "CZE", "hong kong": "HKG", "macau": "MAC"}
GROUP_WORDS = {"sub-saharan africa": ("region", "Sub-Saharan Africa"), "sub-saharan african": ("region", "Sub-Saharan Africa"),
               "latin america": ("region", "Latin America & Caribbean"), "latin american": ("region", "Latin America & Caribbean"),
               "east asia": ("region", "East Asia & Pacific"), "europe and central asia": ("region", "Europe & Central Asia"),
               "european": ("region", "Europe & Central Asia"), "south asia": ("region", "South Asia"), "south asian": ("region", "South Asia"),
               "middle east": ("region", "Middle East & North Africa"), "north america": ("region", "North America"),
               "low-income": ("income", "Low income"), "low income": ("income", "Low income"),
               "lower-middle-income": ("income", "Lower middle income"), "lower middle income": ("income", "Lower middle income"),
               "upper-middle-income": ("income", "Upper middle income"), "upper middle income": ("income", "Upper middle income"),
               "high-income": ("income", "High income"), "high income": ("income", "High income")}
UNAVAILABLE = [(r"difference[- ]in[- ]difference|diff[- ]in[- ]diff|\bdid\b", "did"), (r"event[- ]stud", "event_study"),
               (r"instrument|\biv\b|2sls|two[- ]stage", "iv"), (r"spatial", "spatial"), (r"survey[- ]weight", "survey_weighted")]
CAUSAL = re.compile(r"\b(effects? of|impacts?|causes?|causal|caused|affects?|boosts?|increases?|reduces?)\b", re.I)


# ------------------------------------------------------------------------------------------------ draft from text
def _find_countries(q: str) -> tuple[list[str], list[str]]:
    ql = " " + q.lower() + " "
    C = E.countries()
    names = {}
    for r in C.itertuples():
        names[r.name.lower()] = r.iso3
        short = r.name.split(",")[0].lower()
        names.setdefault(short, r.iso3)
    names.update(ALIASES)
    found, labels = [], []
    for phrase, kind in sorted(GROUP_WORDS.items(), key=lambda kv: -len(kv[0])):
        if re.search(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", ql):
            col = "region" if kind[0] == "region" else "income_group"
            members = C[C[col] == kind[1]].iso3.tolist()
            found += members
            labels.append(f"{kind[1]} ({len(members)} economies)")
            ql = ql.replace(phrase, " " * len(phrase))
    if re.search(r"\ball (countries|economies)\b", ql):
        found += C.iso3.tolist()
        labels.append(f"all economies ({len(C)})")
    for phrase in sorted(names, key=len, reverse=True):
        if len(phrase) < 3 and phrase not in ALIASES:
            continue
        m = re.search(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", ql)
        if m:
            found.append(names[phrase])
            ql = ql[:m.start()] + " " * len(phrase) + ql[m.end():]
    seen = list(dict.fromkeys(found))
    return seen, labels


def _find_variables(q: str) -> list[dict]:
    ql = q.lower()
    hits = []
    for rx, ind, name in VOCAB:
        m = re.search(rx, ql)
        if m:
            log = bool(re.search(r"\blog(arithm)?( of)?\s*(real )?$", ql[max(0, m.start() - 20):m.start()]))
            hits.append({"pos": m.start(), "indicator_id": ind, "name": ("log_" + name) if log else name, "transform": "log" if log else "none",
                         "matched": m.group(0)})
            ql = ql[:m.start()] + "#" * (m.end() - m.start()) + ql[m.end():]
    seen, out = set(), []
    for h in sorted(hits, key=lambda h: h["pos"]):
        if (h["indicator_id"], h["transform"]) not in seen:
            seen.add((h["indicator_id"], h["transform"]))
            out.append(h)
    return out


def _find_years(q: str) -> dict | None:
    """Explicit ranges are kept exactly. Open-ended periods ('since 2000', 'last 10 years') are returned unresolved and
    completed later from the data's actual coverage — never from a fixed calendar assumption."""
    m = re.search(r"\b(19[6-9]\d|20\d\d)\s*(?:-|–|—|to|and|until|through)\s*(19[6-9]\d|20\d\d)\b", q)
    if m:
        return {"kind": "explicit", "years": [int(m.group(1)), int(m.group(2))]}
    m = re.search(r"\b(?:since|from|after)\s+(19[6-9]\d|20\d\d)\b", q, re.I)
    if m:
        return {"kind": "since", "start": int(m.group(1))}
    m = re.search(r"\b(?:last|past)\s+(\d{1,2})\s+years\b", q, re.I)
    if m:
        return {"kind": "last", "n": int(m.group(1))}
    return None


def _resolve_period(found: dict | None, iso: list[str], vars_: list[dict], notes: list, unresolved: list):
    if found and found["kind"] == "explicit":
        return found["years"]
    av = E.availability([v["indicator_id"] for v in vars_], iso) if iso and vars_ else None
    if av:
        per = "; ".join(f"{v['name']} {av['indicators'][v['indicator_id']]['latest_year'] or 'none'}" for v in vars_)
        notes.append(f"Calendar year {av['calendar_year']}. Latest year with data for the selected countries: {per}. "
                     f"Latest year in which every variable has data for at least one selected country: {av['latest_common_year'] or 'none'}; "
                     f"for all selected countries: {av['latest_complete_year'] or 'none'}.")
    if not found:
        unresolved.append({"field": "years", "message": "No period given (e.g. 2000–2020). Choose start and end years."})
        return None
    if not av or not av["latest_common_year"]:
        unresolved.append({"field": "years", "message": "The period is open-ended and the latest year with data could not be determined (countries or indicators missing, or no common coverage). Choose the end year."})
        return None
    end = av["latest_common_year"]
    start = found["start"] if found["kind"] == "since" else end - found["n"] + 1
    if start > end:
        unresolved.append({"field": "years", "message": f"The requested start ({start}) is after the latest year with data for all variables ({end}). Choose the period."})
        return None
    notes.append(f"Open-ended period resolved to {start}–{end}: it ends at the latest year in which every variable has data (not the calendar year); nothing is extended or extrapolated.")
    return [start, end]


def draft(question: str) -> dict:
    q = (question or "").strip()[:1000]
    notes, unresolved = [], []
    iso, groups = _find_countries(q)
    vars_ = _find_variables(q)
    if groups:
        notes.append("Country groups resolved from the World Bank classification: " + "; ".join(groups) + ".")
    if not iso:
        unresolved.append({"field": "countries", "message": "No country or country group recognised. Select countries."})
    if not vars_:
        unresolved.append({"field": "variables", "message": "No indicator recognised from the Studio vocabulary. Search the catalogue and add indicators."})
    years = _resolve_period(_find_years(q), iso, vars_, notes, unresolved)
    for v in vars_:
        info = E.indicator_info(v["indicator_id"], "ADM0")
        notes.append(f"“{v['matched']}” → {v['indicator_id'].split(':')[1]} ({info['title'] if info else 'not found'}){' — natural log' if v['transform'] == 'log' else ''}. Check this is the series you mean.")
    names = [v["name"] for v in vars_]
    steps = [{"op": "retrieve", "params": {"countries": iso, "years": years, "level": "ADM0",
                                            "variables": [{"indicator_id": v["indicator_id"], "name": v["name"], "transform": v["transform"]} for v in vars_]}},
             {"op": "build_panel", "params": {}}]
    ql = q.lower()
    if re.search(r"compar|trend|evolv|evolution|over time|how (has|have|did)|changed", ql) and names:
        for n in names[:3]:
            steps.append({"op": "compare_trends", "params": {"variable": n}})
    if re.search(r"describ|summary statistic|descriptive", ql) and names:
        steps.append({"op": "describe", "params": {"variables": names}})
    if re.search(r"correlat", ql) and len(names) >= 2:
        steps.append({"op": "correlate", "params": {"variables": names}})
    unavailable = next((m for rx, m in UNAVAILABLE if re.search(rx, ql)), None)
    wants_model = unavailable or re.search(r"regress|regression|model|estimat|fixed[- ]effect|panel|\bols\b|effect of|impact of|relationship|associat|explain|determinant|predict", ql)
    if wants_model and names:
        y, x, how = _dependent(ql, vars_)
        if how:
            notes.append(how)
        if unavailable:
            method = unavailable
        elif re.search(r"fixed[- ]effect|\bpanel\b|\bwithin\b|\bfe\b", ql):
            method = "panel_fe"
        elif re.search(r"\bols\b|pooled|least squares|cross[- ]section", ql):
            method = "ols"
        else:
            method = None
            unresolved.append({"field": "method", "message": "Choose a model: OLS (pooled) or panel fixed effects. With several countries observed over years, fixed effects control for time-invariant country differences."})
        two_way = bool(re.search(r"year (fixed )?effect|time (fixed )?effect|two[- ]way", ql))
        se = "hc1" if re.search(r"\brobust\b", ql) and not re.search(r"cluster", ql) else "cluster"
        if not x and not unavailable:
            unresolved.append({"field": "x", "message": "Choose at least one explanatory variable."})
        steps.append({"op": "panel_diagnostics", "params": {"variables": [y, *x] if y else names}})
        steps.append({"op": "estimate", "params": {"method": method, "y": y, "x": x, "entity_effects": True,
                                                   "time_effects": two_way, "se": se}})
        if CAUSAL.search(ql):
            notes.append("The question uses causal language. The Studio estimates conditional associations only; results will not be described as causal effects.")
    if len(steps) == 2 and names:
        steps.append({"op": "describe", "params": {"variables": names}})
        notes.append("No analysis keyword found; descriptive statistics were added. Add or change steps below.")
    return {"version": 1, "question": q, "steps": steps, "unresolved": unresolved, "notes": notes,
            "parser": "Rule-based (no language model): country names and groups, a documented indicator vocabulary, year patterns and method keywords."}


def _dependent(ql: str, vars_: list[dict]):
    names = [v["name"] for v in vars_]
    if len(names) == 1:
        return names[0], [], "Only one indicator recognised; add explanatory variables."
    m = re.search(r"regress\w*\s+(.*?)\s+on\s+", ql)
    if m:
        before = [v for v in vars_ if v["pos"] < m.end()]
        if before:
            y = before[0]["name"]
            return y, [n for n in names if n != y], f"Dependent variable “{y}” taken from “regress … on …”."
    m = re.search(r"(effect|impact|influence|association)s? of .* on ", ql)
    if m:
        after = [v for v in vars_ if v["pos"] >= m.end() - 1]
        if after:
            y = after[0]["name"]
            return y, [n for n in names if n != y], f"Dependent variable “{y}” taken from “… of X on Y”."
    m = re.search(r"(?:does|do|did|can)\s+.*?\b(explain|predict|affect|drive)\b", ql)
    if m:
        after = [v for v in vars_ if v["pos"] > m.end()]
        if after:
            y = after[0]["name"]
            return y, [n for n in names if n != y], f"Dependent variable “{y}” is the outcome after “{m.group(1)}”."
    return names[0], names[1:], f"Dependent variable assumed to be the first indicator mentioned (“{names[0]}”); change it if needed."


# ------------------------------------------------------------------------------------------------ validate + execute
def validate(plan: dict) -> tuple[E.Spec, list[dict]]:
    if not isinstance(plan, dict) or not isinstance(plan.get("steps"), list):
        raise E.SpecError([{"code": "plan", "message": "A plan must be an object with a list of steps."}])
    steps = plan["steps"]
    if len(steps) > MAX_STEPS:
        raise E.SpecError([{"code": "plan", "message": f"At most {MAX_STEPS} steps."}])
    issues = []
    for i, s in enumerate(steps):
        if not isinstance(s, dict) or s.get("op") not in OPS:
            issues.append({"code": "op", "message": f"Step {i + 1}: operation must be one of {', '.join(OPS)}."})
    if issues:
        raise E.SpecError(issues)
    if len(steps) < 2 or steps[0]["op"] != "retrieve" or steps[1]["op"] != "build_panel" or [s["op"] for s in steps].count("retrieve") != 1:
        raise E.SpecError([{"code": "plan", "message": "A plan starts with one 'retrieve' step followed by 'build_panel'."}])
    spec = E.parse_spec(steps[0].get("params") or {})
    names = {v.name for v in spec.variables}
    out = []
    for i, s in enumerate(steps[2:], start=3):
        p = s.get("params") or {}
        op = s["op"]
        bad = lambda v: v not in names
        if op in ("describe", "correlate", "panel_diagnostics"):
            vs = p.get("variables") or sorted(names)
            if not isinstance(vs, list) or any(bad(v) for v in vs):
                issues.append({"code": "variables", "message": f"Step {i} ({op}): variables must be among {', '.join(sorted(names))}."})
            p = {"variables": vs}
        elif op == "compare_trends":
            if bad(p.get("variable")):
                issues.append({"code": "variables", "message": f"Step {i} (compare_trends): choose one of {', '.join(sorted(names))}."})
            p = {"variable": p.get("variable")}
        elif op == "estimate":
            method = p.get("method")
            if method not in M.METHODS:
                issues.append({"code": "method", "message": f"Step {i}: choose a model ({', '.join(k for k, v in M.METHODS.items() if v['status'] == 'available' and k in ('ols', 'panel_fe'))})."})
            elif M.METHODS[method]["status"] == "available":
                if method not in ("ols", "panel_fe"):
                    issues.append({"code": "method", "message": f"Step {i}: '{method}' is not an estimation method; use its own step."})
                if bad(p.get("y")) or not isinstance(p.get("x"), list) or any(bad(v) for v in p.get("x", [])):
                    issues.append({"code": "variables", "message": f"Step {i}: dependent and explanatory variables must be among {', '.join(sorted(names))}."})
                se_ok = {"ols": ("hc1", "cluster", "classical"), "panel_fe": ("cluster", "hc1")}.get(method, ())
                if p.get("se", "cluster" if method == "panel_fe" else "hc1") not in se_ok:
                    issues.append({"code": "se", "message": f"Step {i}: standard errors for {method} must be one of {', '.join(se_ok)}."})
            p = {k: p.get(k) for k in ("method", "y", "x", "entity_effects", "time_effects", "se") if k in p}
        out.append({"op": op, "params": p})
    if issues:
        raise E.SpecError(issues)
    return spec, out


def execute(plan: dict) -> dict:
    spec, steps = validate(plan)
    built = E.build(spec)
    df = built["wide"]
    results = []
    for s in steps:
        op, p = s["op"], s["params"]
        try:
            if op == "describe":
                r = M.describe(df, p["variables"])
            elif op == "correlate":
                r = M.correlation(df, p["variables"])
            elif op == "compare_trends":
                r = M.trends(df, p["variable"])
            elif op == "panel_diagnostics":
                r = {"method": "panel_diagnostics", **M.panel_diagnostics(df, p["variables"])}
            else:
                r = M.estimate(df, p)
            results.append({"op": op, "params": p, "status": "ok", "result": r})
        except M.Declined as d:
            results.append({"op": op, "params": p, "status": "declined", "reasons": d.reasons, "suggestions": d.suggestions})
        except Exception as e:  # noqa: BLE001 — report the step as failed instead of failing the whole plan
            results.append({"op": op, "params": p, "status": "declined", "suggestions": [],
                            "reasons": [f"This step could not be computed ({type(e).__name__}); no result is shown."]})
    out = {"plan": {"version": 1, "question": plan.get("question", ""), "steps": [{"op": "retrieve", "params": spec.canonical()}, {"op": "build_panel", "params": {}}] + steps},
           "dataset": {"report": built["report"], "provenance": built["provenance"], "rows": int(len(df)),
                       "preview": json.loads(df.head(400).to_json(orient="records"))},
           "steps": results}
    out["downloads"] = downloads(out, built)
    return out


def preview(spec_dict: dict) -> dict:
    built = E.build(E.parse_spec(spec_dict))
    df = built["wide"]
    return {"report": built["report"], "provenance": built["provenance"], "rows": int(len(df)),
            "preview": json.loads(df.head(400).to_json(orient="records"))}


# ------------------------------------------------------------------------------------------------ downloads
TEMPLATE = Path(__file__).with_name("reproduce_template.py")


def environment() -> dict:
    import platform

    import duckdb
    import linearmodels
    import numpy
    import scipy
    import statsmodels
    return {"python": platform.python_version(), "pandas": pd.__version__, "numpy": numpy.__version__, "scipy": scipy.__version__,
            "statsmodels": statsmodels.__version__, "linearmodels": linearmodels.__version__, "duckdb": duckdb.__version__}


def downloads(out: dict, built: dict) -> dict:
    out["environment"] = environment()
    return {"dataset.csv": E.to_csv(built["wide"]), "observations_long.csv": E.to_csv(built["long"]),
            "results.json": json.dumps({k: v for k, v in out.items() if k != "downloads"}, indent=1, default=str),
            "reproduce.py": reproduction_script(out), "methods.md": methods_note(out)}


def reproduction_script(out: dict) -> str:
    """Standalone script: header documenting data and rules, the analysis steps as data, then the fixed template that
    recomputes every numerical output and compares it with results.json. No application code is needed to run it."""
    rep, prov = out["dataset"]["report"], out["dataset"]["provenance"]
    head = ['"""Reproduce every numerical output of a Policy Diagnostics Studio analysis.', "",
            "Files (same folder): dataset.csv (frozen analytical data), results.json (application output, for comparison).",
            "Run: python reproduce.py   -> writes reproduced_results.json and prints a PASS/FAIL table; exit code 1 on any difference.",
            "Requires: pandas, numpy, scipy, statsmodels, linearmodels.", "",
            f"Question: {out['plan'].get('question') or '(form-based analysis)'}",
            f"Units: {rep['units_requested']} ({prov['spec']['level']}); years {rep['years'][0]}-{rep['years'][1]}; spec hash {prov['spec_hash']}.", "",
            "Variables (exactly as retrieved; no substitution, no imputation):"]
    for v in rep["variables"]:
        head.append(f"  {v['name']}: {v['indicator_id']} - {v['title']} [{v['unit']}]; source {v['source_id']} ({v['licence']}); "
                    f"breakdown {v['breakdown'] or 'none'}; transformation: {v['transform_text']}; {v['source_url'] or ''}")
    head += ["", "Sample rules: dataset.csv holds the full unit x year grid of the request (missing cells empty).",
             "  Each analysis uses complete cases of its own variables. Fixed-effects models with unit effects drop units",
             "  with a single complete observation. Projections were excluded at retrieval unless stated in the spec.",
             "Inference: OLS HC1 / clustered by unit (CR1, t with G-1 df) / classical; panel FE clustered by unit with",
             "  G/(G-1)*(N-1)/(N-d-K) (d = absorbed effects counted only in two-way models) or robust; 95% intervals.",
             'Narrative text (warnings, interpretation, assumptions) comes from the application\'s rules and is not recomputed.', '"""']
    steps = [{"op": s["op"], "params": s["params"], "status": s["status"]} for s in out["steps"]]
    consts = [f"DATA_SHA256 = {prov['data_sha256']!r}",
              f"ENVIRONMENT = {json.dumps(out.get('environment', {}))}",
              f"STEPS = {json.dumps(steps, indent=1)}".replace("true", "True").replace("false", "False").replace("null", "None"), ""]
    return "\n".join(head + consts) + "\n" + TEMPLATE.read_text(encoding="utf-8")


def methods_note(out: dict) -> str:
    rep, prov = out["dataset"]["report"], out["dataset"]["provenance"]
    L = ["# Methods note — Policy Diagnostics Studio research workbench", "",
         f"Question: {out['plan'].get('question') or '(form-based analysis)'}", "",
         "## Data", f"Countries/units: {rep['units_requested']}; years {rep['years'][0]}–{rep['years'][1]}; level {prov['spec']['level']}.",
         f"Complete cases (all variables observed): {rep['complete_cases']['rows']} rows, {rep['complete_cases']['units']} units."]
    per = rep.get("period") or {}
    if per:
        L.append(f"Calendar year {per['calendar_year']}; latest year with data per variable: "
                 + ", ".join(f"{k} {v}" for k, v in per["latest_year_per_variable"].items())
                 + f"; latest common year {per['latest_common_year']}; latest year complete for all units {per['latest_complete_year']}.")
    L += ["", "| Variable | Indicator | Source | Unit | Breakdown | Transformation | Observations |", "|---|---|---|---|---|---|---|"]
    for v in rep["variables"]:
        L.append(f"| {v['name']} | {v['indicator_id']} — {v['title']} | {v['source_id']} ({v['licence']}) | {v['unit']} | {v['breakdown'] or '—'} | {v['transform_text']} | {v['n_obs']} |")
    L += ["", "Rules: " + " ".join(rep["rules"]), "", "Warnings:"] + [f"- {w}" for w in rep["warnings"]] + [""]
    L += ["## Analyses"]
    for s in out["steps"]:
        if s["status"] == "declined":
            L += [f"- **{s['op']} — declined.** " + " ".join(s["reasons"])]
            continue
        r = s["result"]
        if s["op"] == "estimate":
            sp = r["spec"]
            L += [f"### {'OLS' if r['method'] == 'ols' else 'Panel fixed effects'}: {sp['y']} on {', '.join(sp['X'])}",
                  f"N = {r['n']}, units = {r['units']}, years = {r['years']}, residual df = {r['df_resid']:.0f}. "
                  + (f"Effects: {sp['effects']}. " if r["method"] == "panel_fe" else "Constant included. ") + f"Standard errors: {sp['cov_type']}.", "",
                  "| Term | Coef. | SE | 95% CI | p |", "|---|---|---|---|---|"]
            L += [f"| {c['term']} | {c['coef']:.6g} | {c['se']:.4g} | [{c['ci_low']:.4g}, {c['ci_high']:.4g}] | {c['p_value']:.3g} |" for c in r["coefficients"]]
            if r["sensitivity"]["rows"]:
                L += ["", "Sensitivity (same estimator, alternative choices):", "", "| Alternative | Term | Coef. | SE | p | Sign change | Significance change |", "|---|---|---|---|---|---|---|"]
                L += [f"| {x['alternative']} | {x['term']} | {x['coef']:.6g} | {x['se']:.4g} | {x['p_value']:.3g} | {'yes' if x['sign_change'] else 'no'} | {'yes' if x['significance_change'] else 'no'} |" for x in r["sensitivity"]["rows"]]
            L += ["", "Assumptions:"] + [f"- {a}" for a in r["assumptions"]]
            L += ["", f"Interpretation: {r['interpretation']}", "", "Limitations of this estimate:"] + [f"- {w}" for w in r["warnings"] + r["sensitivity"]["flags"] + r["sensitivity"]["notes"]] + [""]
        else:
            L += [f"- {s['op']}: computed ({r.get('note', '')})"]
    env = out.get("environment", {})
    L += ["", "## Software", ", ".join(f"{k} {v}" for k, v in env.items()), "",
          "## Provenance", f"Spec hash {prov['spec_hash']}; dataset.csv SHA-256 {prov['data_sha256']}.", "Query template (parameters bound, read-only):", "```sql", prov["sql_template"], "```",
          "", "Sources and licences:"] + sorted({f"- {v['source_id']}: {v['attribution'].splitlines()[0] if v['attribution'] else ''} ({v['licence']})" for v in rep["variables"]})
    return "\n".join(L) + "\n"
