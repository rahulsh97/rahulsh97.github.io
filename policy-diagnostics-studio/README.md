# Policy Diagnostics Studio — public research preview

Live: https://rahulsh97.github.io/policy-diagnostics-studio/

A browser build of Policy Diagnostics Studio v0.10: country explorer with regional poverty, observed spending
versus need (where data exist), hypothetical funding rules, health, education and climate diagnostics; charts, maps,
downloads and printable policy notes; data sources and methods; a browser-based AI question classifier
(Transformers.js, all-MiniLM-L6-v2, Apache 2.0 — downloaded from jsDelivr and Hugging Face on first use); and the
compatibility checker and allocation tool for your own files (processed in the browser, never uploaded).

Research tools (web/, v0.10): the Econometric Analysis workbench and AI Research Assistant on the browser engine
(Pyodide 314.0.7 from jsDelivr; per-indicator Parquet data in data/browser/). The assistant's model tasks run on
Cloudflare Workers AI (free plan, daily limit; question, plan details and computed facts are sent to Cloudflare) or
on Qwen3-4B via WebLLM in the browser. See local-tools.html.

Data: public open data only (World Bank WDI, PIP, SPID/GSAP, UN WPP, WHO GHO, UNESCO UIS, ILOSTAT, UNICEF, FAO, DHS
Program API, WorldPop, CHIRPS, Brazil SICONFI), each under its own licence as listed in Data sources & methods.
Sources whose redistribution terms are not confirmed (e.g. IMF GFS) are excluded. Boundaries: World Bank SPID
boundary package (CC BY 4.0), derived from FAO GAUL 2015, GADM, Eurostat NUTS, national offices, DHS and UN sources.

Analysis types are labelled throughout: descriptive evidence, observed expenditure comparison, hypothetical
allocation. Nothing here is a causal estimate or official World Bank output.

Built from the Studio repository with tools/build_public_site.py.
