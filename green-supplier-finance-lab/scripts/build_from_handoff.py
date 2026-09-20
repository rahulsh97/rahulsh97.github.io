#!/usr/bin/env python3
"""Build one auditable case from the compact, same-year OECD handoff ZIP."""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
from zipfile import ZipFile

ICIO_URL = "https://www.oecd.org/en/data/datasets/inter-country-input-output-tables.html"
GHG_URL = "https://www.oecd.org/en/data/datasets/greenhouse-gas-footprint-indicators.html"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def numeric(value, name, *, allow_negative=False):
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError(f"Missing or non-numeric {name}: {value!r}") from None
    if not math.isfinite(number) or (number < 0 and not allow_negative):
        raise ValueError(f"Invalid {name}: {value!r}")
    return number


def member(z, suffix):
    names = [name for name in z.namelist() if name.endswith("/" + suffix)]
    if len(names) != 1:
        raise ValueError(f"Expected one {suffix} in handoff, found {len(names)}")
    return z.read(names[0])


def build(bundle):
    raw = Path(bundle).read_bytes()
    with ZipFile(io.BytesIO(raw)) as z:
        manifest_bytes = member(z, "manifest.json")
        manifest = json.loads(manifest_bytes)
        csv_bytes = member(z, manifest["supplier_table"]["file"])
    rows = list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig"))))
    buyer = manifest["buyer"]["code"]
    year = int(manifest["buyer"]["icio_year"])
    if buyer != "DEU_C29" or year != 2022:
        raise ValueError("This case is pinned to Germany motor vehicles, ICIO 2022")
    if "2022" not in manifest["units"]["ghg"] and "PROD_GHG" not in manifest["definitions"]["production_ghg"]:
        raise ValueError("Check the supplied GHG series and its year")
    if len(rows) != manifest["supplier_table"]["rows"]:
        raise ValueError("Supplier row count differs from manifest")
    total = sum(numeric(r["intermediate_input_flow_usd_mn"], "input flow") for r in rows)
    if abs(total - manifest["supplier_table"]["total_intermediate_inflow_usd_mn"]) > 0.05:
        raise ValueError("Total input flow differs from manifest")
    if sum(r["ghg_matched"] == "True" for r in rows) != manifest["supplier_table"]["ghg_matched_rows"]:
        raise ValueError("GHG matched count differs from manifest")

    foreign_total = 0.0
    matched_flow = 0.0
    missing_flow = 0.0
    unmatched = []
    excluded = {"missing_ghg": 0, "negative_va": 0}
    links = []
    seen = set()
    for row in rows:
        if row["buyer"] != buyer:
            raise ValueError("Mixed buyer columns in handoff")
        supplier = row["supplier_country"] + "_" + row["supplier_industry"]
        if supplier in seen:
            raise ValueError(f"Duplicate supplier sector: {supplier}")
        seen.add(supplier)
        flow = numeric(row["intermediate_input_flow_usd_mn"], f"input {supplier}")
        output = numeric(row["supplier_gross_output_usd_mn"], f"output {supplier}")
        va = numeric(row["supplier_value_added_usd_mn"], f"VA {supplier}", allow_negative=True)
        if row["supplier_country"] == buyer.split("_")[0]:
            continue  # First-tier international supplier links, by design.
        foreign_total += flow
        reason = None
        flag = row["ghg_matched"]
        if flag not in ("True", "False"):
            raise ValueError(f"Invalid GHG match flag for {supplier}")
        if flag == "False":
            if row["prod_ghg_2022_MtCO2e"].strip():
                raise ValueError(f"Unmatched GHG has a number for {supplier}")
            reason = "missing_ghg"
        elif va < 0:
            reason = "negative_va"
        if reason:
            unmatched.append({"supplier": supplier, "reason": reason, "input_usd_m": flow})
            excluded[reason] += 1
            missing_flow += flow
            continue
        emissions = numeric(row["prod_ghg_2022_MtCO2e"], f"GHG {supplier}") * 1e6
        if output <= 0 or flow > output * 1.01:
            raise ValueError(f"Invalid output or input/output ratio for {supplier}")
        matched_flow += flow
        links.append({
            "supplier": supplier, "country": row["supplier_country"], "industry": row["supplier_industry"],
            "direct_input_usd_m": flow, "producer_output_usd_m": output,
            "producer_va_usd_m": va, "producer_direct_ghg_t": emissions,
            "allocated_direct_ghg_t": emissions * flow / output,
            "allocated_va_usd_m": va * flow / output,
        })
    if not links or abs(matched_flow + missing_flow - foreign_total) > 0.001:
        raise ValueError("Unreconciled foreign input flow")
    return {
        "schema": 1, "year": year, "buyer": buyer,
        "method": "First-tier proportional allocation of published 2022 supplier-sector GHG and VA to 2022 intermediate purchases; no observed investment or lending.",
        "sources": {
            "icio": ICIO_URL, "emissions": GHG_URL,
            "icio_release": manifest["sources"]["icio"]["name"],
            "ghg_release": manifest["sources"]["ghg"]["name"],
            "icio_zip_sha256": manifest["sources"]["icio"]["zip_sha256"],
            "ghg_zip_sha256": manifest["sources"]["ghg"]["zip_sha256"],
            "handoff_sha256": digest(raw), "handoff_csv_sha256": digest(csv_bytes),
            "handoff_manifest_sha256": digest(manifest_bytes),
        },
        "coverage": {
            "foreign_input_usd_m": foreign_total,
            "matched_input_usd_m": matched_flow,
            "unmatched_input_usd_m": missing_flow,
            "input_value_share": matched_flow / foreign_total,
            "foreign_link_count": len(links) + len(unmatched),
            "matched_link_count": len(links), "excluded_reasons": excluded,
        },
        "unmatched_count": len(unmatched), "unmatched": unmatched,
        "links": sorted(links, key=lambda r: r["allocated_direct_ghg_t"], reverse=True),
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("bundle", type=Path)
    p.add_argument("--out", type=Path, default=Path("data/case.json"))
    args = p.parse_args()
    case = build(args.bundle)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(case, indent=2) + "\n", encoding="utf-8")
    print(f"{len(case['links'])} matched foreign links; {case['unmatched_count']} excluded; "
          f"{case['coverage']['input_value_share']:.1%} of foreign input value covered")
