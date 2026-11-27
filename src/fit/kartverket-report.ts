import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NAMES, ROUNDING } from "../sources/kartverket/constants.ts";
import { zeroPhaseGain } from "./butterworth.ts";
import { mm, ratio, signed, table, percent } from "./calibration-report.ts";
import { median, type Difference } from "./calibration.ts";

/**
 * The Kartverket calibration's results and the report written from them
 * (docs/results/kartverket-calibration.md). `scripts/calibrate-kartverket.ts`
 * fits the gauges and fills a `Report`; everything here is arithmetic on one.
 */

/** Slower than this, in degrees an hour, a constituent is long-period and compared apart. */
export const LONG_PERIOD = 2.5;
/** The cutoffs the filter's estimate searches, in hours. */
const SEARCH: [number, number] = [1.5, 5];
/** The constituents the summary gives apart. */
const MAJOR = ["M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1"];
/** From this speed up, 4.5 cycles a day, the filter's gain is far enough from one to be estimated. */
export const FILTERED_FROM = 67.5;
/** A year is whole where the store holds this share of its hours. */
export const YEAR_SHARE = 2 / 3;
/** A gauge with this many constants outside is fitted again with each year, and each two years running, left out. */
export const PROBE_FROM = 5;
/** The constituents a gauge's clock is read from: this fast, in degrees an hour, and this large, in meters. */
export const CLOCK = { speed: 10, amplitude: 0.005 };
/** The years Kartverket's SA is fitted over again, from the first to the last. */
export const SA_YEARS = [1991, 2020] as const;
/**
 * How the series is filtered in time: gaps of up to `gap_hours` are filled in
 * a straight line, a run of values shorter than `run_days` is left out, and
 * `trim_days` are dropped from each end of a run.
 */
export const IN_TIME = { gap_hours: 1, run_days: 4, trim_days: 1 };

/**
 * The gauges: every one in the store's list whose constants Kartverket
 * analyzed from a period that ends with 2020 and starts before 2011, in its
 * UTC+1. A run asks for every listed gauge's constants and stops where these
 * aren't the ones that meet that.
 */
// prettier-ignore
export const GAUGES = ["AES","ANX","BGO","BOO","HAR","HEI","HFT","HRO","HVG","KAB","KSU","MAY","MSU","NVK","NYA","OSC","OSL","RVK","SVG","TOS","TRD","TRG","VAW","VIK"];

/** Whether a period, from `start` to before `end` (epoch ms), is one `GAUGES` are chosen by. */
export const chosen = (period: { start: number; end: number }) =>
  period.end === Date.UTC(2020, 11, 31, 23) && period.start < Date.UTC(2010, 11, 31, 23);

/** How the gauges are fitted, Kartverket's way: one plain fit, Foreman's corrections at the gauge's latitude. */
export const FIT = { nodeCorrections: "foreman", dropDependent: true } as const;

/** The filter Kartverket's analysis is taken to have run its series through: a zero-phase Butterworth. */
export const FILTER = { order: 4, cutoff_hours: 2.98 };

export interface Row {
  /** Kartverket's name, and the catalog's. */
  name: string;
  candidate: string;
  speed: number;
  kartverket: { amplitude: number; phase: number };
  /** The fit of the store's hourly values, as fitted, with the filter's gain at this speed, or why it has none. */
  ours:
    | { reason: string }
    | {
        amplitude: number;
        phase: number;
        amplitude_ci: number | null;
        phase_ci: number | null;
        gain: number;
        /** Against Kartverket's, with the amplitude and its interval scaled by the gain. */
        d: Difference;
        /** The vector difference without the gain, in meters. */
        unscaled: number;
      };
  /** The vector difference of the fit of the series filtered in time, in meters; null where it wasn't fitted. */
  filtered: number | null;
}

