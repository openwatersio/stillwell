/**
 * Writes src/sources/gesla/coverage.csv (one row per GESLA 4.1 record) and
 * coverage.md (the summary): which records the store also has from their
 * originator through `same_as`, and which years each side has that the other
 * lacks. Reads the store (STILLWELL_STORE, a local directory or an HTTPS URL,
 * default the public bucket): stations.parquet, GESLA's list and the years file
 * of every source GESLA links to.
 *
 *   npm run gesla:coverage
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { isMissing } from "../src/store/parquet.ts";
import { stationListPath, stationsPath, yearsPath } from "../src/store/paths.ts";
import { CONTRIBUTORS } from "../src/sources/gesla/contributors.ts";
import { DROPPED } from "../src/sources/gesla/dropped.ts";

assert.equal(ranges([1950, 1951, 1952, 1960, 1962, 1963]), "1950–1952, 1960, 1962–1963");
assert.equal(ranges([]), "");

const STORE = (process.env.STILLWELL_STORE ?? "https://stillwell.openwaters.io").replace(/\/$/, "");
// shortcut: hand-kept; drop a source once its history backfill finishes.
const BACKFILLING = ["usgs", "coops"];
// Whether a source's own service has the years before the store's first, from
// its README or a spot check of one week of July against the adapter on
// 2026-11-12 (a year the store has returned values at each). A check is one
// gauge's answer, applied to the source's other gauges. `served` years are a
// backfill shortfall, unserved ones years only GESLA has; without `served` the
// question is still open.
const REACH: Record<string, { served?: boolean; note: string }> = {
  coops: { served: true, note: "Served: New London 1960" },
  usgs: {
    note: "Backfill still running; Provincetown 2018 and Inwood 2004 empty, and history mostly from 2007",
  },
  uhslc: { served: false, note: "Not served: Christmas Island (170) 1980" },
  rws: {
    served: false,
    note: "Not served: IJmuiden Noordersluis 1970, Brouwershavensche Gat 08 2016",
  },
  crms: {
    note: "Links to only the site's `H01`; see below",
  },
  refmar: { served: false, note: "Not served: Socoa 1900" },
  pegelonline: { served: false, note: "Raw-data download from 2000 at most; Cuxhaven 1995 empty" },
  jma: { served: false, note: "Not served: Shimonoseki 1980" },
  kartverket: { served: false, note: "API from 1986 at the oldest gauges; Oslo 2000 empty" },
  dwr: { served: false, note: "Not served: Collinsville (B91110) 2015" },
  cdec: { served: false, note: "15-minute data from 2006; Holt 2000 empty" },
  ea: { served: false, note: "API keeps recent readings only; Newlyn 2020 empty" },
  bodc: { served: false, note: "ERDDAP from April 2022; the older record needs a BODC login" },
  sfwmd: { served: false, note: "Not served: G-58 2005, S-197 1985" },
};

const OUT = new URL("../src/sources/gesla/", import.meta.url);

const db = await (await DuckDBInstance.create(":memory:")).connect();
if (/^https?:\/\//.test(STORE)) await db.run("INSTALL httpfs; LOAD httpfs;");
await db.run("SET TimeZone = 'UTC'");
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const rows = async (sql: string) =>
  (await db.runAndReadAll(sql)).getRowObjectsJS() as Record<string, any>[];

await db.run(`CREATE TABLE st AS SELECT id, source, name, country_code, products, coalesce(same_as, []) AS same_as,
    preferred, live AND status = 'active' AS polled, commercial_use
  FROM read_parquet(${quote(stationsPath(STORE))})`);
const records = await rows(`
  SELECT g.id, s.name, s.country_code, json_extract_string(g.extra, '$.contributor') AS contributor,
    s.commercial_use, s.preferred, s.same_as,
    -- other sources' series of the gauge with levels
    coalesce((SELECT list(o.id ORDER BY o.id) FROM st o
      WHERE list_contains(s.same_as, o.id) AND o.source != 'gesla' AND list_contains(o.products, 'levels')), []) AS others
  FROM read_parquet(${quote(stationListPath(STORE, "gesla"))}) g JOIN st s USING (id)
  ORDER BY g.id`);
const list = records.filter((r) => !DROPPED.has(r.id.slice("gesla/".length)));
for (const r of list)
  r.others.sort((a: string, b: string) => +(b === r.preferred) - +(a === r.preferred));

const linked = new Map<string, Record<string, any>>(
  (
    await rows(
      `SELECT id, source, polled, commercial_use FROM st WHERE id IN (SELECT unnest(same_as) FROM st WHERE source = 'gesla')`,
    )
  ).map((s) => [s.id, s]),
);
const sources = [...new Set([...linked.values()].map((s) => s.source as string))].sort();

// Years with a file, in any epoch. A row with no year marks a station whose rows a
// run is rewriting, so its years may be short.
const years = new Map<string, Set<number>>();
const marked = new Set<string>();
const withYears = new Map<string, number>();
for (const source of new Set(["gesla", ...sources, ...BACKFILLING])) {
  let found: Record<string, any>[];
  try {
    found = await rows(
      `SELECT DISTINCT id, year FROM read_parquet(${quote(yearsPath(STORE, source))}) WHERE year IS NULL OR hours > 0`,
    );
  } catch (error) {
    // A source's years file starts with its first `ingest years` run.
    if (source === "gesla" || !isMissing(error)) throw error;
    console.warn(`No years file for ${source}; its series count as not backfilled`);
    continue;
  }
  for (const { id, year } of found) {
    if (year === null) marked.add(id);
    else (years.get(id) ?? years.set(id, new Set()).get(id)!).add(year);
  }
  withYears.set(source, new Set(found.filter((r) => r.year !== null).map((r) => r.id)).size);
}
const progress = await rows(`SELECT source, count(*) AS stations FROM st
  WHERE source IN (${BACKFILLING.map(quote).join(",")}) AND list_contains(products, 'levels') GROUP BY source ORDER BY source`);

interface Row {
  id: string;
  name: string;
  country: string;
  contributor: string;
  /** The gauge: this record and its `same_as`, sorted. */
  gauge: string;
  originators: string[];
  relays: string[];
  live: boolean;
  marked: boolean;
  gesla: number[];
  originator: number[];
  geslaOnly: number[];
  originatorOnly: number[];
  geslaCommercial: boolean;
  originatorCommercial: boolean | null;
}

