/**
 * Datum epochs: when a station's reference changes, and how each epoch's
 * levels convert into the current one. docs/stations.md has the design.
 */
import type { Epoch, EpochDecision } from "./schema.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A change this soon after the last one, or back to an earlier label, waits for a person. */
const HOLD_WITHIN_MS = 180 * DAY_MS;

/**
 * Fixed references a conversion can go through, in the order they're tried.
 * NAVD88 counts only with its realization, as `NAVD88(2009.55)`. Tidal datums
 * never count, since each tidal epoch moves them.
 */
const FIXED = ["NAP", "NHN", "NN", "HN", "NGVD29"];
const isFixed = (key: string) => FIXED.includes(key) || /^NAVD88\(.+\)$/.test(key);

/** The key an `Overrides.epochs` entry uses for a station's epoch. */
export function epochKey(station: string, since: string | null): string {
  return `${station} ${since ?? "start"}`;
}

/** The epoch new values go to: the last one open. */
export function currentEpoch(epochs: Epoch[]): Epoch {
  const open = epochs.filter((e) => e.state === "open").at(-1);
  if (!open) throw new Error("A station's epochs have none open");
  return open;
}

/** Whether a station waits on a person, so nothing is fetched for it. */
export function isHeld(epochs: Epoch[]): boolean {
  return epochs.some((e) => e.state === "held");
}

/**
 * The instants a source's local day `date` (YYYY-MM-DD) surely starts after
 * and ends before, for local offsets in [min, max] hours.
 */
export function localDay(date: string, [min, max]: [number, number]): [number, number] {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(midnight))
    throw new Error(`Not a date: ${date}`);
  return [midnight - max * HOUR_MS, midnight + DAY_MS - min * HOUR_MS];
}

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const dayBefore = (date: string) => iso(Date.parse(`${date}T00:00:00Z`) - DAY_MS).slice(0, 10);

export interface Fetched {
  /** The label the source gave, or null when it didn't say. */
  datum: string | null;
  /** The station's offsets after the merge. */
  datums: Record<string, number>;
  reference?: { id: string; since: string } | null;
}

export interface EpochOptions {
  station: string;
  now: string;
  offsets: [number, number];
  decisions: Record<string, EpochDecision>;
  /** The lowest `id` a new epoch may take, above any epoch directory in the lake. */
  nextId?: number;
}

export type EpochEvent = "opened" | "held" | "rejected" | "confirmed" | "suppressed";

/**
 * A new station's epochs: one, open, starting where its reference does if the
 * source says.
 */
export function firstEpochs(fetched: Fetched & { datum: string }, options: EpochOptions): Epoch[] {
  const since = fetched.reference
    ? iso(localDay(fetched.reference.since, options.offsets)[0])
    : null;
  return [
    {
      id: Math.max(1, options.nextId ?? 1),
      datum: fetched.datum,
      since,
      until: null,
      seen: options.now,
      reference: fetched.reference?.id ?? null,
      datums: fetched.datums,
      to_current: 0,
      state: "open",
    },
  ];
}

/**
 * A station's epochs after a refresh: the current one carried forward, or a
 * new one opened, held or suppressed when the source reports another
 * reference, then a person's decisions applied and `to_current` worked out.
 */
