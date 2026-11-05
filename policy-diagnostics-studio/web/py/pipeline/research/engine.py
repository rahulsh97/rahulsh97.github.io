"""Research data engine: build reproducible analytical datasets from the DuckDB warehouse.

A dataset is defined by an explicit specification (countries, indicators, breakdowns, years, geographic level,
transformations). The engine validates it against the warehouse, queries `observations` with a fixed parameterised
SQL statement (read-only connection), and returns:
  - a long table of the observations used (with source, status and version),
  - a wide unit-by-year table (one column per variable; missing cells stay missing — nothing is imputed),
  - a compatibility report (units, price bases, status flags, comparability notes, missingness, sample sizes),
  - provenance (indicator metadata, licences, spec hash, data hash, SQL template).

Rules: no indicator is substituted; a multi-breakdown indicator needs an explicit breakdown (an aggregate 'total'
breakdown is used only when it is the single total-like option, and this is recorded); duplicated keys are refused,
never averaged; projections are excluded unless requested; sources not cleared for redistribution are refused.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import math
import re
import threading
from dataclasses import dataclass, field

import duckdb
import numpy as np
import pandas as pd

from pipeline.common import WAREHOUSE

LEVELS = ["ADM0", "ADM1", "ADM2", "SURVEY_REGION", "NUTS1", "NUTS2", "NUTS3"]
TRANSFORMS = {
    "none": ("value as published", None),
    "log": ("natural logarithm (values ≤ 0 cannot be logged and are set to missing, counted in the report)", None),
    "thousands": ("divided by 1,000", 1e3),
    "millions": ("divided by 1,000,000", 1e6),
    "billions": ("divided by 1,000,000,000", 1e9),
}
TOTAL_LIKE = {"total", "Total", "TOTAL", "_T", "T", "BTSX", "_Z"}
LIMITS = {"countries": 220, "variables": 10, "year_min": 1960, "year_max": 2100}
NAME_RX = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

# The only SQL the engine runs against observations. Values are bound as parameters, never formatted into the text.
SQL_OBSERVATIONS = """
SELECT o.iso3, o.geo_code, o.geo_name, o.year, o.ref_period, o.breakdown, o.value, o.obs_status,
       o.source_id, o.source_version
FROM observations o
WHERE o.indicator_id = ? AND o.admin_level = ? AND list_contains(?, o.iso3) AND o.year BETWEEN ? AND ?
""".strip()
SQL_BREAKDOWNS = """
SELECT coalesce(o.breakdown, '') AS breakdown, count(*) AS n
FROM observations o
WHERE o.indicator_id = ? AND o.admin_level = ? AND list_contains(?, o.iso3) AND o.year BETWEEN ? AND ?
GROUP BY 1 ORDER BY 2 DESC
""".strip()


SQL_AVAILABILITY = """
SELECT o.indicator_id, o.year, count(DISTINCT o.iso3) AS n_countries
FROM observations o
WHERE list_contains(?, o.indicator_id) AND o.admin_level = ? AND list_contains(?, o.iso3)
  AND o.value IS NOT NULL AND coalesce(o.obs_status, '') <> 'projection'
GROUP BY 1, 2
""".strip()


SQL_COVERAGE = """
SELECT o.indicator_id, o.iso3, count(o.value) AS n_obs, min(o.year) AS first_year, max(o.year) AS last_year,
       count(DISTINCT coalesce(o.breakdown, '')) AS n_breakdowns
FROM observations o
WHERE list_contains(?, o.indicator_id) AND o.admin_level = ? AND list_contains(?, o.iso3) AND o.year BETWEEN ? AND ?
  AND o.value IS NOT NULL AND coalesce(o.obs_status, '') <> 'projection'
GROUP BY 1, 2
""".strip()


class SpecError(ValueError):
    """The specification is invalid or the data cannot support it. `issues` lists every problem found."""

    def __init__(self, issues: list[dict]):
        super().__init__("; ".join(i["message"] for i in issues))
        self.issues = issues


# ------------------------------------------------------------------------------------------------ connection
_lock = threading.Lock()
_con: duckdb.DuckDBPyConnection | None = None
_cache: dict = {}


def connect() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        _con = duckdb.connect(str(WAREHOUSE), read_only=True)
    return _con


def query(sql: str, params: list | None = None) -> pd.DataFrame:
    """Run one of this module's fixed statements (read-only connection, bound parameters)."""
    with _lock:
        return connect().execute(sql, params or []).df()


