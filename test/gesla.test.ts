import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { qcFor } from "../src/lake/recent.ts";
import { linkGauges } from "../src/same-as.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as gesla from "../src/sources/gesla/index.ts";
import { TIDE_M, tidal } from "../src/sources/gesla/tidal.ts";

const fixtures = new URL("fixtures/", import.meta.url);
/**
 * Twelve rows of GESLA 4.1's metadata CSV, as served: CR line endings and the
 * header's last two names run together. The zip holds three real records,
 * trimmed: Cape d'Or every 6 hours in 1965 and early 1969, a day of
 * Cuxhaven's WSV record, and a morning of Hong Kong's.
 */
const metadata = readFileSync(new URL("gesla-metadata.csv", fixtures), "utf8");
const zip = readFileSync(new URL("gesla.zip", fixtures));

let requests: [string, RequestOptions][] = [];

/** The shape of a CloudKit share's resolve, with only the fields the adapter reads. */
const resolved = (url: string, size: number) =>
  JSON.stringify({
    results: [
      {
        rootRecord: {
          fields: { size: { value: size }, fileContent: { value: { downloadURL: url } } },
        },
      },
    ],
  });

beforeEach(() => {
  requests = [];
  gesla.release.bytes = zip.length;
  gesla.release.records = 12;
  setTransport(async (url, options) => {
    requests.push([url, options]);
    if (url.includes("records/resolve")) {
      const share = JSON.parse(String(options.body)).shortGUIDs[0].value;
      return share === "02fFab01rq4LdVcwRCf5QCyCQ"
        ? resolved("https://cvws.example/B/meta/${f}?o=1", metadata.length)
        : resolved("https://cvws.example/B/zip/${f}?o=2", zip.length);
    }
    if (url.startsWith("https://cvws.example/B/meta/")) return metadata;
    if (url.startsWith("https://cvws.example/B/zip/")) {
      const range = /^bytes=(\d+)-(\d+)$/.exec((options.headers as Record<string, string>).range)!;
      return zip.subarray(Number(range[1]), Number(range[2]) + 1).toString("base64");
    }
    throw new Error(`GET ${url} returned 404`);
  });
});

afterEach(() => setTransport(fetchText));

const iso = (t: number) => new Date(t).toISOString();

