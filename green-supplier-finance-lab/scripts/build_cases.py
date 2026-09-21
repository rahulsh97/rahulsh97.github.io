#!/usr/bin/env python3
"""Build the multi-buyer Green Supplier Finance Lab dataset from OECD source.

Inputs (never committed; pass their local paths):
  --icio-zip  OECD ICIO 2025 Regular archive holding 2022_SML.csv
              (e.g. ".../ICIO/2025/Regular/2016-2022_SML.zip")
  --ghg-zip   OECD GHG Footprints MAIN archive holding DF_MAIN.csv
              (e.g. ".../GHG Datasets/MAIN_csv.zip")
  --readme    OECD ReadMe_ICIO_small.xlsx (official country and sector labels)
  --out       output directory (default: ../data next to this script)

Outputs (compact, safe to publish):
  <out>/manifest.json                 buyer manifest + official labels + provenance
  <out>/cases/<ECONOMY>_<IND>.json.gz one lazily loaded case per valid buyer

Method per (buyer, foreign supplier sector), 2022:
  allocated_ghg_t    = supplier production GHG (t)  * purchases / supplier gross output
  allocated_va_usd_m = supplier value added (USD m) * purchases / supplier gross output
Domestic suppliers are excluded (cross-border first-tier question). Missing GHG,
negative VA, non-positive output and input>output are preserved as excluded
observations with a reason, never converted to zero.

Concept, research design and interpretation: Rahul Shukla.
Engineering assistance: OpenAI Codex and Anthropic Claude Code.
"""
import argparse, csv, datetime, gzip, hashlib, io, json, os, zipfile

csv.field_size_limit(10 ** 7)
FD = {"HFCE", "NPISH", "GGFC", "GFCF", "INVNT", "DPABR"}
NONSEC = {"VA", "OUT", "TLS", "V1"}
ICIO_URL = "https://www.oecd.org/en/data/datasets/inter-country-input-output-tables.html"
GHG_URL = "https://www.oecd.org/en/data/datasets/greenhouse-gas-footprint-indicators.html"


def is_sector(label):
    if "_" not in label:
        return False
    c, ind = label.split("_", 1)
    return len(c) == 3 and c.isalpha() and ind not in FD


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def read_member(zip_path, suffix):
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n.endswith(suffix)]
        if len(names) != 1:
            raise SystemExit(f"Expected exactly one *{suffix} in {zip_path}, found {len(names)}")
        return z.read(names[0])


def load_labels(readme_xlsx):
    import openpyxl
    wb = openpyxl.load_workbook(readme_xlsx, read_only=True, data_only=True)
    ws = wb["Area_Activities"]
    rows = [[c for c in r] for r in ws.iter_rows(values_only=True)]
    countries, acts, isic = {}, {}, {}
    for r in rows[3:]:
        if r[2] and r[3]:
            countries[str(r[2]).strip()] = str(r[3]).strip()
        if len(r) > 6 and r[5] and r[6]:
            countries[str(r[5]).strip()] = str(r[6]).strip()
    for r in rows[3:53]:
        if len(r) > 10 and r[9] and r[10]:
            code = str(r[9]).strip()
            acts[code] = str(r[10]).strip()
            isic[code] = str(r[11]).strip() if len(r) > 11 and r[11] else ""
    return countries, acts, isic


def load_ghg(ghg_bytes):
    ghg = {}
    r = csv.reader(io.StringIO(ghg_bytes.decode("utf-8-sig")))
    next(r)
    for row in r:
        if row[1] == "PROD_GHG" and row[0] == "2022" and row[4] == "T_CO2E":
            try:
                ghg[(row[2], row[3])] = float(row[6])  # millions of tonnes CO2e
            except ValueError:
                pass
    return ghg


def load_supplier_meta(icio_bytes, ghg):
    r = csv.reader(io.StringIO(icio_bytes.decode("utf-8-sig")))
    header = next(r)
    jout = header.index("OUT")
    va_by_col, out_by_row = {}, {}
    for row in r:
        lab = row[0]
        if lab == "VA":
            for j in range(1, jout):
                if is_sector(header[j]):
                    try:
                        va_by_col[header[j]] = float(row[j])
                    except ValueError:
                        va_by_col[header[j]] = None
            continue
        if lab in NONSEC or not is_sector(lab):
            continue
        try:
            out_by_row[lab] = float(row[jout])
        except ValueError:
            out_by_row[lab] = None
    meta = {}
    for lab, out in out_by_row.items():
        c, ind = lab.split("_", 1)
        va = va_by_col.get(lab)
        ghg_mt = ghg.get((c, ind))
        if ghg_mt is None:
            reason = "missing_ghg"
        elif out is None or out <= 0:
            reason = "nonpositive_output"
        elif va is None or va < 0:
            reason = "negative_va"
        else:
            reason = None
        meta[lab] = {"country": c, "industry": ind, "out": out, "va": va,
                     "ghg_t": ghg_mt * 1e6 if ghg_mt is not None else None, "reason": reason}
    return header, meta