# ------------------------------------------------------------------------------------------------ metadata
def countries() -> pd.DataFrame:
    if "countries" not in _cache:
        _cache["countries"] = query("SELECT iso3, name, region, income_group FROM countries WHERE is_economy ORDER BY name")
    return _cache["countries"]


def sources() -> pd.DataFrame:
    if "sources" not in _cache:
        _cache["sources"] = query("SELECT source_id, name, institution, licence, attribution, public_release, access_status, url FROM sources")
    return _cache["sources"]


def indicator_catalogue() -> pd.DataFrame:
    """Indicators with observed coverage by geographic level (computed once from the warehouse)."""
    if "catalogue" not in _cache:
        _cache["catalogue"] = query("""
            SELECT i.indicator_id, i.source_id, i.native_code, i.title, i.definition, i.topic, i.unit, i.price_basis,
                   i.periodicity, i.licence, i.attribution, i.source_url, i.comparison_note, i.uncertainty, i.methodology,
                   c.admin_level, c.n_obs, c.n_countries, c.year_min, c.year_max
            FROM indicators i
            JOIN (SELECT indicator_id, admin_level, count(value) AS n_obs, count(DISTINCT iso3) AS n_countries,
                         min(year) AS year_min, max(year) AS year_max
                  FROM observations GROUP BY 1, 2) c USING (indicator_id)
            JOIN sources s ON s.source_id = i.source_id
            WHERE s.public_release
            ORDER BY c.n_obs DESC""")
    return _cache["catalogue"]


def search_indicators(text: str, level: str = "ADM0", limit: int = 25) -> list[dict]:
    """Rank catalogue entries by word overlap with `text` (titles, codes, topics). Deterministic; no model."""
    cat = indicator_catalogue()
    cat = cat[cat.admin_level == level]
    words = [w for w in re.findall(r"[a-z0-9.]+", (text or "").lower()) if len(w) > 1]
    if not words:
        return []
    hay = (cat.title.fillna("") + " " + cat.native_code.fillna("") + " " + cat.topic.fillna("")).str.lower()
    score = sum(hay.str.contains(re.escape(w), regex=True).astype(int) for w in words)
    exact = cat.native_code.fillna("").str.lower().isin(words) | cat.indicator_id.str.lower().isin(words)
    score = score + exact * 10
    allw = sum(hay.str.contains(re.escape(w), regex=True).astype(int) for w in words) == len(words)
    out = cat.assign(score=score + allw * 5, tlen=-cat.title.fillna("").str.len())
    out = out[out.score > 0].sort_values(["score", "n_countries", "tlen"], ascending=False).head(limit)
    return [_ind_public(r) for r in out.itertuples()]


def indicator_info(indicator_id: str, level: str) -> dict | None:
    cat = indicator_catalogue()
    m = cat[(cat.indicator_id == indicator_id) & (cat.admin_level == level)]
    return _ind_public(next(m.itertuples())) if len(m) else None


def _ind_public(r) -> dict:
    g = lambda k: (None if (v := getattr(r, k)) is None or (isinstance(v, float) and math.isnan(v)) else v)
    return {"indicator_id": r.indicator_id, "source_id": r.source_id, "code": g("native_code"), "title": g("title"),
            "unit": g("unit"), "price_basis": g("price_basis") or None, "periodicity": g("periodicity"),
            "licence": g("licence"), "attribution": g("attribution"), "source_url": g("source_url"),
            "comparison_note": g("comparison_note") or None, "level": r.admin_level, "n_obs": int(r.n_obs),
            "n_countries": int(r.n_countries), "year_min": int(r.year_min), "year_max": int(r.year_max),
            "definition": (g("definition") or "")[:600] or None}


