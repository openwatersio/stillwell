import {
  EMPTY_YEAR,
  exists,
  listFiles,
  readRows,
  readYearStats,
  writeRows,
  type YearStats,
} from "./parquet.ts";
import { sourceEpochDirs, sourceFirstEpochFiles, yearsPath } from "./paths.ts";

/**
 * A source's year files of levels, `stations/years/<source>.parquet`: a row
 * per file with `id`, `epoch`, `year`, `hours`, a count of values for each
 * flag and `version`, sorted by `id`, `epoch` and `year`, so a reader can
 * tell a year with no file from one it failed to read, and see which years
 * changed. A row with no `epoch` or `year` marks a station whose files a run
 * is writing: until it's gone, its other rows may be out of date and a year
 * may have a file with no row.
 *
 * Every run that writes a source's year files writes this, in the source's
 * group: backfill and requalify mark each batch of stations before writing
 * and set their rows after, compaction does the same for the stations it
 * folds, then lists the source's files to drop rows whose file is gone and
 * read the files of marked stations (left by a run that stopped partway) or
 * with no row. `withhold` and each refresh drop withheld stations' rows, and
 * reconcile leaves them out. A source without one gets none until `ingest
 * years <source>` reads every file. A writer that doesn't keep it, such as an
 * older build after a rollback, leaves rows out of date until `ingest years
 * <source> --rebuild-years`.
 */
export type YearRow = {
  id: string;
  epoch: number | null;
  year: number | null;
} & Partial<YearStats>;

/** A year file's station, epoch and year, from its path. */
export function fileKey(
  source: string,
  file: string,
): { id: string; epoch: number; year: number } | null {
  const parts = file.split("/");
  const year = Number(parts.at(-1)!.replace(/\.parquet$/, ""));
  // Epoch 1 is the station's directory, under `obs/<source>/`; a later one is a numbered directory in it.
  const first = parts.at(-3) === source && parts.at(-4) === "obs";
  const epoch = first ? 1 : Number(parts.at(-2));
  const dir = parts.at(first ? -2 : -3);
  if (!Number.isInteger(year) || !Number.isInteger(epoch) || !dir) return null;
  try {
    return { id: `${source}/${decodeURIComponent(dir)}`, epoch, year };
  } catch {
    // Not a directory ingest wrote, such as a stray `100%`.
    return null;
  }
}

/** Every year file of levels a source has in `lake`, epoch 1's and later epochs'. */
export async function listLevelFiles(lake: string, source: string): Promise<string[]> {
  return [
    ...(await listFiles(sourceFirstEpochFiles(lake, "levels", source))),
    ...(await listFiles(sourceEpochDirs(lake, "levels", source))),
  ];
}

const key = (r: Pick<YearRow, "id" | "epoch" | "year">) => `${r.id} ${r.epoch} ${r.year}`;

/** A source's rows by `key`, or null when it has no file yet. */
async function readYears(lake: string, source: string): Promise<Map<string, YearRow> | null> {
  const path = yearsPath(lake, source);
  if (!(await exists(path))) return null;
  const rows = await readRows(path);
  return new Map(
    rows.map((r) => {
      const row: YearRow = {
        id: String(r.id),
        epoch: r.epoch === null ? null : Number(r.epoch),
        year: r.year === null ? null : Number(r.year),
      };
      if (r.version !== null)
        Object.assign(row, {
          hours: Number(r.hours),
          flags: FLAGS.map((f) => Number(r[f])),
          version: String(r.version),
        });
      return [key(row), row];
    }),
  );
}

const FLAGS = ["good", "interpolated", "preliminary", "suspect", "bad"];

export async function writeYears(lake: string, source: string, rows: YearRow[]): Promise<void> {
  await writeRows(
    yearsPath(lake, source),
    rows.map(({ flags, ...r }) => ({
      ...r,
      ...Object.fromEntries(FLAGS.map((f, i) => [f, flags?.[i] ?? null])),
    })),
    {
      id: "VARCHAR",
      epoch: "INTEGER",
      year: "INTEGER",
      hours: "INTEGER",
      ...Object.fromEntries(FLAGS.map((f) => [f, "INTEGER"])),
      version: "VARCHAR",
    },
    "id, epoch NULLS FIRST, year NULLS FIRST",
  );
}

/**
 * Mark stations as being written, before a run writes their files. Returns
 * the stations it marked, which the run's `commitYears` clears: not one a
 * stopped run left marked, whose files the next reconcile reads. Does nothing
 * for a source without the file, which `ingest years` starts.
 */
export async function markYears(lake: string, source: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await readYears(lake, source);
  if (!rows) return [];
  const marked = ids.filter((id) => !rows.has(markKey(id)));
  if (!marked.length) return [];
  for (const id of marked) rows.set(markKey(id), { id, epoch: null, year: null });
  await writeYears(lake, source, [...rows.values()]);
  return marked;
}

const markKey = (id: string) => key({ id, epoch: null, year: null });

/**
 * Set the rows of the files a run wrote, by path, and clear the marks it
 * set, `marked`. A file it didn't write keeps its row.
 */
