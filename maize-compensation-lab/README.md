# Maize Compensation Lab: research preview

A dependency-free HTML/JavaScript viewer, embedded at `/maize-compensation-lab/` in Rahul Shukla's portfolio. It answers one question: **how should a fixed compensation budget be allocated when a maize price rise affects Malawian households differently, and the government has imperfect information about poverty and market exposure?**

**It shows precomputed results only.** Every number comes from aggregate tables produced by a validated analysis of the Malawi Sixth Integrated Household Survey (IHS6, 2024/25). No simulation, estimation or interpolation runs in the browser. Visitors can choose only the 972 exact scenario combinations that were simulated and validated. Unvalidated values cannot be entered; scenarios passed through the URL are checked against the validated grid.

## What is shown

| Section | Content | Scenario coverage |
|---|---|---|
| Rule comparison and table | Poverty gap, squared poverty gap (FGT2) and compensated losses of initially poor households for 5 feasible rules, the no-transfer case and 3 perfect-information benchmarks, all at an identical budget | All 972 scenarios |
| Share of attainable gain | **Derived:** (no transfer − rule) ÷ (no transfer − perfect-information benchmark). Benchmark B1 is used for the poverty gap and squared gap, B3 for loss compensation. | All 972 |
| Uncertainty | Paired differences from the PMT rule, with 95% Rao–Wu survey-bootstrap intervals (200 replicates; targeting models re-fitted in each replicate) and the probability of being best | 3 scenarios: central, λ = 0, λ = 1 |
| Distribution | Loss and transfer by consumption decile; market position | Central scenario |
| Geography | Design-based district estimates with 95% intervals, bootstrap rank probabilities, between-district share of variation | Central scenario |

## Rules and their information requirements

- **Implementable:** equal per-person transfer; geographic allocation across 32 districts using published survey estimates.
- **Survey-ideal (upper bounds):** proxy means test (PMT), maize-exposure proxy, PMT + exposure. These are cross-fitted by enumeration area on the *same* survey round they are evaluated on. A deployable registry model would be trained on older data and applied to noisier records, so real performance is likely lower.
- **Perfect-information benchmarks (infeasible):**
  - B1 fills the deepest poverty gaps first;
  - B2 reimburses the losses of post-shock poor households;
  - B3 reimburses the losses of initially poor households.

## Data and provenance

- `data/*.csv`: the aggregate tables of validated run `maize_20261025T173130_1dafdd`. They were disclosure-reviewed:
  - no household, enumeration-area or sub-district identifiers;
  - no coordinates;
  - every district estimate rests on ≥ 16 enumeration areas.
- `data/run_manifest.json`: the run's provenance record (code and input hashes, parameters, seeds, package versions, test and gate status, output hashes).
- `data.json`: compiled by `build.py`, which **stops unless every CSV matches the SHA-256 recorded in the manifest**.
- `docs/`: the four-page policy brief and six-page technical report.

The survey microdata (National Statistical Office of Malawi; World Bank Microdata Library `MWI_2024-2025_IHS-VI_v01_M`) are licensed for restricted use and are **not** included or redistributable. The full R analysis pipeline is maintained separately and is not part of this site.

## Build and test

From the repository root:

```sh
python maize-compensation-lab/build.py
node maize-compensation-lab/tests.mjs
node maize-compensation-lab/smoke.mjs
python -m http.server 8000
```

Then open `http://localhost:8000/maize-compensation-lab/`.

- `tests.mjs` checks every displayed value in `data.json` against the source CSVs, cell by cell. It also tests the derived ratio, the validated-scenario guard and the absence of any free numeric input, and scans the folder for identifiers or local paths.
- `smoke.mjs` runs `app.js` against a minimal DOM and checks the rendered headline values.

## Interpretation and limitations

- **Scenarios, not forecasts or causal estimates.** First-order money-metric effects plus an optional consumer substitution term. No wage, supply-response or general-equilibrium effects.
- **Household exposure is measured with noise.** Purchases use 7-day recall, annualised, with strong seasonality. Fieldwork coincided with a maize price spike, and purchases are deflated with general, not maize-specific, prices.
- **Geography is district level only.** Finer geographic targeting (for example, village-level partial registries; Gualavisi & Newhouse, *World Bank Economic Review*, 2025) may perform much better and is not tested here.
- **Bootstrap scope.** The bootstrap excludes weight re-calibration, finite-population corrections and measurement error. The 972-scenario grid is a deterministic sensitivity analysis, not a probability distribution.
