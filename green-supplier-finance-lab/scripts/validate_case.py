#!/usr/bin/env python3
"""Developer-only case validator. Visitors never upload data — this is a build
aid that checks a published case file for internal consistency:
  * schema/shape and aligned columnar arrays;
  * coverage identity (matched + unmatched == foreign; share reconciles);
  * matched allocations strictly positive (missing is never zero);
  * excluded links carry a valid reason and are never counted as matched.

Usage: python scripts/validate_case.py data/cases/DEU_C29.json.gz [more…]
"""
import gzip, json, sys

VALID_REASONS = {"missing_ghg", "negative_va", "nonpositive_output", "input_gt_output"}


def load(path):
    raw = open(path, "rb").read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw)


def check(path):
    c = load(path)
    errs = []
    t = c["totals"]; L = c["links"]; X = c["excluded"]
    n = len(L["country"])
    for k in ("industry", "input_usd_m", "alloc_ghg_t", "alloc_va_usd_m"):
        if len(L[k]) != n:
            errs.append(f"matched array '{k}' length {len(L[k])} != {n}")
    if t["matched_link_count"] != n:
        errs.append(f"matched_link_count {t['matched_link_count']} != {n} links")
    xn = len(X["reason"])
    for k in ("country", "industry", "input_usd_m"):
        if len(X[k]) != xn:
            errs.append(f"excluded array '{k}' length {len(X[k])} != {xn}")
    if t["excluded_link_count"] != xn:
        errs.append(f"excluded_link_count {t['excluded_link_count']} != {xn}")
    if any(r not in VALID_REASONS for r in X["reason"]):
        errs.append("excluded link has an unknown reason")
    # coverage identity
    if abs(t["matched_input_usd_m"] + t["unmatched_input_usd_m"] - t["foreign_input_usd_m"]) > 0.05:
        errs.append("coverage: matched + unmatched != foreign")
    if t["foreign_input_usd_m"] > 0 and abs(t["matched_input_usd_m"] / t["foreign_input_usd_m"] - t["input_value_share"]) > 1e-6:
        errs.append("coverage: input_value_share does not reconcile")
    # missing is preserved in `excluded`, never as a zero here: matched inputs are
    # strictly positive; allocations are present and non-negative (the smallest
    # links may round to 0.0, which is negligible-but-matched, not missing).
    if any(v is None or v <= 0 for v in L["input_usd_m"]):
        errs.append("matched input has a non-positive/None value")
    if any(v is None or v < 0 for v in L["alloc_ghg_t"]):
        errs.append("matched allocated emissions has a negative/None value")
    if any(v is None or v < 0 for v in L["alloc_va_usd_m"]):
        errs.append("matched allocated VA has a negative/None value")
    # ranking: default order is by allocated emissions desc
    if any(L["alloc_ghg_t"][i] < L["alloc_ghg_t"][i + 1] - 1e-6 for i in range(n - 1)):
        errs.append("matched links are not sorted by allocated emissions")
    status = "OK" if not errs else "FAIL"
    print(f"[{status}] {c['buyer']}: {n} matched, {xn} excluded, "
          f"coverage {t['input_value_share']*100:.1f}%")
    for e in errs:
        print("   -", e)
    return not errs


if __name__ == "__main__":
    paths = sys.argv[1:] or ["data/cases/DEU_C29.json.gz"]
    ok = all(check(p) for p in paths)
    sys.exit(0 if ok else 1)
