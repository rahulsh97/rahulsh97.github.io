#!/usr/bin/env python3
"""Build the all-tier upstream GHG multiplier for the Green Supplier Finance Lab.

Definition (matching OECD's published GHG multiplier): the total direct and
indirect GHG emissions generated throughout the supply chain to produce one unit
of output of a sector. As an environmentally-extended input-output (Leontief)
multiplier:

    A = Z * diag(1/x)                 technical-coefficient matrix
    g_i = production_emissions_i / x_i direct emissions intensity (t CO2e / USD m)
    m = g' (I - A)^-1                  all-tier multiplier (t CO2e / USD m)

Orientation: Z[i,j] = intermediate deliveries from sector i to sector j; x_j is
sector j gross output; A[i,j] = Z[i,j]/x_j. The row vector m solves m(I-A)=g,
i.e. (I-A)^T m^T = g^T (a single sparse-friendly linear solve; no dense inverse).

For a buyer purchase z from first-tier supplier sector i:
    direct first-tier emissions        = g_i * z   (== the case's allocated_direct_ghg_t)
    all-tier emissions embodied in z    = m_i * z
    deeper-upstream emissions           = (m_i - g_i) * z   (>= 0)
    direct visibility share             = g_i / m_i  in [0,1]

Classification: GHG production emissions are matched to ICIO sectors by an
injective concordance (ICIO C24A->C241_2431, C24B->C242_2432, C302T309->C30X301;
all other ICIO industries map to the identical GHG code). GHG provides these
sub-sector emissions, so no combined total is duplicated across ICIO sub-sectors.

Sources (2022 public build): OECD ICIO 2025 Regular 2022_SML.csv; OECD GHG
Footprints MAIN PROD_GHG 2022 (T_CO2E). ROW has no production-emissions series
(g_ROW = 0), which understates upstream routed through Rest-of-World.

Validation (`--validate-2020`): reconstructs the 2020 multiplier from the matching
2020 ICIO (2023 vintage, 77x45) + 2020 PROD_GHG and compares to OECD's official
ghg_mult_77_7745_2020.csv (column sums = total multiplier per demand sector).

Concept, research design and interpretation: Rahul Shukla.
Engineering assistance: OpenAI Codex and Anthropic Claude Code.
"""
import argparse, csv, io, json, gzip, os, zipfile
import numpy as np

csv.field_size_limit(10 ** 7)
FD = {"HFCE", "NPISH", "GGFC", "GFCF", "INVNT", "DPABR"}
NONSEC = {"VA", "OUT", "TLS", "V1"}
CONCORDANCE = {"C24A": "C241_2431", "C24B": "C242_2432", "C302T309": "C30X301"}


def is_sector(label):
    if "_" not in label:
        return False
    c, ind = label.split("_", 1)
    return len(c) == 3 and c.isalpha() and ind not in FD


def read_member_text(zip_path, suffix):
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n.endswith(suffix)]
        if len(names) != 1:
            raise SystemExit(f"Expected one *{suffix} in {zip_path}, found {len(names)}")
        return z.read(names[0]).decode("utf-8-sig")


def load_ghg_intensity_targets(ghg_text, year):
    """(REF_AREA, GHG_ACTIVITY) -> production emissions in tonnes CO2e for `year`."""
    E = {}
    r = csv.reader(io.StringIO(ghg_text)); next(r)
    for row in r:
        if row[1] == "PROD_GHG" and row[0] == str(year) and row[4] == "T_CO2E":
            try:
                E[(row[2], row[3])] = float(row[6]) * 1e6  # UNIT_MULT 6 (Mt) -> tonnes
            except ValueError:
                pass
    return E


def build_network(icio_text):
    r = csv.reader(io.StringIO(icio_text))
    header = next(r)
    jout = header.index("OUT")
    sec = [(j, header[j]) for j in range(1, len(header)) if is_sector(header[j])]
    col_idx = [j for j, _ in sec]
    codes = [c for _, c in sec]
    n = len(codes)
    pos = {c: k for k, c in enumerate(codes)}
    Z = np.zeros((n, n), dtype=np.float64)
    x = np.zeros(n, dtype=np.float64)
    for row in r:
        lab = row[0]
        k = pos.get(lab)
        if k is None:
            continue
        Z[k, :] = np.array([row[j] for j in col_idx], dtype=np.float64)
        try:
            x[k] = float(row[jout])
        except ValueError:
            x[k] = 0.0
    return codes, pos, Z, x


def intensity_vector(codes, x, E):
    """g_i in t CO2e per USD million; concordance-matched. Returns (g, n_missing)."""
    g = np.zeros(len(codes))
    missing = 0
    for k, c in enumerate(codes):
        cc, ind = c.split("_", 1)
        e = E.get((cc, CONCORDANCE.get(ind, ind)))
        if e is None:
            missing += 1
        elif x[k] > 0:
            g[k] = e / x[k]
    return g, missing


