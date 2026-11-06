# Rijkswaterstaat (`rws`)

Observed water levels, observed high and low waters, and RWS's astronomical tide and its high and low waters, for about 690 locations in the Netherlands and the Caribbean Netherlands, from the [Waterwebservices](https://rijkswaterstaatdata.nl/waterdata/) (DDAPI 2.0).

- **License:** CC0. Attribution "Rijkswaterstaat" is optional but carried.
- **Stations:** every catalog location with a `WATHTE` series against NAP, or against MSL where that's all it has: 14 locations, mostly offshore platforms (A12, D15, J6, K13a and others), plus Ameland Westgat and Kralendijk on Bonaire. Products come from the catalog: `extremes` where the location has the `GETETM2` grouping, `predictions` and `predicted_extremes` where it has `GETETBRKD2`. Those groupings are against NAP even at the platforms, so a station whose levels are against MSL lists levels only, and every request asks for the station's datum so one file never mixes two. If RWS changes a station's datum, the refresh marks it inactive for a person to resolve rather than relabeling its files (see `src/stations.ts`). RWS lists Ameland Westgat twice, as `ameland.westgat` and `amelandwestgat`, a few meters apart; `TWINS` links checked pairs like that with `same_as`. Distance alone doesn't, since the two sides of a lock can be meters apart.
- **Levels:** 10-minute, integer centimeters (millimeters where converted, below), relative to the station's datum: NAP, or MSL at those 14. Values above 10,000 cm are RWS's missing-value sentinels and are dropped.
- **Extremes:** RWS's own selection, paired from the `GETETTPE` type channel and the `WATHTE` height channel on the same timestamps. Where a tide has a double low water (an agger, as at Hoek van Holland, where it's about a third of all tides), the observed extremes give both lows, `laagwater 1` and `laagwater 2`, and the rise between them as `topagger`. Both lows are kept as `low`, and the rise is left out, since it isn't a high water, so those tides have two lows. The astronomical extremes give one high and one low per tide. A type the adapter doesn't know fails the request rather than being dropped.
- **Flags:** `Gecontroleerd` (checked) is `good` and `Ongecontroleerd` (unchecked) is `preliminary`. Quality code `00` is a normal value. We haven't found what code `25` means, so it and any other code are `suspect` until we do. The astronomical tide is always `good`.
- **Times:** every timestamp carries its offset (`+01:00`), and is read as the instant it names. GESLA's copies of RWS records were stamped in Amsterdam local time an hour off, but this service isn't. Checked in November 2026: observed levels at Hoek van Holland, Vlissingen, Den Helder and Harlingen line up with TICON's predictions there (CMEMS and RWS records) at 0 minutes, within ±10, in January and July of years from 1990 to 2024. A historical request for the last day and a half returns the same values as `recent/rws.parquet` at the same times, and the earliest value arrives 15 minutes after its timestamp.
- **NAP before 2005:** the 2005 NAP revision gave every gauge's zero post a new height, and RWS serves values from before 2005 against the old one, so a series steps by up to 3 cm on 1 January 2005. PSMSL records each main gauge's offset (its two RLR factors, from Dillingh et al. 2010), and at all of them but Delfzijl the series this service returns match PSMSL's monthly means to the millimeter. `NAP_2005` puts values from before 2005 on today's NAP at eight of those gauges: Vlissingen, Roompot Buiten, Hoek van Holland, Maassluis, IJmuiden Buitenhaven, Terschelling West, Den Helder and Harlingen. Each converted series matches PSMSL's RLR series, moved onto today's NAP, within 6 mm in every year from 1990 to 2006, and within 1 mm in most. Delfzijl is left out: RWS has since corrected its archive for subsidence, and its series differs from PSMSL's by 5 to 40 mm before 2006. No other gauge's offset is public, so every other NAP station's observed levels and extremes are served from 2005 on, and a request sends nothing from before 23:00 UTC on 31 December 2004. The revision starts at midnight in RWS's time (UTC+1); PSMSL's factors change between monthly means, so the hour is a guess. The astronomical tide is served as RWS gives it, before 2005 too: its mean level steps at 2005 anyway (from 0.07 to 0.09 m at Hoek van Holland, from −0.01 to 0.00 m at Vlissingen), as RWS updates the mean level its predictions use, and converting it would make that step 4 to 5 cm.
- **Limits:** at most 160,000 values per request, so requests go a year at a time. Fair use, no uptime guarantee, and no published rate; throttling comes back as 429 or 503, which `src/http.ts` retries. An empty range comes back as an empty body. A year takes 20 seconds and 15 MB for levels, 35 seconds for the astronomical tide, and 2 to 3 seconds for either set of extremes.
- **History:** 10-minute levels back to 1990 at the tide gauges, and hourly before that, unchecked. Observed extremes for the latest year appear months later.

## Backfill to 1990

Backfill asks for every product a station lists, a year per request, so a tide gauge with all four costs up to a minute a year. Under the 2005 rule, most stations cost requests for 2005 on only. Run each step from the Ingest workflow with `timeout` at 360.

First, refetch the years already in the lake from before the adapter kept both lows of a double low water and converted NAP before 2005. Hoek van Holland's 2024 is one; a `--skip-written` run would otherwise keep it as it is. Any other RWS year file before 2026 needs the same, which a listing of `obs/rws/`, `extremes/rws/`, `predictions/rws/` and `predicted-extremes/rws/` in the bucket shows. A refetch can't fix a year before 2005 at a NAP station outside `NAP_2005`: the adapter returns nothing for it, and backfill keeps a file it gets nothing for, so delete those files instead.

```bash
node scripts/ingest.ts backfill rws hoekvanholland 2024 2025 --refetch
```

Then the history, with the 161 stations matched to TICON records first. `--skip-written` picks up where the last run stopped:

```bash
node scripts/ingest.ts backfill rws all 1990 2026 --skip-written --first docs/ticon-replacement.csv
```

At the default 4 stations at once, that's at most 3 runs for the TICON stations and at most 5 for every station; a smoke test ran Hoek van Holland's four products at about 30 seconds a year. Last, the current year, which compaction has written only since November. It's fetched in full on every run, so it goes in one run of about an hour. RWS publishes observed extremes months after the year, so run it again for 2026 once they're out:

```bash
node scripts/ingest.ts backfill rws all 2026 2027
```

Each run holds the `lake-rws` group for up to 6 hours. A job that finds the group taken waits, and the next hourly run cancels it, so start each run between 01:00 and 18:30 UTC, so it ends before Compact daily at 00:40, and not on the 2nd, when Monthly refreshes the station list at 01:25.
