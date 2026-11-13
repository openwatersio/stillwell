// Times src/qc.ts, with the station's qcFor options, against a harmonic fit
// and prediction on one station-year. Needs `npm install`.
//
//   node docs/qc/scripts/timing.ts jer2025.json 2025
import { fit, timeline, STANDARD } from "../../../src/harmonic.ts";
import { qc } from "../../../src/qc.ts";
import { load } from "./store.ts";

const [file, yearArg] = process.argv.slice(2);
const { start, context, options } = load(file!, Number(yearArg));
let t = performance.now();
qc(start, options, context);
const tq = performance.now() - t;
t = performance.now();
const model = fit(
  start.filter((r) => r.time % 3_600_000 === 0),
  STANDARD,
);
const tf = performance.now() - t;
t = performance.now();
timeline(
  model,
  start.map((r) => r.time),
);
const tp = performance.now() - t;
console.log(
  file,
  start.length,
  `qc ${tq.toFixed(0)} ms, fit ${tf.toFixed(0)} ms, predict ${tp.toFixed(0)} ms`,
);
