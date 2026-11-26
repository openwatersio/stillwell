/**
 * How closely do the store's harmonic fits reproduce NOAA's constants?
 *
 * NOAA CO-OPS publishes harmonic constants for its own gauges, analyzed from
 * the observations the store holds as `coops`, under Schureman's nodal
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
 * Usage: node scripts/calibrate-fits.ts [--concurrency n] [--report] [station...]
 *
 * `--report` rewrites the Markdown from the JSON without fitting. Stations
 * named by their CO-OPS ID are fitted again and the rest kept from the JSON.
 */
import "./threadpool.ts";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import {
  constituents as catalog,
  createTidePredictor,
  fit as engineFit,
  type FittedConstituent,
} from "@slackwater/engine";
import type { Erratum } from "../src/errata.ts";
import {
  candidateOf,
  difference,
  fittedFor,
  median,
  phaseDifference,
  vectorAverage,
  type Difference,
} from "../src/fit/calibration.ts";
import { engineVersion, fitStation, varianceExplained } from "../src/fit/fit.ts";
import { harmonicSamples, NODE_CORRECTIONS, rmsOf, tidalResiduals } from "../src/fit/scores.ts";
import { emptyInputs, finalYear, METHOD, readSeries } from "../src/fit/series.ts";
import { fitSamples, type Verdict } from "../src/fit/window.ts";
import { fetchText } from "../src/http.ts";
import { listOf } from "../src/refresh.ts";
import type { StoredStation } from "../src/schema.ts";
import { errata, sourceOf } from "../src/sources/index.ts";
import { connected, limitDuckDb, settled } from "../src/store/parquet.ts";
import { pool } from "../src/store/recent.ts";
import { STORE } from "../src/store/stores.ts";
import { readYears, type YearRow } from "../src/store/years.ts";
import type { Sample } from "../src/types.ts";

const SOURCE = "coops";
const JSON_PATH = "docs/results/fit-calibration.json";
const REPORT_PATH = "docs/results/fit-calibration.md";
const HARCON = (id: string) =>
  `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${id}/harcon.json?units=metric`;

/** NOAA publishes amplitudes to the millimeter and phases to a tenth of a degree. */
const ROUNDING = { amplitude: 0.0005, phase: 0.05 };
/**
 * Slower than this, in degrees an hour, a constituent is long-period. NOAA
 * takes those from other spans than its analysis years, or leaves them out,
 * as each station's comment says, so they are compared apart from the rest.
 */
const LONG_PERIOD = 2.5;
/** A year of NOAA's is fitted by itself where it has this share of its hours, as the yearly scatter asks. */
const YEAR_SHARE = 2 / 3;

/**
 * The reference stations: where NOAA's constants carry the years they were
 * analyzed from, chosen to cover semidiurnal, mixed and diurnal tides, ranges
 * from 0.2 m to 8 m and latitudes from 14°S to 61°N. `comment` is NOAA's own
 * note on the constants, and `years` the analysis years it names. A run stops
 * where NOAA's comment no longer reads the same, since its constants are then
 * from another analysis.
 */
// prettier-ignore
const STATIONS: { id: string; why: string; years: number[]; comment: string }[] = [
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
  { id: "9455920", why: "The largest tide, M2 3.5 m at 61°N, with ice in winter; NOAA publishes 120 constituents", years: [2012, 2013, 2014, 2015, 2016], comment: "5-year (2012-2016) Vector Averaged.  Mm, Msf, Mf from average of 20 years (1996-2016).  Sa and SSa from 20year analysis." },
  { id: "9462620", why: "Mixed, mainly diurnal tide in the Aleutians at 54°N", years: [2020, 2021, 2022, 2023, 2024], comment: "Vector Average of 5 years (2020-2024).  Sa and Mf from mean of 18 years (2005-2024)." },
  { id: "9751639", why: "Small mixed, mainly diurnal tide in the Caribbean, K1 0.08 m", years: [2007, 2008, 2009, 2010, 2011, 2012], comment: "Average of 6 LSQHA (2007-2012).  Sa and SSa from 20 year analyses (1993-2012).  Mm and Msf are not used." },
];

interface Constant {
  name: string;
  amplitude: number;
  phase: number;
}

/** A fit's side of one row: its constant and the difference from NOAA's, or why it has none. */
type Side =
  | { reason: string }
  | {
      /** The name the fit holds the line under, where it isn't NOAA's. */
      as: string | null;
      amplitude: number;
      phase: number;
      amplitude_ci: number | null;
      phase_ci: number | null;
      snr: number | null;
      d: Difference;
    };

interface Row {
  /** NOAA's name. */
  name: string;
  /** The candidate it means. */
  candidate: string;
  speed: number;
  noaa: { amplitude: number; phase: number };
  window: Side;
  standard: Side;
  /** The steps from NOAA's method to the store's, each with how far its constant is from NOAA's, in meters. */
  steps: Record<Step, { amplitude: number; phase: number; vector: number } | null>;
}

/**
 * The steps between NOAA's method and the store's, each changing one thing
 * from the one before, all with NOAA's own constituents and no others:
 *
 * - `yearly`: NOAA's method. A plain fit of each year by itself, the argument
 *   taken at the year's start and f and u at mid-year, and the vector average
 *   of the years (Parker 2007, pp. 41 and 94).
 * - `exact`: the same, with f, u and the argument at each sample.
 * - `joint`: one fit of all the years together.
 * - `robust`: the same, with robust weights.
 *
 * The store's fit of NOAA's years is the step after `robust`: it takes the
 * candidate list and the selection among it in place of NOAA's constituents.
 */
const STEPS = ["yearly", "exact", "joint", "robust"] as const;
type Step = (typeof STEPS)[number];

interface Score {
  /** Share of the tidal band's variance explained on the held-out year. */
  variance: number | null;
  /** Tidal-band RMS on the held-out year, in meters. */
  rms: number | null;
  /** Whether the constants were fitted from years that include the held-out one. */
  seen: boolean;
}

