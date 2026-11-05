/**
 * HTTP for adapters. Plain `fetch` with retries, so it runs in Node and in a
 * Worker. Scripts swap in the disk cache from `src/cache.ts` with `setTransport`.
 */
const USER_AGENT = "openwaters-water-levels (+https://github.com/openwatersio/water-levels)";

export interface RequestOptions extends RequestInit {
  /** Skip any cache, e.g. for real-time series that change every fetch. */
  fresh?: boolean;
  /** Whether a cache may keep this answer; a source whose values change after release says which ones can't. */
  keep?: (text: string) => boolean;
  /** Waits for the source's rate limit before each request that goes out, retries included; cache hits skip it. */
  pace?: () => Promise<void>;
  /** Told how many seconds a throttled request will wait before its retry, so the source can hold its other requests as long. */
  throttled?: (seconds: number) => void;
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
  { fresh: _, keep: __, pace, throttled, ...init }: RequestOptions = {},
): Promise<string> {
  return fetchWithRetry(
    url,
    { ...init, headers: { "user-agent": USER_AGENT, ...init.headers } },
    pace,
    throttled,
  );
}

/** The socket or DNS error behind a failed fetch, such as `: ECONNRESET`. */
function causeOf(error: TypeError): string {
  const cause = error.cause as { code?: string; message?: string } | undefined;
  const reason = cause?.code ?? cause?.message;
  return reason ? `: ${reason}` : "";
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  pace?: () => Promise<void>,
  throttled?: (seconds: number) => void,
  attempts = 4,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    let status: number | string;
    let retryAfter = 0;
    await pace?.();
    try {
      // A year of RWS data is about 15 MB and can take a minute.
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(300_000) });
      if (response.ok) return await response.text();
      status = response.status;
      retryAfter = Number(response.headers.get("retry-after")) || 0;
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") status = "timeout";
      // Node's fetch reports a failed or dropped connection as a TypeError,
      // "fetch failed", or "terminated" when it drops mid-body. Others, such as
      // "Failed to parse URL", won't go better on a retry.
      else if (error instanceof TypeError && /^(fetch failed|terminated)$/.test(error.message))
        status = `a network error (${error.message}${causeOf(error)})`;
      else throw error;
    }
    // RWS throttles with 429 and 503; back off and try again. A block of more
    // than a minute is the caller's to wait out, so it gets the Retry-After.
    if (
      attempt >= attempts ||
      retryAfter > 60 ||
      !(typeof status === "string" || [429, 500, 502, 503, 504].includes(status))
    )
      throw new Error(
        `${init.method ?? "GET"} ${url} returned ${status}${retryAfter ? ` (retry after ${retryAfter} s)` : ""}`,
      );
    const wait = Math.max(retryAfter, 2 ** attempt);
    if (status === 429) throttled?.(wait);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}
