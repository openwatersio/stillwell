/**
 * Pair check: compares two records of one gauge from different originators,
 * which a TICON record fitted to the same series can't, over one year of the
 * store's levels (`good` and `preliminary` only, from the latest datum epoch that
 * holds part of the year, within that epoch's span). It reads the second series at each of the first's times
 * shifted by lags of up to 3 hours in 10-minute steps, interpolating between
 * readings 20 minutes apart or less, and prints for the best lag the RMS of the
 * difference once its mean is removed, next to the RMS at zero lag. A series
 * with readings further apart than that, such as hourly values, is tested only
 * at lags that land on one of them. Where both stations name a datum, or one
 * names the other's, it also prints how far the mean difference is from the
 * offset between them.
 *
 *   node scripts/pair-check.ts <year> <source/id>=<source/id>...
 *   node scripts/pair-check.ts 2025 coops/8725520=sfwmd/VALI75
 *
 * A positive lag means the first series' stamps run late against the second's,
 * as in `clock-check`. A lag counts only where its RMS is under three quarters
 * of the zero-lag RMS and at least 0.5 cm less, and the command then exits
 * nonzero. A pair whose RMS is under 2 mm at zero lag is marked `same values`:
 * one record's values held twice say nothing about either clock (the mean is removed first, so a pair a constant apart is marked too, and its mean column says by how much). Records of two
 * nearby gauges can fit best at a lag from the tide's travel time, and river
 * gauges at one that's nothing to do with a clock, so judge a lag with the
 * gauges' positions. The store is `STILLWELL_STORE`, the public bucket by default.
 */
import { readStationList, readObservationsBetween } from "../src/store/parquet.ts";
import { seriesPath, stationListPath } from "../src/store/paths.ts";
import { Flag, type StoredStation } from "../src/schema.ts";
import {
  clockOff,
  fit,
  latestEpoch,
  MIN_SHARED,
  SAME_RMS_M,
  sharedDatum,
  type Reading,
} from "../src/pair-check.ts";

const STORE = (process.env.STILLWELL_STORE ?? "https://stillwell.openwaters.io").replace(/\/$/, "");

const [period, ...pairs] = process.argv.slice(2);
if (!period || !/^\d{4}$/.test(period) || !pairs.length)
  throw new Error("Usage: node scripts/pair-check.ts <year> <source/id>=<source/id>...");
const year = Number(period);
const [FROM, TO] = [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)];

const lists = new Map<string, StoredStation[]>();
async function station(id: string): Promise<StoredStation> {
  const source = id.split("/")[0]!;
  if (!lists.has(source))
    lists.set(source, (await readStationList(stationListPath(STORE, source))) ?? []);
  const found = lists.get(source)!.find((s) => s.id === id);
  if (!found) throw new Error(`${source} lists no ${id}`);
  return found;
}

/** `read`, again twice where the store answers with a server error, which it does under load. */
async function retried<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt === 3 || !/HTTP 5\d\d/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/** The station's good and preliminary levels in the year, from the latest epoch that holds part of it, within its span. */
async function readings(s: StoredStation): Promise<Reading[]> {
  const latest = latestEpoch(s, FROM, TO);
  if (!latest) return [];
  const e = latest.epoch;
  const lo = Math.max(FROM, e.since ? Date.parse(e.since) : FROM);
  const hi = Math.min(TO, e.until ? Date.parse(e.until) : TO);
  const path = seriesPath(STORE, "levels", s.source, s.source_id, year, e.id);
  const rows = await readObservationsBetween(path, lo, hi);
  return rows
    .filter(
      (o) => (o.flag === Flag.good || o.flag === Flag.preliminary) && Number.isFinite(o.level),
    )
    .map((o) => ({ time: o.time, level: o.level }))
    .sort((a, b) => a.time - b.time);
}

console.log(
  "| First | Second | Shared | Lags | Lag (min) | RMS at best (cm) | RMS at 0 (cm) | Mean (cm) | Datum | Note |",
);
console.log("| --- | --- | --: | --: | --: | --: | --: | --: | --- | --- |");
let flagged = false;
for (const pair of pairs) {
  const parts = pair.split("=");
  const [x, y] = parts;
  if (parts.length !== 2 || !x || !y) throw new Error(`Not <source/id>=<source/id>: ${pair}`);
  let [sx, sy]: StoredStation[] = [];
  let result: ReturnType<typeof fit>;
  try {
    [sx, sy] = [await retried(() => station(x)), await retried(() => station(y))];
    result = fit(await retried(() => readings(sx!)), await retried(() => readings(sy!)));
  } catch (error) {
    // A pair whose files couldn't be read hasn't passed, and the others still run.
    flagged = true;
    console.log(
      `| ${x} | ${y} | | | | | | | | not read: ${(error as Error).message.slice(0, 80)} |`,
    );
    continue;
  }
  const { best, zero, tried } = result;
  if (!best || !zero) {
    // A pair that couldn't be checked hasn't passed.
    flagged = true;
    console.log(`| ${x} | ${y} | under ${MIN_SHARED} | ${tried} | | | | | | not checked |`);
    continue;
  }
  const cm = (m: number) => (m * 100).toFixed(1);
  const off = clockOff(best, zero);
  flagged ||= off;
  const [ex, ey] = [latestEpoch(sx!, FROM, TO)!, latestEpoch(sy!, FROM, TO)!];
  const shared = sharedDatum(
    { datum: ex.epoch.datum, datums: ex.epoch.datums ?? {} },
    { datum: ey.epoch.datum, datums: ey.epoch.datums ?? {} },
  );
  const datum = shared
    ? `${shared.name}: ${cm(best.mean - shared.expected)} cm from ${cm(shared.expected)} cm`
    : "";
  const notes = [
    zero.rms < SAME_RMS_M ? "same values" : "",
    ex.of > 1 ? `${x} epoch ${ex.epoch.id} of ${ex.of}` : "",
    ey.of > 1 ? `${y} epoch ${ey.epoch.id} of ${ey.of}` : "",
  ].filter(Boolean);
  console.log(
    `| ${x} | ${y} | ${best.n} | ${tried} | ${off ? `**${best.lag}**` : best.lag} | ${cm(best.rms)} | ${cm(zero.rms)} | ${cm(best.mean)} | ${datum} | ${notes.join("; ")} |`,
  );
}
if (flagged) process.exitCode = 1;
