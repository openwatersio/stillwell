/**
 * The committed station files `ingest seed-stations` starts each source's
 * list in the lake from, until they're removed: one YAML file per station, at
 * `stations/<source>/<source_id>.yml`, with the `source_id` URL-encoded as in
 * the lake's paths. One file per station keeps a refresh's diff to the
 * stations that changed and lets a person resolve one by hand.
 *
 * A file leaves out what its path already says (`id`, `source`, `source_id`),
 * what the lake fills in (`first`, `last`), its source's terms (`license`,
 * `commercial_use`, `attribution`) unless the station's differ, fields that
 * are null, and an empty `datums` or `same_as`.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parse,
  parseDocument,
  type Node,
  type YAMLMap,
} from "yaml";
import { stationDefaults, type SourceMetadata, type Station } from "./schema.ts";

const OMITTED = new Set(["id", "source", "source_id", "first", "last"]);

/** The order fields appear in; a source's own fields (CO-OPS `established`) follow, sorted. */
const ORDER = [
  "name",
  "lat",
  "lon",
  "country_code",
  "kind",
  "datum",
  "datums",
  "products",
  "interval_s",
  "min_interval_s",
  "live",
  "status",
  "tide_station",
  "same_as",
  "license",
  "commercial_use",
  "attribution",
  "source_url",
];

/** What a field a file leaves out reads as, besides its source's terms. */
const DEFAULTS: Partial<Station> = {
  country_code: null,
  kind: null,
  interval_s: null,
  min_interval_s: null,
  tide_station: null,
  source_url: null,
  datums: {},
  same_as: [],
  first: null,
  last: null,
};

/** Short lists stay on one line, as long as Prettier would leave them there. */
const FLOW = new Set(["products", "same_as"]);
const PRINT_WIDTH = 100;

const PRODUCTS = ["levels", "extremes", "predictions", "predicted_extremes"];
const KINDS = ["coastal", "estuary", "lake", "river"];
const isString = (v: unknown) => typeof v === "string";
const isNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const orNull = (test: (v: unknown) => boolean) => (v: unknown) => v === null || test(v);

/**
 * What each shared field must hold, since a person edits these files and
 * ingest trusts them (`commercial_use` decides which lake a series goes to).
 * A source's own fields are its adapter's to check.
 */
const FIELDS: Record<string, [test: (v: unknown) => boolean, required: boolean]> = {
  name: [isString, true],
  lat: [isNumber, true],
  lon: [isNumber, true],
  country_code: [orNull(isString), false],
  kind: [orNull((v) => KINDS.includes(v as string)), false],
  datum: [isString, true],
  datums: [(v) => isPlainObject(v) && Object.values(v).every(isNumber), false],
  products: [(v) => Array.isArray(v) && v.every((p) => PRODUCTS.includes(p)), true],
  interval_s: [orNull(isNumber), false],
  min_interval_s: [orNull(isNumber), false],
  live: [(v) => typeof v === "boolean", true],
  status: [(v) => v === "active" || v === "inactive", true],
  tide_station: [orNull(isString), false],
  same_as: [(v) => Array.isArray(v) && v.every(isString), false],
  license: [isString, true],
  commercial_use: [(v) => typeof v === "boolean", true],
  attribution: [isString, true],
  source_url: [orNull(isString), false],
};

/** What a file leaves out for a source: the shared defaults and its terms. */
function defaultsFor(metadata: SourceMetadata): Partial<Station> {
  const { source: _, ...terms } = stationDefaults(metadata);
  return { ...DEFAULTS, ...terms };
}

/** Why a file's fields aren't a station's, if they aren't. */
function problems(fields: Record<string, unknown>, defaults: Partial<Station>): string[] {
  const found: string[] = [];
  for (const key of Object.keys(fields))
    if (OMITTED.has(key)) found.push(`${key} doesn't belong in the file`);
  for (const [key, [test, required]] of Object.entries(FIELDS)) {
    if (!(key in fields)) {
      if (key in defaults) continue;
      if (required) found.push(`${key} is missing`);
    } else if (!test(fields[key])) found.push(`${key} is ${JSON.stringify(fields[key])}`);
  }
  return found;
}

