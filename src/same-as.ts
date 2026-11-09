import type { Station } from "./schema.ts";
import { km, nameScore } from "./ticon.ts";

/**
 * Which series in the lake share a gauge, and which of them to use. A link
 * comes from one of:
 *
 * - **an adapter**, from an ID the source gives: BSH names each gauge's
 *   PEGELONLINE series, UHSLC's documentation files name the originator's
 *   station number, and a source links its own series of one gauge (UHSLC's
 *   versions, RWS's twins). A link to a station another source lists more than
 *   `ID_KM` away is dropped and reported, as a wrong ID.
 * - **nearness and name**: two stations of different sources within `NEAR_KM`
 *   whose names share an identifying word and name the same side of any dam or
 *   lock. Never name alone, never within one source, since a source's own
 *   neighbors (two sides of a lock, a gauge and its backup) are its to link,
 *   and never across a `SEPARATE` pair.
 * - **a copy's best match**: a redistributor rounds positions, so a station
 *   that copies another agency's gauge, and whose adapter didn't name the
 *   original by a link that held, is linked to the station in each other source within `COPY_KM`
 *   of the same kind (where both say) that shares the most words with it, the
 *   nearest among equals, unless an equally named one more than 100 m away,
 *   which its source doesn't link to the first, leaves it in doubt.
 * - **`LINKS`**, a person's decision.
 *
 * Linked stations form a group, and each lists every other in `same_as`. A
 * link by nearness or copy that would put two stations of one source in a
 * group is skipped, since one of them is likelier another gauge nearby
 * (except for an `ASSEMBLED` source), and
 * no link may join two stations a person put in `UNLINKS`. Both are reported.
 * `preferred` names the group's series to use for observed levels, by `rank`.
 */

/** A person's decision on a pair of stations, with why. */
export interface Decision {
  a: string;
  b: string;
  note: string;
}

/** Pairs a person found share a gauge that the rules below miss. */
export const LINKS: Decision[] = [];

/** Pairs a person found don't share a gauge, though a rule links them. */
export const UNLINKS: Decision[] = [];

/** Stations a person chose as their group's preferred series, with why. */
export const PREFER: Record<string, string> = {};

/**
 * Whether a station's series is a copy of another agency's gauge, by source,
 * so the originator's own series comes first. A station carries its list's
 * own fields, such as UHSLC's `contributor`, alongside the shared ones.
 */
const REDISTRIBUTED: Record<string, (s: Station & { contributor?: string | null }) => boolean> = {
  // UHSLC runs some gauges itself; the rest it collects from their agencies.
  uhslc: (s) => s.contributor !== "University of Hawaii Sea Level Center",
  // REFMAR republishes some of UHSLC's under names ending in "UHSLC".
  refmar: (s) => /\bUHSLC\b/.test(s.name),
  // GESLA assembles other agencies' records.
  gesla: () => true,
};

/**
 * Stations kept out of every group, by source. GESLA's release is static, so
 * an inactive record is one its adapter leaves out for holding another
 * gauge's values (`DROPPED` in src/sources/gesla/index.ts).
 */
const UNLINKABLE: Record<string, (s: Station) => boolean> = {
  gesla: (s) => s.status === "inactive",
};

export function redistributed(s: Station): boolean {
  return REDISTRIBUTED[s.source]?.(s) ?? false;
}

/**
 * Sources whose series is the copy when they share a gauge with another:
 * USACE districts relay the satellite transmissions of gauges USGS runs.
 */
const COPIES: Record<string, string> = { usace: "usgs" };

/** The stations in a group that copy another member's gauge, by `COPIES`. */
function copiesIn(group: Station[]): Set<string> {
  const sources = new Set(group.map((s) => s.source));
  return new Set(group.filter((s) => sources.has(COPIES[s.source] ?? "")).map((s) => s.id));
}

/**
 * Sources that assemble other agencies' records, often several of one gauge
 * (GESLA has NOAA's, UHSLC's and CMEMS's copies of many), so two of their
 * stations in a group are two copies, not two gauges, and don't keep groups apart.
 */
const ASSEMBLED = new Set(["gesla"]);

/**
 * Source pairs whose agencies each run their own gauges, so two of their
 * stations at one pier are separate instruments that check each other, never
 * one gauge. Only an ID or a person links them.
 */
