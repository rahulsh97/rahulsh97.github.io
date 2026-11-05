"""Browser replacement for pipeline/common.py (paths inside the Pyodide virtual file system; no network code).

The research engine imports only path constants from this module."""
from pathlib import Path

REPO = Path("/studio")
DATA_DIR = Path("/studio/data")
HARMONISED = DATA_DIR / "harmonised"
WAREHOUSE = Path("/studio/data/in-memory")      # not opened: the browser runtime supplies an in-memory DuckDB connection
META = REPO / "metadata"
PUBLIC_DATA = REPO / "app" / "data"