def build_chunk(icio_bytes, header, meta, buyers):
    idx = {b: header.index(b) for b in buyers}
    bctry = {b: b.split("_", 1)[0] for b in buyers}
    acc = {b: {"m_c": [], "m_i": [], "m_in": [], "m_g": [], "m_va": [],
               "x_c": [], "x_i": [], "x_in": [], "x_r": [],
               "fin": 0.0, "fmatch": 0.0, "aghg": 0.0, "ava": 0.0, "reasons": {}} for b in buyers}
    r = csv.reader(io.StringIO(icio_bytes.decode("utf-8-sig")))
    next(r)
    for row in r:
        lab = row[0]
        if lab == "VA" or lab in NONSEC or not is_sector(lab):
            continue
        m = meta.get(lab)
        if m is None:
            continue
        cr = m["country"]
        for b in buyers:
            if cr == bctry[b]:
                continue
            cell = row[idx[b]]
            if cell in ("0", "", "0.0"):
                continue
            try:
                flow = float(cell)
            except ValueError:
                continue
            if flow <= 0:
                continue
            a = acc[b]
            a["fin"] += flow
            reason = m["reason"]
            if reason is None and flow > m["out"] * 1.01:
                reason = "input_gt_output"
            if reason is not None:
                a["x_c"].append(cr); a["x_i"].append(m["industry"])
                a["x_in"].append(flow); a["x_r"].append(reason)
                a["reasons"][reason] = a["reasons"].get(reason, 0) + 1
                continue
            ag = m["ghg_t"] * flow / m["out"]
            av = m["va"] * flow / m["out"]
            a["fmatch"] += flow; a["aghg"] += ag; a["ava"] += av
            a["m_c"].append(cr); a["m_i"].append(m["industry"])
            a["m_in"].append(flow); a["m_g"].append(ag); a["m_va"].append(av)
    return {b: finalize(b, acc[b]) for b in buyers}


