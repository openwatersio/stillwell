/**
 * How closely does Kartverket's own method, on the store's values, give
 * Kartverket's constants?
 *
 * Kartverket publishes harmonic constants for its gauges, analyzed from its
 * own observations of them, which the store holds as `kartverket`. For each
 * gauge this fits the store's series the way that reproduces its analysis: one plain
 * least-squares fit over Kartverket's period of Kartverket's constituents,
 * with Foreman's nodal corrections at the gauge's latitude. It compares the
 * constants with Kartverket's, name for name, with the fit's amplitudes
 * scaled by the gain of the filter Kartverket's analysis is taken to have
 * used, and also fits the series run through that filter in time, so the two
 * ways of allowing for it can be compared. The store's own fit of each gauge
 * is scored on its held-out year.
 *
 * It reads a local copy of the store (STILLWELL_STORE) and Kartverket's
 * constants from its tide API, and writes
 * docs/results/kartverket-calibration.json and .md. It never writes to the
 * store.
 *
 * Usage: node scripts/calibrate-kartverket.ts [--concurrency n] [--report]
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
import { fit as engineFit, type FittedConstituent } from "@slackwater/engine";
import type { Erratum } from "../src/errata.ts";
import { lowPass, zeroPhaseGain } from "../src/fit/butterworth.ts";
import { difference, phaseDifference } from "../src/fit/calibration.ts";
import { yearSpan } from "../src/fit/calibration-report.ts";
import { fitStation } from "../src/fit/fit.ts";
import {
  chosen,
  CLOCK,
  estimateFilter,
  FILTER,
  FIT,
  GAUGES,
  IN_TIME,
  kartverketDigest,
  LONG_PERIOD,
  PROBE_FROM,
  render,
  SA_YEARS,
  YEAR_SHARE,
  type Report,
  type Result,
  type Row,
} from "../src/fit/kartverket-report.ts";
import { harmonicSamples } from "../src/fit/scores.ts";
import { emptyInputs, METHOD, readSeries } from "../src/fit/series.ts";
import { Flag, type StoredStation } from "../src/schema.ts";
import { sourceOf } from "../src/sources/index.ts";
import {
  parseConstants,
  periodOf,
  ROUNDING,
  ttMinusUtc,
  type PublishedConstants,
} from "../src/sources/kartverket/constants.ts";
import { harmonicConstants } from "../src/sources/kartverket/index.ts";
import { readObservationsBetween } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import type { YearRow } from "../src/store/years.ts";
import type { Sample } from "../src/types.ts";

const SOURCE = "kartverket";
const JSON_PATH = "docs/results/kartverket-calibration.json";
const REPORT_PATH = "docs/results/kartverket-calibration.md";
const HOUR_MS = 3_600_000;
const STEP_MS = 600_000;

interface Task {
  station: StoredStation;
  published: PublishedConstants;
  marked: boolean;
  store: string;
  years: [string, YearRow][];
  errata: Omit<Erratum, "check">[];
  now: string;
  finalYear: number;
  engine: string;
}

async function calibrate(task: Task): Promise<Result> {
  const { station, published } = task;
  const { period } = published;
  const base = {
    store: task.store,
    metadata: sourceOf(SOURCE).metadata,
    years: new Map(task.years),
    errata: task.errata as Erratum[],
    now: new Date(task.now),
  };
  const read = (span: { start: number; end: number }) =>
    readSeries(station, span, "final", { ...base, inputs: emptyInputs() });
  const names = published.constants.map((c) => c.name);
  // Kartverket's method: one plain fit of its own constituents, Foreman's corrections at the
  // gauge's latitude, f, u and the argument at each sample.
  const options = { ...FIT, latitude: published.latitude };
  const fitted = (samples: readonly Sample[]) =>
    engineFit(harmonicSamples(samples), names, { ...options, confidence: true }).constituents;
  const gain = (speed: number) => zeroPhaseGain(speed, FILTER.order, FILTER.cutoff_hours);

  const samples = await read(period);
  if (!samples.length)
    throw new Error(`${station.id}: the store has no final values in its period`);
  const ours = fitted(samples);

  /** One fit against Kartverket's, the fit's amplitude and its interval scaled by the gain. */
  const against = (
    fit: readonly FittedConstituent[],
    theirs: (typeof published.constants)[number],
  ) => {
    const c = fit.find((x) => x.name === theirs.name);
    if (!c) return null;
    const g = gain(theirs.speed);
    const scaled = {
      ...c,
      amplitude: c.amplitude * g,
      ...(c.amplitudeInterval === undefined ? {} : { amplitudeInterval: c.amplitudeInterval * g }),
    };
    return {
      c,
      g,
      d: difference(scaled, theirs, ROUNDING),
      unscaled: difference(c, theirs, ROUNDING).vector,
    };
  };
  const outsideOf = (fit: readonly FittedConstituent[]) => {
    const found = published.constants.flatMap((t) => {
      const x = t.speed >= LONG_PERIOD ? against(fit, t) : null;
      return x ? [x.d] : [];
    });
    return {
      outside: found.filter((d) => (d.ratio ?? 0) > 1).length,
      vector: found.reduce((s, d) => s + d.vector, 0) / Math.max(found.length, 1),
    };
  };

  // The series filtered in time: the 10-minute values, gaps of up to an hour filled in a straight
  // line, each run through the filter, a day dropped at its ends, and read on the hour.
  let viaFilter: FittedConstituent[] | null = null;
  let filteredHours: number | null = null;
  if (station.epochs.length === 1) {
    const tenMinute: Sample[] = [];
    for (
      let y = new Date(period.start).getUTCFullYear();
      y <= new Date(period.end - 1).getUTCFullYear();
      y++
    ) {
      const path = seriesPath(task.store, "levels", station.source, station.source_id, y);
      if (!base.years.has(`${station.id} 1 ${y}`)) continue;
      for (const o of await readObservationsBetween(path, period.start, period.end, false))
        if (o.flag === Flag.good && Number.isFinite(o.level) && o.time % STEP_MS === 0)
          tenMinute.push({ time: o.time, level: Math.round(o.level * 1e4) / 1e4 });
    }
    const out: Sample[] = [];
    let run: Sample[] = [];
    const flush = () => {
      if (run.length > IN_TIME.run_days * 144) {
        const smooth = lowPass(
          run.map((s) => s.level),
          FILTER.order,
          FILTER.cutoff_hours,
          1 / 6,
        );
        for (let i = IN_TIME.trim_days * 144; i < run.length - IN_TIME.trim_days * 144; i++)
          if (run[i]!.time % HOUR_MS === 0) out.push({ time: run[i]!.time, level: smooth[i]! });
      }
      run = [];
    };
    for (const s of tenMinute) {
      const last = run.at(-1);
      if (last && s.time - last.time > IN_TIME.gap_hours * HOUR_MS) flush();
      else if (last)
        for (let t = last.time + STEP_MS; t < s.time; t += STEP_MS)
          run.push({
            time: t,
            level: last.level + ((s.level - last.level) * (t - last.time)) / (s.time - last.time),
          });
      run.push(s);
    }
    flush();
    filteredHours = out.length;
    viaFilter = engineFit(harmonicSamples(out), names, options).constituents;
  }

  const rows = published.constants.map((theirs): Row => {
    const x = against(ours, theirs);
    const timed = viaFilter?.find((c) => c.name === theirs.name);
    return {
      name: theirs.published,
      candidate: theirs.name,
      speed: theirs.speed,
      kartverket: { amplitude: theirs.amplitude, phase: theirs.phase },
      ours: x
        ? {
            amplitude: x.c.amplitude,
            phase: x.c.phase,
            amplitude_ci: x.c.amplitudeInterval ?? null,
            phase_ci: x.c.phaseInterval ?? null,
            gain: x.g,
            d: x.d,
            unscaled: x.unscaled,
          }
        : { reason: "not separable" },
      filtered: timed ? difference(timed, theirs, ROUNDING).vector : null,
    };
  });

  // The seconds past one hour the phases ask for: the slope of the phase differences against
  // speed, weighted by amplitude squared, over the constituents faster than 10° an hour.
  const tt = ttMinusUtc(period.start, period.end);
  let [num, den, spread] = [0, 0, 0];
  for (const theirs of published.constants) {
    const c = ours.find((x) => x.name === theirs.name);
    if (!c || theirs.speed < CLOCK.speed || theirs.amplitude < CLOCK.amplitude) continue;
    const weight = theirs.amplitude ** 2 * theirs.speed;
    num += weight * phaseDifference(c.phase, theirs.phase);
    den += weight * theirs.speed;
    // Each phase's 95% half-width carried through the weighted slope.
    spread += (weight * (c.phaseInterval ?? NaN)) ** 2;
  }
  const phaseSeconds = den ? tt - (num / den) * 3600 : null;
  const phaseSecondsCi = den && Number.isFinite(spread) ? (Math.sqrt(spread) / den) * 3600 : null;

  // Kartverket doesn't say which years its long-period constants are from: SA again over 1991 to
  // 2020, where the store holds each of those years whole.
  const long = { start: Date.UTC(SA_YEARS[0], 0, 1), end: Date.UTC(SA_YEARS[1] + 1, 0, 1) };
  const longSamples = await read(long);
  const hoursOf = new Map<number, number>();
  for (const s of longSamples) {
    const y = new Date(s.time).getUTCFullYear();
    hoursOf.set(y, (hoursOf.get(y) ?? 0) + 1);
  }
  const whole = (y: number) =>
    (hoursOf.get(y) ?? 0) >= (YEAR_SHARE * (yearSpan(y).end - yearSpan(y).start)) / HOUR_MS;
  const theirSa = published.constants.find((c) => c.name === "SA_KV");
  let saLong: Result["sa_long"] = null;
  if (
    theirSa &&
    Array.from({ length: SA_YEARS[1] - SA_YEARS[0] + 1 }, (_, i) => SA_YEARS[0] + i).every(whole)
  ) {
    const sa = engineFit(harmonicSamples(longSamples), names, options).constituents.find(
      (c) => c.name === "SA_KV",
    );
    if (sa)
      saLong = {
        amplitude: sa.amplitude,
        phase: sa.phase,
        vector: difference(sa, theirSa, ROUNDING).vector,
      };
  }

  // Kartverket's period is in UTC+1, and so are its years here.
  const yearOf = (time: number) => new Date(time + HOUR_MS).getUTCFullYear();
  const periodYears = Array.from(
    { length: yearOf(period.end - 1) - yearOf(period.start) + 1 },
    (_, i) => yearOf(period.start) + i,
  );
  const inPeriod = new Map<number, number>();
  for (const s of samples) inPeriod.set(yearOf(s.time), (inPeriod.get(yearOf(s.time)) ?? 0) + 1);
  // A year against the part of it the period holds, so a period that starts in October isn't short of a year.
  const shortYears = periodYears.filter((y) => {
    const span = { start: yearSpan(y).start - HOUR_MS, end: yearSpan(y).end - HOUR_MS };
    const within = Math.min(span.end, period.end) - Math.max(span.start, period.start);
    return (inPeriod.get(y) ?? 0) < (YEAR_SHARE * within) / HOUR_MS;
  });

  const robust = outsideOf(
    engineFit(harmonicSamples(samples), names, { ...options, robust: true, confidence: true })
      .constituents,
  );
  let probe: Result["probe"] = null;
  if (outsideOf(ours).outside >= PROBE_FROM)
    probe = [1, 2].flatMap((years) =>
      periodYears.slice(0, periodYears.length - years + 1).map((year) => ({
        year,
        years,
        ...outsideOf(
          fitted(samples.filter((s) => yearOf(s.time) < year || yearOf(s.time) >= year + years)),
        ),
      })),
    );

  const { fit, constituents } = await fitStation(station, {
    ...base,
    finalYear: task.finalYear,
    engine: task.engine,
  });
  if (fit.reason !== null || fit.held_out === null)
    throw new Error(`${station.id} has no fit: ${fit.reason}`);

  return {
    id: station.id,
    name: station.name,
    latitude: published.latitude,
    period: {
      start: new Date(period.start).toISOString(),
      end: new Date(period.end - 1).toISOString(),
    },
    hours: samples.length,
    filtered_hours: filteredHours,
    short_years: shortYears,
    marked: task.marked,
    phase_seconds: phaseSeconds,
    phase_seconds_ci: phaseSecondsCi,
    tt_seconds: tt,
    sa_long: saLong,
    standard: {
      since: fit.since!,
      until: fit.until!,
      held_out: fit.held_out,
      variance: fit.variance_explained,
      rms: fit.held_out_rms_m,
      kept: constituents.filter((c) => c.kept).length,
    },
    robust,
    vector: outsideOf(ours).vector,
    probe,
    rows,
  };
}

