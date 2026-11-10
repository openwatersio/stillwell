import type { Kind } from "./schema.ts";

/**
 * Stations whose source doesn't say what water they measure, with the kind a
 * person found and why. Analysis and QC read `kind` (`judge` in
 * `src/lake/analysis.ts`, `qcFor` in `src/lake/recent.ts`): a `coastal`
 * gauge that stands still while dry at low water stays tidal, and a tidal
 * `river` keeps the outlier check off, where one of no kind can't. A source
 * that gives a kind itself stops the decision: the station keeps the source's
 * kind, and the refresh reports the entry and fails the run so a person
 * removes it.
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
 * whose source now gives one of its own, which a person should remove.
 */
export function decideKinds<T extends { id: string; kind: Kind | null }>(
  stations: T[],
): { stations: T[]; stale: string[] } {
  const stale: string[] = [];
  const decided = stations.map((s) => {
    const decision = KINDS[s.id];
    if (!decision) return s;
    if (s.kind !== null) {
      stale.push(`${s.id} is now ${s.kind} by its source, not ${decision.kind}`);
      return s;
    }
    return { ...s, kind: decision.kind };
  });
  return { stations: decided, stale };
}
