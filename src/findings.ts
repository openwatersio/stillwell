/**
 * What the cross-station checks (scripts/cross-check.ts) find, as `--findings`
 * writes it for one region's run, and which of those no erratum settles yet,
 * for the errata report (scripts/errata-report.ts). A finding changes nothing
 * in the store. Which findings an erratum answers, and which are settled by an
 * entry in src/cross-check-reviewed.ts, is in docs/contributing/checks.md.
 */
import type { StationStep } from "./cross-check.ts";

export const KINDS = ["offset", "clock", "step", "copied"] as const;
export type Kind = (typeof KINDS)[number];

export interface Finding {
  kind: Kind;
  station: string;
  /** For `copied`, the other record of the pair. */
  other?: string;
  /** Every record of `station`'s gauge that `same_as` links, so an entry for any of them settles it. */
  records?: string[];
  /** For `copied`, every record of `other`'s gauge. */
  otherRecords?: string[];
  /** UTC days, `since` to before `until`. */
  since: string;
  until: string;
  /** What the check saw, in a sentence. */
  detail: string;
}

/** One region's run: the years it checked, `to` exclusive, the run, and what it found. */
export interface FindingsFile {
  region: string;
  from: number;
  to: number;
  /** The workflow run's URL; empty for a run by hand. */
  run: string;
  /** When it ran, as an ISO time. */
  at: string;
  findings: Finding[];
}

/** A finding judged in src/cross-check-reviewed.ts, so it leaves the report. */
export interface Reviewed {
  kind: Kind;
  station: string;
  /** For `copied`, the other record of the pair, so the entry settles that pair only. */
  other?: string;
  since: string;
  until: string;
  /** What the values show and how that was confirmed. */
  reason: string;
}

/** Days each side of a step's day, since 30-day medians date it only to within about half their window. */
export const PAD_DAYS = 15;

const DAY_MS = 86_400_000;
const isoDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Offset spans from a station's steps: a step and the next one, back the other
 * way, leaving less than `ratio` of the larger, within `maxDays`, bound a
 * span the levels sat off. The steps' days come from 30-day medians, so each
 * end is widened by `pad` days. A step that no other undoes, such as a change
 * of zero, is left out: a datum epoch answers it.
 */
export function offsets(
  steps: StationStep[],
  { maxDays = 400, ratio = 0.25, pad = PAD_DAYS } = {},
): { since: number; until: number; size: number; steps: [number, number] }[] {
  const out: { since: number; until: number; size: number; steps: [number, number] }[] = [];
  const sorted = [...steps].sort((a, b) => a.day - b.day);
  for (let i = 0; i < sorted.length - 1; i++) {
    const [a, b] = [sorted[i]!, sorted[i + 1]!];
    if (
      Math.sign(a.size) !== Math.sign(b.size) &&
      b.day - a.day <= maxDays &&
      Math.abs(a.size + b.size) < ratio * Math.max(Math.abs(a.size), Math.abs(b.size))
    ) {
      out.push({ since: a.day - pad, until: b.day + pad, size: a.size, steps: [a.day, b.day] });
      i++;
    }
  }
  return out;
}

/** Runs of consecutive `YYYY-MM` months, as days since 1970, `until` exclusive. */
export function monthRuns(months: string[]): { since: number; until: number }[] {
  const out: { since: number; until: number }[] = [];
  for (const m of [...months].sort()) {
    const [y, mo] = m.split("-").map(Number) as [number, number];
    const [since, until] = [Date.UTC(y, mo - 1, 1) / DAY_MS, Date.UTC(y, mo, 1) / DAY_MS];
    const last = out.at(-1);
    if (last?.until === since) last.until = until;
    else out.push({ since, until });
  }
  return out;
}

