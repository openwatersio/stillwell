import { ROUNDING } from "../sources/kartverket/constants.ts";
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
/** From this speed up, 4.5 cycles a day, the filter's gain is far enough from one to be estimated. */
export const FILTERED_FROM = 67.5;
/** A year is whole where the store holds this share of its hours. */
export const YEAR_SHARE = 2 / 3;
/** A gauge with this many constants outside is fitted again with each year left out. */
export const PROBE_FROM = 5;

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
  /** The seconds past one hour the fitted phases ask Kartverket's to be moved by. */
  phase_seconds: number;
  /** Terrestrial time minus UTC over the period, which the comparison moves them by. */
  tt_seconds: number;
  /** SA fitted over 1991 to 2020 against Kartverket's, in meters, where the store holds every year whole. */
  sa_long: { amplitude: number; phase: number; vector: number } | null;
  /** The store's own fit: its held-out year and scores. */
  standard: { held_out: number; variance: number | null; rms: number | null; kept: number };
  /** With each year left out in turn: the constants outside and the mean vector difference. */
  probe: { year: number; outside: number; vector: number }[] | null;
  rows: Row[];
}

export interface Report {
  engine: string;
  method: number;
  final_year: number;
  filter: typeof FILTER;
  results: Result[];
}

type Fitted = Exclude<Row["ours"], { reason: string }>;
const fitted = (row: Row): Fitted | null => ("reason" in row.ours ? null : row.ours);
const isLong = (row: Row) => row.speed < LONG_PERIOD;
const outside = (row: Row) => (fitted(row)?.d.ratio ?? 0) > 1;

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
    let best = { order, cutoff_hours: 2.5, misfit: Infinity };
    for (let c = 250; c <= 350; c++) {
      const m = misfit(order, c / 100);
      if (m < best.misfit) best = { order, cutoff_hours: c / 100, misfit: m };
    }
    return best;
  });
  return {
    constants: used.length,
    orders,
    best: orders.reduce((a, b) => (b.misfit < a.misfit ? b : a)),
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
  const MAJOR = ["M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1"];
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
    `Kartverket, the Norwegian Mapping Authority's Hydrographic Service, publishes harmonic constants for its gauges, analyzed with UTide from the observations the store holds as \`kartverket\`. This report fits ${results.length} of those gauges from the store the way Kartverket analyzes them and compares the constants with Kartverket's, constituent by constituent. It is written by [\`scripts/calibrate-kartverket.ts\`](../../scripts/calibrate-kartverket.ts) (\`npm run calibrate:kartverket\`), with every number in [kartverket-calibration.json](kartverket-calibration.json), and is run again whenever the method changes. [Checks](../contributing/checks.md#fit-calibration) says how to run it, and the [calibration against NOAA](fit-calibration.md) is its companion.`,
  );
  p(
    `These fits ran with ${report.engine}, method ${report.method} of [\`src/fit/\`](../../src/fit/), and ${report.final_year} as the source's last year of final values.`,
  );

  p("## What is compared");
  p(
    "Kartverket's constants are from its tide API's `constituents` request, which gives amplitudes in centimeters, to a hundredth, and phases to a hundredth of a degree against UTC+1, with the period of observations analyzed ([Kartverket](../../src/sources/kartverket/README.md)). Kartverket analyzes with UTide. The fit compared here takes that method to the store's values: one least-squares fit over Kartverket's period, without robust weights, of Kartverket's own constituents, with Foreman's nodal corrections at the gauge's latitude evaluated at each sample. It reads the store's final values on the hour.",
  );
  p(
    `Two things about Kartverket's analysis aren't documented and are taken from the comparison itself, so on them it shows consistency and is no independent check:`,
  );
  p(
    `- **The filter.** Kartverket's constants are smaller than the fit's above four cycles a day, by the gain of a low-pass filter: its analysis read a series filtered beyond the 10-minute values its API serves. The fit's amplitudes and their intervals are scaled by the gain of a zero-phase Butterworth filter of order ${report.filter.order} with a cutoff of ${report.filter.cutoff_hours} hours, which [The filter](#the-filter) estimates from the constants at ${FILTERED_FROM}° an hour and faster. Below that speed the gain is within ${percent(1 - zeroPhaseGain(FILTERED_FROM - 7.5, report.filter.order, report.filter.cutoff_hours), 2)}% of one, so the diurnal, semidiurnal, third- and fourth-diurnal constants are compared as fitted, to within that.`,
    `- **The clock.** Kartverket's phases are moved to UTC by the constituent's speed over one hour and over terrestrial time minus UTC, about 67 s. [Gauges](#gauges) gives the seconds each gauge's fitted phases ask for.`,
  );
  p(
    `A constituent is **outside** where its amplitude or phase differs from Kartverket's by more than the fit's 95% interval, widened in quadrature by half of Kartverket's last digit (${mm(ROUNDING.amplitude, 2)} mm and ${ROUNDING.phase}°). Constituents slower than ${LONG_PERIOD}° an hour are counted apart.`,
  );
  p(
    "Kartverket's constants aren't scored on a held-out year here. Predicting from them needs Foreman's corrections, which the engine release these fits ran with fits under and doesn't predict under. The store's own fit of each gauge is scored, in [Gauges](#gauges).",
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
    `Over the ${estimate.constants} constants at ${FILTERED_FROM}° an hour and faster of 0.5 mm or more, the RMS difference between the fit's amplitude and Kartverket's is ${mm(estimate.none, 3)} mm with no filter. For each even order, the cutoff that leaves the least, searched from 2.50 to 3.50 hours by hundredths:`,
  );
  p(
    table(
      ["Order", "Cutoff (hours)", "RMS difference (mm)"],
      estimate.orders.map((o) => [String(o.order), o.cutoff_hours.toFixed(2), mm(o.misfit, 4)]),
    ),
  );
  p(
    `The comparison uses order ${report.filter.order} and ${report.filter.cutoff_hours} hours, which leaves ${mm(estimate.pinned, 4)} mm.${estimate.best.order === report.filter.order && estimate.best.cutoff_hours === report.filter.cutoff_hours ? " That is the least of all." : ` The least is order ${estimate.best.order} at ${estimate.best.cutoff_hours.toFixed(2)} hours.`} The filter is estimated from the constants it is then used to compare, so agreement at these speeds says the constants are consistent with one such filter at every gauge, and nothing more.`,
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
      `The other way to allow for the filter is to run the store's 10-minute values through it and fit what comes out. That was done for each gauge, with gaps of up to an hour filled in a straight line, a day dropped at each end of a run of values, and the result read on the hour. The median vector difference from Kartverket's constants is ${of(both)} over all short-period constituents, and ${of(both.filter((x) => x.row.speed >= FILTERED_FROM))} at ${FILTERED_FROM}° an hour and faster. The filtered series loses the values around every gap, which the gain doesn't, so the comparison scales by the gain.`,
    );
  }

  p("## Gauges");
  p(
    "Each gauge's period as Kartverket gives it, the hourly values the fit read, how many constituents are compared and outside, the one furthest outside, and the seconds past one hour its phases ask Kartverket's to be moved by, from the constituents faster than 10° an hour weighted by amplitude. The last three columns are the store's own fit of the gauge, of 19 years with Schureman's corrections: its held-out year, the share of the tidal band's variance it explains there and the tidal-band RMS left.",
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
        "Held-out year",
        "Variance explained",
        "RMS (mm)",
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
          r.phase_seconds.toFixed(1),
          String(r.standard.held_out),
          r.standard.variance === null ? "" : `${percent(r.standard.variance, 2)}%`,
          mm(r.standard.rms),
        ];
      }),
      2,
    ),
  );
  const asked = results.map((r) => r.phase_seconds);
  p(
    `Terrestrial time minus UTC over these periods is ${Math.min(...results.map((r) => r.tt_seconds)).toFixed(1)} to ${Math.max(...results.map((r) => r.tt_seconds)).toFixed(1)} s. The fitted phases ask for a median of ${median(asked)?.toFixed(1)} s, from ${Math.min(...asked).toFixed(1)} to ${Math.max(...asked).toFixed(1)} s.`,
  );
  const short = results.filter((r) => r.short_years.length);
  if (short.length)
    p(
      `The store holds under two thirds of the hours of ${short.map((r) => `${r.short_years.join(", ")} at ${r.name}`).join("; ")}. The fit reads those years as they are, as one fit of the whole period does.`,
    );
  const marked = results.filter((r) => r.marked);
  if (marked.length)
    p(
      `The copy of the store these fits read marked ${marked.map((r) => `\`${r.id}\``).join(", ")} as being written. The script checks that each year file in the copy has a row in the copy's years file with that file's version before it drops the marker.`,
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
      const best = [...r.probe!].sort((a, b) => a.outside - b.outside)[0]!;
      p(
        `${r.name} has ${base} outside, so it was fitted again with each year of the period left out in turn. That leaves from ${best.outside} (without ${best.year}) to ${Math.max(...r.probe!.map((x) => x.outside))} outside${best.outside * 2 < base ? ", so the year left out accounts for most of it" : ", so no one year accounts for it"}. This report doesn't find why ${r.name}'s constants differ.`,
      );
    }
  }

  p("## Constituents across gauges");
  p(
    "For each of Kartverket's constituents, over the gauges where the fit has it: the filter's gain at its speed, the median differences from Kartverket's without sign, how many are outside, and the median vector difference without the gain.",
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
            String(rows.filter((x) => outside(x.row)).length),
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
    `Kartverket doesn't say which years its long-period constants are from.${sa.length ? ` SA fitted over the gauge's period is a median ${mm(median(sa.map((x) => x.period)), 1)} mm from Kartverket's, and fitted over 1991 to 2020, at the ${sa.length} gauges the store holds each of those years whole for, ${mm(median(sa.map((x) => x.long)), 1)} mm.` : ""} The long-period constituents are in each gauge's table and in no count.`,
  );

  p("## Each gauge");
  p(
    "Kartverket's constants, with phases moved to UTC, then the fit's difference from them, the fit's minus Kartverket's, with the fit's amplitude scaled by the gain. ±A and ±g are the half-widths of the fit's 95% intervals. A ratio in bold is outside the interval.",
  );
  for (const r of results) {
    p(`### ${r.name} (\`${r.id}\`)`);
    p(
      `${years(r)}: ${r.hours.toLocaleString("en-US")} hourly values.${r.sa_long ? ` SA over 1991 to 2020 is ${mm(r.sa_long.amplitude, 1)} mm at ${r.sa_long.phase.toFixed(1)}°, ${mm(r.sa_long.vector, 1)} mm from Kartverket's.` : ""}`,
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
