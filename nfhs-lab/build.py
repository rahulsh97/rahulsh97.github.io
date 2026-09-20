"""Build a compact NFHS-4/5 district extract from the attributed aggregate CSV.

Usage: python nfhs-lab/build.py /path/to/NFHS-5-Districts.csv
The input must be the pinned Pratap Vardhan revision documented in README.md.
"""
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

SOURCE_SHA256 = "55fa761bb577aa4f221751064fecb4e502ff213a08b409e0604f9ff9c53b91ce"
INDICATORS = {
    "sanitation": ("Improved sanitation", "9."),
    "fuel": ("Clean cooking fuel", "10."),
    "schooling": ("Women's 10+ years of schooling", "15."),
    "antenatal": ("Four or more antenatal visits", "33."),
    "births": ("Institutional births", "42."),
    "stunting": ("Child stunting", "73."),
    "underweight": ("Child underweight", "76."),
    "child_anaemia": ("Child anaemia", "81."),
    "women_anaemia": ("Women's anaemia", "84."),
}


def build(source):
    payload = Path(source).read_bytes()
    if hashlib.sha256(payload).hexdigest() != SOURCE_SHA256:
        raise ValueError("Unexpected source revision: inspect CSV and update the pinned checksum deliberately")
    records = list(csv.DictReader(payload.decode("utf-8-sig").splitlines()))
    by_district = {}
    for record in records:
        match = next(((key, label) for key, (label, prefix) in INDICATORS.items()
                      if record["Indicator"].startswith(prefix)), None)
        if match is None:
            continue
        key, label = match
        district_key = (record["State"], record["District"])
        entry = by_district.setdefault(district_key, {"state": record["State"],
                                                  "district": record["District"], "v": {}})
        if key in entry["v"]:
            raise ValueError(f"Duplicate indicator {key} in {district_key}")
        values = []
        for round_number in (4, 5):
            raw = record[f"NFHS-{round_number}"]
            note = record[f"NFHS-{round_number}-note"].strip()
            value = float(raw) if raw else None
            if value is not None and not 0 <= value <= 100:
                raise ValueError(f"Out-of-range percentage: {district_key} {key} round {round_number}")
            # Suppressed/small-cell values are not shown or analysed.
            values.append(None if note else value)
        entry["v"][key] = values
    entries = sorted(by_district.values(), key=lambda x: (x["state"], x["district"]))
    assert len(entries) == 341
    assert len({x["state"] for x in entries}) == 21
    for entry in entries:
        assert len(entry["v"]) == len(INDICATORS)
    paired = Counter({key: sum(all(v is not None for v in e["v"][key]) for e in entries)
                      for key in INDICATORS})
    assert paired["fuel"] == paired["stunting"] == 262
    result = {
        "source": "Pratap Vardhan, NFHS-5 district fact-sheet transcription (CC BY 4.0); original MoHFW/IIPS NFHS-4 and NFHS-5 fact sheets",
        "source_url": "https://github.com/pratapvardhan/NFHS-5",
        "source_commit": "93c67fed2403c8e533d178d293c5ba0411892b1e",
        "source_sha256": SOURCE_SHA256,
        "rounds": ["NFHS-4 (2015–16)", "NFHS-5 (2019–21)"],
        "indicators": {key: label for key, (label, _) in INDICATORS.items()},
        "matched_counts": dict(paired),
        "districts": entries,
    }
    destination = Path(__file__).parent / "data.json"
    destination.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Built {destination}: {len(entries)} districts, {len(INDICATORS)} indicators; {paired['stunting']} comparable stunting pairs")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python nfhs-lab/build.py /path/to/NFHS-5-Districts.csv")
    build(sys.argv[1])
