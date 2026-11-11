"""R and F flags on CO-OPS verified 6-minute water levels, and how far flagged
and unflagged values sit from the mean of their two neighbors, for the seven
stations and three Marches erratum coops-stale-limit-flag used, plus Dauphin
Island in October 2020. Reads CO-OPS's data API, a request a second."""
import datetime
import json, sys, time, statistics as st, urllib.request
STATIONS = {"8573364": "Tolchester Beach", "8574680": "Baltimore", "8575512": "Annapolis", "8638610": "Chesapeake Bay Bridge Tunnel", "8518750": "The Battery", "9414290": "San Francisco", "8724580": "Key West"}
MONTHS = [("20100301", "20100331"), ("20150301", "20150331"), ("20200301", "20200331")]
JOBS = [(s, a, b) for s in STATIONS for a, b in MONTHS] + [("8735180", "20201001", "20201031")]
API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&datum=STND&units=metric&time_zone=gmt&format=json&application=openwaters"
def minutes(t): return int(datetime.datetime.strptime(t, "%Y-%m-%d %H:%M").timestamp() // 60)
def q(a, p): a = sorted(a); return a[int(p * (len(a) - 1))] if a else float("nan")
tot = {"R": [], "N": [], "F": 0, "n": 0}
print("| Station | Month | Verified values | R | F | R: median, p95, max distance (cm) | Unflagged: median, p95, max distance (cm) |")
print("| --- | --- | --- | --- | --- | --- | --- |")
for s, a, b in JOBS:
    with urllib.request.urlopen(f"{API}&station={s}&begin_date={a}&end_date={b}", timeout=60) as r:
        body = json.load(r)
    if "error" in body: raise SystemExit(f"{s} {a}: {body['error']}")
    d = [x for x in body.get("data", []) if x["v"] and x.get("q") == "v"]
    time.sleep(1)
    R, N, F = [], [], 0
    for i in range(1, len(d) - 1):
        f = d[i]["f"].split(",")
        if len(f) != 4: continue
        # Neighbors only in the adjacent 6-minute slots, so a value beside a gap is not compared across it.
        if minutes(d[i]["t"]) - minutes(d[i - 1]["t"]) != 6 or minutes(d[i + 1]["t"]) - minutes(d[i]["t"]) != 6: continue
        dev = 100 * abs(float(d[i]["v"]) - (float(d[i - 1]["v"]) + float(d[i + 1]["v"])) / 2)
        if f[1] == "1": F += 1
        if f[2] == "1": R.append(dev)
        elif f[1] != "1" and f[3] != "1": N.append(dev)
    tot["R"] += R; tot["N"] += N; tot["F"] += F; tot["n"] += len(d)
    fmt = lambda a: f"{st.median(a):.1f}, {q(a,.95):.1f}, {max(a):.1f}" if a else "none"
    print(f"| {STATIONS.get(s, 'Dauphin Island')} ({s}) | {a[:4]}-{a[4:6]} | {len(d)} | {len(R)} | {F} | {fmt(R)} | {fmt(N)} |")
fmt = lambda a: f"{st.median(a):.1f}, {q(a,.95):.1f}, {max(a):.1f}"
print(f"| All | | {tot['n']} | {len(tot['R'])} | {tot['F']} | {fmt(tot['R'])} | {fmt(tot['N'])} |")
