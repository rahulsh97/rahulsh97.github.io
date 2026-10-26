"""Build data.json for the Maize Compensation Lab from the validated aggregate tables.

Every input in data/*.csv is an aggregate output of validated run
maize_20261025T173130_1dafdd. Its SHA-256 must match data/run_manifest.json, otherwise the
build stops. Nothing is simulated or re-estimated here: values are copied and rounded for
display. Run from the repository root:  python maize-compensation-lab/build.py
"""
import csv
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
RUN_ID = "maize_20261025T173130_1dafdd"
TABLES = ["maize_scenario_grid", "maize_central_rules", "maize_boot_summary", "maize_boot_diffs",
          "maize_boot_rank", "maize_district_diagnostics", "maize_variance_decomposition",
          "maize_incidence_deciles", "maize_shock_summary", "maize_gate"]
RULES = ["R0_none", "R1_universal", "R2_geographic", "R3_pmt", "R4_exposure", "R5_pmt_exposure",
         "B1_perfect_gap", "B2_perfect_loss_postpoor", "B3_perfect_loss_initpoor"]
OBJECTIVES = ["P1", "P2", "loss_comp"]
# The three scenarios that have survey-bootstrap uncertainty (all others are point estimates)
BOOT_SCENARIOS = {"central": (0.25, 0.5, 0.85, 0.0, 0.5, "FALSE", "x52"),
                  "lambda0": (0.25, 0.0, 0.85, 0.0, 0.5, "FALSE", "x52"),
                  "lambda1": (0.25, 1.0, 0.85, 0.0, 0.5, "FALSE", "x52")}


def r(x, nd=4):
    return None if x in ("", "NA", None) else round(float(x), nd)


