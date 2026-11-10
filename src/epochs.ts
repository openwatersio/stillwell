/**
 * Datum epochs: when a station's reference changes, and how each epoch's
 * levels convert into the current one. docs/stations.md has the design.
 */
import type { Epoch, EpochDecision, EpochSplit } from "./schema.ts";

/** A source now reports a station in a datum other than its list says; a station refresh opens the epoch. */
export class DatumChanged extends Error {
  /** The datum the source now reports. */
  readonly datum: string;
  /** The reference the source now reports, null for none, or undefined when the adapter can't tell. */
  readonly reference: string | null | undefined;
  constructor(message: string, datum: string, reference?: string | null) {
    super(message);
    this.datum = datum;
    this.reference = reference;
  }
}

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

/** The latest instant a source's local day `date` can start: where an epoch from that day begins. */
const dayStart = (date: string, offsets: [number, number]) => localDay(date, offsets)[1] - DAY_MS;
/** The earliest instant a local day can start: where an epoch ending before that day ends. */
const dayStartEarliest = (date: string, offsets: [number, number]) => localDay(date, offsets)[0];

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
const dayBefore = (date: string) => iso(Date.parse(`${date}T00:00:00Z`) - DAY_MS).slice(0, 10);

export interface Fetched {
  /** The label the source gave, or null when it didn't say. */
  datum: string | null;
  /** The station's offsets after the merge, which keeps old ones the source left out. */
  datums: Record<string, number>;
  /** What the source sent this time, for a new epoch, which never takes the old one's. */
  sent?: Record<string, number>;
  reference?: { id: string; since: string | null } | null;
  /**
   * Why the source says the station no longer measures from its current
   * epoch's zero, though the label and reference are the same, with no date.
   * The reason names the new state, so it identifies the change the way a
   * reference would.
   */
  changed?: string | null;
}

export interface EpochOptions {
  station: string;
  now: string;
  offsets: [number, number];
  decisions: Record<string, EpochDecision>;
  /** A person's splits, by station (`Overrides.splits`). */
  splits?: Record<string, EpochSplit[]>;
  /** The lowest `id` a new epoch may take, above any epoch directory in the lake. */
  nextId?: number;
  /**
   * The source's `archive`: `current` gives a first epoch no start, since its
   * history comes in its reference; `previous` gives the history before a
   * reference's start an epoch of its own, since it comes in the reference of its time.
   */
  archive?: "current" | "previous";
}

export type EpochEvent = "opened" | "held" | "waiting" | "ignored" | "rejected" | "confirmed";

/**
 * A new station's epochs: one, open, starting where its reference does if the
 * source says.
 */
export function firstEpochs(fetched: Fetched & { datum: string }, options: EpochOptions): Epoch[] {
  const start = fetched.reference?.since;
  const since = start ? iso(dayStart(start, options.offsets)) : null;
  const id = Math.max(1, options.nextId ?? 1);
  if (options.archive === "previous" && since && Date.parse(since) <= Date.parse(options.now))
    return withToCurrent(
      applySplits(splitAt(before(id, fetched.datum), since, fetched, options), options).epochs,
      options,
    );
  const epochs: Epoch[] = [
    {
      id,
      datum: fetched.datum,
      // A zero dated ahead isn't today's yet, so the values until then are on another.
      since:
        options.archive === "current" &&
        (since === null || Date.parse(since) <= Date.parse(options.now))
          ? null
          : since,
      until: null,
      seen: options.now,
      reference: fetched.reference?.id ?? null,
      reference_since: since,
      datums: fetched.datums,
      to_current: 0,
      state: "open",
    },
  ];
  return applySplits(epochs, options).opened.length ? withToCurrent(epochs, options) : epochs;
}

/** The instants a station's splits (`Overrides.splits`) open epochs at. */
export function splitStarts(
  splits: EpochSplit[] | undefined,
  offsets: [number, number],
): Set<string> {
  return new Set((splits ?? []).map((s) => iso(dayStart(s.since, offsets))));
}