describe("gesla stations", () => {
  it("lists a station per record, with its contributor's terms and its originator", async () => {
    const list = await gesla.stations();
    const byId = new Map(list.map((s) => [s.source_id, s]));
    // Durban's record is SANHO's, which refused republication, so it isn't listed.
    assert.equal(list.length, 11);
    assert.equal(byId.has("durban-181-zaf-uhslc_fd"), false);
    assert.deepEqual(gesla.withheldFiles, ["durban-181-zaf-uhslc_fd"]);
    const cape = byId.get("cape_dor-240-can-meds")!;
    assert.deepEqual(
      [cape.id, cape.name, cape.country_code, cape.kind, cape.datum, cape.contributor],
      ["gesla/cape_dor-240-can-meds", "Cape Dor", "CA", "coastal", "ZERO", "MEDS"],
    );
    assert.deepEqual(
      [cape.record_start, cape.record_end, cape.datum_information, cape.record_quality],
      [
        "1965-06-09T05:00:00.000Z",
        "1979-12-29T13:00:00.000Z",
        "Chart Datum (CD)",
        "Possible datum and quality control issues",
      ],
    );
    assert.equal(
      cape.source_url,
      "https://d2lyy96te42c83.cloudfront.net/v4-1/cape_dor-240-can-meds",
    );
    // MEDS's gauges are CHS's, whose terms bar commercial use; CMEMS's are research only.
    assert.equal(cape.commercial_use, false);
    assert.equal(byId.get("bresttg_60minute-bre-fra-cmems")!.commercial_use, false);
    const seattle = byId.get("seattle-9447130-usa-noaa")!;
    assert.equal(seattle.commercial_use, true);
    assert.equal(
      seattle.attribution,
      "GESLA-4.1 (Haigh et al. 2023; Woodworth et al. 2017); National Oceanic and Atmospheric Administration",
    );
    // UHSLC's records take their terms from UHSLC's scan. A fast-delivery record takes every credit of its number's versions: 049a is JMA's.
    assert.match(
      byId.get("minamitorishima-049-jpn-uhslc_fd")!.attribution,
      /\(UHSLC\); Japan Meteorological Agency$/,
    );

    assert.deepEqual(Object.fromEntries(list.map((s) => [s.source_id, s.same_as])), {
      "ashley_river_below_summerville_sc-21720825-usa-usgs": ["usgs/021720825"],
      "brest-822a-fra-uhslc_rq": ["uhslc/822a"],
      "bresttg_60minute-bre-fra-cmems": [],
      "cape_dor-240-can-meds": [],
      "cuxhavensteubenhft-5990020-deu-wsv": ["pegelonline/5990020"],
      // A research-quality record links to GESLA's fast-delivery record of its number.
      "hong_kong-329-hkg-uhslc_fd": ["uhslc/329"],
      "hong_kong-329b-hkg-uhslc_rq": ["gesla/hong_kong-329-hkg-uhslc_fd"],
      "hudson_river_at_albany_ny-1359139-usa-usgs": ["usgs/01359139"],
      "minamitorishima-049-jpn-uhslc_fd": ["uhslc/049"],
      "seattle-9447130-usa-noaa": ["coops/9447130"],
      // Its values are Arkö's, so it names no originator.
      "uddevalla-2541-swe-smhi": [],
    });
  });

  it("pads USGS numbers only where USGS's parts start with a zero", () => {
    assert.deepEqual(gesla.originatorIds("USGS", "1359139", -73.7), ["usgs/01359139"]);
    assert.deepEqual(gesla.originatorIds("USGS", "11162765", -122.4), ["usgs/11162765"]);
    // Part 09, the Colorado, is west of 100° W but has the zero too.
    assert.deepEqual(gesla.originatorIds("USGS", "9380000", -111.6), ["usgs/09380000"]);
    // Guam's part 16, at an east longitude.
    assert.deepEqual(gesla.originatorIds("USGS", "16809600", 144.7), ["usgs/16809600"]);
    assert.deepEqual(gesla.originatorIds("USGS", "50047850", -66.1), ["usgs/50047850"]);
    assert.deepEqual(gesla.originatorIds("USGS", "2951190901217", -90.2), ["usgs/2951190901217"]);
  });

  it("refuses anything but the whole release, once", async () => {
    gesla.release.records = 13;
    await assert.rejects(gesla.stations(), /lists 12 records in 12 rows, not 13/);
    const doubled = metadata + metadata.split("\r")[1] + "\r";
    setTransport(async (url) =>
      url.includes("records/resolve")
        ? resolved("https://cvws.example/B/meta/${f}", doubled.length)
        : doubled,
    );
    await assert.rejects(gesla.stations(), /lists 12 records in 13 rows, not 13/);
  });

  it("lists Uddevalla's record, which holds Arkö's values, with no products or links", async () => {
    const list = await gesla.stations();
    const record = list.find((s) => s.source_id === "uddevalla-2541-swe-smhi")!;
    assert.deepEqual([record.status, record.products, record.same_as], ["inactive", [], []]);
    // A backfill can still name it.
    await assert.rejects(
      gesla.levels(
        { source_id: "uddevalla-2541-swe-smhi", kind: "river" },
        new Date("2020-01-01T00:00:00Z"),
        new Date("2021-01-01T00:00:00Z"),
      ),
      /holds another gauge's values/,
    );
  });

  it("withholds every UHSLC record carrying SANHO's notice, and refuses to fetch one", async () => {
    // South Africa's records are SANHO's; Walvis Bay's carry its notice from UHSLC's scan.
    for (const file of [
      "durban-181-zaf-uhslc_fd",
      "durban-181a-zaf-uhslc_rq",
      "luderitz-702a-zaf-uhslc_rq",
      "walvis_bay-220-nam-uhslc_fd",
      "walvis_bay-220a-nam-uhslc_rq",
      // A version UHSLC's scan hasn't read yet.
      "walvis_bay-220b-nam-uhslc_rq",
    ])
      assert.match(gesla.withheld(file) ?? "", /^South African Navy Hydrographic Office refused/);
    for (const file of [
      "minamitorishima-049-jpn-uhslc_fd",
      "brest-822a-fra-uhslc_rq",
      "seattle-9447130-usa-noaa",
      "uddevalla-2541-swe-smhi",
    ])
      assert.equal(gesla.withheld(file), null);
    await assert.rejects(
      gesla.levels(
        { source_id: "durban-181-zaf-uhslc_fd", kind: "coastal" },
        new Date("2000-01-01T00:00:00Z"),
        new Date("2001-01-01T00:00:00Z"),
      ),
      /is withheld: South African Navy Hydrographic Office refused/,
    );
    assert.equal(requests.length, 0);
  });

  it("fails when a record it drops isn't in the release, as a renamed one wouldn't be", async () => {
    const renamed = metadata.replace("uddevalla-2541-swe-smhi,", "uddevalla2-2541-swe-smhi,");
    setTransport(async (url) =>
      url.includes("records/resolve")
        ? resolved("https://cvws.example/B/meta/${f}", renamed.length)
        : renamed,
    );
    await assert.rejects(gesla.stations(), /has no uddevalla-2541-swe-smhi, which DROPPED names/);
  });

  it("links DWR's NAVD88 series, whose Q GESLA drops", () => {
    assert.deepEqual(gesla.originatorIds("CDWR", "B91450", -121.6), ["dwr/B91450Q"]);
    assert.deepEqual(gesla.originatorIds("CDWR", "B91212", -121.7), ["dwr/B91212"]);
    assert.deepEqual(gesla.originatorIds("CDWR", "RVB", -121.7), ["cdec/RVB"]);
    assert.deepEqual(gesla.originatorIds("BODC", "LER", -1.1), ["bodc/ler"]);
  });

  it("links SFWMD's tailwaters to its `_T` series and other gauges to their own", () => {
    assert.deepEqual(
      gesla.originatorIds("SFWMD", "S197", -80.3, undefined, "s197_t-s197-usa-sfwmd"),
      ["sfwmd/S197_T"],
    );
    assert.deepEqual(
      gesla.originatorIds(
        "SFWMD",
        "MARKH",
        -81.5,
        undefined,
        "calahootchieriver_markh-markh-usa-sfwmd",
      ),
      ["sfwmd/MARKH"],
    );
  });

  it("is a copy, so the originator's series is preferred", async () => {
    const seattle = (await gesla.stations()).find((s) => s.contributor === "NOAA") as Station;
    const coops: Station = {
      ...seattle,
      id: "coops/9447130",
      source: "coops",
      source_id: "9447130",
      same_as: [],
    };
    const { stations } = linkGauges([seattle, coops]);
    assert.deepEqual(
      stations.map((s) => [s.id, s.preferred]),
      [
        ["gesla/seattle-9447130-usa-noaa", "coops/9447130"],
        ["coops/9447130", "coops/9447130"],
      ],
    );
  });
});

