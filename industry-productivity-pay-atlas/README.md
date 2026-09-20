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

**One release per source — no vintage splicing.** The KLEMS workbook `Info` sheet self-labels "database 2023"; the file is the July 2024 release covering to 2022-23 (confirmed against the RBI 2024 manual/press release).

### Definitions (visible in-app at the point of comparison)
- **RBI labour income** = compensation of employees **+ imputed labour part of self-employed mixed income** (Heckman-corrected Mincer). It is **broad**, and is **not** ASI wages paid to formal workers. Do not compare its level to ASI/Kapoor formal wage-share figures.
- **`LSH_va × LP`** = labour income per worker in **constant 2011-12 value-added prices** — *not* a consumption-deflated wage.
- **OECD `D1`** = compensation of **employees only** (excludes self-employed) — a different labour concept; never subtracted from or pooled with the RBI plane.

### UNIDO INDSTAT — attempted, not shipped
UNIDO INDSTAT Rev.4 (industrial wages-and-salaries share) was the intended first global route. `stat.unido.org` returned **HTTP 403** to scripted access and bulk download requires registration; access controls were **not** bypassed. It can be added later as a third, separate plane from a user-supplied CC BY 4.0 extract.

## Reproducible offline build
```
# 1. India core (needs the RBI workbook locally; not redistributed here)
Rscript build/build_atlas.R  /path/to/INDIAKLEMS08072024.xlsx      # -> data/atlas_klems.json

# 2. Global plane (OECD STAN, open SDMX) — pinned raw extract committed as .gz
python build/build_oecd.py  build/stan_extract.csv.gz  data/atlas_oecd.json

# 3. Tests
Rscript build/test_atlas.R   /path/to/INDIAKLEMS08072024.xlsx
```
`build/stan_extract.csv` was fetched from the OECD SDMX REST API (URL in `build/build_oecd.py`).

## Tests (all pass)
Decomposition identity (within+composition = ΔS to 1e-12), three independently recalculated anchors (2011-12 share, 2022-23 share, within-industry pp), units/ranges, missing-vs-zero, selected-industry contribution sums, raw-workbook spot-checks (LP/LSH_va/VA_r cells), and OECD structure/plausibility.

## Limitations
- Descriptive **accounting**, not causal identification.
- RBI labour income includes **imputed** self-employed labour; the recovery is of the *broad* share and may partly reflect imputation.
- Planes use different labour concepts and countries; **no crosswalk, no pooling, no level subtraction.**
- OECD petroleum-refining (C19) shares are **suppressed** in loss years (negative value added) — shown as no-observation, not plotted as negative.
- OECD covers OECD economies only (no India).

## Files
`index.html`, `styles.css`, `app.js`, `data/atlas_klems.json`, `data/atlas_oecd.json`, `build/` (scripts + tests + raw OECD extract), `README.md`.
