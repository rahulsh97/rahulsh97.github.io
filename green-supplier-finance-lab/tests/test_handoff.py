import math
import unittest
from pathlib import Path

from scripts.build_from_handoff import build


INPUT = Path(__file__).resolve().parents[1] / "inputs" / "green-finance-oecd-handoff.zip"


class HandoffCaseTest(unittest.TestCase):
    def test_actual_2022_case_reconciles_and_preserves_exclusions(self):
        case = build(INPUT)
        c = case["coverage"]
        self.assertEqual((case["year"], case["buyer"]), (2022, "DEU_C29"))
        self.assertEqual((c["foreign_link_count"], len(case["links"]), case["unmatched_count"]),
                         (3698, 3419, 279))
        self.assertEqual(c["excluded_reasons"], {"missing_ghg": 277, "negative_va": 2})
        self.assertAlmostEqual(c["foreign_input_usd_m"], 93951.5162, places=3)
        self.assertAlmostEqual(c["matched_input_usd_m"], 81572.3915, places=3)
        self.assertAlmostEqual(c["input_value_share"], .8682392238, places=7)
        self.assertAlmostEqual(sum(r["allocated_direct_ghg_t"] for r in case["links"]),
                               4144978.809, places=2)
        self.assertTrue(all(r["country"] != "DEU" for r in case["links"]))
        self.assertEqual(case["links"][0]["supplier"], "CHN_C20")
        self.assertTrue(all(math.isfinite(r["allocated_va_usd_m"]) for r in case["links"]))


if __name__ == "__main__":
    unittest.main()
