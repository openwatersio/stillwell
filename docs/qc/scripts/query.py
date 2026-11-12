"""Runs SQL against the public store and prints the rows; times as strings.

    python -I docs/qc/scripts/query.py "SELECT ... FROM 'https://stillwell.openwaters.io/...'"
"""
import sys, duckdb
con = duckdb.connect()
con.execute("install httpfs; load httpfs; set TimeZone='UTC'")
for q in sys.argv[1:]:
    r = con.execute(q)
    cols=[d[0] for d in r.description]
    print(cols)
    for row in r.fetchall(): print(tuple(str(x) if hasattr(x,'isoformat') else x for x in row))
    print('---')
