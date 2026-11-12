// Synthetic cases for the suspected gaps in docs/qc/current-pipeline.md:
// dithering stuck gauge, flatline across a gap, mixed sampling, surges in a
// 7-day and a year window, an offset run, a lone value before a gap, and a
// steep tide next to a gap.
//
//   node docs/qc/scripts/synthetic.ts
import { qc } from "../../../src/qc.ts";
import type { Observation } from "../../../src/schema.ts";
const H = 3600_000,
  M = 60_000;
const t0 = Date.UTC(2025, 0, 1);
type R = Observation;
const tide = (t: number, a = 1, extra = 0) =>
  a * Math.cos((2 * Math.PI * (t - t0)) / (12.42 * H)) + extra;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
function series(n: number, step: number, f: (t: number, i: number) => number): R[] {
  return Array.from({ length: n }, (_, i) => ({
    time: t0 + i * step,
    level: r4(f(t0 + i * step, i)),
    flag: 0 as const,
  }));
}
const flagged = (rows: R[], from: number, to: number) =>
  rows.filter((r) => r.time >= from && r.time < to && r.flag >= 3).length;
const total = (rows: R[], from: number, to: number) =>
  rows.filter((r) => r.time >= from && r.time < to).length;
function report(name: string, out: R[], from: number, to: number, extra = "") {
  console.log(
    `${name}: ${flagged(out, from, to)}/${total(out, from, to)} in target flagged; ${out.filter((r) => r.flag >= 3).length} flagged overall ${extra}`,
  );
}

// Gap 2: stuck gauge dithering +-1 mm for 8 h on a 1 m tide, 6-min data, 3 days.
{
  const s = series(720, 6 * M, (t) => tide(t));
  const a = t0 + 24 * H,
    b = a + 8 * H;
  for (const r of s)
    if (r.time >= a && r.time < b) r.level = r4(0.42 + (((r.time / (6 * M)) % 3) - 1) * 0.001);
  report("gap2 dithering stuck 8h tidal (default opts)", qc(s, {}), a, b);
  const s2 = series(720, 6 * M, (t) => tide(t));
  for (const r of s2) if (r.time >= a && r.time < b) r.level = 0.42;
  report("gap2 control: exactly flat 8h", qc(s2, {}), a, b);
}
// Gap 3: four equal values spanning a long gap at still water hourly data
{
  const s: R[] = [];
  for (let i = 0; i < 48; i++)
    s.push({ time: t0 + i * H, level: r4(1 + 0.01 * Math.sin(i / 3)), flag: 0 });
  // values: 2 at 1.2345 before a 60 h gap, 2 at 1.2345 after
  const g = t0 + 48 * H;
  s.push({ time: g, level: 1.2345, flag: 0 }, { time: g + H, level: 1.2345, flag: 0 });
  s.push(
    { time: g + 61 * H, level: 1.2345, flag: 0 },
    { time: g + 62 * H, level: 1.2345, flag: 0 },
  );
  for (let i = 63; i < 110; i++)
    s.push({ time: g + i * H, level: r4(1.3 + 0.01 * Math.sin(i / 3)), flag: 0 });
  report(
    "gap3 4 equal values across 60h gap (still opts 48h)",
    qc(s, { flatline_s: 48 * 3600, outliers: false, held: false }),
    g,
    g + 63 * H,
  );
}
// Gap 4: mixed sampling: 8 months 6-min then 4 months hourly, spike in hourly part
{
  const a: R[] = series(8 * 30 * 240, 6 * M, (t) => tide(t));
  const start = a.at(-1)!.time + H;
  const b: R[] = series(4 * 30 * 24, H, (t) => tide(t + 0)).map((r) => ({
    ...r,
    time: r.time - t0 + start,
  }));
  const spikeAt = b[500]!.time;
  b[500]!.level = r4(b[500]!.level + 3);
  const out = qc([...a, ...b], {});
  report("gap4 3 m spike in hourly part of mixed year", out, spikeAt, spikeAt + 1);
  const only = qc(b, {});
  report("gap4 control: same hourly part alone", only, spikeAt, spikeAt + 1);
}
// Gap 5: 7-day window, tidal coastal, small tide, surge
for (const [amp, surge] of [
  [0.1, 1.2],
  [0.1, 0.9],
  [0.2, 1.7],
  [0.15, 1.5],
  [0.3, 2.5],
] as const) {
  const s = series(7 * 240, 6 * M, (t) => {
    const h = (t - t0) / H; // surge peak at day 5, gaussian 10h sd
    return (
      tide(t, amp) +
      0.6 * amp * Math.cos((2 * Math.PI * (t - t0)) / (23.93 * H)) +
      surge * Math.exp(-(((h - 120) / 10) ** 2) / 2)
    );
  });
  const out = qc(s, {});
  report(
    `gap5 7-day window M2 ${amp} m + K1 ${0.6 * amp} m, surge ${surge} m`,
    out,
    t0 + 100 * H,
    t0 + 140 * H,
  );
  // same surge inside a year window (context of a year of tide)
  const y = series(365 * 240, 6 * M, (t) => {
    const h = (t - t0) / H;
    return (
      tide(t, amp) +
      0.6 * amp * Math.cos((2 * Math.PI * (t - t0)) / (23.93 * H)) +
      surge * Math.exp(-(((h - 120) / 10) ** 2) / 2)
    );
  });
  report(`   same in a year window`, qc(y, {}), t0 + 100 * H, t0 + 140 * H);
}
// Offset run (Kilrush-like): 5-min, 1.6 m tide, 4 h at -7 m offset
{
  const s = series(3 * 288, 5 * M, (t) => tide(t, 1.6));
  const a = t0 + 30 * H,
    b = a + 4 * H;
  for (const r of s)
    if (r.time >= a && r.time < b) r.level = r4(r.level - 7 + 0.05 * Math.sin(r.time / 1e6));
  report("offset run 4h at -7 m (7 days default)", qc(s, {}), a, b);
}
// Lone bad value next to a gap
{
  const s = series(3 * 96, 15 * M, (t) => tide(t, 3.4));
  const k = 150;
  s[k]!.level = 0;
  const gap = s.splice(k + 1, 4); // 1 h gap after
  const out = qc(s, {});
  report(
    "lone 0.0 before a 1h gap, 15-min, 3.4 m tide",
    out,
    s[k]!.time,
    s[k]!.time + 1,
    `(gap ${gap.length} values)`,
  );
  console.log(
    "  flags around:",
    out
      .slice(k - 3, k + 4)
      .map((r) => `${new Date(r.time).toISOString().slice(11, 16)} ${r.level} f${r.flag}`)
      .join(", "),
  );
}
// Steep tide, one-sided neighbors: false positive near gap
{
  let fp = 0,
    n = 0;
  for (let phase = 0; phase < 12; phase++) {
    const s = series(3 * 96, 15 * M, (t) => tide(t + phase * H, 4.5));
    const k = 150;
    s.splice(k + 1, 3); // 45 min gap after k (next value 60 min later)
    const out = qc(s, {});
    fp += out.filter((r) => r.flag >= 3).length;
    n++;
  }
  console.log(`steep 9 m range tide, 15-min, one 45-min gap: ${fp} false flags over ${n} phases`);
}
