"""Econometrics module: descriptive statistics, correlations, OLS and panel fixed-effects models.

Estimation uses established open-source libraries (statsmodels for OLS, linearmodels for panel fixed effects);
tests/test_research_econometrics.py checks them against an independent NumPy implementation and the NIST StRD
Longley certified values.

Every estimator first runs explicit validation and *declines* (raises Declined with reasons) rather than producing
numbers whose inference would be unreliable: too few observations or residual degrees of freedom, collinear or
constant regressors, regressors without within-unit variation under fixed effects, or too few clusters for
cluster-robust inference. Results never describe coefficients as causal effects.

Advanced methods are registered with their required inputs but are marked not available until implemented and
validated; requesting them is declined.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import statsmodels.api as sm
from linearmodels.panel import PanelOLS
from scipy import stats

MIN_N = 30            # minimum complete-case observations for any regression
MIN_DF_RESID = 20     # minimum residual degrees of freedom
MIN_CLUSTERS = 10     # cluster-robust inference is declined below this number of clusters (a floor, not sufficiency)
WARN_CLUSTERS = 50    # cluster-count caution below this (strong warning below 20); no count guarantees reliability
MAX_REGRESSORS = 8

NON_CAUSAL = ("Coefficients are conditional associations within this sample and specification. They are not causal "
              "effects: omitted variables, reverse causality, measurement error and sample selection are not addressed.")

METHODS = {
    "describe": {"status": "available", "label": "Descriptive statistics", "inputs": ["variables"]},
    "correlation": {"status": "available", "label": "Correlations (Pearson, complete cases)", "inputs": ["two or more variables"]},
    "ols": {"status": "available", "label": "OLS regression",
            "inputs": ["dependent variable", "1–8 regressors", "standard errors: HC1 robust, clustered by unit, or classical"]},
    "panel_fe": {"status": "available", "label": "Panel fixed effects (unit, optionally year)",
                 "inputs": ["dependent variable", "1–8 regressors", "unit effects", "optional year effects", "standard errors clustered by unit (≥ 10 units) or HC1 robust"]},
    "did": {"status": "not available", "label": "Difference-in-differences",
            "inputs": ["treatment indicator per unit", "treatment timing", "comparison group definition", "pre-period"],
            "reason": "Needs explicit treatment and timing definitions, staggered-adoption-robust estimators, pre-trend diagnostics and validation against a reference implementation. Not implemented."},
    "event_study": {"status": "not available", "label": "Event study",
                    "inputs": ["event dates per unit", "event window", "reference period"],
                    "reason": "Needs event-time construction, heterogeneity-robust estimation and validation. Not implemented."},
    "iv": {"status": "not available", "label": "Instrumental variables (2SLS)",
           "inputs": ["endogenous regressor", "excluded instruments", "exclusion-restriction argument"],
           "reason": "Needs instrument definitions, weak-instrument diagnostics and validation. Not implemented."},
    "spatial": {"status": "not available", "label": "Spatial models",
                "inputs": ["spatial weights matrix from boundaries", "model type (lag/error)"],
                "reason": "Needs spatial weights from validated boundaries and validated estimators. Not implemented."},
    "survey_weighted": {"status": "not available", "label": "Survey-weighted estimation",
                        "inputs": ["microdata", "weights", "strata and PSU identifiers"],
                        "reason": "Requires household-survey microdata, which the warehouse does not hold (it contains published aggregates). Not implemented."},
}


class Declined(ValueError):
    def __init__(self, reasons: list[str], suggestions: list[str] | None = None):
        super().__init__("; ".join(reasons))
        self.reasons, self.suggestions = reasons, suggestions or []


def _f(x):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else float(x)


# ------------------------------------------------------------------------------------------------ descriptive
def describe(df: pd.DataFrame, variables: list[str]) -> dict:
    rows = []
    for v in variables:
        s = df[v].dropna()
        rows.append({"variable": v, "n": int(s.size), "units": int(df.loc[s.index, "unit"].nunique()) if s.size else 0,
                     "mean": _f(s.mean()) if s.size else None, "sd": _f(s.std(ddof=1)) if s.size > 1 else None,
                     "min": _f(s.min()) if s.size else None, "p25": _f(s.quantile(.25)) if s.size else None,
                     "median": _f(s.median()) if s.size else None, "p75": _f(s.quantile(.75)) if s.size else None,
                     "max": _f(s.max()) if s.size else None})
    return {"method": "describe", "table": rows, "note": "Each variable uses all its observed values (n differs by variable); sd uses n−1."}


def correlation(df: pd.DataFrame, variables: list[str]) -> dict:
    if len(variables) < 2:
        raise Declined(["A correlation needs at least two variables."])
    cc = df.dropna(subset=variables)
    if len(cc) < 10:
        raise Declined([f"Only {len(cc)} observations have all variables; at least 10 are needed."])
    pairs = []
    for i, a in enumerate(variables):
        for b in variables[i + 1:]:
            r, p = stats.pearsonr(cc[a], cc[b])
            pairs.append({"a": a, "b": b, "r": _f(r), "p_value": _f(p), "n": int(len(cc))})
    return {"method": "correlation", "n": int(len(cc)), "units": int(cc.unit.nunique()), "pairs": pairs,
            "matrix": {"variables": variables, "values": cc[variables].corr().round(6).values.tolist()},
            "note": "Pearson correlations on complete cases. Observations from the same country over time are not independent, so the p-values overstate precision; correlation does not imply causation."}


def trends(df: pd.DataFrame, variable: str) -> dict:
    """Per-unit summary of a series over the selected years (first/last observed, change, average annual growth)."""
    out = []
    for u, g in df.dropna(subset=[variable]).groupby("unit"):
        g = g.sort_values("year")
        first, last = g.iloc[0], g.iloc[-1]
        yrs = int(last.year - first.year)
        cagr = ((last[variable] / first[variable]) ** (1 / yrs) - 1) if yrs > 0 and first[variable] > 0 and last[variable] > 0 else None
        out.append({"unit": u, "country": first.country, "n": int(len(g)), "first_year": int(first.year), "first": _f(first[variable]),
                    "last_year": int(last.year), "last": _f(last[variable]), "change": _f(last[variable] - first[variable]),
                    "avg_annual_growth_pct": _f(cagr * 100) if cagr is not None else None, "mean": _f(g[variable].mean()),
                    "series": [[int(y), _f(x)] for y, x in zip(g.year, g[variable])]})
    missing = sorted(set(df.unit) - {o["unit"] for o in out})
    return {"method": "trends", "variable": variable, "units": out, "units_without_data": missing,
            "note": "Average annual growth is the compound rate between the first and last observed years (only for positive values); gaps inside the period are not filled."}


# ------------------------------------------------------------------------------------------------ diagnostics
def panel_diagnostics(df: pd.DataFrame, variables: list[str]) -> dict:
    cc = df.dropna(subset=variables)
    per = cc.groupby("unit").size()
    gaps = int(sum(((g.year.diff() > 1).sum()) for _, g in cc.groupby("unit")))
    decomp = []
    for v in variables:
        s = cc[v]
        within = s - cc.groupby("unit")[v].transform("mean")
        between = cc.groupby("unit")[v].mean()
        decomp.append({"variable": v, "overall_sd": _f(s.std(ddof=1)) if len(s) > 1 else None,
                       "between_sd": _f(between.std(ddof=1)) if len(between) > 1 else None,
                       "within_sd": _f(within.std(ddof=1)) if len(s) > 1 else None})
    miss = [{"unit": u, "country": g.country.iloc[0], "rows": int(len(g)),
             **{v: int(g[v].notna().sum()) for v in variables}, "complete": int(g[variables].notna().all(axis=1).sum())}
            for u, g in df.groupby("unit")]
    return {"units": int(cc.unit.nunique()), "years": int(cc.year.nunique()), "observations": int(len(cc)),
            "obs_per_unit": {"min": int(per.min()) if len(per) else 0, "median": _f(per.median()) if len(per) else None, "max": int(per.max()) if len(per) else 0},
            "balanced": bool(len(per) and per.min() == per.max() == cc.year.nunique()), "singletons": int((per == 1).sum()),
            "internal_gaps": gaps, "variance_decomposition": decomp, "missingness_by_unit": miss,
            "requested_rows": int(len(df)), "dropped_incomplete_rows": int(len(df) - len(cc))}


def vif(X: pd.DataFrame) -> list[dict]:
    if X.shape[1] < 2:
        return []
    out = []
    for c in X.columns:
        others = sm.add_constant(X.drop(columns=c), has_constant="add")
        r2 = sm.OLS(X[c], others).fit().rsquared
        out.append({"variable": c, "vif": _f(1 / (1 - r2)) if r2 < 1 else None})
    return out


# ------------------------------------------------------------------------------------------------ estimation
ABSORBED_TOL = 1e-9          # residual norm / centred norm below this: variable fully absorbed by the effects
COLLINEAR_TOL = 1e-8         # 1 − R² of a regressor on the others (after effects) below this: not identified (VIF > 1e8)
VIF_WARN = 10


def effects_design(cc: pd.DataFrame, method: str, entity_effects: bool, time_effects: bool) -> np.ndarray:
    """Dummy matrix of everything the model partials out: a constant (OLS) or unit and/or year indicators (FE)."""
    if method != "panel_fe":
        return np.ones((len(cc), 1))
    cols = []
    if entity_effects:
        cols.append(pd.get_dummies(cc.unit).to_numpy(float))
    if time_effects:
        cols.append(pd.get_dummies(cc.year).to_numpy(float))
    return np.column_stack(cols)


def residualise(A: np.ndarray, D: np.ndarray) -> np.ndarray:
    """Exact orthogonal projection residual of A on the column space of D (least squares; valid for unbalanced panels
    and rank-deficient D). Unlike sequential one-way demeaning, this is the correct two-way transformation."""
    return A - D @ np.linalg.lstsq(D, A, rcond=None)[0]


def identification(cc: pd.DataFrame, y: str, X: list[str], method: str, entity_effects=False, time_effects=False) -> dict:
    """Check that every coefficient is identified after removing the model's effects.

    Returns problems (reasons to decline, each naming the variables involved), within-transformation VIFs and the
    condition number. No variable is ever dropped automatically."""
    D = effects_design(cc, method, entity_effects, time_effects)
    Xm = cc[X].to_numpy(float)
    Xr = residualise(Xm, D)
    yr = residualise(cc[[y]].to_numpy(float), D)[:, 0]
    problems, absorbed = [], []
    eff = "the fixed effects" if method == "panel_fe" else "the constant"
    cy = cc[y].to_numpy(float)
    if np.linalg.norm(yr) <= ABSORBED_TOL * max(np.linalg.norm(cy - cy.mean()), 1e-300):
        problems.append(f"The dependent variable '{y}' is fully explained by {eff}; there is no remaining variation to relate to the regressors.")
    for j, v in enumerate(X):
        scale = np.linalg.norm(Xm[:, j] - Xm[:, j].mean())
        if scale == 0 or np.linalg.norm(Xr[:, j]) <= ABSORBED_TOL * scale:
            absorbed.append(v)
            if method != "panel_fe":
                why = "is constant"
            elif entity_effects and (cc.groupby("unit")[v].nunique() <= 1).all():
                why = "does not vary over time within any unit, so the unit fixed effects absorb it"
            elif time_effects and (cc.groupby("year")[v].nunique() <= 1).all():
                why = "takes the same value for every unit in each year, so the year fixed effects absorb it"
            else:
                why = "is an exact combination of unit and year effects in this (unbalanced) sample"
            problems.append(f"'{v}' {why}; its coefficient is not identified. Remove it or change the effects.")
    keep = [j for j, v in enumerate(X) if v not in absorbed]
    vifs, cond = [], None
    if len(keep) >= 1:
        Z = Xr[:, keep]
        sd = Z.std(axis=0)
        Zs = Z / np.where(sd > 0, sd, 1)
        s = np.linalg.svd(Zs, compute_uv=False)
        cond = _f(s[0] / s[-1]) if s[-1] > 0 else None
        collinear = []
        for a, j in enumerate(keep):
            others = np.delete(Z, a, axis=1)
            if others.shape[1] == 0:
                vifs.append({"variable": X[j], "vif": 1.0})
                continue
            e = residualise(Z[:, [a]], others)[:, 0]
            one_minus_r2 = float(e @ e) / float(Z[:, a] @ Z[:, a])
            vifs.append({"variable": X[j], "vif": _f(1 / one_minus_r2) if one_minus_r2 > 0 else None})
            if one_minus_r2 < COLLINEAR_TOL:
                collinear.append(X[j])
        if collinear:
            problems.append(f"{', '.join(repr(c) for c in collinear)} are perfectly or numerically collinear after removing {eff} "
                            f"(each is explained by the others with R² > {1 - COLLINEAR_TOL:.8f}); their coefficients cannot be separated. "
                            "Remove one of them.")
    return {"problems": problems, "vif": vifs, "condition_number": cond,
            "method_note": "Exact least-squares projection on the full effects design (valid for unbalanced panels)."}


def _validate(df: pd.DataFrame, y: str, X: list[str], method: str, se: str, entity_effects=False, time_effects=False):
    reasons, sugg = [], []
    if method not in METHODS:
        raise Declined([f"Unknown method '{method}'."])
    if METHODS[method]["status"] != "available":
        m = METHODS[method]
        raise Declined([f"{m['label']} is not available in this version: {m['reason']}"],
                       [f"Required inputs once implemented: {', '.join(m['inputs'])}."])
    if not X:
        reasons.append("Choose at least one regressor.")
    if len(X) > MAX_REGRESSORS:
        reasons.append(f"At most {MAX_REGRESSORS} regressors.")
    if y in X:
        reasons.append("The dependent variable cannot also be a regressor.")
    if len(set(X)) != len(X):
        reasons.append("A regressor is listed twice.")
    missing = [v for v in [y, *X] if v not in df.columns]
    if missing:
        reasons.append(f"Not in the dataset: {', '.join(missing)}.")
    if reasons:
        raise Declined(reasons)
    cc = df.dropna(subset=[y, *X]).copy()
    if method == "panel_fe" and entity_effects:   # singletons carry no within-unit information only under unit effects
        per = cc.groupby("unit").size()
        singles = per[per == 1].index
        cc = cc[~cc.unit.isin(singles)]
    n, G = len(cc), cc.unit.nunique()
    k = len(X) + (1 if method == "ols" else 0)
    absorbed = (G if entity_effects else 0) + ((cc.year.nunique() - 1) if time_effects else 0)
    if n < MIN_N:
        reasons.append(f"Only {n} complete observations; at least {MIN_N} are required.")
        sugg.append("Add countries or years, or drop a regressor with many missing values (see the missingness report).")
    elif n - k - absorbed < MIN_DF_RESID:
        reasons.append(f"Too few residual degrees of freedom ({n - k - absorbed}; minimum {MIN_DF_RESID}) for {k} coefficients and {absorbed} absorbed effects.")
        sugg.append("Use fewer regressors or effects, or more data.")
    for v in [y, *X]:
        if n and cc[v].nunique() < 2:
            reasons.append(f"'{v}' is constant in the estimation sample.")
    if method == "panel_fe" and n and G < 2 and entity_effects:
        reasons.append("Unit fixed effects need at least two units.")
    if n and not reasons:
        reasons += identification(cc, y, X, method, entity_effects, time_effects)["problems"]
    if se == "cluster" and G < MIN_CLUSTERS:
        reasons.append(f"Cluster-robust standard errors are not computed with fewer than {MIN_CLUSTERS} clusters; this sample has {G} unit(s). With so few clusters the standard errors and confidence intervals are unreliable ({MIN_CLUSTERS} is a floor, not a guarantee).")
        sugg.append(f"Add countries (at least {MIN_CLUSTERS}; inference remains approximate below about {WARN_CLUSTERS}) or report descriptive comparisons instead.")
    if reasons:
        raise Declined(reasons, sugg)
    return cc


def _coef_table(names, params, ses, tvals, pvals, ci_lo, ci_hi):
    return [{"term": n, "coef": _f(b), "se": _f(s), "t": _f(t), "p_value": _f(p), "ci_low": _f(l), "ci_high": _f(h)}
            for n, b, s, t, p, l, h in zip(names, params, ses, tvals, pvals, ci_lo, ci_hi)]


def ols(df: pd.DataFrame, y: str, X: list[str], se: str = "hc1") -> dict:
    if se not in ("hc1", "cluster", "classical"):
        raise Declined(["Standard errors must be 'hc1', 'cluster' or 'classical'."])
    cc = _validate(df, y, X, "ols", se)
    res, cov_text = fit_ols(cc, y, X, se)
    return _ols_result(df, cc, y, X, se, res, cov_text)


def fit_ols(cc: pd.DataFrame, y: str, X: list[str], se: str):
    """Estimation step only (no sample-size rules); used by ols() after validation and by the reference tests."""
    exog = sm.add_constant(cc[X].astype(float), has_constant="add")
    model = sm.OLS(cc[y].astype(float), exog)
    if se == "cluster":
        codes = pd.factorize(cc.unit)[0]
        res = model.fit(cov_type="cluster", cov_kwds={"groups": codes}, use_t=True)
        cov_text = f"Cluster-robust by unit (CR1: G/(G−1)·(N−1)/(N−K)), t distribution with G−1 = {cc.unit.nunique() - 1} df"
    elif se == "hc1":
        res = model.fit(cov_type="HC1", use_t=True)
        cov_text = "Heteroskedasticity-robust (HC1), t distribution with N−K df"
    else:
        res = model.fit()
        cov_text = "Classical (homoskedastic), t distribution with N−K df"
    return res, cov_text


def fit_fe(cc: pd.DataFrame, y: str, X: list[str], entity_effects: bool, time_effects: bool, se: str):
    """Estimation step only for panel fixed effects (linearmodels PanelOLS, rank checked, nothing dropped)."""
    data = cc.set_index(["unit", "year"])
    mod = PanelOLS(data[y].astype(float), data[X].astype(float), entity_effects=entity_effects, time_effects=time_effects,
                   drop_absorbed=False, check_rank=True)
    try:
        if se == "cluster":
            res = mod.fit(cov_type="clustered", cluster_entity=True, debiased=True, group_debias=True)
        else:
            res = mod.fit(cov_type="robust", debiased=True)
    except Exception as e:  # second line of defence: the estimator's own rank/absorption checks
        raise Declined([f"The estimator reports that the model is not identified ({type(e).__name__}): one or more regressors are absorbed by the effects or collinear."]) from e
    if se == "cluster":
        d = (cc.year.nunique() - 1 + cc.unit.nunique()) if time_effects else 0
        cov_text = (f"Cluster-robust by unit, scaled by G/(G−1)·(N−1)/(N−d−K) with d = {d} absorbed effects counted "
                    f"({'two-way model' if time_effects else 'unit effects nested in clusters, as Stata xtreg, fe vce(cluster)'}); "
                    f"t distribution, {int(cc.unit.nunique())} clusters")
    else:
        cov_text = "Heteroskedasticity-robust (White) with small-sample correction"
    return res, cov_text


ASSUMPTIONS = {
    "ols": ["Linear relationship between the outcome and the regressors as specified (including any log transformation).",
            "Regressors uncorrelated with the error term (no omitted variables, reverse causality or measurement error). This is required for a causal reading and is not tested here.",
            "Observations independent across clusters (clustered errors) or across rows (HC1/classical)."],
    "panel_fe": ["Linear relationship as specified; coefficients are identified only from variation within units over time (and, with year effects, relative to the common year pattern).",
                 "Strict exogeneity: regressors uncorrelated with past, present and future shocks to the outcome. Not tested here; violated, for example, by feedback from the outcome to the regressors.",
                 "Time-invariant unit differences are removed by unit effects; time-varying omitted factors are not.",
                 "Errors independent across units (clustered errors) or across observations (robust errors)."],
}


def _ols_result(df, cc, y, X, se, res, cov_text):
    ci = res.conf_int(0.05)
    G = int(cc.unit.nunique())
    ident = identification(cc, y, X, "ols")
    warnings = _warnings(df, cc, y, X, se, G, int(len(res.params)), 0, ident)
    if se != "cluster" and cc.groupby("unit").size().max() > 1:
        warnings.append("Several observations per unit: HC1/classical errors assume independent observations; within-country correlation over time is likely, so standard errors may be too small.")
    return {"method": "ols", "spec": {"y": y, "X": X, "constant": True, "se": se, "cov_type": cov_text},
            "n": int(res.nobs), "units": G, "years": int(cc.year.nunique()), "k": int(len(res.params)), "df_resid": _f(res.df_resid),
            "r2": _f(res.rsquared), "adj_r2": _f(res.rsquared_adj),
            "coefficients": _coef_table(res.params.index, res.params, res.bse, res.tvalues, res.pvalues, ci[0], ci[1]),
            "vif": ident["vif"], "condition_number": ident["condition_number"], "fitted": _resid_sample(res.fittedvalues, res.resid),
            "sample": cc[["unit", "year"]].to_dict("list"), "sensitivity": _sensitivity(cc, y, X, "ols", se, False, False, res),
            "warnings": warnings, "assumptions": ASSUMPTIONS["ols"], "interpretation": NON_CAUSAL, "library": "statsmodels OLS"}


def panel_fe(df: pd.DataFrame, y: str, X: list[str], entity_effects: bool = True, time_effects: bool = False, se: str = "cluster") -> dict:
    if se not in ("cluster", "hc1"):
        raise Declined(["Standard errors must be 'cluster' (by unit) or 'hc1'."])
    if not entity_effects and not time_effects:
        raise Declined(["Choose unit effects, year effects or both (otherwise use OLS)."])
    cc = _validate(df, y, X, "panel_fe", se, entity_effects, time_effects)
    singles = int(df.dropna(subset=[y, *X]).groupby("unit").size().eq(1).sum()) if entity_effects else 0
    res, cov_text = fit_fe(cc, y, X, entity_effects, time_effects, se)
    ci = res.conf_int(0.95)
    G = int(cc.unit.nunique())
    absorbed = (G if entity_effects else 0) + ((cc.year.nunique() - 1) if time_effects else 0)
    ident = identification(cc, y, X, "panel_fe", entity_effects, time_effects)
    warnings = _warnings(df, cc, y, X, se, G, int(len(res.params)), absorbed, ident)
    if singles:
        warnings.append(f"{singles} unit(s) with a single complete observation were dropped (they carry no within-unit information).")
    if se == "hc1":
        warnings.append("Robust (non-clustered) errors ignore serial correlation within units; standard errors are likely too small.")
    effects = " + ".join([e for e, on in (("unit fixed effects", entity_effects), ("year fixed effects", time_effects)) if on])
    return {"method": "panel_fe", "spec": {"y": y, "X": X, "effects": effects, "entity_effects": entity_effects, "time_effects": time_effects,
                                            "se": se, "cov_type": cov_text, "constant": "absorbed by fixed effects"},
            "n": int(res.nobs), "units": G, "years": int(cc.year.nunique()), "k": int(len(res.params)), "df_resid": _f(res.df_resid),
            "singletons_dropped": singles,
            "r2_fe": _f(res.rsquared), "r2_within": _f(res.rsquared_within), "r2_overall": _f(res.rsquared_overall), "r2_between": _f(res.rsquared_between),
            "coefficients": _coef_table(res.params.index, res.params, res.std_errors, res.tstats, res.pvalues, ci["lower"], ci["upper"]),
            "vif": ident["vif"], "condition_number": ident["condition_number"],
            "fitted": _resid_sample(res.fitted_values.iloc[:, 0], res.resids),
            "sample": cc[["unit", "year"]].to_dict("list"),
            "sensitivity": _sensitivity(df.dropna(subset=[y, *X]), y, X, "panel_fe", se, entity_effects, time_effects, res),
            "warnings": warnings, "assumptions": ASSUMPTIONS["panel_fe"], "interpretation": NON_CAUSAL, "library": "linearmodels PanelOLS"}


def _sensitivity(sample, y, X, method, se, ee, te, res_main) -> dict:
    """Re-estimate under the alternative inference choice and (FE) the alternative set of effects, using the same
    estimators; flag sign changes and changes in 5% significance. No new estimator is introduced."""
    main_coef = np.asarray(res_main.params, float)
    main_p = np.asarray(res_main.pvalues, float)
    names = list(res_main.params.index)
    alts = []
    if method == "ols":
        alt_se = "cluster" if se != "cluster" else "hc1"
        alts.append(("clustered by unit standard errors" if alt_se == "cluster" else "HC1 robust standard errors", "ols", alt_se, False, False))
    else:
        alt_se = "hc1" if se == "cluster" else "cluster"
        alts.append(("HC1 robust (not clustered) standard errors" if alt_se == "hc1" else "clustered by unit standard errors", "panel_fe", alt_se, ee, te))
        if ee:
            alts.append(("without year effects" if te else "with year effects added", "panel_fe", se, ee, not te))
    rows, notes, flags = [], [], []
    for label, m, s, e1, t1 in alts:
        try:
            cc = _validate(sample, y, X, m, s, e1, t1)
            r, _ = fit_ols(cc, y, X, s) if m == "ols" else fit_fe(cc, y, X, e1, t1, s)
        except Declined as d:
            notes.append(f"Alternative '{label}' not estimable: {d.reasons[0]}")
            continue
        alt_names = list(r.params.index)
        c_alt, p_alt = np.asarray(r.params, float), np.asarray(r.pvalues, float)
        se_alt = np.asarray(r.bse if m == "ols" else r.std_errors, float)
        for i, term in enumerate(names):
            if term == "const":
                continue
            j = alt_names.index(term)
            sign = bool(np.sign(c_alt[j]) != np.sign(main_coef[i]))
            sig = bool((p_alt[j] < 0.05) != (main_p[i] < 0.05))
            rows.append({"alternative": label, "term": term, "coef": _f(c_alt[j]), "se": _f(se_alt[j]), "p_value": _f(p_alt[j]),
                         "n": int(r.nobs), "sign_change": sign, "significance_change": sig})
            if sign or sig:
                flags.append(f"{term}: {'sign changes' if sign else 'significance at 5% changes'} under the alternative '{label}'; the result is sensitive to this choice.")
    return {"rows": rows, "notes": notes, "flags": flags}


def _warnings(df, cc, y, X, se, G, k, absorbed, ident):
    w = []
    if se == "cluster":
        if G < 20:
            w.append(f"Only {G} clusters (fewer than 20): cluster-robust standard errors are biased downward and t-tests over-reject with few clusters; methods designed for few clusters (e.g. wild cluster bootstrap) are not implemented. Treat p-values and intervals as indicative only.")
        elif G < WARN_CLUSTERS:
            w.append(f"{G} clusters: cluster-robust inference is approximate. No cluster count guarantees reliable inference, particularly when clusters differ greatly in size.")
        sizes = cc.groupby("unit").size()
        if len(sizes) and sizes.max() > 3 * sizes.min():
            w.append(f"Cluster sizes vary from {int(sizes.min())} to {int(sizes.max())} observations, which weakens cluster-robust inference further.")
    per = cc.groupby("unit").size()
    if len(per) and per.min() != per.max():
        w.append(f"Unbalanced panel: {int(per.min())}–{int(per.max())} observations per unit. Units with more years weigh more; missingness may not be random.")
    req = int(df[y].notna().sum())
    if req and (req - len(cc)) / req > 0.3:
        w.append(f"{req - len(cc)} of {req} observations with the outcome observed ({(req - len(cc)) / req:.0%}) were not used (a regressor is missing or the unit is a singleton); results may not represent the full sample.")
    if len(cc) < 10 * (k + absorbed):
        w.append(f"Fewer than 10 observations per estimated parameter ({len(cc)} observations, {k} coefficients + {absorbed} absorbed effects): estimates are imprecise.")
    high = [v for v in ident["vif"] if v["vif"] and v["vif"] > VIF_WARN]
    if high:
        w.append("Near-collinearity: " + ", ".join(f"{v['variable']} (VIF {v['vif']:.1f})" for v in high)
                 + f": variance inflation above {VIF_WARN} after removing the model's effects; individual coefficients are imprecise and sensitive to specification.")
    return w


def _resid_sample(fitted, resid, cap=2000):
    f = np.asarray(fitted, float)[:cap]
    r = np.asarray(resid, float)[:cap]
    return [[_f(a), _f(b)] for a, b in zip(f, r)]


def estimate(df: pd.DataFrame, params: dict) -> dict:
    """Dispatch a validated estimation request. Unknown or unavailable methods are declined."""
    m = params.get("method")
    if m == "ols":
        return ols(df, params["y"], list(params.get("x", [])), params.get("se", "hc1"))
    if m == "panel_fe":
        return panel_fe(df, params["y"], list(params.get("x", [])), bool(params.get("entity_effects", True)),
                        bool(params.get("time_effects", False)), params.get("se", "cluster"))
    if m in METHODS:
        _validate(df, params.get("y", ""), list(params.get("x", [])), m, params.get("se", ""))
    raise Declined([f"Unknown method '{m}'."])
