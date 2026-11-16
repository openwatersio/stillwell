/**
 * One small live request per adapter, checked against the shape recorded in
 * src/sources/<source>/canary.json, so a change upstream fails a check rather
 * than leaving gaps in the store.
 *
 *   node scripts/canary.ts [source...] [--record]
 *
 * Each probe goes through the adapter's own code, so its pacing applies and
 * its own checks (units, datums) run too, and it has to return values. Every
 * response is shaped by its URL path; `--record` writes those shapes as the
 * new reference, after a change has been checked and the adapter handles it.
 * A source with no recording yet prints its shape and has only to return
 * values. USGS is skipped without USGS_API_KEY, and CCO without CCO_API_KEY and CCO_REFERER.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import { drift, merge, type Shape, shapeOf } from "../src/shape.ts";
import * as bodc from "../src/sources/bodc/index.ts";
import * as bom from "../src/sources/bom/index.ts";
import * as bsh from "../src/sources/bsh/index.ts";
import * as cco from "../src/sources/cco/index.ts";
import * as cdec from "../src/sources/cdec/index.ts";
import * as cmems from "../src/sources/cmems/index.ts";
import * as coops from "../src/sources/coops/index.ts";
import * as dwr from "../src/sources/dwr/index.ts";
import * as ea from "../src/sources/ea/index.ts";
import * as crms from "../src/sources/crms/index.ts";
import { header as crmsHeader } from "../src/sources/crms/export.ts";
import * as gesla from "../src/sources/gesla/index.ts";
import * as dmi from "../src/sources/dmi/index.ts";
import * as jma from "../src/sources/jma/index.ts";
import * as jodc from "../src/sources/jodc/index.ts";
import * as kartverket from "../src/sources/kartverket/index.ts";
import * as linz from "../src/sources/linz/index.ts";
import * as marineInstitute from "../src/sources/marine-institute/index.ts";
import * as pegelonline from "../src/sources/pegelonline/index.ts";
import * as kuestendaten from "../src/sources/pegelonline/kuestendaten.ts";
import * as refmar from "../src/sources/refmar/index.ts";
import * as rws from "../src/sources/rws/index.ts";
import * as sfwmd from "../src/sources/sfwmd/index.ts";
import * as smhi from "../src/sources/smhi/index.ts";
import * as uhslc from "../src/sources/uhslc/index.ts";
import * as unam from "../src/sources/unam/index.ts";
import * as usace from "../src/sources/usace/index.ts";
import * as usgs from "../src/sources/usgs/index.ts";

const DAY_MS = 86_400_000;
const end = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
// Three days, so a gauge's outage of a day or two still leaves values.
const start = new Date(end.getTime() - 3 * DAY_MS);

/** A few long-running gauges, each asked for a few days through its adapter. */
const probes: Record<string, () => Promise<unknown[]>> = {
  // Aberdeen, from a month BODC has processed: its values arrive months late.
  bodc: () => bodc.levels("abe", new Date("2025-12-01T00:00Z"), new Date("2025-12-04T00:00Z")),
  // Cape Ferguson's June of last year, from last year's archive, which is whole
  // all year; the current year's runs weeks behind. The FTP's files are text, so
  // it's in UNRECORDED and only has to return values.
  bom: () =>
    bom.levels(
      "995",
      new Date(Date.UTC(end.getUTCFullYear() - 1, 5, 1)),
      new Date(Date.UTC(end.getUTCFullYear() - 1, 5, 4)),
    ),
  // Cuxhaven's predicted highs and lows: the year's smaller file.
  bsh: () => bsh.extremes("506P", end.getUTCFullYear()),
  // The CSV's header, from the export's directory and first 64 KB, checked by
  // the adapter's parser, then the station list: the whole 1.3 GB export is
  // read only once a month, by the refetch.
  crms: async () => {
    await crmsHeader(crms.parser);
    return crms.stations();
  },
  // Deal Pier, found by name in the site list; needs a key, so it is skipped without one.
  cco: async () => {
    const deal = (await cco.stations()).find((s) => s.name === "Deal Pier");
    if (!deal) throw new Error("CCO no longer lists Deal Pier");
    return cco.levels(deal.source_id, start, end);
  },
  // Martinez, on the Carquinez Strait.
  cdec: () => cdec.levels({ source_id: "MRZ" }, start, end),
  // Aarhus, relayed from DMI: a week of the latest window, which runs a day or
  // two behind, and three days of the history copy a year back. Its paths name
  // the time chunk and its SQLite files have no shape, so it's in UNRECORDED.
  cmems: async () => {
    const latest = await cmems.levels("Aarhus", new Date(end.getTime() - 7 * DAY_MS), end);
    const history = await cmems.levels(
      "Aarhus",
      new Date(start.getTime() - 365 * DAY_MS),
      new Date(end.getTime() - 365 * DAY_MS),
    );
    // Either alone would pass a moved bucket, whose 403s read as no chunk.
    return latest.length && history.length ? [...latest, ...history] : [];
  },
  // San Francisco; live, so no metadata request for its dates.
  coops: () => coops.levels("9414290", start, end, { live: true }),
  // Fisherman's Cut in the Delta, from the tail of its file, which runs a day or two behind.
  dwr: () =>
    dwr.levels(
      {
        source_id: "B95050Q",
        parameter: "WaterSurfaceElevationNAVD88",
        datum: "NAVD88",
        record_start: "2015-10-01T08:00:00.000Z",
      },
      new Date(start.getTime() - 7 * DAY_MS),
      end,
    ),
  // Newlyn, from the readings API.
  ea: () => ea.levels("E72239-level-tidal_level-Mean-15_min-mAOD", start, end),
  // A static release, so its metadata, from one iCloud share, then a record's
  // first days from the other: Honolulu Pier 45, one of the smallest.
  gesla: async () => [
    ...(await gesla.stations()).slice(0, 1),
    ...(await gesla.levels(
      { source_id: "honolulu_pier_45-027a-usa-uhslc_rq", kind: "coastal" },
      new Date("1985-10-26Z"),
      new Date("1985-10-29Z"),
    )),
  ],
  // Hornbæk, on DVR90 since 1997.
  dmi: () => dmi.levels("30017", start, end),
  // Mitajiri-Nakanoseki's whole record, 2011 to 2013, the smallest zip (34 KB).
  jodc: () => jodc.levels("8413", new Date("2012-01-01Z"), new Date("2012-01-04Z")),
  // Kushimoto, since 1924: a week of provisional values, which arrive a day or
  // two late, and three days of final ones a year back. Its paths name the month
  // and its text has no shape, so it's in UNRECORDED and only has to return values.
  jma: async () => {
    const latest = await jma.levels("KS", new Date(end.getTime() - 7 * DAY_MS), end);
    const final = await jma.levels(
      "KS",
      new Date(start.getTime() - 365 * DAY_MS),
      new Date(end.getTime() - 365 * DAY_MS),
    );
    // Either set alone would pass a path JMA moved, whose 404s read as no file.
    return latest.length && final.length ? [...latest, ...final] : [];
  },
  // Vardø, since 1989.
  kartverket: () => kartverket.levels("VAW", start, end),
  // Wellington, since 2007: three days of daily files from about two weeks back, since
  // they appear 6 to 12 days late, and three days of a year's file from four years back; Cape Roberts and
  // Scott Base, three days of a year's file each. Its paths name the
  // year and the day, so it's in UNRECORDED and only has to return values.
  linz: async () => {
    const latest = await linz.levels(
      "WLGT",
      new Date(start.getTime() - 14 * DAY_MS),
      new Date(end.getTime() - 14 * DAY_MS),
    );
    const final = await linz.levels(
      "WLGT",
      new Date(start.getTime() - 1500 * DAY_MS),
      new Date(end.getTime() - 1500 * DAY_MS),
    );
    // A listing that lost its yearly zip falls back to the day files, which are preliminary. In early
    // January the latest days can come from last year's zip, so only the old year is held to its flag.
    const read = final.every((o) => o.flag === Flag.good);
    // The Antarctic gauges' files change layout from year to year, so one year of each is read too:
    // Cape Roberts' Julian-day layout of 2025 and Scott Base's millimeters of 2024.
    const robt = await linz.levels(
      "ROBT",
      new Date(start.getTime() - 600 * DAY_MS),
      new Date(end.getTime() - 600 * DAY_MS),
    );
    const scot = await linz.levels(
      "SCOT",
      new Date(start.getTime() - 900 * DAY_MS),
      new Date(end.getTime() - 900 * DAY_MS),
    );
    return latest.length && final.length && read && robt.length && scot.length
      ? [...latest, ...final, ...robt, ...scot]
      : [];
  },
  // Ballycotton, since 2010.
  "marine-institute": () => marineInstitute.levels("Ballycotton Harbour", start, end),
  // Hamburg Port Authority's files on kuestendaten.de, which a backfill reads
  // only after each half-year update: the catalog alone, not the 60 MB zips.
  kuestendaten: async () => {
    const entries = await kuestendaten.catalog();
    // A new half-year's files fail the run, so its email reaches someone.
    const update = kuestendaten.update(entries);
    if (update) throw new Error(update);
    return entries;
  },
  // Cuxhaven Steubenhöft.
  pegelonline: () => pegelonline.levels("5990020", start, end),
  // Brest: three days of raw values, and three of validated ones a year back.
  refmar: async () => [
    ...(await refmar.levels({ source_id: "3", first_observation: null }, start, end)),
    ...(await refmar.levels(
      { source_id: "3", first_observation: null },
      new Date(start.getTime() - 365 * DAY_MS),
      new Date(end.getTime() - 365 * DAY_MS),
    )),
  ],
  rws: () => rws.levels("hoekvanholland", start, end, { fresh: true }),
  // S-123 tailwater on Biscayne Bay: the telemetry series, and two days of the derived one in 2024.
  sfwmd: async () => {
    const live = await sfwmd.levels(
      { series: "IY320", history: null, history_end: null },
      start,
      end,
    );
    // The derived series alone would pass a live feed that returns nothing.
    return live.length
      ? [
          ...live,
          ...(await sfwmd.levels(
            { series: "IY320", history: "AP159", history_end: "2026-05-11T05:00:00.000Z" },
            new Date("2024-01-16T05:00:00Z"),
            new Date("2024-01-18T05:00:00Z"),
          )),
        ]
      : [];
  },
  // Smögen's latest day, and three days of the closed gauge at Götaälvbron in Gothenburg,
  // whose whole archive is about 100 KB; a recent range would download Smögen's.
  smhi: async () => {
    const latest = await smhi.levels("2111", new Date(end.getTime() - 18 * 3_600_000), end);
    // The archive alone would pass a live feed that returns nothing.
    return latest.length
      ? [
          ...latest,
          ...(await smhi.levels("33092", new Date("2012-01-01Z"), new Date("2012-01-04Z"))),
        ]
      : [];
  },
  // Honolulu: its FD series ten weeks back, since FD values arrive 4 to 6
  // weeks late, and three days of its research-quality version A.
  uhslc: async () => [
    ...(await uhslc.levels(
      "057",
      new Date(start.getTime() - 70 * DAY_MS),
      new Date(end.getTime() - 70 * DAY_MS),
    )),
    ...(await uhslc.levels("057a", new Date("1880-01-01Z"), new Date("1880-01-04Z"))),
  ],
  // La Paz's radar, from the end of its file, which holds 5 days.
  unam: () =>
    unam.levels({ source_id: "14-radar", column: "Nivel del mar (radar promedio)" }, start, end),
  usace: () => usace.levels("MVN", "Baton_Rouge.Stage.Inst.1Hour.0.rev", start, end),
  // Mississippi River at Baton Rouge, gage height.
  usgs: () => usgs.levels("9361fa9f474443a4b2391c1f1a63ca4b", start, end),
};

