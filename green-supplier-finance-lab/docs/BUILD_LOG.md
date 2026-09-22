# Build log

## 22 September 2026 — upstream emissions multiplier (all-tier) module

Added an all-tier upstream multiplier on top of the existing multi-buyer first-tier
tool, reusing the already-parsed 2022 ICIO + GHG files (no source rediscovery, no
rebuild of the 3,926 first-tier case files).

**Validation gate (run before publishing anything).** Established OECD's official
GHG multiplier definition from `Readme_GHGMult.txt` — total direct+indirect GHG
(kt CO₂e, GWP100 AR5) per USD million of final demand, i.e. `g'(I−A)^-1` on the
small ICIO (77×45). Reconstructed the 2020 multiplier on the matching ICIO (2023
Regular 2020, 77×45) + 2020 `PROD_GHG` and compared to `ghg_mult_77_7745_2020.csv`
(column sums = total multiplier per demand sector):
- Method exactly reproduced — OECD's multiplier run backward through the network
  returns the independent `g` (median implied/own ratio 1.00).
- Spearman rank corr 0.93; direct visibility share reconciles to ~1 pp on the
  1,000 largest sectors; absolute levels differ ~6% median (DEU_C29 −6.2%,
  CHN_C29 −11.1%), from emissions **vintage** (intensive sectors, small economies)
  and **ROW** emissions absent from `PROD_GHG`; one transport outlier (JPN_H49)
  documented. Report: `docs/multiplier_validation_2020.json`. **PASS within a
  documented tolerance** — visibility share and rankings robust; absolute all-tier
  levels are modelled estimates.

**2022 build.** `scripts/build_multipliers.py` computes `A=Z·diag(1/x)`, `g=E/x`
(GHG matched by an injective concordance C24A→C241_2431, C24B→C242_2432,
C302T309→C30X301 — no double-counting) and solves `(I−A)ᵀm=g` for 4,050 sectors.
Output `data/multipliers_2022.json.gz` (3,936 sectors, 47 KB): per-sector `g` and
`m` in t CO₂e per USD million. `m≥g` everywhere; self-check `g[CHN_C20]·z = 196,432 t`
matches the case's allocated direct exactly.

**Interface.** New "How much is hidden upstream?" section with four headline cards
(direct / deeper / all-tier / direct visibility), a stacked visible-vs-deeper chart
for the leading channels, plain-English explanation, and a Direct / Direct+deeper
toggle that re-lenses the exposure chart and narrative but **never** the financing
figures. A finance notice states financing covers first-tier direct emissions only.
The policy explanation gained a "Visible vs hidden upstream" paragraph. Evidence
table + CSV gained direct / deeper / all-tier / visibility / multiplier-status
fields. Substantive result: DEU_C29 — 12.4% visible at the first tier, 87.6%
(29.3 Mt) hidden deeper; all-tier leader (China electrical equipment) differs from
the direct leader (China chemicals).

**Tests.** `tests/test_multipliers.py` (21) + upstream cases in `core.test.mjs`.
Full suite: 16 core + 31 data + 21 multiplier, all pass.

## 21 September 2026 — multi-country, multi-industry expansion (v2)

### Verified the expansion is real before changing the interface

Working straight from the local OECD source (checksums matching the pinned
releases: ICIO zip `46db55c4…`, GHG zip `7cb08938…`):

- Inspected the full 2022 ICIO matrix: 4,538 columns → **4,050 valid buyer
  economy × industry activity columns** (81 economies × 50 industries), after
  excluding final-demand columns (`HFCE, NPISH, GGFC, GFCF, INVNT, DPABR`) and
  the `OUT`/`VA`/`TLS` accounting rows/columns.
- Matched supplier country-industry rows to 2022 `PROD_GHG` (T_CO2E) on exact
  ICIO codes; ICIO codes finer than the GHG taxonomy (`C24A`, `C24B`,
  `C302T309`) have no exact twin and are preserved as excluded observations.
- **Reproduced the published `DEU_C29` anchors exactly**: 3,419 usable foreign
  supplier-sector links, 279 excluded, 86.8% foreign-input-value coverage,
  4,144,978.8 t CO₂e (≈4.145 Mt) and $25,236.7 m allocated value added.
- Independently verified a second buyer, **`FRA_C29`**: 3,249 matched, 276
  excluded, 89.0% coverage, 1.098 Mt, $7,351.1 m.
- Raw-cell spot checks (3 for each buyer) taken directly from `2022_SML.csv` and
  `DF_MAIN.csv`, e.g. `DEU_C29 ← CHN_C20`, `USA_C26`, `JPN_C29`,
  `FRA_C29 ← MAR_C29`, `DEU_C20`, `ITA_C22`, plus excluded `CHN_C24A`,
  `IND_C24B` (GHG missing → preserved, not zeroed). All reconcile.
- Landscape: **3,926** buyers have ≥1 matched foreign link and are published;
  **124** (all 81 `T` household columns plus small mining sub-sectors absent in
  some economies) have zero matched foreign links and are listed under `omitted`.

### Built

- `scripts/build_cases.py` — self-contained, path-argument builder. Reads the two
  source ZIPs and the official ReadMe labels, writes `data/manifest.json` and one
  gzipped columnar case per buyer to `data/cases/`. Deterministic; prints a
  `DEU_C29` self-check. Total derived data ≈ 82 MB; largest file ≈ 42 KB.
- Rewrote the public interface: buyer economy + industry + supplier + ranking
  controls, lazy per-buyer `.json.gz` loading with gzip detection and fallback,
  headline cards labelled Published / Modelled / Coverage, a renamed full
  buyer-case coverage card, a dynamic "What does this case tell us?" section
  computed from values (no language model), a collapsed accessible evidence
  `<details>` with a complete CSV download, and a searchable country/sector code
  explainer modal. Removed the case-file upload entirely; the edition banner now
  reads **RESEARCH PREVIEW · OECD 2022** and the active buyer is named in full.
- `scripts/validate_case.py` — developer-only case validator (visitors never
  upload data).
- Attribution added to the footer, methods panel, README, `CITATION.cff`,
  `NOTICE.md`, downloaded CSV metadata and source-file headers.

### Provenance and rights

Only compact derived aggregates + official labels are committed. Raw OECD
archives are not redistributed; source ZIP/CSV SHA-256 hashes are in the
manifest. OECD remains the source of, and rights-holder in, the underlying
accounts (see `NOTICE.md`). The tool's own licence is deliberately left unset.

---

## 20 September 2026 — first single-buyer preview (v1, superseded)

Independent static app with a single Germany motor-vehicles (`DEU_C29`) case
built from a compact same-year OECD handoff (ICIO 2025 `2022_SML.csv` + GHG
Footprints MAIN `PROD_GHG` 2022, not the older 2020 edition). Carried source
archive hashes and unmatched-sector counts. Superseded by the v2 multi-buyer
build above; the single `data/case.json`, the handoff input and the
handoff/single-case build scripts were removed.
