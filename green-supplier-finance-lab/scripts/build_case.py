#!/usr/bin/env python3
"""Extract one buyer industry's first-tier suppliers from OECD 2025 regular ICIO.

The emissions input is a separately prepared OECD AEA industry table in the
documented schema. No emission value is inferred when that table is absent.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def number(raw, label):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"Missing/non-numeric {label}: {raw!r}") from None
    if not 0 <= value < float("inf"):
        raise ValueError(f"Invalid {label}: {value}")
    return value


def signed_number(raw, label):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"Missing/non-numeric {label}: {raw!r}") from None
    if not -float('inf') < value < float('inf'):
        raise ValueError(f"Invalid {label}: {value}")
    return value


def read_emissions(path, year):
    required = {"year", "country", "industry", "production_ghg_tonnes"}
    found = {}
    with open(path, newline="", encoding="utf-8-sig") as file:
        rows = csv.DictReader(file)
        if not required.issubset(rows.fieldnames or ()):
            raise ValueError(f"Emissions CSV needs {', '.join(sorted(required))}")
        for row in rows:
            if row["year"] != str(year):
                continue
            key = (row["country"].strip(), row["industry"].strip())
            if key in found:
                raise ValueError(f"Duplicate emissions key: {key}")
            found[key] = number(row["production_ghg_tonnes"], str(key))
    if not found:
        raise ValueError(f"No emissions rows for {year}")
    return found


def build(icio_path, emissions_path, buyer, year, emissions_citation):
    if not emissions_citation:
        raise ValueError("Supply a public citation URL for the emissions table")
    emissions = read_emissions(emissions_path, year)
    supplier_rows = {}
    va = {}
    with open(icio_path, newline="", encoding="utf-8-sig") as file:
        table = csv.reader(file)
        header = next(table)
        if buyer not in header:
            raise ValueError(f"Buyer column {buyer!r} absent from ICIO")
        buyer_col = header.index(buyer)
        output_col = len(header) - 1
        if output_col <= buyer_col:
            raise ValueError("Expected gross output as the last ICIO column")
        for row in table:
            if len(row) != len(header):
                raise ValueError(f"ICIO row length mismatch: {row[:1]}")
            code = row[0]
            if code == "VA":
                for i in range(1, output_col):
                    code = header[i]
                    if code.count('_') == 1 and len(code.split('_')[0]) == 3:
                        va[code] = signed_number(row[i], f"VA {code}")
            elif code.count("_") == 1 and len(code.split("_")[0]) == 3:
                z = number(row[buyer_col], f"input {code} -> {buyer}")
                if z > 0:
                    supplier_rows[code] = {"flow": z, "output": number(row[output_col], f"output {code}")}

    if not va:
        raise ValueError("No VA row; verify this is an OECD ICIO regular CSV")
    links = []
    unmatched = []
    for code, obs in supplier_rows.items():
        country, industry = code.split("_")
        if country == buyer.split("_")[0]:
            continue  # The first case concerns cross-border supplier finance.
        ghg = emissions.get((country, industry))
        if ghg is None or code not in va or va[code] < 0 or obs["output"] <= 0:
            unmatched.append(code)
            continue
        if obs["flow"] > obs["output"] * 1.01:
            raise ValueError(f"Input link exceeds producer output for {code}")
        links.append({
            "supplier": code, "country": country, "industry": industry,
            "direct_input_usd_m": obs["flow"],
            "producer_output_usd_m": obs["output"],
            "producer_va_usd_m": va[code],
            "producer_direct_ghg_t": ghg,
            "allocated_direct_ghg_t": ghg * obs["flow"] / obs["output"],
            "allocated_va_usd_m": va[code] * obs["flow"] / obs["output"],
        })
    if not links:
        raise ValueError("No cross-border links matched emissions; inspect sector codes and year")
    return {
        "schema": 1, "year": year, "buyer": buyer,
        "method": "First-tier intermediate inputs; supplier-sector emissions and value added allocated by buyer's share of supplier-sector output. Not measured firm-level emissions or financing.",
        "sources": {
            "icio": "https://www.oecd.org/en/data/datasets/inter-country-input-output-tables.html",
            "icio_sha256": sha256(icio_path),
            "emissions": emissions_citation,
            "emissions_sha256": sha256(emissions_path),
        },
        "foreign_link_count": len(links) + len(unmatched),
        "unmatched_count": len(unmatched), "unmatched": unmatched,
        "links": sorted(links, key=lambda link: link["allocated_direct_ghg_t"], reverse=True),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--icio", required=True, type=Path, help="Unzipped OECD 2025 regular CSV, e.g. 2022_SML.csv")
    p.add_argument("--emissions", required=True, type=Path, help="Matched OECD AEA industry emissions CSV")
    p.add_argument("--emissions-citation", required=True, help="Official URL and release for the emissions CSV")
    p.add_argument("--buyer", required=True, help="OECD ICIO buyer column, e.g. DEU_D29")
    p.add_argument("--year", required=True, type=int)
    p.add_argument("--out", default="data/case.json", type=Path)
    args = p.parse_args()
    case = build(args.icio, args.emissions, args.buyer, args.year, args.emissions_citation)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(case, indent=2) + "\n", encoding="utf-8")
    print(f"Built {args.out}: {len(case['links'])} linked suppliers; {case['unmatched_count']} unmatched")


if __name__ == "__main__":
    main()