def read(name):
    with open(DATA / f"{name}.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def key(pi, lam, theta, eps, kappa, green, annual):
    return f"{float(pi):g}|{float(lam):g}|{float(theta):g}|{float(eps):g}|{float(kappa):g}|{green}|{annual}"


# ---- provenance gate --------------------------------------------------------------
manifest = json.loads((DATA / "run_manifest.json").read_text(encoding="utf-8"))
assert manifest["run_id"] == RUN_ID and manifest["status"] == "completed"
assert manifest["validation"]["gate_passed"] and manifest["validation"]["synthetic_tests"]["passed"]
outputs = {Path(k).name: v for k, v in manifest["outputs"].items()}
for t in TABLES:
    h = hashlib.sha256((DATA / f"{t}.csv").read_bytes()).hexdigest()
    if outputs.get(f"{t}.csv") != h:
        raise SystemExit(f"{t}.csv does not match the validated run manifest")

# ---- scenario grid (972 scenarios x 9 rules x 3 objectives) -------------------------
grid = {}
for row in read("maize_scenario_grid"):
    k = key(row["pi"], row["lambda"], row["theta"], row["eps"], row["kappa"], row["green"], row["annual"])
    g = grid.setdefault(k, {"P1_shock": r(row["P1_shock"]), "rules": {}})
    g["rules"][row["rule"]] = [r(row[o], 6) for o in OBJECTIVES]   # 6 dp: PMT vs PMT+exposure differ by ~1e-4
assert len(grid) == 972 and all(len(v["rules"]) == len(RULES) for v in grid.values())

params = {
    "pi": [0.1, 0.25, 0.5], "lambda": [0, 0.5, 1], "theta": [0.7, 0.85, 1], "eps": [0, -0.3, -0.6],
    "kappa": [0.25, 0.5, 1], "green": ["FALSE", "TRUE"], "annual": ["x52", "seasonal"]}
central_key = key(*BOOT_SCENARIOS["central"])

# ---- bootstrap (U3 joint, three scenarios) -------------------------------------------
boot = {}
for name, s in BOOT_SCENARIOS.items():
    boot[key(*s)] = {"name": name, "level": {}, "diff_vs_R3": {}, "prob_best": {}}
summ = [x for x in read("maize_boot_summary") if x["component"] == "U3"]
diffs = [x for x in read("maize_boot_diffs") if x["component"] == "U3"]
rank = [x for x in read("maize_boot_rank") if x["component"] == "U3"]
name_to_key = {v: key(*s) for v, s in BOOT_SCENARIOS.items()}
for x in summ:
    boot[name_to_key[x["scenario"]]]["level"].setdefault(x["rule"], {})[x["objective"]] = \
        [r(x["full_sample"]), r(x["se"]), r(x["lo"]), r(x["hi"])]
for x in diffs:
    boot[name_to_key[x["scenario"]]]["diff_vs_R3"].setdefault(x["rule"], {})[x["objective"]] = \
        [r(x["diff_vs_R3_mean"]), r(x["diff_se"]), r(x["diff_lo"]), r(x["diff_hi"])]
for x in rank:
    boot[name_to_key[x["scenario"]]]["prob_best"].setdefault(x["objective"], {})[x["rule"]] = r(x["prob_best"], 3)

# ---- central-scenario detail -------------------------------------------------------
central_rules = {x["rule"]: {k: r(x[k]) for k in ("P1", "P2", "P0", "P0_ultra", "loss_comp", "exclusion_error",
                                                  "inclusion_error", "budget_share_to_poor")}
                 for x in read("maize_central_rules")}
budget_G = r(read("maize_central_rules")[0]["budget_G"], 0)
deciles = {}
for x in read("maize_incidence_deciles"):
    deciles.setdefault(x["rule"], []).append({"dec": int(x["dec"]), "dy_over_c0": r(x["dy_over_c0"], 3),
                                              "transfer_over_c0": r(x["transfer_over_c0"], 3),
                                              "share_net_buyer": r(x["share_net_buyer"], 3),
                                              "share_seller": r(x["share_seller"], 3),
                                              "budget_share": r(x["budget_share"], 4)})
for v in deciles.values():
    v.sort(key=lambda d: d["dec"])
districts = [{"name": x["district_name"], "rel": r(x["rel"], 3), "rel_se": r(x["se.rel"], 3),
              "P1_post": r(x["P1_post"], 2), "P1_post_se": r(x["se.P1_post"], 2),
              "dP1": r(x["dP1"], 3), "dP1_se": r(x["se.dP1"], 3),
              "net_buyer": r(x["net_buyer"], 3), "seller": r(x["seller"], 3),
              "loss_share": r(x["loss_share"], 4), "pop_share": r(x["pop_share"], 4),
              "rank_median": r(x["rank_P1_post_median"], 1), "rank_lo": r(x["rank_P1_post_lo"], 1),
              "rank_hi": r(x["rank_P1_post_hi"], 1), "prob_top8": r(x["prob_top8_P1_post"], 3),
              "n_ea": int(float(x["n_ea"]))}
             for x in read("maize_district_diagnostics")]
assert min(d["n_ea"] for d in districts) >= 5        # disclosure rule: no estimate below 5 EAs
vardec = [{"outcome": x["outcome"], "partition": x["partition"], "R2": r(x["R2_between"], 4)}
          for x in read("maize_variance_decomposition")]
shock = {x["measure"]: r(x["value"], 3) for x in read("maize_shock_summary")}
gate = {x["id"]: x["value"] for x in read("maize_gate")}
market = dict(kv.split("=") for kv in gate["I1"].split("; "))
market = {k: float(v) for k, v in market.items()}

out = {
    "meta": {"run_id": RUN_ID, "survey": "Malawi Sixth Integrated Household Survey (IHS6) 2024/25",
             "households": 12502, "eas": 782, "replicates": manifest["parameters"]["bootstrap"]["replicates"],
             "scenarios": len(grid), "budget_G_central_mwk": budget_G,
             "note": "Precomputed aggregate results. No simulation runs in the browser."},
    "params": params, "central_key": central_key, "rules": RULES, "objectives": OBJECTIVES,
    "grid": grid, "boot": boot, "central_rules": central_rules, "deciles": deciles,
    "districts": districts, "vardec": vardec, "shock": shock, "market": market}
(HERE / "data.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(f"data.json: {len(grid)} scenarios, {len(boot)} bootstrap scenarios, {len(districts)} districts, "
      f"{(HERE / 'data.json').stat().st_size / 1024:.0f} KB")
