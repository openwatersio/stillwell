import { difference, median, phaseDifference, type Difference } from "./calibration.ts";

/**
 * The fit calibration's results and the report written from them
 * (docs/results/fit-calibration.md). `scripts/calibrate-fits.ts` fits the
 * stations and fills a `Report`; everything here is arithmetic on one, so the
 * Markdown can be written again from the JSON, and tested, without a fit.
 */

/** NOAA publishes amplitudes to the millimeter and phases to a tenth of a degree. */
export const ROUNDING = { amplitude: 0.0005, phase: 0.05 };
/**
 * Slower than this, in degrees an hour, a constituent is long-period. NOAA
 * takes those from other spans than its analysis years, or leaves them out,
 * as each station's comment says, so they are compared apart from the rest.
 */
export const LONG_PERIOD = 2.5;
/** A year of NOAA's is fitted by itself where it has this share of its hours, as the yearly scatter asks. */
export const YEAR_SHARE = 2 / 3;
/** The held-out year whose scores the shallow-water compounds were proposed on, so that year can't also test them. */
export const PROPOSED_ON = 2025;
/** A constant NOAA's method misses by more than this, in meters, is named as open by itself, however few its station has. */
export const LARGE_MISS = 0.005;

export interface Constant {
  name: string;
  amplitude: number;
  phase: number;
}

/** A fit's side of one row: its constant and the difference from NOAA's, or why it has none. */
export type Side =
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

export interface Row {
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
export const STEPS = ["yearly", "exact", "joint", "robust"] as const;
export type Step = (typeof STEPS)[number];

export interface Score {
  /** Share of the tidal band's variance explained on the held-out year. */
  variance: number | null;
  /** Tidal-band RMS on the held-out year, in meters. */
  rms: number | null;
  /** Whether the constants were fitted from years that include the held-out one. */
  seen: boolean;
}

export interface Result {
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
  /**
   * The store's fit of NOAA's years again with one change: each line it holds under an earlier
   * candidate's name is fitted under NOAA's. `held` gives the store's name for each of NOAA's, and
   * `rows` those constituents against NOAA's. Null where the fit holds every line under NOAA's name.
   */
  renamed: { held: Record<string, string>; score: Score; rows: Record<string, Side> } | null;
  /**
   * The fits again with the shallow-water compounds (`SHALLOW`) after the candidates: the standard
   * window scored on the held-out year and on `year_before`, the year before the window, which
   * neither fit read, and NOAA's years scored on the held-out year. `before` is null where the
   * store holds under half of that year.
   */
  tier: {
    year_before: number;
    without: { before: Score | null };
    with: { kept: number; held: Score; before: Score | null; window_kept: number; window: Score };
  };
  /** The years of NOAA's fitted by themselves. */
  yearly: number[];
  rows: Row[];
}

/** What `leak` measured when the fits ran, in meters for a tide of 1 m. */
export interface Leak {
  K1: Record<string, [number, number]>;
  K2: Record<string, [number, number]>;
  /** The most any of them holds with node factors at each sample. */
  exact: number;
}

export interface Report {
  engine: string;
  /** `calibrationDigest` when the fits ran: the lists and spellings the comparison rests on, which `method` doesn't count. */
  inputs: string;
  leak: Leak;
  method: number;
  node_corrections: string;
  final_year: number;
  results: Result[];
}

export const yearSpan = (y: number) => ({ start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) });

export const mm = (m: number | null | undefined, digits = 1) =>
  m === null || m === undefined ? "" : (m * 1000).toFixed(digits);
export const signed = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined
    ? ""
    : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;
export const percent = (x: number | null | undefined, digits = 1) =>
  x === null || x === undefined ? "" : (x * 100).toFixed(digits);
export const ratio = (x: number | null) =>
  x === null ? "" : x > 1 ? `**${x.toFixed(1)}**` : x.toFixed(1);
