# Industry Productivity & Pay Atlas

A small, reproducible research tool: **when industry productivity changes, how much of value added reaches labour — and how much of an aggregate change is *within* industries versus *between* them?**

Static HTML/CSS/JS, no framework. Two measurement planes, kept strictly separate:

- **India core — RBI India KLEMS** (broad labour-income share of value added, 27 industries, 1980-81→2022-23; manufacturing = 13).
- **Global plane — OECD STAN** (employee-compensation share of value added, 8 countries × manufacturing groups, current prices).

## The question the data answers
Within Indian manufacturing, labour's **broad** share of value added fell through the 2000s to a trough around 2008-11 and has **recovered since ~2011-12** (≈29.3% in 2011-12 → ≈32.6% in 2022-23). A symmetric shift-share shows this rise is **almost entirely within-industry** (≈ +3.37 pp) rather than composition (≈ −0.11 pp). This is **descriptive accounting, not a causal explanation.**

## Data & vintages (pinned)
| Plane | Source | Vintage | Coverage | Prices | Licence |
|---|---|---|---|---|---|
| India | RBI India KLEMS | **Release Jul 2024**, `INDIAKLEMS08072024.xlsx` (sha256 `acccbe7a…`) | 27 industries, 1980-81→2022-23; mfg = 13 (SL 3-15) | constant 2011-12 (real); shares are within-year ratios | Cite RBI KLEMS; derived aggregates only, raw workbook not redistributed |
| Global | OECD STAN 2025 (`DSD_STAN@DF_STAN_2025`) | 2025 edition | DEU, ESP, FRA, ITA, JPN, KOR, POL, USA; ISIC Rev.4 mfg groups | current-price shares | OECD terms of use; attribute OECD STAN |
| Global | UNIDO INDSTAT 2024, ISIC Rev.4 | downloaded 2026-09-20 (`data.csv` sha256 `635392f7…`) | 98 countries, mfg divisions 10–33, 1991–2023 (incl. **India**) | nominal (current); wages/VA is a within-year ratio | UNIDO INDSTAT, **CC BY 4.0** (check dataset exceptions at terms URL); attribute UNIDO |

**One release per source — no vintage splicing.** The KLEMS workbook `Info` sheet self-labels "database 2023"; the file is the July 2024 release covering to 2022-23 (confirmed against the RBI 2024 manual/press release).

### Definitions (visible in-app at the point of comparison)
- **RBI labour income** = compensation of employees **+ imputed labour part of self-employed mixed income** (Heckman-corrected Mincer). It is **broad**, and is **not** ASI wages paid to formal workers. Do not compare its level to ASI/Kapoor formal wage-share figures.
- **`LSH_va × LP`** = labour income per worker in **constant 2011-12 value-added prices** — *not* a consumption-deflated wage.
- **OECD `D1`** = compensation of **employees only** (excludes self-employed) — a different labour concept; never subtracted from or pooled with the RBI plane.

### UNIDO INDSTAT Rev.4 — shipped (third, separate plane)
- **Question:** within a selected country and manufacturing industry over time, how do **wages & salaries ÷ value added** and **value added per employee** move? Supports an **India** selection (356; 15 years 2008–2022, all rows validated).
- Built by streaming the 189 MB `data.csv` (not redistributed). Variables **04 Employees, 05 Wages & salaries, 20 Value added**. `wages/VA` is a within-country-year local-currency ratio (currency & valuation cancel); `VA/employee` is **current US$, NOMINAL** — never labelled real productivity.
- **Value-added valuation differs by country** (basic/factor/producer/undefined); surfaced per selection. Levels are not comparable across countries; the ratio is.
- Degenerate loss/near-zero-VA observations are **suppressed as missing** (wages/VA kept only if VA>0, wages>0, ratio ≤1.5; VA/employee only if USD VA>0).

### Supplied UNIDO archive — inventory (10 nested datasets)
Used: **`revision 4.zip`** (INDSTAT ISIC Rev.4) → the plane above. **Not used** (documented, not built into generic tabs): `INDSTAT revision 3.zip`, `IDSB Revision 3/4.zip` (trade by source/partner — *not* buyer–supplier identification), `Annual`/`Monthly Manufacturing Trade Database.zip`, `Competitive Industrial Performance Index.zip`, `Indices of Industrial Production.zip`, `National Accounts.zip`, `SDG 9.zip`. Each has `data.csv` + `variable.csv`/`unconsolidated_variable.csv` + `country.csv`/`activity.csv` (+ metadata for some). They answer different questions and were left out deliberately.

## Reproducible offline build
```
# 1. India core (needs the RBI workbook locally; not redistributed here)
Rscript build/build_atlas.R  /path/to/INDIAKLEMS08072024.xlsx        # -> data/atlas_klems.json

# 2. OECD STAN plane (open SDMX; pinned raw extract committed as .gz)
python build/build_oecd.py   build/stan_extract.csv.gz  data/atlas_oecd.json

# 3. UNIDO INDSTAT Rev.4 plane (stream the raw data.csv; raw NOT redistributed)
python build/build_unido.py  /path/to/revision4/data.csv  data/atlas_unido.json

# 4. Tests
Rscript build/test_atlas.R   /path/to/INDIAKLEMS08072024.xlsx        # KLEMS + OECD (19)
python  build/test_unido.py  /path/to/revision4/data.csv  data/atlas_unido.json   # UNIDO (12)
```

## Tests (all pass: KLEMS/OECD 19, UNIDO 12)
Decomposition identity (within+composition = ΔS to 1e-12), three recalculated anchors (2011-12 share, 2022-23 share, within-industry pp), units/ranges, missing-vs-zero, contribution sums, no double-hyphen year labels, raw-workbook spot-checks (LP/LSH_va/VA_r); OECD structure/plausibility; UNIDO **26,584** manufacturing all-3 key count, India anchor rows recomputed from raw, gaps-as-null, units.

## Limitations
- Descriptive **accounting**, not causal identification.
- RBI labour income includes **imputed** self-employed labour; the recovery is of the *broad* share and may partly reflect imputation.
- Planes use different labour concepts and countries; **no crosswalk, no pooling, no level subtraction.**
- OECD petroleum-refining (C19) shares are **suppressed** in loss years (negative value added) — shown as no-observation, not plotted as negative.
- OECD covers OECD economies only (no India). UNIDO VA/employee is nominal current US$ (prices, not real output); UNIDO VA valuation differs by country.
- Three planes (RBI broad labour income; OECD employee compensation; UNIDO industrial wages) use **different labour concepts** — compare patterns within each, never pool or subtract levels. UNIDO IDSB trade files do **not** identify bilateral buyer–supplier relationships and are not used for that.

## Files
`index.html`, `styles.css`, `app.js`, `data/atlas_klems.json`, `data/atlas_oecd.json`, `data/atlas_unido.json`, `build/` (build scripts + tests + pinned OECD extract `stan_extract.csv.gz`), `README.md`. Raw RBI workbook and raw UNIDO `data.csv` are **not** committed.
