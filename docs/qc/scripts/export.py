"""Exports one station's levels for a year and the years either side from the
public store to JSON, with the station's kind, tidal verdict and tide_m, as
requalify reads them: one datum epoch at a time, the current one by default.

    python -I docs/qc/scripts/export.py bodc/jer 2025 jer2025.json [epoch]

A neighboring year with no file in the years file is exported empty, with a
note; a year the years file lists that can't be read, or reads empty, fails.
Needs duckdb (pip install duckdb).
"""

import math
import json
import sys

import duckdb

STORE = "https://stillwell.openwaters.io"

if len(sys.argv) not in (4, 5):
    sys.exit(__doc__)
sid, year, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
source, source_id = sid.split("/", 1)

con = duckdb.connect()
con.execute("install httpfs; load httpfs; set TimeZone='UTC'")

station = con.execute(
    f"select kind, tidal, tide_m, interval_s, list_transform(epochs, lambda e: {{'id': e.id, 'state': e.state}}) from '{STORE}/stations.parquet' where id = ?",
    [sid],
).fetchone()
if station is None:
    sys.exit(f"{sid} isn't in stations.parquet")
kind, tidal, tide_m, interval_s, epochs = station
# The current epoch is the last open one (currentEpoch in src/epochs.ts); the verdict is judged on it.
current = [e for e in epochs if e["state"] == "open"][-1]["id"]
epoch = int(sys.argv[4]) if len(sys.argv) == 5 else current
if epoch != current:
    print(f"note: epoch {epoch} isn't the current one ({current}), whose verdict tidal/tide_m is", file=sys.stderr)

listed = {
    y
    for (y,) in con.execute(
        f"select year from '{STORE}/stations/years/{source}.parquet' where id = ? and epoch = ?",
        [sid, epoch],
    ).fetchall()
}
if year not in listed:
    sys.exit(f"{sid} has no {year} file in epoch {epoch}; it has {sorted(listed)}")

# A source_id needs no URL-encoding (src/store/paths.ts); later epochs have a directory of their own.
base = f"{STORE}/obs/{source}/{source_id}" + ("" if epoch == 1 else f"/{epoch}")
years = {}
for y in (year - 1, year, year + 1):
    if y not in listed:
        print(f"note: no {y} file; the export has no context from it", file=sys.stderr)
        years[y] = []
        continue
    rows = con.execute(
        f"select epoch_ms(time), level_m::double, flag, source_flag "
        f"from read_parquet('{base}/{y}.parquet', union_by_name = true) order by time"
    ).fetchall()
    if not rows:
        sys.exit(f"{base}/{y}.parquet is listed but holds no rows")
    # Levels to the 0.1 mm the store reads back (level() in src/store/parquet.ts); a null stays null here
    # and becomes 0 m in store.ts, as Number(null) does in level().
    years[y] = [[t, None if l is None else math.floor(l * 1e4 + 0.5) / 1e4, f, s] for t, l, f, s in rows]

res = {
    "station": {"id": sid, "kind": kind, "tidal": tidal, "tide_m": tide_m, "interval_s": interval_s, "epoch": epoch},
    "years": years,
}
with open(out, "w") as f:
    json.dump(res, f)
print(sid, "epoch", epoch, {k: len(v) for k, v in years.items()}, res["station"])