def finalize(buyer, a):
    c, ind = buyer.split("_", 1)
    order = sorted(range(len(a["m_g"])), key=lambda i: a["m_g"][i], reverse=True)
    fin = a["fin"]
    return {
        "schema": 2, "year": 2022, "buyer": buyer, "country": c, "industry": ind,
        "totals": {
            "foreign_input_usd_m": round(fin, 4),
            "matched_input_usd_m": round(a["fmatch"], 4),
            "unmatched_input_usd_m": round(fin - a["fmatch"], 4),
            "input_value_share": round(a["fmatch"] / fin, 8) if fin > 0 else 0.0,
            "matched_link_count": len(a["m_g"]),
            "excluded_link_count": len(a["x_r"]),
            "allocated_ghg_t": round(a["aghg"], 4),
            "allocated_va_usd_m": round(a["ava"], 6),
            "excluded_reasons": a["reasons"],
        },
        "links": {
            "country": [a["m_c"][i] for i in order],
            "industry": [a["m_i"][i] for i in order],
            "input_usd_m": [round(a["m_in"][i], 4) for i in order],
            "alloc_ghg_t": [round(a["m_g"][i], 3) for i in order],
            "alloc_va_usd_m": [round(a["m_va"][i], 4) for i in order],
        },
        "excluded": {
            "country": a["x_c"], "industry": a["x_i"],
            "input_usd_m": [round(v, 4) for v in a["x_in"]], "reason": a["x_r"],
        },
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--icio-zip", required=True)
    ap.add_argument("--ghg-zip", required=True)
    ap.add_argument("--readme", required=True)
    ap.add_argument("--out", default=os.path.join(here, "..", "data"))
    ap.add_argument("--chunk", type=int, default=300)
    args = ap.parse_args()

    print("Reading source archives…")
    icio_bytes = read_member(args.icio_zip, "2022_SML.csv")
    ghg_bytes = read_member(args.ghg_zip, "DF_MAIN.csv")
    countries, acts, isic = load_labels(args.readme)

    ghg = load_ghg(ghg_bytes)
    header, meta = load_supplier_meta(icio_bytes, ghg)
    buyers = [h for h in header[1:] if h not in NONSEC and is_sector(h)]
    print(f"buyer columns: {len(buyers)}  |  GHG sectors: {len(ghg)}  |  labels: {len(acts)} sectors")

    out = os.path.abspath(args.out)
    cases_dir = os.path.join(out, "cases")
    os.makedirs(cases_dir, exist_ok=True)
    for old in os.listdir(cases_dir):
        if old.endswith(".json.gz"):
            os.remove(os.path.join(cases_dir, old))

    per_economy, omitted, stats = {}, [], []
    total_bytes = n = 0
    for i in range(0, len(buyers), args.chunk):
        chunk = buyers[i:i + args.chunk]
        for b, c in build_chunk(icio_bytes, header, meta, chunk).items():
            t = c["totals"]
            if t["matched_link_count"] < 1:
                omitted.append({"code": b, "reason": "no usable matched foreign supplier link",
                                "foreign_input_usd_m": t["foreign_input_usd_m"]})
                continue
            gz = gzip.compress(json.dumps(c, separators=(",", ":")).encode("utf-8"), 9)
            with open(os.path.join(cases_dir, b + ".json.gz"), "wb") as f:
                f.write(gz)
            total_bytes += len(gz); n += 1
            per_economy.setdefault(c["country"], []).append(c["industry"])
            stats.append({"code": b, "matched": t["matched_link_count"], "excluded": t["excluded_link_count"],
                          "coverage": t["input_value_share"], "gz_bytes": len(gz)})
        print(f"  built {min(i + args.chunk, len(buyers))}/{len(buyers)} (published {n}, {total_bytes/1e6:.1f} MB)")

    order = {code: k for k, code in enumerate(acts)}
    for cc in per_economy:
        per_economy[cc] = sorted(set(per_economy[cc]), key=lambda x: order.get(x, 999))

    manifest = {
        "schema": 2, "year": 2022, "generated": datetime.date.today().isoformat(),
        "creator": "Rahul Shukla",
        "attribution": "Concept, research design and interpretation: Rahul Shukla. "
                       "Engineering assistance: OpenAI Codex and Anthropic Claude Code.",
        "method": "First-tier proportional allocation of published 2022 supplier-sector production GHG and "
                  "value added to 2022 intermediate purchases. allocated = supplier value * (buyer purchases "
                  "from supplier / supplier gross output). Domestic suppliers excluded. Missing GHG / negative "
                  "VA preserved as excluded, never zeroed. No observed contracts, loans, firm emissions, "
                  "upgrade costs or causal effects.",
        "units": {"monetary": "USD million, current basic prices (OECD ICIO 2025, 2022 table)",
                  "ghg": "tonnes CO2e, production-based (OECD GHG Footprints PROD_GHG, 2022)"},
        "sources": {
            "icio": {"name": "OECD Inter-Country Input-Output (ICIO) 2025 release, 2022 table (SML/Regular)",
                     "file": "ICIO/2025/Regular/2016-2022_SML.zip -> 2022_SML.csv", "url": ICIO_URL,
                     "zip_sha256": sha256_file(args.icio_zip), "csv_sha256": sha256_bytes(icio_bytes)},
            "ghg": {"name": "OECD Greenhouse Gas Footprints, production-based emissions (PROD_GHG), MAIN extract to 2022",
                    "file": "GHG Datasets/MAIN_csv.zip -> DF_MAIN.csv", "url": GHG_URL,
                    "zip_sha256": sha256_file(args.ghg_zip), "csv_sha256": sha256_bytes(ghg_bytes)},
            "labels": {"name": "OECD ICIO 2025 ReadMe (official area and activity labels)",
                       "file": "ICIO/2025/Regular/ReadMe_ICIO_small.xlsx"},
        },
        "inclusion_rule": "Every buyer economy x industry with >=1 usable matched foreign supplier link is "
                          "published as cases/<CODE>.json.gz. Buyers with zero matched foreign links are "
                          "omitted and listed under 'omitted'. No case is truncated.",
        "countries": {cc: countries[cc] for cc in sorted(per_economy)},
        "industries": dict(acts), "isic": dict(isic),
        "cases": per_economy, "buyer_count": n, "omitted_count": len(omitted), "omitted": omitted,
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))

    deu = next((s for s in stats if s["code"] == "DEU_C29"), None)
    print(f"\nPUBLISHED {n} cases ({total_bytes/1e6:.1f} MB), {len(omitted)} omitted; "
          f"manifest {os.path.getsize(os.path.join(out,'manifest.json'))/1024:.1f} KB")
    if deu:
        print(f"self-check DEU_C29: matched={deu['matched']} (expect 3419) "
              f"excluded={deu['excluded']} (expect 279) coverage={deu['coverage']*100:.1f}% (expect 86.8%)")


if __name__ == "__main__":
    main()
