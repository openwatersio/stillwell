# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "polars",
#     "altair",
#     "pyarrow",
#     "tzdata",
# ]
# ///

import marimo

__generated_with = "0.25.2"
app = marimo.App(width="medium")


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    # Irish National Tide Gauge Network in Stillwell

    Observed water levels from the Marine Institute's tide gauges, as [Stillwell](https://github.com/openwatersio/stillwell) publishes them: Parquet files at `https://stillwell.openwaters.io/`, one per station and year, updated every hour. This notebook reads them directly; nothing is downloaded in bulk.

    Data: Marine Institute, Irish National Tide Gauge Network, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
    """)
    return


@app.cell(hide_code=True)
def _():
    import io
    import sys

    import marimo as mo
    import polars as pl
    import altair as alt
    import pyarrow  # noqa: F401  polars needs these to read Parquet and time zones in WebAssembly,
    import tzdata  # noqa: F401  where only packages the notebook imports are loaded
    from datetime import datetime, timedelta, timezone

    LAKE = "https://stillwell.openwaters.io"


    async def read_parquet(path):
        """One file from the lake, or None if it doesn't exist. Fetches the whole
        file, which works both on a server and in the browser (WebAssembly)."""
        url = f"{LAKE}/{path}"
        if sys.platform == "emscripten":
            from pyodide.http import pyfetch

            response = await pyfetch(url)
            if response.status == 404:
                return None
            if not response.ok:
                raise RuntimeError(f"{url}: HTTP {response.status}")
            data = await response.bytes()
        else:
            import urllib.error
            import urllib.request

            try:
                with urllib.request.urlopen(url) as response:
                    data = response.read()
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                raise
        return pl.read_parquet(io.BytesIO(data))


    def lat_offset_of(datums):
        """The LAT offset from a station's datums, read as a dict or as key/value rows."""
        if not datums:
            return None
        if isinstance(datums, dict):
            return datums.get("LAT")
        return next((d["value"] for d in datums if d["key"] == "LAT"), None)
    return alt, datetime, lat_offset_of, mo, pl, read_parquet, timedelta, timezone


@app.cell(hide_code=True)
async def _(lat_offset_of, pl, read_parquet):
    _all = (await read_parquet("stations.parquet")).filter(pl.col("source") == "marine-institute")
    stations = (
        _all.with_columns(
            pl.Series("lat_offset_m", [lat_offset_of(d) for d in _all["datums"].to_list()], dtype=pl.Float64)
        )
        .select("id", "name", "lat", "lon", "datum", "lat_offset_m", "first", "last")
        .sort("name")
    )
    stations
    return (stations,)


@app.cell(hide_code=True)
def _(mo, stations, timedelta):
    _names = dict(zip(stations["name"], stations["id"]))
    station = mo.ui.dropdown(options=_names, value="Ballycotton Harbour", label="Gauge")
    _last = stations["last"].max().date()
    dates = mo.ui.date_range(start=_last - timedelta(days=30), stop=_last, label="Dates")
    datum = mo.ui.radio(options=["OD Malin", "LAT"], value="OD Malin", label="Datum", inline=True)
    mo.hstack([station, dates, datum], justify="start", gap=2)
    return dates, datum, station


@app.cell(hide_code=True)
async def _(dates, datetime, pl, read_parquet, station, stations, timezone):
    _row = stations.filter(pl.col("id") == station.value).row(0, named=True)
    start, stop = dates.value
    _frames = []
    for _year in range(start.year, stop.year + 1):
        _frame = await read_parquet(f"obs/{station.value}/{_year}.parquet")
        if _frame is not None:
            _frames.append(_frame.select("time", "level_m", "flag"))
    _start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    _stop = datetime(stop.year, stop.month, stop.day, 23, 59, 59, tzinfo=timezone.utc)
    levels = (
        pl.concat(_frames).filter(pl.col("time").is_between(_start, _stop))
        if _frames
        else pl.DataFrame(schema={"time": pl.Datetime("us", "UTC"), "level_m": pl.Float32, "flag": pl.UInt8})
    )
    lat_offset = _row["lat_offset_m"]
    gauge = _row["name"]
    return gauge, lat_offset, levels


@app.cell(hide_code=True)
def _(alt, datum, gauge, lat_offset, levels, mo, pl):
    _shift = lat_offset if datum.value == "LAT" and lat_offset is not None else 0.0
    _plot = levels.with_columns(
        (pl.col("level_m") + _shift).alias("level"),
        pl.when(pl.col("flag") <= 2).then(pl.lit("good")).otherwise(pl.lit("suspect or bad")).alias("quality"),
    )
    _chart = (
        alt.Chart(_plot)
        .mark_line(strokeWidth=1)
        .encode(
            x=alt.X("time:T", title=None),
            y=alt.Y("level:Q", title=f"Level (m, {datum.value})"),
            color=alt.Color("quality:N", legend=alt.Legend(title=None)),
            tooltip=["time:T", alt.Tooltip("level:Q", format=".3f"), "flag:Q"],
        )
        .properties(width="container", height=320, title=gauge)
    )
    mo.vstack(
        [
            mo.ui.altair_chart(_chart),
            mo.md(f"{len(levels):,} values. LAT is OD Malin plus {lat_offset} m, the gauge's current offset." if lat_offset is not None else f"{len(levels):,} values. No LAT offset is published for this gauge."),
        ]
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## About LAT

    Stillwell stores the levels in OD Malin, which is continuous, and gives LAT as the gauge's current offset from OD Malin. On 24 March 2026 at 11:15 UTC the Marine Institute re-evaluated its harmonics and levels, and the LAT offsets moved by up to about 12 cm (Ballycotton went from 2.489 m to 2.460 m). LAT values here use the new offset for the whole record.
    """)
    return


if __name__ == "__main__":
    app.run()
