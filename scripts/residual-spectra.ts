/**
 * Does the spectrum of a fit's residual say which gauges need shallow-water
 * compounds, and what is left once they are fitted?
 *
 * Each gauge is fitted over the 2, 5 and 19 years before the three that end
 * with its source's last year of final values, with the candidates alone and
 * with NOAA's 59 Anchorage compounds after them. Each fit's constants predict the three
 * years no fit read, and the spectrum of observed minus predicted over those
 * years is what `src/fit/residual-spectrum.ts` measures. Nothing here changes
 * a fit or proposes a list.
 *
 * It reads a local copy of the store (STILLWELL_STORE) and writes
 * docs/results/residual-spectra.json, docs/results/residual-spectra.md and
 * the figures in docs/results/residual-spectra/. It never writes to the store.
 *
 * Usage: node scripts/residual-spectra.ts --cache dir [--concurrency n] [--fit | --report]
 *
 * `--cache` keeps each gauge's constants and held-out residuals in a
 * directory and reads them back on the next run, so a run that stopped can go
 * on and the spectra can be measured again without fitting. A run that
 * finishes writes the directory's `run.json`, which names every file the run
 * rests on. `--fit` fills the cache and writes no report. `--report` reads no
 * store: it measures and writes from the cache, and fails where a file isn't
 * the one `run.json` names.
 */
import "./threadpool.ts";
import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { createTidePredictor, fit as engineFit, selectConstituents } from "@slackwater/engine";
import type { Erratum } from "../src/errata.ts";
import { CANDIDATES } from "../src/fit/candidates.ts";
import { engineVersion, MIN_FIT_DAYS } from "../src/fit/fit.ts";
import {
  barFor,
  COMPOUNDS,
  figure,
  FIGURES as FIGURE_FILES,
  GAUGES,
  HELD_OUT_YEARS,
  measure,
  pack,
  RESOLVED,
  spectrum,
  render,
  WINDOWS,
  YEAR_SHARE,
  type Arm,
  type Constant,
  type Fitted,
  type FittedWindow,
  type FittedYears,
  type Run,
} from "../src/fit/residual-spectrum.ts";
import { harmonicSamples, NODE_CORRECTIONS, SEASONAL, tidalResiduals } from "../src/fit/scores.ts";
import { emptyInputs, finalYear, METHOD, readSeries } from "../src/fit/series.ts";
import { DUCKDB_MB, workerCount } from "../src/fit/workers.ts";
import { listOf } from "../src/refresh.ts";
import type { StoredStation } from "../src/schema.ts";
import { errata, sourceOf } from "../src/sources/index.ts";
import {
  connected,
  EMPTY_YEAR,
  limitDuckDb,
  readYearStats,
  settled,
} from "../src/store/parquet.ts";
import { seriesDir } from "../src/store/paths.ts";
import { pool } from "../src/store/recent.ts";
import { STORE } from "../src/store/stores.ts";
import { readYears, type YearRow } from "../src/store/years.ts";
import type { Sample } from "../src/types.ts";

const JSON_PATH = "docs/results/residual-spectra.json";
const REPORT_PATH = "docs/results/residual-spectra.md";
const FIGURES = "docs/results/residual-spectra";
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Raised when the fits here, or what the cache keeps of them, change in a way the key's other parts don't show. */
const FIT_VERSION = 1;
/** Raised when what the cache keeps of a gauge's fitted years changes. */
const FITTED_YEARS_VERSION = 2;
/** A worker's heap, as the store's fit workers have. */
const HEAP_MB = 2048;

/** What a finished run rests on: the cache file of every gauge, by its key, and the lists the report names. */
interface Manifest extends Run {
  lists: string;
  keys: Record<string, string>;
  fitted_years: Record<string, string>;
}

/** A digest of the code's lists and settings a run was made under, which a report of it must still be under. */
const lists = () =>
  createHash("sha256")
    .update(
      JSON.stringify([
        CANDIDATES.map((c) => [c.name, c.doodson]),
        COMPOUNDS,
        GAUGES,
        WINDOWS,
        HELD_OUT_YEARS,
        METHOD,
        NODE_CORRECTIONS,
        FIT_VERSION,
        FITTED_YEARS_VERSION,
        YEAR_SHARE,
        MIN_FIT_DAYS,
      ]),
    )
    .digest("hex");

interface Task {
  station: StoredStation;
  store: string;
  years: [string, YearRow][];
  errata: Omit<Erratum, "check">[];
  now: string;
  finalYear: number;
}

