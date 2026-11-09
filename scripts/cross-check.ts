/**
 * Cross-station and harmonic checks over a region of the lake, for errors that
 * QC of one station at a time misses: months holding another gauge's data,
 * clock drift and jumps, and level steps. Reads hourly values from the lake's
 * year files and prints a Markdown report of what it finds for a person to
 * judge. It changes nothing in the lake.
 *
 *   node scripts/cross-check.ts <minLat,minLon,maxLat,maxLon> <from> <to> [source,...]
 *   node scripts/cross-check.ts 53.2,6.5,55.3,9.2 2000 2026 pegelonline,gesla
 *
 * `to` is exclusive. Hourly values are cached in .cache/cross-check/, by lake.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  HOUR_MS,
  SAME_GAUGE,
  attribute,
  copies,
  dailyMeans,
  distanceKm,
  median,
  monthlyAgreement,
  runs,
  timing,
  type Hourly,
} from "../src/cross-check.ts";
import { STANDARD, fit, resolvable } from "../src/harmonic.ts";
import { isMissing } from "../src/lake/parquet.ts";
import { seriesPath, stationsPath } from "../src/lake/paths.ts";
import { Flag } from "../src/schema.ts";

const ROOT = resolve(import.meta.dirname, "..");
const LAKE = (process.env.WATER_LEVELS_LAKE ?? "https://water-levels.openwaters.io").replace(
  /\/$/,
  "",
);
// One directory per lake, so another lake never reads this one's values.
const CACHE = join(
  ROOT,
  ".cache/cross-check",
  createHash("sha256").update(LAKE).digest("hex").slice(0, 12),
);
/** Neighbors for level steps: the nearest this many within `NEIGHBOR_KM`. */
const NEIGHBORS = 4;
const NEIGHBOR_KM = 150;
/** Timing departures from a station's median, in minutes, worth reporting. */
const LATE_MIN = 8;
const SIGMAS = 4;
/** Scatter, in minutes, past which a station's tide is too small to time. */
const MAX_SCATTER = 20;
const WINDOW_DAYS = 15;
const CONNECTIONS = 8;
/** Bumped when what the cache holds changes, so older files aren't read. */
const CACHE_FORMAT = 2;

const [box, fromArg, toArg, sourceArg] = process.argv.slice(2);
const bounds = box?.split(",").map(Number);
const from = Number(fromArg);
const to = Number(toArg);
if (
  bounds?.length !== 4 ||
  !bounds.every(Number.isFinite) ||
  !(bounds[0]! <= bounds[2]! && bounds[1]! <= bounds[3]!) ||
  !Number.isInteger(from) ||
  !Number.isInteger(to) ||
  !(from < to)
)
  throw new Error(
    "Usage: node scripts/cross-check.ts <minLat,minLon,maxLat,maxLon> <from> <to> [source,...]",
  );
const [minLat, minLon, maxLat, maxLon] = bounds as [number, number, number, number];
const sources = sourceArg?.split(",");

interface Listed {
  id: string;
  source: string;
  source_id: string;
  name: string;
  lat: number;
  lon: number;
  first: number;
  last: number;
  same_as: string[];
  preferred: string;
  /** Epoch 1's span, ms, where the station has later epochs. */
  since: number | null;
  until: number | null;
  later: boolean;
}

