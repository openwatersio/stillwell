import { appendFileSync, createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { constants, createInflateRaw, crc32, inflateRawSync } from "node:zlib";
import { csvFields } from "../../csv.ts";
import { getText } from "../../http.ts";

/**
 * CPRA's weekly export of every CRMS station's hourly record: one zip holding
 * one CSV of about 13 GB, deflated to about 1.3 GB. The server sends about
 * 500 KB/s a connection, so it's read as parallel ranges, written to disk,
 * checked against the zip's CRC and split by station in one pass.
 */
export const EXPORT_URL =
  "https://cims.coastal.la.gov/RequestedDownloads/ZippedFiles/CRMS_Continuous_Hydrographic.zip";
const CSV = "CRMS_Continuous_Hydrographic.csv";
/** Bytes a range asks for, settable for tests. */
export const tuning = { chunk: 16 << 20 };
const WORKERS = 8;
/**
 * The split files' layout and the parser's rules, in the cache directory's
 * name, so a build that reads or classifies rows differently splits again.
 * Raise it with any change to either, such as the adapter's `SUSPECT`.
 */
const FORMAT = 2;
/** The share of rows, beyond 100, that may be misshapen before the export counts as a new format. */
const MISSHAPEN_SHARE = 0.01;
const CACHE_DIR = process.env.WATER_LEVELS_CACHE ?? ".cache";

/** One row the adapter keeps, as the split writes it. */
export interface Row {
  time: number;
  /** Adjusted water elevation to datum, in feet. */
  feet: number;
  /** Index into the adapter's geoids, 255 for another. */
  geoid: number;
  /** The lake's flag for the value. */
  flag: number;
}

/** Bytes per row in a station's split file: time (f64), feet (f64), geoid (u8), flag (u8). */
const ROW_BYTES = 18;

/** A range of the zip, `bytes=<spec>`, as a Buffer, refusing a whole-file answer. */
async function get(spec: string): Promise<Buffer> {
  return Buffer.from(
    await getText(EXPORT_URL, {
      headers: { range: `bytes=${spec}` },
      base64: true,
      partial: true,
      // The cache keys by URL and body, not the range, and the export changes weekly.
      fresh: true,
      // A 16 MB range at the slowest rate seen, shared eight ways, takes about 6 minutes.
      timeout: 1200,
    }),
    "base64",
  );
}

/** Bytes [from, to) of the zip. */
async function range(from: number, to: number): Promise<Buffer> {
  const bytes = await get(`${from}-${to - 1}`);
  if (bytes.length !== to - from)
    throw new Error(`CRMS's export sent ${bytes.length} bytes for a range of ${to - from}`);
  return bytes;
}

/** Where the CSV's deflated data sits in the zip, its compressed size and its CRC. */
export interface Entry {
  offset: number;
  size: number;
  crc: number;
}

/**
 * Reads the CSV's entry from the zip's last 64 KB, which hold its central
 * directory, then its local header for where the data starts. The export is
 * under 4 GB, so it ends in the classic end record, and only the CSV's entry
 * carries 64-bit sizes; a ZIP64 end record is read if one appears.
 */
export async function entry(): Promise<Entry> {
  const tail = await get("-65536");
  // The end record is the one whose comment runs to the file's end, since a comment can hold its signature.
  let end = tail.length - 22;
  while (
    end >= 0 &&
    !(
      tail.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + tail.readUInt16LE(end + 20) === tail.length
    )
  )
    end--;
  if (end < 0) throw new Error("CRMS's export has no end of central directory");
  // A ZIP64 end record is found through the locator right before the end
  // record, never by its signature alone, which compressed data can hold by chance.
  let z64 = -1;
  let dirSize = tail.readUInt32LE(end + 12);
  let dirOffset = tail.readUInt32LE(end + 16);
  if (end >= 20 && tail.readUInt32LE(end - 20) === 0x07064b50) {
    // The record ends at the locator; its size field counts the bytes after the first 12.
    for (z64 = end - 20 - 56; z64 >= 0; z64--)
      if (
        tail.readUInt32LE(z64) === 0x06064b50 &&
        z64 + 12 + Number(tail.readBigUInt64LE(z64 + 4)) === end - 20
      )
        break;
    if (z64 < 0) throw new Error("CRMS's export has a ZIP64 locator without its end record");
    dirSize = Number(tail.readBigUInt64LE(z64 + 40));
    dirOffset = Number(tail.readBigUInt64LE(z64 + 48));
  } else if (dirSize === 0xffffffff || dirOffset === 0xffffffff)
    throw new Error("CRMS's export needs a ZIP64 end record it lacks");
  // The directory ends where the first end record starts, which places the tail in the file.
  const tailFrom = dirOffset + dirSize - (z64 >= 0 ? z64 : end);
  if (dirOffset < tailFrom)
    throw new Error("CRMS's export has a central directory before its tail");
  const dir = tail.subarray(dirOffset - tailFrom, dirOffset - tailFrom + dirSize);
  for (let p = 0; p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50;) {
    const nameLength = dir.readUInt16LE(p + 28);
    const extraLength = dir.readUInt16LE(p + 30);
    const commentLength = dir.readUInt16LE(p + 32);
    const name = dir.toString("utf8", p + 46, p + 46 + nameLength);
    if (name === CSV) {
      if (dir.readUInt16LE(p + 10) !== 8) throw new Error(`CRMS's ${CSV} isn't deflated`);
      const crc = dir.readUInt32LE(p + 16);
      let size = dir.readUInt32LE(p + 20);
      let usize = dir.readUInt32LE(p + 24);
      let offset = dir.readUInt32LE(p + 42);
      // ZIP64 extra field: the 64-bit sizes and offset, in that order, for each that overflowed.
      for (let q = p + 46 + nameLength; q < p + 46 + nameLength + extraLength;) {
        const id = dir.readUInt16LE(q);
        const length = dir.readUInt16LE(q + 2);
        if (id === 1) {
          let r = q + 4;
          const next = () => Number(dir.readBigUInt64LE((r += 8) - 8));
          if (usize === 0xffffffff) usize = next();
          if (size === 0xffffffff) size = next();
          if (offset === 0xffffffff) offset = next();
        }
        q += 4 + length;
      }
      const header = await range(offset, offset + 30);
      if (header.readUInt32LE(0) !== 0x04034b50)
        throw new Error(`CRMS's export has no local header at ${CSV}'s offset`);
      const start = offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      return { offset: start, size, crc };
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`CRMS's export has no ${CSV}`);
}

/**
 * Downloads the CSV's deflated bytes to `path` as parallel ranges, `WORKERS`
 * at a time, each retried by the HTTP layer.
 */
async function download(e: Entry, path: string): Promise<void> {
  const file = await open(path, "w");
  try {
    let next = 0;
    const worker = async () => {
      for (let at = next; at < e.size; at = next) {
        next += tuning.chunk;
        const bytes = await range(e.offset + at, e.offset + Math.min(at + tuning.chunk, e.size));
        await file.write(bytes, 0, bytes.length, at);
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
  } finally {
    await file.close();
  }
}

/** Reads one row of the CSV, by the header's columns, as a station's row, or null to skip it. */
export type Parser = (
  header: string[],
) => (fields: string[]) => { station: string; row: Row } | null;

/**
 * Inflates the CSV from `deflated` and writes each station's rows to a file of
 * its own in `dir`, checking the CSV's CRC. The CSV is sorted by station, so a
 * station's rows are written when the next station starts.
 */
export async function split(
  deflated: string,
  crc: number,
  dir: string,
  parser: Parser,
): Promise<void> {
  let read: ReturnType<Parser> | undefined;
  let columns = 0;
  let misshapen = 0;
  let total = 0;
  let kept = 0;
  let check = 0;
  let rest = "";
  let station = "";
  let rows: Row[] = [];
  // Synchronous, since there are tens of millions of lines and a station's rows are few writes.
  const flush = () => {
    if (!rows.length) return;
    const out = Buffer.alloc(rows.length * ROW_BYTES);
    rows.forEach((r, i) => {
      out.writeDoubleLE(r.time, i * ROW_BYTES);
      out.writeDoubleLE(r.feet, i * ROW_BYTES + 8);
      out.writeUInt8(r.geoid, i * ROW_BYTES + 16);
      out.writeUInt8(r.flag, i * ROW_BYTES + 17);
    });
    appendFileSync(join(dir, fileOf(station)), out);
    rows = [];
  };
  const line = (text: string) => {
    if (!text) return;
    const fields = csvFieldsOf(text);
    if (!read) {
      read = parser(fields);
      columns = fields.length;
      return;
    }
    total++;
    // A stray quote or line break would shift every column after it, so the row is left out.
    if (fields.length !== columns) {
      if (!misshapen++)
        console.error(
          `CRMS: leaving out a row with ${fields.length} fields, not ${columns}: ${text}`,
        );
      return;
    }
    const got = read(fields);
    if (!got) return;
    kept++;
    if (got.station !== station || rows.length >= 1_000_000) {
      flush();
      station = got.station;
    }
    rows.push(got.row);
  };
  for await (const chunk of createReadStream(deflated).pipe(
    createInflateRaw(),
  ) as AsyncIterable<Buffer>) {
    check = crc32(chunk, check);
    const lines = (rest + chunk.toString("latin1")).split("\n");
    rest = lines.pop()!;
    for (const l of lines) line(l.replace(/\r$/, ""));
  }
  line(rest.replace(/\r$/, ""));
  flush();
  if (misshapen)
    console.error(`CRMS: left out ${misshapen} rows whose fields didn't match the header`);
  if (check >>> 0 !== crc >>> 0)
    throw new Mismatch(
      "CRMS's export doesn't match its CRC; it may have changed during the download",
    );
  // A changed format would otherwise leave every station empty, which reads as no data.
  if (misshapen > Math.max(100, total * MISSHAPEN_SHARE))
    throw new Error(`CRMS's export has ${misshapen} of ${total} rows that don't match its header`);
  if (!kept) throw new Error(`CRMS's export has no surface-water elevations in ${total} rows`);
}

/** A CSV line's fields; the export quotes only fields holding a comma. */
function csvFieldsOf(line: string): string[] {
  return line.includes('"') ? csvFields(line) : line.split(",");
}

/** A station's file name: its ID with anything outside letters, digits and `-` encoded. */
const fileOf = (station: string) => `${encodeURIComponent(station)}.bin`;

/** The export, split by station, in a directory named for its CRC and size. */
let loaded: Promise<string> | undefined;

/** A CRC that doesn't match, as when the export is rebuilt during the download. */
class Mismatch extends Error {}

/**
 * The directory of this week's export split by station, downloading and
 * splitting it on first use. A failure stands for the rest of the run, so the
 * stations after it don't download the export again; only a CRC mismatch,
 * from an export rebuilt during the download, is tried once more.
 */
export function load(parser: Parser): Promise<string> {
  loaded ??= once(parser).catch((error: unknown) =>
    error instanceof Mismatch ? once(parser) : Promise.reject(error),
  );
  return loaded;
}

/** Downloads and splits the export, or finds it split in the cache. */
async function once(parser: Parser): Promise<string> {
  const e = await entry();
  const dir = join(CACHE_DIR, "crms", `${(e.crc >>> 0).toString(16)}-${e.size}-v${FORMAT}`);
  try {
    await stat(join(dir, "done"));
    return dir;
  } catch {
    // Not split yet, or a run stopped partway: start over.
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const deflated = join(dir, "export.deflate");
  console.log(`CRMS: downloading the export, ${Math.round(e.size / 1e6)} MB`);
  await download(e, deflated);
  // An export rebuilt during the download mixes two versions' bytes.
  const after = await entry();
  if (after.crc !== e.crc || after.size !== e.size || after.offset !== e.offset)
    throw new Mismatch("CRMS's export changed during the download");
  console.log("CRMS: splitting the export by station");
  await split(deflated, e.crc, dir, parser);
  await rm(deflated);
  await writeFile(join(dir, "done"), new Date().toISOString());
  return dir;
}

/**
 * Reads the CSV's header from the export's first bytes through `parser`, which
 * throws when a column it needs is missing, without the whole download.
 */
export async function header(parser: Parser): Promise<string[]> {
  const e = await entry();
  const head = await range(e.offset, e.offset + Math.min(65_536, e.size));
  const text = inflateRawSync(head, { finishFlush: constants.Z_SYNC_FLUSH }).toString("latin1");
  const fields = csvFieldsOf(text.slice(0, text.indexOf("\n")).replace(/\r$/, ""));
  parser(fields);
  return fields;
}

/** Forgets the loaded export, for tests. */
export function forget(): void {
  loaded = undefined;
}

/** A station's rows from the split export, in time order; none when the export has none. */
export async function rowsOf(dir: string, station: string): Promise<Row[]> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(dir, fileOf(station)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows: Row[] = [];
  for (let at = 0; at + ROW_BYTES <= bytes.length; at += ROW_BYTES)
    rows.push({
      time: bytes.readDoubleLE(at),
      feet: bytes.readDoubleLE(at + 8),
      geoid: bytes.readUInt8(at + 16),
      flag: bytes.readUInt8(at + 17),
    });
  return rows.sort((a, b) => a.time - b.time);
}
