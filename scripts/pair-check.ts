/**
 * Pair check: compares two records of one gauge from different originators,
 * which a TICON record fitted to the same series can't, over one year of the
 * store's levels (`good` and `preliminary` only, in each station's epochs of
 * that year). It matches readings at the same minute, shifted by lags of up to
 * 3 hours in 10-minute steps, and prints for the best lag the RMS of the
 * difference once its mean is removed, next to the RMS at zero lag. Where both
 * stations name a datum the other's `datums` hold, or share one, it also prints
 * how far the mean difference is from the offset between those datums.
 *
 *   node scripts/pair-check.ts <year> <source/id>=<source/id>...
 *   node scripts/pair-check.ts 2025 coops/8725520=sfwmd/VALI75
 *
 * A positive lag means the first series' stamps run late against the second's.
 * A lag counts only where its RMS is under three quarters of the zero-lag RMS
 * and at least 0.5 cm less; otherwise the clocks agree as far as the levels
 * show. A pair whose RMS is under 2 mm holds one record's values twice, so it
 * says nothing about either clock. Records of two nearby gauges can fit best at
 * a lag from the tide's travel time, and river gauges at one that's nothing to
 * do with a clock, so judge a lag with the gauges' positions. The store is
 * `STILLWELL_STORE`, the public bucket by default.
 */
import { readStationList, readObservationsBetween } from "../src/store/parquet.ts";
import { seriesPath, stationListPath } from "../src/store/paths.ts";
import { Flag, type StoredStation } from "../src/schema.ts";

const STORE = (process.env.STILLWELL_STORE ?? "https://stillwell.openwaters.io").replace(/\/$/, "");
const MINUTE_MS = 60_000;
/** Lags tried, every 10 minutes up to 3 hours either way. */
const LAGS = Array.from({ length: 37 }, (_, i) => (i - 18) * 10);
const MIN_SHARED = 200;

const [period, ...pairs] = process.argv.slice(2);
const year = Number(period);
if (!Number.isInteger(year) || !pairs.length)
  throw new Error("Usage: node scripts/pair-check.ts <year> <source/id>=<source/id>...");

const lists = new Map<string, StoredStation[]>();
async function station(id: string): Promise<StoredStation> {
  const source = id.split("/")[0]!;
  if (!lists.has(source))
    lists.set(source, (await readStationList(stationListPath(STORE, source))) ?? []);
  const found = lists.get(source)!.find((s) => s.id === id);
  if (!found) throw new Error(`${source} lists no ${id}`);
  return found;
}

interface Reading {
  time: number;
  level: number;
}

async function readings(s: StoredStation): Promise<Reading[]> {
  const [from, to] = [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)];
  const epochs = (s.epochs ?? []).filter(
    (e) => (!e.since || Date.parse(e.since) < to) && (!e.until || Date.parse(e.until) > from),
  );
  const rows: Reading[] = [];
  for (const e of epochs) {
    const path = seriesPath(STORE, "levels", s.source, s.source_id, year, e.id);
    for (const o of await readObservationsBetween(path, from, to))
      if (o.flag <= Flag.preliminary && Number.isFinite(o.level))
        rows.push({ time: o.time, level: o.level });
  }
  return rows;
}

/** The offset to add to a level in `s`'s datum to read it in `name`, or null when `s` has none. */
function offsetTo(s: StoredStation, name: string): number | null {
  const e = s.epochs?.at(-1);
  if ((e?.datum ?? s.datum) === name) return 0;
  return (e?.datums ?? s.datums)?.[name] ?? null;
}

function fit(a: Reading[], b: Reading[]) {
  const byMinute = new Map(b.map((r) => [Math.round(r.time / MINUTE_MS), r.level]));
  const at = LAGS.flatMap((lag) => {
    let [n, sum, squares] = [0, 0, 0];
    for (const r of a) {
      const v = byMinute.get(Math.round(r.time / MINUTE_MS) + lag);
      if (v === undefined) continue;
      n++;
      sum += r.level - v;
      squares += (r.level - v) ** 2;
    }
    if (n < MIN_SHARED) return [];
    const mean = sum / n;
    return [{ lag, n, mean, rms: Math.sqrt(Math.max(0, squares / n - mean * mean)) }];
  });
  const best = at.reduce<(typeof at)[number] | null>((x, y) => (!x || y.rms < x.rms ? y : x), null);
  return { best, zero: at.find((x) => x.lag === 0) };
}

console.log(
  "| First | Second | Shared | Lag (min) | RMS at best (cm) | RMS at 0 (cm) | Mean (cm) | Datum |",
);
console.log("| --- | --- | --: | --: | --: | --: | --: | --- |");
let flagged = false;
for (const pair of pairs) {
  const [x, y] = pair.split("=");
  if (!x || !y) throw new Error(`Not <source/id>=<source/id>: ${pair}`);
  const [sx, sy] = [await station(x), await station(y)];
  const { best, zero } = fit(await readings(sx), await readings(sy));
  if (!best || !zero) {
    flagged = true;
    console.log(`| ${x} | ${y} | under ${MIN_SHARED} | | | | | |`);
    continue;
  }
  const cm = (m: number) => (m * 100).toFixed(1);
  const off = best.lag !== 0 && best.rms <= 0.75 * zero.rms && zero.rms - best.rms >= 0.005;
  flagged ||= off;
  // The datums either side name: a common one gives the mean difference to expect.
  let datum = "";
  for (const name of ["NAVD88", "NGVD29", "MSL", "MLLW"]) {
    const [ox, oy] = [offsetTo(sx, name), offsetTo(sy, name)];
    if (ox === null || oy === null) continue;
    datum = `${name}: ${cm(best.mean - (oy - ox))} cm from ${cm(oy - ox)} cm`;
    break;
  }
  console.log(
    `| ${x} | ${y} | ${best.n} | ${off ? `**${best.lag}**` : best.lag} | ${cm(best.rms)} | ${cm(zero.rms)} | ${cm(best.mean)} | ${datum} |`,
  );
}
if (flagged) process.exitCode = 1;
