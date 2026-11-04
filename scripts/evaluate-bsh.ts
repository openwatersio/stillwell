/**
 * Can we reproduce BSH's tide predictions from one year of them?
 *
 * For each gauge, fit to BSH's 2026 predictions and compare with its 2027
 * predictions, three ways:
 *
 * - HRoI: BSH's own method (39 partial tides) fitted to the 2026 high and low
 *   waters, with the curve drawn from the 2026 mean tide curve.
 * - Harmonic: Slackwater's method, fitted to the 2026 10-minute curve, with
 *   every turning point reported as an extreme.
 * - Harmonic, canonical: the same curve, reduced to one HW and one LW per half
 *   lunar day, which is how BSH (and RWS) select events.
 *
 * BSH's 2027 file uses a newer analysis epoch (2006–2024) than 2026's
 * (2005–2023), so some of the hold-out error is BSH's own update.
 *
 * Usage: node scripts/evaluate-bsh.ts [bshnr...]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { useDiskCache } from "../src/cache.ts";
import * as harmonic from "../src/harmonic.ts";
import * as hroi from "../src/hroi/index.ts";
import { SET_3 } from "../src/hroi/constituents.ts";
import { transits } from "../src/hroi/transits.ts";
import { compareExtremes, curveErrors, type ExtremeComparison } from "../src/metrics.ts";
import * as bsh from "../src/sources/bsh/index.ts";

useDiskCache();

// prettier-ignore
const GAUGES = [
  "509A", // Helgoland
  "617P", // List, Sylt
  "510P", // Husum
  "505P", // Büsum
  "111P", // Norderney
  "101P", // Borkum, Fischerbalje
  "507P", // Emden
  "814P", // Papenburg, Ems
  "512P", // Wilhelmshaven
  "103P", // Bremerhaven
  "751P", // Bremen, Weser
  "506P", // Cuxhaven
  "695P", // Glückstadt, Elbe
  "508P", // Hamburg, St. Pauli
  "731P", // Hamburg, Zollenspieker
];
const RIDGES = [0, 1e-5, 1e-4, 1e-3];
const RIDGE = 1e-4;

const TRAIN = { start: Date.UTC(2026, 0, 1), end: Date.UTC(2027, 0, 1) };
const TEST = { start: Date.UTC(2027, 0, 1), end: Date.UTC(2028, 0, 1) };

const gauges = process.argv.length > 2 ? process.argv.slice(2) : GAUGES;
const tr = transits(TRAIN.start - 3 * 86_400_000, TEST.end + 3 * 86_400_000);
const results: Result[] = [];
for (const bshnr of gauges) {
  const result = await evaluate(bshnr);
  results.push(result);
  console.error(
    `${bshnr} ${result.name}: ${line(result.hroi.extremes)} | ${line(result.harmonic.canonical)}`,
  );
}

await mkdir("docs/results", { recursive: true });
await writeFile("docs/results/bsh.json", JSON.stringify({ ridge: RIDGE, results }, null, 2) + "\n");
console.log(table(results));

type Result = Awaited<ReturnType<typeof evaluate>>;

async function evaluate(bshnr: string) {
  const gauge = await bsh.gauge(bshnr);
  // Both years in one datum, so a datum step isn't scored as model error.
  const datum = gauge.datum ?? undefined;
  const [train, test, trainCurve, testCurve] = await Promise.all([
    bsh.extremes(bshnr, 2026, datum),
    bsh.extremes(bshnr, 2027, datum),
    bsh.curve(bshnr, 2026, datum),
    bsh.curve(bshnr, 2027, datum),
  ]);
  const testTimes = testCurve.map((s) => s.time);

  // HRoI, at several ridge penalties.
  const assigned = hroi.measure(train, tr);
  const ridges = Object.fromEntries(
    RIDGES.map((ridge) => {
      const model = hroi.fit(assigned, { tides: SET_3, ridge });
      return [ridge, compareExtremes(hroi.predict(model, TEST.start, TEST.end), test)];
    }),
  );
  const model = hroi.fit(assigned, { tides: SET_3, ridge: RIDGE });
  const exact = hroi.fit(assigned, { tides: SET_3 });
  const shape = hroi.meanCurve(trainCurve, train);
  const hroiExtremes = hroi.predict(model, TEST.start - 86_400_000, TEST.end + 86_400_000);

  // Harmonic, on the 10-minute curve.
  const names = [...harmonic.STANDARD, ...harmonic.SHALLOW];
  const hm = harmonic.fit(trainCurve, names);
  const hmCurve = harmonic.timeline(hm, testTimes);
  const intervals = hroi.estimateIntervals(train, tr);
  const hmCanonical = hroi.canonicalExtremes(hmCurve, tr, intervals);

  return {
    bshnr,
    name: gauge.name,
    range: Math.max(...testCurve.map((s) => s.level)) - Math.min(...testCurve.map((s) => s.level)),
    hroi: {
      inSample: compareExtremes(hroi.predict(exact, TRAIN.start, TRAIN.end), train),
      // The mean-curve construction, checked in sample on BSH's own extremes.
      curveInSample: curveErrors(
        hroi.curveAt(
          train,
          shape,
          trainCurve.map((s) => s.time),
        ),
        trainCurve,
      ),
      ridges,
      extremes: ridges[RIDGE]!,
      curve: curveErrors(hroi.curveAt(hroiExtremes, shape, testTimes), testCurve),
    },
    harmonic: {
      terms: hm.constituents.length,
      inSampleRms: hm.rms,
      extremes: compareExtremes(harmonic.extremes(hm, TEST.start, TEST.end), test),
      canonical: compareExtremes(hmCanonical, test),
      curve: curveErrors(hmCurve, testCurve),
    },
  };
}

function line(c: ExtremeComparison): string {
  return `${c.matched}/${c.reference} events, ${c.time.rms.toFixed(1)} min, ${cm(c.height.rms)} cm`;
}

function cm(m: number): string {
  return (m * 100).toFixed(1);
}

function table(rows: Result[]): string {
  const out = [
    "| Gauge | Range (m) | HRoI time RMS / max (min) | HRoI height RMS / max (cm) | HRoI curve RMS (cm) | Harmonic terms | Harmonic events (predicted / BSH) | Harmonic canonical time RMS / max (min) | Harmonic canonical height RMS / max (cm) | Harmonic curve RMS (cm) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of rows) {
    const h = r.hroi.extremes;
    const c = r.harmonic.canonical;
    out.push(
      `| ${r.name} (${r.bshnr}) | ${r.range.toFixed(1)} | ${h.time.rms.toFixed(1)} / ${h.time.max.toFixed(0)} | ${cm(h.height.rms)} / ${cm(h.height.max)} | ${cm(r.hroi.curve.rms)} | ${r.harmonic.terms} | ${r.harmonic.extremes.predicted} / ${r.harmonic.extremes.reference} | ${c.time.rms.toFixed(1)} / ${c.time.max.toFixed(0)} | ${cm(c.height.rms)} / ${cm(c.height.max)} | ${cm(r.harmonic.curve.rms)} |`,
    );
  }
  return out.join("\n");
}