const instance = await DuckDBInstance.create(":memory:");
// Loaded once: connections loading it at the same moment conflict in the catalog.
if (/^https?:\/\//.test(LAKE)) await (await instance.connect()).run("INSTALL httpfs; LOAD httpfs;");
const lanes: DuckDBConnection[] = [];
for (let i = 0; i < CONNECTIONS; i++) {
  const db = await instance.connect();
  await db.run("SET TimeZone = 'UTC'");
  lanes.push(db);
}
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

const listed = (
  await (
    await lanes[0]!.runAndReadAll(
      `SELECT id, source, source_id, name, lat, lon, epoch_ms(first) AS first, epoch_ms(last) AS last, coalesce(same_as, []) AS same_as, preferred,
         epoch_ms(list_filter(epochs, lambda e: e.id = 1)[1].since) AS since, epoch_ms(list_filter(epochs, lambda e: e.id = 1)[1].until) AS until,
         coalesce(len(list_filter(epochs, lambda e: e.id > 1)) > 0, false) AS later
       FROM read_parquet(${quote(stationsPath(LAKE))})
       WHERE list_contains(products, 'levels') AND coalesce(kind, '') NOT IN ('river', 'lake')
         AND lat BETWEEN ${minLat} AND ${maxLat} AND lon BETWEEN ${minLon} AND ${maxLon}
         AND first < make_timestamptz(${to}, 1, 1, 0, 0, 0) AND last >= make_timestamptz(${from}, 1, 1, 0, 0, 0)
         ${sources ? `AND source IN (${sources.map(quote).join(", ")})` : ""}
       ORDER BY id`,
    )
  ).getRowObjectsJS()
).map(
  (r) =>
    ({
      ...r,
      first: Number(r.first),
      last: Number(r.last),
      since: r.since === null ? null : Number(r.since),
      until: r.until === null ? null : Number(r.until),
    }) as unknown as Listed,
);
console.error(`${listed.length} stations`);

// Gauges: stations linked by same_as, which hold the same gauge's values.
const gauge = new Map<string, string>(listed.map((s) => [s.id, s.id]));
const root = (id: string): string => (gauge.get(id) === id ? id : root(gauge.get(id)!));
for (const s of listed)
  for (const other of s.same_as) if (gauge.has(other)) gauge.set(root(other), root(s.id));
const sameGauge = (a: string, b: string) => root(a) === root(b);

await mkdir(CACHE, { recursive: true });
const series = new Map<string, Hourly>();
/** Stations with values, but too few near the hour, such as hourly means stamped at the half hour. */
const offHour: string[] = [];
let next = 0;
await Promise.all(
  lanes.map(async (db) => {
    while (next < listed.length) {
      const station = listed[next++]!;
      const { hourly, values } = await load(db, station);
      if (hourly) series.set(station.id, hourly);
      else if (values >= 24 * 60) offHour.push(station.id);
    }
  }),
);
const stations = listed.filter((s) => series.has(s.id));
console.error(`${stations.length} with values`);
// One station per gauge: the lake's preferred one, or else the longest here.
const primary = new Map<string, Listed>();
for (const s of stations) {
  const held = primary.get(root(s.id));
  const longer = !held || series.get(s.id)!.levels.length > series.get(held.id)!.levels.length;
  if (!held || s.preferred === s.id || (held.preferred !== held.id && longer))
    primary.set(root(s.id), s);
}
const gauges = [...primary.values()];

/**
 * Hourly values: at each hour, the value within 10 minutes of it nearest the
 * hour, flagged good or preliminary; and how many values were read at all.
 */
async function load(
  db: DuckDBConnection,
  s: Listed,
): Promise<{ hourly: Hourly | null; values: number }> {
  // Keyed on what the values depend on, so a new epoch span, newer values or a new format read the lake again.
  const key = [CACHE_FORMAT, from, to, s.since, s.until, s.first, s.last].join("_");
  const file = join(CACHE, `${encodeURIComponent(s.id)}_${key}.bin`);
  const save = async (values: Float64Array) => {
    // Through a temporary file, so an interrupted run leaves no short series behind.
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, values);
    await rename(temporary, file);
  };
  const cached = await readFile(file).catch(() => null);
  if (cached) {
    const all = new Float64Array(new Uint8Array(cached).buffer);
    // A first value of 0 marks a station with too few hours, and how many values it had.
    return all[0] === 0
      ? { hourly: null, values: all[1] ?? 0 }
      : { hourly: { start: all[0]!, levels: all.slice(1) }, values: all.length - 1 };
  }
  const hours = new Map<number, { v: number; d: number }>();
  let values = 0;
  const [lowest, highest] = [Date.UTC(from, 0, 1) / HOUR_MS, Date.UTC(to, 0, 1) / HOUR_MS];
  const first = Math.max(from, new Date(s.first).getUTCFullYear());
  const last = Math.min(to - 1, new Date(s.last).getUTCFullYear());
  for (let year = first; year <= last; year++) {
    const path = seriesPath(LAKE, "levels", s.source, s.source_id, year);
    try {
      const rows = (
        await db.runAndReadAll(
          // read_parquet globs, so only this exact file counts, as in readObservationFile.
          `SELECT epoch_ms(h) AS h, arg_min(level_m, (d, time)) FILTER (WHERE d <= 600) AS v,
             min(d) AS d, count(*) AS n FROM (
             SELECT time_bucket(INTERVAL 1 HOUR, time + INTERVAL 30 MINUTE) AS h, time, level_m,
               abs(epoch(time) - epoch(time_bucket(INTERVAL 1 HOUR, time + INTERVAL 30 MINUTE))) AS d
             FROM read_parquet(${quote(path)}, filename = true)
             WHERE filename = ${quote(path)} AND flag IN (${Flag.good}, ${Flag.preliminary}) AND level_m IS NOT NULL
               ${s.since === null ? "" : `AND time >= epoch_ms(${s.since})`}
               ${s.until === null ? "" : `AND time < epoch_ms(${s.until})`})
           GROUP BY h`,
        )
      ).getRows();
      for (const [h, v, d, n] of rows) {
        values += Number(n);
        if (v === null) continue;
        const hour = Number(h) / HOUR_MS;
        // New Year's hour can draw on two files; the reading nearer it wins.
        if (hour < lowest || hour >= highest || (hours.get(hour)?.d ?? Infinity) <= Number(d))
          continue;
        hours.set(hour, { v: Number(v), d: Number(d) });
      }
    } catch (error) {
      // A year with no file is a gap in the record, not an error.
      if (!isMissing(error)) throw error;
    }
  }
  console.error(`${s.id}: ${hours.size} hours`);
  if (hours.size < 24 * 60) {
    await save(new Float64Array([0, values]));
    return { hourly: null, values };
  }
  const keys = [...hours.keys()].sort((a, b) => a - b);
  const start = keys[0]!;
  const levels = new Float64Array(keys.at(-1)! - start + 1).fill(NaN);
  for (const [h, { v }] of hours) levels[h - start] = v;
  const out = new Float64Array(levels.length + 1);
  out[0] = start;
  out.set(levels, 1);
  await save(out);
  return { hourly: { start, levels }, values };
}