def availability(indicator_ids: list[str], iso3: list[str], level: str = "ADM0") -> dict:
    """Observed (non-projected) coverage of indicators for the selected countries, distinguishing:
    the current calendar year; each indicator's latest year with data; the latest year in which every indicator has
    data for at least one selected country; and the latest year with data for every indicator and every country."""
    df = query(SQL_AVAILABILITY, [list(indicator_ids), level, list(iso3)])
    n_c = len(set(iso3))
    out = {"calendar_year": dt.date.today().year, "indicators": {}, "latest_common_year": None, "latest_complete_year": None,
           "note": "Breakdowns are not distinguished here; projections are excluded."}
    years_any, years_all = None, None
    for ind in indicator_ids:
        d = df[df.indicator_id == ind]
        full = d[d.n_countries >= n_c]
        out["indicators"][ind] = {"first_year": int(d.year.min()) if len(d) else None, "latest_year": int(d.year.max()) if len(d) else None,
                                  "latest_year_all_countries": int(full.year.max()) if len(full) else None}
        years_any = set(d.year) if years_any is None else years_any & set(d.year)
        years_all = set(full.year) if years_all is None else years_all & set(full.year)
    out["latest_common_year"] = int(max(years_any)) if years_any else None
    out["latest_complete_year"] = int(max(years_all)) if years_all else None
    return out


def coverage(indicator_ids: list[str], iso3: list[str], year_start: int, year_end: int, level: str = "ADM0") -> dict:
    """Per indicator and country: observed (non-projected) values, first and last year within the period."""
    df = query(SQL_COVERAGE, [list(indicator_ids), level, list(iso3), int(year_start), int(year_end)])
    span = year_end - year_start + 1
    out = {}
    for ind in indicator_ids:
        d = df[df.indicator_id == ind].set_index("iso3")
        out[ind] = {c: ({"n_obs": int(d.loc[c, "n_obs"]), "first_year": int(d.loc[c, "first_year"]), "last_year": int(d.loc[c, "last_year"]),
                         "share_of_years": round(int(d.loc[c, "n_obs"]) / span / max(1, int(d.loc[c, "n_breakdowns"])), 3),
                         "breakdowns": int(d.loc[c, "n_breakdowns"])} if c in d.index else None) for c in iso3}
    return out


# ------------------------------------------------------------------------------------------------ specification
@dataclass
class Variable:
    indicator_id: str
    name: str
    breakdown: str | None = None
    transform: str = "none"


@dataclass
class Spec:
    countries: list[str]
    variables: list[Variable]
    year_start: int
    year_end: int
    level: str = "ADM0"
    include_projections: bool = False
    meta: dict = field(default_factory=dict)

    def canonical(self) -> dict:
        return {"countries": sorted(self.countries), "level": self.level, "years": [self.year_start, self.year_end],
                "include_projections": self.include_projections,
                "variables": [{"indicator_id": v.indicator_id, "name": v.name, "breakdown": v.breakdown, "transform": v.transform}
                              for v in self.variables]}

    def hash(self) -> str:
        return hashlib.sha256(json.dumps(self.canonical(), sort_keys=True).encode()).hexdigest()[:16]


def default_name(indicator_id: str) -> str:
    code = indicator_id.split(":", 1)[-1].lower()
    n = re.sub(r"[^a-z0-9]+", "_", code).strip("_")
    return ("v_" + n if not n[:1].isalpha() else n)[:40]