export async function commitYears(
  lake: string,
  source: string,
  marked: string[],
  written: Map<string, YearStats>,
): Promise<void> {
  if (!marked.length && !written.size) return;
  const rows = await readYears(lake, source);
  if (!rows) return;
  for (const id of marked) rows.delete(markKey(id));
  for (const [file, stats] of written) {
    const at = fileKey(source, file);
    if (at) rows.set(key(at), { ...at, ...stats });
  }
  await writeYears(lake, source, [...rows.values()]);
}

/**
 * Bring a source's rows in line with its files in `lake`: drop rows whose
 * file is gone or whose station `keep` refuses, such as a withheld one, and
 * read the files with no row, or whose station is marked or in `reread`,
 * then clear every mark. A source without the file gets none unless `start`;
 * `rebuild` reads every file, and replaces a years file it can't read. It
 * reads at most `limit` files and every 5,000 writes what it has, with the
 * stations it hasn't finished marked, so the next run resumes where it was.
 * A file that can't be read gets no row and keeps its station marked, so it's
 * read again next time. Returns how many files it read and the ones it
 * couldn't, or null when the source has no file and it didn't start one.
 */
export async function reconcileYears(
  lake: string,
  source: string,
  {
    start = false,
    rebuild = false,
    keep = () => true,
    reread = [],
    limit = Infinity,
    concurrency = 8,
  }: {
    start?: boolean;
    rebuild?: boolean;
    keep?: (id: string) => boolean;
    reread?: string[];
    limit?: number;
    concurrency?: number;
  } = {},
): Promise<{ read: number; failed: string[] } | null> {
  const had = await readYears(lake, source).catch((error: unknown) => {
    if (rebuild) return null;
    throw error;
  });
  if (!had && !start && !rebuild) return null;
  const rows = new Map<string, YearRow>();
  const marked = new Set([
    ...[...(had?.values() ?? [])].filter((r) => r.year === null).map((r) => r.id),
    ...reread,
  ]);
  const files = await listLevelFiles(lake, source);
  // A listing that finds nothing when there are rows is a wrong path or a failed list, not a lake emptied.
  if (!files.length && [...(had?.values() ?? [])].some((r) => r.year !== null))
    throw new Error(`no ${source} files listed in ${lake}, yet it has years; keeping them`);
  const unread: string[] = [];
  // Files left to read, by station, so a write partway marks the unfinished ones.
  const pending = new Map<string, number>();
  for (const file of files) {
    const at = fileKey(source, file);
    if (!at || !keep(at.id)) continue;
    const row = had?.get(key(at));
    if (!rebuild && row?.version && !marked.has(at.id)) rows.set(key(at), row);
    else {
      unread.push(file);
      pending.set(at.id, (pending.get(at.id) ?? 0) + 1);
    }
  }
  const failed = new Set<string>();
  // A station's files together, so a limit cuts few stations short.
  unread.sort();
  // Files past the limit keep the row they had, and their station's mark says it may be out of date.
  for (const file of unread.splice(limit)) {
    const at = fileKey(source, file)!;
    const row = had?.get(key(at));
    if (row) rows.set(key(at), row);
  }
  const save = () =>
    writeYears(lake, source, [
      ...rows.values(),
      ...[...pending.keys()].map((id) => ({ id, epoch: null, year: null })),
    ]);
  const batches = Array.from({ length: Math.ceil(unread.length / 100) }, (_, i) =>
    unread.slice(i * 100, i * 100 + 100),
  );
  // Each batch's files at once, a few batches at a time, as compaction reads its bounds.
  for (let i = 0; i < batches.length; i += concurrency) {
    await Promise.all(
      batches.slice(i, i + concurrency).map(async (batch) => {
        // A batch that fails is read a file at a time, so one bad file doesn't hold up the rest.
        const stats = await readYearStats(batch).catch(async () => {
          const each = new Map<string, YearStats>();
          for (const file of batch)
            try {
              for (const [f, s] of await readYearStats([file])) each.set(f, s);
            } catch {
              failed.add(file);
            }
          return each;
        });
        for (const file of batch) {
          const at = fileKey(source, file)!;
          // A station's file that failed to read keeps it marked, so it's read again.
          if (failed.has(file)) continue;
          rows.set(key(at), { ...at, ...(stats.get(file) ?? EMPTY_YEAR) });
          const left = pending.get(at.id)! - 1;
          if (left) pending.set(at.id, left);
          else pending.delete(at.id);
        }
      }),
    );
    if (Math.floor((i + concurrency) / 50) > Math.floor(i / 50) && pending.size) await save();
  }
  await save();
  return { read: unread.length - failed.size, failed: [...failed] };
}

/** Drop the rows of stations `drop` names; returns the IDs it dropped rows for. */
export async function dropYears(
  lake: string,
  source: string,
  drop: (id: string) => boolean,
): Promise<string[]> {
  const rows = await readYears(lake, source);
  const gone = [...(rows?.values() ?? [])].filter((r) => drop(r.id));
  if (!gone.length) return [];
  await writeYears(
    lake,
    source,
    [...rows!.values()].filter((r) => !drop(r.id)),
  );
  return [...new Set(gone.map((r) => r.id))];
}
