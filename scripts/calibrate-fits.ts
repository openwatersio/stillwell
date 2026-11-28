/**
 * How closely do the store's harmonic fits reproduce NOAA's constants?
 *
 * NOAA CO-OPS publishes harmonic constants for its own gauges, analyzed from
 * its own observations of them, which the store holds as `coops`, under Schureman's nodal
 * corrections, which the fits use too. For each reference station below this
 * fits the store's series three ways and compares each with NOAA's constants,
 * name for name:
 *
 * - NOAA's years: the store's method (`fitSamples`) over the years NOAA
 *   analyzed, which the comment on its constants names.
 * - Standard: the store's published fit (`fitStation`), the 19 years before
 *   the held-out year.
 * - NOAA's method: each of NOAA's years fitted by itself with NOAA's
 *   constituents, f and u taken at mid-year, and the years vector averaged.
 *   It shows which differences come from the method and which from the data.
 *
 * It reads a local copy of the store (STILLWELL_STORE) and NOAA's constants
 * from the CO-OPS metadata API, and writes docs/results/fit-calibration.json
 * and docs/results/fit-calibration.md. It never writes to the store.
 *
 * Usage: node scripts/calibrate-fits.ts [--concurrency n] [--report]
 *
 * `--report` rewrites the Markdown from the JSON without fitting.
 */
import "./threadpool.ts";
import {
  concurrencyOf,
  inWorkers,
  openCopy,
  rounded,
  stationOf,
  work,
  writePair,
} from "./calibration-run.ts";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { isMainThread } from "node:worker_threads";
import {
  constituents as catalog,
  createTidePredictor,
  fit as engineFit,
  type FittedConstituent,
} from "@slackwater/engine";
import type { Erratum } from "../src/errata.ts";
import { CANDIDATES, SHALLOW } from "../src/fit/candidates.ts";
import {
  candidateOf,
  difference,
  fittedFor,
  analysisYears,
  calibrationDigest,
  MISNAMED,
  noaaConstants,
  vectorAverage,
} from "../src/fit/calibration.ts";
import {
  fittedSide,
  render,
  ROUNDING,
  STEPS,
  YEAR_SHARE,
  yearSpan,
  type Constant,
  type Report,
  type Result,
  type Row,
  type Score,
  type Side,
  type Step,
} from "../src/fit/calibration-report.ts";
import { FIT_OPTIONS, fitStation, varianceExplained } from "../src/fit/fit.ts";
import { STATIONS } from "../src/fit/calibration-stations.ts";
import {
  harmonicSamples,
  NODE_CORRECTIONS,
  rmsOf,
  SEASONAL,
  tidalResiduals,
} from "../src/fit/scores.ts";
import { emptyInputs, finalYear, METHOD, readSeries } from "../src/fit/series.ts";
import { fitSamples, type Verdict } from "../src/fit/window.ts";
import type { StoredStation } from "../src/schema.ts";
import { errata, sourceOf } from "../src/sources/index.ts";
import { harmonicConstants } from "../src/sources/coops/index.ts";
import type { YearRow } from "../src/store/years.ts";
import type { Sample } from "../src/types.ts";

const SOURCE = "coops";
const JSON_PATH = "docs/results/fit-calibration.json";
const REPORT_PATH = "docs/results/fit-calibration.md";

interface Task {
  station: StoredStation;
  pinned: (typeof STATIONS)[number];
  noaa: Constant[];
  marked: boolean;
  store: string;
  years: [string, YearRow][];
  errata: Omit<Erratum, "check">[];
  now: string;
  finalYear: number;
  engine: string;
}

const isSeasonal = (name: string) => (SEASONAL as readonly string[]).includes(name);