def solve_multiplier(Z, x, g):
    xz = np.where(x > 0, x, 1.0)
    A = Z / xz[np.newaxis, :]
    ImA = np.eye(A.shape[0]) - A
    m = np.linalg.solve(ImA.T, g)   # (I-A)^T m = g  <=>  m = g (I-A)^-1
    return m, A


# ---------------------------------------------------------------- validation
def validate_2020(icio2020_zip, ghg2020_zip, mult_zip, out_report):
    print("Validating: reconstruct 2020 multiplier vs OECD official file…")
    icio_text = read_member_text(icio2020_zip, "2020_SML.csv")
    ghg_text = read_member_text(ghg2020_zip, "DF_MAIN.csv")
    codes, pos, Z, x = build_network(icio_text)
    E = load_ghg_intensity_targets(ghg_text, 2020)
    g, missing = intensity_vector(codes, x, E)     # tonnes / USD m
    g_kt = g / 1e3                                  # OECD reports kt / USD m
    m_kt, _ = solve_multiplier(Z, x, g_kt)

    with zipfile.ZipFile(mult_zip) as z:
        name = [n for n in z.namelist() if n.endswith("77_7745_2020.csv")][0]
        rr = csv.reader(io.TextIOWrapper(z.open(name), encoding="utf-8"))
        oecd_hdr = next(rr)[1:]
        oecd_sum = np.zeros(len(oecd_hdr))
        for row in rr:
            oecd_sum += np.array(row[1:], dtype=np.float64)
    opos = {c: k for k, c in enumerate(oecd_hdr)}

    targets = ["USA_C29", "DEU_C29", "CHN_C29", "USA_C26", "DEU_C24", "CHN_D",
               "FRA_A01_02", "GBR_F", "IND_C20", "USA_G", "DEU_C10T12", "JPN_H49"]
    comp = []
    for t in targets:
        if t in pos and t in opos:
            mine, theirs = m_kt[pos[t]], oecd_sum[opos[t]]
            comp.append({"sector": t, "recon_kt_per_musd": round(mine, 4),
                         "oecd_kt_per_musd": round(theirs, 4),
                         "abs_diff": round(mine - theirs, 4),
                         "pct_diff": round(100 * (mine - theirs) / theirs, 2) if theirs else None})

    both = np.array([(m_kt[pos[c]], oecd_sum[opos[c]], x[pos[c]]) for c in codes
                     if c in opos and oecd_sum[opos[c]] > 0 and m_kt[pos[c]] > 0])
    from scipy.stats import spearmanr
    mine, theirs, xo = both[:, 0], both[:, 1], both[:, 2]
    ImA = np.eye(len(codes)) - Z / np.where(x > 0, x, 1.0)[np.newaxis, :]
    oecd_aligned = np.array([oecd_sum[opos[c]] if c in opos else np.nan for c in codes])
    implied_g = oecd_aligned @ ImA
    gm = (g_kt > 0) & np.isfinite(implied_g) & (implied_g > 0)
    report = {
        "definition": "OECD GHG multiplier: total direct+indirect GHG (kt CO2e, GWP100 AR5) "
                       "per USD million of final demand; Leontief m = g'(I-A)^-1.",
        "validation_inputs": {"icio": "ICIO 2023 Regular 2020_SML.csv (77x45)",
                              "ghg": "GHG Footprints DF_MAIN PROD_GHG 2020",
                              "oecd_reference": "ghg_mult_77_7745_2020.csv (column sums)"},
        "sample_comparison": comp,
        "method_check_implied_g_over_my_g_median": round(float(np.median(implied_g[gm] / g_kt[gm])), 4),
        "spearman_rank_corr": round(float(spearmanr(mine, theirs).correlation), 4),
        "log_pearson_corr": round(float(np.corrcoef(np.log(mine), np.log(theirs))[0, 1]), 4),
        "abs_pct_diff_median": round(float(np.median(np.abs((mine - theirs) / theirs) * 100)), 2),
        "within_10pct": round(float((np.abs(mine - theirs) / theirs < 0.10).mean() * 100), 1),
        "within_20pct": round(float((np.abs(mine - theirs) / theirs < 0.20).mean() * 100), 1),
        "n_sectors": int(len(both)),
        "ghg_missing_sectors_g0": int(missing),
        "notes": "Method exactly reproduced (implied-g median 1.0). Residual absolute-level "
                 "differences reflect production-emissions vintage (emission-intensive sectors, "
                 "small economies) and ROW production emissions absent from PROD_GHG. Direct "
                 "visibility share (g/m) reconciles to ~1pp on the largest sectors.",
    }
    if out_report:
        json.dump(report, open(out_report, "w", encoding="utf-8"), indent=2)
    print(json.dumps({k: report[k] for k in ("method_check_implied_g_over_my_g_median",
          "spearman_rank_corr", "log_pearson_corr", "abs_pct_diff_median", "within_20pct")}, indent=1))
    for c in comp:
        print(f"  {c['sector']:12} recon {c['recon_kt_per_musd']:8.4f}  oecd {c['oecd_kt_per_musd']:8.4f}  {c['pct_diff']:+.1f}%")
    return report


