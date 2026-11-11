// Prototype residual-based rules, for evaluation only, not store code: the
// jump-and-return rule (recommendation 5 in docs/qc/evaluation.md), the
// residual range test (+-3 q99) and the attenuation test (recommendation 6).
//
//   node docs/qc/scripts/residual-prototype.ts jer2025.json 2025 [from/to ...]
// Windows are UTC, as 2025-01-09T01:00/2025-01-09T06:00. DUMP=n lists flagged
// values; RUNS=n lists flagged runs, LONG=1 only those over 3 hours.
import { readFileSync } from "node:fs";
import { fit, timeline, STANDARD } from "../../../src/harmonic.ts";
import { qc } from "../../../src/qc.ts";
import { load, raised } from "./store.ts";
const H = 3_600_000;
const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mad = (v: number[]) => {
  const c = median(v);
  return 1.4826 * median(v.map((x) => Math.abs(x - c)));
};
const [file, yearArg, ...windows] = process.argv.slice(2);
const year = Number(yearArg);
const { station, start, context, options } = load(file!, year);
const cur = qc(start, options, context);
// Tide: fit on hourly values the source didn't flag.
const mid0 = median(start.map((r: any) => r.level));
const usable = start.filter(
  (r: any) => r.flag < 3 && r.time % H === 0 && Math.abs(r.level - mid0) < 10,
);
const model = fit(
  usable.map((r: any) => ({ time: r.time, level: r.level })),
  STANDARD,
);
const pred = timeline(
  model,
  start.map((r: any) => r.time),
).map((s) => s.level);
const res = start.map((r: any, i: number) => r.level - pred[i]!);
const n = res.length,
  t = start.map((r: any) => r.time);
// R: residual jumps. A jump is a change in residual between consecutive values (at most `gapMs` apart) beyond J.
// An opening jump starts a run; the next jump the other way of at least half its size, within 24 h, closes it.
// A run that meets a gap first is flagged to the gap. Values before the first jump are never flagged.
const interval = median(t.slice(1).map((x, i) => x - t[i]!));
const gapMs = Math.max(3 * interval, 30 * 60_000);
const dr: number[] = [];
for (let i = 1; i < n; i++) if (t[i]! - t[i - 1]! <= gapMs) dr.push(res[i]! - res[i - 1]!);
const J = Math.max(Number(process.env.JMIN ?? 0.5), 10 * mad(dr));
const r2 = new Set<number>();
let maxStep = 0;
for (let i = 1; i < n; i++) {
  if (t[i]! - t[i - 1]! > gapMs) continue;
  const open = res[i]! - res[i - 1]!;
  maxStep = Math.max(maxStep, Math.abs(open));
  if (Math.abs(open) <= J || r2.has(i - 1)) continue;
  const base = res[i - 1]!;
  let k = i;
  while (k + 1 < n && t[k + 1]! - t[i]! <= 24 * H) {
    if (t[k + 1]! - t[k]! > gapMs) {
      k = -k - 1;
      break;
    } // gap: flag to it
    const back = res[k + 1]! - res[k]!;
    if (
      Math.sign(back) === -Math.sign(open) &&
      Math.abs(back) > 0.5 * Math.abs(open) &&
      Math.abs(res[k + 1]! - base) < 0.5 * Math.abs(open)
    )
      break;
    k++;
  }
  const last = k < 0 ? -k - 1 : k;
  if (k >= 0 && (k + 1 >= n || t[k + 1]! - t[i]! > 24 * H)) continue; // never closed within a day: a level change, left to step checks
  // The run holds its offset: every residual in it within half the jump of the run's median, unlike water a structure holds while the tide moves.
  const inRun = res.slice(i, last + 1);
  const mid = median(inRun);
  if (inRun.some((x) => Math.abs(x - mid) > 0.5 * Math.abs(open))) continue;
  for (let m = i; m <= last; m++) r2.add(m);
  i = last + 1; // the closing jump opens nothing
}
const curQc = new Set<number>();
cur.forEach((r: any, i: number) => {
  if (raised(r)) curQc.add(i);
});
console.log(
  `${station.id} ${year}: n ${n}, fit rms ${model.rms.toFixed(3)} m, resid MAD ${mad(res).toFixed(3)}; J ${J.toFixed(3)}, max residual step ${maxStep.toFixed(2)}`,
);
console.log(
  `  current QC flags (over source): ${curQc.size}; jump rule ${r2.size}; of the current flags, the jump rule also flags ${[...curQc].filter((i) => r2.has(i)).length}`,
);
for (const w of windows) {
  const [a, z] = w.split("/").map((s) => Date.parse(s + "Z"));
  const idx = t.map((x, i) => i).filter((i) => t[i]! >= a! && t[i]! < z!);
  console.log(
    `  ${w}: n ${idx.length}, current ${idx.filter((i) => curQc.has(i)).length}, jump rule ${idx.filter((i) => r2.has(i)).length}, max |resid| ${Math.max(...idx.map((i) => Math.abs(res[i]!))).toFixed(2)}, max step ${Math.max(0, ...idx.filter((i) => i > 0 && t[i]! - t[i - 1]! <= gapMs).map((i) => Math.abs(res[i]! - res[i - 1]!))).toFixed(2)}`,
  );
}
if (process.env.DUMP)
  for (const i of [...r2].sort((x, y) => x - y).slice(0, Number(process.env.DUMP)))
    console.log(
      `   ${new Date(t[i]!).toISOString().slice(0, 16)} L ${start[i].level} res ${res[i]!.toFixed(2)}`,
    );
