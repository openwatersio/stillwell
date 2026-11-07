/**
 * Terms a contributor attaches to its gauges in UHSLC's research-quality
 * documentation files (`rqds/<ocean>/doc/qa<id>.dmt`), beyond UHSLC's own.
 * `scripts/uhslc-contributors.ts` finds each one by its `pattern` and records
 * which stations carry it in `contributors.ts`. Every station UHSLC serves
 * openly goes in the public lake; a notice sets its commercial-use tag and adds
 * its contributor's credit. A station whose file has none keeps UHSLC's terms.
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
    commercial_use: false,
    credit:
      "British Oceanographic Data Centre, as part of the function of the National Tidal and Sea Level Facility; Environment Agency",
    url: "https://ntslf.org/",
    terms:
      "Users must not pass the data on to third parties but direct them to the NTSLF; publications acknowledge BODC and the Environment Agency.",
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
      "SANHO owns the data and asks for permission to use or reproduce it. UHSLC withholds its South African stations until a user agrees, so those aren't listed; it serves Walvis Bay, in Namibia, openly.",
  },
};

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