/**
 * Split a station's current epoch at each day a person found its zero moved
 * (`Overrides.splits`), in place: it closes there, and one from that day takes
 * its label, reference and datums, so a source that names references sees no
 * change on its next refresh. Each day splits once; one ahead waits for its
 * day. A day before the current epoch's start, or any epoch's, does nothing,
 * so epoch ids stay in time order; nor does any day while the station is held.
 */
function applySplits(
  epochs: Epoch[],
  options: EpochOptions,
): { epochs: Epoch[]; opened: string[]; first?: Epoch } {
  const opened: string[] = [];
  let first: Epoch | undefined;
  const days = [...(options.splits?.[options.station] ?? [])].sort((a, b) =>
    a.since.localeCompare(b.since),
  );
  if (epochs.some((e) => e.state === "held")) return { epochs, opened };
  for (const { since: day } of days) {
    const at = dayStart(day, options.offsets);
    const since = iso(at);
    const parent = currentEpoch(epochs);
    if (
      at > Date.parse(options.now) ||
      parent.state !== "open" ||
      epochs.some((e) => e.since !== null && Date.parse(e.since) >= at)
    )
      continue;
    const id = Math.max(...epochs.map((e) => e.id), (options.nextId ?? 1) - 1) + 1;
    // Last, after any rejected epoch the current one outlived, so ids stay in time order.
    epochs.push({
      ...parent,
      datums: { ...parent.datums },
      id,
      since,
    });
    // The old zero's last instant is the day's earliest start, as for a dated change.
    parent.until = iso(dayStartEarliest(day, options.offsets));
    parent.state = "closed";
    first ??= parent;
    opened.push(day);
  }
  return { epochs, opened, first };
}

/** An epoch with no start, before any reference the source names. */
function before(id: number, datum: string): Epoch {
  return {
    id,
    datum,
    since: null,
    until: null,
    seen: null,
    reference: null,
    reference_since: null,
    datums: {},
    to_current: 0,
    state: "open",
  };
}

/**
 * For an `archive: "previous"` source: close `first` at `since`, where the
 * reference the source names starts, and open an epoch from there. Both keep
 * the label, so the earlier one converts only by a person's decision.
 */
