/**
 * Inventory tide-database's TICON records and the store source that can replace
 * each one. Reads a tide-database checkout (TIDE_DATABASE, default
 * ../slackwater-database) and the station lists in the store (STILLWELL_STORE,
 * default the public bucket over HTTPS), and writes
 * docs/ticon-replacement.csv (one row per record) and docs/ticon-replacement.md
 * (the summary).
 *
 *   node scripts/ticon-inventory.ts
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { readStationList } from "../src/store/parquet.ts";
import { stationListPath } from "../src/store/paths.ts";
import type { Station } from "../src/schema.ts";
import { DROPPED } from "../src/sources/gesla/dropped.ts";
import { withoutWithheld } from "../src/refresh.ts";
import { sources } from "../src/sources/index.ts";
import {
  adoptSiblings,
  parseId,
  replacement,
  type Replacement,
  type Status,
  type TiconRecord,
} from "../src/ticon.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TIDE_DATABASE = resolve(ROOT, process.env.TIDE_DATABASE ?? "../slackwater-database");
const STATUSES: Status[] = ["ready", "planned", "to_match", "license", "unmatched", "restricted"];

interface RawRecord {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  license: { commercial_use: boolean };
  source: { id: string };
  epoch: { start: string; end: string };
}

interface StationFile {
  sources?: string[];
  computed?: { sources?: Record<string, { quality?: { accepted?: boolean } }> };
}

// tide-database's own provenance rules, so a UHSLC relay maps to the same
// originator there as here. Loaded at run time from that checkout.
const provenance = (await import(
  pathToFileURL(join(TIDE_DATABASE, "sources/ticon/provenance.ts")).href
)) as { declaredOriginator?: (id: string) => string | undefined };
if (typeof provenance.declaredOriginator !== "function")
  throw new Error(`${TIDE_DATABASE}/sources/ticon/provenance.ts has no declaredOriginator`);

const commit = execFileSync("git", ["-C", TIDE_DATABASE, "rev-parse", "--short", "HEAD"], {
  encoding: "utf8",
}).trim();
const listed = await listedTicon();
const records: TiconRecord[] = [];
const dir = join(TIDE_DATABASE, "data/ticon");
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
  const raw = JSON.parse(await readFile(join(dir, file), "utf8")) as RawRecord;
  const id = raw.source.id;
  const entry = listed.get(id);
  records.push({
    id,
    name: raw.name,
    country: raw.country,
    lat: raw.latitude,
    lon: raw.longitude,
    ...parseId(id),
    commercial_use: raw.license.commercial_use,
    epoch: raw.epoch,
    published: !!entry,
    accepted: !!entry?.accepted,
    station: entry?.station,
    declared: provenance.declaredOriginator(id),
  });
}
// A station file naming a record the data doesn't have means one of the two is stale.
const known = new Set(records.map((r) => r.id));
const missing = [...listed.keys()].filter((id) => !known.has(id));
if (missing.length)
  throw new Error(`Station files list unknown TICON records: ${missing.join(", ")}`);

const STORE = (process.env.STILLWELL_STORE ?? "https://stillwell.openwaters.io").replace(/\/$/, "");
// A source that bars republishing has its list only in the restricted store, so
// it's left out. A source missing from the store would mark every record it
// replaces unmatched, so that stops the run, except for a source none of whose
// records the last inventory found ready: a new adapter before its first
// refresh, whose records keep the planned ids their codes give.
const previous = await readFile(join(ROOT, "docs/ticon-replacement.csv"), "utf8");
const lists: Record<string, Station[]> = {};
for (const [source, adapter] of Object.entries(sources)) {
  if (!adapter.metadata.license.redistribution) continue;
  const list = await readStationList(stationListPath(STORE, source));
  // A list not refreshed since a station was withheld still has it.
  if (list) lists[source] = withoutWithheld(adapter, list);
  // replacement_source, replacement_id, distance_km, status
  // GESLA's list gives every record's fallback copy, so it's always needed.
  else if (
    source === "gesla" ||
    new RegExp(`,${source},${source}/[^,]*,[^,]*,ready,`).test(previous)
  )
    throw new Error(`No station list for ${source} in ${STORE}`);
  else console.warn(`No station list for ${source} in ${STORE} yet; its records stay planned`);
}

const rows = adoptSiblings(
  records.map((record) => ({ record, replacement: replacement(record, lists) })),
  Object.values(lists).flat(),
);
// GESLA names its files as TICON names its records, so a record's GESLA 4.1
// copy is `gesla/<id>` where 4.1 kept the name (it renamed or dropped RWS's).
// A record in DROPPED holds another gauge's values, so it stands in for nothing.
const gesla = new Map(lists.gesla!.filter((s) => !DROPPED.has(s.source_id)).map((s) => [s.id, s]));
const geslaOf = (record: TiconRecord) => gesla.get(`gesla/${record.id}`);
await writeFile(join(ROOT, "docs/ticon-replacement.csv"), csv(rows));
await writeFile(join(ROOT, "docs/ticon-replacement.md"), summary(rows));
console.log(
  `${rows.length} TICON records, ${listed.size} published, ${records.filter((r) => r.accepted).length} accepted (tide-database ${commit})`,
);

/** TICON ids each tide-database station file lists, with quality's verdict on each. */
async function listedTicon(): Promise<Map<string, { station: string; accepted: boolean }>> {
  const ids = new Map<string, { station: string; accepted: boolean }>();
  const root = join(TIDE_DATABASE, "stations/tide");
  for (const country of await readdir(root, { withFileTypes: true })) {
    if (!country.isDirectory()) continue;
    for (const file of await readdir(join(root, country.name))) {
      if (!file.endsWith(".yaml")) continue;
      const station = `${country.name}/${file.replace(/\.yaml$/, "")}`;
      const doc = parse(await readFile(join(root, country.name, file), "utf8")) as StationFile;
      for (const source of doc.sources ?? []) {
        if (!source.startsWith("ticon/")) continue;
        const id = source.slice("ticon/".length);
        const other = ids.get(id);
        if (other) throw new Error(`${id} is listed by both ${other.station} and ${station}`);
        // Only an explicit acceptance counts; a record quality hasn't judged isn't accepted.
        const accepted = doc.computed?.sources?.[source]?.quality?.accepted === true;
        ids.set(id, { station, accepted });
      }
    }
  }
  return ids;
}

