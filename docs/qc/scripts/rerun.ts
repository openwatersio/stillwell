// Reruns src/qc.ts on one exported station-year as requalify does (fromSource,
// the years either side as context, qcFor's options, no errata spans),
// compares the result with the stored flags, and says which rule each QC flag
// needs. Needs `npm install`, since qcFor comes from src/store/recent.ts.
//
//   node docs/qc/scripts/rerun.ts jer2025.json 2025 [from/to ...]
import { qc } from "../../../src/qc.ts";
import { load, raised } from "./store.ts";

const [file, yearArg, ...windows] = process.argv.slice(2);
const year = Number(yearArg);
const { station, stored, start, context, options } = load(file!, year);
const full = qc(start, options, context);
const before = new Map(stored.map((r) => [r.time, r.flag]));
let worse = 0;
let better = 0;
for (const r of full) {
  const b = before.get(r.time)!;
  if (r.flag > b) worse++;
  else if (r.flag < b) better++;
}
console.log(
  `${station.id} ${year} options ${JSON.stringify(options)} n ${stored.length}: stored suspect or bad ${stored.filter((r) => r.flag >= 3).length}, rerun ${full.filter((r) => r.flag >= 3).length}; rerun against stored: ${worse} worse, ${better} better`,
);
const raisedBy = (opts: object) =>
  new Set(
    qc(start, { ...options, ...opts }, context)
      .filter(raised)
      .map((r) => r.time),
  );
const all = raisedBy({});
const without = (opts: object) => {
  const kept = raisedBy(opts);
  return [...all].filter((t) => !kept.has(t)).length;
};
console.log(
  `  raised by QC ${all.size}: needing the outlier rule ${without({ outliers: false })}, the held rule ${without({ held: false })}, the spike rule ${without({ spike_m: 1e9 })}`,
);
for (const w of windows) {
  const [a, b] = w.split("/").map((s) => Date.parse(s + "Z"));
  const inside = (r: { time: number }) => r.time >= a! && r.time < b!;
  const rows = full.filter(inside);
  console.log(
    `  ${w}: n ${rows.length}, rerun suspect or bad ${rows.filter((r) => r.flag >= 3).length}, stored ${stored.filter((r) => inside(r) && r.flag >= 3).length}, min ${Math.min(...rows.map((r) => r.level))}, max ${Math.max(...rows.map((r) => r.level))}`,
  );
}
