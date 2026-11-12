// What non-finite levels in a window do to src/qc.ts: which rule raises false
// flags, and how often a real spike goes unflagged.
//
//   node docs/qc/scripts/non-finite.ts
import { qc } from "../../../src/qc.ts";

const t0 = Date.UTC(2025, 0, 1);
const window = (days: number, nan: number[], spikeAt?: number, noise = () => 0) => {
  const s = Array.from({ length: days * 240 }, (_, i) => ({
    time: t0 + i * 360_000,
    level: Math.round(1e4 * (Math.cos((2 * Math.PI * i * 0.1) / 12.42) + noise())) / 1e4,
    flag: 0 as 0 | 3 | 4,
  }));
  for (const k of nan) s[k]!.level = NaN;
  if (spikeAt !== undefined)
    s[spikeAt]!.level = Number.isNaN(s[spikeAt]!.level) ? 3 : s[spikeAt]!.level + 3;
  return s;
};
const suspect = (o: { flag: number }[]) => o.filter((r) => r.flag === 3).length;

// One 30-day window, NaN at rows 1000 and 3000, each rule switched off in turn.
const nan = [1000, 3000];
for (const [label, opts] of [
  ["all rules", {}],
  ["outliers off", { outliers: false }],
  ["held off", { held: false }],
  ["spike floor 1e6 m (also the outlier floor)", { spike_m: 1e6 }],
] as const)
  console.log(
    label.padEnd(44),
    "suspect without NaN",
    suspect(qc(window(30, []), opts)),
    "| with 2 NaN",
    suspect(qc(window(30, nan), opts)),
  );

// 200 7-day windows with 1 to 20 NaN at random rows and a 3 m spike at row 800.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let missed = 0;
let falseFlags = 0;
for (let t = 0; t < 200; t++) {
  const rows = Array.from({ length: 1 + Math.floor(rnd() * 20) }, () => 0);
  const s = window(7, [], undefined, () => 0.01 * (rnd() - 0.5));
  for (const _ of rows) s[Math.floor(rnd() * s.length)]!.level = NaN;
  s[800]!.level = Number.isNaN(s[800]!.level) ? 3 : s[800]!.level + 3;
  const o = qc(s, {});
  if (o[800]!.flag < 3) missed++;
  if (o.filter((r, i) => i !== 800 && r.flag === 3).length > 10) falseFlags++;
}
console.log(
  `200 7-day windows with 1 to 20 NaN and a 3 m spike: spike missed in ${missed}, more than 10 false suspect flags in ${falseFlags}`,
);
