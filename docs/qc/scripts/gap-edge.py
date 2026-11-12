"""Counts the values QC raised to suspect or bad over the source's flag in one
year file, and how many sit at a gap's edge or within three values of one. A
gap is a step over 1.5 times the station's interval. A row with no source_flag
counts as the source's good, as rerun.ts counts it. The stored flag already
includes errata spans, so values an erratum flags count as raised here too.

    python -I docs/qc/scripts/gap-edge.py bodc/jer 2025

Needs duckdb (pip install duckdb). Reads epoch 1's file.
"""

import sys
from urllib.parse import quote

import duckdb

STORE = "https://stillwell.openwaters.io"
if len(sys.argv) != 3:
    sys.exit(__doc__)
sid, year = sys.argv[1], int(sys.argv[2])
source, source_id = sid.split("/", 1)
con = duckdb.connect()
con.execute("install httpfs; load httpfs")
found = con.execute(f"select interval_s from '{STORE}/stations.parquet' where id = ?", [sid]).fetchone()
if found is None or found[0] is None:
    sys.exit(f"{sid} isn't listed, or has no interval_s to judge gaps by")
gap = 1.5 * found[0]
url = f"{STORE}/obs/{source}/{quote(quote(source_id, safe="!'()*"), safe='')}/{year}.parquet"
raised = "flag >= 3 and coalesce(source_flag, 0) < 3"
n, qc, edge, near, gaps = con.execute(
    f"""
    with r as (
      select time, flag, source_flag,
        epoch(time) - epoch(lag(time) over (order by time)) as dt_prev,
        epoch(lead(time) over (order by time)) - epoch(time) as dt_next
      from read_parquet('{url}', union_by_name = true)
    ), w as (
      select *, max(case when dt_prev > {gap} or dt_next > {gap} then 1 else 0 end)
        over (order by time rows between 3 preceding and 3 following) = 1 as near_gap
      from r
    )
    select count(*),
      count(*) filter (where {raised}),
      count(*) filter (where {raised} and (dt_prev > {gap} or dt_next > {gap})),
      count(*) filter (where {raised} and near_gap),
      count(*) filter (where dt_prev > {gap})
    from w
    """
).fetchone()
print(f"{sid} {year}: {n} values, {gaps} gaps; QC raised {qc}, {edge} at a gap's edge, {near} within three values of a gap")
