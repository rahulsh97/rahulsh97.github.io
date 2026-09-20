import csv
import tempfile
import unittest
from pathlib import Path
from scripts.build_case import build


class AccountingTest(unittest.TestCase):
    def test_real_io_accounting_with_a_tiny_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            io = Path(directory) / "2022_SML.csv"
            ghg = Path(directory) / "ghg.csv"
            with io.open("w", newline="") as f:
                w = csv.writer(f)
                w.writerows([["", "AAA_D01", "BBB_D29", "OUT"],
                             ["AAA_D01", "0", "20", "100"],
                             ["BBB_D29", "3", "5", "90"],
                             ["VA", "40", "35", "75"]])
            with ghg.open("w", newline="") as f:
                w = csv.writer(f)
                w.writerows([["year", "country", "industry", "production_ghg_tonnes"],
                             ["2022", "AAA", "D01", "1000"]])
            result = build(io, ghg, "BBB_D29", 2022, "https://example.org/source")
            self.assertEqual(len(result["links"]), 1)
            link = result["links"][0]
            self.assertEqual(link["allocated_direct_ghg_t"], 200)
            self.assertEqual(link["allocated_va_usd_m"], 8)
            self.assertEqual(result["unmatched_count"], 0)


if __name__ == "__main__":
    unittest.main()