export function stationFile(dir: string, source: string, sourceId: string): string {
  return join(dir, source, `${encodeURIComponent(sourceId)}.yml`);
}

/** The sources with a directory of station files. */
export async function stationSources(dir: string): Promise<string[]> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter(
    (e) => !e.name.startsWith("."),
  );
  // A list in another layout, such as an old `<source>.json`, would be skipped
  // and its source's stations listed again as new.
  const stray = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
  if (stray.length)
    throw new Error(`${join(dir, stray[0]!)} isn't a directory of <source_id>.yml files`);
  return entries.map((e) => e.name).sort();
}

/** A source's committed stations, sorted by ID; none when it has no directory yet. */
export async function readStationFiles(dir: string, metadata: SourceMetadata): Promise<Station[]> {
  const source = metadata.id;
  const defaults = defaultsFor(metadata);
  let names: string[];
  try {
    names = await readdir(join(dir, source));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const stations: Station[] = [];
  // Hidden files are the system's (.DS_Store), not stations.
  for (const name of names.filter((n) => !n.startsWith("."))) {
    const path = join(dir, source, name);
    const sourceId = sourceIdOf(name);
    // A file under any other name would be skipped, and its station listed again as new.
    if (sourceId === undefined || stationFile(dir, source, sourceId) !== path)
      throw new Error(`${path} isn't named <source_id>.yml, with the code URL-encoded`);
    let fields: unknown;
    try {
      fields = parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : error}`);
    }
    if (!isPlainObject(fields)) throw new Error(`${path} isn't a mapping of station fields`);
    const wrong = problems(fields, defaults);
    if (wrong.length) throw new Error(`${path}: ${wrong.join("; ")}`);
    stations.push({
      ...defaults,
      ...fields,
      id: `${source}/${sourceId}`,
      source,
      source_id: sourceId,
    } as Station);
  }
  return stations.sort((a, b) => a.id.localeCompare(b.id));
}

function sourceIdOf(name: string): string | undefined {
  if (!name.endsWith(".yml")) return undefined;
  try {
    return decodeURIComponent(name.slice(0, -".yml".length));
  } catch {
    return undefined;
  }
}

/**
 * Refuse a list whose stations couldn't each have a file of their own.
 * `writeStationFiles` checks this before writing anything, so a refusal
 * leaves the directory as it was; any error after it is the disk's.
 */
export function checkStationFiles(
  dir: string,
  metadata: SourceMetadata,
  stations: Station[],
): void {
  const source = metadata.id;
  const defaults = defaultsFor(metadata);
  // Two codes differing only in case would share a file on macOS and Windows.
  const folded = new Map<string, string>();
  for (const station of stations) {
    if (station.source !== source) throw new Error(`${station.id} isn't a ${source} station`);
    // The reader skips hidden files, so it would never find one of these.
    if (!station.source_id || station.source_id.startsWith("."))
      throw new Error(`${station.id} would be a hidden file`);
    const path = stationFile(dir, source, station.source_id);
    const other = folded.get(path.toLowerCase());
    if (other) throw new Error(`${station.id} and ${other} would share ${path}`);
    folded.set(path.toLowerCase(), station.id);
    // The reader's checks, so a refresh never writes a file ingest would refuse.
    const wrong = problems(fileFields(station, defaults), defaults);
    if (wrong.length) throw new Error(`${station.id}: ${wrong.join("; ")}`);
  }
}

/**
 * Write each station's file, leaving any whose fields are unchanged as they
 * are, comments included. Deletes nothing: a station the source dropped comes
 * back from the merge inactive and keeps its file. Returns how many it wrote.
 */
export async function writeStationFiles(
  dir: string,
  metadata: SourceMetadata,
  stations: Station[],
): Promise<number> {
  const source = metadata.id;
  const defaults = defaultsFor(metadata);
  checkStationFiles(dir, metadata, stations);
  await mkdir(join(dir, source), { recursive: true });
  let written = 0;
  for (const station of stations) {
    const path = stationFile(dir, source, station.source_id);
    let old: string | undefined;
    try {
      old = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const { text, clean } = render(fileFields(station, defaults), old);
    if (text === old) continue;
    if (clean) console.warn(`${path}: couldn't edit in place, so rewrote it without its comments`);
    await writeFile(path, text);
    written++;
  }
  return written;
}

/** The fields a station's file holds, in file order. */
function fileFields(station: Station, defaults: Partial<Station>): Record<string, unknown> {
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  const keys = Object.keys(station)
    .filter((key) => !OMITTED.has(key))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === ORDER.length ? a.localeCompare(b) : 0));
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    const value = (station as unknown as Record<string, unknown>)[key];
    if (value === null || value === undefined) continue;
    if (isDeepStrictEqual(value, defaults[key as keyof Station])) continue;
    fields[key] = value;
  }
  return fields;
}

