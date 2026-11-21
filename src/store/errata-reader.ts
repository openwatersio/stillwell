/** The store as the erratum checks read it (`npm run errata:check`). */
import { utcDay, type StoreReader } from "../errata.ts";
import type { StoredStation } from "../schema.ts";
import { sourceOf } from "../sources/index.ts";
import { readObservationsBetween, readRows, readStationList } from "./parquet.ts";
import { seriesPath, stationListPath } from "./paths.ts";
import { STORE, storeOfSource } from "./stores.ts";

/** The store couldn't be read, as against holding something a check didn't expect. */
export class StoreReadError extends Error {
  constructor(cause: unknown) {
    super(`couldn't read the store: ${(cause as Error)?.message ?? cause}`, { cause });
  }
}

/** `read`, with any failure marked as the store's: a file that isn't there reads as empty, not as a failure. */
async function unreadable<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw error instanceof StoreReadError ? error : new StoreReadError(error);
  }
}

/**
 * A reader over the store, each source's list read once. `rootOf` gives the
 * store a source's series are in, and `root` the public store `rows` reads.
 */
export function errataReader(
  rootOf: (source: string) => string = (source) => storeOfSource(sourceOf(source).metadata),
  root: string = STORE,
): StoreReader {
  const lists = new Map<string, Promise<StoredStation[] | null>>();
  const reader: StoreReader = {
    async station(id) {
      const slash = id.indexOf("/");
      if (slash < 1) throw new Error(`${id} isn't a station ID, <source>/<id>`);
      const source = id.slice(0, slash);
      if (!lists.has(source))
        lists.set(
          source,
          // A failed read isn't kept, so the next check asks again.
          unreadable(() => readStationList(stationListPath(rootOf(source), source))).catch(
            (error) => {
              lists.delete(source);
              throw error;
            },
          ),
        );
      return (await lists.get(source))?.find((s) => s.id === id) ?? null;
    },
    rows: (path) => unreadable(() => readRows(`${root}/${path}`)),
    async levels(id, since, until) {
      const listed = await reader.station(id);
      if (!listed) throw new Error(`the store doesn't list ${id}`);
      const [from, to] = [utcDay(since), utcDay(until)];
      if (!(from < to)) throw new Error(`${since} to ${until} isn't a span of UTC days`);
      // Each epoch's rows only within its span, as every reader goes by span: a split left rows in the earlier epoch's files until `ingest misplaced` moves them.
      const epochs = listed.epochs.length
        ? listed.epochs.map((e) => ({
            id: e.id,
            rejected: e.state === "rejected",
            since: e.since ? Date.parse(e.since) : -Infinity,
            until: e.until ? Date.parse(e.until) : Infinity,
          }))
        : [{ id: 1, rejected: false, since: -Infinity, until: Infinity }];
      // A rejected epoch's files are read as the epoch before it, so a time in both goes to the one that isn't rejected.
      const byTime = new Map<number, Awaited<ReturnType<StoreReader["levels"]>>[number]>();
      for (const epoch of epochs) {
        const [lo, hi] = [Math.max(from, epoch.since), Math.min(to, epoch.until)];
        if (lo >= hi) continue;
        for (
          let year = new Date(lo).getUTCFullYear();
          year <= new Date(hi - 1).getUTCFullYear();
          year++
        )
          for (const o of await unreadable(() =>
            readObservationsBetween(
              seriesPath(
                rootOf(listed.source),
                "levels",
                listed.source,
                listed.source_id,
                year,
                epoch.id,
              ),
              lo,
              hi,
            ),
          )) {
            if (epoch.rejected && byTime.has(o.time)) continue;
            byTime.set(o.time, { ...o, epoch: epoch.id });
          }
      }
      return [...byTime.values()].sort((a, b) => a.time - b.time);
    },
  };
  return reader;
}
