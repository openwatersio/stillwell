import { ZERO_SINCE } from "./zeros.ts";

/**
 * Where an offset in `datums` came from: the words of the location's CWMS
 * `description` it was read from, the NAVD88 realization they name (`OPUS
 * 2021`, `2009.55`), and the date they say it holds from.
 */
export interface DatumNote {
  description: string;
  realization: string | null;
  as_of: string | null;
}

/**
 * Descriptions known to be wrong, left unread. Red River Landing's is a copy
 * of Knox Landing's (erratum `usace-lwrp-corrections-disagree`).
 */
const WRONG = new Set(["MVN.Red_River_Ldg"]);

const FEET = 0.3048;
const NUMBER = String.raw`[+-]?\d*\.?\d+(?!\d|\.\d)`;
const DATE = String.raw`\d{1,2} ?[A-Za-z]{3,9}\.? ?\d{2,4}|\d{1,2}/\d{1,2}/\d{4}|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}`;

/**
 * "Adjustment for vertical datum NAVD88 (OPUS 2021): -1.403 ft." and its
 * variants: "Current adjustment to NAVD88 2004.65 is -0.04'", "Gage
 * adjustment to NAVD88 2009.55 = -2.30'". The value is what to add to the
 * stage to refer it to NAVD88, which every example in the descriptions agrees
 * with ("add -1.403' to the gage reading", "subtract 1.21 feet").
 */
const STATING = String.raw`(?:current )?(?:gage )?adj\w*ment (?:for vertical datum (?:relative to )?|(?:from NAVD88[ .]?\(?[\d.]+\)? )?to )NAVD88[ .]*(?:\((?<r1>[^)]*)\)|(?<r2>OPUS ?\d{4}|OPUS|\d{4}\.\d{2}))?\s*(?::|is|=)\s*`;
const ADJUSTMENT = new RegExp(
  String.raw`${STATING}(?<value>${NUMBER})(?:\s*(?:'|ft\b|feet))*(?!\s*(?:m\b|meters?|cm))`,
  "gi",
);
/** Any adjustment with a number, whatever its unit. */
const STATED = new RegExp(String.raw`${STATING}[+-]?\.?\d`, "i");
/** "Gage zero reset to vertical datum NAVD88 (2009.55) on 28Jun2015". */
const RESET = new RegExp(
  String.raw`gau?ge(?: zero)? (?:is )?(?:re-?)?set(?: again)?(?: and transmitting)? (?:to|in) (?:vertical datum )?NAVD88 ?\((?<r>[^)]+)\) on (?<date>${DATE})`,
  "gi",
);
/** "To adjust NAVD88 (2009.55) values to 2007 Low Water Reference Plane (LWRP) datum relative to NAVD88, subtract 0.6 ft." */
const LWRP = new RegExp(
  String.raw`to adjust NAVD88(?: ?\((?<r>[^)]*)\))? values to 2007 Low Water Reference Plane \(LWRP\) datum relative to NAVD88, (?<op>add|subtract) (?<value>${NUMBER})(?:\s*(?:'|ft\b\.?|feet))*(?!\s*(?:m\b|meters?|cm))`,
  "gi",
);

/**
 * The NAVD88 and 2007 LWRP offsets a New Orleans District location's
 * description gives for its gauge zero, in meters to add to the stage, with
 * where each came from; other districts' descriptions aren't read. NAVD88 is
 * read from a stated adjustment; where a description gives more than one, the
 * one with the latest date, and none when they differ undated or on one day,
 * or when the latest predates the `ZERO_SINCE` reset. Where none is stated, a
 * gauge whose zero the description says was reset to NAVD88 the day before
 * its `ZERO_SINCE` date, so every value backfill reads is on that zero, is 0.
 * LWRP is NAVD88 plus the description's offset from NAVD88 to LWRP, only
 * where both name the same realization or the LWRP sentence names none.
 *
 * A gauge subsides and is re-surveyed, so the adjustment holds as of its
 * survey, not for the whole record (erratum `usace-lwrp-corrections-disagree`).
 */
export function describedDatums(
  sourceId: string,
  text: string | undefined,
): { datums: Record<string, number>; notes: Record<string, DatumNote> } {
  const datums: Record<string, number> = {};
  const notes: Record<string, DatumNote> = {};
  if (!sourceId.startsWith("MVN.") || !text || WRONG.has(sourceId)) return { datums, notes };
  text = text.replace(/\s+/g, " ");
  const stated = adjustment(sourceId, text);
  // Only a description that states no adjustment at all falls back on a reset.
  const navd88 = stated === undefined ? reset(sourceId, text) : stated;
  if (!navd88) return { datums, notes };
  datums.NAVD88 = meters(navd88.feet);
  notes.NAVD88 = navd88.note;
  const lwrp = lwrpOffset(text);
  if (lwrp && (lwrp.realization === null || lwrp.realization === navd88.note.realization)) {
    datums.LWRP = meters(navd88.feet + lwrp.feet);
    notes.LWRP = { description: lwrp.description, realization: lwrp.realization, as_of: null };
  }
  return { datums, notes };
}