def parse_spec(d: dict) -> Spec:
    """Validate a JSON specification. Raises SpecError listing every problem; never guesses missing parts."""
    issues: list[dict] = []
    if not isinstance(d, dict):
        raise SpecError([{"code": "spec", "message": "The dataset specification must be an object."}])
    known = set(countries().iso3)
    iso = d.get("countries") or []
    if not isinstance(iso, list) or not iso:
        issues.append({"code": "countries", "message": "Select at least one country."})
        iso = []
    iso = [str(c).upper() for c in iso]
    bad = [c for c in iso if c not in known]
    if bad:
        issues.append({"code": "countries", "message": f"Unknown country codes: {', '.join(bad[:10])}."})
    if len(set(iso)) > LIMITS["countries"]:
        issues.append({"code": "countries", "message": f"At most {LIMITS['countries']} countries."})
    level = d.get("level", "ADM0")
    if level not in LEVELS:
        issues.append({"code": "level", "message": f"Geographic level must be one of {', '.join(LEVELS)}."})
    years = d.get("years")
    try:
        y0, y1 = int(years[0]), int(years[1])
        if not (LIMITS["year_min"] <= y0 <= y1 <= LIMITS["year_max"]):
            raise ValueError
    except (TypeError, ValueError, IndexError):
        issues.append({"code": "years", "message": f"Give a start and end year between {LIMITS['year_min']} and {LIMITS['year_max']} (start ≤ end)."})
        y0 = y1 = 0
    vars_in = d.get("variables") or []
    if not isinstance(vars_in, list) or not vars_in:
        issues.append({"code": "variables", "message": "Select at least one indicator."})
        vars_in = []
    if len(vars_in) > LIMITS["variables"]:
        issues.append({"code": "variables", "message": f"At most {LIMITS['variables']} indicators."})
    srcs = sources().set_index("source_id")
    variables, names = [], set()
    for v in vars_in:
        if not isinstance(v, dict) or not v.get("indicator_id"):
            issues.append({"code": "variables", "message": "Each variable needs an indicator_id."})
            continue
        ind = str(v["indicator_id"])
        src = ind.split(":", 1)[0]
        if src not in srcs.index:
            issues.append({"code": "indicator", "message": f"{ind}: unknown source."})
            continue
        if not bool(srcs.loc[src, "public_release"]):
            issues.append({"code": "licence", "message": f"{ind}: source '{src}' is held locally but not cleared for redistribution, so it is not available for research exports."})
            continue
        if level in LEVELS and indicator_info(ind, level) is None:
            issues.append({"code": "indicator", "message": f"{ind}: no observations at level {level} in the warehouse (no substitute is chosen automatically)."})
            continue
        name = str(v.get("name") or default_name(ind))
        if not NAME_RX.match(name):
            issues.append({"code": "name", "message": f"Variable name '{name}' must start with a letter and use only a-z, 0-9 and _ (max 40)."})
            continue
        if name in names or name in {"unit", "iso3", "country", "geo_code", "geo_name", "year", "const"}:
            issues.append({"code": "name", "message": f"Variable name '{name}' is duplicated or reserved."})
            continue
        tr = v.get("transform", "none")
        if tr not in TRANSFORMS:
            issues.append({"code": "transform", "message": f"{name}: transformation must be one of {', '.join(TRANSFORMS)}."})
            continue
        names.add(name)
        bd = v.get("breakdown")
        variables.append(Variable(ind, name, None if bd in (None, "") else str(bd), tr))
    if issues:
        raise SpecError(issues)
    return Spec(sorted(set(iso)), variables, y0, y1, level, bool(d.get("include_projections", False)))


# ------------------------------------------------------------------------------------------------ build
def _resolve_breakdown(v: Variable, spec: Spec) -> tuple[str | None, str | None, list[str]]:
    """Return (breakdown, note, options). Raises SpecError when a choice is required."""
    bd = query(SQL_BREAKDOWNS, [v.indicator_id, spec.level, spec.countries, spec.year_start, spec.year_end])
    options = bd.breakdown.tolist()
    if not options:
        return None, None, []
    if v.breakdown is not None:
        if v.breakdown not in options:
            raise SpecError([{"code": "breakdown", "message": f"{v.name}: breakdown '{v.breakdown}' not found; options: {', '.join(options[:20])}."}])
        return v.breakdown, None, options
    if len(options) == 1:
        return options[0], None, options
    totals = [o for o in options if o in TOTAL_LIKE]
    if len(totals) == 1:
        return totals[0], f"{v.name}: {len(options)} breakdowns exist; the aggregate '{totals[0]}' was used (choose another explicitly if needed).", options
    raise SpecError([{"code": "breakdown", "message": f"{v.name}: this indicator has {len(options)} breakdowns and no single total; choose one explicitly. Options: {', '.join(options[:20])}{' …' if len(options) > 20 else ''}.",
                      "variable": v.name, "options": options[:200]}])


