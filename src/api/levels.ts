import { FLAG_NAMES, Flag } from "../schema.ts";
import type { CatalogStation } from "./catalog.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How far back `levels` reaches until the history moves onto the server (docs/plans/realtime.md, step 2). */
export const WINDOW_MS = 7 * DAY;
// A start a few minutes past the window still passes, for clocks and a Worker's rounding.
const SLACK_MS = 5 * MINUTE;

/** Each `step`'s length; `raw` is every value. */
export const STEPS: Record<string, number> = {
  "6m": 6 * MINUTE,
  "15m": 15 * MINUTE,
  "1h": HOUR,
  "1d": DAY,
  raw: 0,
};

const FOOT = 0.3048;

export const NOTICE = "Preliminary observations. Not for navigation.";

export interface ParamError {
  path: string;
  message: string;
}

/** A request's parameters, checked. */
export interface LevelsQuery {
  start: number;
  end: number;
  /** The step's length in ms, 0 for `raw`. */
  step: number;
  /** The datum asked for: undefined for the station's default, `station` for its own reference. */
  datum: string | undefined;
  feet: boolean;
  received: boolean;
  includeBad: boolean;
}

/** One value as ClickHouse holds it. */
export interface StoredLevel {
  epoch: number;
  time: number;
  level: number;
  flag: number;
  received: number | null;
}

export interface LevelRow {
  time: string;
  level: number;
  flag: string;
  received?: string | null;
}

// A date, or a date-time with seconds and fractions optional and a zone required.
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * An ISO 8601 date (midnight UTC) or date-time with a zone, in ms, or null.
 * One whose fields don't exist, such as November 31, is null rather than
 * rolled into the next month.
 */
export function parseInstant(text: string): number | null {
  // An offset's + sent unencoded arrives as a space.
  text = text.replace(/ (\d{2}:\d{2})$/, "+$1");
  const m = INSTANT.exec(text);
  if (!m) return null;
  const time = Date.parse(text);
  if (Number.isNaN(time)) return null;
  const [y, mo, d, h = 0, mi = 0, sec = 0] = m
    .slice(1)
    .map((f) => (f === undefined ? undefined : Number(f)));
  const check = new Date(Date.UTC(y!, mo! - 1, d!, h, mi, sec));
  const same =
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === mo! - 1 &&
    check.getUTCDate() === d &&
    check.getUTCHours() === h &&
    check.getUTCMinutes() === mi &&
    check.getUTCSeconds() === sec;
  return same ? time : null;
}

/** The parameters of a levels request, or what's wrong with them. */
export function parseLevels(
  params: URLSearchParams,
  now: number,
): { query: LevelsQuery } | { errors: ParamError[] } {
  const errors: ParamError[] = [];
  const one = (name: string): string | undefined => {
    const all = params.getAll(name);
    if (all.length > 1) errors.push({ path: name, message: `${name} must be given once` });
    return all[0] === "" ? undefined : all[0];
  };
  const time = (name: string): number | undefined => {
    const raw = one(name);
    if (raw === undefined) return undefined;
    const t = parseInstant(raw);
    if (t === null)
      errors.push({
        path: name,
        message: `${name} must be an ISO 8601 date, or date-time with Z or an offset`,
      });
    return t ?? undefined;
  };

  let end = time("end");
  let start = time("start");
  end ??= start === undefined ? now : start + WINDOW_MS;
  start ??= end - WINDOW_MS;
  if (start > end) errors.push({ path: "start", message: "start must be before end" });
  else if (start > now + SLACK_MS)
    errors.push({ path: "start", message: "start must not be in the future" });
  else if (end - start > WINDOW_MS + SLACK_MS)
    errors.push({ path: "end", message: "start and end must be at most 7 days apart" });
  if (start < now - WINDOW_MS - SLACK_MS)
    errors.push({
      path: "start",
      message: "start must be within the last 7 days, until the archive moves onto the server",
    });

  const stepName = one("step") ?? "6m";
  if (!Object.hasOwn(STEPS, stepName))
    errors.push({ path: "step", message: `step must be one of ${Object.keys(STEPS).join(", ")}` });

  const units = one("units") ?? "meters";
  if (units !== "meters" && units !== "feet")
    errors.push({ path: "units", message: "units must be meters or feet" });

  const includeBad = one("includeBad") ?? "false";
  if (includeBad !== "true" && includeBad !== "false")
    errors.push({ path: "includeBad", message: "includeBad must be true or false" });

  const include = (one("include") ?? "").split(",").filter(Boolean);
  for (const name of include)
    if (name === "predicted" || name === "residual")
      errors.push({ path: "include", message: `${name} isn't served yet` });
    else if (name !== "received")
      errors.push({ path: "include", message: "include takes predicted, residual or received" });

  const datum = one("datum");
  if (errors.length) return { errors };
  return {
    query: {
      start,
      end,
      step: STEPS[stepName]!,
      datum,
      feet: units === "feet",
      received: include.includes("received"),
      includeBad: includeBad === "true",
    },
  };
}

/** How a request's levels convert: to a named datum through the offsets, or to the station's own through `to_current`. */
export type Conversion = { named: string } | { named: null };

