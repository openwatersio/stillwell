# Japan Meteorological Agency (`jma`)

Hourly tide levels at the Japan Meteorological Agency's tide gauges, read from JMA's text files: the [historical tide data](https://www.data.jma.go.jp/kaiyou/db/tide/sea_lev_var/index_hourly.php) (歴史的潮位資料) to March 1997, the [final tide observations](https://www.data.jma.go.jp/kaiyou/db/tide/genbo/index.php) (潮汐観測資料) from April 1997, and the [provisional values](https://www.data.jma.go.jp/kaiyou/db/tide/sokuho/index.php) (速報値) for the current and previous month. The site is in Japanese only.

- **Stations:** every station in JMA's [historical station list](https://www.data.jma.go.jp/kaiyou/db/tide/sea_lev_var/station_history.php), which gives each one's first month and, for a closed one, its last, plus any the [current station list](https://www.data.jma.go.jp/kaiyou/db/tide/genbo/station.php) adds. Each is `jma/<code>`, with JMA's two-character code (`jma/KS` for Kushimoto). Names are in English from the adapter's own table, since JMA lists them in Japanese, and a code the table lacks keeps its Japanese name. Several closed stations moved to a new code nearby (外之浦 `TU` to 浜田 `HA`, 対馬 `O1` to 対馬比田勝 `N5`), and JMA keeps them as separate records, so they're separate stations here.
- **Positions:** open stations' come from the current list, to the minute. Closed stations' come from each one's history page (`sea_lev_var_his.php?stn=<code>`), and those before 2003 are in the Tokyo datum, a few hundred meters off. A station that closes later keeps the position the store's list has for it.
- **Levels:** JMA's smoothed level (平滑値), with seiches, waves and other oscillations shorter than about 3 hours filtered out, not an instantaneous reading. A month JMA has no file for has no values, and nor does a historical file whose month is blank.
- **Times:** JST (UTC+9), 「時刻はすべてJST（日本標準時）で表しています」, hours 0 to 23. Against TICON's records from UHSLC's fast delivery, which UHSLC converts to UTC itself, and from JODC's relay of JMA, Kushimoto, Naha, Hakodate and Chichijima fit best at zero lag in 2020, and Kushimoto and Naha in 1990, from the historical set. K1's lag rules out a 12-hour error.
- **Datum:** `DL`, each station's observation datum (観測基準面), which JMA keeps fixed through gauge moves and resets, as at Tokyo's moves in 1968 and 1982. The historical set is shifted to each station's current DL (「現在の観測基準面に合わせる」), so `archive` is `current`. JMA publishes DL's height in T.P. (or, on remote islands, in a GSI datum or local mean sea level) in the current list, and revises it every year and with each GSI survey. `datums` is empty, since the list doesn't say which stations' heights are in T.P., and the offsets change every year.
- **Flags:** the flag comes from the file that served the month. Values from the historical and final files are `good`. Values from the provisional (`sokuho`) file are `preliminary`, and it serves only the current and previous JST month where the final file isn't out. JMA replaces provisional values with final ones around the 20th of the next month, and lists corrections to final files on the final set's index page.
- **Freshness:** provisional values appear around noon JST the next day, so no station is polled hourly. The store takes new values once a month, on the 9th, when it reads every open station again from the start of the month two months back to the end of this month. The store is up to about five weeks behind JMA.
- **Independent checks:** the [pair check](../../../docs/contributing/checks.md#pair-check) on 9 pairs of a JMA gauge and a record of another agency's gauge at the same port, from JODC's port, Coast Guard and GSI stations: Otaru, Toyama and others (RMS 0.6 to 2.5 cm, median 1.3). All fit best at zero lag. Both records are hourly, so only whole-hour lags meet readings: JMA's JST agrees with JODC's to the hour. The two sides name different datums (DL and a station zero), so the datums are unchecked. JODC's relay of JMA's gauges (GESLA's `JODC_JMA` records, TICON's `jodc_jma`) is JMA's own data and isn't independent.

## Known limits

- **Month ends:** a JST month starts at 15:00 UTC on the UTC month's last day, so a UTC month's last 9 hours come from the next JST month's file. Where a station's own JST month has no values, as at the start of its record, those hours are dropped. Where a month's final file is out but the next month's is late past the monthly refetch, the month's last 9 hours are missing until a backfill of that year brings them back.

## Running ingest

- **Requests:** one text file per station and JST month: `sea_lev_var/<yyyy>/<yyyymm>/hry<yyyymm><code>.txt` for the historical set, `genbo/<yyyy>/<yyyymm>/hry<yyyymm><code>.txt` for the final set, and `sokuho/<yyyymm>/z_hry<yyyymm><code>.txt` for the provisional one. Each line is a day: 24 three-column values in centimeters for 0:00 to 23:00, blank where missing, then the two-digit year, month and day and the station code in columns 73 to 80 ([format](https://www.data.jma.go.jp/kaiyou/db/tide/genbo/format.html)). The final set adds the day's high and low waters after column 80, which aren't read. A month is about 2.5 to 4 KB, and a month JMA has no file for answers 404.
- **Station spans:** each station's `record_start` and, for a closed one, `record_end` bound what a backfill asks for.
- **Reading files:** a line for another station or month is refused, and so is a day outside the month or stamped twice, unless the lines on either side are stamped as days of the month, two days apart, and the line isn't a copy of another: then the line is the day between them (erratum `jma-saigo-1980-day-stamp`).
- **Month ends:** a UTC year reads 13 monthly files, the last for its first 9 hours. A UTC month's last 9 hours are dropped when its own JST month brought nothing or wasn't read, or a merge would take them for a fetch of the whole month and replace what the store holds for it. Where the next month's file is late, the merge drops the month's last 9 hours and the next refetch starts after them.
- **Refresh:** the current and previous JST month are fetched fresh, final file first and the provisional one where it's missing. Nothing runs hourly, so Monthly's refetch on the 9th is what brings new values: for JMA it backfills every open station from the start of the month two months back, whose final file is out by then, to the end of this month, then runs `backfill jma preliminary` like every source that `finalizes`.
- **Cache:** older files are cached on disk, only when they parse as a whole month, so a 200 that isn't the file isn't kept. The Ingest workflow starts with an empty cache, so a backfill there with `--refetch` reads JMA's corrected final files again, and so does one locally after clearing `.cache/`.
- **Limits:** JMA publishes no rate limit and has no robots.txt, so requests start 300 ms apart.
- **Not read:** JMA's 15-second values from the [tide observation map](https://www.jma.go.jp/bosai/tidelevel/), in T.P. rather than DL, kept for about 32 days, which cover 166 gauges including other agencies'; the original ledger values (`orgdata/`), which the historical set corrects; the residuals (`dep`) and tide tables; and JODC's relay of JMA's gauges (GESLA's `JODC_JMA` records, TICON's `jodc_jma`), since JMA's own files carry the same gauges.
- **Canary:** the weekly canary has no recorded response shape for JMA, since its paths name the month and its text has no shape; it passes when both the provisional and final sets return values.

### Backfill

Monthly refreshes JMA's list on the 2nd. A full backfill goes through the Ingest workflow. `all` takes active stations only, so the 20 closed ones are named in a second run:

```bash
node scripts/ingest.ts backfill jma all 1924 2026 --skip-written
```

```bash
node scripts/ingest.ts backfill jma CS,D5,D9,DS,FU,H1,HC,HD,HF,IW,L4,ME,MS,O1,O7,R1,SS,T2,TE,TU 1924 2026 --skip-written
```

That's about 4,900 station-years, 59,000 monthly files and about 200 MB. At 300 ms a request it needs about 6 hours, so expect a second run, which `--skip-written` resumes. The current year is backfilled on its own, `backfill jma all 2026 2027`.