describe("gesla links", () => {
  const at = (id: string, name: string, lat: number, extra: Partial<Station> = {}): Station =>
    ({
      id,
      source: id.split("/")[0]!,
      source_id: id.split("/")[1]!,
      name,
      lat,
      lon: -4.495,
      kind: "coastal",
      products: ["levels"],
      commercial_use: true,
      status: "active",
      first: null,
      last: null,
      interval_s: 3600,
      same_as: [],
      ...extra,
    }) as Station;

  it("still matches a UHSLC copy to its originator when GESLA names the UHSLC series", () => {
    const refmar = at("refmar/3", "BREST", 48.3829);
    const uhslc = at("uhslc/822", "Brest", 48.383, { contributor: "SHOM" } as Partial<Station>);
    const geslaUhslc = at("gesla/brest-822-fra-uhslc_fd", "Brest", 48.383, {
      same_as: ["uhslc/822"],
    });
    const geslaRefmar = at("gesla/brest-3-fra-refmar", "Brest", 48.3829, { same_as: ["refmar/3"] });
    const { stations } = linkGauges([refmar, uhslc, geslaUhslc, geslaRefmar]);
    // One group of four, though it holds two GESLA records, with REFMAR's series preferred.
    assert.deepEqual(
      stations.map((s) => [s.id, s.same_as.length, s.preferred]),
      [
        ["refmar/3", 3, "refmar/3"],
        ["uhslc/822", 3, "refmar/3"],
        ["gesla/brest-822-fra-uhslc_fd", 3, "refmar/3"],
        ["gesla/brest-3-fra-refmar", 3, "refmar/3"],
      ],
    );
  });

  it("prefers any series over GESLA's copy of it, however long GESLA's runs", () => {
    const now = new Date("2026-11-08Z");
    const uhslc = at("uhslc/001", "Pohnpei", 6.98, {
      first: "2001-01-01T00:00:00Z",
      last: "2026-10-01T00:00:00Z",
      contributor: "BOM",
    } as Partial<Station>);
    const copy = at("gesla/pohnpei-001-fsm-uhslc_fd", "Pohnpei", 6.98, {
      first: "1969-01-01T00:00:00Z",
      last: "2026-07-01T00:00:00Z",
      same_as: ["uhslc/001"],
    });
    assert.deepEqual(
      linkGauges([uhslc, copy], now).stations.map((s) => s.preferred),
      ["uhslc/001", "uhslc/001"],
    );
  });
});

