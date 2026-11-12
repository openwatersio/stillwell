import { resolve } from "node:path";
import { sourceOf } from "../sources/index.ts";
import type { SourceMetadata, Station } from "../schema.ts";

/** The public store: STILLWELL_STORE, a directory (default `data`) or an `s3://` URL. */
export const STORE = (process.env.STILLWELL_STORE ?? "data").replace(/\/$/, "");

/** Where a station's series go: its source's store. */
export function storeFor(station: Pick<Station, "source">): string {
  return storeOfSource(sourceOf(station.source).metadata);
}

/** The public store, or the private one for a source whose terms bar republishing. */
export function storeOfSource(metadata: SourceMetadata): string {
  if (metadata.license.redistribution) return STORE;
  const restricted = process.env.STILLWELL_RESTRICTED_STORE?.replace(/\/$/, "");
  if (!restricted)
    throw new Error(
      `${metadata.id} bars republishing its data; set STILLWELL_RESTRICTED_STORE to a private store`,
    );
  if (overlaps(restricted, STORE))
    throw new Error("STILLWELL_RESTRICTED_STORE must be a separate bucket or directory");
  return restricted;
}

/** Whether two stores share a bucket, or one directory holds the other. */
function overlaps(a: string, b: string): boolean {
  const bucket = (store: string) => /^s3:\/\/([^/]+)/.exec(store)?.[1];
  if (bucket(a) || bucket(b)) return bucket(a) === bucket(b);
  const [x, y] = [resolve(a), resolve(b)];
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