const gaugeKey = (r: Record<string, any>) => [r.id, ...r.same_as].sort().join(" ");
// UHSLC relays other agencies' gauges: where GESLA also holds another
// agency's record of the gauge, that agency is the originator, for every record
// of the gauge; elsewhere UHSLC is.
const agencyGauges = new Set(list.filter((r) => !r.contributor.startsWith("UHSLC")).map(gaugeKey));
const table: Row[] = list.map((r) => {
  const relay = (id: string) => id.startsWith("uhslc/") && agencyGauges.has(gaugeKey(r));
  const originators: string[] = r.others.filter((id: string) => !relay(id));
  const gesla = yearsOf([r.id]);
  const originator = yearsOf(originators);
  const o = new Set(originator);
  const others = originators.map((id) => linked.get(id)!);
  return {
    id: r.id,
    name: r.name,
    country: r.country_code,
    contributor: r.contributor,
    gauge: gaugeKey(r),
    originators,
    relays: r.others.filter(relay),
    live: others.some((s) => s.polled),
    marked: [r.id, ...originators].some((id) => marked.has(id)),
    gesla,
    originator,
    geslaOnly: gesla.filter((y) => !o.has(y)),
    originatorOnly: [],
    geslaCommercial: r.commercial_use,
    originatorCommercial: others.length ? others.some((s) => s.commercial_use) : null,
  };
});
// A gauge's other GESLA records hold years too, so originator-only years are
// those no GESLA record of the gauge has. A gauge's originator series are every
// record's: UHSLC is the originator for its own records and a relay for others'.
const gaugeOf = new Map<
  string,
  { originators: string[]; originator: number[]; originatorOnly: number[] }
>();
for (const [gauge, group] of Map.groupBy(table, (r) => r.gauge)) {
  const held = new Set(group.flatMap((r) => r.gesla));
  for (const r of group) r.originatorOnly = r.originator.filter((y) => !held.has(y));
  const originators = [...new Set(group.flatMap((r) => r.originators))];
  const originator = yearsOf(originators);
  gaugeOf.set(gauge, {
    originators,
    originator,
    originatorOnly: originator.filter((y) => !held.has(y)),
  });
}

await writeFile(new URL("coverage.csv", OUT), csv(table));
await writeFile(new URL("coverage.md", OUT), summary(table));
console.log(`${table.length} records, ${table.filter((r) => r.originators.length).length} linked`);