const day = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const name = (id: string) => `${id} (${stations.find((s) => s.id === id)!.name})`;
const cm = (m: number) => (m * 100).toFixed(1);

console.log(`# Cross-station checks, ${from} to ${to - 1}`);
console.log(`\n${stations.length} stations in ${box}${sources ? `, ${sources.join(", ")}` : ""}.`);
console.log(`\nRead from ${LAKE}.`);
const few = listed.filter((s) => !series.has(s.id) && !offHour.includes(s.id)).map((s) => s.id);
if (few.length) console.log(`\nUnder 60 days of hourly values, so left out: ${few.join(", ")}.`);
if (offHour.length)
  console.log(
    `\nValues, but too few within 10 minutes of the hour, such as hourly means stamped at the half hour, so left out: ${offHour.join(", ")}.`,
  );
const later = listed.filter((s) => s.later).map((s) => s.id);
if (later.length)
  console.log(
    `\nRead in their first datum epoch only, from its own span; their later values aren't checked: ${later.join(", ")}.`,
  );

// Copies: every pair of gauges, month by month.
console.log("\n## Months holding another gauge's data\n");
console.log("| Station | Other | km | Month | Hours | r | RMS cm | Usual RMS cm |");
console.log("| --- | --- | --: | --- | --: | --: | --: | --: |");
let pairMonths = 0;
const twins: string[] = [];
for (const [i, a] of gauges.entries())
  for (const b of gauges.slice(i + 1)) {
    const months = monthlyAgreement(series.get(a.id)!, series.get(b.id)!);
    pairMonths += months.length;
    const km = distanceKm(a, b);
    if (months.length >= 6 && median(months.map((m) => m.rms)) < SAME_GAUGE)
      twins.push(
        `${name(a.id)} and ${name(b.id)}, ${km.toFixed(1)} km, usual RMS ${cm(median(months.map((m) => m.rms)))} cm`,
      );
    for (const c of copies(months))
      console.log(
        `| ${name(a.id)} | ${name(b.id)} | ${km.toFixed(0)} | ${c.month} | ${c.hours} | ${c.r.toFixed(4)} | ${cm(c.rms)} | ${cm(c.usual)} |`,
      );
  }
console.log(`\n${pairMonths} pair-months compared.`);
if (twins.length) {
  console.log("\nPairs that usually agree within a centimeter but aren't linked by `same_as`:\n");
  for (const t of twins) console.log(`- ${t}`);
}

// Copies of one gauge in several sources should agree hour for hour.
console.log("\n## Copies of one gauge that disagree\n");
console.log("| Station | Copy | Month | Hours | RMS cm |");
console.log("| --- | --- | --- | --: | --: |");
for (const [i, a] of stations.entries())
  for (const b of stations.slice(i + 1)) {
    if (!sameGauge(a.id, b.id)) continue;
    for (const m of monthlyAgreement(series.get(a.id)!, series.get(b.id)!))
      if (m.rms >= 0.03)
        console.log(`| ${name(a.id)} | ${name(b.id)} | ${m.month} | ${m.hours} | ${cm(m.rms)} |`);
  }