/** A file holding `fields`, edited from `old` so a person's comments survive. */
function render(
  fields: Record<string, unknown>,
  old: string | undefined,
): { text: string; clean: boolean } {
  if (old !== undefined && isDeepStrictEqual(parse(old), fields))
    return { text: old, clean: false };
  const options = { lineWidth: 0, flowCollectionPadding: false };
  try {
    const doc = old === undefined ? new Document({}) : parseDocument(old);
    if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as YAMLMap;
    edit(doc, doc.contents as YAMLMap, fields, true);
    const text = doc.toString(options);
    if (isDeepStrictEqual(parse(text), fields)) return { text, clean: false };
  } catch {
    // An alias whose anchor the edit removed; the clean file below has neither.
  }
  // An edit that wouldn't read back as `fields` (one through an alias, say)
  // gives way to a clean file.
  const fresh = new Document({});
  edit(fresh, fresh.contents as YAMLMap, fields, true);
  return { text: fresh.toString(options), clean: old !== undefined };
}

const keyOf = (key: unknown) => String(isScalar(key) ? key.value : key);
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Make `map` hold `fields`, changing values in place so the comments on them
 * stay. A comment on a field that's gone moves to the field after it.
 */
function edit(doc: Document, map: YAMLMap, fields: Record<string, unknown>, top: boolean): void {
  const kept: typeof map.items = [];
  let orphaned: string[] = [];
  for (const pair of map.items) {
    const key = pair.key as Node | undefined;
    if (!(keyOf(key) in fields)) {
      const value = pair.value as Node | undefined;
      orphaned.push(...[key?.commentBefore, value?.commentBefore, value?.comment].filter(isText));
      continue;
    }
    if (orphaned.length && isScalar(key)) {
      key.commentBefore = [...orphaned, key.commentBefore].filter(isText).join("\n");
      orphaned = [];
    }
    kept.push(pair);
  }
  map.items = kept;
  if (orphaned.length) map.comment = [map.comment, ...orphaned].filter(isText).join("\n");
  for (const [key, value] of Object.entries(fields)) {
    const current = map.get(key, true) as unknown;
    if (isScalar(current) && (value === null || typeof value !== "object")) {
      current.value = value;
    } else if (isMap(current) && isPlainObject(value)) {
      // Prettier pads a flow map's braces, which the writer doesn't, so write it in block style.
      current.flow = false;
      edit(doc, current, value, false);
    } else if (!isNode(current) || !isDeepStrictEqual(current.toJSON(), value)) {
      const node = doc.createNode(value);
      if (top && FLOW.has(key) && isSeq(node) && oneLine(key, value as unknown[])) node.flow = true;
      if (isNode(current)) {
        node.commentBefore = current.commentBefore;
        node.comment = current.comment;
      }
      map.set(key, node);
    }
  }
  const order = Object.keys(fields);
  map.items.sort((a, b) => order.indexOf(keyOf(a.key)) - order.indexOf(keyOf(b.key)));
}

const oneLine = (key: string, items: unknown[]) =>
  `${key}: [${items.join(", ")}]`.length <= PRINT_WIDTH;

const isText = (comment: string | null | undefined): comment is string => !!comment;