async function calibrate(task: Task): Promise<Result> {
  const { station, pinned, noaa } = task;
  const metadata = sourceOf(SOURCE).metadata;
  const base = {
    store: task.store,
    metadata,
    years: new Map(task.years),
    errata: task.errata as Erratum[],
    now: new Date(task.now),
  };
  const read = (period: { start: number; end: number }) =>
    readSeries(station, period, "final", { ...base, inputs: emptyInputs() });

  const { fit, constituents } = await fitStation(station, {
    ...base,
    finalYear: task.finalYear,
    engine: task.engine,
  });
  if (fit.reason !== null || fit.held_out === null)
    throw new Error(`${station.id} has no fit: ${fit.reason}`);
  const standard = {
    constituents: constituents
      .filter((c) => c.kept)
      .map((c): FittedConstituent => ({
        name: c.name,
        amplitude: c.amplitude_m!,
        phase: c.phase_deg!,
        ...(c.amplitude_ci_m === null ? {} : { amplitudeInterval: c.amplitude_ci_m }),
        ...(c.phase_ci_deg === null ? {} : { phaseInterval: c.phase_ci_deg }),
        ...(c.snr === null ? {} : { snr: c.snr }),
      })),
    verdicts: constituents.map((c): Verdict => ({
      name: c.name,
      kept: c.kept,
      reason: c.reason,
      conflict: c.conflict,
      snr: c.snr,
    })),
  };

  const byYear = new Map<number, Sample[]>();
  for (const y of pinned.years) byYear.set(y, await read(yearSpan(y)));
  const none = [...byYear].filter(([, rows]) => !rows.length).map(([y]) => y);
  if (none.length)
    throw new Error(
      `${station.id}: the store has no final values on the hour in ${none.join(", ")}`,
    );
  const samples = [...byYear.values()].flat();
  const window = fitSamples(samples);

  const listed = noaa.flatMap((c) => {
    const candidate = candidateOf(c.name);
    return candidate ? [{ ...c, candidate }] : [];
  });
  // Every constituent NOAA publishes for the station goes into the steps' fits, under the
  // catalog's name for it, so they fit the tide NOAA's own analysis did. Only those the candidate
  // list has are compared.
  const names = [
    ...new Set(
      noaa.flatMap((c) => {
        if (MISNAMED.includes(c.name)) return [];
        const name = candidateOf(c.name)?.name ?? catalog[c.name]?.name;
        return name ? [name] : [];
      }),
    ),
  ];
  const plain = { nodeCorrections: NODE_CORRECTIONS, dropDependent: true } as const;
  const whole = [...byYear].filter(([y, rows]) => {
    const span = yearSpan(y);
    return rows.length >= (YEAR_SHARE * (span.end - span.start)) / 3_600_000;
  });
  // NOAA's method averages a fit of every year it names, so a year too short to fit alone leaves
  // nothing to call NOAA's method.
  if (whole.length !== byYear.size)
    throw new Error(
      `${station.id}: the store holds under two thirds of the hours of ${[...byYear.keys()].filter((y) => !whole.some(([w]) => w === y)).join(", ")}`,
    );
  const averaged = (nodal: "yearly" | "exact") => {
    const fits = whole.map(
      ([, rows]) => engineFit(harmonicSamples(rows), names, { ...plain, nodal }).constituents,
    );
    // Only a constituent every year's fit holds: an average of fewer years isn't NOAA's.
    return names.flatMap((name) => {
      const found = fits.flatMap((f) => f.filter((c) => c.name === name));
      const average = found.length === fits.length ? vectorAverage(found) : null;
      return average ? [{ name, ...average }] : [];
    });
  };
  // The fits of all years together read what the store's fit of NOAA's years reads, so the step
  // from them to it changes the constituents and nothing else.
  const together = harmonicSamples(samples);
  const steps: Record<Step, Constant[]> = {
    yearly: averaged("yearly"),
    exact: averaged("exact"),
    joint: engineFit(together, names, plain).constituents,
    robust: engineFit(together, names, { ...plain, robust: true }).constituents,
  };

  const side = (ours: typeof standard, theirs: Constant): Side => {
    const found = fittedFor(theirs.name, ours.constituents, ours.verdicts);
    if ("reason" in found) return found;
    const c = found.fitted;
    return {
      as: found.sameLine,
      amplitude: c.amplitude,
      phase: c.phase,
      amplitude_ci: c.amplitudeInterval ?? null,
      phase_ci: c.phaseInterval ?? null,
      snr: c.snr ?? null,
      d: difference(c, theirs, ROUNDING),
    };
  };
  const rows = listed.map((c): Row => {
    const step = (constants: Constant[]) => {
      const found = constants.find((x) => x.name === c.candidate.name);
      return found
        ? {
            amplitude: found.amplitude,
            phase: found.phase,
            vector: difference(found, c, ROUNDING).vector,
          }
        : null;
    };
    return {
      name: c.name,
      candidate: c.candidate.name,
      speed: c.candidate.speed,
      noaa: { amplitude: c.amplitude, phase: c.phase },
      window: side(window, c),
      standard: side(standard, c),
      steps: Object.fromEntries(STEPS.map((k) => [k, step(steps[k])])) as Row["steps"],
    };
  });

  const heldOut = await read(yearSpan(fit.held_out));
  const score = (constants: Constant[], seen: boolean): Score => ({
    variance: varianceExplained(constants, heldOut),
    rms: rmsOf(tidalResiduals(constants, heldOut)).rms,
    seen,
  });
  const seen = pinned.years.includes(fit.held_out);

  // The standard window and NOAA's years again with the shallow-water compounds after the
  // candidates, and the standard window's two fits scored on a second year.
  const since = Date.parse(fit.since!);
  const longer = [...CANDIDATES, ...SHALLOW];
  const withTier = fitSamples(await read({ start: since, end: Date.parse(fit.until!) }), longer);
  const windowWithTier = fitSamples(samples, longer);
  const yearBefore = new Date(since).getUTCFullYear() - 1;
  const before = await read(yearSpan(yearBefore));
  const half = (yearSpan(yearBefore).end - yearSpan(yearBefore).start) / 3_600_000 / 2;
  const scoreBefore = (constants: Constant[]): Score | null =>
    before.length >= half && tidalResiduals([], before).size >= half
      ? {
          variance: varianceExplained(constants, before),
          rms: rmsOf(tidalResiduals(constants, before)).rms,
          seen: false,
        }
      : null;
  const tier: Result["tier"] = {
    year_before: yearBefore,
    without: { before: scoreBefore(standard.constituents) },
    with: {
      kept: withTier.constituents.length,
      held: score(withTier.constituents, false),
      before: scoreBefore(withTier.constituents),
      window_kept: windowWithTier.constituents.length,
      window: score(windowWithTier.constituents, seen),
    },
  };

  const held = new Map(
    rows.flatMap((row) => {
      const s = fittedSide(row.window);
      return s?.as ? [[s.as, row] as const] : [];
    }),
  );
  let renamed: Result["renamed"] = null;
  if (held.size) {
    // What the store's fit fitted: the candidates selection kept, then Sa and Ssa, kept or not.
    const fittedNames = [
      ...window.verdicts.filter((v) => v.kept && !isSeasonal(v.name)),
      ...window.verdicts.filter((v) => isSeasonal(v.name) && (v.kept || v.reason === "seasonal")),
    ].map((v) => held.get(v.name)?.candidate ?? v.name);
    const again = engineFit(together, fittedNames, {
      ...FIT_OPTIONS,
      confidence: true,
      dropDependent: true,
    }).constituents.filter(
      (c) => !isSeasonal(c.name) || window.constituents.some((x) => x.name === c.name),
    );
    renamed = {
      held: Object.fromEntries([...held].map(([as, row]) => [row.name, as])),
      score: score(again, seen),
      rows: Object.fromEntries(
        [...held.values()].map((row) => {
          const c = again.find((x) => x.name === row.candidate);
          const theirs = { name: row.name, ...row.noaa };
          return [
            row.name,
            c
              ? {
                  as: null,
                  amplitude: c.amplitude,
                  phase: c.phase,
                  amplitude_ci: c.amplitudeInterval ?? null,
                  phase_ci: c.phaseInterval ?? null,
                  snr: c.snr ?? null,
                  d: difference(c, theirs, ROUNDING),
                }
              : { reason: "not fitted" },
          ];
        }),
      ),
    };
  }
  return {
    id: station.id,
    name: station.name,
    latitude: station.lat,
    why: pinned.why,
    comment: pinned.comment,
    years: pinned.years,
    marked: task.marked,
    unlisted: noaa.filter((c) => !candidateOf(c.name)).map((c) => c.name),
    unknown: noaa
      .filter((c) => !candidateOf(c.name) && (!catalog[c.name] || MISNAMED.includes(c.name)))
      .map((c) => c.name),
    held_out: fit.held_out,
    scores: {
      standard: score(standard.constituents, false),
      window: score(window.constituents, seen),
      // A name the candidate list doesn't have goes to the predictor as NOAA spells it.
      noaa: score(
        noaa
          .filter((c) => !MISNAMED.includes(c.name))
          .map((c) => ({ ...c, name: candidateOf(c.name)?.name ?? c.name })),
        seen,
      ),
      steps: Object.fromEntries(STEPS.map((k) => [k, score(steps[k], seen)])) as Record<
        Step,
        Score
      >,
    },
    standard: {
      since: fit.since!,
      until: fit.until!,
      hours: fit.hours!,
      kept: standard.constituents.length,
    },
    window: {
      hours: window.hours,
      by_year: Object.fromEntries([...byYear].map(([y, rows]) => [y, rows.length])),
      kept: window.constituents.length,
    },
    renamed,
    tier,
    yearly: whole.map(([y]) => y),
    rows,
  };
}

