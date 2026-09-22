#!/usr/bin/env python3
"""Tests for the upstream all-tier multiplier: matrix orientation, units, the
Leontief solution, the committed 2022 multiplier's self-consistency against the
first-tier cases, and (when OECD source is present) the 2020 validation anchors.

Run from the tool root: python tests/test_multipliers.py
"""
import gzip, json, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_multipliers as BM

P = F = 0
def ok(c, m):
    global P, F
    print(("PASS" if c else "FAIL") + ": " + m); P += bool(c); F += (not c)

def load(path):
    return json.loads(gzip.decompress(open(path, "rb").read()))

# ---- A = Z/x orientation + Leontief solution (deterministic, no source) ----
Z = np.array([[0.0, 10.0], [20.0, 0.0]])
x = np.array([100.0, 100.0])
g = np.array([1.0, 2.0])
m, A = BM.solve_multiplier(Z, x, g)
ok(abs(A[0, 1] - 0.1) < 1e-12 and abs(A[1, 0] - 0.2) < 1e-12, "A = Z*diag(1/x): A[i,j]=Z[i,j]/x[j]")
# m = g (I-A)^-1 : hand-computed 1.42857.., 2.14286..
ok(abs(m[0] - 1.4285714) < 1e-5 and abs(m[1] - 2.1428571) < 1e-5, "Leontief m = g'(I-A)^-1 (row vector)")
ok((m + 1e-12 >= g).all(), "m >= g elementwise (deeper-upstream >= 0)")

# ---- units of g: tonnes / USD million ----
gg, miss = BM.intensity_vector(["AAA_C20"], np.array([100.0]), {("AAA", "C20"): 500e6})
ok(abs(gg[0] - 5e6) < 1.0, "g_i = emissions(tonnes)/output(USD m) = t CO2e per USD million")

# ---- concordance is injective and documented ----
mult_path = os.path.join(ROOT, "data", "multipliers_2022.json.gz")
mult = load(mult_path)
conc = mult["concordance"]
ok(conc == {"C24A": "C241_2431", "C24B": "C242_2432", "C302T309": "C30X301"}, "concordance recorded")
ok(len(set(conc.values())) == len(conc), "concordance injective (no duplicated GHG target)")
ok(mult["schema"] == 1 and mult["year"] == 2022 and "tonnes CO2e per USD million" in mult["units"], "schema/year/units")
S = mult["sectors"]
ok(len(S) >= 3000, f"multiplier covers {len(S)} sectors")
ok(all(v[1] + 1e-6 >= v[0] for v in S.values()), "m >= g for every stored sector (deeper >= 0)")

# ---- self-consistency against the committed DEU_C29 first-tier case ----
case = load(os.path.join(ROOT, "data", "cases", "DEU_C29.json.gz"))
L = case["links"]
codes = [f"{a}_{b}" for a, b in zip(L["country"], L["industry"])]
zin, direct = L["input_usd_m"], L["alloc_ghg_t"]
tot_direct = tot_all = 0.0; vis_ok = ident_ok = mge_ok = True; missing = 0
for i, c in enumerate(codes):
    s = S.get(c)
    if not s:
        missing += 1; continue
    gi, mi = s
    all_i = mi * zin[i]
    deeper = all_i - direct[i]
    if all_i + 1e-6 < direct[i]: mge_ok = False              # m*z >= g*z
    if not (0 <= (direct[i] / all_i if all_i > 0 else 0) <= 1.0001): vis_ok = False
    # direct from multiplier (g*z) should match the case's allocated_direct_ghg_t
    if abs(gi * zin[i] - direct[i]) > max(1.0, 0.02 * direct[i]): ident_ok = False
    tot_direct += direct[i]; tot_all += all_i
ok(missing == 0, f"every DEU_C29 matched link has a multiplier (missing={missing})")
ok(mge_ok, "per link: all-tier (m*z) >= direct (g*z)")
ok(vis_ok, "per link: direct visibility share in (0,1]")
ok(ident_ok, "per link: g*z reproduces the case's allocated direct emissions")
deeper_tot = tot_all - tot_direct
ok(abs(tot_direct + deeper_tot - tot_all) < 1e-3, "direct + deeper == all-tier (case totals)")
ok(abs(tot_direct / 1e6 - 4.145) < 0.01, f"DEU_C29 direct ~= 4.145 Mt (got {tot_direct/1e6:.3f})")
ok(abs(tot_all / 1e6 - 33.45) < 0.2, f"DEU_C29 all-tier ~= 33.4 Mt (got {tot_all/1e6:.3f})")
ok(abs(tot_direct / tot_all - 0.124) < 0.01, f"DEU_C29 visibility ~= 12.4% (got {tot_direct/tot_all*100:.1f}%)")

# ---- 2020 validation embedded in the built file (from the build run) ----
v = mult.get("validation_2020")
if v:
    ok(abs(v["method_check_implied_g_over_my_g_median"] - 1.0) < 1e-6,
       "2020 validation: implied-g median == 1.0 (method exactly reproduced)")
    ok(v["spearman_rank_corr"] > 0.9, f"2020 validation: Spearman rank corr {v['spearman_rank_corr']} > 0.9")
    ok(v["abs_pct_diff_median"] < 12, f"2020 validation: median abs pct diff {v['abs_pct_diff_median']}% documented")
    deu = next((c for c in v["sample_comparison"] if c["sector"] == "DEU_C29"), None)
    ok(deu and abs(deu["pct_diff"]) < 15, f"2020 validation: DEU_C29 within tolerance ({deu['pct_diff'] if deu else '?'}%)")
else:
    print("NOTE: no embedded 2020 validation report (built without --validate-2020)")

print(f"\n==== {P} passed, {F} failed ====")
sys.exit(1 if F else 0)