export function nextEpochs(
  previous: Epoch[],
  fetched: Fetched,
  options: EpochOptions,
): { epochs: Epoch[]; event: EpochEvent | null; reason?: string } {
  let epochs = previous.map((e) => ({ ...e, datums: { ...e.datums } }));
  let event: EpochEvent | null = null;
  let reason: string | undefined;
  const current = currentEpoch(epochs);
  const labelChanged = fetched.datum !== null && fetched.datum !== current.datum;
  const ref = fetched.reference ?? null;
  const refChanged = !!ref && current.reference !== null && ref.id !== current.reference;

  if (!labelChanged && !refChanged) {
    // The first refresh to see a reference records it, rather than call it a change.
    if (ref && current.reference === null) current.reference = ref.id;
    if (fetched.datum !== null) current.seen = options.now;
    if (!isHeld(epochs)) current.datums = fetched.datums;
  } else if (!isHeld(epochs)) {
    const datum = fetched.datum ?? current.datum;
    const rejected = epochs.some(
      (e) => e.state === "rejected" && e.datum === datum && e.reference === (ref?.id ?? null),
    );
    if (rejected) {
      // A person said this change never happened; the adapter needs fixing, not a new epoch.
      event = "suppressed";
    } else {
      // Offsets fetched with the change belong to the new epoch; the old one keeps its own.
      let since: number;
      let until: number;
      if (ref && refChanged) {
        since = localDay(ref.since, options.offsets)[0];
        until = localDay(dayBefore(ref.since), options.offsets)[0];
      } else {
        // The change came sometime after the old reference was last seen.
        since = Date.parse(options.now);
        until = Date.parse(current.seen ?? options.now);
      }
      const key = epochKey(options.station, iso(since));
      const decision = options.decisions[key];
      // The person knows the old reference held through this day, and no longer.
      if (decision?.until)
        until = Math.min(until, localDay(decision.until, options.offsets)[0] + DAY_MS);
      const earlier = epochs.some(
        (e) =>
          e !== current &&
          e.state !== "rejected" &&
          (e.datum === datum || (e.reference !== null && e.reference === ref?.id)),
      );
      const soon = current.since !== null && since - Date.parse(current.since) < HOLD_WITHIN_MS;
      const backwards = current.since !== null && since <= Date.parse(current.since);
      const id = Math.max(...epochs.map((e) => e.id), (options.nextId ?? 1) - 1) + 1;
      const opened: Epoch = {
        id,
        datum,
        since: iso(since),
        until: null,
        seen: fetched.datum !== null ? options.now : null,
        reference: ref?.id ?? null,
        datums: fetched.datums,
        to_current: 0,
        state: "open",
      };
      current.until = iso(Math.min(until, since));
      if (backwards || ((soon || earlier) && !decision?.confirm)) {
        opened.state = "held";
        event = "held";
        reason = backwards
          ? "starts no later than the epoch before it"
          : soon
            ? "comes within 180 days of the last change"
            : "returns to an earlier reference";
      } else {
        current.state = "closed";
        event = "opened";
      }
      epochs.push(opened);
    }
  }

  const decided = applyDecisions(epochs, options);
  epochs = decided.epochs;
  if (decided.event) event = decided.event;
  return { epochs: withToCurrent(epochs, options), event, reason };
}

/** Confirm or reject epochs as a person decided. */
function applyDecisions(
  epochs: Epoch[],
  options: EpochOptions,
): { epochs: Epoch[]; event: EpochEvent | null } {
  let event: EpochEvent | null = null;
  for (const epoch of epochs) {
    const decision = options.decisions[epochKey(options.station, epoch.since)];
    if (!decision) continue;
    if (decision.reject && epoch.state !== "rejected") {
      const wasOpen = epoch.state === "open";
      epoch.state = "rejected";
      // Its span goes back to the epoch before it.
      const before = epochs
        .filter((e) => e.id < epoch.id && (e.state === "open" || e.state === "closed"))
        .at(-1);
      if (before) {
        before.until = epoch.until;
        if (wasOpen || epoch.until === null) before.state = "open";
      }
      event = "rejected";
    } else if (decision.confirm && epoch.state === "held") {
      for (const e of epochs) if (e.state === "open") e.state = "closed";
      epoch.state = "open";
      event = "confirmed";
    }
  }
  return { epochs, event };
}

/**
 * What to add to each epoch's levels to put them in the current epoch's datum.
 * A rejected epoch reads as the one before it; a held one isn't read.
 */
export function withToCurrent(
  epochs: Epoch[],
  options: Pick<EpochOptions, "station" | "decisions">,
): Epoch[] {
  const current = currentEpoch(epochs);
  const out: Epoch[] = [];
  for (const epoch of epochs) {
    const decision = options.decisions[epochKey(options.station, epoch.since)];
    let to: number | null;
    if (epoch.state === "held") to = null;
    else if (epoch === current) to = 0;
    else if (epoch.state === "rejected") {
      const before = out.filter((e) => e.id < epoch.id && e.state !== "held").at(-1);
      to = before?.to_current == null ? null : before.to_current + (decision?.to_current ?? 0);
    } else if (decision?.to_current !== undefined) to = decision.to_current;
    else to = convert(epoch, current);
    out.push({ ...epoch, to_current: to });
  }
  return out;
}

/**
 * Meters to add to `from`'s levels to put them in `to`'s datum, through a
 * fixed reference both have, or null. A same-label change never converts on
 * its own: changed offsets may only mean the zero was re-surveyed, and equal
 * ones that they didn't follow the reset.
 */
export function convert(from: Epoch, to: Epoch): number | null {
  if (from.datum === to.datum) return null;
  const offsets = (e: Epoch) => ({ ...e.datums, [e.datum]: 0 });
  const [a, b] = [offsets(from), offsets(to)];
  for (const key of [...FIXED, ...Object.keys(a).filter((k) => k.startsWith("NAVD88("))]) {
    if (!isFixed(key) || a[key] === undefined || b[key] === undefined) continue;
    return round(a[key] - b[key]);
  }
  return null;
}

const round = (m: number) => Math.round(m * 1e6) / 1e6;