/** Throws unless `report` holds every calibration station once, in the list's order. */
function complete(report: Report): void {
  const ids = report.results.map((r) => r.id).join();
  if (ids !== STATIONS.map((s) => `${SOURCE}/${s.id}`).join())
    throw new Error(`${JSON_PATH} doesn't hold the calibration's stations, each once`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { concurrency: { type: "string", default: "4" }, report: { type: "boolean" } },
  });
  if (values.report) {
    // Read only here, so a file a merge left unreadable doesn't stop the run that replaces it.
    if (!existsSync(JSON_PATH)) throw new Error(`no ${JSON_PATH} to write the report from`);
    const previous = JSON.parse(await readFile(JSON_PATH, "utf8")) as Report;
    complete(previous);
    await writeFile(REPORT_PATH, render(previous));
    return;
  }

  const concurrency = concurrencyOf(values.concurrency, STATIONS.length);
  for (const pin of STATIONS)
    if (analysisYears(pin.comment).join() !== pin.years.join())
      throw new Error(`coops/${pin.id}: its years aren't the ones its comment names`);

  const copy = await openCopy(SOURCE);
  const tasks: Task[] = [];
  for (const pin of STATIONS) {
    const station = await stationOf(copy, `${SOURCE}/${pin.id}`);
    const { comment, constants } = noaaConstants(station.id, await harmonicConstants(pin.id));
    if (constants.length !== (pin.constituents ?? 37))
      throw new Error(
        `${station.id}: NOAA sent ${constants.length} constituents where ${pin.constituents ?? 37} are expected`,
      );
    if (comment !== pin.comment)
      throw new Error(
        `${station.id}: NOAA's comment on its constants read "${pin.comment}" and now reads "${comment}"; set its years from that`,
      );
    tasks.push({
      station,
      pinned: pin,
      noaa: constants,
      marked: copy.marked.has(station.id),
      store: copy.store,
      years: copy.years,
      errata: copy.errata,
      now: copy.now.toISOString(),
      finalYear: copy.final,
      engine: copy.engine,
    });
  }
  const results = await inWorkers<Task, Result>(new URL(import.meta.url), copy, tasks, concurrency);
  const { engine, final } = copy;

  const report: Report = {
    engine,
    inputs: calibrationDigest(),
    leak: {
      K1: leak("K1", ["S1", "P1"]),
      K2: leak("K2", ["R2"]),
      exact: Math.max(
        ...Object.values(leak("K1", ["S1", "P1"], "exact")).map((x) => x[1]),
        ...Object.values(leak("K2", ["R2"], "exact")).map((x) => x[1]),
      ),
    },
    method: METHOD,
    node_corrections: NODE_CORRECTIONS,
    final_year: final,
    results: STATIONS.map((s) => results.get(`${SOURCE}/${s.id}`)!),
  };
  // Both files from the numbers as the JSON holds them, and neither written unless both can be.
  const json = JSON.stringify(report, rounded, 2) + "\n";
  const markdown = render(JSON.parse(json) as Report);
  complete(report);
  await writePair(JSON_PATH, json, REPORT_PATH, markdown);
  console.error(`wrote ${JSON_PATH} and ${REPORT_PATH}`);
  // The workers wait for another station.
  process.exit(0);
}

