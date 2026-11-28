// Fits IGN's Coruña hourly levels, IEO's gauge and REDMAR's gauge to each other, to the minute, by week and by month.
// node docs/results/ign-coruna-windows-2026-11-28/lags.mjs <store holding ign/ACOR1> <output.json>
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [ignStore, output] = process.argv.slice(2);
if (!ignStore || !output) throw new Error("Usage: node lags.mjs <ign store> <output.json>");
const src = fileURLToPath(new URL("../../../src/", import.meta.url));
const { readObservations } = await import(src + "store/parquet.ts");
const { seriesPath } = await import(src + "store/paths.ts");
const PUBLIC = "https://stillwell.openwaters.io";
const HOUR = 3_600_000;

async function load(root, source, id) {
  const levels = new Map();
  for (let year = 2000; year <= 2023; year++)
    for (const o of await readObservations(seriesPath(root, "levels", source, id, year)))
      // IGN keeps every flag, since its flags are the question; the references drop bad values.
      if (o.time % HOUR === 0 && (source === "ign" || o.flag < 4))
        levels.set(o.time / HOUR, o.level);
  return levels;
}

const series = {
  ign: await load(ignStore, "ign", "ACOR1"),
  ieo: await load(PUBLIC, "uhslc", "830"),
  redmar: await load(PUBLIC, "cmems", "CorunaTG"),
};

/** `b` between its hours, by Catmull-Rom: linear interpolation smooths, which favors a fractional lag. */
function at(b, hour) {
  const i = Math.floor(hour);
  const f = hour - i;
  if (f === 0) return b.get(i);
  const [p, q, r, s] = [b.get(i - 1), b.get(i), b.get(i + 1), b.get(i + 2)];
  if ([p, q, r, s].includes(undefined)) return undefined;
  return q + 0.5 * f * (r - p + f * (2 * p - 5 * q + 4 * r - s + f * (3 * (q - r) + s - p)));
}

/** The lag (minutes, positive where `a` is late) with the least spread of `a` minus `b`, within 90. */
function fit(a, b, from, to, atLeast) {
  const hours = [];
  for (let h = from; h < to; h++) if (a.has(h)) hours.push(h);
  const scores = [];
  for (let lag = -90; lag <= 90; lag++) {
    let [n, sum, squares] = [0, 0, 0];
    for (const h of hours) {
      const v = at(b, h - lag / 60);
      if (v === undefined) continue;
      const d = a.get(h) - v;
      n++;
      sum += d;
      squares += d * d;
    }
    scores.push({ lag, n, spread: n ? Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)) : Infinity });
  }
  const zero = scores[90];
  if (zero.n < atLeast) return null;
  const best = scores.reduce((p, q) => (q.spread < p.spread && q.n >= zero.n * 0.9 ? q : p), zero);
  return { lag: best.lag, n: zero.n, spreadAtZero: zero.spread, spread: best.spread };
}

const pairs = [["ign", "ieo"], ["ign", "redmar"], ["ieo", "redmar"]];
const row = (from, to, atLeast) =>
  Object.fromEntries(
    pairs.map(([a, b]) => [`${a}~${b}`, fit(series[a], series[b], from, to, atLeast)]),
  );
const weeks = [];
for (let h = Date.UTC(2000, 0, 1) / HOUR; h < Date.UTC(2024, 0, 1) / HOUR; h += 168)
  weeks.push({ from: new Date(h * HOUR).toISOString().slice(0, 10), ...row(h, h + 168, 120) });
const months = [];
for (let year = 2000; year <= 2023; year++)
  for (let m = 0; m < 12; m++)
    months.push({
      month: `${year}-${String(m + 1).padStart(2, "0")}`,
      ...row(Date.UTC(year, m, 1) / HOUR, Date.UTC(year, m + 1, 1) / HOUR, 400),
    });
// The rule for the flagged spans: a week counts where every reference with data puts IGN at least
// 8 minutes off in one direction; counting weeks at most 1 week apart form a span; a span needs 4 of them.
const counts = (week) => {
  const offsets = [week["ign~ieo"], week["ign~redmar"]].filter(Boolean).map((x) => x.lag);
  return offsets.length > 0 && (offsets.every((x) => x >= 8) || offsets.every((x) => x <= -8));
};
const runs = [];
weeks.forEach((week, i) => {
  if (!counts(week)) return;
  const run = runs.at(-1);
  if (run && i - run.at(-1) <= 2) run.push(i);
  else runs.push([i]);
});
const spans = runs
  .filter((run) => run.length >= 4)
  .map((run) => [
    weeks[run[0]].from,
    new Date(Date.parse(weeks[run.at(-1)].from) + 7 * 24 * HOUR).toISOString().slice(0, 10),
  ]);
await writeFile(output, JSON.stringify({ spans, weeks, months }, null, 1) + "\n");
