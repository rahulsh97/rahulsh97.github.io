# ---- reproduction code (standalone: needs only pandas, numpy, scipy, statsmodels, linearmodels) -------------------
# Recomputes every numerical output of the exported analysis from dataset.csv, writes reproduced_results.json and,
# if results.json (the application's output) is in the same folder, compares every number field by field.
import hashlib
import json
import math
import platform
import sys

import numpy as np
import pandas as pd
import scipy
import statsmodels
import statsmodels.api as sm
from linearmodels.panel import PanelOLS
from scipy import stats

import linearmodels

RTOL, ATOL = 1e-9, 1e-12
MIN_CLUSTERS = 10


def f(x):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else float(x)


def load():
    raw = open("dataset.csv", "rb").read()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != DATA_SHA256:
        sys.exit(f"dataset.csv differs from the exported file (SHA-256 {digest[:16]}..., expected {DATA_SHA256[:16]}...)")
    return pd.read_csv("dataset.csv", keep_default_na=True, na_values=[""], dtype={"unit": str, "iso3": str})


# ---- descriptive outputs -------------------------------------------------------------------------------------------
def describe(df, variables):
    rows = []
    for v in variables:
        s = df[v].dropna()
        n = int(s.size)
        rows.append({"variable": v, "n": n, "units": int(df.loc[s.index, "unit"].nunique()) if n else 0,
                     "mean": f(s.mean()) if n else None, "sd": f(s.std(ddof=1)) if n > 1 else None,
                     "min": f(s.min()) if n else None, "p25": f(s.quantile(.25)) if n else None, "median": f(s.median()) if n else None,
                     "p75": f(s.quantile(.75)) if n else None, "max": f(s.max()) if n else None})
    return {"table": rows}


def correlate(df, variables):
    cc = df.dropna(subset=variables)
    pairs = []
    for i, a in enumerate(variables):
        for b in variables[i + 1:]:
            r, p = stats.pearsonr(cc[a], cc[b])
            pairs.append({"a": a, "b": b, "r": f(r), "p_value": f(p), "n": int(len(cc))})
    return {"n": int(len(cc)), "units": int(cc.unit.nunique()), "pairs": pairs,
            "matrix": {"variables": variables, "values": cc[variables].corr().round(6).values.tolist()}}


def trends(df, variable):
    out = []
    for u, g in df.dropna(subset=[variable]).groupby("unit"):
        g = g.sort_values("year")
        first, last = g.iloc[0], g.iloc[-1]
        yrs = int(last.year - first.year)
        cagr = ((last[variable] / first[variable]) ** (1 / yrs) - 1) if yrs > 0 and first[variable] > 0 and last[variable] > 0 else None
        out.append({"unit": u, "country": first.country, "n": int(len(g)), "first_year": int(first.year), "first": f(first[variable]),
                    "last_year": int(last.year), "last": f(last[variable]), "change": f(last[variable] - first[variable]),
                    "avg_annual_growth_pct": f(cagr * 100) if cagr is not None else None, "mean": f(g[variable].mean()),
                    "series": [[int(y), f(x)] for y, x in zip(g.year, g[variable])]})
    return {"variable": variable, "units": out, "units_without_data": sorted(set(df.unit) - {o["unit"] for o in out})}


def panel_diagnostics(df, variables):
    cc = df.dropna(subset=variables)
    per = cc.groupby("unit").size()
    gaps = int(sum(((g.year.diff() > 1).sum()) for _, g in cc.groupby("unit")))
    decomp = []
    for v in variables:
        s = cc[v]
        within = s - cc.groupby("unit")[v].transform("mean")
        between = cc.groupby("unit")[v].mean()
        decomp.append({"variable": v, "overall_sd": f(s.std(ddof=1)) if len(s) > 1 else None,
                       "between_sd": f(between.std(ddof=1)) if len(between) > 1 else None,
                       "within_sd": f(within.std(ddof=1)) if len(s) > 1 else None})
    miss = [{"unit": u, "country": g.country.iloc[0], "rows": int(len(g)), **{v: int(g[v].notna().sum()) for v in variables},
             "complete": int(g[variables].notna().all(axis=1).sum())} for u, g in df.groupby("unit")]
    return {"units": int(cc.unit.nunique()), "years": int(cc.year.nunique()), "observations": int(len(cc)),
            "obs_per_unit": {"min": int(per.min()) if len(per) else 0, "median": f(per.median()) if len(per) else None, "max": int(per.max()) if len(per) else 0},
            "balanced": bool(len(per) and per.min() == per.max() == cc.year.nunique()), "singletons": int((per == 1).sum()),
            "internal_gaps": gaps, "variance_decomposition": decomp, "missingness_by_unit": miss,
            "requested_rows": int(len(df)), "dropped_incomplete_rows": int(len(df) - len(cc))}