describe("gesla levels", () => {
  const station = (source_id: string) => ({ source_id, kind: "coastal" as const });

  it("reads a record from the zip with GESLA's flags as the lake's", async () => {
    const levels = await gesla.levels(
      station("cape_dor-240-can-meds"),
      new Date("1969-01-16Z"),
      new Date("1969-01-17Z"),
    );
    assert.deepEqual(
      levels.map((l) => [iso(l.time), l.level, l.flag]),
      [
        ["1969-01-16T00:00:00.000Z", 8.78, Flag.good],
        ["1969-01-16T06:00:00.000Z", 2.86, Flag.good],
        ["1969-01-16T12:00:00.000Z", 8.8, Flag.good],
        ["1969-01-16T18:00:00.000Z", 3.49, Flag.good],
      ],
    );
    // Ranged reads: the zip's tail, its central directory, then the record's header and data.
    assert.ok(requests.every(([url, o]) => !url.includes("cvws") || o.fresh));
  });

  it("flags the spans a datum jump sets apart, keeping GESLA's own flag", async () => {
    const levels = await gesla.levels(
      station("cape_dor-240-can-meds"),
      new Date("1965-01-01Z"),
      new Date("1970-01-01Z"),
    );
    // Every 1965 value sits 18 to 26 m above 1969's: a datum GESLA flags usable.
    const in1965 = levels.filter((l) => l.time < Date.parse("1966-01-01Z"));
    assert.ok(in1965.length > 300);
    assert.ok(in1965.every((l) => l.flag === Flag.suspect && l.source_flag === Flag.good));
    assert.ok(
      levels.filter((l) => l.time >= Date.parse("1969-01-01Z")).every((l) => l.flag === Flag.good),
    );
  });

  it("stamps WSV's hourly means at the middle of their hour", async () => {
    const levels = await gesla.levels(
      station("cuxhavensteubenhft-5990020-deu-wsv"),
      new Date("2015-06-01T00:00Z"),
      new Date("2015-06-01T02:00Z"),
    );
    // GESLA labels them 00:00 and 01:00. Neither has had GESLA's QC, which a
    // static release never adds, so they're good, left to the lake's own QC.
    assert.deepEqual(
      levels.map((l) => [iso(l.time), l.level, l.flag]),
      [
        ["2015-06-01T00:30:00.000Z", 6.1827, Flag.good],
        ["2015-06-01T01:30:00.000Z", 5.5722, Flag.good],
      ],
    );
  });

  it("moves Hong Kong's times an hour later", async () => {
    const levels = await gesla.levels(
      station("hong_kong-329b-hkg-uhslc_rq"),
      new Date("2010-06-01T01:00Z"),
      new Date("2010-06-01T03:00Z"),
    );
    assert.deepEqual(
      levels.map((l) => [iso(l.time), l.level]),
      [
        ["2010-06-01T01:00:00.000Z", 2.13],
        ["2010-06-01T02:00:00.000Z", 2.23],
      ],
    );
  });

  it("asks nothing for years outside a record", async () => {
    const levels = await gesla.levels(
      { ...station("cape_dor-240-can-meds"), record_start: "1965-06-09T05:00:00.000Z" },
      new Date("1960-01-01Z"),
      new Date("1961-01-01Z"),
    );
    assert.deepEqual([levels, requests], [[], []]);
  });
});

