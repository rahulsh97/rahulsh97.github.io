# Build log · 20 September 2026

## Built

- Independent static app with supplier-economy selection, ranked exposure bars, financing sliders, link table and CSV export.
- Streaming OECD ICIO reader for one buyer column. Requires same-year industry production emissions to create a JSON case. File checksums, provenance and unmatched supplier codes are carried forward.
- Python and JavaScript accounting checks; fixture values appear only in tests.

## Data access and honest boundary

Official [ICIO](https://www.oecd.org/en/data/datasets/inter-country-input-output-tables.html) page identifies the 2025 regular release and 2016–22 archive. Official [GHG footprint](https://www.oecd.org/en/data/datasets/greenhouse-gas-footprint-indicators.html) page confirms a production-based industry-emissions flow compiled with AEA data. Neither archive nor the exact industry-level emissions export has been fetched in this environment; the public website held the browser at a security-verification page. Other researchers' public code shows an OECD CSV naming convention (`2022_SML.csv`), but code is not a substitute for the actual primary data or its verified units. The app therefore opens with no empirical numbers.

## Next concrete action

The same-year **2022** compact handoff was supplied on 20 September 2026. The first real case is built locally with `scripts/build_from_handoff.py` and its original ZIP is retained under `inputs/`. Source files selected by the handoff author: OECD ICIO 2025 regular `2022_SML.csv` and OECD GHG Footprints MAIN `PROD_GHG`, year 2022 (not the older 2020 MAIN edition). See the current README for audited coverage and accounting results. The original 32 GB OECD archive remains on Rahul's Windows machine, so this environment can check the handoff and its internal totals but cannot independently recompute its stated source ZIP hashes. Next: inspect the rendered case in browser and check one original OECD source cell or official aggregate before publishing.