type Reply = { result: Fitted } | { error: string };

const seasonal: readonly string[] = SEASONAL;

function work(): void {
  limitDuckDb({ threads: "1", memory_limit: `${DUCKDB_MB}MB` });
  parentPort!.on("message", async (task: Task) => {
    let reply: Reply;
    try {
      reply = { result: await fitGauge(task) };
      await connected();
    } catch (error) {
      await settled();
      reply = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
    }
    parentPort!.postMessage(reply);
  });
}

/**
 * The store's fit of `samples` from the candidates `names`: Rayleigh and SNR
 * selection in a plain fit, then robust weights for the ones kept. Sa and Ssa
 * are fitted and kept whatever their yearly spread, which the store's fit
 * judges them by: the residuals here have the slow part filtered out, so
 * they don't enter.
 */
function fitNames(samples: readonly Sample[], names: readonly string[]): Constant[] {
  const engineSamples = harmonicSamples(samples);
  const { selection } = selectConstituents(engineSamples, {
    candidates: names.filter((n) => !seasonal.includes(n)).map((name) => ({ name })),
    nodeCorrections: NODE_CORRECTIONS,
  });
  const chosen = selection.filter((s) => s.kept).map((s) => s.name);
  const fitted = engineFit(engineSamples, [...chosen, ...SEASONAL], {
    robust: true,
    nodeCorrections: NODE_CORRECTIONS,
    dropDependent: true,
  });
  const constants = fitted.constituents.map(({ name, amplitude, phase }) => ({
    name,
    amplitude,
    phase,
  }));
  if (constants.some((c) => !Number.isFinite(c.amplitude) || !Number.isFinite(c.phase)))
    throw new Error("the fit gave a constant that isn't a number");
  return constants;
}

async function fitGauge(task: Task): Promise<Fitted> {
  const { station } = task;
  const context = {
    store: task.store,
    metadata: sourceOf(station.source).metadata,
    years: new Map(task.years),
    errata: task.errata as Erratum[],
    now: new Date(task.now),
  };
  const read = (period: { start: number; end: number }) =>
    readSeries(station, period, "final", { ...context, inputs: emptyInputs() });

  const first = task.finalYear - (HELD_OUT_YEARS - 1);
  const span = { start: Date.UTC(first, 0, 1), end: Date.UTC(task.finalYear + 1, 0, 1) };
  const startHour = span.start / HOUR_MS;
  const hours = (span.end - span.start) / HOUR_MS;
  const heldOut = await read(span);
  // The three years as one series, so the filter loses hours only at gaps and the two ends.
  const series = (constants: Constant[]) => {
    const out = new Float32Array(hours).fill(NaN);
    for (const [hour, r] of tidalResiduals(constants, heldOut)) out[hour - startHour] = r;
    return out;
  };
  const observed = series([]);
  const scored = observed.reduce((n, x) => n + (Number.isFinite(x) ? 1 : 0), 0);

  const windows: FittedWindow[] = [];
  for (const years of WINDOWS) {
    const period = { start: Date.UTC(first - years, 0, 1), end: span.start };
    // A year's worth of hours, as a held-out year counts where half its hours can be scored.
    if (scored < hours / 3) {
      windows.push({ years, skipped: "under a third of the held-out hours can be scored" });
      continue;
    }
    const samples = await read(period);
    const days = samples.length ? (samples.at(-1)!.time - samples[0]!.time) / DAY_MS : 0;
    if (samples.length < (YEAR_SHARE * (period.end - period.start)) / HOUR_MS) {
      windows.push({ years, skipped: "the store holds under two thirds of the window's hours" });
      continue;
    }
    if (days < MIN_FIT_DAYS) {
      windows.push({ years, skipped: `under ${MIN_FIT_DAYS} days of values` });
      continue;
    }
    const arm = (names: readonly string[]): Arm => {
      const constants = fitNames(samples, names);
      return { constants, residual: pack(series(constants)) };
    };
    const candidates = CANDIDATES.map((c) => c.name);
    windows.push({
      years,
      hours: samples.length,
      base: arm(candidates),
      all: arm([...candidates, ...COMPOUNDS]),
    });
  }
  return {
    id: station.id,
    name: station.name,
    latitude: station.lat,
    held_out: [first, task.finalYear],
    hours,
    observed: pack(observed),
    windows,
  };
}