export const table = (head: string[], rows: string[][], left = 1) =>
  [
    `| ${head.join(" | ")} |`,
    `| ${head.map((_, i) => (i < left ? "---" : "---:")).join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

/** How far apart two constants are as vectors, in meters. */
export const apart = (
  a: { amplitude: number; phase: number },
  b: { amplitude: number; phase: number },
) => difference({ name: "", ...a }, { name: "", ...b }, ROUNDING).vector;
export const fittedSide = (s: Side) => ("reason" in s ? null : s);
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

export function render(report: Report): string {
  const { results } = report;
  // The findings compare scores, so a report without one, or with no station to compare on, isn't written.
  for (const r of results)
    for (const score of [
      r.tier.with.held,
      r.tier.with.window,
      r.scores.standard,
      r.scores.window,
      r.scores.noaa,
      ...Object.values(r.scores.steps),
      ...(r.renamed ? [r.renamed.score] : []),
    ])
      if (score.rms === null || score.variance === null)
        throw new Error(`${r.id} has a set of constants with no score on ${r.held_out}`);
  if (!results.some((r) => !r.scores.window.seen))
    throw new Error(
      "every station's NOAA years include its held-out year, so no score is out of sample",
    );
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
    `NOAA CO-OPS publishes harmonic constants for its own gauges, analyzed from its own observations of them, which the store holds as \`coops\`, under Schureman's nodal corrections, which the [fits](../fits.md) use too. This report fits ${results.length} of those gauges from the store and compares the constants with NOAA's, constituent by constituent. It is written by [\`scripts/calibrate-fits.ts\`](../../scripts/calibrate-fits.ts) (\`npm run calibrate:fits\`), with every number in [fit-calibration.json](fit-calibration.json), and is run again whenever the method changes. [Checks](../contributing/checks.md#fit-calibration) says how to run it.`,
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
    "- **NOAA's years.** The store's method, [`fitSamples`](../../src/fit/window.ts), over the years NOAA analyzed. The years are the same, so the differences are the method's: one fit over all the years with node factors at each sample, robust weights, and the candidate list in place of NOAA's constituents.",
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
      `The copy of the store these fits read marked ${marked.map((r) => `\`${r.id}\``).join(", ")} as being written, which the fit's reader refuses. The script checks for every station that each year file in the copy has a row in the copy's years file with that file's version, and stops where one doesn't. With that shown, it drops the marker and reads those stations as it reads the rest.`,
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
  const order = new Map(results.flatMap((r) => r.rows.map((x) => [x.name, x.speed] as const)));
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

  p("## The shallow-water compounds");
  p(
    `No fit starts from the shallow-water compounds NOAA publishes for Anchorage beyond its 37 ([\`SHALLOW\`](../../src/fit/candidates.ts)). Here each gauge is fitted again with them after the candidate list, over the standard window and over NOAA's years, so the report shows what they would change. ${results.every((r) => r.held_out === PROPOSED_ON) ? "The held-out year is the evidence they were proposed on, so it can't also test them." : `They were proposed on what ${PROPOSED_ON} showed.`} The year before the window was read by neither fit and has judged no choice of candidates. A figure in brackets is from constants fitted from years that include the held-out one.`,
  );
  const side = (x: Score | null) => (x ? mm(x.rms) : "");
  p(
    table(
      [
        "Station",
        "Standard: kept without",
        "Kept with",
        "Held-out year: without (mm)",
        "With (mm)",
        "Year before",
        "Without (mm)",
        "With (mm)",
        "NOAA's years: kept without",
        "Kept with",
        "Held-out year: without (mm)",
        "With (mm)",
      ],
      results.map((r) => [
        `\`${r.id}\` ${r.name}`,
        String(r.standard.kept),
        String(r.tier.with.kept),
        mm(r.scores.standard.rms),
        mm(r.tier.with.held.rms),
        String(r.tier.year_before),
        side(r.tier.without.before),
        side(r.tier.with.before),
        String(r.window.kept),
        String(r.tier.with.window_kept),
        scored(r.scores.window, (x) => mm(x.rms)),
        scored(r.tier.with.window, (x) => mm(x.rms)),
      ]),
    ),
  );
  p(tierFinding(results));

  p("## Each station");
  p(
    "NOAA's constants, then each fit's difference from them, the fit's minus NOAA's. ±A and ±g are the half-widths of the fit's 95% intervals. A ratio in bold is outside the interval. Where a fit holds a line under another name, the name is in brackets. A fit without the constituent says why: `snr` is under the signal-to-noise limit, `rayleigh` names the constituent the record can't separate it from, and `seasonal` is Sa or Ssa under twice the standard error of its yearly fits.",
  );
  for (const r of results) {
    p(`### ${r.name} (\`${r.id}\`)`);
    p(
      [
        `NOAA: "${r.comment.replace(/\s+/g, " ").trim()}"`,
        `NOAA's years, ${spans(r.years)}: ${r.window.hours.toLocaleString("en-US")} hourly values, ${r.window.kept} constituents kept.`,
        `Standard, ${r.standard.since.slice(0, 4)} to ${+r.standard.until.slice(0, 4) - 1}: ${r.standard.hours.toLocaleString("en-US")} hourly values, ${r.standard.kept} kept.`,
        r.unknown.length
          ? `The engine's catalog has no line that is NOAA's ${r.unknown.join(", ")}, which no fit or prediction here holds as NOAA's.`
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

/** The change the shallow-water compounds make to one score at each station that has it, in meters. */
function tierChanges(results: Result[], which: "held" | "before" | "window") {
  return results.flatMap((r) => {
    const [a, b] =
      which === "held"
        ? [r.scores.standard.rms, r.tier.with.held.rms]
        : which === "before"
          ? [r.tier.without.before?.rms ?? null, r.tier.with.before?.rms ?? null]
          : r.scores.window.seen
            ? [null, null]
            : [r.scores.window.rms, r.tier.with.window.rms];
    return a === null || b === null ? [] : [{ r, change: b - a }];
  });
}

function tierFinding(results: Result[]): string {
  const say = (which: "held" | "before" | "window") => {
    const changes = tierChanges(results, which);
    if (!changes.length) return "no station can be scored";
    const higher = changes.filter((x) => x.change >= 0.0001);
    const lower = changes.filter((x) => x.change <= -0.0001);
    const most = [...changes].sort((a, b) => a.change - b.change)[0]!;
    return `the RMS is lower at ${lower.length} and higher at ${higher.length} of ${changes.length} stations${higher.length ? ` (${higher.map((x) => `${x.r.name} ${signed(x.change * 1000)} mm`).join(", ")})` : ""}${lower.length ? `, and falls most at ${most.r.name}, by ${mm(-most.change)} mm` : ""}`;
  };
  return `With the compounds, over the standard window and on the held-out year, ${say("held")}. On the year before the window ${say("before")}. Over NOAA's years, ${[...new Set(results.map((r) => r.years.length))].sort((a, b) => a - b).join(" or ")} at a station, on the held-out year ${say("window")}. A change under 0.1 mm counts as neither.`;
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
    return `lower at ${lower.length} and higher at ${higher.length} of ${xs.length}, from ${signed(Math.min(...xs) * 1000)} to ${signed(max(xs) * 1000)} mm, a change under 0.1 mm counting as neither`;
  };
  const versus = (a: (r: Result) => Score, b: (r: Result) => Score) =>
    unseen.filter((r) => a(r).rms! < b(r).rms!).length;
  // A bound, so it is rounded up.
  const reproduces =
    Math.ceil(
      max(results.map((r) => Math.abs(r.scores.steps.yearly.rms! - r.scores.noaa.rms!))) * 10_000 -
        1e-6,
    ) / 10;

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
  const published = pairs(results, "window", false).filter((x) => x.row.noaa.amplitude > 0);
  const zeros = pairs(results, "window", false).length - published.length;
  for (const x of published)
    if ((x.s.d.ratio ?? 0) > 1) outside.set(x.row.name, (outside.get(x.row.name) ?? 0) + 1);
  const often = [...outside].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const count = (name: string) => outside.get(name) ?? 0;
  const stations = (name: string) =>
    results.filter((r) =>
      r.rows.some((x) => x.name === name && x.noaa.amplitude > 0 && fittedSide(x.window)),
    ).length;

  const { K1: k1, K2: k2, exact } = report.leak;
  /** Of the constants of `name` outside the interval, how many have step `i` as the largest of the four. */
  const largestOf = (name: string, i: number) => {
    const sizes = results.flatMap((r) => {
      const row = r.rows.find((x) => x.name === name && x.noaa.amplitude > 0);
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
    const count = sizes.filter((x) => x[i] === Math.max(...x)).length;
    return {
      name,
      most: count * 2 > sizes.length,
      text: `${count} of ${name}'s ${sizes.length} outside`,
    };
  };
  const largest = (name: string, i: number) => largestOf(name, i).text;
  const list = (xs: string[]) =>
    xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? "");
  /** Whether step `i` is the largest for most of each name's constants outside, as a sentence. */
  const accounts = (names: string[], i: number) => {
    const all = names.map((name) => largestOf(name, i));
    const [most, rest] = [all.filter((x) => x.most), all.filter((x) => !x.most)];
    const of = (xs: typeof all) => list(xs.map((x) => `${x.name}'s`));
    return `It is the largest step for ${list(all.map((x) => x.text))}${
      most.length
        ? `: most of ${of(most)}${rest.length ? `, and half or fewer of ${of(rest)}, which it doesn't account for` : ""}`
        : ", half or fewer of each, so it doesn't account for them"
    }.`;
  };
  const leaks = Math.min(k1.S1![0], k1.P1![0], k2.R2![0]) > exact;
  const l2 = largestOf("L2", 1);
  const moved = (name: string) =>
    results.flatMap((r) => {
      const row = r.rows.find((x) => x.name === name);
      const [x, y] = [row && fittedSide(row.window), row && fittedSide(row.standard)];
      return x && y ? [apart(y, x)] : [];
    });
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

  /** The names the fits of NOAA's years hold NOAA's `name` under, where they aren't NOAA's. */
  const heldAs = (name: string) => [
    ...new Set(
      results.flatMap((r) => {
        const side = fittedSide(r.rows.find((x) => x.name === name)?.window ?? { reason: "" });
        return side?.as ? [side.as] : [];
      }),
    ),
  ];
  // Stations where the candidate list predicts worse than NOAA's own constituents under the same method.
  const short37 = unseen.filter((r) => r.scores.window.rms! - r.scores.steps.robust.rms! >= 0.001);
  const unexplained = worst.filter(([, c]) => c >= 5).map(([name]) => name);
  // A large miss is open wherever it is, so a station with few of them doesn't pass as explained.
  const large = over.filter((x) => x.step.vector > LARGE_MISS && !unexplained.includes(x.r.name));
  const open = [
    ...unexplained.map((name) => `at ${name}`),
    ...large.map((x) => `for ${x.row.name} at ${x.r.name}`),
  ];

  const agrees = within(0.001) >= 0.95 * short.length;
  const renames = [...new Map(results.flatMap((r) => Object.entries(r.renamed?.held ?? {})))];
  const renamedChange = unseen.flatMap((r) =>
    r.renamed ? [r.renamed.score.rms! - r.scores.window.rms!] : [],
  );

  const unexplainedYears = results
    .filter((r) => unexplained.includes(r.name))
    .map((r) => {
      const [year, hours] = Object.entries(r.window.by_year).sort((a, b) => a[1] - b[1])[0]!;
      const all = (yearSpan(+year).end - yearSpan(+year).start) / 3_600_000;
      return `The least complete of ${r.name}'s years in the store is ${year}, with ${hours.toLocaleString("en-US")} of ${all.toLocaleString("en-US")} hours.`;
    })
    .join(" ");

  const lines: string[] = [];
  const p = (...x: string[]) => lines.push(...x.filter(Boolean), "");
  p("### What agrees");
  p(
    `- **NOAA's method on the store's values${agrees ? " gives NOAA's constants" : ""}.** Fitted NOAA's way, ${within(0.0005)} of ${short.length} short-period constants are within 0.5 mm of NOAA's as vectors, which is half of NOAA's last digit, and ${within(0.001)} are within 1 mm. The major constituents of 1 cm or more differ by a median of ${percent(median(relative), 2)}% in amplitude and ${median(phase)!.toFixed(2)}° in phase, and at most by ${percent(max(relative), 2)}% and ${max(phase).toFixed(2)}°. Those constants score within ${reproduces.toFixed(1)} mm RMS of NOAA's own on the held-out year at each of the ${results.length} stations. The comparison reads the store's hourly values with Schureman's corrections as the engine has them and Greenwich phase lags in UTC, so an error in any of the three would show here as a difference from NOAA.`,
    `- **The store's method over NOAA's years, on the major constituents.** Their amplitudes differ by a median of ${percent(median(pairsOf(results, "window", MAJOR).relative), 2)}% and their phases by ${median(pairsOf(results, "window", MAJOR).phase)!.toFixed(2)}°. ${w.majorOutside} of ${w.major} are outside the fit's interval, and the next section says which steps of the method move them.`,
    `- **The standard fit predicts the held-out year better than NOAA's constants at ${better} of ${unseen.length} stations** whose NOAA analysis didn't read that year${behind.length ? `; the rest: ${behind.map((r) => r.name).join(", ")}` : ""}. It explains ${percent(Math.min(...variances), 1)}% to ${percent(max(variances), 1)}% of the tidal band's variance, the least at ${lowest.name}.`,
  );
  p(
    `- **The shallow-water compounds.** ${tierFinding(results)} [The shallow-water compounds](#the-shallow-water-compounds) has each station.`,
  );
  p("### What differs, and why");
  p(
    `In the fit of NOAA's years, ${w.outside} of ${w.compared} short-period constants are outside the fit's interval${zeros ? `, counting the ${zeros} NOAA publishes as zero, which the counts by constituent here leave out` : ""}. The constituents most often outside are ${often.map(([name, c]) => `${name} (${c})`).join(", ")}. [Where the differences come from](#where-the-differences-come-from) takes the method apart one step at a time, and the counts here are of the step that moves a constant furthest:`,
  );
  p(
    `- **Robust weights.** With them the amplitude is higher than in the same fit without them for ${["M2", "S2", "O1", "M4"].map(raised).join(", ")}. M2 moves most at ${m2
      .slice(0, 3)
      .map((x) => `${x.r.name} (${mm(x.moved)} mm of ${mm(x.noaa.amplitude, 0)})`)
      .join(
        ", ",
      )}. They are the largest of the four steps for ${largest("M2", 2)} and ${largest("M4", 2)}. On the held-out year they leave the tidal-band RMS ${tally(change(3))}. NOAA's analysis has no such weights.`,
    ...["M1", "2MK3"].map((name) => {
      const as = heldAs(name);
      if (!as.length) return "";
      const again = results.flatMap((r) => {
        const side = r.renamed?.rows[name];
        const published = r.rows.some((x) => x.name === name && x.noaa.amplitude > 0);
        return side && published && !("reason" in side) ? [side] : [];
      });
      const outsideAgain = again.filter((x) => (x.d.ratio ?? 0) > 1).length;
      return `- **${name} is held as ${as.join(" or ")}.** The candidate list has the line under both names, and selection keeps the earlier one, with the node factor the engine gives that name and not NOAA's for ${name}. ${count(name)} of ${stations(name)} are outside, and the step to the candidate list is the largest for ${largest(name, 3)}. That step changes the rest of the list too, so the fit of NOAA's years was run again with only the name changed back: as ${name}, ${outsideAgain} of ${again.length} are outside. ${outsideAgain * 2 < count(name) ? "The name accounts for most of the difference." : "The name alone doesn't account for the difference."}`;
    }),
    `- **Node factors at each sample.** K1's node factor changes within a year. Held at its mid-year value, as NOAA holds it, a K1 of 1 m alone leaves ${perMeter(k1.S1!)} in S1 and ${perMeter(k1.P1!)} in P1 in a one-year fit, depending on the year, and a K2 of 1 m leaves ${perMeter(k2.R2!)} in R2. With node factors at each sample the same fits leave at most ${mm(exact, 2)} mm.${leaks ? " A year fitted NOAA's way therefore puts that part of K1 and K2 into S1, P1 and R2." : ""} ${accounts(["S1", "P1", "R2"], 0)}`,
    `- **One fit of all years.** Fitting the years together in place of averaging yearly fits is the largest step for ${l2.text}${l2.most ? ". L2 shares its frequency with 2MN2, whose node factor differs ([M1 and L2](../fits.md#what-it-costs)), and a line that doesn't follow L2's factor from year to year would give this. The report doesn't measure 2MN2, so that cause isn't shown." : ", half or fewer, so it doesn't account for L2's."}`,
    `- **The standard fit reads other years.** ${s.outside} of ${s.compared} of its constants are outside the interval, which 19 years make narrow. [Constituents across stations](#constituents-across-stations) gives how far the standard fit is from the store's own fit of NOAA's years, which is what the two periods differ by under one method: M2 is a median ${mm(median(moved("M2")), 1)} mm from one period's fit to the other's and K1 ${mm(median(moved("K1")), 1)} mm.`,
    "- **Long-period constituents.** NOAA takes Sa, Ssa, Mm, Msf and Mf from other spans than its analysis years, as each station's comment says, or publishes zero for them. They are in each station's table and in no count.",
    over.length
      ? `- **NOAA's method misses NOAA's constants by over 1 mm for ${n(over.length, "constant")}:** ${worst.map(([name, c]) => `${c} at ${name}`).join(", ")}.${unexplained.length ? ` At ${unexplained.join(" and ")} it is five or more, and this report doesn't find why. ${unexplainedYears}` : ""}${large.length ? ` It misses ${list(large.map((x) => `${x.row.name} at ${x.r.name} by ${mm(x.step.vector)} mm of ${mm(x.row.noaa.amplitude, 0)}`))}, over ${mm(LARGE_MISS, 0)} mm, and this report doesn't find why either.` : ""}`
      : "",
  );
  p("### Defects");
  p(
    ...short37.map(
      (r) =>
        `- **Over NOAA's years the candidate list and its selection predict worse than NOAA's constituents at ${r.name}.** ${r.unlisted.length ? `NOAA publishes ${r.rows.length + r.unlisted.length} constituents there, ${r.unlisted.length} of which the candidate list doesn't have. ` : ""}Fitted by the store's method with NOAA's constituents, NOAA's years predict the held-out year to ${mm(r.scores.steps.robust.rms)} mm RMS. With the candidate list they give ${mm(r.scores.window.rms)} mm, of ${r.window.kept} constituents kept. The standard fit, of 19 years, gives ${mm(r.scores.standard.rms)} mm, and NOAA's constants ${mm(r.scores.noaa.rms)} mm. With the shallow-water compounds after the candidates the standard fit gives ${mm(r.tier.with.held.rms)} mm.`,
    ),
    renames.length
      ? `- **Lines held under another name take that name's node factor.** ${renames.map(([name, as]) => `${name} is fitted as ${as}`).join(" and ")}, under Schureman's corrections as the engine gives them for those names. With NOAA's names in their place and nothing else changed, the fit of NOAA's years scores the held-out year ${tally(renamedChange)}.`
      : "",
    short37.length
      ? ""
      : "- **Over NOAA's years the candidate list and its selection predict no worse than NOAA's constituents at any station**, by 1 mm RMS or more on the held-out year.",
    agrees
      ? `- **None shown in the engine's solver, in Schureman's corrections for the names NOAA uses, or in the phase convention.** NOAA's method run through them gives NOAA's constants, as above${open.length ? `, except ${list(open)}, which ${open.length > 1 ? "are" : "is"} open` : ""}. Each step from it to the store's method is a choice [Harmonic fits](../fits.md) makes, with its effect in the tables here.`
      : "- **NOAA's method doesn't give NOAA's constants.** Under 95% of the constants fitted NOAA's way are within 1 mm of NOAA's, so the engine, the corrections, the phases or the store's values differ from NOAA's.",
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
