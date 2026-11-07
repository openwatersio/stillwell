/**
 * One small live request per adapter, checked against the shape recorded in
 * src/sources/<source>/canary.json, so a change upstream fails a check rather
 * than leaving gaps in the lake.
 *
 *   node scripts/canary.ts [source...] [--record]
 *
 * Each probe goes through the adapter's own code, so its pacing applies and
 * its own checks (units, datums) run too, and it has to return values. Every
 * response is shaped by its URL path; `--record` writes those shapes as the
 * new reference, after a change has been checked and the adapter handles it.
 * A source with no recording yet prints its shape and has only to return
 * values. USGS is skipped without USGS_API_KEY.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchText, setTransport } from "../src/http.ts";
import { drift, merge, type Shape, shapeOf } from "../src/shape.ts";
import * as bsh from "../src/sources/bsh/index.ts";
import * as coops from "../src/sources/coops/index.ts";
import * as ea from "../src/sources/ea/index.ts";
import * as dmi from "../src/sources/dmi/index.ts";
import * as jma from "../src/sources/jma/index.ts";
import * as kartverket from "../src/sources/kartverket/index.ts";
import * as marineInstitute from "../src/sources/marine-institute/index.ts";
import * as pegelonline from "../src/sources/pegelonline/index.ts";
import * as refmar from "../src/sources/refmar/index.ts";
import * as rws from "../src/sources/rws/index.ts";
import * as sfwmd from "../src/sources/sfwmd/index.ts";
import * as smhi from "../src/sources/smhi/index.ts";
import * as uhslc from "../src/sources/uhslc/index.ts";
import * as usace from "../src/sources/usace/index.ts";
import * as usgs from "../src/sources/usgs/index.ts";

const DAY_MS = 86_400_000;
const end = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
// Three days, so a gauge's outage of a day or two still leaves values.
const start = new Date(end.getTime() - 3 * DAY_MS);

/** A few long-running gauges, each asked for a few days through its adapter. */
const probes: Record<string, () => Promise<unknown[]>> = {
  // Cuxhaven's predicted highs and lows: the year's smaller file.
  bsh: () => bsh.extremes("506P", end.getUTCFullYear()),
  // San Francisco; live, so no metadata request for its dates.
  coops: () => coops.levels("9414290", start, end, { live: true }),
  // Newlyn, from the readings API.
  ea: () => ea.levels("E72239-level-tidal_level-Mean-15_min-mAOD", start, end),
  // Hornbæk, on DVR90 since 1997. DMI isn't in the source list until its station endpoint works.
  dmi: () => dmi.levels("30017", start, end),
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
  // Ballycotton, since 2010.
  "marine-institute": () => marineInstitute.levels("Ballycotton Harbour", start, end),
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
  usace: () => usace.levels("MVN", "Baton_Rouge.Stage.Inst.1Hour.0.rev", start, end),
  // Mississippi River at Baton Rouge, gage height.
  usgs: () => usgs.levels("9361fa9f474443a4b2391c1f1a63ca4b", start, end),
};

/** Sources whose request paths name the month, so a recording would fail the next one. */
const UNRECORDED = new Set(["jma"]);

const args = process.argv.slice(2);
const record = args.includes("--record");
const named = args.filter((a) => !a.startsWith("--"));
for (const id of named) if (!probes[id]) throw new Error(`No canary for ${id}`);

let failed = false;
for (const id of named.length ? named : Object.keys(probes)) {
  if (id === "usgs" && !process.env.USGS_API_KEY) {
    console.log(`${id}: skipped, no USGS_API_KEY`);
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
        console.log(`${id}: not recorded; its paths name the month`);
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