/**
 * Checks that a local copy's years file agrees with its files for a station:
 * every year file in the station's directories has a row in `years`, with the
 * version the file's values give. Throws where one doesn't. A station the
 * copy marks as being written can be read without its marker only once this
 * passes, since its rows are then known to describe the files read. A row
 * without a file is left to the reader, which refuses a year it is asked for
 * and can't find.
 */
async function checkCopy(
  store: string,
  station: StoredStation,
  years: ReadonlyMap<string, YearRow>,
): Promise<void> {
  const files: { path: string; epoch: number; year: number }[] = [];
  for (const epoch of station.epochs) {
    const dir = seriesDir(store, "levels", station.source, station.source_id, epoch.id);
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) {
      const year = /^(\d{4})\.parquet$/.exec(name)?.[1];
      if (year) files.push({ path: `${dir}/${name}`, epoch: epoch.id, year: Number(year) });
    }
  }
  const stats = await readYearStats(files.map((f) => f.path));
  const wrong = files.filter((f) => {
    const row = years.get(`${station.id} ${f.epoch} ${f.year}`);
    return !row || row.version !== (stats.get(f.path) ?? EMPTY_YEAR).version;
  });
  if (wrong.length)
    throw new Error(
      `${station.id}: the copy's years file doesn't describe its files for ${wrong.map((f) => f.year).join(", ")}; copy the station's files and the years file again`,
    );
}

/**
 * Spectra of the years a gauge's longest fit read: the observed levels, the
 * prediction from that fit's constants with the compounds, and the
 * difference. They are fine enough to tell a held-out line from the fitted
 * constituent beside it.
 */
