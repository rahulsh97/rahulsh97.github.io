# Who Pays to Green the Supply Chain?

A [browser research preview](https://rahulsh97.github.io/green-supplier-finance-lab/) for examining **published first-tier input accounts**, allocated direct production emissions and **hypothetical financing burden**. Its first real-data case is Germany's motor-vehicle industry (`DEU_C29`) in **2022**, from an OECD ICIO 2025 table and the 2022 production-emissions series in the OECD GHG Footprints MAIN extract.

## Research question

If a buyer asks upstream suppliers to reduce emissions, which supplier sectors carry the largest exposure, and how does an assumed buyer-funded share change the **illustrative** investment burden? The contribution is an auditable bridge between production accounts and finance design, **not** a claim that upgrade costs, lending, supplier contracts or impacts are observed.

## Data route

1. The original [OECD ICIO 2025 regular tables](https://www.oecd.org/en/data/datasets/inter-country-input-output-tables.html) contain `2022_SML.csv`. The supplied compact handoff extracted the `DEU_C29` buyer column, each supplier's output and value added, and a manifest with the source ZIP checksum.
2. [OECD GHG Footprint Indicators](https://www.oecd.org/en/data/datasets/greenhouse-gas-footprint-indicators.html), **MAIN extract**, provide `PROD_GHG` production emissions in 2022 by country and industry. The handoff matched these observations by exact code; the older `DF_MAIN_csv.zip` ends in 2020 and was not used. `Mt CO₂e` is converted to tonnes in the case builder.
3. The handoff ZIP is under `inputs/`; `scripts/build_from_handoff.py` independently recalculates first-tier allocations from its CSV and checks its manifest totals. It carries source archive hashes. The 32 GB source archive is **not** bundled here. Review [OECD data terms](https://www.oecd.org/en/about/terms-conditions.html) and dataset metadata for special restrictions before republishing.

```bash
python scripts/build_from_handoff.py inputs/green-finance-oecd-handoff.zip --out data/case.json
python -m http.server 8080
```

Open `http://localhost:8080/`. `data/case.json` loads automatically; the file picker accepts other validated cases. The alternative `scripts/build_case.py` can read the original ICIO CSV and a separately prepared emissions CSV if you have the large source files locally.

### The first case, audited against the supplied handoff

The original handoff has **3,746** positive supplier-sector rows, including **48 domestic** German links. For this deliberately cross-border case, **3,698** foreign links represent **$93,951.5 million** of inputs. **3,419** links have usable direct GHG and nonnegative value added, covering **$81,572.4 million or 86.8% of foreign input value**. The **279 excluded** foreign links are 277 without an exact GHG sector match and two with negative supplier value added; their **$12,379.1 million** of inputs are reported separately, never assigned zero emissions. Of the usable links, the proportional model allocates **4.145 million tonnes CO₂e** and **$25,236.7 million** of supplier value added to this buyer's input purchases. These are constructed first-tier allocations, **not independently measured buyer footprints**. The 2022 year, ICIO/GHG releases, source ZIP checksums and handoff checksum are in `data/case.json`.

## Method and boundaries

For foreign supplier sector *i* and buyer sector *b*, let `Zᵢᵦ` denote **intermediate input purchases** (USD million), `Xᵢ` supplier-sector output, `Eᵢ` producer direct GHG (tonnes CO₂e), and `VAᵢ` supplier-sector value added (USD million).

`allocated_direct_ghgᵢᵦ = Eᵢ × Zᵢᵦ / Xᵢ` and `allocated_vaᵢᵦ = VAᵢ × Zᵢᵦ / Xᵢ`. The allocation assumes uniform emissions and VA per dollar of output across buyers. It covers **first-tier direct supplier production only**: no Leontief inverse, no all-tier embodied footprint, no firm-level Scope 3 inventory. OECD ICIO figures are national-account estimates, not observed firm contracts.

The scenario uses a selected reduction `r`, an **assumed** USD/tonne upgrade cost `c` and **assumed** buyer-funded percentage `q`: `hypothetical investment = allocated_direct_ghg × r × c`; buyer and supplier portions equal `q` and `1−q`. Dollars are expressed in millions. For an assumed diagnostic ceiling `T` of supplier burden / allocated annual value added, the reverse calculation solves `minimum buyer share = clamp(1−T×allocated VA/investment, 0, 1)`. This is an accounting stress test, not a cost-effectiveness estimate, credit-risk model or prediction. The burden / allocated VA ratio compares a one-time cost with annual VA and must not be interpreted as profitability or cash-flow capacity.

The app shows input-value coverage and excludes unmatched supplier sectors from its estimated totals. It never calls excluded cells zero. It does not merge other releases, use UNIDO industry accounts as if they were ICIO inputs, or assert that OECD emissions data observes financing. For example, ICIO's `C24A` and `C24B` do not each receive GHGFP's combined `C24` emissions: that would double count. Such links stay unmatched until a separately justified crosswalk is built. UNIDO or IFC material may become a separately documented later layer once matching and identification justify it.

## Verification and current gate

```bash
python -m unittest discover -s tests -v
npm test
```

The tests check a small accounting fixture, the actual handoff's counts and value-weighted coverage, arithmetic, and the client-side scenario. The original OECD archives are not included, so raw-source checksums and cells are inherited from the handoff manifest; this is a stated provenance limit. Before treating this preview as a research result, independently spot-check an original OECD source cell and review the dataset-specific metadata for additional reuse restrictions. The OECD's [general terms](https://www.oecd.org/en/about/terms-conditions.html) apply alongside dataset-specific conditions. The scenario uses no observed upgrade cost or contract data.