interface Result {
  id: string;
  name: string;
  latitude: number;
  why: string;
  comment: string;
  years: number[];
  /** Whether the copy of the years file marked the station as being written. */
  marked: boolean;
  /** NOAA's constituents the candidate list doesn't have, which aren't compared. */
  unlisted: string[];
  /** Those of them the engine's catalog doesn't have either, which no fit or prediction here holds. */
  unknown: string[];
  held_out: number;
  scores: { standard: Score; window: Score; noaa: Score; steps: Record<Step, Score> };
  standard: { since: string; until: string; hours: number; kept: number };
  window: { hours: number; by_year: Record<string, number>; kept: number };
  /** The years of NOAA's fitted by themselves. */
  yearly: number[];
  rows: Row[];
}

interface Report {
  engine: string;
  method: number;
  node_corrections: string;
  final_year: number;
  results: Result[];
}

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

const yearSpan = (y: number) => ({ start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) });

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
    })),
  };

  const byYear = new Map<number, Sample[]>();
  for (const y of pinned.years) byYear.set(y, await read(yearSpan(y)));
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
  const averaged = (nodal: "yearly" | "exact") => {
    const fits = whole.map(
      ([, rows]) => engineFit(harmonicSamples(rows), names, { ...plain, nodal }).constituents,
    );
    return names.flatMap((name) => {
      const average = vectorAverage(fits.flatMap((f) => f.filter((c) => c.name === name)));
      return average ? [{ name, ...average }] : [];
    });
  };
  const together = harmonicSamples(whole.flatMap(([, rows]) => rows));
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

  const held = await read(yearSpan(fit.held_out));
  const score = (constants: Constant[], seen: boolean): Score => ({
    variance: varianceExplained(constants, held),
    rms: rmsOf(tidalResiduals(constants, held)).rms,
    seen,
  });
  const seen = pinned.years.includes(fit.held_out);
  return {
    id: station.id,
    name: station.name,
    latitude: station.lat,
    why: pinned.why,
    comment: pinned.comment,
    years: pinned.years,
    marked: task.marked,
    unlisted: noaa.filter((c) => !candidateOf(c.name)).map((c) => c.name),
    unknown: noaa.filter((c) => !candidateOf(c.name) && !catalog[c.name]).map((c) => c.name),
    held_out: fit.held_out,
    scores: {
      standard: score(standard.constituents, false),
      window: score(window.constituents, seen),
      // A name the candidate list doesn't have goes to the predictor as NOAA spells it.
      noaa: score(
        noaa.map((c) => ({ ...c, name: candidateOf(c.name)?.name ?? c.name })),
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
    yearly: whole.map(([y]) => y),
    rows,
  };
}

/** NOAA's constants for a station, in meters and Greenwich phase lags in UTC, with the comment on them. */
async function harcon(id: string): Promise<{ comment: string; constants: Constant[] }> {
  const body = JSON.parse(await fetchText(HARCON(id))) as {
    units?: string;
    HarmonicConstituents?: {
      name: string;
      amplitude: number;
      phase_GMT: number;
      comments?: string;
    }[];
  };
  const list = body.HarmonicConstituents;
  if (body.units !== "meters" || !list?.length)
    throw new Error(`coops/${id}: NOAA's constants didn't come back in meters`);
  const comments = new Set(list.map((c) => c.comments ?? ""));
  if (comments.size !== 1)
    throw new Error(`coops/${id}: NOAA's constants carry ${comments.size} different comments`);
  const constants = list.map((c) => ({ name: c.name, amplitude: c.amplitude, phase: c.phase_GMT }));
  if (constants.some((c) => !Number.isFinite(c.amplitude) || !Number.isFinite(c.phase)))
    throw new Error(`coops/${id}: NOAA's constants hold a value that isn't a number`);
  return { comment: [...comments][0]!, constants };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { concurrency: { type: "string", default: "4" }, report: { type: "boolean" } },
    allowPositionals: true,
  });
  const previous: Report | null = existsSync(JSON_PATH)
    ? (JSON.parse(await readFile(JSON_PATH, "utf8")) as Report)
    : null;
  if (values.report) {
    if (!previous) throw new Error(`no ${JSON_PATH} to write the report from`);
    await writeFile(REPORT_PATH, render(previous));
    return;
  }

  // A station being written is refused by the reader, and its marker is dropped below, which is
  // only sound on a copy nothing is writing to.
  if (/^[a-z0-9]+:\/\//i.test(STORE) || !existsSync(STORE) || !statSync(STORE).isDirectory())
    throw new Error(
      `STILLWELL_STORE must be a local copy of the store, a directory; it is ${STORE}`,
    );
  const unknown = positionals.filter((id) => !STATIONS.some((s) => s.id === id));
  if (unknown.length) throw new Error(`not a calibration station: ${unknown.join(", ")}`);
  const pinned = STATIONS.filter((s) => !positionals.length || positionals.includes(s.id));

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
  const final = finalYear(source.metadata, all, now, qcStarts);
  // The copy is fixed, so a marker on it says only that the store was being written when it was
  // copied. Without the marker the station's rows are read as they were copied.
  const years = [...all].filter(([, r]) => r.epoch !== null && r.year !== null);
  const engine = engineVersion();
  if (previous && positionals.length && (previous.engine !== engine || previous.method !== METHOD))
    throw new Error(`${JSON_PATH} is from another engine or method; fit every station again`);

  const tasks: Task[] = [];
  for (const pin of pinned) {
    const station = list.find((s) => s.id === `${SOURCE}/${pin.id}`);
    if (!station) throw new Error(`${STORE} lists no ${SOURCE}/${pin.id}`);
    const { comment, constants } = await harcon(pin.id);
    if (comment !== pin.comment)
      throw new Error(
        `${station.id}: NOAA's comment on its constants now reads "${comment}"; set its years from that`,
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
  const concurrency = Math.max(1, Math.floor(Number(values.concurrency)) || 1);
  await pool(
    Array.from({ length: Math.min(concurrency, tasks.length) }, (_, i) => i),
    concurrency,
    async () => {
      const worker = new Worker(new URL(import.meta.url), {
        resourceLimits: { maxOldGenerationSizeMb: 2048 },
      });
      // One set of listeners for the worker's life: whichever station it is on gets the answer.
      let answer: (reply: Reply) => void = () => {};
      worker
        .on("message", (reply: Reply) => answer(reply))
        .on("error", (error) => answer({ error: String(error) }))
        .on("exit", (code) => answer({ error: `the worker exited with ${code}` }));
      for (let task = tasks.shift(); task; task = tasks.shift()) {
        const id = task.station.id;
        const started = Date.now();
        const sent = task;
        const reply = await new Promise<Reply>((resolve) => {
          answer = resolve;
          worker.postMessage(sent);
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
  // A report missing a station would read as a calibration of the rest.
  if (failed.length) {
    console.error(`${failed.length} stations failed; nothing written`);
    process.exit(1);
  }

  const kept = new Map((previous?.results ?? []).map((r) => [r.id, r]));
  const report: Report = {
    engine,
    method: METHOD,
    node_corrections: NODE_CORRECTIONS,
    final_year: final,
    results: STATIONS.flatMap((s) => {
      const id = `${SOURCE}/${s.id}`;
      const result = results.get(id) ?? kept.get(id);
      return result ? [result] : [];
    }),
  };
  await mkdir("docs/results", { recursive: true });
  await writeFile(JSON_PATH, JSON.stringify(report, rounded, 2) + "\n");
  await writeFile(REPORT_PATH, render(JSON.parse(JSON.stringify(report, rounded)) as Report));
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

// The report.

const mm = (m: number | null | undefined, digits = 1) =>
  m === null || m === undefined ? "" : (m * 1000).toFixed(digits);
const signed = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined
    ? ""
    : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;
const percent = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined ? "" : (x * 100).toFixed(digits);
const ratio = (x: number | null) =>
  x === null ? "" : x > 1 ? `**${x.toFixed(1)}**` : x.toFixed(1);
const table = (head: string[], rows: string[][], left = 1) =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map((_, i) => (i < left ? "---" : "---:")).join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

/** How far apart two constants are as vectors, in meters. */
const apart = (a: { amplitude: number; phase: number }, b: { amplitude: number; phase: number }) =>
  difference({ name: "", ...a }, { name: "", ...b }, ROUNDING).vector;
const fittedSide = (s: Side) => ("reason" in s ? null : s);
const isLong = (r: Row) => r.speed < LONG_PERIOD;
/** The form number, (K1 + O1) / (M2 + S2), from NOAA's constants, and the name of the tide it gives. */
function form(result: Result): { f: number; kind: string } {
  const a = (name: string) => result.rows.find((r) => r.name === name)?.noaa.amplitude ?? 0;
  const f = (a("K1") + a("O1")) / (a("M2") + a("S2"));
  const kind =
    f < 0.25
      ? "semidiurnal"
      : f < 1.5
        ? "mixed, mainly semidiurnal"
        : f < 3
          ? "mixed, mainly diurnal"
          : "diurnal";
  return { f, kind };
}

type Which = "window" | "standard";

/** Every compared pair of one fit: rows where both NOAA and the fit have a constant. */
function pairs(results: Result[], which: Which, long: boolean) {
  return results.flatMap((result) =>
    result.rows.flatMap((row) => {
      const s = fittedSide(row[which]);
      return s && isLong(row) === long ? [{ result, row, s }] : [];
    }),
  );
}

function render(report: Report): string {
  const { results } = report;
  const out: string[] = [];
  const p = (...lines: string[]) => out.push(...lines, "");
  const MAJOR = ["M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1"];

  const stats = (which: Which) => {
    const short = pairs(results, which, false);
    const outside = short.filter((x) => (x.s.d.ratio ?? 0) > 1);
    const major = short.filter((x) => MAJOR.includes(x.row.name) && x.row.noaa.amplitude >= 0.01);
    const abs = (xs: (number | null)[]) => xs.flatMap((x) => (x === null ? [] : [Math.abs(x)]));
    return {
      compared: short.length,
      outside: outside.length,
      apart: outside.filter((x) => x.s.d.vector > 0.001).length,
      major: major.length,
      majorRelative: abs(major.map((x) => x.s.d.relative)),
      majorPhase: abs(major.map((x) => x.s.d.phase)),
      majorOutside: major.filter((x) => (x.s.d.ratio ?? 0) > 1).length,
      vector: short.map((x) => x.s.d.vector),
    };
  };
  const w = stats("window");
  const s = stats("standard");
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  const share = (n: number, of: number) => `${n} of ${of} (${((100 * n) / of).toFixed(1)}%)`;

  p("# Calibration of the harmonic fits against NOAA's constants");
  p(
    `NOAA CO-OPS publishes harmonic constants for its own gauges, analyzed from the observations the store holds as \`coops\`, under Schureman's nodal corrections, which the [fits](../fits.md) use too. This report fits ${results.length} of those gauges from the store and compares the constants with NOAA's, constituent by constituent. It is written by [\`scripts/calibrate-fits.ts\`](../../scripts/calibrate-fits.ts) (\`npm run calibrate:fits\`), with every number in [fit-calibration.json](fit-calibration.json), and is run again whenever the method changes. [Checks](../contributing/checks.md#fit-calibration) says how to run it.`,
  );
  p(
    `These fits ran with ${report.engine}, method ${report.method} of [\`src/fit/\`](../../src/fit/), ${report.node_corrections === "schureman" ? "Schureman's" : report.node_corrections} nodal corrections, and ${report.final_year} as the source's last year of final values.`,
  );

  p("## What is compared");
  p(
    "NOAA's constants are from the CO-OPS metadata API (`/mdapi/prod/webapi/stations/<id>/harcon.json?units=metric`), which gives amplitudes in meters, to the millimeter, and Greenwich phase lags in UTC (`phase_GMT`), to a tenth of a degree. Each station's constants carry a comment naming the years they were analyzed from, which is the harmonic analysis period and not the station's tidal datum epoch. NOAA fits each year by itself by least squares, with the equilibrium argument taken at the start of the year and the node factors at mid-year, and publishes the vector average of the years ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 41 and 94). Its long-period constituents come from other spans, or are left out, as each comment says.",
  );
  p("Three fits of the store's hourly final values are compared with them:");
  p(
    "- **NOAA's years.** The store's method, [`fitSamples`](../../src/fit/window.ts), over the years NOAA analyzed. The data are the same, so the differences are the method's: one fit over all the years with node factors at each sample, robust weights, and a larger set of constituents.",
    "- **Standard.** The fit the store publishes, `fitStation`: the 19 years before the held-out year. Its differences also hold whatever the tide has changed by between the two periods.",
    "- **NOAA's method.** Each of NOAA's years fitted by itself, without robust weights, with NOAA's constituents and the node factors at mid-year, and the years vector averaged. It is a diagnostic: where it agrees with NOAA and the store's method doesn't, the method is the cause and not the data.",
  );
  p(
    `A constituent is **outside** where its amplitude or phase differs from NOAA's by more than the fit's 95% interval, widened in quadrature by half of NOAA's last digit (${mm(ROUNDING.amplitude)} mm and ${ROUNDING.phase}°). NOAA publishes no intervals, so the test has only the fit's. The ratio in the tables is the difference over that widened half-width, the larger of amplitude's and phase's. The vector difference is the length of the difference of the two constants as vectors, which is the amplitude of the curve the two would predict apart. Constituents slower than ${LONG_PERIOD}° an hour are counted apart, since NOAA's are from other years.`,
  );

  p("## Summary");
  p(
    table(
      ["", "NOAA's years", "Standard, 19 years"],
      [
        ["Constituents compared", String(w.compared), String(s.compared)],
        ["Outside the fit's interval", share(w.outside, w.compared), share(s.outside, s.compared)],
        ["Outside and over 1 mm apart", String(w.apart), String(s.apart)],
        [
          "Median vector difference",
          `${mm(median(w.vector), 2)} mm`,
          `${mm(median(s.vector), 2)} mm`,
        ],
        [
          "Major constituents of 1 cm or more",
          `${w.major}, ${w.majorOutside} outside`,
          `${s.major}, ${s.majorOutside} outside`,
        ],
        [
          "Their amplitude difference, median and largest",
          `${percent(median(w.majorRelative), 2)}% and ${percent(max(w.majorRelative), 2)}%`,
          `${percent(median(s.majorRelative), 2)}% and ${percent(max(s.majorRelative), 2)}%`,
        ],
        [
          "Their phase difference, median and largest",
          `${median(w.majorPhase)?.toFixed(2)}° and ${max(w.majorPhase)?.toFixed(2)}°`,
          `${median(s.majorPhase)?.toFixed(2)}° and ${max(s.majorPhase)?.toFixed(2)}°`,
        ],
      ],
    ),
  );
  p(
    `The major constituents are ${MAJOR.join(", ")}. Long-period constituents are left out of these counts and are in each station's table.`,
  );
  p(findings(report, w, s));

  p("## Stations");
  p(
    table(
      ["Station", "Name", "Latitude", "Tide", "M2 (m)", "K1 (m)", "NOAA's years", "Why it is here"],
      results.map((r) => {
        const { f, kind } = form(r);
        const a = (name: string) =>
          r.rows.find((x) => x.name === name)?.noaa.amplitude.toFixed(3) ?? "";
        return [
          `\`${r.id}\``,
          r.name,
          `${Math.abs(r.latitude).toFixed(1)}°${r.latitude < 0 ? "S" : "N"}`,
          `${kind} (${f.toFixed(2)})`,
          a("M2"),
          a("K1"),
          spans(r.years),
          r.why,
        ];
      }),
      2,
    ),
  );
  p(
    "The tide is named from the form number, (K1 + O1) / (M2 + S2) of NOAA's amplitudes, in brackets: under 0.25 semidiurnal, to 1.5 mixed and mainly semidiurnal, to 3 mixed and mainly diurnal, and diurnal above.",
  );
  const marked = results.filter((r) => r.marked);
  if (marked.length)
    p(
      `The copy of the store these fits read marked ${marked.map((r) => `\`${r.id}\``).join(", ")} as being written, which the fit's reader refuses. The script drops that marker, since nothing writes to a copy, and reads those stations' files as they were copied.`,
    );

  p("## Variance explained");
  p(
    "The share of the tidal band's variance each set of constants explains on the standard fit's held-out year, and the tidal-band RMS of what is left, both after the Godin filter ([Scores](../fits.md#scores)). NOAA's constants are predicted with the same predictor and Schureman's corrections. A figure in brackets is from constants whose analysis read the held-out year.",
  );
  const scored = (x: Score, f: (x: Score) => string) => (x.seen ? `(${f(x)})` : f(x));
  p(
    table(
      [
        "Station",
        "Held-out year",
        "Standard",
        "NOAA's years",
        "NOAA's constants",
        "Standard RMS (mm)",
        "NOAA's years RMS (mm)",
        "NOAA's constants RMS (mm)",
      ],
      results.map((r) => [
        `\`${r.id}\` ${r.name}`,
        String(r.held_out),
        ...(["standard", "window", "noaa"] as const).map((k) =>
          scored(r.scores[k], (x) => `${percent(x.variance, 2)}%`),
        ),
        ...(["standard", "window", "noaa"] as const).map((k) =>
          scored(r.scores[k], (x) => mm(x.rms)),
        ),
      ]),
    ),
  );

  p("## Constituents across stations");
  p(
    "For each of NOAA's constituents, over the stations where NOAA's amplitude is above zero and the fit kept the constituent: the median differences from NOAA's, without sign, and how many are outside the fit's interval. The last two columns are the standard fit against the store's own fit of NOAA's years, which is what the two periods differ by under one method, and NOAA's method on the store's values against NOAA's constants.",
  );
  const names = [...new Set(results.flatMap((r) => r.rows.map((x) => x.name)))];
  const order = new Map(names.map((n) => [n, candidateOf(n)!.speed]));
  names.sort((a, b) => order.get(a)! - order.get(b)!);
  const line = (name: string): string[] | null => {
    const of = (which: Which) =>
      results.flatMap((r) => {
        const row = r.rows.find((x) => x.name === name);
        const side = row && fittedSide(row[which]);
        return row && side && row.noaa.amplitude > 0 ? [{ row, side }] : [];
      });
    const [a, b] = [of("window"), of("standard")];
    if (!a.length && !b.length) return null;
    const yearly = results.flatMap((r) => {
      const row = r.rows.find((x) => x.name === name);
      return row?.steps.yearly && row.noaa.amplitude > 0 ? [row.steps.yearly.vector] : [];
    });
    const med = (xs: (number | null)[], f: (x: number | null) => string) =>
      f(median(xs.flatMap((x) => (x === null ? [] : [Math.abs(x)]))));
    const as = [...new Set(a.flatMap((x) => (x.side.as ? [x.side.as] : [])))];
    const moved = results.flatMap((r) => {
      const row = r.rows.find((x) => x.name === name);
      const [x, y] = [row && fittedSide(row.window), row && fittedSide(row.standard)];
      return x && y ? [apart(y, x)] : [];
    });
    return [
      as.length ? `${name} (as ${as.join(", ")})` : name,
      String(a.length),
      med(
        a.map((x) => x.side.d.amplitude),
        (x) => mm(x, 2),
      ),
      med(
        a.map((x) => x.side.d.relative),
        (x) => percent(x),
      ),
      med(
        a.map((x) => x.side.d.phase),
        (x) => x?.toFixed(2) ?? "",
      ),
      med(
        a.map((x) => x.side.d.vector),
        (x) => mm(x, 2),
      ),
      String(a.filter((x) => (x.side.d.ratio ?? 0) > 1).length),
      String(b.length),
      med(
        b.map((x) => x.side.d.vector),
        (x) => mm(x, 2),
      ),
      String(b.filter((x) => (x.side.d.ratio ?? 0) > 1).length),
      mm(median(moved), 2),
      mm(median(yearly), 2),
    ];
  };
  p(
    table(
      [
        "Constituent",
        "NOAA's years: stations",
        "Amplitude (mm)",
        "Amplitude (%)",
        "Phase (°)",
        "Vector (mm)",
        "Outside",
        "Standard: stations",
        "Vector (mm)",
        "Outside",
        "Standard against NOAA's years: vector (mm)",
        "NOAA's method: vector (mm)",
      ],
      names.flatMap((n) => {
        const l = line(n);
        return l ? [l] : [];
      }),
    ),
  );

  p("## Where the differences come from");
  p(
    "The store's fit of NOAA's years differs from NOAA's method in four ways, taken here one at a time on the store's values, the first three with NOAA's own constituents. Each of the four middle columns is how far that step moves the constant from the step before, as the median vector difference over the stations where NOAA's amplitude is above zero. The first column is where the chain starts: NOAA's method against NOAA's constants, which is what the data and NOAA's rounding leave. The last is where it ends.",
  );
  p(
    table(
      [
        "Constituent",
        "Stations",
        "NOAA's method against NOAA (mm)",
        "Node factors at each sample (mm)",
        "One fit of all years (mm)",
        "Robust weights (mm)",
        "The store's constituents (mm)",
        "The store's fit against NOAA (mm)",
      ],
      names.flatMap((name) => {
        const chains = results.flatMap((r) => {
          const row = r.rows.find((x) => x.name === name);
          const side = row && fittedSide(row.window);
          const t = row?.steps;
          return row &&
            side &&
            row.noaa.amplitude > 0 &&
            t?.yearly &&
            t.exact &&
            t.joint &&
            t.robust
            ? [
                [
                  t.yearly.vector,
                  apart(t.exact, t.yearly),
                  apart(t.joint, t.exact),
                  apart(t.robust, t.joint),
                  apart(side, t.robust),
                  side.d.vector,
                ],
              ]
            : [];
        });
        return chains.length
          ? [
              [
                name,
                String(chains.length),
                ...chains[0]!.map((_, i) => mm(median(chains.map((c) => c[i]!)), 2)),
              ],
            ]
          : [];
      }),
    ),
  );
  p(
    "The same steps scored on the held-out year: the tidal-band RMS of observed minus predicted, in millimeters, for the constants each step gives. The steps before the last hold every constituent NOAA publishes for the station that the engine's catalog has, and the last two columns hold the candidate list's. A figure in brackets is from constants fitted from years that include the held-out one.",
  );
  p(
    table(
      [
        "Station",
        "NOAA's constants",
        "NOAA's method",
        "Node factors at each sample",
        "One fit of all years",
        "Robust weights",
        "The store's constituents",
        "Standard, 19 years",
      ],
      results.map((r) => [
        `\`${r.id}\` ${r.name}`,
        scored(r.scores.noaa, (x) => mm(x.rms)),
        ...STEPS.map((k) => scored(r.scores.steps[k], (x) => mm(x.rms))),
        scored(r.scores.window, (x) => mm(x.rms)),
        scored(r.scores.standard, (x) => mm(x.rms)),
      ]),
    ),
  );

  const unseen = results.filter((r) => !r.scores.window.seen);
  const chain = (r: Result) => [...STEPS.map((k) => r.scores.steps[k].rms!), r.scores.window.rms!];
  const tally = (i: number) => {
    const xs = unseen.map((r) => chain(r)[i]! - chain(r)[i - 1]!);
    const [lower, higher] = [xs.filter((x) => x <= -0.0001), xs.filter((x) => x >= 0.0001)];
    return `lower at ${lower.length} and higher at ${higher.length}, from ${signed(Math.min(...xs) * 1000)} to ${signed(Math.max(...xs) * 1000)} mm`;
  };
  p(
    `From each step to the next, over the ${unseen.length} stations whose NOAA years don't include the held-out one, the RMS is: with node factors at each sample, ${tally(1)}; with one fit of all years, ${tally(2)}; with robust weights, ${tally(3)}; and with the store's constituents, ${tally(4)}. A change under 0.1 mm counts as neither.`,
  );

  p("## Each station");
  p(
    "NOAA's constants, then each fit's difference from them, the fit's minus NOAA's. ±A and ±g are the half-widths of the fit's 95% intervals. A ratio in bold is outside the interval. Where a fit holds a line under another name, the name is in brackets. A fit without the constituent says why: `snr` is under the signal-to-noise limit, `rayleigh` names the constituent the record can't separate it from, and `seasonal` is Sa or Ssa under twice the standard error of its yearly fits.",
  );
  for (const r of results) {
    p(`### ${r.name} (\`${r.id}\`)`);
    const short = Object.entries(r.window.by_year).filter(
      ([y, n]) => n < (YEAR_SHARE * (yearSpan(+y).end - yearSpan(+y).start)) / 3_600_000,
    );
    p(
      [
        `NOAA: "${r.comment.replace(/\s+/g, " ").trim()}"`,
        `NOAA's years, ${spans(r.years)}: ${r.window.hours.toLocaleString("en-US")} hourly values, ${r.window.kept} constituents kept.`,
        `Standard, ${r.standard.since.slice(0, 4)} to ${+r.standard.until.slice(0, 4) - 1}: ${r.standard.hours.toLocaleString("en-US")} hourly values, ${r.standard.kept} kept.`,
        short.length
          ? `NOAA's method leaves out ${short.map(([y]) => y).join(", ")}, which the store holds under two thirds of.`
          : "",
        r.unlisted.length
          ? `NOAA also publishes ${r.unlisted.length} constituents the candidate list doesn't have, which aren't compared.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    const cells = (side: Side, full: boolean): string[] => {
      const s = fittedSide(side);
      if (!s) return [(side as { reason: string }).reason, ...Array(full ? 6 : 3).fill("")];
      const d = s.d;
      return full
        ? [
            signed(d.amplitude * 1000, 1) + (s.as ? ` (${s.as})` : ""),
            signed(d.relative === null ? null : d.relative * 100, 1),
            signed(d.phase, 1),
            mm(d.vector),
            mm(s.amplitude_ci),
            s.phase_ci === null ? "" : s.phase_ci.toFixed(1),
            ratio(d.ratio),
          ]
        : [
            signed(d.amplitude * 1000, 1) + (s.as ? ` (${s.as})` : ""),
            signed(d.phase, 1),
            mm(d.vector),
            ratio(d.ratio),
          ];
    };
    p(
      table(
        [
          "Constituent",
          "NOAA A (mm)",
          "NOAA g (°)",
          "NOAA's years: ΔA (mm)",
          "ΔA (%)",
          "Δg (°)",
          "Vector (mm)",
          "±A (mm)",
          "±g (°)",
          "Ratio",
          "Standard: ΔA (mm)",
          "Δg (°)",
          "Vector (mm)",
          "Ratio",
          "NOAA's method: vector (mm)",
        ],
        [...r.rows]
          .sort((a, b) => a.speed - b.speed)
          .map((row) => [
            row.name,
            mm(row.noaa.amplitude, 0),
            row.noaa.phase.toFixed(1),
            ...cells(row.window, true),
            ...cells(row.standard, false),
            mm(row.steps.yearly?.vector),
          ]),
      ),
    );
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

/** Years as spans: 2016–2019, 2022. */
function spans(years: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < years.length;) {
    let j = i;
    while (years[j + 1] === years[j]! + 1) j++;
    out.push(i === j ? String(years[i]) : `${years[i]}–${years[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

/**
 * What a constituent with constant node factors picks up from a neighbor a
 * cycle or two a year away, when a year is fitted with the neighbor's node
 * factors held at mid-year: the amplitude left in each of `into` by a tide of
 * `from` alone, of 1 m, as the smallest and largest over the years 2006 to
 * 2024. It is NOAA's method on a synthetic tide, so it says how much of a
 * difference from NOAA's S1, P1 and R2 that method accounts for.
 */
function leak(from: string, into: string[]): Record<string, [number, number]> {
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
      nodal: "yearly",
    }).constituents;
    for (const name of into) found[name]!.push(fitted.find((c) => c.name === name)!.amplitude);
  }
  return Object.fromEntries(
    into.map((name) => [name, [Math.min(...found[name]!), Math.max(...found[name]!)]]),
  );
}

type Stats = { compared: number; outside: number; major: number; majorOutside: number };

/**
 * What the comparison shows and why each difference is there. Every number
 * is computed from the results; the reasons are what looking into them
 * found, and each names the table that shows it.
 */
function findings(report: Report, w: Stats, s: Stats): string {
  const { results } = report;
  const MAJOR = ["M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1"];
  const abs = (xs: (number | null)[]) => xs.flatMap((x) => (x === null ? [] : [Math.abs(x)]));
  const max = (xs: number[]) => Math.max(...xs);
  const n = (count: number, one: string, many = `${one}s`) =>
    `${count} ${count === 1 ? one : many}`;

  // NOAA's method on the store's values against NOAA's constants.
  const short = results.flatMap((r) =>
    r.rows.flatMap((row) =>
      !isLong(row) && row.noaa.amplitude > 0 && row.steps.yearly
        ? [{ r, row, step: row.steps.yearly }]
        : [],
    ),
  );
  const within = (limit: number) => short.filter((x) => x.step.vector <= limit).length;
  const over = short.filter((x) => x.step.vector > 0.001);
  const overBy = new Map<string, number>();
  for (const x of over) overBy.set(x.r.name, (overBy.get(x.r.name) ?? 0) + 1);
  const worst = [...overBy].sort((a, b) => b[1] - a[1]);
  const majors = short.filter((x) => MAJOR.includes(x.row.name) && x.row.noaa.amplitude >= 0.01);
  const relative = abs(
    majors.map((x) => (x.step.amplitude - x.row.noaa.amplitude) / x.row.noaa.amplitude),
  );
  const phase = abs(majors.map((x) => phaseDifference(x.step.phase, x.row.noaa.phase)));

  // Held-out scores, where the constants didn't read the held-out year.
  const unseen = results.filter((r) => !r.scores.window.seen);
  const chain = (r: Result) => [...STEPS.map((k) => r.scores.steps[k].rms!), r.scores.window.rms!];
  const change = (i: number) => unseen.map((r) => chain(r)[i]! - chain(r)[i - 1]!);
  const tally = (xs: number[]) => {
    const [lower, higher] = [xs.filter((x) => x <= -0.0001), xs.filter((x) => x >= 0.0001)];
    return `lower at ${lower.length} and higher at ${higher.length} of ${xs.length}, from ${signed(Math.min(...xs) * 1000)} to ${signed(max(xs) * 1000)} mm`;
  };
  const versus = (a: (r: Result) => Score, b: (r: Result) => Score) =>
    unseen.filter((r) => a(r).rms! < b(r).rms!).length;
  const reproduces = max(
    unseen.map((r) => Math.abs(r.scores.steps.yearly.rms! - r.scores.noaa.rms!)),
  );

  // Robust weights.
  const raised = (name: string) => {
    const changes = results.flatMap((r) => {
      const t = r.rows.find((x) => x.name === name)?.steps;
      return t?.robust && t.joint && t.joint.amplitude > 0
        ? [(t.robust.amplitude - t.joint.amplitude) / t.joint.amplitude]
        : [];
    });
    return `${name} at ${changes.filter((x) => x > 0).length} of ${changes.length} (median ${signed(median(changes)! * 100, 2)}%)`;
  };
  const m2 = results
    .map((r) => {
      const t = r.rows.find((x) => x.name === "M2")!.steps;
      return {
        r,
        moved: apart(t.robust!, t.joint!),
        noaa: r.rows.find((x) => x.name === "M2")!.noaa,
      };
    })
    .sort((a, b) => b.moved - a.moved);

  // Constituents most often outside in the fit of NOAA's years.
  const outside = new Map<string, number>();
  for (const x of pairs(results, "window", false))
    if ((x.s.d.ratio ?? 0) > 1) outside.set(x.row.name, (outside.get(x.row.name) ?? 0) + 1);
  const often = [...outside].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const count = (name: string) => outside.get(name) ?? 0;
  const stations = (name: string) =>
    results.filter((r) => r.rows.some((x) => x.name === name && fittedSide(x.window))).length;

  /** Of the constants of `name` outside the interval, how many have step `i` as the largest of the four. */
  const largest = (name: string, i: number) => {
    const sizes = results.flatMap((r) => {
      const row = r.rows.find((x) => x.name === name);
      const side = row && fittedSide(row.window);
      const t = row?.steps;
      return side && (side.d.ratio ?? 0) > 1 && t?.yearly && t.exact && t.joint && t.robust
        ? [
            [
              apart(t.exact, t.yearly),
              apart(t.joint, t.exact),
              apart(t.robust, t.joint),
              apart(side, t.robust),
            ],
          ]
        : [];
    });
    return `${sizes.filter((x) => x[i] === Math.max(...x)).length} of ${name}'s ${sizes.length} outside`;
  };
  const moved = (name: string) =>
    results.flatMap((r) => {
      const row = r.rows.find((x) => x.name === name);
      const [x, y] = [row && fittedSide(row.window), row && fittedSide(row.standard)];
      return x && y ? [apart(y, x)] : [];
    });
  const k1 = leak("K1", ["S1", "P1"]);
  const k2 = leak("K2", ["R2"]);
  const perMeter = ([low, high]: [number, number]) => `${mm(low, 1)} to ${mm(high, 1)} mm`;

  const better = versus(
    (r) => r.scores.standard,
    (r) => r.scores.noaa,
  );
  const behind = unseen.filter((r) => r.scores.standard.rms! >= r.scores.noaa.rms!);
  const variances = results.map((r) => r.scores.standard.variance!);
  const lowest = results.reduce((a, b) =>
    a.scores.standard.variance! < b.scores.standard.variance! ? a : b,
  );
  const anchorage = results.find((r) => r.unlisted.length > 0);

  const lines: string[] = [];
  const p = (...x: string[]) => lines.push(...x, "");
  p("### What agrees");
  p(
    `- **NOAA's method on the store's values gives NOAA's constants.** Fitted NOAA's way, ${within(0.0005)} of ${short.length} short-period constants are within 0.5 mm of NOAA's as vectors, which is half of NOAA's last digit, and ${within(0.001)} are within 1 mm. The major constituents of 1 cm or more differ by a median of ${percent(median(relative), 2)}% in amplitude and ${median(phase)!.toFixed(2)}° in phase, and at most by ${percent(max(relative), 2)}% and ${max(phase).toFixed(2)}°. Those constants predict the held-out year within ${mm(reproduces)} mm RMS of NOAA's own at every station. The store's hourly values, Schureman's corrections as the engine has them, and Greenwich phase lags in UTC are therefore the ones NOAA's constants were made with.`,
    `- **The store's method over NOAA's years is close to NOAA on the major constituents.** Their amplitudes differ by a median of ${percent(median(pairsOf(results, "window", MAJOR).relative), 2)}% and their phases by ${median(pairsOf(results, "window", MAJOR).phase)!.toFixed(2)}°. ${w.majorOutside} of ${w.major} are outside the fit's interval, for the reasons below.`,
    `- **The standard fit predicts the held-out year better than NOAA's constants at ${better} of ${unseen.length} stations** whose NOAA analysis didn't read that year${behind.length ? `; the rest: ${behind.map((r) => r.name).join(", ")}` : ""}. It explains ${percent(Math.min(...variances), 1)}% to ${percent(max(variances), 1)}% of the tidal band's variance, the least at ${lowest.name}.`,
  );
  p("### What differs, and why");
  p(
    `In the fit of NOAA's years, ${w.outside} of ${w.compared} short-period constants are outside the fit's interval. The constituents most often outside are ${often.map(([name, c]) => `${name} (${c})`).join(", ")}. [Where the differences come from](#where-the-differences-come-from) takes the method apart one step at a time, and these are what it shows:`,
  );
  p(
    `- **Robust weights move the largest constituents most.** They are the largest step for M2, and they raise amplitudes more often than they lower them: ${["M2", "S2", "O1", "M4"].map(raised).join(", ")}, against the same fit without them. M2 moves most at ${m2
      .slice(0, 3)
      .map((x) => `${x.r.name} (${mm(x.moved)} mm of ${mm(x.noaa.amplitude, 0)})`)
      .join(
        ", ",
      )}. On the held-out year the step leaves the tidal-band RMS ${tally(change(3))}. It is the largest of the four steps for ${largest("M2", 2)} and ${largest("M4", 2)}. NOAA's analysis has no such weights.`,
    `- **M1 is held as NO1.** The candidate list has the line under both names and Foreman's NO1 comes first, so every fit holds it as NO1, with the node factor the engine gives that name and not Schureman's for M1. ${count("M1")} of ${stations("M1")} are outside. NOAA's M1 also depends on its yearly evaluation: M1's node factor changes within a year, and evaluating it at each sample moves it more than any other of NOAA's 37 (the largest step for ${largest("M1", 0)}; taking the line as NO1 is the largest for the rest).`,
    `- **S1, P1 and R2 in NOAA's constants hold part of K1 and K2.** K1's node factor changes within a year. Held at its mid-year value, as NOAA holds it, a K1 of 1 m alone leaves ${perMeter(k1.S1!)} in S1 and ${perMeter(k1.P1!)} in P1 in a one-year fit, over the years 2006 to 2024, and a K2 of 1 m leaves ${perMeter(k2.R2!)} in R2. With node factors at each sample those are zero. That step is the largest of the four for ${largest("S1", 0)} and ${largest("P1", 0)}.`,
    `- **L2 depends on how the years are combined.** L2 shares its frequency with 2MN2, whose node factor differs, so where shallow water makes 2MN2 the tide doesn't follow L2's factor from year to year. One fit of all years then gives another constant than the average of yearly fits. Combining the years is the largest of the four steps for ${largest("L2", 1)}.`,
    `- **2MK3 is held as MO3.** Both names are one line, and Foreman's MO3 comes first in the candidate list, with M2's and O1's node factors where NOAA's 2MK3 has M2's twice and K1's. ${count("2MK3")} of ${stations("2MK3")} are outside.`,
    `- **The standard fit reads other years.** ${s.outside} of ${s.compared} of its constants are outside the interval, which 19 years make narrow. [Constituents across stations](#constituents-across-stations) gives how far the standard fit is from the store's own fit of NOAA's years, which is what the two periods differ by under one method: M2 is a median ${mm(median(moved("M2")), 1)} mm from one period's fit to the other's and K1 ${mm(median(moved("K1")), 1)} mm.`,
    "- **Long-period constituents aren't comparable.** NOAA takes Sa, Ssa, Mm, Msf and Mf from other spans than its analysis years, by other methods such as monthly means, or publishes zero where it found them unstable. They are in each station's table and in no count.",
    worst.length
      ? `- **${worst[0]![0]} isn't explained.** NOAA's method misses NOAA's constants by over 1 mm for ${n(over.length, "constant")}, ${worst.map(([name, c]) => `${c} at ${name}`).join(", ")}. At Boston no other set of five years near the ones NOAA names fits closer, tried outside this script, and what NOAA's analysis read there isn't known.`
      : "",
  );
  p("### Defects");
  p(
    anchorage
      ? `- **The candidate list is too short for ${anchorage.name}.** NOAA publishes ${anchorage.rows.length + anchorage.unlisted.length} constituents there, ${anchorage.unlisted.length} of them shallow-water compounds the candidate list doesn't have. Fitted by the store's method with NOAA's constituents, the same years predict the held-out year to ${mm(anchorage.scores.steps.robust.rms)} mm RMS; with the candidate list they give ${mm(anchorage.scores.window.rms)} mm, and the standard fit ${mm(anchorage.scores.standard.rms)} mm, against ${mm(anchorage.scores.noaa.rms)} mm for NOAA's constants. It is the only station where the store's constituents predict much worse than NOAA's.`
      : "",
    "- **None found in the fitter, the nodal corrections or the phase convention.** Every difference above the rounding of NOAA's constants is traced to a step of the method or to the candidate list, except Boston's.",
  );
  return lines.join("\n").trimEnd();
}

/** The differences of `names` of 1 cm or more in one fit, without sign. */
function pairsOf(results: Result[], which: Which, names: string[]) {
  const found = pairs(results, which, false).filter(
    (x) => names.includes(x.row.name) && x.row.noaa.amplitude >= 0.01,
  );
  const abs = (xs: (number | null)[]) => xs.flatMap((x) => (x === null ? [] : [Math.abs(x)]));
  return {
    relative: abs(found.map((x) => x.s.d.relative)),
    phase: abs(found.map((x) => x.s.d.phase)),
  };
}

if (isMainThread) await main();
else work();