/**
 * What a constituent with constant node factors picks up from a neighbor a
 * cycle or two a year away, when a year is fitted with the neighbor's node
 * factors held at mid-year: the amplitude left in each of `into` by a tide of
 * `from` alone, of 1 m, as the smallest and largest over the years 2006 to
 * 2024. It is NOAA's method on a synthetic tide, so it says how much of a
 * difference from NOAA's S1, P1 and R2 that method accounts for.
 */
function leak(
  from: string,
  into: string[],
  nodal: "yearly" | "exact" = "yearly",
): Record<string, [number, number]> {
  const predictor = createTidePredictor([{ name: from, amplitude: 1, phase: 0 }], {
    offset: false,
    nodeCorrections: NODE_CORRECTIONS,
  });
  const found: Record<string, number[]> = Object.fromEntries(into.map((name) => [name, []]));
  for (let y = 2006; y <= 2024; y++) {
    const samples = [];
    for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 3_600_000)
      samples.push({
        time: new Date(t),
        value: predictor.getWaterLevelAtTime({ time: new Date(t) }).level,
      });
    const fitted = engineFit(samples, [from, ...into], {
      nodeCorrections: NODE_CORRECTIONS,
      nodal,
    }).constituents;
    for (const name of into) found[name]!.push(fitted.find((c) => c.name === name)!.amplitude);
  }
  return Object.fromEntries(
    into.map((name) => [name, [Math.min(...found[name]!), Math.max(...found[name]!)]]),
  );
}

if (isMainThread) await main();
else work(calibrate);
