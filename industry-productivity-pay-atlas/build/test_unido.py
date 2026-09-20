#!/usr/bin/env python3
"""Tests for the UNIDO INDSTAT Rev.4 plane: JSON structure/units/missing-vs-zero,
manufacturing key count, India coverage, and raw-row anchor spot-checks recomputed
from the source data.csv. Usage: python test_unido.py <data.csv> <atlas_unido.json>"""
import csv, json, sys, re, collections
data_csv, jpath = sys.argv[1], sys.argv[2]
csv.field_size_limit(10**7)
J = json.load(open(jpath, encoding="utf-8"))
P = F = 0
def ok(c, m):
    global P, F
    print(("PASS" if c else "FAIL")+": "+m);
    P += bool(c); F += (not c)

series = J["series"]; ccset = {c["code"] for c in J["countries"]}
# structure & units
ok(len(series) > 0 and len(J["countries"]) >= 50, "has countries and series")
ok("356" in ccset, "India (356) present")
# missing-vs-zero: shares/levels are None or strictly positive, never 0 as a stand-in
allws = [v for s in series for v in s["wage_share"]]
allve = [v for s in series for v in s["va_per_emp_usd"]]
ok(all(v is None or v > 0 for v in allws), "wage_share is null or >0 (never zero-as-missing)")
ok(all(v is None or v > 0 for v in allve), "va_per_emp is null or >0")
ok(all(v is None or 0 < v <= 1.5 for v in allws), "wage_share ratios in (0,1.5] after suppressing degenerate VA")
# year arrays contiguous & aligned
ok(all(s["year"] == list(range(s["year"][0], s["year"][-1]+1)) for s in series), "year axes contiguous (gaps carried as null)")
ok(all(len(s["year"]) == len(s["wage_share"]) == len(s["va_per_emp_usd"]) for s in series), "arrays aligned")
# at least one interior null (gap shown as missing, not zero)
ok(any(None in s["wage_share"] for s in series), "gaps present and carried as null")

# recompute manufacturing all-3 key count + India anchors from raw
MFG = {str(d) for d in range(10, 34)}; NEED = {"04","05","20"}
cell = collections.defaultdict(dict); vausd = {}
with open(data_csv, encoding="utf-8", newline="") as f:
    r = csv.reader(f); next(r)
    for row in r:
        if row[4] in NEED and row[7] in MFG:
            k = (row[2], row[7], int(row[0]))
            try: cell[k][row[4]] = float(row[10])
            except ValueError: cell[k][row[4]] = None
            if row[4] == "20":
                try: vausd[k] = float(row[12])
                except (ValueError, IndexError): vausd[k] = None
keys = [k for k,v in cell.items() if NEED <= set(v)]
ok(len(keys) == 26584, f"manufacturing all-3 key count == 26584 (got {len(keys)})")

def jval(cc, act, yr, field):
    s = next((x for x in series if x["country"]==cc and x["activity"]==act), None)
    if not s or yr not in s["year"]: return "NA"
    return s[field][s["year"].index(yr)]
checks = 0
for (cc, act, yr), v in cell.items():
    if cc == "356" and NEED <= set(v) and (v["20"] or 0) > 0 and checks < 3:
        exp = round(v["05"]/v["20"], 6); got = jval("356", act, yr, "wage_share")
        ok(got is not None and abs(got-exp) < 1e-6, f"India anchor wage_share {act}/{yr} = {exp} matches JSON")
        checks += 1
print(f"\n==== {P} passed, {F} failed ====")
sys.exit(1 if F else 0)
