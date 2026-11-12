import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { firstEpochs } from "../src/epochs.ts";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import { originatorIds } from "../src/sources/gesla/index.ts";
import { crmsOf } from "../src/sources/usgs/index.ts";
import { originatorSeries, type TiconRecord } from "../src/ticon.ts";

// The split export goes to the cache, read when the module loads.
process.env.STILLWELL_CACHE = mkdtempSync(join(tmpdir(), "crms-"));
const crms = await import("../src/sources/crms/index.ts");
const { forget, header, tuning } = await import("../src/sources/crms/export.ts");

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
/** Rows recorded from CPRA's export of 8 November 2026, the header and each station's rows together. */
const CSV = fixture("crms-export.csv");

/**
 * A zip holding `csv` deflated, laid out as CPRA's export is: the local
 * header, the data, the central directory with the entry's 64-bit sizes, then
 * the classic end record, since the zip is under 4 GB. `zip64` puts a ZIP64
 * end record with that many bytes of extensible data, and its locator, before
 * it. `crc` overrides the CRC.
 */
function zipOf(csv: Buffer, crc = crc32(csv), zip64: false | number = false): Buffer {
  const name = Buffer.from("CRMS_Continuous_Hydrographic.csv");
  const data = deflateRawSync(csv);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0xffffffff, 18);
  local.writeUInt32LE(0xffffffff, 22);
  local.writeUInt16LE(name.length, 26);
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(BigInt(csv.length), 4);
  extra.writeBigUInt64LE(BigInt(data.length), 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc >>> 0, 16);
  central.writeUInt32LE(0xffffffff, 20);
  central.writeUInt32LE(0xffffffff, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(extra.length, 30);
  const dir = Buffer.concat([central, name, extra]);
  const dirOffset = local.length + name.length + data.length;
  const end64 = Buffer.alloc(56 + (zip64 || 0));
  end64.writeUInt32LE(0x06064b50, 0);
  end64.writeBigUInt64LE(BigInt(end64.length - 12), 4);
  end64.writeBigUInt64LE(BigInt(dir.length), 40);
  end64.writeBigUInt64LE(BigInt(dirOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(dirOffset + dir.length), 8);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(zip64 === false ? dirOffset : 0xffffffff, 16);
  return Buffer.concat([local, name, data, dir, ...(zip64 === false ? [] : [end64, locator]), end]);
}

let requests: string[] = [];

/** Serves the layers from fixtures and `zip` as byte ranges, suffix ranges included. */
function serve(zip: Buffer): void {
  setTransport(async (url: string, options: RequestOptions) => {
    if (url.includes("monitoring_stations")) return fixture("crms-stations.json").toString();
    if (url.includes("crms_points")) return fixture("crms-sites.json").toString();
    const range = (options.headers as Record<string, string>).range!;
    requests.push(range);
    assert.ok(options.partial && options.fresh, "a range is fresh and refuses the whole file");
    const suffix = /^bytes=-(\d+)$/.exec(range);
    if (suffix) return zip.subarray(Math.max(0, zip.length - Number(suffix[1]))).toString("base64");
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!.map(Number);
    return zip.subarray(from, to! + 1).toString("base64");
  });
}

/** The recorded CSV with one string replaced, which must be there. */
function edit(from: string, to: string): Buffer {
  const text = CSV.toString("latin1");
  assert.ok(text.includes(from), from);
  return Buffer.from(text.replace(from, to), "latin1");
}

const station = (source_id: string) => ({ source_id, datum: "NAVD88" }) as Station;
const ALL = [new Date("2000-01-01Z"), new Date("2030-01-01Z")] as const;

beforeEach(() => {
  requests = [];
  // Each test splits its own zip, in a directory named for its CRC.
  forget();
});
afterEach(() => setTransport(fetchText));

describe("crms stations", () => {
  it("lists the surface-water gauges, with the GEOID12B switch as their reference", async () => {
    serve(zipOf(CSV));
    const list = await crms.stations();
    assert.deepEqual(
      list.map((s) => s.id),
      [
        "crms/CRMS0002-H01",
        "crms/CRMS0034-H01",
        "crms/CRMS0047-H01",
        "crms/CRMS0572-H01",
        "crms/CRMS0662-H01",
      ],
    );
    const s = list[0]!;
    assert.equal(s.datum, "NAVD88");
    assert.deepEqual(s.reference, { id: "GEOID12B", since: "2013-10-01" });
    assert.equal(s.kind, "estuary");
    assert.equal(s.commercial_use, true);
    // CRMS0047 is a swamp site.
    assert.equal(list[2]!.kind, "lake");
    assert.deepEqual(s.same_as, []);
  });

  it("links the gauges of one site, which CPRA numbers anew as it moves them", async () => {
    const layer = JSON.parse(fixture("crms-stations.json").toString());
    const moved = structuredClone(layer.features[2]);
    assert.equal(moved.attributes["CPRA_monitoring.STATION_ID"], "CRMS0002-H01");
    moved.attributes["CPRA_monitoring.STATION_ID"] = "CRMS0002-H02";
    layer.features.push(moved);
    setTransport(async (url: string) =>
      url.includes("monitoring_stations")
        ? JSON.stringify(layer)
        : fixture("crms-sites.json").toString(),
    );
    // The store keeps H03 after the layer stopped listing it.
    const stored = { id: "crms/CRMS0002-H03", source_id: "CRMS0002-H03" } as Station;
    const list = await crms.stations([stored]);
    const same = Object.fromEntries(list.map((s) => [s.id, s.same_as]));
    assert.deepEqual(same["crms/CRMS0002-H01"], ["crms/CRMS0002-H02", "crms/CRMS0002-H03"]);
    assert.deepEqual(same["crms/CRMS0002-H02"], ["crms/CRMS0002-H01", "crms/CRMS0002-H03"]);
    assert.equal(same["crms/CRMS0002-H03"], undefined);
    assert.deepEqual(same["crms/CRMS0034-H01"], []);
  });
});

describe("crms epochs", () => {
  it("splits a new station at the first GEOID12B hour, leaving GEOID99 unconverted", async () => {
    serve(zipOf(CSV));
    const [listed] = await crms.stations();
    const epochs = firstEpochs(
      { ...listed!, datum: "NAVD88" },
      {
        station: listed!.id,
        now: "2026-11-10T00:00:00.000Z",
        offsets: crms.metadata.utc_offsets!,
        decisions: {},
        archive: crms.metadata.archive,
      },
    );
    assert.deepEqual(
      epochs.map((e) => [e.id, e.since, e.until, e.to_current]),
      [
        [1, null, "2013-10-01T06:00:00Z", null],
        [2, "2013-10-01T06:00:00Z", null, 0],
      ],
    );
  });
});

describe("crms levels", () => {
  it("reads the export once, as meters in UTC, against the geoid of their time", async () => {
    serve(zipOf(CSV));
    const rows = await crms.levels(station("CRMS0002-H01"), ...ALL);
    // 9/29/2007 09:00 CST, 1.26 ft against GEOID99.
    assert.deepEqual(rows[0], {
      time: Date.parse("2007-09-29T15:00:00Z"),
      level: 0.384,
      flag: Flag.good,
      source_flag: Flag.good,
    });
    // 10/1/2013 00:00 CST, the first GEOID12B hour.
    assert.ok(rows.some((r) => r.time === Date.parse("2013-10-01T06:00:00Z") && r.level === 0.335));
    // A second station's fetch reads the split export, not the server again.
    const ranges = requests.length;
    assert.deepEqual(
      (
        await crms.levels(station("CRMS0002-H01"), new Date("2013-01-01Z"), new Date("2014-01-01Z"))
      ).map((r) => r.time),
      [Date.parse("2013-10-01T06:00:00Z")],
    );
    await crms.levels(station("CRMS0034-H01"), ...ALL);
    assert.equal(requests.length, ranges);
  });

  it("leaves out wells, floating-marsh sensors and copies of another gauge", async () => {
    serve(zipOf(CSV));
    for (const id of ["CRMS0058-W01", "CRMS0128-M100", "CRMS0176-H0X"])
      assert.deepEqual(await crms.levels(station(id), ...ALL), []);
  });

  it("flags values CPRA's comments describe as a dry sensor or a stand-in", async () => {
    serve(zipOf(CSV));
    // Water level at or below 0.03 ft over the sensor.
    const [dry] = await crms.levels(station("CRMS0047-H01"), ...ALL);
    assert.equal(dry!.source_flag, Flag.suspect);
    // Low water named as the cause of a conductance reading leaves the elevation alone.
    const spcond = await crms.levels(station("CRMS0034-H01"), ...ALL);
    assert.deepEqual(
      spcond.map((r) => r.flag),
      [Flag.good],
    );
    // A day's median kept in place of its readings.
    const [median] = await crms.levels(station("CRMS0572-H01"), ...ALL);
    assert.equal(median!.flag, Flag.suspect);
  });

  it("refuses a value against a geoid its time doesn't belong to", async () => {
    const text = CSV.toString("latin1").replace(
      "10/1/2013,00:00:00,CST,Surface Water,26.58,26.58,11660.00,11660.00,6.63,6.66,2.05,2.05,,0.669,,1.10,,,GEOID12B",
      "10/1/2013,00:00:00,CST,Surface Water,26.58,26.58,11660.00,11660.00,6.63,6.66,2.05,2.05,,0.669,,1.10,,,GEOID18",
    );
    assert.notEqual(text, CSV.toString("latin1"));
    serve(zipOf(Buffer.from(text, "latin1")));
    await assert.rejects(
      crms.levels(station("CRMS0002-H01"), ...ALL),
      /2013-10-01T06:00:00.000Z against another geoid, not GEOID12B/,
    );
  });

  it("downloads an export once more when it doesn't match its CRC, then refuses it", async () => {
    serve(zipOf(CSV, 1234));
    await assert.rejects(crms.levels(station("CRMS0002-H01"), ...ALL), /doesn't match its CRC/);
    // Each download reads the tail before and after it.
    const downloads = requests.filter((r) => r === "bytes=-65536").length;
    assert.equal(downloads, 4);
    // The stations after it don't download it again.
    await assert.rejects(crms.levels(station("CRMS0034-H01"), ...ALL), /doesn't match its CRC/);
    assert.equal(requests.filter((r) => r === "bytes=-65536").length, downloads);
  });

  it("downloads an export again when it was rebuilt during the download", async () => {
    // Its own values, so no other test's split of the recorded export is reused.
    const before = zipOf(
      edit(
        "9/29/2007,09:00:00,CST,Surface Water,26.29,26.29,17718.10,17718.10,10.43,10.42,1.87,1.87,,0.820,,1.26",
        "9/29/2007,09:00:00,CST,Surface Water,26.29,26.29,17718.10,17718.10,10.43,10.42,1.87,1.87,,0.820,,1.25",
      ),
    );
    const after = zipOf(
      edit(
        "9/29/2007,09:00:00,CST,Surface Water,26.29,26.29,17718.10,17718.10,10.43,10.42,1.87,1.87,,0.820,,1.26",
        "9/29/2007,09:00:00,CST,Surface Water,26.29,26.29,17718.10,17718.10,10.43,10.42,1.87,1.87,,0.820,,1.27",
      ),
    );
    // The first tail read finds last week's export; every read after it this week's.
    let tails = 0;
    setTransport(async (_url, options) => {
      const range = (options.headers as Record<string, string>).range!;
      requests.push(range);
      const zip = range === "bytes=-65536" && tails++ === 0 ? before : after;
      if (range === "bytes=-65536")
        return zip.subarray(Math.max(0, zip.length - 65_536)).toString("base64");
      const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range)!.map(Number);
      return (tails > 1 ? after : before).subarray(from, to! + 1).toString("base64");
    });
    assert.equal((await crms.levels(station("CRMS0002-H01"), ...ALL))[0]!.level, 0.387);
  });

  it("refuses an export with no surface-water elevations, as a new format", async () => {
    const text = CSV.toString("latin1").replaceAll(/^(CRMS\d{4})-H0/gm, "$1H0");
    serve(zipOf(Buffer.from(text, "latin1")));
    await assert.rejects(
      crms.levels(station("CRMS0002-H01"), ...ALL),
      /no surface-water elevations/,
    );
  });

  it("downloads an export with a bad row once, failing every station", async () => {
    serve(zipOf(edit("9/29/2007,09:00:00,CST", "9/29/2007,09:00:00,CDT")));
    await assert.rejects(crms.levels(station("CRMS0002-H01"), ...ALL), /not CST/);
    const sent = requests.length;
    await assert.rejects(crms.levels(station("CRMS0034-H01"), ...ALL), /not CST/);
    assert.equal(requests.length, sent);
  });

  it("checks the clock of a row with no elevation", async () => {
    // CRMS0002's 2026 row has no adjusted elevation.
    serve(zipOf(edit("CRMS0002-H01,2/1/2026,10:00:00,CST", "CRMS0002-H01,2/1/2026,10:00:00,CDT")));
    await assert.rejects(crms.levels(station("CRMS0002-H01"), ...ALL), /not CST/);
  });

  it("refuses a date or time that rolls over", async () => {
    serve(zipOf(edit("9/29/2007,09:00:00,CST", "13/29/2007,09:00:00,CST")));
    await assert.rejects(crms.levels(station("CRMS0002-H01"), ...ALL), /impossible time/);
    forget();
    serve(zipOf(edit("9/29/2007,09:00:00,CST", "9/29/2007,09:00:60,CST")));
    await assert.rejects(crms.levels(station("CRMS0002-H01"), ...ALL), /impossible time/);
  });

  it("reads a station ID with a trailing no-break space as the station's", async () => {
    serve(zipOf(edit("CRMS0572-H01,", "CRMS0572-H01\u00a0,")));
    assert.equal((await crms.levels(station("CRMS0572-H01"), ...ALL)).length, 1);
  });

  it("flags a low-water note of its own, after a leading space", async () => {
    serve(
      zipOf(
        edit(
          "COASTAL ESTUARY SERVICES LLC,,30.10031149,-89.79156699\r\nCRMS0002-H01,9/29/2007,10:00:00",
          "COASTAL ESTUARY SERVICES LLC, Low water.,30.10031149,-89.79156699\r\nCRMS0002-H01,9/29/2007,10:00:00",
        ),
      ),
    );
    assert.equal((await crms.levels(station("CRMS0002-H01"), ...ALL))[0]!.flag, Flag.suspect);
  });

  it("reads the CSV's header from the export's first bytes", async () => {
    serve(zipOf(CSV));
    assert.equal((await header(crms.parser))[0], "Station ID");
    serve(zipOf(edit("Adjusted Water Elevation to Datum (ft)", "Adjusted Water Elevation (ft)")));
    await assert.rejects(header(crms.parser), /no Adjusted Water Elevation to Datum \(ft\) column/);
  });

  it("reads a zip that ends in a ZIP64 end record, and refuses one with no end record", async () => {
    serve(zipOf(CSV, undefined, 0));
    assert.equal((await crms.levels(station("CRMS0002-H01"), ...ALL))[0]!.level, 0.384);
    // A ZIP64 end record with extensible data.
    forget();
    serve(zipOf(CSV, undefined, 9));
    assert.equal((await crms.levels(station("CRMS0002-H01"), ...ALL))[0]!.level, 0.384);
    forget();
    serve(zipOf(CSV).subarray(0, -22));
    await assert.rejects(
      crms.levels(station("CRMS0002-H01"), ...ALL),
      /no end of central directory/,
    );
    // An end record that points to a ZIP64 one that isn't there.
    forget();
    const z64 = zipOf(CSV, undefined, 0);
    serve(Buffer.concat([z64.subarray(0, -98), z64.subarray(-22)]));
    await assert.rejects(crms.levels(station("CRMS0002-H01"), ...ALL), /needs a ZIP64 end record/);
  });

  it("reads past stray signatures, in compressed data or the end record's comment", async () => {
    const zip = zipOf(CSV);
    const at = zip.indexOf(Buffer.from("PK\x05\x06", "latin1"));
    const tail = Buffer.from(zip);
    // The end record's comment holds the signature, as compressed data can by chance.
    const comment = Buffer.from("PK\x06\x06 and PK\x05\x06 and more", "latin1");
    tail.writeUInt16LE(comment.length, at + 20);
    serve(Buffer.concat([tail, comment]));
    assert.equal((await crms.levels(station("CRMS0002-H01"), ...ALL))[0]!.level, 0.384);
  });

  it("leaves out a row whose fields don't match the header", async () => {
    serve(
      zipOf(
        edit("CRMS0572-H01,7/26/2024,19:00:00,CST,", "CRMS0572-H01,7/26/2024,19:00:00,CST,extra,"),
      ),
    );
    assert.deepEqual(await crms.levels(station("CRMS0572-H01"), ...ALL), []);
  });

  it("reads a zip larger than its tail in many ranges", async () => {
    // Rows of a well the adapter leaves out, with digits that don't compress.
    let seed = 1;
    const noise = () => ((seed = (seed * 48271) % 2147483647) / 2147483647).toFixed(9);
    const wells = Array.from(
      { length: 20_000 },
      (_, i) =>
        `CRMS9999-W01,1/1/2020,${String(i % 24).padStart(2, "0")}:00:00,CST,Marsh Well,${noise()},${noise()}${",".repeat(39)}`,
    );
    const text = CSV.toString("latin1").trimEnd() + "\r\n" + wells.join("\r\n") + "\r\n";
    const zip = zipOf(Buffer.from(text, "latin1"));
    assert.ok(zip.length > 3 * 65_536);
    tuning.chunk = 10_000;
    try {
      serve(zip);
      assert.equal((await crms.levels(station("CRMS0002-H01"), ...ALL))[0]!.level, 0.384);
      assert.ok(requests.length > 20);
      // The canary's header read inflates a stream cut off at 64 KB.
      assert.equal((await header(crms.parser))[0], "Station ID");
    } finally {
      tuning.chunk = 16 << 20;
    }
  });
});

describe("crms links", () => {
  it("links GESLA's and USGS's copies to the site's gauge", () => {
    assert.deepEqual(originatorIds("CRMS", "CRMS0002", -89.79), ["crms/CRMS0002-H01"]);
    assert.deepEqual(crmsOf("CRMS0282-H01-RT"), ["crms/CRMS0282-H01"]);
    assert.deepEqual(crmsOf("CRMS0641"), ["crms/CRMS0641-H01"]);
    assert.deepEqual(crmsOf("MISSISSIPPI RIVER AT BATON ROUGE"), []);
  });

  it("matches a TICON record to its site's gauge still reporting", () => {
    const record = {
      id: "crms0511-crms0511-usa-crms",
      contributor: "crms",
      code: "crms0511",
      lat: 29.4,
      lon: -90.3,
    } as TiconRecord;
    const gauge = (source_id: string, status: "active" | "inactive") =>
      ({
        id: `crms/${source_id}`,
        source_id,
        status,
        products: ["levels"],
        lat: 29.4,
        lon: -90.3,
      }) as Station;
    const lists = { crms: [gauge("CRMS0511-H01", "inactive"), gauge("CRMS0511-H02", "active")] };
    assert.equal(originatorSeries(record, lists).id, "crms/CRMS0511-H02");
    // A newer gauge since retired loses to one still reporting; a site with none reporting takes the latest.
    lists.crms.push(gauge("CRMS0511-H03", "inactive"));
    assert.equal(originatorSeries(record, lists).id, "crms/CRMS0511-H02");
    assert.equal(
      originatorSeries(record, {
        crms: [gauge("CRMS0511-H01", "inactive"), gauge("CRMS0511-H02", "inactive")],
      }).id,
      "crms/CRMS0511-H02",
    );
    assert.equal(originatorSeries(record, {}).status, "planned");
  });
});