# ---- regression outputs --------------------------------------------------------------------------------------------
def sample(df, y, X, fe, entity_effects):
    cc = df.dropna(subset=[y, *X])
    if fe and entity_effects:                       # singleton units dropped under unit effects only
        cc = cc[cc.groupby("unit")["year"].transform("size") > 1]
    return cc


def effects_design(cc, fe, ee, te):
    if not fe:
        return np.ones((len(cc), 1))
    cols = ([pd.get_dummies(cc.unit).to_numpy(float)] if ee else []) + ([pd.get_dummies(cc.year).to_numpy(float)] if te else [])
    return np.column_stack(cols)


def vif_and_condition(cc, X, fe, ee, te):
    D = effects_design(cc, fe, ee, te)
    Z = cc[X].to_numpy(float)
    Z = Z - D @ np.linalg.lstsq(D, Z, rcond=None)[0]       # exact projection on the effects (valid for unbalanced panels)
    sd = Z.std(axis=0)
    s = np.linalg.svd(Z / np.where(sd > 0, sd, 1), compute_uv=False)
    vifs = []
    for a in range(Z.shape[1]):
        others = np.delete(Z, a, axis=1)
        if others.shape[1] == 0:
            vifs.append({"variable": X[a], "vif": 1.0})
            continue
        e = Z[:, a] - others @ np.linalg.lstsq(others, Z[:, a], rcond=None)[0]
        omr = float(e @ e) / float(Z[:, a] @ Z[:, a])
        vifs.append({"variable": X[a], "vif": f(1 / omr) if omr > 0 else None})
    return vifs, (f(s[0] / s[-1]) if s[-1] > 0 else None)


def fit(cc, y, X, fe, ee, te, se):
    if not fe:
        exog = sm.add_constant(cc[X].astype(float), has_constant="add")
        m = sm.OLS(cc[y].astype(float), exog)
        if se == "cluster":
            return m.fit(cov_type="cluster", cov_kwds={"groups": pd.factorize(cc.unit)[0]}, use_t=True)
        return m.fit(cov_type="HC1", use_t=True) if se == "hc1" else m.fit()
    d = cc.set_index(["unit", "year"])
    m = PanelOLS(d[y].astype(float), d[X].astype(float), entity_effects=ee, time_effects=te, drop_absorbed=False, check_rank=True)
    if se == "cluster":
        return m.fit(cov_type="clustered", cluster_entity=True, debiased=True, group_debias=True)
    return m.fit(cov_type="robust", debiased=True)


def coef_table(res, fe):
    ci = res.conf_int(0.95 if fe else 0.05)
    lo, hi = (ci["lower"], ci["upper"]) if fe else (ci[0], ci[1])
    se = res.std_errors if fe else res.bse
    t = res.tstats if fe else res.tvalues
    return [{"term": n, "coef": f(b), "se": f(s), "t": f(tt), "p_value": f(p), "ci_low": f(l), "ci_high": f(h)}
            for n, b, s, tt, p, l, h in zip(res.params.index, res.params, se, t, res.pvalues, lo, hi)]


def estimate(df, p):
    fe = p["method"] == "panel_fe"
    y, X, se = p["y"], list(p["x"]), p.get("se", "cluster" if fe else "hc1")
    ee, te = bool(p.get("entity_effects", True)) if fe else False, bool(p.get("time_effects", False)) if fe else False
    cc = sample(df, y, X, fe, ee)
    res = fit(cc, y, X, fe, ee, te, se)
    vifs, cond = vif_and_condition(cc, X, fe, ee, te)
    fitted = (res.fitted_values.iloc[:, 0] if fe else res.fittedvalues).to_numpy(float)[:2000]
    resid = np.asarray(res.resids if fe else res.resid, float)[:2000]
    out = {"n": int(res.nobs), "units": int(cc.unit.nunique()), "years": int(cc.year.nunique()), "k": int(len(res.params)),
           "df_resid": f(res.df_resid), "coefficients": coef_table(res, fe), "vif": vifs, "condition_number": cond,
           "fitted": [[f(a), f(b)] for a, b in zip(fitted, resid)], "sample": cc[["unit", "year"]].to_dict("list")}
    if fe:
        out.update(r2_fe=f(res.rsquared), r2_within=f(res.rsquared_within), r2_overall=f(res.rsquared_overall), r2_between=f(res.rsquared_between),
                   singletons_dropped=int(df.dropna(subset=[y, *X]).groupby("unit").size().eq(1).sum()) if ee else 0)
    else:
        out.update(r2=f(res.rsquared), adj_r2=f(res.rsquared_adj))
    # Sensitivity: alternative inference and (FE) alternative effects, with the same estimators.
    alts = []
    if not fe:
        alts.append(("clustered by unit standard errors" if se != "cluster" else "HC1 robust standard errors", False, False, "cluster" if se != "cluster" else "hc1"))
    else:
        alts.append(("HC1 robust (not clustered) standard errors" if se == "cluster" else "clustered by unit standard errors", ee, te, "hc1" if se == "cluster" else "cluster"))
        if ee:
            alts.append(("without year effects" if te else "with year effects added", ee, not te, se))
    rows = []
    for label, e1, t1, s1 in alts:
        c1 = sample(df, y, X, fe, e1)
        if s1 == "cluster" and c1.unit.nunique() < MIN_CLUSTERS:
            continue                                          # declined in the application as well
        try:
            r = fit(c1, y, X, fe, e1, t1, s1)
        except Exception:
            continue
        sea = r.std_errors if fe else r.bse
        for term in res.params.index:
            if term == "const":
                continue
            rows.append({"alternative": label, "term": term, "coef": f(r.params[term]), "se": f(sea[term]), "p_value": f(r.pvalues[term]),
                         "n": int(r.nobs), "sign_change": bool(np.sign(r.params[term]) != np.sign(res.params[term])),
                         "significance_change": bool((r.pvalues[term] < 0.05) != (res.pvalues[term] < 0.05))})
    out["sensitivity"] = {"rows": rows}
    return out


