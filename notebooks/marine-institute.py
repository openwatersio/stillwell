# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "duckdb",
#     "polars",
#     "pyarrow",
#     "altair",
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

    Observed water levels from the Marine Institute's tide gauges, as [Stillwell](https://github.com/openwatersio/stillwell) publishes them: Parquet files at `https://stillwell.openwaters.io/`, one per station and year, updated every day. This notebook reads them directly with DuckDB; the [data guide](https://github.com/openwatersio/stillwell/blob/main/docs/data.md) describes every file and column.

    Data: Marine Institute, Irish National Tide Gauge Network, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
    """)
    return


@app.cell(hide_code=True)
def _():
    import marimo as mo
    import duckdb
    import altair as alt
    import pyarrow  # noqa: F401  in WebAssembly only imported packages load: pyarrow for .pl(), tzdata for UTC
    import tzdata  # noqa: F401
    from datetime import timedelta

    STORE = "https://stillwell.openwaters.io"
    duckdb.sql("SET TimeZone = 'UTC'")
    return STORE, alt, duckdb, mo, timedelta


@app.cell(hide_code=True)
def _(STORE, duckdb):
    stations = duckdb.sql(f"""
        SELECT id, name, lat, lon, datum, datums['LAT'] AS lat_offset_m, first, last
        FROM '{STORE}/stations.parquet'
        WHERE source = 'marine-institute'
        ORDER BY name
    """).pl()
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
def _(STORE, dates, datum, duckdb, station, stations):
    _row = stations.row(stations["id"].index_of(station.value), named=True)
    gauge, lat_offset = _row["name"], _row["lat_offset_m"]
    start, stop = dates.value
    # Every series here is in datum epoch 1, so its files are at obs/<id>/<year>.parquet.
    # The years list says which of them exist; a missing file would fail the read.
    _files = duckdb.sql(
        f"SELECT list('{STORE}/obs/' || id || '/' || year || '.parquet') "
        f"FROM '{STORE}/stations/years/marine-institute.parquet' WHERE id = ? AND year BETWEEN ? AND ?",
        params=[station.value, start.year, stop.year],
    ).fetchall()[0][0]
    _shift = lat_offset if datum.value == "LAT" and lat_offset is not None else 0.0
    levels = None
    if _files:
        levels = duckdb.sql(
            f"""
            SELECT time, level_m + ? AS level, flag,
              CASE WHEN flag <= 2 THEN 'good' ELSE 'suspect or bad' END AS quality
            FROM read_parquet({_files})
            WHERE time >= ? AND time < ? + INTERVAL 1 DAY
            ORDER BY time
            """,
            params=[_shift, start, stop],
        ).pl()
    return gauge, lat_offset, levels


@app.cell(hide_code=True)
def _(alt, datum, gauge, lat_offset, levels, mo):
    _chart = (
        alt.Chart(levels)
        .mark_line(strokeWidth=1)
        .encode(
            x=alt.X("time:T", title=None),
            y=alt.Y("level:Q", title=f"Level (m, {datum.value})"),
            color=alt.Color("quality:N", legend=alt.Legend(title=None)),
            tooltip=["time:T", alt.Tooltip("level:Q", format=".3f"), "flag:Q"],
        )
        .properties(width="container", height=320, title=gauge)
    )
    _offset = f"LAT is OD Malin plus {lat_offset} m, the gauge's current offset." if lat_offset is not None else "No LAT offset is published for this gauge."
    mo.vstack([mo.ui.altair_chart(_chart), mo.md(f"{len(levels):,} values. {_offset}")]) if levels is not None else mo.md(f"{gauge} has no values in these dates.")
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
