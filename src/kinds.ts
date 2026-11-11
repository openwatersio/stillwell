import type { Kind } from "./schema.ts";

/**
 * Stations whose source doesn't say what water they measure, with the kind a
 * maintainer found and why. Analysis and QC read `kind` (`judge` in
 * `src/lake/analysis.ts`, `qcFor` in `src/lake/recent.ts`): a `coastal`
 * gauge that stands still while dry at low water stays tidal, and a tidal
 * `river` keeps the outlier check off, where one of no kind can't. A source
 * that gives a kind itself stops the decision: the station keeps the source's
 * kind, and the refresh reports the entry and fails the run so a
 * maintainer removes it. A kind changes what `judge` and `qcFor` do, but doesn't make a
 * station due for analysis, so after adding, changing or removing an entry,
 * and the source's next refresh, run `analyze <source> --all` and then
 * `requalify <source> <station> 1800 2100` for each station it names, whatever
 * `analyze` reports, since a kind can change QC without changing a verdict. A
 * kind also decides copy links in `src/same-as.ts`, which need the same kind
 * where both stations have one, and a `river` is left out of the
 * cross-station checks (`scripts/cross-check.ts`), as every river is.
 */
export const KINDS: Record<string, { kind: Kind; note: string }> = {
  "rws/uithuizerwad": {
    kind: "coastal",
    note: "A Wadden Sea gauge on the tidal flats off Uithuizen, which runs dry at low water.",
  },
  "rws/werkendam.kleinezalm": {
    kind: "river",
    note: "On the Nieuwe Merwede at Werkendam, a Rhine distributary on the edge of the Biesbosch: tidal, about 12 cm of M2 and O1, and in flood with the Rhine.",
  },
  "rws/werkendam.steenenmuur": {
    kind: "river",
    note: "On the Nieuwe Merwede at Werkendam, beside Kleine Zalm: tidal, about 13 cm of M2 and O1, and in flood with the Rhine.",
  },
  "refmar/108": {
    kind: "coastal",
    note: "Dumont d'Urville, the French station's harbor on the Adélie Land coast of Antarctica.",
  },
  "refmar/308": {
    kind: "coastal",
    note: "Royan harbor, at the mouth of the Gironde on the Bay of Biscay, with a tide of about 1.5 m.",
  },
  "refmar/339": {
    kind: "coastal",
    note: "The port of Nice, on the Mediterranean.",
  },
  "refmar/673": {
    kind: "coastal",
    note: "Deshaies bay, on the Caribbean coast of Guadeloupe.",
  },
};

/**
 * Stations with `KINDS`' kind where their source gives none, and the entries
 * for `source` a maintainer should look at: one whose source gives another kind
 * of its own, which it keeps, and one naming a station neither the source nor
 * the lake (`previous`) lists, such as a typo. An adapter that keeps a
 * station's stored record, as REFMAR's does when a request fails, must leave
 * out its stored kind, which may be a decision's, not the source's, or a
 * changed entry reads as the source's kind.
 */
export function decideKinds<T extends { id: string; kind: Kind | null }>(
  source: string,
  stations: T[],
  previous: { id: string }[] = [],
): { stations: T[]; stale: string[] } {
  const stale: string[] = [];
  const known = new Set([...stations, ...previous].map((s) => s.id));
  for (const id of Object.keys(KINDS))
    if (id.startsWith(`${source}/`) && !known.has(id))
      stale.push(`${id} isn't listed by its source`);
  const decided = stations.map((s) => {
    const decision = KINDS[s.id];
    if (!decision) return s;
    if (s.kind !== null && s.kind !== decision.kind) {
      stale.push(`${s.id} is now ${s.kind} by its source, not ${decision.kind}`);
      return s;
    }
    return { ...s, kind: decision.kind };
  });
  return { stations: decided, stale };
}