/**
 * Sources never recorded. JMA's, LINZ's and GESLA's request paths change, so a
 * recording would fail the next one: JMA's name the month, LINZ's the year and
 * day, and GESLA's iCloud links are signed anew every 15 minutes. kuestendaten.de's catalog covers the
 * whole portal, so `catalog()` checks only the six entries backfill needs.
 */
const UNRECORDED = new Set(["bom", "cco", "cmems", "gesla", "jma", "kuestendaten", "linz"]);

const args = process.argv.slice(2);
const record = args.includes("--record");
const named = args.filter((a) => !a.startsWith("--"));
for (const id of named) if (!probes[id]) throw new Error(`No canary for ${id}`);

let failed = false;
for (const id of named.length ? named : Object.keys(probes)) {
  const needs = { usgs: ["USGS_API_KEY"], cco: ["CCO_API_KEY", "CCO_REFERER"] }[id];
  const missing = needs?.filter((name) => !process.env[name]);
  if (missing?.length) {
    console.log(`${id}: skipped, no ${missing.join(" and no ")}`);
    continue;
  }
  const shapes: Record<string, Shape[]> = {};
  setTransport(async (url, options) => {
    const text = await fetchText(url, options);
    (shapes[new URL(url).pathname] ??= []).push(shapeOf(text));
    return text;
  });
  const file = new URL(`../src/sources/${id}/canary.json`, import.meta.url);
  try {
    const values = await probes[id]!();
    const live = Object.fromEntries(Object.entries(shapes).map(([path, s]) => [path, merge(...s)]));
    if (record) {
      if (!values.length) throw new Error("no values, so nothing to record");
      if (UNRECORDED.has(id)) {
        console.log(`${id}: not recorded; it is in UNRECORDED`);
        continue;
      }
      writeFileSync(file, `${JSON.stringify(live, null, 2)}\n`);
      console.log(`${id}: recorded ${Object.keys(live).length} responses, ${values.length} values`);
      continue;
    }
    // Until it's recorded, a source has only to return values.
    const recorded: Record<string, Shape> = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : {};
    if (!Object.keys(recorded).length && !UNRECORDED.has(id))
      console.log(
        `${id}: no recorded shape; check this one and record it\n${JSON.stringify(live, null, 2)}`,
      );
    const problems = Object.entries(recorded).flatMap(([path, shape]) =>
      live[path] ? drift(shape, live[path]).map((p) => `${path} ${p}`) : [`no request to ${path}`],
    );
    if (!values.length) problems.push("no values");
    if (problems.length) {
      failed = true;
      console.log(`${id}: FAILED\n${problems.map((p) => `  ${p}`).join("\n")}`);
    } else console.log(`${id}: ok, ${values.length} values`);
  } catch (error) {
    failed = true;
    console.log(`${id}: FAILED\n  ${error instanceof Error ? error.message : error}`);
  }
}
setTransport(fetchText);
if (failed) process.exitCode = 1;
