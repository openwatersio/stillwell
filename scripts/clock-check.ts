/**
 * Clock check: cross-correlates a year of a station's observed levels, fetched
 * through its adapter, against the prediction from a TICON record's constants
 * in a tide-database checkout (TIDE_DATABASE, default ../slackwater-database),
 * and reports the lag that fits best. A lag near a whole hour is a clock
 * error, such as local time labeled UTC, to fix before anything fits to the
 * series. The semidiurnal tide repeats every 12.42 hours, so a 12-hour error
 * hides in that lag; the K1 lag, from K1's phase in a fit of the year, shows it.
 *
 *   node scripts/clock-check.ts <year> <source/id>=<ticon record>...
 *   node scripts/clock-check.ts 2020 uhslc/329=hong_kong-329-hkg-uhslc_fd
 *
 * A positive lag means the observations run late against the prediction: the
 * level stamped T was measured at T − lag.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { useDiskCache } from "../src/cache.ts";
import { readStationList } from "../src/lake/parquet.ts";
import { stationListPath } from "../src/lake/paths.ts";
import { phaseLag, timeline } from "../src/harmonic.ts";
import { Flag, type Station } from "../src/schema.ts";
import { sourceOf } from "../src/sources/index.ts";

const ROOT = resolve(import.meta.dirname, "..");
const TIDE_DATABASE = resolve(ROOT, process.env.TIDE_DATABASE ?? "../slackwater-database");
const LAKE = (process.env.WATER_LEVELS_LAKE ?? "https://water-levels.openwaters.io").replace(
  /\/$/,
  "",
);
const MINUTE_MS = 60_000;
/** Lags tried, every 10 minutes up to 3 hours either way. */
const LAGS = Array.from({ length: 37 }, (_, i) => (i - 18) * 10);

const [year, ...pairs] = process.argv.slice(2);
if (!year || !pairs.length)
  throw new Error("Usage: node scripts/clock-check.ts <year> <source/id>=<ticon record>...");
useDiskCache();

const start = new Date(Date.UTC(Number(year), 0, 1));
const end = new Date(Date.UTC(Number(year) + 1, 0, 1));
console.log("| Station | TICON record | Values | r at 0 | Best lag | r at best | K1 lag |");
console.log("| --- | --- | --: | --: | --: | --: | --: |");
let flagged = false;
const lists = new Map<string, { id: string }[]>();
for (const pair of pairs) {
  const [station, record] = pair.split("=");
  const [sourceId, id] = station?.split(/\/(.*)/) ?? [];
  if (!sourceId || !id || !record) throw new Error(`Not <source/id>=<ticon record>: ${pair}`);
  const source = sourceOf(sourceId);
  // The lake's list (WATER_LEVELS_LAKE, default the public bucket) carries each
  // station's own fields; a source with no list there is listed by its adapter.
  if (!lists.has(sourceId))
    lists.set(
      sourceId,
      (await readStationList(stationListPath(LAKE, sourceId))) ?? (await source.stations()),
    );
  const listed = lists.get(sourceId)!.find((s) => s.id === station);
  if (!listed) throw new Error(`${sourceId} lists no ${station}`);
  const observed = (await source.observations!(listed as Station, start, end)).filter(
    (o) => o.flag <= Flag.preliminary,
  );
  const days = new Set(observed.map((o) => Math.floor(o.time / 86_400_000))).size;
  if (days < 30) {
    // A series that couldn't be checked hasn't passed.
    flagged = true;
    console.log(`| ${station} | ${record} | ${observed.length} | | too few values | | |`);
    continue;
  }
  const ticon = JSON.parse(
    await readFile(join(TIDE_DATABASE, "data/ticon", `${record}.json`), "utf8"),
  ) as { harmonic_constituents: { name: string; amplitude: number; phase: number }[] };
  const model = { constituents: ticon.harmonic_constituents, offset: 0, rms: 0 };
  const r = (lag: number) =>
    correlation(
      observed.map((o) => o.level),
      timeline(
        model,
        observed.map((o) => o.time - lag * MINUTE_MS),
      ).map((p) => p.level),
    );
  const scores = LAGS.map((lag) => ({ lag, r: r(lag) }));
  const best = scores.reduce((a, b) => (b.r > a.r ? b : a));
  const atZero = scores.find((s) => s.lag === 0)!;
  const late = Math.abs(best.lag) >= 30;
  // K1's phase is less certain where the diurnal tide is small, so it flags
  // only what the cross-correlation can't see: several hours.
  const k1 = phaseLag(observed, ticon.harmonic_constituents);
  const off = k1 !== null && Math.abs(k1) >= 3;
  flagged ||= late || off;
  const bold = (flag: boolean, text: string) => (flag ? `**${text}**` : text);
  console.log(
    `| ${station} | ${record} | ${observed.length} | ${atZero.r.toFixed(3)} | ${bold(late, `${best.lag} min`)} | ${best.r.toFixed(3)} | ${k1 === null ? "no K1" : bold(off, `${(k1 * 60).toFixed(0)} min`)} |`,
  );
}
if (flagged) process.exitCode = 1;

function correlation(a: number[], b: number[]): number {
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}