def build(spec: Spec) -> dict:
    """Construct the dataset and its compatibility report. Raises SpecError if the data cannot support the spec."""
    cmeta = countries().set_index("iso3")
    long_parts, var_reports, notes, issues = [], [], [], []
    for v in spec.variables:
        try:
            bd, note, options = _resolve_breakdown(v, spec)
        except SpecError as e:
            issues += e.issues
            continue
        if note:
            notes.append(note)
        df = query(SQL_OBSERVATIONS, [v.indicator_id, spec.level, spec.countries, spec.year_start, spec.year_end])
        df["breakdown"] = df.breakdown.fillna("")
        if bd is not None:
            df = df[df.breakdown == bd]
        info = indicator_info(v.indicator_id, spec.level)
        n_proj = int((df.obs_status == "projection").sum())
        if not spec.include_projections:
            df = df[df.obs_status != "projection"]
        df = df[df.value.notna()]
        unit_key = ["iso3"] if spec.level == "ADM0" else ["iso3", "geo_code"]
        dup = df[df.duplicated(unit_key + ["year"], keep=False)]
        if len(dup):
            ex = dup.head(4)[unit_key + ["year", "ref_period"]].astype(str).agg(" ".join, axis=1).tolist()
            issues.append({"code": "duplicates", "variable": v.name,
                           "message": f"{v.name}: {len(dup)} observations share a unit and year (e.g. {'; '.join(ex)}), typically several reference periods or surveys in one year. They are not averaged; narrow the years or choose another indicator."})
            continue
        raw = df.value.astype(float)
        n_nonpos = 0
        if v.transform == "log":
            n_nonpos = int((raw <= 0).sum())
            val = np.log(raw.where(raw > 0))
        elif TRANSFORMS[v.transform][1]:
            val = raw / TRANSFORMS[v.transform][1]
        else:
            val = raw
        df = df.assign(variable=v.name, indicator_id=v.indicator_id, raw_value=raw, value=val)
        long_parts.append(df)
        status = df.obs_status.fillna("").value_counts().to_dict()
        flags = []
        if n_proj:
            flags.append(f"{n_proj} projected values {'included' if spec.include_projections else 'excluded'}")
        for s in ("break in series", "unreliable", "model_lineup", "3-year average", "derived (vs 1991-2020 normal)"):
            if status.get(s):
                flags.append(f"{status[s]} values flagged '{s}' by the source")
        if n_nonpos:
            flags.append(f"{n_nonpos} values ≤ 0 could not be logged (set to missing)")
        var_reports.append({"name": v.name, "indicator_id": v.indicator_id, "title": info["title"], "source_id": info["source_id"],
                            "unit": info["unit"], "price_basis": info["price_basis"], "periodicity": info["periodicity"],
                            "breakdown": bd, "breakdown_options": len(options), "transform": v.transform,
                            "transform_text": TRANSFORMS[v.transform][0], "licence": info["licence"], "attribution": info["attribution"],
                            "source_url": info["source_url"], "comparison_note": info["comparison_note"],
                            "obs_status": status, "flags": flags, "n_obs": int(val.notna().sum()),
                            "n_units": int(df[unit_key].drop_duplicates().shape[0]),
                            "source_versions": sorted({str(x) for x in df.source_version.dropna().unique()})[:5]})
    if issues:
        raise SpecError(issues)
    long = pd.concat(long_parts, ignore_index=True)
    # Unit identifiers: country (ADM0) or country + area code.
    if spec.level == "ADM0":
        long["unit"] = long.iso3
        units = pd.DataFrame({"unit": spec.countries, "iso3": spec.countries, "geo_name": [cmeta.loc[c, "name"] for c in spec.countries]})
    else:
        long["unit"] = long.iso3 + ":" + long.geo_code
        units = long[["unit", "iso3", "geo_name"]].drop_duplicates("unit")
    grid = units.merge(pd.DataFrame({"year": range(spec.year_start, spec.year_end + 1)}), how="cross")
    wide = long.pivot_table(index=["unit", "year"], columns="variable", values="value", aggfunc="first").reset_index()
    wide = grid.merge(wide, on=["unit", "year"], how="left")
    wide.insert(2, "country", wide.iso3.map(cmeta["name"]))
    names = [v.name for v in spec.variables]
    for n in names:
        if n not in wide:
            wide[n] = np.nan
    wide = wide[["unit", "iso3", "country", "geo_name", "year"] + names].sort_values(["unit", "year"]).reset_index(drop=True)
    report = compatibility(spec, wide, var_reports, notes)
    long_out = long[["variable", "indicator_id", "unit", "iso3", "geo_code", "geo_name", "year", "ref_period", "breakdown",
                     "raw_value", "value", "obs_status", "source_id", "source_version"]].sort_values(["variable", "unit", "year"])
    csv_bytes = to_csv(wide).encode()   # full round-trip precision: the app and reproduce.py use identical values
    provenance = {"spec": spec.canonical(), "spec_hash": spec.hash(), "data_sha256": hashlib.sha256(csv_bytes).hexdigest(),
                  "sql_template": SQL_OBSERVATIONS, "warehouse": "DuckDB view `observations` over harmonised Parquet (read-only)",
                  "imputation": "none", "substitution": "none"}
    return {"spec": spec, "wide": wide, "long": long_out, "report": report, "provenance": provenance}


