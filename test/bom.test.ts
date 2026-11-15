import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { FtpError, ftpGet } from "../src/ftp.ts";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import { linkGauges, rank } from "../src/same-as.ts";
import type { Station } from "../src/schema.ts";
import * as bom from "../src/sources/bom/index.ts";
import { BOM_CONDITIONS, NOTICES } from "../src/sources/uhslc/notices.ts";
import { sources } from "../src/sources/index.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));

let requests: string[] = [];
let missing: Set<number>;

describe("bom", () => {
  bom.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
    missing = new Set();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-14T00:00:00Z") });
    setTransport(async (url) => {
      requests.push(url);
      const year = Number(/\/(\d{4})\.ar$/.exec(url)?.[1]);
      // The real archives' members for these gauges, which are all the fixtures hold of each year.
      const name = {
        1996: "bom-1996.ar",
        2005: "bom-2005.ar",
        2025: "bom-2025.ar",
        2026: "bom-2026.ar",
      }[year];
      if (missing.has(year) || !name)
        throw new FtpError("FTP replied 550 Failed to open file.", 550);
      return fixture(name).toString("base64");
    });
    // Each test asks for its archives afresh.
    bom.archives.clear();
  });

  afterEach(() => {
    setTransport(fetchText);
    mock.timers.reset();
  });

  it("is a public source tagged as UHSLC tags its copies of these gauges", () => {
    const { license, attribution, terms } = bom.metadata;
    assert.equal(license.redistribution, true);
    // The same terms UHSLC's copies of BOM's gauges carry, from one notice.
    assert.equal(license.commercial_use, NOTICES.bom!.commercial_use);
    assert.equal(license.commercial_use, true);
    assert.equal(license.url, BOM_CONDITIONS);
    assert.equal(attribution, NOTICES.bom!.credit);
    assert.ok(terms!.startsWith(NOTICES.bom!.terms));
    assert.match(attribution, /Bureau of Meteorology, © Commonwealth of Australia/);
    assert.match(attribution, /Tidal_Information_Conditions_of_Use\.pdf/);
    // Both disclaimers of BOM's conditions of use, and its reply.
    assert.match(terms!, /gives no warranty of any kind/);
    assert.match(terms!, /has subsequently been modified/);
    assert.match(terms!, /CAS-151567-N3L2D4/);
    assert.equal(sources.bom!.metadata.id, "bom");
  });

  it("lists its gauges, active where the newest archive has values", async () => {
    const list = await bom.stations();
    assert.equal(list.length, 29);
    // The newest year's archive, and the year before's for a gauge with no values yet this year.
    assert.deepEqual(requests, [
      "ftp://ftp.bom.gov.au/anon/home/ntc/pacific/uhslc/2026.ar",
      "ftp://ftp.bom.gov.au/anon/home/ntc/pacific/uhslc/2025.ar",
    ]);
    const byId = new Map(list.map((s) => [s.id, s]));
    // The fixture's 2026 archive holds Cape Ferguson and Portland only.
    assert.deepEqual(
      list.filter((s) => s.status === "active").map((s) => s.id),
      ["bom/129", "bom/995"],
    );
    const ferguson = byId.get("bom/995")!;
    assert.equal(ferguson.name, "Cape Ferguson");
    assert.equal(ferguson.datum, "TGZ");
    assert.equal(ferguson.interval_s, 3600);
    assert.equal(ferguson.commercial_use, true);
    assert.equal(
      ferguson.attribution.split("; ")[1],
      "Australian Baseline Sea Level Monitoring Array",
    );
    // The gauge zero is 1.59 m below AHD, so a level less that is in AHD.
    assert.deepEqual(ferguson.datums, { AHD: -1.59 });
    assert.deepEqual(ferguson.same_as, ["gesla/cape_ferguson-59260-aus-bom", "uhslc/343a"]);
    assert.deepEqual(byId.get("bom/166")!.datums, {});
    assert.equal(
      byId.get("bom/001")!.attribution.split("; ")[1],
      "Pacific Sea Level and Geodetic Monitoring Project",
    );
    // Every station has an ID of the store's shape and a distinct number.
    assert.equal(new Set(list.map((s) => s.source_id)).size, 29);
    for (const s of list) assert.match(s.source_id, /^\d{3}$/);
  });

  it("links each gauge to UHSLC's and GESLA's records of it by their IDs, within the distance an ID may span", async () => {
    const list = (await bom.stations()) as Station[];
    const other = (id: string, lat: number, lon: number): Station => ({
      ...list[0]!,
      id,
      source: id.split("/")[0]!,
      source_id: id.split("/")[1]!,
      lat,
      lon,
      same_as: [],
      commercial_use: true,
    });
    // Positions as the store has them: UHSLC's Cape Ferguson and Pohnpei, and GESLA's records of BOM's files.
    const { stations, report } = linkGauges(
      [
        ...list.filter((s) => ["bom/995", "bom/001"].includes(s.id)),
        other("uhslc/343a", -19.28, 147.06),
        other("gesla/cape_ferguson-59260-aus-bom", -19.277, 147.058),
        other("uhslc/001", 6.98, 158.2),
        other("gesla/pohnpei-67950-fsm-bom", 6.987, 158.243),
      ],
      new Date("2026-11-14T00:00:00Z"),
    );
    assert.deepEqual(
      report.dropped.filter((d) => d.from.startsWith("bom/") || d.to.startsWith("bom/")),
      [],
    );
    const byId = new Map(stations.map((s) => [s.id, s]));
    assert.deepEqual(byId.get("bom/995")!.same_as, [
      "gesla/cape_ferguson-59260-aus-bom",
      "uhslc/343a",
    ]);
    assert.deepEqual(byId.get("uhslc/001")!.same_as, ["bom/001", "gesla/pohnpei-67950-fsm-bom"]);
  });

  it("prefers BOM's own series to UHSLC's copy of the same gauge", async () => {
    const list = (await bom.stations()) as Station[];
    const ferguson = list.find((s) => s.id === "bom/995")!;
    const copy: Station & { contributor: string } = {
      ...ferguson,
      id: "uhslc/343a",
      source: "uhslc",
      source_id: "343a",
      lat: -19.28,
      lon: 147.06,
      same_as: [],
      // UHSLC's copy of BOM's gauge carries BOM's notice, so its terms equal BOM's.
      commercial_use: NOTICES.bom!.commercial_use,
      contributor: "Bureau of Meteorology",
      first: "1991-09-12T00:00:00Z",
      last: "2021-12-31T23:00:00Z",
      status: "inactive",
    };
    const own = { ...ferguson, first: "2005-01-01T00:00:00Z", last: "2026-09-30T23:00:00Z" };
    assert.equal(own.commercial_use, copy.commercial_use);
    // BOM's own series comes first whichever way they're compared, though the copy has the longer record.
    assert.ok(rank(own, copy, new Date("2026-11-14T00:00:00Z")) < 0);
    assert.ok(rank(copy, own, new Date("2026-11-14T00:00:00Z")) > 0);
    const { stations } = linkGauges([own, copy], new Date("2026-11-14T00:00:00Z"));
    assert.deepEqual(new Set(stations.map((s) => s.preferred)), new Set(["bom/995"]));
  });

  it("falls back to last year's archive early in a year", async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-01-05T00:00:00Z") });
    missing.add(2027);
    // 2026's archive is the fixture's; 2027 has none yet.
    const list = await bom.stations();
    assert.deepEqual(requests.length, 3);
    assert.deepEqual(
      list.filter((s) => s.status === "active").map((s) => s.id),
      ["bom/129", "bom/995"],
    );
  });

  it("reads a year's hourly levels in meters, preliminary in the current year", async () => {
    const out = await bom.levels(
      "995",
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-01-02T00:00:00Z"),
    );
    assert.equal(out.length, 24);
    // 995FERGUSON2026 1 11 2852 2364 ...: January 1, hours 0 to 11 first.
    assert.deepEqual(out[0], {
      time: Date.UTC(2026, 0, 1, 0),
      level: 2.852,
      flag: Flag.preliminary,
      source_flag: Flag.preliminary,
    });
    assert.equal(out[1]!.level, 2.364);
    assert.equal(out[12]!.time, Date.UTC(2026, 0, 1, 12));
    assert.equal(out[12]!.level, 1.876);
    // The end is exclusive, and an hour in is a request for the rest.
    const rest = await bom.levels(
      "995",
      new Date("2026-01-01T23:00:00Z"),
      new Date("2026-01-02T01:00:00Z"),
    );
    assert.deepEqual(
      rest.map((o) => o.time),
      [Date.UTC(2026, 0, 1, 23), Date.UTC(2026, 0, 2, 0)],
    );
    // Both asks read the one archive.
    assert.equal(requests.length, 1);
  });

  it("keeps last year preliminary until April, while BOM rebuilds its archive", async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-02-10T00:00:00Z") });
    const early = await bom.levels("995", new Date("2026-01-01Z"), new Date("2026-01-02Z"));
    assert.equal(early[0]!.flag, Flag.preliminary);
    assert.equal(early[0]!.source_flag, Flag.preliminary);
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-04-10T00:00:00Z") });
    const later = await bom.levels("995", new Date("2026-01-01Z"), new Date("2026-01-02Z"));
    assert.equal(later[0]!.flag, Flag.good);
  });

  it("keeps a gauge active that the new year's archive hasn't a value for yet", async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-01-05T00:00:00Z") });
    // 2027's archive holds no one's values yet (a stub); 2026's is the fixture's.
    bom.archives.set(2027, Promise.resolve(new Map()));
    const list = await bom.stations();
    assert.deepEqual(
      list.filter((s) => s.status === "active").map((s) => s.id),
      ["bom/129", "bom/995"],
    );
  });

  it("flags earlier years good, and reads a file whose first line is garbled", async () => {
    // BOM's 2005 file for Burnie has a damaged position line, which holds no value.
    const out = await bom.levels("994", new Date("2005-06-01Z"), new Date("2005-06-02Z"));
    assert.equal(out.length, 24);
    assert.ok(out.every((o) => o.flag === Flag.good && o.source_flag === Flag.good));
    assert.ok(out.every((o) => o.level > 0 && o.level < 4));
  });

  it("reads a member BOM compressed with gzip under a .Z name", async () => {
    const out = await bom.levels("002", new Date("1996-03-01Z"), new Date("1996-03-02Z"));
    assert.equal(out.length, 24);
  });

  it("returns nothing for a year BOM has no archive for, and fails on any other error", async () => {
    assert.deepEqual(await bom.levels("995", new Date("2000-01-01Z"), new Date("2000-02-01Z")), []);
    // A gauge the archive lacks has no values either.
    assert.deepEqual(await bom.levels("166", new Date("2026-01-01Z"), new Date("2026-01-02Z")), []);
    setTransport(async () => {
      throw new FtpError("FTP replied 421 Service not available", 421);
    });
    await assert.rejects(
      bom.levels("995", new Date("2024-01-01Z"), new Date("2024-01-02Z")),
      /421/,
    );
    // A 550 for a year BOM should have is an error, not no values; a year with none is.
    // A failed archive is kept for the run, so each gauge doesn't ask a stalled server again.
    let asked = 0;
    setTransport(async () => {
      asked++;
      throw new FtpError("FTP replied 421 Service not available", 421);
    });
    bom.archives.clear();
    for (let i = 0; i < 3; i++)
      await assert.rejects(
        bom.levels("995", new Date("2024-01-01Z"), new Date("2024-01-02Z")),
        /421/,
      );
    assert.equal(asked, 1);
    bom.archives.clear();
    setTransport(async () => {
      throw new FtpError("FTP replied 550 Failed to open file.", 550);
    });
    await assert.rejects(
      bom.levels("995", new Date("2024-01-01Z"), new Date("2024-01-02Z")),
      /550/,
    );
    assert.deepEqual(await bom.levels("995", new Date("2001-01-01Z"), new Date("2001-01-02Z")), []);
    // The year under way has none until BOM makes it.
    bom.archives.clear();
    assert.deepEqual(await bom.levels("995", new Date("2026-02-01Z"), new Date("2026-02-02Z")), []);
  });

  it("refuses another datum and a gauge that isn't BOM's", async () => {
    await assert.rejects(
      bom.levels("995", new Date("2026-01-01Z"), new Date("2026-01-02Z"), { datum: "AHD" }),
      /read in TGZ/,
    );
    await assert.rejects(
      bom.levels("175", new Date("2026-01-01Z"), new Date("2026-01-02Z")),
      /Not a BOM gauge/,
    );
  });

  it("skips missing values and refuses a file it can't read", () => {
    const header = "995FERGUSON2026  LAT=19 17.0S  LONG=147 03.0E  TIMEZONE=GMT";
    const line = (stn: string, md: string, half: number, cells: string[]) =>
      `${stn}FERGUSON2026${md}${half}${cells.map((c) => c.padStart(5)).join("")}`;
    const cells = ["9999", "10431", "-9", ...Array<string>(9).fill("500")];
    const full = Array<string>(12).fill("500");
    const file = (...lines: string[]) => [header, ...lines].join("\n");
    const first = bom.parse(file(line("995", " 1 1", 1, cells)), "995", 2026);
    assert.deepEqual(
      first.slice(0, 2).map((o) => [o.time, o.level]),
      [
        [Date.UTC(2026, 0, 1, 1), 10.431],
        [Date.UTC(2026, 0, 1, 2), -0.009],
      ],
    );
    assert.equal(first.length, 11);
    // A finished year has to run to its last half-day.
    assert.throws(
      () => bom.parse(file(line("995", " 1 1", 1, full)), "995", 2026, true),
      /ends before/,
    );
    // The half-day lines run on from January 1: the second half, the next day.
    const two = bom.parse(
      file(
        line("995", " 1 1", 1, full),
        line("995", " 1 1", 2, full),
        line("995", " 1 2", 1, full),
      ),
      "995",
      2026,
    );
    assert.equal(two.length, 36);
    assert.equal(two[35]!.time, Date.UTC(2026, 0, 2, 11));
    const bad = (text: string, pattern: RegExp) =>
      assert.throws(() => bom.parse(text, "995", 2026), pattern);
    // Another gauge's line, another year's, and a day that isn't one.
    bad(file(line("996", " 1 1", 1, cells)), /has a line/);
    bad(file(line("995", " 1 1", 1, cells).replace("2026", "2025")), /has a line/);
    bad(file(line("995", " 631", 1, cells)), /belongs/);
    // A missing, repeated or out-of-order half-day, and a file that doesn't start on January 1.
    bad(file(line("995", " 1 1", 1, full), line("995", " 1 2", 1, full)), /1\/? ?2?.*belongs/);
    bad(file(line("995", " 1 1", 1, full), line("995", " 1 1", 1, full)), /belongs/);
    bad(file(line("995", " 1 1", 2, full)), /belongs/);
    bad(file(line("995", " 1 2", 1, full)), /belongs/);
    // Day 0 and month 13 aren't dates a neighboring day can stand for.
    bad(file(line("995", " 1 0", 1, full)), /belongs/);
    bad(file(line("995", "13 1", 1, full)), /belongs/);
    // A blank or malformed cell isn't a level, whatever its place in the line.
    for (const at of [0, 5, 11]) {
      const blank = [...full];
      blank[at] = "";
      bad(file(line("995", " 1 1", 1, blank)), /not a level/);
    }
    bad(file(line("995", " 1 1", 1, [...full.slice(0, 11), "- 5"])), /not a level/);
    bad(file(line("995", " 1 1", 1, ["1 23", ...full.slice(1)])), /not a level/);
    // A blank line inside the file is a damaged record, not nothing; only the last newline is.
    bad(`${file(line("995", " 1 1", 1, full), "", line("995", " 1 1", 2, full))}`, /has a line/);
    assert.equal(bom.parse(`${file(line("995", " 1 1", 1, full))}\n`, "995", 2026).length, 12);
    assert.equal(bom.parse(`${file(line("995", " 1 1", 1, full))}\r\n`, "995", 2026).length, 12);
    // A first line that is a line of levels is one, not a damaged position line.
    assert.equal(bom.parse(line("995", " 1 1", 1, full), "995", 2026).length, 12);
    assert.equal(bom.parse("garbled\n" + line("995", " 1 1", 1, full), "995", 2026).length, 12);
  });

  it("decompresses compress and gzip files", () => {
    const text = bom
      .uncompress(bom.unar(fixture("bom-2026.ar"), 2026).get("995")!)
      .toString("latin1");
    assert.match(text, /^995FERGUSON2026 {2}LAT=19 17\.0S {2}LONG=147 03\.0E {2}TIMEZONE=GMT\n/);
    // The fixture's 2026 file runs to September 30: 273 days, two lines each, and the position line.
    assert.equal(text.trim().split("\n").length, 547);
    assert.throws(() => bom.uncompress(Buffer.from("not compressed")), /Not a compressed/);
    assert.throws(() => bom.unar(Buffer.from("nothing"), 2026), /isn't an archive/);
  });
});

