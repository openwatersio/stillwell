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
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
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
  candidatesDigest,
  checkCopy,
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
import { engineVersion, FIT_OPTIONS, fitStation, varianceExplained } from "../src/fit/fit.ts";
import { workerCount } from "../src/fit/workers.ts";
import {
  harmonicSamples,
  NODE_CORRECTIONS,
  rmsOf,
  SEASONAL,
  tidalResiduals,
} from "../src/fit/scores.ts";
import { emptyInputs, finalYear, METHOD, readSeries } from "../src/fit/series.ts";
import { fitSamples, type Verdict } from "../src/fit/window.ts";
import { listOf } from "../src/refresh.ts";
import type { StoredStation } from "../src/schema.ts";
import { errata, sourceOf } from "../src/sources/index.ts";
import { harmonicConstants } from "../src/sources/coops/index.ts";
import { connected, limitDuckDb, settled } from "../src/store/parquet.ts";
import { pool } from "../src/store/recent.ts";
import { STORE } from "../src/store/stores.ts";
import { readYears, type YearRow } from "../src/store/years.ts";
import type { Sample } from "../src/types.ts";

const SOURCE = "coops";
const JSON_PATH = "docs/results/fit-calibration.json";
const REPORT_PATH = "docs/results/fit-calibration.md";

/**
 * The reference stations: where NOAA's constants carry the years they were
 * analyzed from, chosen to cover semidiurnal, mixed and diurnal tides, ranges
 * from 0.2 m to 8 m and latitudes from 14°S to 61°N. `comment` is NOAA's own
 * note on the constants, and `years` the analysis years it names. A run stops
 * where NOAA's comment no longer reads the same, since its constants are then
 * from another analysis, and where NOAA sends another number of constituents
 * than `constituents`, 37 where not given.
 */