# ---- comparison with the application's results.json ---------------------------------------------------------------
def compare(mine, theirs, path, log):
    if isinstance(mine, dict):
        for k, v in mine.items():
            if k not in theirs:
                log.append((path + "." + k, "FAIL", "missing in results.json"))
            else:
                compare(v, theirs[k], path + "." + k, log)
    elif isinstance(mine, list):
        if not isinstance(theirs, list) or len(mine) != len(theirs):
            log.append((path, "FAIL", f"length {len(mine)} vs {len(theirs) if isinstance(theirs, list) else type(theirs).__name__}"))
        else:
            for i, (a, b) in enumerate(zip(mine, theirs)):
                compare(a, b, f"{path}[{i}]", log)
    elif isinstance(mine, (int, float)) and not isinstance(mine, bool) and theirs is not None and not isinstance(theirs, (str, bool)):
        ok = math.isclose(float(mine), float(theirs), rel_tol=RTOL, abs_tol=ATOL)
        log.append((path, "PASS" if ok else "FAIL", "" if ok else f"{mine!r} vs {theirs!r}"))
    else:
        ok = mine == theirs
        log.append((path, "PASS" if ok else "FAIL", "" if ok else f"{mine!r} vs {theirs!r}"))


NOT_REPRODUCED = {"spec", "note", "warnings", "assumptions", "interpretation", "library", "method"}


def main():
    print(f"Python {platform.python_version()}; pandas {pd.__version__}; numpy {np.__version__}; scipy {scipy.__version__}; "
          f"statsmodels {statsmodels.__version__}; linearmodels {linearmodels.__version__}")
    print("Versions used by the application:", json.dumps(ENVIRONMENT))
    df = load()
    fns = {"describe": lambda p: describe(df, p["variables"]), "correlate": lambda p: correlate(df, p["variables"]),
           "compare_trends": lambda p: trends(df, p["variable"]), "panel_diagnostics": lambda p: panel_diagnostics(df, p["variables"]),
           "estimate": lambda p: estimate(df, p)}
    reproduced = []
    for step in STEPS:
        if step["status"] != "ok":
            reproduced.append({"op": step["op"], "status": step["status"], "result": None})
            continue
        reproduced.append({"op": step["op"], "status": "ok", "result": fns[step["op"]](step["params"])})
    json.dump(reproduced, open("reproduced_results.json", "w"), indent=1)
    try:
        app = json.load(open("results.json", encoding="utf-8"))
    except FileNotFoundError:
        print("results.json not found: reproduced_results.json written without comparison.")
        return 0
    fails, total = 0, 0
    print("\nStep  Operation          Numbers compared  Result   Not reproduced (narrative text from the application's rules)")
    for i, (mine, theirs) in enumerate(zip(reproduced, app["steps"])):
        if mine["result"] is None:
            print(f"{i + 1:<5} {mine['op']:<18} {'-':>16}  {'DECLINED in application (no outputs)':<8}")
            continue
        log = []
        compare(mine["result"], theirs["result"], "", log)
        bad = [l for l in log if l[1] == "FAIL"]
        fails += len(bad)
        total += len(log)
        skipped = sorted((set(theirs["result"]) - set(mine["result"])) | ({"sensitivity.flags", "sensitivity.notes"} if mine["op"] == "estimate" else set()))
        print(f"{i + 1:<5} {mine['op']:<18} {len(log):>16}  {'PASS' if not bad else 'FAIL':<8} {', '.join(skipped)}")
        for path, _, msg in bad[:10]:
            print(f"      x {path}: {msg}")
    print(f"\n{total} numbers and labels compared, {fails} differences (relative tolerance {RTOL}).")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