/** A finding for a span of days since 1970, `until` exclusive. */
export function finding(
  kind: Kind,
  station: string,
  since: number,
  until: number,
  detail: string,
  { other, records, otherRecords }: Pick<Finding, "other" | "records" | "otherRecords"> = {},
): Finding {
  // Checked here, so a bad ID fails the region's cross-check job rather than the whole report.
  for (const id of [
    station,
    ...(other ? [other] : []),
    ...(records ?? []),
    ...(otherRecords ?? []),
  ])
    if (!isStation(id)) throw new Error(`not a station ID the errata report can read: ${id}`);
  return {
    kind,
    station,
    ...(other ? { other } : {}),
    ...(records ? { records } : {}),
    ...(otherRecords ? { otherRecords } : {}),
    since: isoDay(since),
    until: isoDay(until),
    detail,
  };
}

const days = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;

/**
 * The findings no reviewed entry settles: one settles a finding of its kind
 * (an `offset` also a `step` inside it, since an offset cut by the years
 * checked shows as a step) at any record of its station's gauge, and for
 * `copied` at any of each gauge's (in `station` and `other`, either way
 * round), that falls within its span widened by `PAD_DAYS` at each end, since
 * a finding's edges are that far off. Which findings an erratum answers, and
 * which need an entry, is in docs/contributing/checks.md.
 */
/** The days a finding of `kind` is already widened by at each end, taken off again before matching, so the pad applies once. */
const padOf = (kind: Kind) => (kind === "offset" || kind === "step" ? PAD_DAYS : 0);

export function open(findings: Finding[], reviewed: Reviewed[]): Finding[] {
  return findings.filter((f) => {
    const ids = f.records ?? [f.station];
    const others = f.other ? (f.otherRecords ?? [f.other]) : [];
    return !reviewed.some(
      (r) =>
        (r.kind === f.kind || (r.kind === "offset" && f.kind === "step")) &&
        (f.kind === "copied"
          ? r.other !== undefined &&
            ((ids.includes(r.station) && others.includes(r.other)) ||
              (others.includes(r.station) && ids.includes(r.other)))
          : r.other === undefined && ids.includes(r.station)) &&
        days(f.since) + padOf(f.kind) >= days(r.since) - PAD_DAYS &&
        days(f.until) - padOf(f.kind) <= days(r.until) + PAD_DAYS,
    );
  });
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (v: unknown): v is string =>
  typeof v === "string" && DAY.test(v) && new Date(Date.parse(v) || 0).toISOString().startsWith(v);
export const isStation = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9-]+\/[^\s|]+$/.test(v);

/** A `--findings` file, checked, since the report trusts each field. */
export function parseFindings(data: unknown): FindingsFile {
  const d = data as Partial<FindingsFile> | null;
  if (
    !d ||
    typeof d.region !== "string" ||
    !d.region ||
    !Number.isInteger(d.from) ||
    !Number.isInteger(d.to) ||
    d.from! >= d.to! ||
    typeof d.run !== "string" ||
    !(d.run === "" || /^https:\/\/\S+$/.test(d.run)) ||
    typeof d.at !== "string" ||
    !isDay(d.at.slice(0, 10)) ||
    Number.isNaN(Date.parse(d.at)) ||
    !Array.isArray(d.findings)
  )
    throw new Error("not a cross-check findings file");
  for (const f of d.findings as (Partial<Finding> | null)[])
    if (
      !f ||
      !KINDS.includes(f.kind as Kind) ||
      !isStation(f.station) ||
      (f.kind === "copied") !== (f.other !== undefined) ||
      (f.other !== undefined && !isStation(f.other)) ||
      ![f.records, f.otherRecords].every(
        (ids) => ids === undefined || (Array.isArray(ids) && ids.every(isStation)),
      ) ||
      !isDay(f.since) ||
      !isDay(f.until) ||
      f.since >= f.until ||
      typeof f.detail !== "string"
    )
      throw new Error(`not a cross-check finding: ${JSON.stringify(f)}`);
  return d as FindingsFile;
}