// prettier-ignore
const STATIONS: { id: string; why: string; years: number[]; comment: string; constituents?: number }[] = [
  { id: "1612340", why: "Mixed tide in the open Pacific at 21°N; a gauge of the nodal comparison in docs/fits.md", years: [2014, 2015, 2016, 2017, 2018], comment: "Vector Average of 5 years, 2014-2018.  Sa, Mm, and Mf from 17 years (1998-2018)." },
  { id: "1820000", why: "Semidiurnal tide on an atoll at 9°N, the lowest latitude; a gauge of the nodal comparison", years: [2014, 2015, 2016, 2017, 2018], comment: "Vector Averaged from 5 years 2014-2018.  Sa, Mm, and Mf from average of 15 years (2000-2018)" },
  { id: "1770000", why: "The only gauge south of the equator, at 14°S; NOAA's years aren't consecutive", years: [2016, 2017, 2018, 2019, 2022], comment: "Vector Averaged of 5 years (2016-2019, 2022).  MM, MF from 18 year average (2000-2022)  Sa and SSa from 20 year monthly means" },
  { id: "8410140", why: "Large semidiurnal tide at the mouth of the Bay of Fundy, M2 2.6 m", years: [2015, 2016, 2017, 2018, 2019], comment: "Vector Average of 5 years (2015-2019).  Sa and SSa from 20 year analysis." },
  { id: "8443970", why: "Semidiurnal tide, M2 1.4 m, on a record from 1921", years: [2015, 2016, 2017, 2018, 2019], comment: "Vector Average of 5 years (2015-2019).  Sa and SSa from 20 year Analysis (2000-2019)" },
  { id: "8518750", why: "Semidiurnal tide in a harbor at a river's mouth", years: [2018, 2019, 2020, 2021, 2022], comment: "Vector Average of 5 years 2018-2022.   SA and SSA from an average of 16 years 2002-2022." },
  { id: "8545240", why: "Tidal river 160 km from the sea, with large shallow-water constituents", years: [2016, 2017, 2018, 2019, 2020], comment: "Vector Average of 5 LSHQA (2016-2020). MM, SSA, Sa, MSF from average of 20 years (2001-2020)" },
  { id: "8574680", why: "Small tide at the head of an estuary, M2 0.15 m, under large weather-driven levels", years: [2017, 2018, 2019, 2020, 2021], comment: "Vector Average of 5 years (2017-2021).  Sa and SSa from average of 19 years (2001-2021). Other long period constituents are not stable." },
  { id: "8638610", why: "Semidiurnal tide at the mouth of Chesapeake Bay", years: [2015, 2016, 2017, 2018, 2019], comment: "Vector Average of 5 years LSQHA (2015-2019).  Sa and SSa from 19 vector average of 19 years (2000-2019)." },
  { id: "8665530", why: "Semidiurnal tide on the South Atlantic Bight, on a record from 1901", years: [2017, 2018, 2019, 2020, 2021], comment: "Vector Average of 5 years LSQHA (2017-2021).  Sa and SSa from average of 18 years (2001-2021)." },
  { id: "8724580", why: "Small mixed tide between the Atlantic and the Gulf of Mexico", years: [2018, 2019, 2020, 2021, 2022], comment: "Vector Average of 5 years (2018-2022).  Sa and Ssa from 20 year monthly means analysis (2002-2022),  Mf from average of 20 year annual analysis." },
  { id: "8729840", why: "Diurnal tide in the Gulf of Mexico; a gauge of the nodal comparison", years: [2018, 2019, 2020, 2021, 2022], comment: "Vector average of 5 years (2018-2022).  Sa and Ssa from 20 year monthly analysis (2002-2022)." },
  { id: "8761724", why: "Diurnal tide on the Mississippi delta; NOAA's years run to the latest", years: [2021, 2022, 2023, 2024, 2025], comment: "Vector Average of 5 years (2021-2025).  Sa and SSa from average of 16 years (2006-2025)." },
  { id: "8771450", why: "Mixed, mainly diurnal tide in a bay on the western Gulf of Mexico", years: [2021, 2022, 2023, 2024, 2025], comment: "Vector average of 5 years (2021-2025).  Ssa and Sa from 19 one-year LSQHA analyses between 2006-2025." },
  { id: "9410170", why: "Mixed tide on the Pacific coast at 33°N, on a record from 1906", years: [2017, 2018, 2019, 2020, 2021], comment: "Vector Average of 5 years (2017-2021). Sa from average of 20 years (2002-2021), other long period constituents are unstable." },
  { id: "9435380", why: "Mixed tide on the open Pacific coast at 45°N; an earlier analysis, of six years", years: [2007, 2008, 2009, 2010, 2011, 2012], comment: "Mean of six 1-year LSQHA (2007-2012).  Sa and Ssa from 20 years of MSL (1994-2013). Mf from mean of six LSQHA (2007-2012)." },
  { id: "9449880", why: "Mixed, mainly diurnal tide in the Salish Sea, K1 0.76 m", years: [2011, 2012, 2013, 2014, 2015, 2016], comment: "6 Year Vector Averaged (2011-2016).  Sa, SSa, and MF from 20 years (1997-2016)." },
  { id: "9455920", why: "The largest tide, M2 3.5 m at 61°N, with ice in winter; NOAA publishes 120 constituents", years: [2012, 2013, 2014, 2015, 2016], comment: "5-year (2012-2016) Vector Averaged.  Mm, Msf, Mf from average of 20 years (1996-2016).  Sa and SSa from 20year analysis.", constituents: 120 },
  { id: "9462620", why: "Mixed, mainly diurnal tide in the Aleutians at 54°N", years: [2020, 2021, 2022, 2023, 2024], comment: "Vector Average of 5 years (2020-2024).  Sa and Mf from mean of 18 years (2005-2024)." },
  { id: "9751639", why: "Small mixed, mainly diurnal tide in the Caribbean, K1 0.08 m", years: [2007, 2008, 2009, 2010, 2011, 2012], comment: "Average of 6 LSQHA (2007-2012).  Sa and SSa from 20 year analyses (1993-2012).  Mm and Msf are not used." },
];

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

type Reply = { result: Result } | { error: string };

const isSeasonal = (name: string) => (SEASONAL as readonly string[]).includes(name);

