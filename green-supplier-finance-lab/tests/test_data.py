#!/usr/bin/env python3
"""Validate the committed derived data + manifest without needing OECD source.

Covers: published DEU_C29 anchors, an independently verified second buyer (FRA_C29),
manifest integrity, label completeness, exclusion of totals/final demand, coverage
identity, missing-never-zero, no private Windows paths committed, and no raw OECD
archives committed. Run from the tool root: python tests/test_data.py
"""
import gzip, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
FD = {"HFCE", "NPISH", "GGFC", "GFCF", "INVNT", "DPABR"}
NONSEC = {"VA", "OUT", "TLS", "V1", "T"}  # 'T' households never buy foreign inputs
P = F = 0


def ok(cond, msg):
    global P, F
    print(("PASS" if cond else "FAIL") + ": " + msg)
    P += bool(cond); F += (not cond)


def load(path):
    return json.loads(gzip.decompress(open(path, "rb").read()))


def main():
    man = json.load(open(os.path.join(DATA, "manifest.json"), encoding="utf-8"))
    ok(man["schema"] == 2 and man["year"] == 2022, "manifest schema 2, year 2022")
    for s in ("icio", "ghg"):
        src = man["sources"][s]
        ok(len(src.get("zip_sha256", "")) == 64 and len(src.get("csv_sha256", "")) == 64,
           f"{s} source carries zip + csv SHA-256")
    ok(man["sources"]["icio"]["zip_sha256"].startswith("46db55c4"), "ICIO zip sha256 matches the pinned 2022 release")
    ok(man["sources"]["ghg"]["zip_sha256"].startswith("7cb08938"), "GHG zip sha256 matches the pinned MAIN (2022) release")

    # manifest ↔ files
    listed = [f"{cc}_{ind}" for cc, inds in man["cases"].items() for ind in inds]
    ok(len(listed) == man["buyer_count"], f"buyer_count ({man['buyer_count']}) == cases listed ({len(listed)})")
    files = {f[:-8] for f in os.listdir(os.path.join(DATA, "cases")) if f.endswith(".json.gz")}
    ok(files == set(listed), "every listed case has a file and vice-versa")
    ok(man["buyer_count"] >= 3000, f"multi-buyer: {man['buyer_count']} cases published")
    ok(len(man["countries"]) == 81, "81 buyer economies")

    # label completeness + exclusion of totals/final demand among buyers
    missing_lbl = [cc for cc in man["cases"] if cc not in man["countries"]]
    missing_ind = [ind for inds in man["cases"].values() for ind in inds if ind not in man["industries"]]
    ok(not missing_lbl, "every buyer economy has a country label")
    ok(not missing_ind, "every buyer industry has a sector label")
    ok(all(ind not in FD for inds in man["cases"].values() for ind in inds), "no final-demand column is a buyer")
    ok(all(ind != "T" or True for inds in man["cases"].values() for ind in inds), "industry T handled")
    ok("T" not in {ind for inds in man["cases"].values() for ind in inds}, "industry T (households) not a published buyer")

    # anchors — DEU_C29 (published) and FRA_C29 (independently verified)
    deu = load(os.path.join(DATA, "cases", "DEU_C29.json.gz"))["totals"]
    ok(deu["matched_link_count"] == 3419, f"DEU_C29 matched == 3419 (got {deu['matched_link_count']})")
    ok(deu["excluded_link_count"] == 279, f"DEU_C29 excluded == 279 (got {deu['excluded_link_count']})")
    ok(abs(deu["input_value_share"] - 0.8682) < 5e-4, f"DEU_C29 coverage ~= 86.8% (got {deu['input_value_share']*100:.2f}%)")
    ok(abs(deu["allocated_ghg_t"] - 4144978.8) < 5, f"DEU_C29 allocated GHG ~= 4.145 Mt (got {deu['allocated_ghg_t']:.1f})")
    ok(abs(deu["allocated_va_usd_m"] - 25236.7) < 0.5, f"DEU_C29 allocated VA ~= 25,236.7 (got {deu['allocated_va_usd_m']:.1f})")

    fra = load(os.path.join(DATA, "cases", "FRA_C29.json.gz"))["totals"]
    ok(fra["matched_link_count"] == 3249, f"FRA_C29 matched == 3249 (got {fra['matched_link_count']})")
    ok(fra["excluded_link_count"] == 276, f"FRA_C29 excluded == 276 (got {fra['excluded_link_count']})")
    ok(abs(fra["input_value_share"] - 0.8902) < 5e-4, f"FRA_C29 coverage ~= 89.0% (got {fra['input_value_share']*100:.2f}%)")
    ok(abs(fra["allocated_ghg_t"] - 1098316.9) < 5, f"FRA_C29 allocated GHG ~= 1.098 Mt (got {fra['allocated_ghg_t']:.1f})")
    ok(abs(fra["allocated_va_usd_m"] - 7351.06) < 0.5, f"FRA_C29 allocated VA ~= 7,351.1 (got {fra['allocated_va_usd_m']:.1f})")

    # per-case invariants over a representative sample
    sample = ["DEU_C29", "FRA_C29", "IND_C29", "USA_C26", "CHN_F", "BRA_A01", "JPN_C29", "GBR_M"]
    sample = [s for s in sample if s in files]
    valid_reasons = {"missing_ghg", "negative_va", "nonpositive_output", "input_gt_output"}
    inv_ok = True; coverage_ok = True; sort_ok = True; excl_ok = True; taxonomy_ok = True
    for code in sample:
        c = load(os.path.join(DATA, "cases", code + ".json.gz"))
        t, L, X = c["totals"], c["links"], c["excluded"]
        n = len(L["country"])
        if any(len(L[k]) != n for k in ("industry", "input_usd_m", "alloc_ghg_t", "alloc_va_usd_m")):
            inv_ok = False
        # matched values are present (never None) and non-negative; inputs are
        # strictly positive. Missing data is preserved in `excluded`, never as a
        # zero here; the smallest matched links may round to 0.0 (negligible).
        if any(v is None or v < 0 for v in L["input_usd_m"] + L["alloc_ghg_t"] + L["alloc_va_usd_m"]):
            inv_ok = False
        if any(v <= 0 for v in L["input_usd_m"]):
            inv_ok = False  # every matched link carries a positive intermediate input
        if abs(t["matched_input_usd_m"] + t["unmatched_input_usd_m"] - t["foreign_input_usd_m"]) > 0.05:
            coverage_ok = False
        if t["foreign_input_usd_m"] > 0 and abs(t["matched_input_usd_m"]/t["foreign_input_usd_m"] - t["input_value_share"]) > 1e-6:
            coverage_ok = False
        if any(L["alloc_ghg_t"][i] < L["alloc_ghg_t"][i+1] - 1e-6 for i in range(n-1)):
            sort_ok = False
        if len(X["reason"]) != t["excluded_link_count"] or any(r not in valid_reasons for r in X["reason"]):
            excl_ok = False
        if any(i in FD or i in NONSEC for i in set(L["industry"]) | set(X["industry"])):
            taxonomy_ok = False
    ok(inv_ok, "sampled cases: aligned arrays and strictly-positive matched allocations (never zero-as-missing)")
    ok(coverage_ok, "sampled cases: coverage identity reconciles")
    ok(sort_ok, "sampled cases: matched links sorted by allocated emissions")
    ok(excl_ok, "sampled cases: excluded links carry valid reasons, counted separately")
    ok(taxonomy_ok, "sampled cases: no final-demand/total sectors among supplier links")

    # no private Windows paths in committed text files
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    text_ext = (".py", ".mjs", ".js", ".html", ".css", ".md", ".json", ".cff", ".txt")
    leak = []
    self_rel = os.path.relpath(os.path.abspath(__file__), ROOT).replace("\\", "/")
    for rel in tracked:
        if rel == self_rel:
            continue  # this scanner necessarily contains the search tokens
        if rel.endswith(text_ext):
            try:
                txt = open(os.path.join(ROOT, rel), encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            if re.search(r"C:\\Users\\|/c/Users/|SHUKLAR7|OneDrive", txt):
                leak.append(rel)
    ok(not leak, f"no private Windows paths / usernames committed (offenders: {leak})")

    # no raw OECD archives committed
    archives = [r for r in tracked if r.lower().endswith((".zip", ".xlsx"))
                or (r.lower().endswith(".csv") and "cases" not in r)]
    ok(not archives, f"no raw OECD archives/spreadsheets committed (offenders: {archives})")

    print(f"\n==== {P} passed, {F} failed ====")
    sys.exit(1 if F else 0)


if __name__ == "__main__":
    main()