async function fittedYears(task: Task, fitted: Fitted): Promise<FittedYears> {
  const { station } = task;
  const years = WINDOWS.at(-1)!;
  const window = fitted.windows.find((w) => w.years === years)!;
  if ("skipped" in window) throw new Error(`${station.id} has no ${years}-year fit`);
  const period = {
    start: Date.UTC(fitted.held_out[0] - years, 0, 1),
    end: Date.UTC(fitted.held_out[0], 0, 1),
  };
  const samples = await readSeries(station, period, "final", {
    store: task.store,
    metadata: sourceOf(station.source).metadata,
    years: new Map(task.years),
    errata: task.errata as Erratum[],
    now: new Date(task.now),
    inputs: emptyInputs(),
  });
  const hours = (period.end - period.start) / HOUR_MS;
  const options = { offset: false, nodeCorrections: NODE_CORRECTIONS } as const;
  const predictor = createTidePredictor(window.all.constants, options);
  // L2 by itself, to tell what its nodal correction puts beside it from what 3L2 and the rest do.
  const l2 = createTidePredictor(
    window.all.constants.filter((c) => c.name === "L2"),
    options,
  );
  const alone = new Float32Array(hours).fill(NaN);
  const mean = samples.reduce((s, x) => s + x.level, 0) / samples.length;
  const observed = new Float32Array(hours).fill(NaN);
  const predicted = new Float32Array(hours).fill(NaN);
  const residual = new Float32Array(hours).fill(NaN);
  for (const { time, level } of samples) {
    if (time % HOUR_MS) continue;
    const hour = (time - period.start) / HOUR_MS;
    observed[hour] = level - mean;
    predicted[hour] = predictor.getWaterLevelAtTime({ time: new Date(time) }).level;
    alone[hour] = l2.getWaterLevelAtTime({ time: new Date(time) }).level;
    residual[hour] = observed[hour]! - predicted[hour]!;
  }
  const [o, p, r, l] = [observed, predicted, residual, alone].map((series) => spectrum(series));
  const amplitudes = (spec: typeof o) => pack(Float32Array.from(spec!.amplitude));
  return {
    id: station.id,
    hours,
    coverage: o!.coverage,
    observed: amplitudes(o),
    predicted: amplitudes(p),
    residual: amplitudes(r),
    l2: amplitudes(l),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      concurrency: { type: "string", default: "4" },
      cache: { type: "string" },
      fit: { type: "boolean" },
      report: { type: "boolean" },
    },
  });
  if (!values.cache) throw new Error("--cache names the directory the fits are kept in");
  if (values.fit && values.report) throw new Error("--fit and --report don't go together");
  const cached = (id: string) => `${values.cache}/${id.replace("/", "-")}.json`;
  const yearsPath = (id: string) => `${values.cache}/years-${id.replace("/", "-")}.json`;
  const runPath = `${values.cache}/run.json`;
  // A name of this process's own, so two runs on one directory don't write through each other.
  const put = async (path: string, body: string) => {
    await writeFile(`${path}.${process.pid}.tmp`, body);
    await rename(`${path}.${process.pid}.tmp`, path);
  };
  const kept = async <T>(path: string): Promise<{ key: string; result: T } | undefined> => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      // Missing, or cut short.
      return undefined;
    }
  };

  if (!values.report) {
    // A station's marker is passed over below once its rows are shown to describe its files,
    // which holds only while nothing writes to the copy, and so never on a checkout's own store.
    if (
      !process.env.STILLWELL_STORE ||
      /^[a-z0-9]+:\/\//i.test(STORE) ||
      !existsSync(STORE) ||
      !statSync(STORE).isDirectory() ||
      (existsSync("data") && realpathSync(STORE) === realpathSync("data")) ||
      resolve(STORE) === resolve("data")
    )
      throw new Error(
        `STILLWELL_STORE must name a local copy of the store that nothing is writing to, a directory other than the checkout's own \`data\`; it is ${process.env.STILLWELL_STORE ?? "not set"}`,
      );
    const concurrency = Number(values.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new Error(`--concurrency takes a whole number of 1 or more, not ${values.concurrency}`);

    const now = new Date();
    const manifest: Manifest = {
      engine: engineVersion(),
      method: METHOD,
      node_corrections: NODE_CORRECTIONS,
      final_years: {},
      sources: {},
      credits: {},
      lists: lists(),
      keys: {},
      fitted_years: {},
    };
    const tasks = new Map<string, Task>();
    const stations = new Map<string, { station: StoredStation; all: Map<string, YearRow> }>();
    for (const source of [...new Set(GAUGES.map((id) => id.split("/")[0]!))]) {
      const from = sourceOf(source);
      const list = await listOf(STORE, from);
      const all = await readYears(STORE, source);
      if (!all) throw new Error(`${STORE} has no years file for ${source}`);
      // A marker on a copy says a station was being written when it was copied, or that a write
      // stopped partway. `checkCopy` shows each gauge's rows describe the files copied.
      const years = [...all].filter(([, r]) => r.epoch !== null && r.year !== null);
      const qcStarts = new Map(
        list.flatMap((s) =>
          s.source_qc_start ? [[s.id, Date.parse(s.source_qc_start)] as const] : [],
        ),
      );
      const final = finalYear(from.metadata, new Map(years), now, qcStarts);
      // A marked station votes for no year in the store's own fits. The year is taken only where
      // it is the same whether the marked stations' rows vote or not.
      if (finalYear(from.metadata, all, now, qcStarts) !== final)
        throw new Error(
          `${source}'s last year of final values depends on the stations the copy marks as being written; copy the years file again once they are done`,
        );
      manifest.final_years[source] = final;
      manifest.sources[source] = {
        name: from.metadata.name,
        attribution: from.metadata.attribution,
        license: from.metadata.license.name,
        license_url: from.metadata.license.url,
      };
      for (const id of GAUGES.filter((g) => g.startsWith(`${source}/`))) {
        const station = list.find((s) => s.id === id);
        if (!station) throw new Error(`${STORE} lists no ${id}`);
        await checkCopy(STORE, station, all);
        stations.set(id, { station, all });
        // A gauge whose values carry a credit of their own, such as an archive's.
        if (station.attribution !== from.metadata.attribution)
          manifest.credits[id] = station.attribution;
        // What a cached result was made from: the lists, the engine, the rules for a window, the
        // source's final year, the station as listed, its files' versions and the errata.
        manifest.keys[id] = createHash("sha256")
          .update(
            JSON.stringify([
              manifest.engine,
              METHOD,
              FIT_VERSION,
              CANDIDATES.map((c) => [c.name, c.doodson]),
              COMPOUNDS,
              WINDOWS,
              HELD_OUT_YEARS,
              YEAR_SHARE,
              MIN_FIT_DAYS,
              final,
              station,
              [...all].filter(([, r]) => r.id === id).map(([k, r]) => [k, r.version]),
              errata.map(({ check: _, ...erratum }) => erratum),
            ]),
          )
          .digest("hex");
        tasks.set(id, {
          station,
          store: STORE,
          years,
          errata: errata.map(({ check: _, ...erratum }) => erratum),
          now: now.toISOString(),
          finalYear: final,
        });
      }
    }

    await mkdir(values.cache, { recursive: true });
    const fitted = new Map<string, Fitted>();
    const queue: Task[] = [];
    for (const [id, task] of tasks) {
      const entry = await kept<Fitted>(cached(id));
      if (entry?.key === manifest.keys[id]) fitted.set(id, entry.result);
      else queue.push(task);
    }
    const failed: string[] = [];
    const lanes = workerCount(concurrency);
    await pool(
      Array.from({ length: lanes }, (_, i) => i),
      lanes,
      async () => {
        const worker = new Worker(new URL(import.meta.url), {
          resourceLimits: { maxOldGenerationSizeMb: HEAP_MB },
        });
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
        for (let task = queue.shift(); task; task = queue.shift()) {
          const id = task.station.id;
          const started = Date.now();
          const sent = task;
          const reply = await new Promise<Reply>((answered) => {
            answer = answered;
            if (gone) answered({ error: gone });
            else worker.postMessage(sent);
          });
          if ("error" in reply) {
            failed.push(`${id}: ${reply.error}`);
            console.error(`${id}: ${reply.error}`);
            // The other lanes finish the gauge they are on and take no more.
            queue.length = 0;
            break;
          }
          fitted.set(id, reply.result);
          await put(cached(id), JSON.stringify({ key: manifest.keys[id], result: reply.result }));
          console.error(`${id}: fitted in ${Math.round((Date.now() - started) / 1000)} s`);
        }
      },
    );
    if (failed.length || fitted.size !== GAUGES.length) {
      console.error(`${failed.length} gauges failed; nothing written`);
      process.exit(1);
    }
    for (const id of RESOLVED) {
      // By the key of the fit they predict from, so a gauge fitted again is read again.
      const key = `${manifest.keys[id]} ${FITTED_YEARS_VERSION}`;
      manifest.fitted_years[id] = key;
      if ((await kept<FittedYears>(yearsPath(id)))?.key === key) continue;
      const result = await fittedYears(tasks.get(id)!, fitted.get(id)!);
      await put(yearsPath(id), JSON.stringify({ key, result }));
      console.error(`${id}: read its fitted years`);
    }
    // A file rewritten while the fits ran would have been read against a row that no longer describes it.
    for (const { station, all } of stations.values()) await checkCopy(STORE, station, all);
    await put(runPath, JSON.stringify(manifest));
    if (values.fit) process.exit(0);
  }

  // The report is of one finished run: every file must be the one that run's manifest names.
  if (!existsSync(runPath)) throw new Error(`${runPath} isn't there: no run has finished`);
  const manifest = JSON.parse(await readFile(runPath, "utf8")) as Manifest;
  const { keys, fitted_years, lists: ran, ...run } = manifest;
  // The report names lines by the installed engine's catalog and counts the code's lists.
  if (ran !== lists() || run.engine !== engineVersion())
    throw new Error(
      `${runPath} is of a run with other lists, settings or engine than this checkout's; run without --report`,
    );
  const named = async <T>(path: string, key: string | undefined): Promise<T> => {
    const entry = await kept<T>(path);
    if (!entry || entry.key !== key)
      throw new Error(`${path} isn't the file the last finished run made; run without --report`);
    return entry.result;
  };
  const gauges: Fitted[] = [];
  for (const id of GAUGES) gauges.push(await named<Fitted>(cached(id), keys[id]));
  const years: FittedYears[] = [];
  for (const id of RESOLVED) years.push(await named<FittedYears>(yearsPath(id), fitted_years[id]));

  const { report, drawn } = measure(run, gauges, years);
  const markdown = render(report);
  await mkdir(FIGURES, { recursive: true });
  // The report links every figure, so each must be of this run.
  const undrawn = Object.keys(FIGURE_FILES).filter((id) => !drawn.some((d) => d.id === id));
  if (undrawn.length) throw new Error(`no ${WINDOWS.at(-1)}-year fit to draw for ${undrawn}`);
  for (const d of drawn)
    await writeFile(`${FIGURES}/${FIGURE_FILES[d.id]}.svg`, figure(d, barFor(d.n).family));
  // Six figures, so the file doesn't carry the noise below them.
  const rounded = (_: string, value: unknown) =>
    typeof value === "number" && !Number.isInteger(value) ? Number(value.toPrecision(6)) : value;
  await put(JSON_PATH, JSON.stringify(report, rounded, 1) + "\n");
  await put(REPORT_PATH, markdown);
  console.error(`wrote ${JSON_PATH}, ${REPORT_PATH} and ${drawn.length} figures`);
  process.exit(0);
}

if (isMainThread) await main();
else work();
