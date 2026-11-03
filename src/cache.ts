import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIR = process.env.WATER_LEVELS_CACHE ?? ".cache";
const USER_AGENT = "openwaters-water-levels (+https://github.com/openwatersio/water-levels)";

export interface CachedFetchOptions extends RequestInit {
  /** Skip the cache, e.g. for real-time series that change every fetch. */
  fresh?: boolean;
}

/**
 * Fetch text, keeping each response on disk keyed by URL and body. Historical
 * series and published predictions don't change, so repeat runs stay off the
 * upstream services.
 */
export async function cachedText(
  url: string,
  { fresh = false, ...init }: CachedFetchOptions = {},
): Promise<string> {
  const key = createHash("sha256")
    .update(JSON.stringify([url, init.body ?? null]))
    .digest("hex");
  const path = join(CACHE_DIR, key.slice(0, 2), key);
  if (!fresh) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const response = await fetchWithRetry(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, ...init.headers },
  });
  const text = await response.text();
  await mkdir(join(CACHE_DIR, key.slice(0, 2)), { recursive: true });
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
  return text;
}

export async function cachedJson<T>(url: string, options?: CachedFetchOptions): Promise<T> {
  return JSON.parse(await cachedText(url, options)) as T;
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let status: number | string;
    try {
      // A year of RWS data is about 15 MB and can take a minute.
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) });
      if (response.ok) return response;
      status = response.status;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      status = "timeout";
    }
    // RWS throttles with 429 and 503; back off and try again.
    if (attempt >= attempts || ![429, 500, 502, 503, 504, "timeout"].includes(status))
      throw new Error(`${init.method ?? "GET"} ${url} returned ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
}
