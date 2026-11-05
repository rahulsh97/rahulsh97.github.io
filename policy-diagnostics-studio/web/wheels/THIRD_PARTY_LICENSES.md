# Third-party wheels served with the browser runtime

| Wheel | Licence | Source | Note |
|---|---|---|---|
| linearmodels 7.1 | University of Illinois/NCSA Open Source License (licence text included in the wheel's dist-info) | PyPI `linearmodels==7.1` (Kevin Sheppard) | Repackaged as a pure-Python wheel: the optional compiled helper `panel/_utility` (used only for absorbing regressions, not by `PanelOLS`) and the test suite are omitted; all other files are unchanged. |
| formulaic 1.2.2 | MIT | PyPI | unchanged |
| pyhdfe 0.2.1 | MIT | PyPI | unchanged |
| mypy_extensions 1.2.0 | MIT | PyPI | unchanged |
| interface_meta 2.0.1 | MIT | PyPI | unchanged |

Loaded at runtime from public CDNs (not redistributed here): Pyodide 314.0.7 and its packages (MPL-2.0 and the
packages' own licences, jsDelivr), WebLLM 0.2.87 (Apache-2.0, jsDelivr), Qwen3-4B q4f16_1 MLC weights (Apache-2.0,
Hugging Face `mlc-ai/Qwen3-4B-q4f16_1-MLC`).
