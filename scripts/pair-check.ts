/**
 * Pair check: compares two records of one gauge from different originators,
 * which a TICON record fitted to the same series can't, over one year of the
 * store's levels (`good` and `preliminary` only, from the one datum epoch that
 * holds the year). It reads the second series at each of the first's times
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
 * one record's values held twice say nothing about either clock. Records of two
 * nearby gauges can fit best at a lag from the tide's travel time, and river
 * gauges at one that's nothing to do with a clock, so judge a lag with the
 * gauges' positions. The store is `STILLWELL_STORE`, the public bucket by default.
 */
import { readStationList, readObservationsBetween } from "../src/store/parquet.ts";
import { seriesPath, stationListPath } from "../src/store/paths.ts";
import { Flag, type StoredStation } from "../src/schema.ts";

const STORE = (process.env.STILLWELL_STORE ?? "https://stillwell.openwaters.io").replace(/\/$/, "");
const MINUTE_MS = 60_000;
/** Lags tried, in minutes, every 10 up to 3 hours either way. */
const LAGS = Array.from({ length: 37 }, (_, i) => (i - 18) * 10);
/** Shared readings a lag needs to count. */
const MIN_SHARED = 200;
/** The furthest apart two readings can be and still give an interpolated one between them. */
const MAX_GAP_MS = 20 * MINUTE_MS;
/** The RMS under which two records hold the same values. */
const SAME_RMS_M = 0.002;

const [period, ...pairs] = process.argv.slice(2);
if (!period || !/^\d{4}$/.test(period) || !pairs.length)
  throw new Error("Usage: node scripts/pair-check.ts <year> <source/id>=<source/id>...");
const year = Number(period);

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

interface Reading {
  time: number;
  level: number;
}

/** The epochs of `s` that hold part of the year, as the store keeps them: open or closed, not held or rejected. */
function epochsOf(s: StoredStation, from: number, to: number) {
  return (s.epochs ?? []).filter(
    (e) =>
      (e.state === "open" || e.state === "closed") &&
      (!e.since || Date.parse(e.since) < to) &&
      (!e.until || Date.parse(e.until) > from),
  );
}

async function readings(s: StoredStation): Promise<Reading[]> {
  const [from, to] = [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)];
  const rows: Reading[] = [];
  for (const e of epochsOf(s, from, to)) {
    const lo = Math.max(from, e.since ? Date.parse(e.since) : from);
    const hi = Math.min(to, e.until ? Date.parse(e.until) : to);
    const path = seriesPath(STORE, "levels", s.source, s.source_id, year, e.id);
    for (const o of await readObservationsBetween(path, lo, hi))
      if ((o.flag === Flag.good || o.flag === Flag.preliminary) && Number.isFinite(o.level))
        rows.push({ time: o.time, level: o.level });
  }
  return rows.sort((a, b) => a.time - b.time);
}

/** The datum offsets of the one epoch that holds the year, or null where several do. */
function yearDatums(s: StoredStation): { datum: string; datums: Record<string, number> } | null {
  const epochs = epochsOf(s, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1));
  const e = epochs.length === 1 ? epochs[0]! : null;
  return e ? { datum: e.datum, datums: e.datums ?? {} } : null;
}

/** `b`'s level at `time`: a reading there, or one between readings 20 minutes apart or less. */
function levelAt(b: Reading[], time: number): number | undefined {
  let [lo, hi] = [0, b.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  const next = b[lo];
  if (next && next.time === time) return next.level;
  const prev = b[lo - 1];
  if (!prev || !next || next.time - prev.time > MAX_GAP_MS) return undefined;
  return prev.level + ((next.level - prev.level) * (time - prev.time)) / (next.time - prev.time);
}

function fit(a: Reading[], b: Reading[]) {
  const at = LAGS.flatMap((lag) => {
    let [n, sum, squares] = [0, 0, 0];
    // The second series at the first's time plus the lag: a positive lag is a late first clock.
    for (const r of a) {
      const v = levelAt(b, r.time - lag * MINUTE_MS);
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
  return { best, zero: at.find((x) => x.lag === 0), tried: at.length };
}

/** Datums that are each station's own zero, so two stations naming one share no reference. */
const LOCAL_ZEROS = new Set(["ZERO", "GAGE", "GZ", "STND", "PNP", "CD", "DL", "ZH"]);

/** The first datum both stations know, and the offset to add to a level of `x` to read it in `y`'s. */
function sharedDatum(
  x: NonNullable<ReturnType<typeof yearDatums>>,
  y: NonNullable<ReturnType<typeof yearDatums>>,
): { name: string; offset: number } | null {
  const offsetTo = (d: typeof x, name: string) => (d.datum === name ? 0 : (d.datums[name] ?? null));
  const names = new Set(
    [x.datum, y.datum, ...Object.keys(x.datums), ...Object.keys(y.datums)].filter(
      (name) => !LOCAL_ZEROS.has(name),
    ),
  );
  for (const name of names) {
    const [ox, oy] = [offsetTo(x, name), offsetTo(y, name)];
    if (ox !== null && oy !== null) return { name, offset: oy - ox };
  }
  return null;
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
  const off = best.lag !== 0 && best.rms <= 0.75 * zero.rms && zero.rms - best.rms >= 0.005;
  flagged ||= off;
  const [dx, dy] = [yearDatums(sx!), yearDatums(sy!)];
  const shared = dx && dy ? sharedDatum(dx, dy) : null;
  const datum = shared
    ? `${shared.name}: ${cm(best.mean - shared.offset)} cm from ${cm(shared.offset)} cm`
    : "";
  const note = zero.rms < SAME_RMS_M ? "same values" : "";
  console.log(
    `| ${x} | ${y} | ${best.n} | ${tried} | ${off ? `**${best.lag}**` : best.lag} | ${cm(best.rms)} | ${cm(zero.rms)} | ${cm(best.mean)} | ${datum} | ${note} |`,
  );
}
if (flagged) process.exitCode = 1;
