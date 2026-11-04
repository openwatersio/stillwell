/**
 * HTTP for adapters. Plain `fetch` with retries, so it runs in Node and in a
 * Worker. Scripts swap in the disk cache from `src/cache.ts` with `setTransport`.
 */
const USER_AGENT = "openwaters-water-levels (+https://github.com/openwatersio/water-levels)";

export interface RequestOptions extends RequestInit {
  /** Skip any cache, e.g. for real-time series that change every fetch. */
  fresh?: boolean;
}

export type Transport = (url: string, options: RequestOptions) => Promise<string>;

let transport: Transport = fetchText;

export function setTransport(next: Transport): void {
  transport = next;
}

export function getText(url: string, options: RequestOptions = {}): Promise<string> {
  return transport(url, options);
}

export async function getJson<T>(url: string, options?: RequestOptions): Promise<T> {
  return JSON.parse(await getText(url, options)) as T;
}

/**
 * Fetch without caching, retrying on throttling, server errors, timeouts and
 * dropped connections, including one that drops while the body downloads.
 */
export async function fetchText(
  url: string,
  { fresh: _, ...init }: RequestOptions = {},
): Promise<string> {
  return fetchWithRetry(url, {
    ...init,
    headers: { "user-agent": USER_AGENT, ...init.headers },
  });
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    let status: number | string;
    try {
      // A year of RWS data is about 15 MB and can take a minute.
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) });
      if (response.ok) return await response.text();
      status = response.status;
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") status = "timeout";
      // A dropped connection is a TypeError carrying the socket error as its
      // cause ("fetch failed", or "terminated" mid-body); a bad URL has none.
      else if (error instanceof TypeError && error.cause !== undefined)
        status = `a network error (${error.message})`;
      else throw error;
    }
    // RWS throttles with 429 and 503; back off and try again.
    if (
      attempt >= attempts ||
      !(typeof status === "string" || [429, 500, 502, 503, 504].includes(status))
    )
      throw new Error(`${init.method ?? "GET"} ${url} returned ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
}
