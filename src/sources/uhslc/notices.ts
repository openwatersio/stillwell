/**
 * Terms a contributor attaches to its gauges in UHSLC's research-quality
 * documentation files (`rqds/<ocean>/doc/qa<id>.dmt`), beyond UHSLC's own.
 * `scripts/uhslc-contributors.ts` finds each one by its `pattern` and records
 * which stations carry it in `contributors.ts`. Every station UHSLC serves
 * openly goes in the public store, unless its notice is `refused`; a notice
 * sets its commercial-use tag and adds its contributor's credit. A station
 * whose file has none keeps UHSLC's terms.
 */
export interface Notice {
  /** Who the terms are from. */
  name: string;
  /** Matches the notice in a documentation file, whitespace collapsed. */
  pattern: RegExp;
  commercial_use: boolean;
  /** The credit the terms ask for, added to UHSLC's; null for the file's own contributor. */
  credit: string | null;
  url: string | null;
  /** What the terms say, in short. */
  terms: string;
  /**
   * The issue recording the contributor's refusal to let the store republish
   * its data. Its stations, and GESLA's copies of them, are withheld: never
   * listed, never fetched, and removed from the store (`ingest withhold`).
   */
  refused?: string;
}

export const NOTICES: Record<string, Notice> = {
  // Terms text the scan found but no notice below matches: non-commercial until
  // a person reads it and adds a notice.
  unreviewed: {
    name: "Terms not yet reviewed",
    pattern: /(?!)/,
    commercial_use: false,
    credit: null,
    url: null,
    terms: "The documentation file has terms no notice here covers yet.",
  },
  bom: {
    name: "Bureau of Meteorology",
    pattern: /bom\.gov\.au\/other\/copyright/,
    commercial_use: false,
    credit: "Bureau of Meteorology, © Commonwealth of Australia",
    url: "http://www.bom.gov.au/other/copyright.shtml",
    terms:
      "Users are deemed to accept BOM's copyright notice, whose default for content without a stated licence is personal or in-house use, not supplied to others or used commercially.",
  },
  jma: {
    name: "Japan Meteorological Agency",
    pattern: /jma\.go\.jp\/jma\/en\/copyright/,
    commercial_use: true,
    credit: "Japan Meteorological Agency",
    url: "https://www.jma.go.jp/jma/en/copyright.html",
    terms:
      "The file quotes an older notice asking for notice to JMA before redistribution; JMA's current terms (Public Data License 1.0, 2016) are compatible with CC BY 4.0 and ask that the source be credited.",
  },
  ntf: {
    name: "National Tidal Facility, Flinders University of South Australia",
    pattern: /National Tidal Facility,? The Flinders/,
    commercial_use: true,
    credit: "National Tidal Facility, The Flinders University of South Australia",
    url: null,
    terms:
      "Copyright reserved; publications must acknowledge the National Tidal Facility in its approved form; no warranty.",
  },
  ntslf: {
    name: "National Tidal and Sea Level Facility (BODC)",
    pattern: /Users must not pass on the data to third parties/,
    commercial_use: true,
    credit:
      "British Oceanographic Data Centre, as part of the function of the National Tidal and Sea Level Facility; Environment Agency",
    url: "https://www.bodc.ac.uk/data/hosted_data_systems/sea_level/uk_tide_gauge_network/",
    terms:
      "The file says users must not pass the data on to third parties. BODC's processed UK National Tide Gauge Network data is under the Open Government Licence v3.0, as its ERDDAP datasets state and BODC confirmed in writing (ticket BODCREQ-11479, openwatersio/stillwell#80), which allows republishing it under CC BY 4.0, crediting BODC and the Environment Agency.",
  },
  ccby: {
    name: "CC BY 4.0",
    pattern: /Creative Commons Attribution 4\.0/,
    commercial_use: true,
    credit: null,
    url: "https://creativecommons.org/licenses/by/4.0/",
    terms: "CC BY 4.0, crediting the contributor.",
  },
  dmi: {
    name: "Danish Meteorological Institute",
    pattern: /allowed for non-?comm?ercial use/i,
    commercial_use: false,
    credit: "Danish Meteorological Institute",
    url: null,
    terms: "Use and publication allowed for non-commercial purposes, with reference.",
  },
  sanho: {
    name: "South African Navy Hydrographic Office",
    pattern: /South Africa Navy Hydrographic Office/,
    commercial_use: false,
    credit: "South African Navy Hydrographic Office",
    url: null,
    terms:
      "SANHO owns the data and refused permission to republish any of it, so its stations are withheld from the store. UHSLC serves Walvis Bay, in Namibia, openly, and withholds its South African stations until a user agrees to SANHO's terms.",
    refused: "https://github.com/openwatersio/stillwell/issues/80",
  },
};