/** A worker fits one station at a time, as `src/fit/worker.ts` does. */
function work(): void {
  limitDuckDb({ threads: "1", memory_limit: "512MB" });
  parentPort!.on("message", async (task: Task) => {
    let reply: Reply;
    try {
      reply = { result: await calibrate(task) };
      await connected();
    } catch (error) {
      await settled();
      reply = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
    }
    parentPort!.postMessage(reply);
  });
}

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
  const previous: Report | null = existsSync(JSON_PATH)
    ? (JSON.parse(await readFile(JSON_PATH, "utf8")) as Report)
    : null;
  if (values.report) {
    if (!previous) throw new Error(`no ${JSON_PATH} to write the report from`);
    complete(previous);
    await writeFile(REPORT_PATH, render(previous));
    return;
  }

  // A station being written is refused by the reader, and its marker is dropped below, which is
  // sound only on a copy nothing is writing to, and so never on the default store of a checkout.
  if (
    !process.env.STILLWELL_STORE ||
    /^[a-z0-9]+:\/\//i.test(STORE) ||
    !existsSync(STORE) ||
    !statSync(STORE).isDirectory() ||
    resolve(STORE) === resolve("data")
  )
    throw new Error(
      `STILLWELL_STORE must name a local copy of the store, a directory other than the checkout's own \`data\`; it is ${process.env.STILLWELL_STORE ?? "not set"}`,
    );
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > STATIONS.length)
    throw new Error(`--concurrency is a whole number from 1 to ${STATIONS.length}`);
  const pinned = STATIONS;
  for (const pin of pinned)
    if (analysisYears(pin.comment).join() !== pin.years.join())
      throw new Error(`coops/${pin.id}: its years aren't the ones its comment names`);

  const source = sourceOf(SOURCE);
  const list = await listOf(STORE, source);
  const all = await readYears(STORE, SOURCE);
  if (!all) throw new Error(`${STORE} has no years file for ${SOURCE}`);
  const marked = new Set(
    [...all.values()].filter((r) => r.epoch === null || r.year === null).map((r) => r.id),
  );
  const now = new Date();
  const qcStarts = new Map(
    list.flatMap((s) =>
      s.source_qc_start ? [[s.id, Date.parse(s.source_qc_start)] as const] : [],
    ),
  );
  // A marked station votes for no year, and the store's own fits wait while any is marked. Here
  // the year is taken only where it is the same whether the marked stations' rows vote or not.
  const final = finalYear(source.metadata, all, now, qcStarts);
  const unmarked = new Map([...all].filter(([, r]) => r.epoch !== null && r.year !== null));
  if (finalYear(source.metadata, unmarked, now, qcStarts) !== final)
    throw new Error(
      `${SOURCE}'s last year of final values depends on the stations the copy marks as being written; copy the years file again once they are done`,
    );
  // The copy is fixed, so a marker on it says only that the store was being written when it was
  // copied. `checkCopy` shows each station's rows describe the files copied, marked or not, and
  // without the marker they are read as they are.
  const years = [...unmarked];
  const engine = engineVersion();

  const tasks: Task[] = [];
  for (const pin of pinned) {
    const station = list.find((s) => s.id === `${SOURCE}/${pin.id}`);
    if (!station) throw new Error(`${STORE} lists no ${SOURCE}/${pin.id}`);
    await checkCopy(STORE, station, all);
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
      marked: marked.has(station.id),
      store: STORE,
      years,
      errata: errata.map(({ check: _, ...erratum }) => erratum),
      now: now.toISOString(),
      finalYear: final,
      engine,
    });
  }

  const results = new Map<string, Result>();
  const failed: string[] = [];
  const lanes = workerCount(concurrency);
  await pool(
    Array.from({ length: lanes }, (_, i) => i),
    lanes,
    async () => {
      const worker = new Worker(new URL(import.meta.url), {
        resourceLimits: { maxOldGenerationSizeMb: 2048 },
      });
      // One set of listeners for the worker's life: whichever station it is on gets the answer.
      let answer: (reply: Reply) => void = () => {};
      let gone: string | undefined;
      const end = (why: string) => {
        gone = why;
        answer({ error: why });
      };
      worker
        .on("message", (reply: Reply) => answer(reply))
        .on("error", (error) => end(String(error)))
        .on("exit", (code) => end(`the worker exited with ${code}`));
      for (let task = tasks.shift(); task; task = tasks.shift()) {
        const id = task.station.id;
        const started = Date.now();
        const sent = task;
        // A worker that ended between stations would never answer the next one.
        const reply = await new Promise<Reply>((answered) => {
          answer = answered;
          if (gone) answered({ error: gone });
          else worker.postMessage(sent);
        });
        if ("error" in reply) {
          failed.push(`${id}: ${reply.error}`);
          console.error(`${id}: ${reply.error}`);
          break;
        }
        results.set(id, reply.result);
        console.error(`${id}: fitted in ${Math.round((Date.now() - started) / 1000)} s`);
      }
    },
  );
  // A file rewritten while the fits ran would have been read against a row that no longer describes it.
  for (const task of [...results.keys()]) {
    const station = list.find((s) => s.id === task)!;
    await checkCopy(STORE, station, all);
  }
  // A report missing a station would read as a calibration of the rest.
  if (failed.length || results.size !== STATIONS.length) {
    console.error(`${failed.length} stations failed; nothing written`);
    process.exit(1);
  }

  const report: Report = {
    engine,
    candidates: candidatesDigest(),
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
  // Both written beside their places first, so a write that fails leaves the pair as it was.
  await mkdir("docs/results", { recursive: true });
  await writeFile(`${JSON_PATH}.tmp`, json);
  await writeFile(`${REPORT_PATH}.tmp`, markdown);
  await rename(`${JSON_PATH}.tmp`, JSON_PATH);
  await rename(`${REPORT_PATH}.tmp`, REPORT_PATH);
  console.error(`wrote ${JSON_PATH} and ${REPORT_PATH}`);
  // The workers wait for another station.
  process.exit(0);
}

/** Numbers to a micrometer or a millionth of a degree, so the file doesn't carry the noise below them. */
function rounded(_: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isInteger(value)
    ? Math.round(value * 1e6) / 1e6
    : value;
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
else work();