interface Found {
  feet: number;
  note: DatumNote;
}

/** The stated adjustment, null when the ones stated can't be told apart, or undefined when none is. */
function adjustment(sourceId: string, text: string): Found | null | undefined {
  const matches = [...text.matchAll(ADJUSTMENT)];
  const found = matches.map((m, i): Found => {
    // "as of" or "Adjustment valid as of" follows the value, before the next adjustment.
    const tail = text.slice(m.index + m[0].length, matches[i + 1]?.index ?? text.length);
    const date = /^.{0,80}?as of (?<date>.+)/i.exec(tail)?.groups?.date;
    return {
      feet: Number(m.groups!.value),
      note: {
        description: m[0].trim(),
        realization: realization(m.groups!.r1 ?? m.groups!.r2),
        as_of: date ? isoDate(date) : null,
      },
    };
  });
  const distinct = found.filter(
    (f, i) => found.findIndex((g) => g.feet === f.feet && sameNote(g.note, f.note)) === i,
  );
  // One stated in a unit other than feet still counts as stated, so it isn't read as a reset's 0.
  if (!distinct.length) return STATED.test(text) ? null : undefined;
  let latest = distinct[0]!;
  if (distinct.length > 1) {
    // Several adjustments, each dated on its own day: the latest is the current one.
    const dates = distinct.map((f) => f.note.as_of);
    if (dates.some((d) => !d) || new Set(dates).size < dates.length) return null;
    latest = distinct.reduce((a, b) => (b.note.as_of! > a.note.as_of! ? b : a));
  }
  // One dated before the day the zero was reset is for the old zero, not the values backfill reads.
  const since = ZERO_SINCE[sourceId]?.since;
  if (since && latest.note.as_of && latest.note.as_of < dayBefore(since)) return null;
  return latest;
}

function dayBefore(date: string): string {
  return new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
}

function sameNote(a: DatumNote, b: DatumNote): boolean {
  return a.realization === b.realization && a.as_of === b.as_of;
}

function reset(sourceId: string, text: string): Found | null {
  const since = ZERO_SINCE[sourceId]?.since;
  if (!since || /diverge/i.test(text)) return null;
  const m = [...text.matchAll(RESET)].at(-1);
  const date = m && isoDate(m.groups!.date!);
  // The reset `ZERO_SINCE` dates, not an earlier one at the gauge's old site.
  if (!m || date !== dayBefore(since)) return null;
  return {
    feet: 0,
    note: { description: m[0], realization: realization(m.groups!.r), as_of: date },
  };
}

function lwrpOffset(
  text: string,
): { feet: number; realization: string | null; description: string } | null {
  const matches = [...text.matchAll(LWRP)];
  // A realization named but not recognized can't be checked against the adjustment's.
  if (matches.some((m) => m.groups!.r?.trim() && !realization(m.groups!.r))) return null;
  const found = matches.map((m) => ({
    feet: (m.groups!.op!.toLowerCase() === "subtract" ? -1 : 1) * Number(m.groups!.value),
    realization: realization(m.groups!.r),
    description: m[0].trim(),
  }));
  // A description that states it twice must say the same both times.
  if (found.some((f) => f.feet !== found[0]!.feet || f.realization !== found[0]!.realization))
    return null;
  return found[0] ?? null;
}

/** `OPUS 2021`, `2009.55` or `OPUS`, or null for none or a placeholder such as `EPOCH`. */
function realization(r: string | undefined): string | null {
  const name = (r ?? "").trim().replace(/^OPUS ?(\d{4})$/i, "OPUS $1");
  return /^(OPUS( \d{4})?|\d{4}\.\d{2})$/i.test(name) ? name.toUpperCase() : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A description's date (`28Jun2015`, `08 Aug 2022`, `04/14/2025`, `Nov. 22, 2021`) as YYYY-MM-DD, or null. */
export function isoDate(s: string): string | null {
  let m = /^(\d{1,2}) ?([A-Za-z]{3})[A-Za-z]*\.? ?(\d{4}|\d{2})\b/.exec(s);
  let day: number, month: number, year: number;
  if (m) [day, month, year] = [+m[1]!, MONTHS.indexOf(m[2]!.toLowerCase()), +m[3]!];
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)))
    [day, month, year] = [+m[2]!, +m[1]! - 1, +m[3]!];
  else if ((m = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4})/.exec(s)))
    [day, month, year] = [+m[2]!, MONTHS.indexOf(m[1]!.toLowerCase()), +m[3]!];
  else return null;
  // MVN's records start in the 1950s, and its descriptions date surveys from the 1980s on.
  if (year < 100) year += year < 50 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, month, day));
  if (month < 0 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function meters(feet: number): number {
  return Math.round(feet * FEET * 1000) / 1000 + 0;
}
