import { constituents as catalog } from "@slackwater/engine";

/**
 * Kartverket's published harmonic constants for a gauge, from the tide API's
 * `constituents` request, as a fit on the store's UTC times can be compared
 * with them. The README's Constants entry has what Kartverket states and
 * what was measured.
 */

/**
 * Kartverket's names that aren't the catalog's for the same line. SA, S1 and
 * OQ2 are Kartverket's own definitions of those names, which the catalog
 * holds apart from the lines other sources call the same.
 */
const NAMES: Record<string, string> = {
  SA: "SA_KV",
  S1: "S1_KV",
  OQ2: "OQ2_KV",
  EPS2: "eps2",
  GAM2: "gamma2",
  H1: "alpha2",
  H2: "M(KS)2",
  LDA2: "lambda2",
  SIG1: "sigma1",
  THE1: "theta1",
};

/** Kartverket publishes amplitudes to a hundredth of a centimeter and phases to a hundredth of a degree: half of each. */
export const ROUNDING = { amplitude: 0.00005, phase: 0.005 };

/** TAI minus UTC from each date on, in seconds, over the years Kartverket's analyses cover. */
const LEAP_SECONDS: [since: number, seconds: number][] = [
  [Date.UTC(1999, 0, 1), 32],
  [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34],
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

/**
 * Terrestrial time minus UTC, in seconds, averaged from `start` to `end`
 * (epoch ms): 32.184 s and the leap seconds in force. Throws before 1999,
 * which the table doesn't cover.
 */
export function ttMinusUtc(start: number, end: number): number {
  if (!(start < end) || start < LEAP_SECONDS[0]![0])
    throw new Error("no leap seconds listed for that period");
  let sum = 0;
  for (const [i, [since, seconds]] of LEAP_SECONDS.entries()) {
    const until = LEAP_SECONDS[i + 1]?.[0] ?? Infinity;
    sum += seconds * Math.max(0, Math.min(end, until) - Math.max(start, since));
  }
  return 32.184 + sum / (end - start);
}

export interface PublishedConstant {
  /** The catalog's name for the line. */
  name: string;
  /** Kartverket's name for it. */
  published: string;
  /** Degrees an hour, as Kartverket gives it. */
  speed: number;
  /** Meters. */
  amplitude: number;
  /** Greenwich phase lag in UTC against the catalog's argument, in degrees from 0 to 360. */
  phase: number;
}

export interface PublishedConstants {
  /** The observations Kartverket analyzed, from `start` to before `end` (epoch ms). */
  period: { start: number; end: number };
  latitude: number;
  constants: PublishedConstant[];
}

/**
 * Kartverket's constants from a `constituents` answer. Amplitudes come in
 * centimeters. Phases come against UTC+1, and a phase is moved by the
 * constituent's speed over one hour and over the mean of terrestrial time
 * minus UTC in the period, about 67 s. Kartverket documents the hour and not
 * the rest: fitted from the store's values, the phases of every gauge ask
 * for about 68 s beyond the hour (docs/results/kartverket-calibration.md),
 * which is what an analysis that takes the astronomical arguments on clock
 * time differs by from the catalog's, taken in terrestrial time.
 *
 * Throws on an answer in another unit or offset, without a period, with a
 * name twice, or with a constituent the catalog doesn't have at that speed,
 * so nothing is compared under a wrong name.
 */
export function parseConstants(code: string, xml: string): PublishedConstants {
  const fail = (why: string) => new Error(`kartverket/${code}: its constants ${why}`);
  const head = /<constituents\b([^>]*)>/.exec(xml)?.[1];
  if (!head) throw fail("aren't a <constituents> answer");
  if (!/\bunit="cm"/.test(head) || !/\butcoffset="\+01:00"/.test(head))
    throw fail("aren't in centimeters against UTC+1");
  const attribute = (tag: string, name: string) =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const observations = /<observations\b([^>]*)\/>/.exec(xml)?.[1];
  const start = Date.parse(attribute(observations ?? "", "start") ?? "");
  const last = Date.parse(attribute(observations ?? "", "end") ?? "");
  // The period's end names its last hour.
  const end = last + 3_600_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(start < end))
    throw fail("name no period of observations");
  const latitude = Number(attribute(/<location\b([^>]*)\/>/.exec(xml)?.[1] ?? "", "latitude"));
  if (!Number.isFinite(latitude)) throw fail("give no latitude");
  const hours = 1 + ttMinusUtc(start, end) / 3600;

  const constants = [...xml.matchAll(/<constituent\b([^>]*)\/>/g)].map(([, tag]) => {
    const published = attribute(tag!, "name") ?? "";
    const [amplitude, phase, speed] = ["amplitude", "phaseangle", "speed"].map((name) =>
      Number(attribute(tag!, name) ?? NaN),
    ) as [number, number, number];
    if (![amplitude, phase, speed].every(Number.isFinite) || amplitude < 0)
      throw fail(`hold a value that isn't a number for ${published}`);
    const entry = catalog[NAMES[published] ?? published];
    if (!entry || Math.abs(entry.speed - speed) > 1e-4)
      throw fail(`name ${published} at ${speed}° an hour, which the catalog doesn't have`);
    return {
      name: entry.name,
      published,
      speed,
      amplitude: amplitude / 100,
      phase: (((phase - speed * hours) % 360) + 360) % 360,
    };
  });
  if (!constants.length) throw fail("are empty");
  if (new Set(constants.map((c) => c.name)).size !== constants.length)
    throw fail("name a constituent twice");
  return { period: { start, end }, latitude, constants };
}
