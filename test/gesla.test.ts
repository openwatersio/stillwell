import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { linkGauges } from "../src/same-as.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as gesla from "../src/sources/gesla/index.ts";
import geslaErrata from "../src/sources/gesla/errata.json" with { type: "json" };

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
  gesla.forgetZipUrl();
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
    assert.deepEqual(gesla.originatorIds("JODC_GIAJ", "gs01", 139.6), ["jodc/GS01"]);
    assert.deepEqual(gesla.originatorIds("JODC_JMA", "ma64", 140.9), []);
    assert.deepEqual(
      gesla.originatorIds("UNAM", "14", -110.3, new Map(), "lapaz_flotador-14-mex-unam"),
      ["unam/14-flotador"],
    );
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

  it("keeps BOM's own records non-commercial, crediting BOM with a link to its conditions", async () => {
    const bom = metadata.replace(
      "seattle-9447130-usa-noaa,Seattle,9447130,USA,NOAA,",
      "seattle-9447130-usa-noaa,Seattle,9447130,USA,BOM,",
    );
    setTransport(async (url) =>
      url.includes("records/resolve")
        ? resolved("https://cvws.example/B/meta/${f}", bom.length)
        : bom,
    );
    const record = (await gesla.stations()).find(
      (s) => s.source_id === "seattle-9447130-usa-noaa",
    )!;
    assert.deepEqual(
      [record.contributor, record.commercial_use, record.attribution],
      [
        "BOM",
        false,
        "GESLA-4.1 (Haigh et al. 2023; Woodworth et al. 2017); Bureau of Meteorology, © Commonwealth of Australia (conditions of use and disclaimers: https://www.bom.gov.au/oceanography/projects/ntc/Tidal_Information_Conditions_of_Use.pdf)",
      ],
    );
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

  it("reads a record from the zip with GESLA's flags as the store's", async () => {
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
    // static release never adds, so they're good, left to the store's own QC.
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

describe("gesla zip url", () => {
  const zipResolves = () =>
    requests.filter(
      ([url, o]) =>
        url.includes("records/resolve") && !String(o.body).includes("02fFab01rq4LdVcwRCf5QCyCQ"),
    ).length;
  /**
   * The fixture transport, with the zip's URL signed until `e`. While
   * `fail.next` is set, reads fail; while `fail.resolves` is, resolves do; a
   * read waits on `fail.hold` when it's set.
   */
  function signedUntil(
    e: number,
    fail: { next: number; resolves?: number; hold?: Promise<void>; held?: () => void } = {
      next: 0,
    },
  ) {
    let n = 0;
    setTransport(async (url, options) => {
      requests.push([url, options]);
      if (url.includes("records/resolve")) {
        if (fail.resolves) {
          fail.resolves--;
          throw new Error("POST records/resolve returned a network error (ETIMEDOUT)");
        }
        // Each resolve signs a URL of its own, as CloudKit does.
        return resolved(`https://cvws.example/B/zip/\${f}?o=${++n}&e=${e}`, zip.length);
      }
      if (url.startsWith("https://cvws.example/B/zip/")) {
        if (fail.hold) {
          const hold = fail.hold;
          fail.hold = undefined;
          fail.held?.();
          await hold;
          throw new Error(`GET ${url} returned 403`);
        }
        if (fail.next > 0) {
          fail.next--;
          throw new Error(`GET ${url} returned 403`);
        }
        const r = /^bytes=(\d+)-(\d+)$/.exec((options.headers as Record<string, string>).range)!;
        return zip.subarray(Number(r[1]), Number(r[2]) + 1).toString("base64");
      }
      throw new Error(`GET ${url} returned 404`);
    });
  }
  const now = () => Math.floor(Date.now() / 1000);

  it("resolves the zip's URL once for many records while it's signed", async () => {
    signedUntil(now() + 900);
    for (const file of [
      "cape_dor-240-can-meds",
      "cuxhavensteubenhft-5990020-deu-wsv",
      "hong_kong-329b-hkg-uhslc_rq",
    ])
      assert.ok((await gesla.readRecord(file)).length > 0);
    assert.equal(zipResolves(), 1);
  });

  it("resolves it again once it's within a minute of expiring", async () => {
    signedUntil(now() + 30);
    await gesla.readRecord("cape_dor-240-can-meds");
    await gesla.readRecord("hong_kong-329b-hkg-uhslc_rq");
    // Every ranged read gets a URL of its own, none of them one about to expire.
    const reads = requests.filter(([url]) => url.startsWith("https://cvws.example/B/zip/")).length;
    assert.ok(reads >= 4);
    assert.equal(zipResolves(), reads);
  });

  it("resolves it again when a signed read fails, and reads on", async () => {
    const fail = { next: 0 };
    signedUntil(now() + 900, fail);
    await gesla.readRecord("cape_dor-240-can-meds");
    fail.next = 1;
    assert.ok((await gesla.readRecord("hong_kong-329b-hkg-uhslc_rq")).length > 0);
    assert.equal(zipResolves(), 2);
  });

  it("shares one resolve among workers reading at once", async () => {
    signedUntil(now() + 900);
    await Promise.all([
      gesla.readRecord("cape_dor-240-can-meds"),
      gesla.readRecord("cuxhavensteubenhft-5990020-deu-wsv"),
      gesla.readRecord("hong_kong-329b-hkg-uhslc_rq"),
    ]);
    assert.equal(zipResolves(), 1);
  });

  it("reports a failed resolve as itself, and the next worker resolves again", async () => {
    signedUntil(now() + 900);
    // The central directory, read first, is kept for the run.
    await gesla.readRecord("cape_dor-240-can-meds");
    gesla.forgetZipUrl();
    requests = [];
    signedUntil(now() + 900, { next: 0, resolves: 1 });
    const [a, b] = await Promise.allSettled([
      gesla.readRecord("cuxhavensteubenhft-5990020-deu-wsv"),
      gesla.readRecord("hong_kong-329b-hkg-uhslc_rq"),
    ]);
    assert.equal(a.status, "rejected");
    assert.match(String((a as PromiseRejectedResult).reason), /ETIMEDOUT/);
    assert.equal(b.status, "fulfilled");
    assert.equal(zipResolves(), 2);
  });

  it("stops at a share that holds another release, and checks again on the next resolve", async () => {
    signedUntil(now() + 900);
    const bytes = gesla.release.bytes;
    gesla.release.bytes = bytes + 1;
    await assert.rejects(gesla.readRecord("cape_dor-240-can-meds"), /a new release\?/);
    await assert.rejects(gesla.readRecord("cape_dor-240-can-meds"), /a new release\?/);
    assert.equal(zipResolves(), 2);
    gesla.release.bytes = bytes;
  });

  it("keeps a newer URL when a read on an older one fails late", async () => {
    let release!: () => void;
    const fail: { next: number; hold?: Promise<void>; held?: () => void } = { next: 0 };
    signedUntil(now() + 900, fail);
    // The central directory, read first, is kept for the run.
    await gesla.readRecord("cuxhavensteubenhft-5990020-deu-wsv");
    gesla.forgetZipUrl();
    requests = [];
    fail.hold = new Promise<void>((r) => (release = r));
    const holding = new Promise<void>((r) => (fail.held = r));
    // Resolves URL 2; its first read waits, then fails.
    const late = gesla.readRecord("cape_dor-240-can-meds");
    await holding;
    // Another worker meanwhile finds it failed and resolves URL 3.
    gesla.forgetZipUrl();
    await gesla.readRecord("hong_kong-329b-hkg-uhslc_rq");
    assert.equal(zipResolves(), 2);
    release();
    // The late failure forgets URL 2 only, and retries on URL 3.
    assert.ok((await late).length > 0);
    assert.equal(zipResolves(), 2);
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
      "2015/01/01 02:00:00 NaN 1 1",
      "2015/01/01 03:00:00 Infinity 1 1",
      "2015/01/01 04:00:00 1.2.3 1 1",
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

  it("lists the same CRMS records as the erratum", () => {
    const entry = geslaErrata.errata.find((e) => e.id === "gesla-crms-hour-early")!;
    assert.deepEqual(
      [...gesla.CRMS_EARLY].sort(),
      (entry.stations as string[]).map((id) => id.replace(/^gesla\//, "")).sort(),
    );
  });

  it("moves the CRMS records the erratum lists an hour later, and no others", () => {
    const text = lines(["2012/06/01 00:00:00", "2012/06/01 01:00:00"]);
    assert.deepEqual(
      [
        "crms0002-crms0002-usa-crms",
        "crms0148-crms0148-usa-crms",
        "crms0400-crms0400-usa-crms",
      ].map((file) => iso(gesla.parse(text, file, null).times[0]!)),
      ["2012-06-01T01:00:00.000Z", "2012-06-01T01:00:00.000Z", "2012-06-01T00:00:00.000Z"],
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