export interface Result {
  id: string;
  name: string;
  latitude: number;
  /** The observations Kartverket analyzed. */
  period: { start: string; end: string };
  hours: number;
  /** Hourly values the fit of the series filtered in time read. */
  filtered_hours: number | null;
  /** Calendar years of the period the store holds under two thirds of. */
  short_years: number[];
  marked: boolean;
  /** The seconds past one hour the fitted phases ask Kartverket's to be moved by; null where no constituent is large enough to say. */
  phase_seconds: number | null;
  /** The half-width of that figure's 95% interval, from the fit's phase intervals. */
  phase_seconds_ci: number | null;
  /** Terrestrial time minus UTC over the period, which the comparison moves them by. */
  tt_seconds: number;
  /** SA fitted over 1991 to 2020 against Kartverket's, in meters, where the store holds every year whole. */
  sa_long: { amplitude: number; phase: number; vector: number } | null;
  /** The store's own fit: its held-out year and scores. */
  standard: {
    since: string;
    until: string;
    held_out: number;
    variance: number | null;
    rms: number | null;
    kept: number;
  };
  /**
   * Kartverket's constants, and the fit compared with them, predicted under Foreman's corrections
   * and scored on the store's held-out year: the share of the tidal band's variance explained and
   * the tidal-band RMS left, in meters.
   */
  scores: Record<"kartverket" | "method", { variance: number | null; rms: number | null }>;
  /** The same fit with robust weights: the constants outside and the mean vector difference, in meters. */
  robust: { outside: number; vector: number };
  /** The fit compared: its mean vector difference over the short-period constituents, in meters. */
  vector: number;
  /** With each year, and each two years running from `year`, left out in turn: the constants outside and the mean vector difference. */
  probe: { year: number; years: number; outside: number; vector: number }[] | null;
  rows: Row[];
}

/**
 * A digest of what the comparison rests on besides the fit's `METHOD`: the
 * gauges, the names, the fit's options, the filter, the limits above, and the
 * scripts, parser and comparison that fit, convert and judge, byte for byte. The report records
 * it, and is of other inputs when it changes.
 */