const SEPARATE = new Set(["coops~usgs", "coops~usace"]);

function separate(a: Station, b: Station): boolean {
  return a.source === b.source || SEPARATE.has([a.source, b.source].sort().join("~"));
}

/** Farthest apart two stations matched by nearness and name can be. */
export const NEAR_KM = 0.1;

/** Farthest a copy's station can be from the original's, since redistributors round positions. */
export const COPY_KM = 2;

/** Farthest apart two stations an ID links across sources can be before the ID is taken as wrong. */
export const ID_KM = 10;

/** A series still reporting has a value within this long. */
const REPORTING_MS = 366 * 86_400_000;

export type How = "id" | "near" | "copy" | "manual";

export interface LinkReport {
  /** Links made, by `<source>~<source>` (sorted) and how. */
  pairs: Record<string, Partial<Record<How, number>>>;
  /** Links and decisions dropped: to a station no list has, or too far away. */
  dropped: { from: string; to: string; reason: string }[];
  /** Links found but not made, since they'd join what the rules keep apart. */
  skipped: { a: string; b: string; how: How; reason: string }[];
  /** Groups of more than `LARGE` stations, worth a look. */
  large: string[][];
}

const LARGE = 8;

/** The order links join groups in: a person's first, inferred ones last. */
const ORDER: How[] = ["manual", "id", "near", "copy"];

/**
 * Link every station to the others sharing its gauge, and name each group's
 * preferred series. A station with no links is its own preferred series.
 */