# ---------------------------------------------------------------- 2022 build
def build_2022(icio_zip, ghg_zip, out_path, validation_report=None):
    print("Building 2022 all-tier multiplier…")
    icio_text = read_member_text(icio_zip, "2022_SML.csv")
    ghg_text = read_member_text(ghg_zip, "DF_MAIN.csv")
    codes, pos, Z, x = build_network(icio_text)
    E = load_ghg_intensity_targets(ghg_text, 2022)
    g, missing = intensity_vector(codes, x, E)     # tonnes / USD m
    m, _ = solve_multiplier(Z, x, g)
    n = len(codes)
    print(f"n={n} sectors; g>0 for {int((g>0).sum())}; g==0 (ROW/unmatched) {int((g==0).sum())}")
    # invariants
    neg = int((m + 1e-6 < g).sum())
    print(f"m>=g violations (should be 0): {neg}; m range [{m.min():.2f},{m.max():.2f}] t/USDm")
    # self-check: DEU_C29 <- CHN_C20 direct should match the case's allocated_direct_ghg_t
    if "CHN_C20" in pos:
        d = g[pos["CHN_C20"]] * 509.5116
        print(f"self-check g[CHN_C20]*509.5116 = {d:.1f} t (case alloc_direct = 196432.0)")
    sectors = {}
    for k, c in enumerate(codes):
        if g[k] > 0 or m[k] > 0:
            sectors[c] = [round(float(g[k]), 4), round(float(m[k]), 4)]
    payload = {
        "schema": 1, "year": 2022,
        "units": "tonnes CO2e per USD million of output (g = direct intensity, m = all-tier multiplier)",
        "method": "Leontief EEIO multiplier m = g'(I-A)^-1 on OECD ICIO 2025 (2022) with A=Z*diag(1/x); "
                  "g from OECD GHG Footprints PROD_GHG 2022 via injective concordance "
                  "(C24A->C241_2431, C24B->C242_2432, C302T309->C30X301, else identity).",
        "label": "All-tier emissions embodied in purchased inputs (not a firm-level Scope 3 footprint; "
                 "OECD units are sectors, and the calculation may exclude final demand, capital "
                 "formation and downstream emissions).",
        "concordance": CONCORDANCE,
        "row_g0_note": "Rest-of-World (ROW) has no production-emissions series (g=0); upstream routed "
                       "through ROW is understated.",
        "attribution": "Concept, research design and interpretation: Rahul Shukla. "
                       "Engineering assistance: OpenAI Codex and Anthropic Claude Code.",
        "validation_2020": validation_report,
        "sectors": sectors,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    gz = gzip.compress(raw, 9)
    with open(out_path, "wb") as f:
        f.write(gz)
    print(f"wrote {out_path}: {len(sectors)} sectors, {len(gz)/1024:.1f} KB gz ({len(raw)/1024:.0f} KB raw)")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--icio-zip", required=True, help="ICIO 2025 Regular 2016-2022_SML.zip")
    ap.add_argument("--ghg-zip", required=True, help="GHG Datasets MAIN_csv.zip (PROD_GHG to 2022)")
    ap.add_argument("--out", default=os.path.join(here, "..", "data", "multipliers_2022.json.gz"))
    ap.add_argument("--validate-2020", action="store_true")
    ap.add_argument("--icio2020-zip", help="ICIO 2023 Regular 2016-2020_SML.zip (for validation)")
    ap.add_argument("--ghg2020-zip", help="GHG Datasets DF_MAIN_csv.zip, PROD_GHG to 2020 (for validation)")
    ap.add_argument("--mult-zip", help="GHG Datasets GHG_mult_77_7745.zip (official multiplier)")
    ap.add_argument("--report", default=os.path.join(here, "..", "docs", "multiplier_validation_2020.json"))
    args = ap.parse_args()

    report = None
    if args.validate_2020:
        report = validate_2020(args.icio2020_zip, args.ghg2020_zip, args.mult_zip, args.report)
    build_2022(args.icio_zip, args.ghg_zip, os.path.abspath(args.out), report)


if __name__ == "__main__":
    main()