/**
 * UHSLC station numbers whose files don't carry a refused notice but whose
 * gauge another source credits to the refusing contributor, by number: the
 * notice that withholds them, and why.
 */
export const ALSO_WITHHELD: Record<string, { notice: string; reason: string }> = {
  // Lüderitz, in Namibia. SANHO refused "any of our national tide gauge data" (#80).
  "702": {
    notice: "sanho",
    reason: "GESLA names SANHO as originator; UHSLC's documentation names none",
  },
};

/**
 * The most restrictive notice a file's text, whitespace collapsed, carries: a
 * refusal first, then one that bars commercial use; null for none.
 */
export function noticeOf(flat: string): string | null {
  const rank = (n: Notice) => (n.refused ? 0 : n.commercial_use ? 2 : 1);
  const found = Object.entries(NOTICES).filter(([, n]) => n.pattern.test(flat));
  found.sort(([, a], [, b]) => rank(a) - rank(b));
  return found[0]?.[0] ?? null;
}

/**
 * Station numbers one of whose versions carries a `refused` notice in
 * `before` but none in `after`, such as when UHSLC rewords the notice or drops
 * the version that had it. A rescan that loses one would list the station again.
 */
export function lostRefusals(
  before: Record<string, { notice: string | null } | undefined>,
  after: Record<string, { notice: string | null } | undefined>,
): string[] {
  const refusing = (scan: typeof before) =>
    new Set(
      Object.entries(scan)
        .filter(([, r]) => r?.notice && NOTICES[r.notice]?.refused)
        .map(([key]) => key.slice(0, 3)),
    );
  const now = refusing(after);
  return [...refusing(before)].filter((n) => !now.has(n)).sort();
}

/**
 * The `Originator #` field, the station number the contributor gives the
 * gauge, such as CO-OPS's `1612340` at Honolulu; null when it's empty or
 * says there's none.
 */
export function originatorOf(text: string): string | null {
  const match = /Originator\s*#\s*:[ \t]*(.*?)(?:\s{2,}|\s+NODC\b|$)/m.exec(
    text.replace(/\r/g, ""),
  );
  const value = match?.[1]!.trim() ?? "";
  // A blank field runs straight into the next one, "NODC #".
  return /^(|none|n\/?a|unknown|-+|\?+)$|^NODC\b/i.test(value) ? null : value;
}

/**
 * The `Contributor` field's first line, with the next line when the name runs
 * on to it; "unconfirmed" is no contributor. UHSLC's own name comes in several
 * spellings.
 */
export function contributorOf(text: string): string | null {
  // Some files have Windows line ends.
  const match = /^[ \t]*Contributor[ \t]*:[ \t]*(.*)\n[ \t]*(.*)$/m.exec(text.replace(/\r/g, ""));
  if (!match) return null;
  let name = match[1]!.trim();
  // A label for a span of years, such as "For 1984-1988:", names it on the next line.
  if (name.endsWith(":")) name = match[2]!.trim();
  else if (/(,|\b(de|de la|del|of|the|and|y|for))$/i.test(name))
    name = `${name} ${match[2]!.trim()}`;
  name = name.replace(/[\s,-]+$/, "").replace(/\s+/g, " ");
  if (!name || /^unconfirmed$/i.test(name)) return null;
  if (/^(UH|University of Hawaii) Sea Level Center\b/i.test(name))
    return "University of Hawaii Sea Level Center";
  return name;
}