export function linkGauges<T extends Station>(
  stations: T[],
  now = new Date(),
): { stations: (T & { preferred: string })[]; report: LinkReport } {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const alone = new Set(stations.filter((s) => UNLINKABLE[s.source]?.(s)).map((s) => s.id));
  const linkable = stations.filter((s) => !alone.has(s.id));
  const edges = new Map<string, How>();
  const dropped: LinkReport["dropped"] = [];
  const skipped: LinkReport["skipped"] = [];
  const add = (a: string, b: string, how: How) => {
    const key = pairKey(a, b);
    if (a !== b && !edges.has(key) && !alone.has(a) && !alone.has(b)) edges.set(key, how);
  };

  for (const { a, b } of LINKS)
    if (byId.has(a) && byId.has(b)) add(a, b, "manual");
    else dropped.push({ from: a, to: b, reason: "LINKS names no such station" });
  for (const { a, b } of UNLINKS)
    if (!byId.has(a) || !byId.has(b))
      dropped.push({ from: a, to: b, reason: "UNLINKS names no such station" });
  for (const id of Object.keys(PREFER))
    if (!byId.has(id)) dropped.push({ from: id, to: id, reason: "PREFER names no such station" });
  /** The stations whose own `same_as` named another source's, by pair. */
  const namers = new Map<string, Set<string>>();
  for (const s of linkable)
    for (const other of s.same_as) {
      const target = byId.get(other);
      if (!target) dropped.push({ from: s.id, to: other, reason: "no such station" });
      // A position that isn't a number can't vouch for an ID either.
      else if (target.source !== s.source && !(km(s, target) <= ID_KM))
        dropped.push({ from: s.id, to: other, reason: `${Math.round(km(s, target))} km apart` });
      else {
        add(s.id, other, "id");
        if (target.source !== s.source)
          (
            namers.get(pairKey(s.id, other)) ??
            namers.set(pairKey(s.id, other), new Set()).get(pairKey(s.id, other))!
          ).add(s.id);
      }
    }
  for (const [a, b] of nearPairs(linkable)) add(a.id, b.id, "near");
  // A copy whose adapter named its original, by a link that held, needs no
  // guess. Only the station that named it: one another source's copy names,
  // as GESLA names UHSLC's series, may still be a copy to match.
  const named = new Set<string>();
  const unlinked = new Set(UNLINKS.map(({ a, b }) => pairKey(a, b)));
  for (const [key, ids] of namers) if (!unlinked.has(key)) for (const id of ids) named.add(id);
  for (const [a, b] of copyPairs(linkable, named)) add(a.id, b.id, "copy");

  // Union-find, with each group's members kept so a merge can be refused.
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const p = parent.get(id);
    if (!p || p === id) return id;
    const r = root(p);
    parent.set(id, r);
    return r;
  };
  const members = new Map<string, T[]>(stations.map((s) => [s.id, [s]]));
  const apart = UNLINKS.map(({ a, b }) => [a, b] as const);
  const pairs: LinkReport["pairs"] = {};
  const ordered = [...edges]
    .map(([key, how]) => {
      const [a, b] = key.split("\n").map((id) => byId.get(id)!) as [T, T];
      return { a, b, how, d: km(a, b) };
    })
    // Nearest first within each kind, then by ID, so which of two rival links wins doesn't depend on list order.
    .sort(
      (x, y) =>
        ORDER.indexOf(x.how) - ORDER.indexOf(y.how) ||
        x.d - y.d ||
        pairKey(x.a.id, x.b.id).localeCompare(pairKey(y.a.id, y.b.id)),
    );
  const count = (a: T, b: T, how: How) => {
    const counts = (pairs[[a.source, b.source].sort().join("~")] ??= {});
    counts[how] = (counts[how] ?? 0) + 1;
  };
  for (const { a, b, how } of ordered) {
    const ra = root(a.id);
    const rb = root(b.id);
    if (ra === rb) {
      count(a, b, how);
      continue;
    }
    const ga = members.get(ra)!;
    const gb = members.get(rb)!;
    const ids = (g: T[]) => new Set(g.map((s) => s.id));
    const [ia, ib] = [ids(ga), ids(gb)];
    const unlinked = apart.find(([x, y]) => (ia.has(x) && ib.has(y)) || (ia.has(y) && ib.has(x)));
    if (unlinked) {
      skipped.push({ a: a.id, b: b.id, how, reason: `UNLINKS ${unlinked.join(" ")}` });
      continue;
    }
    // Checked across the whole of both groups, so a third station can't bridge them.
    if (how === "near" || how === "copy") {
      const clash = ga.flatMap((x) =>
        gb.filter((y) => separate(x, y) && !ASSEMBLED.has(x.source)).map((y) => [x, y]),
      )[0];
      if (clash) {
        const [x, y] = clash as [T, T];
        const reason =
          x.source === y.source
            ? `would join two ${x.source} stations`
            : `would join ${x.source} and ${y.source}, which run separate gauges`;
        skipped.push({ a: a.id, b: b.id, how, reason });
        continue;
      }
    }
    parent.set(rb, ra);
    members.set(ra, [...ga, ...gb]);
    members.delete(rb);
    count(a, b, how);
  }
  const preferredOf = new Map<string, string>();
  const large: string[][] = [];
  for (const [r, group] of members) {
    const copies = copiesIn(group);
    preferredOf.set(r, group.reduce((best, s) => (rank(s, best, now, copies) < 0 ? s : best)).id);
    if (group.length > LARGE) large.push(group.map((s) => s.id).sort());
  }
  return {
    stations: stations.map((s) => ({
      ...s,
      same_as: members
        .get(root(s.id))!
        .map((o) => o.id)
        .filter((id) => id !== s.id)
        .sort(),
      preferred: preferredOf.get(root(s.id))!,
    })),
    report: { pairs, dropped, skipped, large },
  };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/**
 * Negative when `a` is the better series for the gauge's observed levels: a
 * person's choice; one with levels; one whose terms allow commercial use, so
 * the API can serve it before tokens exist; one not from an assembled
 * collection (`ASSEMBLED`), which is the fallback; one still reporting; the
 * originator's over a copy (a redistributor's, or one of `copies`, the
 * group's `COPIES` stations); the longer record in the lake; the finer interval; then the
 * lower ID, so equals always break the same way.
 */
