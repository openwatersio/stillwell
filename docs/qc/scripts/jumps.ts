// What the residual-jump rule adds to QC on exported station-years: each runs
// as requalify does (fromSource, the years either side as context, qcFor's
// options) but without errata spans, as store.ts reads them, once with the
// rule and once without,
// and lists the values only the rule flags, as runs.
//
//   node docs/qc/scripts/jumps.ts jer2025.json:2025 [more.json:year ...]
import { qc } from "../../../src/qc.ts";
import { load } from "./store.ts";

let total = 0;
for (const arg of process.argv.slice(2)) {
  const [file, year] = arg.split(":");
  const { station, start, context, options } = load(file!, Number(year));
  if (!options.jumps) continue;
  const on = qc(start, options, context);
  const off = qc(start, { ...options, jumps: false }, context);
  const added = on.flatMap((r, i) => (r.flag >= 3 && off[i]!.flag < 3 ? [i] : []));
  total += added.length;
  const runs: [number, number][] = [];
  for (const i of added) {
    const last = runs.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  }
  console.log(`${station.id} ${year}: ${on.length} values, ${added.length} added`);
  for (const [a, z] of runs)
    console.log(
      `  ${new Date(on[a]!.time).toISOString().slice(0, 16)} to ${new Date(on[z]!.time).toISOString().slice(0, 16)}: ${z - a + 1} values, ${on[a - 1]?.level} then ${on[a]!.level} … ${on[z]!.level} then ${on[z + 1]?.level}`,
    );
}
console.log(`added ${total}`);
