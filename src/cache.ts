import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchText, setTransport, type RequestOptions } from "./http.ts";

// An old name left in a shell would otherwise fall back to the default store
// unnoticed, so a `withhold` could succeed locally and leave the bucket as is.
for (const [old, now] of [
  ["WATER_LEVELS_LAKE", "STILLWELL_STORE"],
  ["WATER_LEVELS_RESTRICTED_LAKE", "STILLWELL_RESTRICTED_STORE"],
  ["WATER_LEVELS_CACHE", "STILLWELL_CACHE"],
]) {
  if (process.env[old] !== undefined) throw new Error(`${old} is set; it's now ${now}`);
}

const CACHE_DIR = process.env.STILLWELL_CACHE ?? ".cache";

/**
 * Fetch text, keeping each response on disk keyed by URL and body. Historical
 * series and published predictions don't change, so repeat runs stay off the
 * upstream services. A `fresh` request is neither read from nor written to the
 * cache: its answer can still change, so a later run mustn't reuse it. Nor is
 * an answer its request's `keep` turns down. Node only.
 */
export async function cachedText(url: string, options: RequestOptions = {}): Promise<string> {
  const key = createHash("sha256")
    .update(JSON.stringify([url, options.body ?? null]))
    .digest("hex");
  const path = join(CACHE_DIR, key.slice(0, 2), key);
  if (!options.fresh) {
    try {
      const cached = await readFile(path, "utf8");
      // An error body an older build cached is fetched again, not replayed,
      // and so is an answer its request's `keep` now turns down.
      if (!isError(cached) && options.keep?.(cached) !== false) return cached;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const text = await fetchText(url, options);
  // Some APIs, CO-OPS among them, answer a failure with 200 and an error body;
  // caching it would replay the failure on every later run.
  if (options.fresh || isError(text) || options.keep?.(text) === false) return text;
  await mkdir(join(CACHE_DIR, key.slice(0, 2)), { recursive: true });
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
  return text;
}

function isError(text: string): boolean {
  return /^\s*\{\s*"error"\s*:/.test(text);
}

/** Route every adapter request through the disk cache. */
export function useDiskCache(): void {
  setTransport(cachedText);
}
