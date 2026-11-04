/**
 * HRoI against the harmonic method on observed water levels at Dutch gauges.
 *
 * Both methods are fitted to the same eight years of RWS observations
 * (2016–2023): HRoI to the observed high and low waters RWS publishes, the
 * harmonic method to the 10-minute series. Both then predict 2024, scored
 * against the observed high and low waters and 10-minute levels. (RWS hadn't
 * published checked extremes for 2025 when this was written.) RWS's own
 * astronomical prediction is scored the same way as a reference. Observed
 * levels carry surge, so no method gets near zero; what matters is the gap
 * between them.
 *
 * Usage: node scripts/evaluate-rws.ts [location...]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { useDiskCache } from "../src/cache.ts";
import * as harmonic from "../src/harmonic.ts";
import * as hroi from "../src/hroi/index.ts";
import { SET_3 } from "../src/hroi/constituents.ts";
import { transits } from "../src/hroi/transits.ts";
import { compareExtremes, curveErrors, type ExtremeComparison } from "../src/metrics.ts";
import * as rws from "../src/sources/rws/index.ts";

useDiskCache();

const LOCATIONS = [
  "vlissingen",
  "rilland.bath",
  "hoekvanholland",
  "denhelder.marsdiep",
  "harlingen.waddenzee",
  "delfzijl",
];
const TRAIN = { start: new Date("2016-01-01T00:00Z"), end: new Date("2024-01-01T00:00Z") };
const TEST = { start: new Date("2024-01-01T00:00Z"), end: new Date("2025-01-01T00:00Z") };
const RIDGE = 1e-6;
const DAY = 86_400_000;

const locations = process.argv.length > 2 ? process.argv.slice(2) : LOCATIONS;
const tr = transits(TRAIN.start.getTime() - 3 * DAY, TEST.end.getTime() + 3 * DAY);
const results: Result[] = [];
for (const location of locations) {
  const result = await evaluate(location);
  results.push(result);
  console.error(
    `${location}: hroi ${line(result.hroi.extremes)} | harmonic ${line(result.harmonic.canonical)} | rws ${line(result.rws.extremes)}`,
  );
}

await mkdir("docs/results", { recursive: true });
await writeFile("docs/results/rws.json", JSON.stringify({ ridge: RIDGE, results }, null, 2) + "\n");
console.log(table(results));

type Result = Awaited<ReturnType<typeof evaluate>>;

async function evaluate(location: string) {
  const [trainExtremes, testExtremes, trainLevels, testLevels, astroExtremes, astroLevels] =
    await Promise.all([
      rws.extremes(location, TRAIN.start, TRAIN.end),
      rws.extremes(location, TEST.start, TEST.end),
      rws.levels(location, TRAIN.start, TRAIN.end),
      rws.levels(location, TEST.start, TEST.end),
      rws.extremes(location, TEST.start, TEST.end, { process: "astronomisch" }),
      rws.levels(location, TEST.start, TEST.end, { process: "astronomisch" }),
    ]);
  const testTimes = testLevels.map((s) => s.time);
  const start = TEST.start.getTime();
  const end = TEST.end.getTime();

  // HRoI on observed extremes.
  const intervals = hroi.estimateIntervals(trainExtremes, tr);
  const assigned = hroi.assign(trainExtremes, tr, intervals);
  const model = hroi.fit(assigned, { tides: SET_3, ridge: RIDGE, intervals });
  const shape = hroi.meanCurve(trainLevels, trainExtremes);
  const predicted = hroi.predict(model, start - DAY, end + DAY);

  // Harmonic on observed levels.
  const hm = harmonic.fit(trainLevels, [...harmonic.STANDARD, ...harmonic.SHALLOW]);
  const hmCurve = harmonic.timeline(hm, testTimes);

  return {
    location,
    samples: {
      trainLevels: trainLevels.length,
      trainExtremes: trainExtremes.length,
      assigned: assigned.length,
    },
    intervals,
    hroi: {
      extremes: compareExtremes(
        predicted.filter((e) => e.time >= start && e.time < end),
        testExtremes,
      ),
      curve: curveErrors(hroi.curveAt(predicted, shape, testTimes), testLevels),
    },
    harmonic: {
      terms: hm.constituents.length,
      extremes: compareExtremes(harmonic.extremes(hm, start, end), testExtremes),
      canonical: compareExtremes(hroi.canonicalExtremes(hmCurve, tr, intervals), testExtremes),
      curve: curveErrors(hmCurve, testLevels),
    },
    rws: {
      extremes: compareExtremes(astroExtremes, testExtremes),
      curve: curveErrors(astroLevels, testLevels),
    },
  };
}

function line(c: ExtremeComparison): string {
  return `${c.matched}/${c.reference} of ${c.predicted}, ${c.time.rms.toFixed(1)} min, ${(c.height.rms * 100).toFixed(1)} cm`;
}

function table(rows: Result[]): string {
  const methods = (r: Result) => [
    r.hroi.extremes,
    r.harmonic.canonical,
    r.harmonic.extremes,
    r.rws.extremes,
  ];
  const out = [
    "Errors against observed 2024 extremes, as HRoI / harmonic (canonical) / harmonic (all turning points) / RWS astronomical.",
    "",
    "| Location | HW time RMS (min) | LW time RMS (min) | HW height RMS (cm) | LW height RMS (cm) | Unmatched observed | Predicted events | Curve RMS (cm), HRoI / harmonic / RWS |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const join = (values: number[], digits = 1) => values.map((v) => v.toFixed(digits)).join(" / ");
  for (const r of rows) {
    const m = methods(r);
    out.push(
      `| ${r.location} | ${join(m.map((c) => c.high.time.rms))} | ${join(m.map((c) => c.low.time.rms))} | ${join(m.map((c) => c.high.height.rms * 100))} | ${join(m.map((c) => c.low.height.rms * 100))} | ${join(
        m.map((c) => c.reference - c.matched),
        0,
      )} | ${join(
        m.map((c) => c.predicted),
        0,
      )} | ${join([r.hroi.curve, r.harmonic.curve, r.rws.curve].map((c) => c.rms * 100))} |`,
    );
  }
  return out.join("\n");
}