function splitAt(
  first: Epoch,
  since: string,
  fetched: Fetched & { datum: string },
  options: EpochOptions,
): Epoch[] {
  return [
    { ...first, until: since, state: "closed" },
    {
      id: first.id + 1,
      datum: fetched.datum,
      since,
      until: null,
      seen: options.now,
      reference: fetched.reference?.id ?? null,
      reference_since: since,
      datums: fetched.sent ?? fetched.datums,
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
): {
  epochs: Epoch[];
  event: EpochEvent | null;
  reason?: string;
  /** The epoch a person would decide on, when it isn't the held or newest one. */
  decide?: Epoch;
} {
  const epochs = previous.map((e) => ({ ...e, datums: { ...e.datums } }));
  let reason: string | undefined;
  let decide: Epoch | undefined;
  // A rejection goes first, so a fix that lands with it isn't read as a change back.
  let event: EpochEvent | null = applyDecisions(epochs, options);
  const current = currentEpoch(epochs);
  const labelChanged = fetched.datum !== null && fetched.datum !== current.datum;
  const ref = fetched.changed ? { id: fetched.changed, since: null } : (fetched.reference ?? null);
  // A reference first seen with a recent date may have moved after the station
  // was last checked, so epoch 1 could hold values from both zeros.
  const refStart = ref?.since ? dayStart(ref.since, options.offsets) : null;
  const fresh =
    refStart !== null &&
    current.reference === null &&
    !labelChanged &&
    refStart <= Date.parse(options.now) &&
    Date.parse(options.now) - refStart < HOLD_WITHIN_MS;
  const refChanged =
    !!fetched.changed ||
    fresh ||
    (!!ref && current.reference !== null && ref.id !== current.reference);

  // A reference first seen with a date ahead isn't recorded until its day, so it opens an epoch then.
  const ahead = refStart !== null && refStart > Date.parse(options.now);
  // An `archive: "previous"` source's history before the reference is in the
  // reference of its time, so the first sighting splits the station's only epoch there.
  const split =
    options.archive === "previous" &&
    refStart !== null &&
    !ahead &&
    !labelChanged &&
    epochs.length === 1 &&
    current.since === null &&
    current.reference === null;

  if (split) {
    const next = Math.max(current.id, (options.nextId ?? 1) - 1);
    const [closed, opened] = splitAt(
      current,
      iso(refStart),
      { ...fetched, datum: current.datum },
      options,
    );
    epochs.splice(0, 1, closed!, { ...opened!, id: next + 1 });
    event = "opened";
    reason = `values before ${iso(refStart)} are in the reference before ${ref!.id}`;
    // A person's decision converts the earlier epoch, not the new one.
    decide = closed;
  } else if (!labelChanged && !refChanged) {
    // The first refresh to see a reference records it, rather than call it a change.
    if (ref && current.reference === null && !ahead) {
      current.reference = ref.id;
      if (ref.since) current.reference_since = iso(dayStart(ref.since, options.offsets));
    }
    if (fetched.datum !== null) current.seen = options.now;
    // Offsets sent with a reference dated ahead may already be the new zero's.
    if (!isHeld(epochs) && !ahead) current.datums = fetched.datums;
  } else if (!isHeld(epochs)) {
    const datum = fetched.datum ?? current.datum;
    const rejected = epochs.some(
      (e) => e.state === "rejected" && e.datum === datum && e.reference === (ref?.id ?? null),
    );
    if (rejected) {
      // A person said this change never happened, so the station carries on in
      // its current epoch; a reference that only looked new still brings its
      // offsets under the same label. It's reported, not failed, in case the
      // change has since become real and needs a new decision.
      if (!labelChanged) {
        current.seen = options.now;
        current.datums = fetched.datums;
        // A rejected first sighting is the current reference after all.
        if (fresh && ref) {
          current.reference = ref.id;
          current.reference_since = iso(refStart!);
        }
      }
      event = "ignored";
      reason = "a person rejected this change";
    } else if (
      ref?.since &&
      refChanged &&
      dayStart(ref.since, options.offsets) > Date.parse(options.now)
    ) {
      // A change dated ahead takes effect at the first refresh after its day.
    } else {
      // Offsets fetched with the change belong to the new epoch; the old one keeps its own.
      let since: number;
      let until: number;
      if (ref?.since && refChanged) {
        since = dayStart(ref.since, options.offsets);
        until = dayStartEarliest(dayBefore(ref.since), options.offsets);
      } else {
        // The change came sometime after the old reference was last seen.
        since = Date.parse(options.now);
        until = Date.parse(current.seen ?? options.now);
      }
      const decision = options.decisions[epochKey(options.station, iso(since))];
      // A label back to an earlier one, or under the same label a reference
      // back to an earlier one. A same-label reset to a new reference is neither.
      const earlier = epochs.some(
        (e) =>
          e !== current &&
          e.state !== "rejected" &&
          (labelChanged ? e.datum === datum : e.reference !== null && e.reference === ref?.id),
      );
      // A first epoch with no start still knows where its reference starts, if the source said.
      const start = current.since ?? current.reference_since;
      const soon = start !== null && since - Date.parse(start) < HOLD_WITHIN_MS;
      const backwards = start !== null && since <= Date.parse(start);
      const id = Math.max(...epochs.map((e) => e.id), (options.nextId ?? 1) - 1) + 1;
      // A held epoch keeps the end it would give the open one, until a person decides.
      const opened: Epoch = {
        id,
        datum,
        since: iso(since),
        until: iso(Math.min(until, since)),
        seen: fetched.datum !== null ? options.now : null,
        reference: ref?.id ?? null,
        reference_since: ref?.since ? iso(since) : null,
        datums: fetched.sent ?? fetched.datums,
        to_current: 0,
        state: "open",
      };
      if (backwards || ((soon || earlier || fresh) && !decision?.confirm)) {
        opened.state = "held";
        event = "held";
        reason = backwards
          ? "starts no later than the epoch before it"
          : soon
            ? "comes within 180 days of the last change"
            : earlier
              ? "returns to an earlier reference"
              : "first seen within 180 days of its date, so epoch 1 may hold values from before and after it";
      } else {
        current.state = "closed";
        current.until = opened.until;
        opened.until = null;
        event = "opened";
        if (fetched.changed) reason = fetched.changed;
      }
      epochs.push(opened);
    }
  }

  const person = applySplits(epochs, options);
  if (person.opened.length) {
    event ??= "opened";
    reason ??= `a person found the zero moved on ${person.opened.join(", ")}; backfill the station from ${person.opened[0]}`;
    // A person's offset converts the epoch before the first split.
    decide ??= person.first;
  }
  event = applyDecisions(epochs, options) ?? event;
  // A station still waiting on a person is reported on every refresh, not only the first.
  if (!event && isHeld(epochs)) {
    event = "waiting";
    reason = "waiting for a decision in the source's overrides";
  }
  return { epochs: withToCurrent(epochs, options), event, reason, decide };
}

/**
 * Apply a person's decisions to a station's epochs, in place: confirm or
 * reject one, or end the one before it earlier. Returns what changed.
 */
function applyDecisions(epochs: Epoch[], options: EpochOptions): EpochEvent | null {
  let event: EpochEvent | null = null;
  for (const epoch of epochs) {
    const decision = options.decisions[epochKey(options.station, epoch.since)];
    if (!decision) continue;
    const before = epochs
      .filter((e) => e.id < epoch.id && (e.state === "open" || e.state === "closed"))
      .at(-1);
    if (decision.reject && epoch.state !== "rejected") {
      // The first epoch has nothing to fall back on, so it can't be rejected.
      if (!before) continue;
      const wasHeld = epoch.state === "held";
      const wasOpen = epoch.state === "open";
      epoch.state = "rejected";
      // Its span goes back to the epoch before it.
      if (wasHeld) epoch.until = null;
      else {
        before.until = epoch.until;
        if (wasOpen) before.state = "open";
      }
      event = "rejected";
    } else if (decision.confirm && epoch.state === "held") {
      for (const e of epochs)
        if (e.state === "open") {
          e.state = "closed";
          e.until = epoch.until;
        }
      epoch.state = "open";
      epoch.until = null;
      event = "confirmed";
    }
    // The person knows the reference before held through this day, and no longer.
    if (decision.until && before && epoch.state !== "rejected") {
      const end = iso(dayStartEarliest(decision.until, options.offsets) + DAY_MS);
      const target = epoch.state === "held" ? epoch : before;
      if (target.until === null || end < target.until) target.until = end;
    }
  }
  return event;
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

/**
 * A station's part of the recent window, split for a run: rows from before
 * the current epoch, kept as they are for compaction to fold into their own
 * files; the rows from its start, which new values merge into; and where
 * fetching starts, never before the current epoch does. A row goes by its time,
 * not the epoch it was written in: an epoch opened with a start in the past
 * takes the values fetched since then, which were already in its reference.
 */
export function recentWindow<T extends { time: number; epoch: number }>(
  epochs: Epoch[],
  rows: T[],
  keepFrom: number,
  start: number,
): { epoch: number; from: number; other: T[]; current: (T & { epoch: number })[] } {
  const { id: epoch, since } = currentEpoch(epochs);
  const begins = since === null ? -Infinity : Date.parse(since);
  const kept = rows.filter((r) => r.time >= keepFrom);
  return {
    epoch,
    from: Math.max(start, begins),
    other: kept.filter((r) => r.time < begins),
    current: kept.filter((r) => r.time >= begins).map((r) => ({ ...r, epoch })),
  };
}