if (process.env.RUNS) {
  const idx = [...r2].sort((x, y) => x - y);
  const runs: [number, number][] = [];
  for (const i of idx) {
    const l = runs.at(-1);
    if (l && l[1] === i - 1) l[1] = i;
    else runs.push([i, i]);
  }
  const len = runs.map(([a, z]) => (t[z]! - t[a]!) / 60000 + interval / 60000);
  console.log(
    `  runs ${runs.length}, minutes: median ${median(len)}, max ${Math.max(...len)}, runs > 6 h ${len.filter((x) => x > 360).length}`,
  );
  for (const [a, z] of (process.env.LONG
    ? runs.filter(([a, z]) => t[z]! - t[a]! > 3 * H)
    : runs.filter(
        (_, k) => k % Math.max(1, Math.floor(runs.length / Number(process.env.RUNS))) === 0,
      )
  ).slice(0, Number(process.env.RUNS)))
    console.log(
      `   ${new Date(t[a]!).toISOString().slice(0, 16)} to ${new Date(t[z]!).toISOString().slice(11, 16)} (${z - a + 1}) before ${start[a - 1]?.level} first ${start[a].level} last ${start[z].level} after ${start[z + 1]?.level} (${new Date(t[z + 1] ?? 0).toISOString().slice(11, 16)})`,
    );
}

// Residual range (CMEMS DM: +-3 q99 of the residual) and attenuation (observed vs predicted range over each UTC day).
{
  const absr = res
    .filter((_, i) => start[i].flag < 3)
    .map(Math.abs)
    .sort((a, b) => a - b);
  const q99 = absr[Math.floor(0.99 * (absr.length - 1))]!;
  const lim = 3 * q99;
  const over = res.map((x, i) => (Math.abs(x) > lim ? i : -1)).filter((i) => i >= 0);
  // attenuation: per UTC day, observed range / predicted range
  const days = new Map<number, { lo: number; hi: number; plo: number; phi: number; n: number }>();
  start.forEach((r: any, i: number) => {
    const d = Math.floor(r.time / 864e5);
    const e = days.get(d) ?? { lo: Infinity, hi: -Infinity, plo: Infinity, phi: -Infinity, n: 0 };
    if (Math.abs(r.level - mid0) < 10) {
      e.lo = Math.min(e.lo, r.level);
      e.hi = Math.max(e.hi, r.level);
      e.n++;
    }
    e.plo = Math.min(e.plo, pred[i]!);
    e.phi = Math.max(e.phi, pred[i]!);
    days.set(d, e);
  });
  const att = [...days]
    .filter(([, e]) => e.n > (0.8 * 86400e3) / interval && e.hi - e.lo < 0.5 * (e.phi - e.plo))
    .map(
      ([d, e]) =>
        `${new Date(d * 864e5).toISOString().slice(5, 10)} ${(e.hi - e.lo).toFixed(2)}/${(e.phi - e.plo).toFixed(2)}`,
    );
  console.log(
    `  residual q99 ${q99.toFixed(2)}, 3*q99 ${lim.toFixed(2)}: ${over.length} values beyond; attenuated days (obs range < half predicted): ${att.length} ${att.slice(0, 12).join(", ")}`,
  );
  for (const w of windows) {
    const [a, z] = w.split("/").map((x) => Date.parse(x + "Z"));
    console.log(`    ${w}: beyond 3*q99 ${over.filter((i) => t[i]! >= a! && t[i]! < z!).length}`);
  }
}
