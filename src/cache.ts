import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchText, setTransport, type RequestOptions } from "./http.ts";

const CACHE_DIR = process.env.WATER_LEVELS_CACHE ?? ".cache";

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
      // An error body an older build cached is fetched again, not replayed.
      if (!isError(cached)) return cached;
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
