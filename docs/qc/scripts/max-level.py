"""Largest |level_m| in every year file of the public store, per source, from
each file's Parquet footer statistics (no data pages are read), and every
file whose levels reach beyond 1,024 m, where the store's 32-bit storage stops
keeping 0.1 mm. The file list comes from stations/years/<source>.parquet.

    T=64 python -I docs/qc/scripts/max-level.py bodc,cdec,coops,... [limit]

T is the number of threads (48 by default). About 150 files a second at 64.
Needs duckdb (pip install duckdb).
"""
import sys, json, time, threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
import duckdb

STORE = "https://stillwell.openwaters.io"
SOURCES = sys.argv[1].split(",")
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else None
main = duckdb.connect(); main.execute("install httpfs; load httpfs")
files = []
for s in SOURCES:
    for sid, epoch, year in main.execute(f"select id, epoch, year from '{STORE}/stations/years/{s}.parquet' where epoch is not null and year is not null").fetchall():
        src, source_id = sid.split("/", 1)
        files.append((s, sid, epoch, year, f"{STORE}/obs/{src}/{quote(quote(source_id, safe="!'()*"), safe='')}" + ("" if epoch == 1 else f"/{epoch}") + f"/{year}.parquet"))
if LIMIT: files = files[:LIMIT]
local = threading.local()
def stat(f):
    if not hasattr(local, "c"):
        local.c = duckdb.connect(); local.c.execute("load httpfs")
    for attempt in range(3):
        try:
            r = local.c.execute(f"select min(stats_min::double), max(stats_max::double), sum(stats_null_count) from parquet_metadata('{f[4]}') where path_in_schema = 'level_m'").fetchone()
            return f, r, None
        except Exception as e:
            err = str(e)[:120]; time.sleep(1)
    return f, None, err
t = time.time()
out = {}; errors = []; top = []
with ThreadPoolExecutor(int(__import__("os").environ.get("T","48"))) as ex:
    for f, r, err in ex.map(stat, files):
        if err: errors.append((f[4], err)); continue
        lo, hi, nulls = r
        m = max(abs(lo), abs(hi)) if lo is not None else None
        o = out.setdefault(f[0], {"files": 0, "max_abs": 0.0, "where": None, "nostats": 0})
        o["files"] += 1
        if m is None: o["nostats"] += 1; continue
        if m > o["max_abs"]: o["max_abs"], o["where"] = m, f"{f[1]} epoch {f[2]} {f[3]} (min {lo}, max {hi})"
        if m > 1024: top.append((m, f[1], f[2], f[3], lo, hi))
print(f"{len(files)} files in {time.time()-t:.0f} s; {len(errors)} errors", file=sys.stderr)
for s, o in sorted(out.items()): print(s, json.dumps(o))
print("over 1024 m:", len(top)); [print(x) for x in sorted(top, reverse=True)]
for e in errors[:10]: print("ERR", e)