type Row = { record: TiconRecord; replacement: Replacement };

function csv(rows: Row[]): string {
  const header = [
    "ticon_id",
    "name",
    "country",
    "contributor",
    "published",
    "accepted",
    "station",
    "commercial_use",
    "epoch_start",
    "epoch_end",
    "declared_originator",
    "replacement_source",
    "replacement_id",
    "distance_km",
    "status",
    "note",
    "gesla_id",
    "gesla_commercial_use",
  ];
  const lines = rows.map(({ record: r, replacement: x }) =>
    [
      r.id,
      r.name,
      r.country,
      r.contributor,
      r.published,
      r.accepted,
      r.station ?? "",
      r.commercial_use,
      r.epoch.start,
      r.epoch.end,
      r.declared ?? "",
      x.source,
      x.id ?? "",
      x.distance_km ?? "",
      x.status,
      x.note ?? "",
      geslaOf(r)?.id ?? "",
      geslaOf(r)?.commercial_use ?? "",
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}

function cell(value: unknown): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function summary(rows: Row[]): string {
  const published = rows.filter((r) => r.record.published);
  const accepted = published.filter((r) => r.record.accepted);
  const count = (group: Row[], status: Status) =>
    group.filter((r) => r.replacement.status === status).length;
  const inGesla = (group: Row[], status: Status) =>
    group.filter((r) => r.replacement.status === status && geslaOf(r.record)).length;
  const acceptedInGesla = accepted.filter((r) => geslaOf(r.record)).length;
  const bySource = [...Map.groupBy(accepted, (r) => r.replacement.source).entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const statusOf = (group: Row[]) =>
    STATUSES.filter((s) => count(group, s))
      .map((s) => `${s} ${count(group, s)}`)
      .join(", ");
  const contributors = (group: Row[]) =>
    [...new Set(group.map((r) => r.record.contributor))].sort().join(", ");
  const meaning: Record<Status, string> = {
    ready: "An adapter exists and the record matched one of its stations",
    planned: "Cleared source, adapter in the plan",
    to_match:
      "Cleared source, adapter in the plan, but a CMEMS copy that has to match one of its stations first",
    license: "The source's terms need confirming first",
    unmatched: "An adapter exists, but no station matched, or two matched equally; check by hand",
    restricted: "The source forbids it; stays on TICON",
  };

  return `# TICON replacement inventory

Generated by \`npm run ticon:inventory\` from tide-database at \`${commit}\` and the station lists in the store; don't edit by hand. [ticon-replacement.csv](ticon-replacement.csv) has one row per TICON record. This is phase 2 of [plans/plan.md](plans/plan.md).

tide-database holds ${rows.length} TICON records. ${published.length} are listed in its station files, and its quality evaluation accepts ${accepted.length} of those; it still routes the rest, marked rejected. Work is ordered by accepted records.

| Status | Accepted | Accepted, in GESLA | All listed | Meaning |
| --- | --- | --- | --- | --- |
${STATUSES.map((s) => `| ${s} | ${count(accepted, s)} | ${inGesla(accepted, s)} | ${count(published, s)} | ${meaning[s]} |`).join("\n")}

The status is the originator's: the aim is an adapter for every source in GESLA, which brings live values and years after GESLA's release. ${acceptedInGesla} of the ${accepted.length} accepted records have a GESLA 4.1 copy listed in the store (\`gesla_id\` in the CSV), which can stand in for the originator in a re-fit. \`gesla_commercial_use\` gives the copy's terms as the \`gesla\` source tags them, from GESLA's table and its contributor's terms where this repo knows them; where the originator's own terms are still unconfirmed (\`license\`), take the stricter until they are. GESLA 4.1 renamed or dropped RWS's records, so this name match finds no RWS copy; [the GESLA adapter's README](../src/sources/gesla/README.md) maps some of the renamed ones by hand.

## By replacement source

Accepted records only, in the order to build adapters: most records first.

| Source | Records | Status | TICON contributors |
| --- | --- | --- | --- |
${bySource.map(([source, group]) => `| ${source} | ${group.length} | ${statusOf(group)} | ${contributors(group)} |`).join("\n")}

## How records are matched

- **Codes in the id.** TICON ids end in \`<code>-<country>-<contributor>\`. NOAA, USGS, REFMAR, Norwegian (\`nhs\`) and SMHI records carry the originator's station code, so they map to \`coops\`, \`usgs\` (with the leading zero TICON drops restored, to USGS's 8, 10 or 15 digits, or to 9 where USGS lists that site), \`kartverket\`, \`refmar\` and \`smhi\`. WSV and BfG records carry a PEGELONLINE number, used when an active PEGELONLINE station has it.
- **Declared provenance.** UHSLC and JODC records use tide-database's [\`sources/ticon/provenance.ts\`](https://github.com/openwatersio/slackwater-database/blob/main/sources/ticon/provenance.ts), so a relay of a NOAA, Kartverket, JMA or JODC gauge goes to that originator, as tide-database already treats it. Other UHSLC records go to UHSLC itself.
- **Position.** RWS records, WSV and BfG records without a PEGELONLINE number, Marine Institute coastal (\`mi_c\`) records, and CMEMS records in countries whose feed has a list in the store (France's once REFMAR's is there) match an active station with levels: one within 50 m outright, else the best name match within 5 km (counting shared words, including ones like "buiten" that separate an outer harbor from an inner one), else the nearest within 1 km. Two equally good stations more than 100 m apart leave the record unmatched. Never by name alone, since RWS and CMEMS spell places differently. A CMEMS record linked to a station of its national feed (\`LINKS\` in [\`src/same-as.ts\`](../src/same-as.ts)) matches that station wherever CMEMS places it, or stays \`to_match\` if it isn't an active station with levels; the UK's match the EA first.
- **Same station.** A record still unmatched takes the match of another record in its tide-database station file, since tide-database merges records only when they're the same gauge.
- **UK gauges.** BODC's records, and UK CMEMS ones, match an EA gauge by position, as above, once the EA's list is in the store, and BODC's own gauge once its list is. NOC's records of gauges outside the UK network stay \`restricted\`: BODC's open data is the UK network's alone.
- **CMEMS elsewhere.** CMEMS records in countries whose feed has no list in the store yet are \`to_match\`: cleared once matched to one of that feed's stations, not before.
- **Irish river gauges.** Marine Institute river (\`mi_r\`) records are \`unmatched\`: their dataset names no datum, so the adapter doesn't list them.
- **Contributor.** The rest map by contributor to a planned source, with its license status from Open Waters' internal sources research. A record's own \`commercial_use\` is TICON's terms for its copy; the replacement comes from the originator, under the originator's terms.

"Ready" means a station matched. German records' PEGELONLINE history reaches back to 2000 at most, and not at all at gauges without a download, so the rest comes from GESLA's copies (\`gesla\`). "Planned" and "license" ids are built from codes and not yet checked against the source's station list.
`;
}