def compatibility(spec: Spec, wide: pd.DataFrame, var_reports: list[dict], notes: list[str]) -> dict:
    names = [v.name for v in spec.variables]
    units = wide.unit.unique()
    miss = {}
    for n in names:
        s = wide[n]
        per_unit = wide.assign(ok=s.notna()).groupby("unit").ok.sum()
        miss[n] = {"cells": int(len(s)), "observed": int(s.notna().sum()), "missing_share": round(float(s.isna().mean()), 4),
                   "units_without_data": sorted(per_unit[per_unit == 0].index.tolist()),
                   "years_observed": [int(wide.year[s.notna()].min()), int(wide.year[s.notna()].max())] if s.notna().any() else None}
    cc = wide.dropna(subset=names)
    by_unit = cc.groupby("unit").size()
    warnings = list(notes)
    for r in var_reports:
        warnings += [f"{r['name']}: {f}" for f in r["flags"]]
        if r["comparison_note"]:
            note = r["comparison_note"]
            warnings.append(f"{r['name']}: {note[:280]}{'…' if len(note) > 280 else ''}")
    srcs = {r["source_id"] for r in var_reports}
    if len(srcs) > 1:
        warnings.append(f"Variables come from {len(srcs)} sources ({', '.join(sorted(srcs))}); definitions and revision cycles differ.")
    for n in names:
        yo = miss[n]["years_observed"]
        if yo and (yo[1] < spec.year_end or yo[0] > spec.year_start):
            warnings.append(f"{n}: observed only in {yo[0]}–{yo[1]} within the requested {spec.year_start}–{spec.year_end}; years outside stay empty (not extended or extrapolated).")
        if miss[n]["units_without_data"]:
            warnings.append(f"{n}: no data for {', '.join(miss[n]['units_without_data'][:12])}{' …' if len(miss[n]['units_without_data']) > 12 else ''} in {spec.year_start}–{spec.year_end}.")
    status = "ok" if len(cc) else "empty"
    present = wide[["year"]].join(wide[names].notna())
    by_year_any = present.groupby("year")[names].any().all(axis=1)
    by_year_all = present.groupby("year")[names].all().all(axis=1)
    period = {"calendar_year": dt.date.today().year,
              "latest_year_per_variable": {n: (miss[n]["years_observed"] or [None, None])[1] for n in names},
              "latest_common_year": int(by_year_any[by_year_any].index.max()) if by_year_any.any() else None,
              "latest_complete_year": int(by_year_all[by_year_all].index.max()) if by_year_all.any() else None,
              "note": "Within the requested period: latest year with data for each variable; latest year in which every variable has data for at least one unit; latest year with every variable for every unit."}
    return {"status": status, "variables": var_reports, "missingness": miss, "warnings": warnings, "period": period,
            "units_requested": len(spec.countries) if spec.level == "ADM0" else int(len(units)),
            "years": [spec.year_start, spec.year_end],
            "complete_cases": {"rows": int(len(cc)), "units": int(cc.unit.nunique()), "years": int(cc.year.nunique()),
                               "per_unit_min": int(by_unit.min()) if len(by_unit) else 0, "per_unit_max": int(by_unit.max()) if len(by_unit) else 0,
                               "balanced": bool(len(by_unit) and by_unit.min() == by_unit.max() == cc.year.nunique())},
            "rules": ["No missing value is imputed; analyses use complete cases and report the sample used.",
                      "No indicator is substituted; each variable is exactly the indicator and breakdown listed.",
                      "Duplicated unit-year observations are refused, never averaged.",
                      "Projected values are excluded unless explicitly included."]}


def to_csv(df: pd.DataFrame) -> str:
    buf = io.StringIO()
    df.to_csv(buf, index=False, lineterminator="\n")   # default float repr round-trips float64 exactly
    return buf.getvalue()
