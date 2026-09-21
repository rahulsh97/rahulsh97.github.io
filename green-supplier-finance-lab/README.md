# Green Supplier Finance Lab

A multi-country, multi-industry [browser research preview](https://rahulsh97.github.io/green-supplier-finance-lab/).
Pick a **buyer economy** and **buyer industry**; the tool traces that industry's
first-tier **foreign** supplier sectors from published OECD accounts, allocates
supplier-sector production emissions and value added in proportion to the buyer's
purchases, and lets you test a hypothetical decarbonisation-financing scenario.

**Concept, research design and interpretation: Rahul Shukla. Engineering
assistance: OpenAI Codex and Anthropic Claude Code.** See [`NOTICE.md`](NOTICE.md)
and [`CITATION.cff`](CITATION.cff).

## Research question

When a buyer industry asks its suppliers to reduce emissions, **where might the
investment burden fall, and how would buyer financial support change that
burden?** The interface keeps three kinds of numbers visibly distinct and never
implies that supplier contracts, loans, firm emissions, upgrade costs, financial
distress or causal effects are observed:

1. **Published account** — OECD intermediate-input purchases, gross output, value
   added and production-based emissions by sector, 2022.
2. **Modelled allocation** — supplier-sector emissions and value added scaled by
   the buyer's share of that sector's gross output (first-tier, proportional).
3. **Assumed financing** — a user-set reduction target, cost per tonne and
   buyer-funded share.

## Coverage

**3,926 buyer cases** across **81 economies × 50 industries** (2022). Every buyer
economy × industry with at least one usable matched foreign supplier link is
published; buyers with zero matched foreign links (124, e.g. households `T`) are
listed under `omitted` in the manifest, never silently dropped.

## Sources (2022, matched vintages)

- **OECD ICIO 2025 Regular**, 2022 table — `ICIO/2025/Regular/2016-2022_SML.zip → 2022_SML.csv`.
  Intermediate inputs, gross output, value added.
  <https://www.oecd.org/en/data/datasets/inter-country-input-output-tables.html>
- **OECD GHG Footprints MAIN** — `GHG Datasets/MAIN_csv.zip → DF_MAIN.csv`,
  measure `PROD_GHG`, year **2022**. (The older `DF_MAIN_csv.zip` ends in 2020
  and is **not** used.)
  <https://www.oecd.org/en/data/datasets/greenhouse-gas-footprint-indicators.html>
- **Official labels** — OECD ICIO 2025 `ReadMe_ICIO_small.xlsx` (country and
  sector names, ISIC Rev.4). No sector description is invented.

Source ZIP and CSV **SHA-256** checksums are recorded in `data/manifest.json`.
The raw OECD archives are **not** committed; OECD remains the source of, and
rights-holder in, the underlying accounts.

## Method

For a foreign supplier sector *i* and buyer sector *b* in 2022, with intermediate
purchases `Zᵢᵦ`, supplier gross output `Xᵢ`, producer direct emissions `Eᵢ`
(tonnes CO₂e) and supplier value added `VAᵢ`:

```
allocated_direct_emissions = Eᵢ × Zᵢᵦ / Xᵢ
allocated_value_added      = VAᵢ × Zᵢᵦ / Xᵢ
hypothetical_investment    = allocated_direct_emissions × target_reduction × assumed_cost_per_tonne
minimum_buyer_share        = clamp(1 − ceiling × allocated_VA / investment, 0, 1)
```

Domestic suppliers are excluded (a cross-border first-tier question). Emissions
are matched to ICIO codes **exactly**; where ICIO is finer than the GHG taxonomy
(e.g. `C24A`/`C24B`/`C302T309`) the link has no exact emissions twin and is
**preserved as an excluded observation with a reason, never assigned zero**. This
is first-tier proportional allocation only — no Leontief inverse, no all-tier
embodied footprint, and not a measured Scope 3 inventory.

## Verified anchors

Independently reproduced from the OECD source and checked against the committed data:

| Buyer | Matched foreign links | Excluded | Foreign-input coverage | Allocated emissions | Allocated VA |
|---|---:|---:|---:|---:|---:|
| **DEU_C29** Germany · motor vehicles | 3,419 | 279 | 86.8% | 4.145 Mt CO₂e | $25,236.7 m |
| **FRA_C29** France · motor vehicles | 3,249 | 276 | 89.0% | 1.098 Mt CO₂e | $7,351.1 m |

Raw-cell spot checks (straight from `2022_SML.csv` + `DF_MAIN.csv`) confirm the
allocation, e.g. `DEU_C29 ← CHN_C20`: Z = 509.5116, OUT = 1,649,082.9,
GHG(CHN,C20) = 635.771 Mt → allocated = 196,432.0 t; and the excluded
`DEU_C29 ← CHN_C24A` (no exact GHG twin) is preserved, not zeroed.

## Data architecture

- `data/manifest.json` — small, uncompressed: official labels, per-economy
  available industries, provenance/checksums, inclusion rule and `omitted` list.
- `data/cases/<ECONOMY>_<IND>.json.gz` — one lazily loaded, gzip-compressed,
  columnar case per buyer (matched links, excluded links with reasons, and exact
  full-case totals kept separate from any displayed top-link subset). The app
  detects whether the response is actually gzip before applying
  `DecompressionStream`, and falls back to plain JSON.

Largest case file ≈ 42 KB; total derived data ≈ 82 MB. No individual file exceeds
90 MB and no raw OECD archive is committed.

## Build (needs the local OECD source)

```bash
python scripts/build_cases.py \
  --icio-zip ".../ICIO/2025/Regular/2016-2022_SML.zip" \
  --ghg-zip  ".../GHG Datasets/MAIN_csv.zip" \
  --readme   ".../ICIO/2025/Regular/ReadMe_ICIO_small.xlsx" \
  --out data
```

Requires `openpyxl` for the official labels. The script prints a `DEU_C29`
self-check (expect 3,419 / 279 / 86.8%). `scripts/validate_case.py` is a
developer-only validator for a built case file — **visitors never upload data.**

## Tests

```bash
npm test                 # node core tests + committed-data integrity
npm run test:reproduce   # reproduce anchors from OECD source (set GSFL_ICIO_ZIP, GSFL_GHG_ZIP)
```

- `tests/core.test.mjs` — gzip detect/inflate + fallback, selector normalisation,
  filter/rank, scenario and reverse buyer-share arithmetic, coverage identity,
  number formatting (never `$0m` for a positive; true zero vs missing), and the
  dynamic narrative reacting to control changes.
- `tests/test_data.py` — DEU_C29 and FRA_C29 anchors, manifest integrity, label
  completeness, exclusion of totals/final demand, missing-never-zero, no private
  paths committed, no raw archives committed.
- `tests/test_reproduce.py` — rebuilds the anchors from OECD source when present.

Browser verification (desktop + 375 px mobile): buyer/industry/supplier switching,
all ranking modes, all scenario sliders, dynamic policy text, code explainer,
collapsed/expanded evidence, complete download, and zero console errors.

## Positioning

This research preview is intended for policy screening, research exploration and
teaching. It is **not** a firm-level carbon inventory, a credit assessment, a
causal model or an investment recommendation. It is a distinctive open research
tool; no "world first" or "unique" claim is made. OECD retains all rights in the
underlying data (see [`NOTICE.md`](NOTICE.md)).