function yearsOf(ids: string[]): number[] {
  return [...new Set(ids.flatMap((id) => [...(years.get(id) ?? [])]))].sort((a, b) => a - b);
}

function sum<T>(list: T[], f: (x: T) => number): number {
  return list.reduce((n, x) => n + f(x), 0);
}

/**
 * A set of records as gauges: each gauge's GESLA years (those of the given
 * records only), its originator's years and series, and the years only the
 * GESLA records have, so a gauge GESLA holds twice counts once.
 */
function gauges(rows: Row[]) {
  return [...Map.groupBy(rows, (r) => r.gauge).values()].map((group) => {
    const gesla = [...new Set(group.flatMap((r) => r.gesla))].sort((a, b) => a - b);
    const { originator, originators, originatorOnly } = gaugeOf.get(group[0]!.gauge)!;
    const o = new Set(originator);
    return {
      gesla,
      originator,
      originators,
      originatorOnly,
      geslaOnly: gesla.filter((y) => !o.has(y)),
    };
  });
}

/** Years as runs: 1950–1952, 1960. */
function ranges(years: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < years.length;) {
    let j = i;
    while (years[j + 1] === years[j]! + 1) j++;
    out.push(i === j ? `${years[i]}` : `${years[i]}–${years[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

function cell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: Row[]): string {
  const header = [
    "gesla_id",
    "name",
    "country",
    "contributor",
    "originator_series",
    "originator_live",
    "uhslc_relay",
    "gesla_first",
    "gesla_last",
    "originator_first",
    "originator_last",
    "gesla_only_years",
    "gesla_only_count",
    "originator_only_years",
    "originator_only_count",
    "years_marked",
    "gesla_commercial_use",
    "originator_commercial_use",
  ];
  const lines = rows.map((r) =>
    [
      r.id,
      r.name,
      r.country,
      r.contributor,
      r.originators.join(" "),
      r.originators.length ? r.live : "",
      r.relays.join(" "),
      r.gesla[0],
      r.gesla.at(-1),
      r.originator[0],
      r.originator.at(-1),
      ranges(r.geslaOnly),
      r.geslaOnly.length,
      ranges(r.originatorOnly),
      r.originatorOnly.length,
      r.marked,
      r.geslaCommercial,
      r.originatorCommercial,
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

function summary(rows: Row[]): string {
  const linkedRows = rows.filter((r) => r.originators.length);
  const unlinked = rows.filter((r) => !r.originators.length);
  const linkedGauges = gauges(linkedRows);
  const byContributor = [...Map.groupBy(rows, (r) => r.contributor)].sort(
    ([a, x], [b, y]) => y.length - x.length || a.localeCompare(b),
  );
  const contributorRows = byContributor.map(([c, group]) => {
    const l = group.filter((r) => r.originators.length);
    const g = gauges(l);
    const srcs = [...new Set(l.flatMap((r) => r.originators.map((id) => id.split("/")[0])))].sort();
    const relayOnly = group.filter((r) => !r.originators.length && r.relays.length).length;
    return `| ${c} | ${group.length} | ${l.length} | ${l.filter((r) => r.live).length} | ${relayOnly} | ${l.filter((r) => r.geslaOnly.length).length} | ${sum(g, (x) => x.geslaOnly.length)} | ${sum(g, (x) => x.originatorOnly.length)} | ${srcs.join(", ")} |`;
  });

  const missing = byContributor
    .map(([c, g]) => [c, g, g.filter((r) => !r.originators.length)] as const)
    .filter(([, , u]) => u.length)
    .sort(([a, , x], [b, , y]) => y.length - x.length || a.localeCompare(b));
  const countries = (g: Row[]) =>
    [...Map.groupBy(g, (r) => r.country)]
      .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
      .map(([c, x]) => `${c} ${x.length}`)
      .join(", ");
  const terms = (c: string) => (CONTRIBUTORS[c.toUpperCase()]?.commercial_use ? "yes" : "no");

  // A gauge's years before the originator's first go to the source holding that
  // first year, or to its first series where none has years yet.
  const lead = (x: (typeof linkedGauges)[number]) => {
    const first = x.originator[0];
    const holder = x.originators.find((id) => first !== undefined && years.get(id)?.has(first));
    return (holder ?? x.originators[0]!).split("/")[0]!;
  };
  const bySource = [...Map.groupBy(linkedGauges, lead)].sort(
    ([a, x], [b, y]) => y.length - x.length || a.localeCompare(b),
  );
  const gaps = bySource.map(([source, g]) => {
    const empty = g.filter((x) => !x.originator.length);
    const backed = g.filter((x) => x.originator.length);
    const before = sum(backed, (x) => x.geslaOnly.filter((y) => y < x.originator[0]!).length);
    const after = sum(backed, (x) => x.geslaOnly.filter((y) => y > x.originator.at(-1)!).length);
    const inside = sum(backed, (x) => x.geslaOnly.length) - before - after;
    const first = Math.min(...backed.map((x) => x.originator[0]!));
    const emptyYears = sum(empty, (x) => x.gesla.length);
    return { source, g, empty, emptyYears, before, inside, after, first };
  });
  const gapRows = gaps.map(
    (x) =>
      `| ${x.source}${BACKFILLING.includes(x.source) ? " (backfilling)" : ""} | ${x.g.length} | ${x.empty.length} | ${x.emptyYears} | ${x.before} | ${x.inside} | ${x.after} | ${Number.isFinite(x.first) ? x.first : ""} | ${REACH[x.source]?.note ?? ""} |`,
  );
  const total = sum(gaps, (x) => x.emptyYears + x.before + x.inside + x.after);
  // A gauge's early years are a shortfall if any of its sources serves its
  // history, and missing at the source only if every source's check says so. A
  // check can't speak for a gauge with no years in the store to compare.
  const early = (x: (typeof linkedGauges)[number]) =>
    x.originator.length ? x.geslaOnly.filter((y) => y < x.originator[0]!).length : x.gesla.length;
  const verdict = (x: (typeof linkedGauges)[number]) => {
    const reach = [...new Set(x.originators.map((id) => id.split("/")[0]!))].map(
      (s) => REACH[s]?.served,
    );
    if (reach.includes(true)) return "shortfall";
    return x.originator.length && reach.every((r) => r === false) ? "notServed" : "open";
  };
  const by = (v: string) =>
    sum(
      linkedGauges.filter((x) => verdict(x) === v),
      early,
    );
  const shortfall = by("shortfall");
  const notServed = by("notServed");
  const open = by("open");
  const markedRows = rows.filter((r) => r.marked).length;

  return `# GESLA coverage

Generated by \`npm run gesla:coverage\` from the store's station lists and years files; don't edit by hand. [coverage.csv](coverage.csv) has one row per record. It counts GESLA 4.1's ${rows.length} records in the store (less the records in \`DROPPED\`, whose values are another gauge's), and for each finds the originator's series of the gauge through \`same_as\`: any other source's series with levels, except UHSLC's series at a gauge GESLA also holds from another agency, such as BOM or NOAA, whose originator that agency is; those are listed apart as relays (\`uhslc_relay\`), for every record of the gauge, GESLA's UHSLC records included. Elsewhere UHSLC is the originator. Where a gauge has several originator series, such as a USGS and a CO-OPS series, a year counts if any has it. A year counts on a side when the store has a file of levels for it, so a year of a few hours counts as much as a whole one, and a file with no values doesn't count; a year counts whatever its values' flags. A record is live when hourly ingest polls one of its originator series (\`live\` and \`active\`).

GESLA often holds a gauge more than once, from two contributors or in several versions, so the CSV's \`gesla_only_years\` are one record's years the originator lacks, and \`originator_only_years\` the originator's years no GESLA record of the gauge has. Station-year totals below count each gauge once.

The ${BACKFILLING.join(" and ")} history backfills were still running when this was generated (${progress.map((p) => `${p.source} ${withYears.get(p.source) ?? 0} of ${p.stations} stations with years`).join(", ")}), so their gaps will shrink. ${markedRows ? `${markedRows} records' series are marked in the years file (\`years_marked\`): a run was rewriting them, or stopped partway or couldn't read a file, so their years may be short. ` : ""}Regenerate with \`npm run gesla:coverage\` after a backfill campaign, first taking a finished source out of \`BACKFILLING\` and updating \`REACH\` in [the script](../../../scripts/gesla-coverage.ts); it reads the public store, or a local one through \`STILLWELL_STORE\`.

- **${linkedRows.length}** of ${rows.length} records are linked to the originator's series, and **${linkedRows.filter((r) => r.live).length}** of those to one hourly ingest polls. Another **${unlinked.filter((r) => r.relays.length).length}** have only UHSLC's copy.
- **${linkedRows.filter((r) => r.geslaOnly.length).length}** linked records have years their originator lacks: **${sum(linkedGauges, (x) => x.geslaOnly.length)}** station-years over ${linkedGauges.filter((x) => x.geslaOnly.length).length} gauges. **${unlinked.length}** records have no originator series, **${sum(gauges(unlinked), (x) => x.gesla.length)}** station-years.
- Originators have **${sum(linkedGauges, (x) => x.originatorOnly.length)}** station-years GESLA lacks, ${sum(linkedGauges, (x) => x.originatorOnly.filter((y) => y > (x.gesla.at(-1) ?? 0)).length)} of them after GESLA's last year.

## By contributor

"Linked" counts records with the originator's series of the gauge in the store; "live" those whose originator series hourly ingest polls; "UHSLC only" those whose only other series is UHSLC's copy. "Short" counts linked records with years their originator lacks. "GESLA-only years" adds up the contributor's years the originator lacks, and "originator-only years" the originator's years no GESLA record of the gauge has, each gauge once; a gauge GESLA holds from two contributors counts under both.

| Contributor | Records | Linked | Live | UHSLC only | Short | GESLA-only years | Originator-only years | Originator sources |
| --- | --: | --: | --: | --: | --: | --: | --: | --- |
${contributorRows.join("\n")}

## Records with no originator series

The records with no originator series in the store, by contributor, most first: the adapters for the first rows' originators would add the most. "None linked" marks a contributor with no originator series in the store at all. Station-years are the unlinked records' years, each gauge once; "UHSLC copy" counts the unlinked records whose gauge the store also has from UHSLC's relay; the rest only GESLA has. "Contributor commercial use" is the contributor's terms in [contributors.ts](contributors.ts); a record's own, in the CSV, can be stricter.

| Contributor | Records | Unlinked | Station-years | UHSLC copy | Contributor commercial use | Countries |
| --- | --: | --: | --: | --: | --- | --- |
${missing.map(([c, g, u]) => `| ${c} | ${g.length} | ${u.length === g.length ? `${u.length}, none linked` : u.length} | ${sum(gauges(u), (x) => x.gesla.length)} | ${u.filter((r) => r.relays.length).length} | ${terms(c)} | ${countries(u)} |`).join("\n")}

CMEMS's records come from national agencies, so their countries say which feed would cover them. Some contributors need permission first: CHS's terms for MEDS's gauges bar commercial use without a license, and JODC, UNAM and BOM have been asked ([contributors.md](contributors.md)).

## Year gaps by source

Linked gauges, each once, by the source holding the originator's first year, or the first originator series where none has years yet. "Not backfilled" counts gauges whose originator series have no years in the store yet, and the GESLA years they hold. The rest split GESLA's extra years by where they fall against the originator's years in the store: before its first year, in a gap between its first and last, or after its last. Years before the first are a backfill shortfall where the source serves them, and years only GESLA has where it doesn't. "Reach" says which, from the source's README or a spot check through the adapter, on 2026-11-12, of one week of July at one or two gauges, in a year GESLA has; a check speaks for the source's other gauges only as a sample.

Of the ${total} GESLA-only station-years at linked gauges, ${shortfall} (not backfilled, or before the first year) are at gauges one of whose sources serves them, by the checks: a backfill shortfall. ${notServed} are before the first year at gauges whose every source, by the checks, doesn't reach them, so GESLA is the store's only copy. ${open} are still open: at gauges whose originator series have no years yet at a source no check shows serving them, or at sources without a settled check, such as USGS, whose backfill is still running, and CRMS, whose site's later gauge would cover most. The other ${total - shortfall - notServed - open} fall in gaps or after the originator's last year.

At CRMS, 350 of the GESLA-only years were in a later gauge of the site (\`H02\`), which GESLA's records didn't link to on 2026-11-12. The rest are years CPRA's export doesn't give for the series it lists: before the site's first listed series (366 years), after its last (106), or at a site whose listed series has no values (140). CRMS0176's and CRMS1446's later years are likely another site's gauge, which CPRA lists under the site as \`H0X\` and the adapter leaves out ([crms README](../crms/README.md)).

| Source | Gauges | Not backfilled | Their years | Before first | In a gap | After last | Earliest year | Reach |
| --- | --: | --: | --: | --: | --: | --: | --: | --- |
${gapRows.join("\n")}
`;
}