export function kartverketDigest(): string {
  // The files that fit and convert, as they are: a rule changed in them is a report of other inputs.
  const code = [
    "scripts/calibrate-kartverket.ts",
    "scripts/calibration-run.ts",
    "src/sources/kartverket/constants.ts",
    "src/fit/butterworth.ts",
    "src/fit/calibration.ts",
  ].map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));
  return createHash("sha256")
    .update(
      JSON.stringify([
        GAUGES,
        NAMES,
        FIT,
        FILTER,
        ROUNDING,
        [
          LONG_PERIOD,
          FILTERED_FROM,
          YEAR_SHARE,
          PROBE_FROM,
          CLOCK,
          SA_YEARS,
          IN_TIME,
          SEARCH,
          MAJOR,
        ],
        // A function has no JSON of its own.
        [chosen.toString(), isOutside.toString()],
        code,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

export interface Report {
  engine: string;
  /** `kartverketDigest` when the fits ran. */
  inputs: string;
  method: number;
  final_year: number;
  filter: typeof FILTER;
  results: Result[];
}

type Fitted = Exclude<Row["ours"], { reason: string }>;
const fitted = (row: Row): Fitted | null => ("reason" in row.ours ? null : row.ours);
const isLong = (row: Row) => row.speed < LONG_PERIOD;
/** Whether a difference is outside the fit's interval, or has none to be inside of. The script and the report count by this one rule. */
export const isOutside = (d: Difference) => d.ratio === null || d.ratio > 1;
const outside = (row: Row) => {
  const ours = fitted(row);
  return !!ours && isOutside(ours.d);
};

/** Every compared pair: short-period rows where the fit has the constituent. */
function pairs(results: Result[]) {
  return results.flatMap((result) =>
    result.rows.flatMap((row) => {
      const ours = fitted(row);
      return ours && !isLong(row) ? [{ result, row, ours }] : [];
    }),
  );
}

/**
 * The filter that best takes the fitted amplitudes to Kartverket's, from the
 * constituents at 4.5 cycles a day and faster: for each even order, the
 * cutoff with the least RMS misfit, in meters.
 */
export function estimateFilter(results: Result[]) {
  const used = pairs(results).filter(
    (x) => x.row.speed >= FILTERED_FROM && x.row.kartverket.amplitude >= 0.0005,
  );
  const misfit = (order: number, cutoff: number) =>
    Math.sqrt(
      used.reduce(
        (s, x) =>
          s +
          (x.ours.amplitude * zeroPhaseGain(x.row.speed, order, cutoff) -
            x.row.kartverket.amplitude) **
            2,
        0,
      ) / Math.max(used.length, 1),
    );
  const orders = [2, 4, 6, 8].map((order) => {
    let best = { order, cutoff_hours: SEARCH[0], misfit: Infinity, edge: false };
    for (let c = SEARCH[0] * 100; c <= SEARCH[1] * 100; c++) {
      const m = misfit(order, c / 100);
      if (m < best.misfit) best = { order, cutoff_hours: c / 100, misfit: m, edge: false };
    }
    // A least at an end of the search isn't a least found.
    return { ...best, edge: best.cutoff_hours === SEARCH[0] || best.cutoff_hours === SEARCH[1] };
  });
  return {
    constants: used.length,
    orders,
    // Null where every order's least is at an end of the search, as with no filter to find.
    best: orders
      .filter((o) => !o.edge)
      .reduce<(typeof orders)[number] | null>((a, b) => (!a || b.misfit < a.misfit ? b : a), null),
    none: misfit(4, 1e-9),
    pinned: misfit(FILTER.order, FILTER.cutoff_hours),
  };
}

export function render(report: Report): string {
  const { results } = report;
  const out: string[] = [];
  const p = (...lines: string[]) => out.push(...lines.filter(Boolean), "");
  const all = pairs(results);
  const out1 = all.filter((x) => outside(x.row));
  const estimate = estimateFilter(results);
  const slow = all.filter((x) => x.row.speed < FILTERED_FROM);
  const fast = all.filter((x) => x.row.speed >= FILTERED_FROM);
  const share = (n: number, of: number) =>
    of ? `${n} of ${of} (${((100 * n) / of).toFixed(1)}%)` : "none";
  const abs = (xs: (number | null)[]) => xs.flatMap((x) => (x === null ? [] : [Math.abs(x)]));
  const majors = all.filter(
    (x) => MAJOR.includes(x.row.name) && x.row.kartverket.amplitude >= 0.01,
  );
  // Kartverket gives the period in UTC+1.
  const day = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 10);
  const years = (r: Result) => `${day(r.period.start)} to ${day(r.period.end)}`;
  const byOutside = new Map<string, number>();
  for (const x of out1) byOutside.set(x.result.name, (byOutside.get(x.result.name) ?? 0) + 1);
  const worst = [...byOutside].sort((a, b) => b[1] - a[1]);

  p("# Calibration of the harmonic fits against Kartverket's constants");
  p(
    `Kartverket, the Norwegian Mapping Authority's Hydrographic Service, publishes harmonic constants for its gauges, analyzed from its own observations of them, which the store holds as \`kartverket\`. This report fits ${results.length} of those gauges, every one in the store's list whose constants are from a period that ends with 2020 and starts before 2011, from the store the way that reproduces Kartverket's analysis, and compares the constants with Kartverket's, constituent by constituent. It is written by [\`scripts/calibrate-kartverket.ts\`](../../scripts/calibrate-kartverket.ts) (\`npm run calibrate:kartverket\`), with every number in [kartverket-calibration.json](kartverket-calibration.json), and is run again whenever the method changes. [Checks](../contributing/checks.md#kartverket) says how to run it, and the [calibration against NOAA](fit-calibration.md) is its companion. Kartverket's constants are © Kartverket, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and the differences here are derived from them.`,
  );
  p(
    `These fits ran with ${report.engine}, method ${report.method} of [\`src/fit/\`](../../src/fit/), and ${report.final_year} as the source's last year of final values.`,
  );

  p("## What is compared");
  p(
    `Kartverket's constants are from its tide API's \`constituents\` request, which gives amplitudes in centimeters, to a hundredth, and phases to a hundredth of a degree against UTC+1, with the period of observations analyzed ([Kartverket](../../src/sources/kartverket/README.md)). The API doesn't describe the analysis. The fit compared here is the one that reproduces it from the store's values: one least-squares fit over Kartverket's period, without robust weights, of Kartverket's own constituents, with Foreman's nodal corrections at the gauge's latitude evaluated at each sample. It reads the store's final values on the hour, which for Kartverket are every value a year old or more, since Kartverket marks none as checked. With robust weights, as the store's own fits have, the same fit is a median ${mm(median(results.map((r) => r.robust.vector)), 3)} mm from Kartverket's constants over a gauge's short-period constituents, against ${mm(median(results.map((r) => r.vector)), 3)} mm without them.`,
  );
  p(
    `Two corrections bring Kartverket's constants and the fit's to the same terms. Kartverket has confirmed the clock. The filter isn't documented and is taken from the comparison itself, so on it the comparison shows consistency and is no independent check; it is asked of Kartverket ([questions](../../src/sources/kartverket/errata.ts)):`,
  );
  p(
    `- **The filter.** Kartverket's constants are smaller than the fit's above four cycles a day, as the gain of a low-pass filter would make them, which they would be if its analysis read a series filtered beyond the 10-minute values its API serves. The fit's amplitudes and their intervals are scaled by the gain of a zero-phase Butterworth filter of order ${report.filter.order} with a cutoff of ${report.filter.cutoff_hours} hours, which [The filter](#the-filter) estimates from the constants at ${FILTERED_FROM}° an hour and faster. Below that speed the gain is within ${percent(1 - zeroPhaseGain(FILTERED_FROM, report.filter.order, report.filter.cutoff_hours), 2)}% of one, and at four cycles a day it is within ${percent(1 - zeroPhaseGain(60, report.filter.order, report.filter.cutoff_hours), 2)}%, so the diurnal, semidiurnal and third-diurnal constants are compared very nearly as fitted.`,
    `- **The clock.** Kartverket's phases are moved to UTC by the constituent's speed over one hour, which Kartverket states, and over terrestrial time minus UTC, ${Math.min(...results.map((r) => r.tt_seconds)).toFixed(1)} to ${Math.max(...results.map((r) => r.tt_seconds)).toFixed(1)} s in these periods: Kartverket answered on 27 November 2026 that its analysis runs in terrestrial time ([questions](../../src/sources/kartverket/errata.ts)). [Gauges](#gauges) gives the seconds each gauge's fitted phases ask for, with their intervals.`,
  );
  p(
    `A constituent is **outside** where its amplitude or phase differs from Kartverket's by more than the fit's 95% interval, widened in quadrature by half of Kartverket's last digit (${mm(ROUNDING.amplitude, 2)} mm and ${ROUNDING.phase}°). Constituents slower than ${LONG_PERIOD}° an hour are counted apart.`,
  );
  p(
    "Kartverket's constants, the fit compared with them and the store's own fit of each gauge are each scored on the store's held-out year, in [The held-out year](#the-held-out-year). Kartverket's and the compared fit's are predicted under Foreman's corrections at the gauge's latitude, and the store's own under Schureman's.",
  );

  p("## Summary");
  p(
    table(
      ["", "All", `Under ${FILTERED_FROM}° an hour`, `${FILTERED_FROM}° an hour and faster`],
      [
        ["Constituents compared", String(all.length), String(slow.length), String(fast.length)],
        [
          "Outside the fit's interval",
          share(out1.length, all.length),
          share(slow.filter((x) => outside(x.row)).length, slow.length),
          share(fast.filter((x) => outside(x.row)).length, fast.length),
        ],
        [
          "Outside and over 1 mm apart",
          ...[all, slow, fast].map((xs) =>
            String(xs.filter((x) => outside(x.row) && x.ours.d.vector > 0.001).length),
          ),
        ],
        [
          "Median vector difference",
          ...[all, slow, fast].map((xs) => `${mm(median(xs.map((x) => x.ours.d.vector)), 3)} mm`),
        ],
        [
          "Largest vector difference",
          ...[all, slow, fast].map((xs) =>
            xs.length ? `${mm(Math.max(...xs.map((x) => x.ours.d.vector)), 2)} mm` : "",
          ),
        ],
      ],
    ),
  );
  p(
    `- **The major constituents.** ${majors.length} of ${MAJOR.join(", ")} are 1 cm or more. Their amplitudes differ from Kartverket's by a median of ${percent(median(abs(majors.map((x) => x.ours.d.relative))), 3)}% and at most ${percent(Math.max(...abs(majors.map((x) => x.ours.d.relative))), 2)}%, and their phases by a median of ${median(abs(majors.map((x) => x.ours.d.phase)))?.toFixed(3)}° and at most ${Math.max(...abs(majors.map((x) => x.ours.d.phase))).toFixed(2)}°. ${majors.filter((x) => outside(x.row)).length} of them are outside.`,
    out1.length
      ? `- **Outside.** ${out1.length} constants at ${worst.map(([name, n]) => `${name} (${n})`).join(", ")}. [Outside the interval](#outside-the-interval) lists them.`
      : "- **Outside.** None.",
    `- **Without the filter's gain** the constants at ${FILTERED_FROM}° an hour and faster are a median ${mm(median(fast.map((x) => x.ours.unscaled)), 3)} mm from Kartverket's, and with it ${mm(median(fast.map((x) => x.ours.d.vector)), 3)} mm.`,
  );

  p("## The filter");
  p(
    `Over the ${estimate.constants} constants at ${FILTERED_FROM}° an hour and faster of 0.5 mm or more, the RMS difference between the fit's amplitude and Kartverket's is ${mm(estimate.none, 3)} mm with no filter. For each even order, the cutoff that leaves the least, searched from ${SEARCH[0].toFixed(2)} to ${SEARCH[1].toFixed(2)} hours by hundredths:`,
  );
  p(
    table(
      ["Order", "Cutoff (hours)", "RMS difference (mm)"],
      estimate.orders.map((o) => [
        String(o.order),
        o.edge ? `${o.cutoff_hours.toFixed(2)} (the search's end)` : o.cutoff_hours.toFixed(2),
        mm(o.misfit, 4),
      ]),
    ),
  );
  p(
    `The comparison uses order ${report.filter.order} and ${report.filter.cutoff_hours} hours, which leaves ${mm(estimate.pinned, 4)} mm.${!estimate.best ? " No order has a least inside the search, so the constants don't show a filter." : estimate.best.order === report.filter.order && estimate.best.cutoff_hours === report.filter.cutoff_hours ? " That is the least of all." : ` The least is order ${estimate.best.order} at ${estimate.best.cutoff_hours.toFixed(2)} hours.`} The filter is estimated from the constants it is then used to compare, so agreement at these speeds says the constants are consistent with one such filter at every gauge, and nothing more.`,
  );
  const timed = results.filter((r) => r.rows.some((row) => row.filtered !== null));
  if (timed.length) {
    const both = timed.flatMap((r) =>
      r.rows.flatMap((row) => {
        const ours = fitted(row);
        return ours && row.filtered !== null && !isLong(row)
          ? [{ row, gain: ours.d.vector, time: row.filtered }]
          : [];
      }),
    );
    const of = (xs: typeof both) =>
      `${mm(median(xs.map((x) => x.gain)), 3)} mm by the gain and ${mm(median(xs.map((x) => x.time)), 3)} mm by the filter in time`;
    p(
      `The other way to allow for the filter is to run the store's 10-minute values through it and fit what comes out. That was done for ${timed.length} of the ${results.length} gauges, each with one datum epoch, with gaps of up to ${IN_TIME.gap_hours} hour filled in a straight line, ${IN_TIME.trim_days} day dropped at each end of a run of values, and the result read on the hour. The median vector difference from Kartverket's constants is ${of(both)} over all short-period constituents, and ${of(both.filter((x) => x.row.speed >= FILTERED_FROM))} at ${FILTERED_FROM}° an hour and faster. The two ways differ by ${mm(Math.abs((median(both.map((x) => x.gain)) ?? 0) - (median(both.map((x) => x.time)) ?? 0)), 3)} mm in that median. The comparison scales by the gain, which needs no rule for gaps and keeps the fit's intervals.`,
    );
  }

  p("## Gauges");
  p(
    `Each gauge's period as Kartverket gives it, the hourly values the fit read, how many constituents are compared and outside, the one furthest outside, and the seconds past one hour its phases ask Kartverket's to be moved by, from the constituents faster than ${CLOCK.speed}° an hour and of ${mm(CLOCK.amplitude, 0)} mm or more, weighted by amplitude squared, with the half-width of its 95% interval from the fit's phase intervals. The last column is the window of the store's own fit of the gauge.`,
  );
  p(
    table(
      [
        "Gauge",
        "Name",
        "Latitude",
        "Period",
        "Hourly values",
        "Compared",
        "Outside",
        "Largest ratio",
        "Phases ask for (s)",
        "The store's fit",
      ],
      results.map((r) => {
        const rows = r.rows.filter((row) => fitted(row) && !isLong(row));
        const top = [...rows].sort(
          (a, b) => (fitted(b)!.d.ratio ?? 0) - (fitted(a)!.d.ratio ?? 0),
        )[0];
        return [
          `\`${r.id}\``,
          r.name,
          `${r.latitude.toFixed(1)}°N`,
          years(r),
          r.hours.toLocaleString("en-US"),
          String(rows.length),
          String(rows.filter(outside).length),
          top ? `${top.name} ${fitted(top)!.d.ratio?.toFixed(2)}` : "",
          r.phase_seconds === null
            ? ""
            : `${r.phase_seconds.toFixed(1)} ± ${r.phase_seconds_ci?.toFixed(1) ?? "?"}`,
          `${r.standard.since.slice(0, 4)}–${+r.standard.until.slice(0, 4) - 1}`,
        ];
      }),
      2,
    ),
  );
  const asked = results.flatMap((r) => (r.phase_seconds === null ? [] : [r.phase_seconds]));
  const furthest = [...results]
    .filter((r) => r.phase_seconds !== null)
    .sort(
      (a, b) =>
        Math.abs(b.phase_seconds! - b.tt_seconds) - Math.abs(a.phase_seconds! - a.tt_seconds),
    )[0];
  p(
    `Terrestrial time minus UTC over these periods is ${Math.min(...results.map((r) => r.tt_seconds)).toFixed(1)} to ${Math.max(...results.map((r) => r.tt_seconds)).toFixed(1)} s. The fitted phases ask for a median of ${median(asked)?.toFixed(1)} s, from ${Math.min(...asked).toFixed(1)} to ${Math.max(...asked).toFixed(1)} s${furthest ? `, the furthest from it at ${furthest.name}` : ""}. Terrestrial time minus UTC is inside the interval at ${results.filter((r) => r.phase_seconds !== null && r.phase_seconds_ci !== null && Math.abs(r.phase_seconds - r.tt_seconds) <= r.phase_seconds_ci).length} of the ${asked.length} gauges.`,
  );
  const lacking = results.flatMap((r) => {
    const missing = MAJOR.filter((name) => !r.rows.some((row) => row.name === name));
    return missing.length ? [`${missing.join(", ")} at ${r.name}`] : [];
  });
  if (lacking.length) p(`Kartverket publishes no constant for ${lacking.join("; ")}.`);
  const short = results.filter((r) => r.short_years.length);
  if (short.length)
    p(
      `Of the part of each year that is in the period, the store holds under two thirds of the hours of ${short.map((r) => `${r.short_years.join(", ")} at ${r.name}`).join("; ")}. The fit reads those years as they are, as one fit of the whole period does.`,
    );
  const marked = results.filter((r) => r.marked);
  if (marked.length)
    p(
      `The copy of the store these fits read marked ${marked.map((r) => `\`${r.id}\``).join(", ")} as being written. The script checks that each year file in the copy has a row in the copy's years file with that file's version before it drops the marker.`,
    );

  p("## The held-out year");
  p(
    "Three sets of constants for each gauge, scored on the year the store's own fit holds out: Kartverket's published constants; the fit compared with them above, which is Kartverket's method on the store's values over Kartverket's period, as fitted and without the filter's gain; and the store's own fit, of up to 19 years with Schureman's corrections and its own constituents. Each is predicted under the corrections it was fitted with. The score is the share of the tidal band's variance explained and the tidal-band RMS of what is left, both after the Godin filter ([Scores](../fits.md#scores)).",
  );
  const rmsOfScore = (x: { rms: number | null }) => mm(x.rms);
  const varianceOf = (x: { variance: number | null }) =>
    x.variance === null ? "" : `${percent(x.variance, 2)}%`;
  p(
    table(
      [
        "Gauge",
        "Held-out year",
        "Kartverket's constants",
        "Kartverket's method",
        "The store's fit",
        "Kartverket's constants RMS (mm)",
        "Kartverket's method RMS (mm)",
        "The store's fit RMS (mm)",
      ],
      results.map((r) => [
        `\`${r.id}\` ${r.name}`,
        String(r.standard.held_out),
        varianceOf(r.scores.kartverket),
        varianceOf(r.scores.method),
        varianceOf(r.standard),
        rmsOfScore(r.scores.kartverket),
        rmsOfScore(r.scores.method),
        rmsOfScore(r.standard),
      ]),
    ),
  );
  const versus = (a: (r: Result) => number | null, b: (r: Result) => number | null) => {
    const changes = results.flatMap((r) => {
      const [x, y] = [a(r), b(r)];
      return x === null || y === null ? [] : [x - y];
    });
    if (!changes.length) return "can't be compared";
    return `is lower at ${changes.filter((d) => d <= -0.0001).length} and higher at ${changes.filter((d) => d >= 0.0001).length} of ${changes.length} gauges, from ${signed(Math.min(...changes) * 1000)} to ${signed(Math.max(...changes) * 1000)} mm`;
  };
  p(
    `Against Kartverket's constants, the RMS of Kartverket's method on the store's values ${versus(
      (r) => r.scores.method.rms,
      (r) => r.scores.kartverket.rms,
    )}, and the RMS of the store's own fit ${versus(
      (r) => r.standard.rms,
      (r) => r.scores.kartverket.rms,
    )}. A change under 0.1 mm counts as neither.`,
  );

  p("## Outside the interval");
  if (!out1.length) p("No constituent is outside the fit's interval.");
  else {
    p(
      "Every short-period constant outside the fit's interval, with the differences the fit's minus Kartverket's.",
    );
    p(
      table(
        [
          "Gauge",
          "Constituent",
          "Kartverket A (mm)",
          "ΔA (mm)",
          "Δg (°)",
          "Vector (mm)",
          "±A (mm)",
          "±g (°)",
          "Ratio",
        ],
        out1
          .sort((a, b) => (b.ours.d.ratio ?? 0) - (a.ours.d.ratio ?? 0))
          .map((x) => [
            `\`${x.result.id}\``,
            x.row.name,
            mm(x.row.kartverket.amplitude, 2),
            signed(x.ours.d.amplitude * 1000, 2),
            signed(x.ours.d.phase, 2),
            mm(x.ours.d.vector, 2),
            mm(x.ours.amplitude_ci === null ? null : x.ours.amplitude_ci * x.ours.gain, 2),
            x.ours.phase_ci === null ? "" : x.ours.phase_ci.toFixed(2),
            ratio(x.ours.d.ratio),
          ]),
        2,
      ),
    );
    for (const r of results.filter((x) => x.probe)) {
      const base = r.rows.filter((row) => !isLong(row) && outside(row)).length;
      const largest = out1
        .filter((x) => x.result === r)
        .sort((a, b) => b.row.kartverket.amplitude - a.row.kartverket.amplitude)[0]!;
      const say = (years: number) => {
        const found = r.probe!.filter((x) => x.years === years);
        const [counts, vectors] = [found.map((x) => x.outside), found.map((x) => x.vector)];
        return `${Math.min(...counts)} to ${Math.max(...counts)} outside and a mean vector difference of ${mm(Math.min(...vectors), 3)} to ${mm(Math.max(...vectors), 3)} mm`;
      };
      const least = Math.min(...r.probe!.map((x) => x.vector));
      p(
        `${r.name} has ${base} outside and a mean vector difference of ${mm(r.vector, 3)} mm, so it was fitted again with each year of the period left out in turn, and with each two years running. One year out leaves ${say(1)}; two leave ${say(2)}.${least < r.vector / 2 ? "" : " No year or pair of years accounts for the difference."} The largest of its constants outside is ${largest.row.name}, of ${mm(largest.row.kartverket.amplitude, 1)} mm, which the fit of ${r.name}'s own record is ${mm(largest.ours.d.vector, 2)} mm from. Kartverket's protocol says some constants come from a nearby station without saying which, and whether any of these do is asked of Kartverket ([questions](../../src/sources/kartverket/errata.ts)). This report doesn't find why ${r.name}'s constants differ.`,
      );
    }
  }

  p("## Constituents across gauges");
  p(
    "For each of Kartverket's constituents, over the gauges where the fit has it: the filter's gain at its speed, the median differences from Kartverket's without sign, how many are outside, for the short-period ones, and the median vector difference without the gain.",
  );
  const names = [
    ...new Map(results.flatMap((r) => r.rows.map((row) => [row.name, row.speed]))),
  ].sort((a, b) => a[1] - b[1]);
  p(
    table(
      [
        "Constituent",
        "Gauges",
        "Gain",
        "Amplitude (mm)",
        "Amplitude (%)",
        "Phase (°)",
        "Vector (mm)",
        "Outside",
        "Without the gain: vector (mm)",
      ],
      names.flatMap(([name, speed]) => {
        const rows = results.flatMap((r) => {
          const row = r.rows.find((x) => x.name === name);
          const ours = row && fitted(row);
          return row && ours ? [{ row, ours }] : [];
        });
        if (!rows.length) return [];
        return [
          [
            name,
            String(rows.length),
            zeroPhaseGain(speed, report.filter.order, report.filter.cutoff_hours).toFixed(4),
            mm(median(abs(rows.map((x) => x.ours.d.amplitude))), 3),
            percent(median(abs(rows.map((x) => x.ours.d.relative))), 2),
            median(abs(rows.map((x) => x.ours.d.phase)))?.toFixed(2) ?? "",
            mm(median(rows.map((x) => x.ours.d.vector)), 3),
            speed < LONG_PERIOD ? "" : String(rows.filter((x) => outside(x.row)).length),
            mm(median(rows.map((x) => x.ours.unscaled)), 3),
          ],
        ];
      }),
    ),
  );
  const sa = results.flatMap((r) => {
    const row = r.rows.find((x) => x.candidate === "SA_KV");
    const ours = row && fitted(row);
    return row && ours && r.sa_long ? [{ period: ours.d.vector, long: r.sa_long.vector }] : [];
  });
  p(
    `Kartverket doesn't say which years its long-period constants are from.${sa.length ? ` SA fitted over the gauge's period is a median ${mm(median(sa.map((x) => x.period)), 1)} mm from Kartverket's, and fitted over ${SA_YEARS[0]} to ${SA_YEARS[1]}, at the ${sa.length} gauges the store holds each of those years whole for, ${mm(median(sa.map((x) => x.long)), 1)} mm.` : ""} The long-period constituents are in each gauge's table and in no count.`,
  );

  p("## Each gauge");
  p(
    "Kartverket's constants, with phases moved to UTC, then the fit's difference from them, the fit's minus Kartverket's, with the fit's amplitude scaled by the gain. ±A and ±g are the half-widths of the fit's 95% intervals. A ratio in bold is outside the interval.",
  );
  for (const r of results) {
    p(`### ${r.name} (\`${r.id}\`)`);
    p(
      `${years(r)}: ${r.hours.toLocaleString("en-US")} hourly values.${r.sa_long ? ` SA over ${SA_YEARS[0]} to ${SA_YEARS[1]} is ${mm(r.sa_long.amplitude, 1)} mm at ${r.sa_long.phase.toFixed(1)}°, ${mm(r.sa_long.vector, 1)} mm from Kartverket's.` : ""}`,
    );
    p(
      table(
        [
          "Constituent",
          "Kartverket A (mm)",
          "Kartverket g (°)",
          "Gain",
          "ΔA (mm)",
          "ΔA (%)",
          "Δg (°)",
          "Vector (mm)",
          "±A (mm)",
          "±g (°)",
          "Ratio",
          "Without the gain: vector (mm)",
          "Filtered in time: vector (mm)",
        ],
        [...r.rows]
          .sort((a, b) => a.speed - b.speed)
          .map((row) => {
            const ours = fitted(row);
            const head = [
              row.name,
              mm(row.kartverket.amplitude, 2),
              row.kartverket.phase.toFixed(2),
            ];
            if (!ours)
              return [...head, (row.ours as { reason: string }).reason, ...Array(9).fill("")];
            return [
              ...head,
              ours.gain.toFixed(4),
              signed(ours.d.amplitude * 1000, 2),
              signed(ours.d.relative === null ? null : ours.d.relative * 100, 2),
              signed(ours.d.phase, 2),
              mm(ours.d.vector, 2),
              mm(ours.amplitude_ci === null ? null : ours.amplitude_ci * ours.gain, 2),
              ours.phase_ci === null ? "" : ours.phase_ci.toFixed(2),
              ratio(ours.d.ratio),
              mm(ours.unscaled, 2),
              mm(row.filtered, 2),
            ];
          }),
      ),
    );
  }
  return out.join("\n").replace(/\n+$/, "\n");
}