describe("gesla parse", () => {
  it("maps GESLA's QC and use flags, and drops missing values", () => {
    // Real lines from Cape Dundas, Cuxhaven (WSV and BfG), Cape d'Or and Cape Disappointment.
    const text = [
      "# NULL VALUE -99.9999",
      "1982/03/07 19:00:00   0.3300 1 1",
      "2015/06/01 00:00:00   6.1827 0 1",
      "1917/12/28 23:00:00  -1.0000 4 0",
      "1970/01/01 04:00:00   2.3900 3 0",
      "2015/01/01 01:00:00 -99.9999 5 0",
      "",
    ].join("\n");
    const r = gesla.parse(text, "x", null);
    assert.deepEqual(
      [...r.times].map((t, i) => [iso(t), r.levels[i], r.source[i]]),
      [
        ["1917-12-28T23:00:00.000Z", -1, Flag.bad],
        ["1970-01-01T04:00:00.000Z", 2.39, Flag.suspect],
        ["1982-03-07T19:00:00.000Z", 0.33, Flag.good],
        ["2015-06-01T00:00:00.000Z", 6.1827, Flag.good],
      ],
    );
  });
});

describe("gesla clocks", () => {
  const lines = (times: string[]) =>
    ["# NULL VALUE -99.9999", ...times.map((t) => `${t}   1.0000 0 1`), ""].join("\n");

  it("moves WSV's records only when they're hourly means", () => {
    const hourly = gesla.parse(
      lines(["2015/06/01 00:00:00", "2015/06/01 01:00:00", "2015/06/01 02:00:00"]),
      "x-1-deu-wsv",
      null,
    );
    const minutes = gesla.parse(
      lines(["2015/06/01 00:00:00", "2015/06/01 00:15:00", "2015/06/01 00:30:00"]),
      "x-1-deu-wsv",
      null,
    );
    assert.deepEqual(
      [iso(hourly.times[0]!), iso(minutes.times[0]!)],
      ["2015-06-01T00:30:00.000Z", "2015-06-01T00:00:00.000Z"],
    );
  });

  it("refuses a record off UTC, but keeps Wewak's, which only says it is", () => {
    const text = "# TIME ZONE HOURS 1\n" + lines(["1990/01/01 00:00:00"]);
    assert.throws(() => gesla.parse(text, "x-1-png-bom", null), /on UTC1/);
    assert.equal(
      iso(gesla.parse(text, "wewak-56070-png-bom", null).times[0]!),
      "1990-01-01T00:00:00.000Z",
    );
  });
});

