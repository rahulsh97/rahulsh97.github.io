# District Change Lab — research preview

A dependency-free HTML/JavaScript research tool embedded at `/nfhs-lab/` in Rahul Shukla's portfolio. It compares district-level published indicators from NFHS-4 (2015–16) and NFHS-5 (2019–21). It does **not** ship DHS/NFHS person-level microdata.

## Data and coverage

The extract is built from [Bhanu K Pratap Vardhan's NFHS-5 district fact-sheet compilation](https://github.com/pratapvardhan/NFHS-5), licensed CC BY 4.0 and transcribed from original [MoHFW/IIPS fact sheets](https://www.nfhsiips.in/). Pinned source commit: `93c67fed2403c8e533d178d293c5ba0411892b1e`. The SHA-256 of `NFHS-5-Districts.csv` is pinned in `build.py`; the compact derived `data.json` includes attribution and can be rebuilt with:

```sh
python nfhs-lab/build.py /path/to/NFHS-5-Districts.csv
python -m http.server 8000
```

Open `http://localhost:8000/nfhs-lab/` from the repository root. The pinned input is available in the cited repository. This tool covers 341 districts in 21 states/UTs (the compilation is incomplete versus NFHS-5's 707 districts). Nine indicator series are extracted; 262 districts have both NFHS-4 and NFHS-5 observations for the initial clean-fuel/stunting comparison. Cells with small-case/suppression notes are nulled rather than presented as estimates. Values are percentages; changes are percentage points. Missing values are not zeros. An NFHS-5 level view is available, but no national totals are computed by averaging districts.

**Quality gate before calling this a definitive research dataset:** the compiler explicitly says its district transcription was minimally checked. The build tests schema, ranges, completeness and expected counts, but the 341×9 entries have **not** been fully reconciled against the official district PDFs. Check a stratified sample across states and measures before publication as a substantive finding. Do not use these district associations as causal evidence or as individual-level regressions. The within-state toggle demeans x and y by state and fits a linear association; it does not turn two repeated cross-sections into a household panel, handle survey sampling design or solve spatial correlation. In particular, the line draws a state-centred slope through the national average only as a visual guide.

NFHS-6 district compendia are [advertised by IIPS for 35 states/UTs](https://www.nfhsiips.in/nfhsuser/whatsnew.php), but this tool **does not include NFHS-6**. Adding it requires an audited indicator dictionary, source page mapping and boundary-vintage concordance. Historical availability or a publicly posted third-party dataset does not imply access to, or permission to redistribute, restricted NFHS microdata.

## What is working

- Two-round change or NFHS-5 level view for nine extracted indicators; partial district coverage is shown on-screen.
- District scatterplot, linked district matrix grouped by state, state filtering, search, inspection, shareable URL and filtered CSV export.
- Pooled or state-centred OLS coefficient, R², and leave-one-state-out influence check; **no significance or causal claims**.
- Static files with no Shiny, tracking or external JavaScript.

To check the script and client-side regression on synthetic reference points, run `python nfhs-lab/build.py /path/to/NFHS-5-Districts.csv` and `node nfhs-lab/tests.mjs`.
