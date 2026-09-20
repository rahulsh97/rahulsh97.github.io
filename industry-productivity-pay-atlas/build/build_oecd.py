#!/usr/bin/env python3
"""Deterministic build of the OECD STAN global plane for the Atlas.

Reads a raw OECD STAN (DSD_STAN@DF_STAN_2025) CSV extract and writes a compact
JSON: employee-compensation share and wages-and-salaries share of value added
(current prices, national currency), by country x manufacturing group x year.

This is a SEPARATE measurement plane from RBI KLEMS:
  - OECD D1 = compensation of EMPLOYEES only (excludes the self-employed);
  - RBI KLEMS labour income is broad (includes imputed self-employed labour).
Do not subtract or pool the two. Shares are unitless (D1/B1G, D11/B1G at current
prices), so currency/units cancel; levels are not shipped.

Source: OECD STAN Database for Structural Analysis, 2025 edition
  https://sdmx.oecd.org/public/rest/data/OECD.STI.PIE,DSD_STAN@DF_STAN_2025,1.0/...
Usage: python build_oecd.py <raw_stan.csv> <out.json>
"""
import csv, json, sys, collections, datetime, gzip, io

raw = sys.argv[1] if len(sys.argv) > 1 else "build/stan_extract.csv.gz"
out = sys.argv[2] if len(sys.argv) > 2 else "data/atlas_oecd.json"

fh = (io.TextIOWrapper(gzip.open(raw, "rb"), encoding="utf-8")
      if raw.endswith(".gz") else open(raw, encoding="utf-8"))
rows = list(csv.DictReader(fh))
cty_name, act_name = {}, {}
# key: (country, activity, year) -> measure -> value
cell = collections.defaultdict(dict)
for r in rows:
    m = r["MEASURE"]; pb = r["PRICE_BASE"]
    # value added: current prices only; flows D1/D11/EMP take as reported
    if m == "B1G" and pb != "V":
        continue
    try:
        v = float(r["OBS_VALUE"])
    except (ValueError, KeyError):
        continue
    c, a, y = r["REF_AREA"], r["ACTIVITY"], r["TIME_PERIOD"]
    cty_name[c] = r["Reference area"]; act_name[a] = r["Economic activity"]
    cell[(c, a, y)][m] = v

countries = sorted(cty_name)
activities = sorted(act_name)
years = sorted({k[2] for k in cell})

series = []
for c in countries:
    for a in activities:
        rec = {"country": c, "activity": a, "year": [], "comp_share": [], "wage_share": []}
        for y in years:
            d = cell.get((c, a, y))
            if not d:
                continue
            va = d.get("B1G")
            if va is None or va <= 0:
                # A labour "share" of zero/negative value added is undefined
                # (e.g. coke & refined petroleum, C19, in loss years). Suppress
                # it as no-observation rather than plotting a nonsense ratio.
                continue
            comp = d.get("D1"); wage = d.get("D11")
            rec["year"].append(int(y[:4]))
            rec["comp_share"].append(round(comp / va, 6) if comp is not None else None)
            rec["wage_share"].append(round(wage / va, 6) if wage is not None else None)
        if rec["year"]:
            series.append(rec)

meta = {
    "title": "Industry Productivity & Pay Atlas — OECD STAN global plane",
    "source": "OECD STAN Database for Structural Analysis, 2025 edition (DSD_STAN@DF_STAN_2025, v1.0)",
    "source_url": "https://sdmx.oecd.org/public/rest/data/OECD.STI.PIE,DSD_STAN@DF_STAN_2025,1.0/",
    "measures": {
        "comp_share": "Compensation of employees (D1) / Value added (B1G), current prices",
        "wage_share": "Wages and salaries (D11) / Value added (B1G), current prices",
    },
    "coverage_note": "OECD countries only (no India). Employee compensation EXCLUDES the self-employed.",
    "separateness": "Distinct plane from RBI KLEMS broad labour-income share; do not subtract/pool levels.",
    "prices": "Shares of current-price value added (national currency); unitless ratios.",
    "licence": "OECD terms of use (https://www.oecd.org/termsandconditions/); attribute OECD STAN 2025.",
    "generated": datetime.date.today().isoformat(),
}
obj = {"meta": meta,
       "countries": [{"code": c, "name": cty_name[c]} for c in countries],
       "activities": [{"code": a, "name": act_name[a]} for a in activities],
       "years": [int(y[:4]) for y in years],
       "series": series}
json.dump(obj, open(out, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
print(f"Wrote {out}: {len(countries)} countries, {len(activities)} activities, "
      f"{len(series)} country-activity series, years {years[0]}-{years[-1]}")