describe("datumJumps", () => {
  const DAY = 86_400_000;
  /** Hourly levels: a tide on `base`, with `step` added from `at` days on. */
  const series = (days: number, base: number, step: number, at: number) => {
    const times: number[] = [];
    const levels: number[] = [];
    for (let h = 0; h < days * 24; h++) {
      times.push(h * 3_600_000);
      levels.push(base + Math.sin(h / 1.98) + (h >= at * 24 ? step : 0));
    }
    return {
      times: Float64Array.from(times),
      levels: Float64Array.from(levels),
      source: new Uint8Array(times.length),
    };
  };

  it("returns the shorter side of a jump", () => {
    assert.deepEqual(gesla.datumJumps(series(200, 2, 1.5, 150)), [[150 * DAY, Infinity]]);
    assert.deepEqual(gesla.datumJumps(series(200, 2, -1.5, 40)), [[-Infinity, 40 * DAY]]);
  });

  it("finds a jump partway through a day", () => {
    assert.deepEqual(gesla.datumJumps(series(200, 2, 1, 100.5)).length, 1);
  });

  it("finds a jump within a month of a record's end", () => {
    assert.deepEqual(gesla.datumJumps(series(200, 2, 1.5, 190)), [[190 * DAY, Infinity]]);
  });

  it("leaves a shift smaller than JUMP_M alone", () => {
    assert.deepEqual(gesla.datumJumps(series(200, 2, gesla.JUMP_M * 0.9, 100)), []);
  });
});

describe("tidal", () => {
  const HOUR = 3_600_000;
  /** Hourly levels over `days`, from 2020, of `level(hour)`, with GESLA's flags all good. */
  const record = (days: number, level: (h: number) => number) => {
    const times = Float64Array.from(
      { length: days * 24 },
      (_, h) => Date.UTC(2020, 0, 1) + h * HOUR,
    );
    return {
      times,
      levels: Float64Array.from(times, (_, h) => level(h)),
      source: new Uint8Array(times.length),
    };
  };
  const wave = (amplitude: number, periodHours: number) => (h: number) =>
    amplitude * Math.cos((2 * Math.PI * h) / periodHours);
  // A pooled river: flat, then a three-week flood of two meters.
  const flood = (h: number) => (h > 2000 && h < 2500 ? 2 : 0);

  it("finds a semidiurnal tide, or a diurnal one, of TIDE_M", () => {
    assert.equal(tidal(record(90, wave(TIDE_M + 0.01, 12.4206012))), true);
    assert.equal(tidal(record(90, wave(TIDE_M + 0.01, 25.8193417))), true);
  });

  it("finds none in a pooled river's floods, a smaller tide, or a daily schedule", () => {
    assert.equal(tidal(record(180, flood)), false);
    assert.equal(tidal(record(90, wave(TIDE_M - 0.02, 12.4206012))), false);
    // A dam's releases each day and half day, which a solar S2 and K1 would read as a tide.
    assert.equal(tidal(record(90, (h) => wave(0.5, 24)(h) + wave(0.3, 12)(h))), false);
  });

  it("says no under 30 days, and leaves out values GESLA says not to use", () => {
    assert.equal(tidal(record(20, wave(1, 12.4206012))), false);
    // A year of daily values, which alias M2 to a 15-day period.
    const daily = record(366, wave(1, 12.4206012));
    const kept = (_: number, i: number) => i % 24 === 0;
    assert.equal(
      tidal({
        times: daily.times.filter(kept),
        levels: daily.levels.filter(kept),
        source: daily.source.filter(kept),
      }),
      false,
    );
    const unused = record(90, wave(1, 12.4206012));
    unused.source.fill(Flag.suspect);
    assert.equal(tidal(unused), false);
  });
});

describe("gesla qc", () => {
  const record = (source_id: string, kind: "river" | "lake") => ({ source_id, kind }) as Station;

  it("gives a tidal river record a tide gauge's flatline limit, and a pooled one two days", () => {
    // Hudson at Albany is in TIDAL_RIVERS; Ashland Avenue, on the Niagara, isn't. Both flood.
    const albany = qcFor(
      gesla.source,
      record("hudson_river_at_albany_ny-1359139-usa-usgs", "river"),
    );
    const ashland = qcFor(gesla.source, record("ashland_ave_ny-9063007-usa-noaa", "river"));
    assert.equal(albany.flatline_s, undefined);
    assert.equal(albany.centimeter_flatline_s, 48 * 3600);
    assert.equal(ashland.flatline_s, 48 * 3600);
    assert.equal(albany.outliers, false);
    assert.equal(ashland.outliers, false);
  });
});