export function rank(
  a: Station,
  b: Station,
  now = new Date(),
  copies: Set<string> = new Set(),
): number {
  const copy = (s: Station) => redistributed(s) || copies.has(s.id);
  const levels = (s: Station) => s.products.includes("levels");
  const reporting = (s: Station) =>
    s.status === "active" && s.last !== null && now.getTime() - Date.parse(s.last) < REPORTING_MS;
  const span = (s: Station) => {
    const ms = s.first && s.last ? Date.parse(s.last) - Date.parse(s.first) : 0;
    return Number.isFinite(ms) ? ms : 0;
  };
  const tests: [boolean | number, boolean | number][] = [
    [a.id in PREFER, b.id in PREFER],
    [levels(a), levels(b)],
    [a.commercial_use, b.commercial_use],
    [!ASSEMBLED.has(a.source), !ASSEMBLED.has(b.source)],
    [reporting(a), reporting(b)],
    [!copy(a), !copy(b)],
    [span(a), span(b)],
    [-(a.interval_s ?? Infinity), -(b.interval_s ?? Infinity)],
  ];
  for (const [x, y] of tests) if (x !== y) return Number(y) - Number(x) < 0 ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/**
 * Words that say which side of a dam, lock, weir or barrier a gauge reads: two
 * gauges there sit meters apart at different levels, so their names must
 * agree. PEGELONLINE's `OP` and `UP` are Oberpegel and Unterpegel, upstream
 * and downstream; its `BP` and `AP` the inner and outer gauge of a barrier.
 */
const SIDES: Record<string, string> = Object.fromEntries(
  Object.entries({
    up: "upper above abv headwater hw pool inflow oberwasser ow op oberpegel boven bovenstrooms",
    down: "lower below blw bl tailwater tw outflow outlet unterwasser uw up unterpegel beneden benedenstrooms",
    in: "binnen binnenpegel bp innen",
    out: "aussen aussenpegel ap buiten",
  }).flatMap(([side, words]) => words.split(" ").map((w) => [w, side])),
);

/** Compass words, which name a side only as a name's last word, as in "Control Structure - West". */
const COMPASS: Record<string, string> = {
  north: "n",
  nth: "n",
  nord: "n",
  south: "s",
  sth: "s",
  sud: "s",
  east: "e",
  ost: "e",
  west: "w",
};

function sides(name: string): string {
  const words = name
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // A trailing code such as "(76010)" isn't the name's last word.
    .replace(/\(\d+\)\s*$/, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
  const found = new Set(words.map((w) => SIDES[w]).filter(Boolean));
  const last = COMPASS[words.at(-1) ?? ""];
  if (last) found.add(last);
  return [...found].sort().join();
}

/** Pairs of stations from different sources close enough, and named alike, to be one gauge. */
export function nearPairs<T extends Station>(stations: T[]): [T, T][] {
  // Sorted by latitude, a station need only be checked against those just after it.
  const located = stations
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .sort((a, b) => a.lat - b.lat);
  const window = NEAR_KM / 111;
  const pairs: [T, T][] = [];
  for (let i = 0; i < located.length; i++) {
    const a = located[i]!;
    for (let j = i + 1; j < located.length && located[j]!.lat - a.lat <= window; j++) {
      const b = located[j]!;
      if (!separate(a, b) && km(a, b) <= NEAR_KM && alike(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Whether two names share an identifying word and name the same side of any structure. */
function alike(a: Station, b: Station): boolean {
  return nameScore(a.name, b.name).identifying > 0 && sides(a.name) === sides(b.name);
}

/** Each copied station with its original's best match in every other source (see the top). */
export function copyPairs<T extends Station>(
  stations: T[],
  named: Set<string> = new Set(),
): [T, T][] {
  const pairs: [T, T][] = [];
  const window = COPY_KM / 111;
  for (const copy of stations.filter((s) => redistributed(s) && !named.has(s.id))) {
    const candidates = stations
      .filter((s) => !separate(copy, s) && Math.abs(s.lat - copy.lat) <= window)
      .map((s) => ({ s, d: km(copy, s), words: nameScore(copy.name, s.name).total }))
      .filter(
        // A town's name is shared by its streams, so a coastal copy matches no river.
        (c) =>
          c.d <= COPY_KM && alike(copy, c.s) && !(copy.kind && c.s.kind && copy.kind !== c.s.kind),
      );
    for (const [, matches] of Map.groupBy(candidates, (c) => c.s.source)) {
      matches.sort((x, y) => y.words - x.words || x.d - y.d || x.s.id.localeCompare(y.s.id));
      const [best, ...rest] = matches as [(typeof matches)[0], ...typeof matches];
      // A rival the source already links to the best match is the same gauge.
      const linked = (r: (typeof rest)[0]) =>
        r.s.same_as.includes(best.s.id) || best.s.same_as.includes(r.s.id);
      if (rest.some((r) => r.words === best.words && km(r.s, best.s) > 0.1 && !linked(r))) continue;
      pairs.push([copy, best.s]);
    }
  }
  return pairs;
}
