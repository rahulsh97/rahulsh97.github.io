#!/usr/bin/env python3
"""Reproducible STREAMING build of the UNIDO INDSTAT Rev.4 plane for the Atlas.

Reads the large INDSTAT Rev.4 `data.csv` (not redistributed) line by line and
writes a compact derived JSON: for each country x manufacturing 2-digit ISIC
industry x year, the wages-and-salaries share of value added (local currency,
within-year ratio) and nominal value added per employee (current USD).

Variables (consolidated): 04 Employees, 05 Wages and salaries, 20 Value added.
Value-added VALUATION differs by country (basic/factor/producer/undefined,
UnconsolidatedVariableCode 17/18/19/20); the wages/VA ratio is within-country-year
so currency and valuation cancel, but LEVELS are not comparable across countries.
Monetary quantities are NOMINAL: never call VA/employee real productivity.

Usage: python build_unido.py <data.csv> <out.json>
Source: UNIDO INDSTAT 2024, ISIC Rev.4 (stat.unido.org). Attribute UNIDO (CC BY 4.0).
"""
import csv, json, sys, collections, re, hashlib, datetime, os
data_csv = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else "data/atlas_unido.json"
csv.field_size_limit(10**7)
MFG = {str(d) for d in range(10, 34)}                 # ISIC Rev.4 manufacturing divisions 10-33
NEED = {"04", "05", "20"}

# sha256 of the raw data.csv (recorded in manifest; raw file itself not committed)
h = hashlib.sha256()
with open(data_csv, "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
sha = h.hexdigest()

cell = collections.defaultdict(dict)                 # (cc,act,yr)->{var:lcu}
va_usd = {}; va_val = {}; cname = {}; aname = {}; curr = {}
mfg_keys = 0
with open(data_csv, encoding="utf-8", newline="") as f:
    r = csv.reader(f); next(r)
    for row in r:
        vc, act = row[4], row[7]
        if vc not in NEED or act not in MFG: continue
        cc, yr = row[2], int(row[0])
        try: val = float(row[10])
        except ValueError: val = None
        k = (cc, act, yr)
        cell[k][vc] = val
        cname[cc] = row[1]; aname[act] = row[8]
        if vc == "20":
            va_val[(cc, act)] = row[5]               # valuation code (per country-industry)
            curr[cc] = row[11]
            try: va_usd[k] = float(row[12])
            except (ValueError, IndexError): va_usd[k] = None

# assemble series with gaps as nulls (never zero)
by_series = collections.defaultdict(dict)            # (cc,act)->{yr:{...}}
for (cc, act, yr), v in cell.items():
    if NEED <= set(v):
        by_series[(cc, act)][yr] = v
    if act in MFG and NEED <= set(v):
        mfg_keys += 1

series = []
countries = {}; activities = {}
for (cc, act), yrs in by_series.items():
    y0, y1 = min(yrs), max(yrs)
    Y, WS, VE = [], [], []
    for y in range(y0, y1 + 1):
        Y.append(y)
        v = yrs.get(y)
        # wage share: need VA>0 and wages>0; suppress economically degenerate
        # ratios (>1.5 => value added near-zero/loss year) as missing, not zero.
        if v and (v.get("20") or 0) > 0 and (v.get("05") or 0) > 0:
            ws = v["05"] / v["20"]
            WS.append(round(ws, 6) if 0 < ws <= 1.5 else None)
        else:
            WS.append(None)
        # VA per employee: need positive USD value added and positive employment
        # (negative VA = loss year is not "productivity"); else missing.
        vu = va_usd.get((cc, act, y)); emp = (v or {}).get("04")
        VE.append(round(vu / emp, 3) if (vu and vu > 0 and emp and emp > 0) else None)
    if any(w is not None for w in WS) or any(e is not None for e in VE):
        series.append({"country": cc, "activity": act, "year": Y,
                       "wage_share": WS, "va_per_emp_usd": VE,
                       "va_val": va_val.get((cc, act), "")})
        countries[cc] = cname[cc]; activities[act] = aname[act]

VALN = {"17": "basic prices", "18": "factor values", "19": "producers' prices", "20": "valuation not defined"}
meta = {
    "title": "Industry Productivity & Pay Atlas — UNIDO INDSTAT Rev.4 plane",
    "source": "UNIDO INDSTAT 2024, ISIC Revision 4 (stat.unido.org)",
    "source_url": "https://stat.unido.org/database/INDSTAT%204%202024%2C%20ISIC%20Revision%204",
    "terms_url": "https://stat.unido.org/terms-and-conditions",
    "download_date": "2026-09-20",
    "data_csv_sha256": sha,
    "variables": "04 Employees, 05 Wages and salaries, 20 Value added (consolidated).",
    "measures": {
        "wage_share": "Wages & salaries (05) / Value added (20), local currency, within-year ratio.",
        "va_per_emp_usd": "Value added (20) per employee (04), current USD — NOMINAL, not real productivity."
    },
    "valuation_note": ("Value-added valuation differs by country (UnconsolidatedVariableCode: "
                       "17 basic, 18 factor, 19 producer, 20 undefined). The wages/VA ratio cancels "
                       "currency & valuation within a country-year; cross-country LEVELS are not comparable."),
    "valuation_labels": VALN,
    "nominal_note": "All monetary quantities are NOMINAL (current prices). VA/employee reflects prices, not real output per worker.",
    "suppression_note": "Degenerate loss/near-zero-VA observations are shown as missing (null), never zero: wages/VA is kept only when value added and wages are positive and the ratio is <=1.5; VA/employee only when value added (USD) is positive.",
    "separateness": "Separate plane from RBI KLEMS and OECD STAN — different labour concepts; do not pool or subtract levels.",
    "licence": "UNIDO INDSTAT, CC BY 4.0 (check dataset-specific exceptions at the terms URL). Attribute UNIDO.",
    "coverage": f"{len(countries)} countries, manufacturing ISIC Rev.4 divisions 10-33.",
    "generated": datetime.date.today().isoformat(),
}
obj = {"meta": meta,
       "countries": [{"code": c, "name": countries[c]} for c in sorted(countries)],
       "activities": [{"code": a, "name": activities[a]} for a in sorted(activities)],
       "series": series}
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(obj, open(out, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
print(f"Wrote {out}: {len(countries)} countries, {len(activities)} mfg industries, "
      f"{len(series)} country-industry series.")
print(f"Manufacturing (10-33) country-year-industry keys with all of 04/05/20: {mfg_keys}")
print(f"India in output: {'356' in countries} ; data.csv sha256 {sha[:16]}…")