describe("ftp", () => {
  let server: Server;
  /** Every socket and passive listener the server opened, closed after each test. */
  const open: { destroy?: () => void; close?: () => void }[] = [];
  let port: number;
  /** An anonymous FTP server that serves a file, or refuses one it hasn't. */
  const files = new Map<string, Buffer>([["/anon/a.bin", Buffer.from([0, 1, 2, 250, 251])]]);

  beforeEach(async () => {
    server = createServer((control: Socket) => {
      open.push(control);
      let data: Server | undefined;
      control.write("220 ready\r\n");
      let buffer = "";
      control.on("data", (chunk) => {
        buffer += chunk.toString("latin1");
        let end: number;
        while ((end = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const [verb, arg] = [line.split(" ")[0], line.slice(5)];
          if (verb === "USER") control.write("331 password\r\n");
          else if (verb === "PASS")
            control.write("230-welcome\r\n231 not the end\r\n 230 nor this\r\n230 in\r\n");
          else if (verb === "TYPE") control.write("200 binary\r\n");
          else if (verb === "PASV") {
            data = createServer((socket) => open.push(socket));
            open.push(data);
            data.listen(0, "127.0.0.1", () => {
              const p = (data!.address() as { port: number }).port;
              control.write(`227 Entering Passive Mode (10,9,9,9,${p >> 8},${p & 255})\r\n`);
            });
          } else if (verb === "RETR") {
            const body = files.get(arg!);
            if (arg === "/anon/stall.bin") {
              // Starts the transfer and never ends it, as a dropped route does.
              data!.once("connection", (socket) => socket.write("partial"));
              control.write("150 sending\r\n");
              continue;
            }
            if (!body) {
              control.write("550 Failed to open file.\r\n");
              data?.close();
              continue;
            }
            data!.once("connection", (socket) => {
              socket.end(body);
              data!.close();
              control.write("226 done\r\n");
            });
            control.write("150 sending\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => {
    for (const handle of open.splice(0)) {
      handle.destroy?.();
      handle.close?.();
    }
    server.close();
  });

  it("reads a file over a passive connection, whatever address the server gives", async () => {
    const got = await ftpGet(`ftp://127.0.0.1:${port}/anon/a.bin`);
    assert.deepEqual([...got], [0, 1, 2, 250, 251]);
  });

  it("is what fetchText gives for an ftp:// URL, as text or base64", async () => {
    const url = `ftp://127.0.0.1:${port}/anon/a.bin`;
    assert.equal(
      await fetchText(url, { base64: true }),
      Buffer.from([0, 1, 2, 250, 251]).toString("base64"),
    );
    assert.equal(await fetchText(url), Buffer.from([0, 1, 2, 250, 251]).toString("latin1"));
  });

  it("gives up on a transfer that stalls, instead of waiting for it", async () => {
    await assert.rejects(
      ftpGet(`ftp://127.0.0.1:${port}/anon/stall.bin`, 300),
      (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
    );
  });

  it("refuses a path that holds a line break, which would start another command", async () => {
    await assert.rejects(
      ftpGet(`ftp://127.0.0.1:${port}/anon/a.bin%0D%0ADELE%20x`),
      /Not an FTP path/,
    );
    await assert.rejects(ftpGet(`ftp://127.0.0.1:${port}/anon/a%00.bin`), /Not an FTP path/);
  });

  it("reports a refusal with its code, and doesn't retry a 550", async () => {
    await assert.rejects(
      fetchText(`ftp://127.0.0.1:${port}/anon/none.bin`),
      (error: unknown) => error instanceof FtpError && error.code === 550,
    );
  });
});