/** Throws unless `report` holds every gauge once, in the list's order. */
function complete(report: Report): void {
  if (report.results.map((r) => r.id).join() !== GAUGES.map((g) => `${SOURCE}/${g}`).join())
    throw new Error(`${JSON_PATH} doesn't hold the calibration's gauges, each once`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { concurrency: { type: "string", default: "4" }, report: { type: "boolean" } },
  });
  if (values.report) {
    if (!existsSync(JSON_PATH)) throw new Error(`no ${JSON_PATH} to write the report from`);
    const previous = JSON.parse(await readFile(JSON_PATH, "utf8")) as Report;
    complete(previous);
    await writeFile(REPORT_PATH, render(previous));
    return;
  }
  const concurrency = concurrencyOf(values.concurrency, GAUGES.length);
  const copy = await openCopy(SOURCE);
  const tasks: Task[] = [];
  // Every gauge's constants are asked for, so the ones calibrated are shown to be all that meet the rule.
  const meeting: string[] = [];
  const answers = new Map<string, string>();
  for (const s of copy.list) {
    const xml = await harmonicConstants(s.source_id);
    answers.set(s.source_id, xml);
    const period = periodOf(s.source_id, xml);
    if (period && chosen(period)) meeting.push(s.source_id);
  }
  if (meeting.sort().join() !== [...GAUGES].sort().join())
    throw new Error(
      `the gauges whose constants are from a period that ends with 2020 and starts before 2011 are now ${meeting.join(" ")}; set GAUGES from that`,
    );
  for (const code of GAUGES) {
    const station = await stationOf(copy, `${SOURCE}/${code}`);
    const published = parseConstants(code, answers.get(code)!);
    tasks.push({
      station,
      published,
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
  const report: Report = {
    engine: copy.engine,
    inputs: kartverketDigest(),
    method: METHOD,
    final_year: copy.final,
    filter: FILTER,
    results: GAUGES.map((code) => results.get(`${SOURCE}/${code}`)!),
  };
  const json = JSON.stringify(report, rounded, 2) + "\n";
  const parsed = JSON.parse(json) as Report;
  complete(parsed);
  const estimate = estimateFilter(parsed.results).best;
  console.error(
    `${estimate ? `the filter that fits best is order ${estimate.order} at ${estimate.cutoff_hours} hours` : "no filter fits"}; the comparison uses order ${FILTER.order} at ${FILTER.cutoff_hours}`,
  );
  await writePair(JSON_PATH, json, REPORT_PATH, render(parsed));
  console.error(`wrote ${JSON_PATH} and ${REPORT_PATH}`);
  // The workers wait for another gauge.
  process.exit(0);
}

if (isMainThread) await main();
else work(calibrate);
