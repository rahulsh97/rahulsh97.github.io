# Notice, attribution and rights

## Authorship

**Concept, research design and interpretation: Rahul Shukla.**
**Engineering assistance: OpenAI Codex and Anthropic Claude Code.**

Codex and Claude Code provided software and engineering assistance. They are not
authors of the research design or its interpretation.

## What this tool is

The Green Supplier Finance Lab is an original interface and method that combines
published OECD sector accounts with a transparent proportional allocation and
user-defined financing scenarios. It is a research preview for policy screening,
research exploration and teaching. It is **not** a firm-level carbon inventory, a
credit assessment, a causal model or an investment recommendation, and it does
not report a measured Scope 3 footprint. First-tier suppliers only.

Because this is a public static web application, its client-side code is openly
readable. No claim is made that the code is impossible to copy, and nothing here
is obfuscated.

## Rights in the underlying data (kept separate from ownership of this tool)

The economic and emissions accounts used here are produced by the **OECD**, which
remains the source of, and rights-holder in, those underlying data:

- OECD Inter-Country Input-Output (ICIO) Tables, 2025 release, 2022 table —
  <https://www.oecd.org/en/data/datasets/inter-country-input-output-tables.html>
- OECD Greenhouse Gas Footprints, production-based emissions (PROD_GHG), 2022 —
  <https://www.oecd.org/en/data/datasets/greenhouse-gas-footprint-indicators.html>
- Official area and activity labels: OECD ICIO 2025 `ReadMe_ICIO_small.xlsx`.

Only compact **derived** aggregates are published in this repository (per-buyer
allocated emissions and value added, coverage diagnostics, and official code
labels). The raw OECD source archives are **not** redistributed here. Review the
[OECD terms and conditions](https://www.oecd.org/en/about/terms-conditions.html)
and each dataset's metadata for reuse conditions before republishing the source
data itself. Source ZIP and CSV SHA-256 checksums are recorded in
`data/manifest.json` for provenance.

## Licence

The ownership and licensing of Rahul Shukla's original interface and method are
**not** set to MIT, CC BY or any other permissive licence here; that decision is
reserved. Attribution above must be retained. This notice does not grant rights
in the OECD data, which remain governed by OECD's own terms.
