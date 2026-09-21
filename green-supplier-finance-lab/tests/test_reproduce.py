#!/usr/bin/env python3
"""Reproduce the published anchors directly from OECD source (the strongest check).

Skips cleanly when the source archives are not present. Point it at the source
with environment variables, or place the OECD folder at the default path:
  GSFL_ICIO_ZIP  -> .../ICIO/2025/Regular/2016-2022_SML.zip
  GSFL_GHG_ZIP   -> .../GHG Datasets/MAIN_csv.zip

Run: python tests/test_reproduce.py
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import build_cases as B

ICIO = os.environ.get("GSFL_ICIO_ZIP")
GHG = os.environ.get("GSFL_GHG_ZIP")

if not (ICIO and GHG and os.path.exists(ICIO) and os.path.exists(GHG)):
    print("SKIP: OECD source not available (set GSFL_ICIO_ZIP and GSFL_GHG_ZIP to run).")
    sys.exit(0)

ANCHORS = {
    "DEU_C29": dict(matched=3419, excluded=279, cov=0.8682, ghg=4144978.8, va=25236.7),
    "FRA_C29": dict(matched=3249, excluded=276, cov=0.8902, ghg=1098316.9, va=7351.06),
}

icio_bytes = B.read_member(ICIO, "2022_SML.csv")
ghg_bytes = B.read_member(GHG, "DF_MAIN.csv")
ghg = B.load_ghg(ghg_bytes)
header, meta = B.load_supplier_meta(icio_bytes, ghg)
cases = B.build_chunk(icio_bytes, header, meta, list(ANCHORS))

P = F = 0
def ok(c, m):
    global P, F
    print(("PASS" if c else "FAIL") + ": " + m); P += bool(c); F += (not c)

for code, a in ANCHORS.items():
    t = cases[code]["totals"]
    ok(t["matched_link_count"] == a["matched"], f"{code} matched == {a['matched']} (got {t['matched_link_count']})")
    ok(t["excluded_link_count"] == a["excluded"], f"{code} excluded == {a['excluded']} (got {t['excluded_link_count']})")
    ok(abs(t["input_value_share"] - a["cov"]) < 5e-4, f"{code} coverage ~= {a['cov']*100:.1f}% (got {t['input_value_share']*100:.2f}%)")
    ok(abs(t["allocated_ghg_t"] - a["ghg"]) < 5, f"{code} allocated GHG matches (got {t['allocated_ghg_t']:.1f})")
    ok(abs(t["allocated_va_usd_m"] - a["va"]) < 0.5, f"{code} allocated VA matches (got {t['allocated_va_usd_m']:.1f})")

print(f"\n==== {P} passed, {F} failed ====")
sys.exit(1 if F else 0)