/** The datum a request is answered in, or why the station can't give it. */
export function conversionFor(
  station: CatalogStation,
  datum: string | undefined,
): Conversion | ParamError {
  const current = station.epoch === null ? undefined : station.offsets.get(station.epoch);
  if (datum === undefined)
    return station.chart_datum !== null && current?.has(station.chart_datum)
      ? { named: station.chart_datum }
      : { named: null };
  if (datum === "station") return { named: null };
  if (current?.has(datum)) return { named: datum };
  return { path: "datum", message: `${station.id} has no offset to ${datum}` };
}

/** The epochs whose values convert as asked, each with its span in ms, either end null when open. */
export function convertibleEpochs(
  station: CatalogStation,
  conversion: Conversion,
): { id: number; since: number | null; until: number | null }[] {
  return [...station.epochs]
    .filter(([id, e]) =>
      conversion.named === null
        ? e.to_current !== null
        : station.offsets.get(id)?.has(conversion.named),
    )
    .map(([id, e]) => ({ id, since: e.since, until: e.until }));
}

/** A stored level in the datum asked for, or null when its epoch doesn't convert or the value is outside the epoch's span. */
function convert(station: CatalogStation, conversion: Conversion, v: StoredLevel): number | null {
  const epoch = station.epochs.get(v.epoch);
  if (!epoch) return null;
  if (
    (epoch.since !== null && v.time < epoch.since) ||
    (epoch.until !== null && v.time >= epoch.until)
  )
    return null;
  const offset =
    conversion.named === null
      ? epoch.to_current
      : station.offsets.get(v.epoch)?.get(conversion.named);
  return offset === null || offset === undefined ? null : v.level + offset;
}

/**
 * The values between `start` and `end` that convert: every one at `raw`,
 * otherwise the one nearest each multiple of the step in the range, within
 * half a step, so a value up to half a step outside the range can be one.
 * Where in the step before its first step time the range starts doesn't
 * change the rows, so the Worker can round it.
 * Each keeps its own time, and one nearest two step times is listed once.
 */
export function sample(
  station: CatalogStation,
  conversion: Conversion,
  values: StoredLevel[],
  query: LevelsQuery,
): { time: number; level: number; flag: number; received: number | null }[] {
  const usable = values
    .filter((v) => query.includeBad || v.flag !== Flag.bad)
    .map((v) => ({ ...v, level: convert(station, conversion, v) }))
    .filter((v): v is StoredLevel => v.level !== null)
    .sort((a, b) => a.time - b.time);
  if (!query.step) return usable.filter((v) => v.time >= query.start && v.time <= query.end);

  const picked: StoredLevel[] = [];
  const half = query.step / 2;
  let i = 0;
  for (
    let at = Math.ceil(query.start / query.step) * query.step;
    at <= query.end;
    at += query.step
  ) {
    while (
      i + 1 < usable.length &&
      Math.abs(usable[i + 1]!.time - at) < Math.abs(usable[i]!.time - at)
    )
      i++;
    const v = usable[i];
    if (v && Math.abs(v.time - at) <= half && picked.at(-1) !== v) picked.push(v);
  }
  return picked;
}

/**
 * `reporting`; `stale` past three of the station's intervals, and never
 * under two hours, as the poller's alert counts, since many sources send a
 * station's values in hourly batches and the server fills some only hourly;
 * or `offline` past a day, as of the newest value.
 */
export function statusOf(station: CatalogStation, asOf: number | null, now: number): string {
  if (asOf === null || now - asOf > DAY) return "offline";
  return now - asOf > Math.max(3 * intervalOf(station), 2 * HOUR) ? "stale" : "reporting";
}

/** How long a response may be cached, in seconds: a day once the range has passed the poller's window, else the station's interval up to 5 minutes. */
export function maxAge(station: CatalogStation, end: number, now: number): number {
  if (end < now - WINDOW_MS) return 86_400;
  return Math.min(station.min_interval_s ?? 300, 300);
}

/** The longer of how often the station records a value and how often it's asked: hourly where it gives neither. */
function intervalOf(station: CatalogStation): number {
  return Math.max(station.interval_s ?? 0, station.min_interval_s ?? 3600) * 1000;
}

/** The response body for a station's levels. */
export function levelsResponse(args: {
  station: CatalogStation;
  conversion: Conversion;
  query: LevelsQuery;
  values: StoredLevel[];
  asOf: number | null;
  updated: number | null;
  now: number;
}): object {
  const { station, conversion, query } = args;
  const length = (m: number) => round(query.feet ? m / FOOT : m);
  const current = (station.epoch !== null && station.offsets.get(station.epoch)) || new Map();
  const base = conversion.named === null ? 0 : (current.get(conversion.named) ?? 0);
  return {
    station: { id: station.id, name: station.name, tide_station: station.tide_station },
    datum: conversion.named ?? station.datum,
    // Each datum's height above the response's, as the tides API gives them: the offsets' opposite.
    datums: Object.fromEntries([...current].map(([name, offset]) => [name, length(base - offset)])),
    frame: station.frame,
    status: statusOf(station, args.asOf, args.now),
    as_of: iso(args.asOf),
    updated: iso(args.updated),
    levels: sample(station, conversion, args.values, query).map((v): LevelRow => {
      const row: LevelRow = {
        time: iso(v.time)!,
        level: length(v.level),
        flag: FLAG_NAMES[v.flag]!,
      };
      if (query.received) row.received = iso(v.received);
      return row;
    }),
    attribution: [...new Set([station.attribution, ...station.datums_attribution].filter(Boolean))],
    notice: NOTICE,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function iso(time: number | null): string | null {
  return time === null ? null : new Date(time).toISOString().replace(".000Z", "Z");
}