// Timing against each station's own harmonic fit.
console.log("\n## Tide timing\n");
console.log(
  `Runs of ${WINDOW_DAYS}-day windows whose stamps run late (positive) or early against the station's median, by ${LATE_MIN} minutes or ${SIGMAS} times the station's scatter, whichever is more. A clock error moves both bands alike; the diurnal column is blank where the diurnal tide is too small to time.\n`,
);
console.log("| Station | From | To | Windows | Scatter min | Semidiurnal min | Diurnal min |");
console.log("| --- | --- | --- | --: | --: | --: | --: |");
let windows = 0;
const scatters: number[] = [];
/** Stations with under 6 windows to time, or too little tide. */
const untimed: string[] = [];
for (const s of stations) {
  const hourly = series.get(s.id)!;
  const samples = [];
  for (let i = 0; i < hourly.levels.length; i++)
    if (!Number.isNaN(hourly.levels[i]!))
      samples.push({ time: (hourly.start + i) * HOUR_MS, level: hourly.levels[i]! });
  const span = (samples.at(-1)!.time - samples[0]!.time) / HOUR_MS;
  // Long-period terms would soak up level steps, which the neighbor check is
  // for; the leading 40 others time the tide well, and the fit's cost grows
  // with the square of their number.
  const names = resolvable(STANDARD, span)
    .filter((n) => !/^(Sa|Ssa|Mm|MSf|Mf|MSm)$/i.test(n))
    .slice(0, 40);
  const found = timing(hourly, fit(samples, names), { windowDays: WINDOW_DAYS });
  if (found.length < 6) {
    untimed.push(s.id);
    continue;
  }
  const semi = found.map((w) => w.semidiurnal);
  const center = median(semi);
  const scatter = 1.4826 * median(semi.map((v) => Math.abs(v - center)));
  if (!(scatter <= MAX_SCATTER)) {
    untimed.push(s.id);
    continue;
  }
  windows += found.length;
  scatters.push(scatter);
  const timedDiurnal = found.filter((w) => w.diurnal !== null).map((w) => w.diurnal!);
  const diurnalCenter = timedDiurnal.length ? median(timedDiurnal) : 0;
  const values = found.map((w) => ({ time: w.time, value: w.semidiurnal }));
  for (const run of runs(
    values,
    Math.max(LATE_MIN, SIGMAS * scatter),
    WINDOW_DAYS * 2 * 86_400_000,
  )) {
    const inside = found.filter((w) => w.time >= run.from && w.time <= run.to);
    const diurnal = inside.filter((w) => w.diurnal !== null).map((w) => w.diurnal! - diurnalCenter);
    console.log(
      `| ${name(s.id)} | ${date(run.from)} | ${date(run.to + WINDOW_DAYS * 86_400_000)} | ${run.count} | ${scatter.toFixed(1)} | ${(median(inside.map((w) => w.semidiurnal)) - center).toFixed(0)} | ${diurnal.length ? median(diurnal).toFixed(0) : ""} |`,
    );
  }
}
console.log(
  `\n${windows} windows timed at ${scatters.length} stations; median scatter ${scatters.length ? median(scatters).toFixed(1) : "n/a"} minutes.`,
);
if (untimed.length)
  console.log(
    `\nUnder 6 windows, or scatter over ${MAX_SCATTER} minutes, so not timed: ${untimed.join(", ")}.`,
  );

// Level steps against neighbors.
console.log("\n## Level steps\n");
console.log(
  `Steps of 8 cm or more, and three times the difference's spread either side, in a station's daily mean against its ${NEIGHBORS} nearest gauges within ${NEIGHBOR_KM} km.\n`,
);
console.log("| Station | Day | Step cm | Seen against | Not seen against |");
console.log("| --- | --- | --: | --- | --- |");
const daily = new Map(stations.map((s) => [s.id, dailyMeans(series.get(s.id)!)]));
let stationDays = 0;
const lonely: string[] = [];
for (const s of stations) {
  const near = gauges
    .filter((o) => !sameGauge(o.id, s.id) && distanceKm(s, o) <= NEIGHBOR_KM)
    .sort((a, b) => distanceKm(s, a) - distanceKm(s, b))
    .slice(0, NEIGHBORS);
  if (near.length < 2) {
    lonely.push(s.id);
    continue;
  }
  stationDays += daily.get(s.id)!.size;
  const found = attribute(daily.get(s.id)!, new Map(near.map((o) => [o.id, daily.get(o.id)!])));
  for (const step of found)
    console.log(
      `| ${name(s.id)} | ${day(step.day)} | ${cm(step.size)} | ${step.seen.join(", ")} | ${step.unseen.join(", ")} |`,
    );
}
console.log(`\n${stationDays} station-days checked.`);
if (lonely.length)
  console.log(
    `\nUnder 2 other gauges within ${NEIGHBOR_KM} km, so not checked for steps: ${lonely.join(", ")}.`,
  );
