// Store URLs, shared by the build and the browser.

export const STORE = "https://stillwell.openwaters.io";

/** Sent on the build's reads of the store, as the Open Waters User-Agent policy asks; the browser sends its own. */
export const USER_AGENT = "stillwell-website/1 (+https://openwatersio.github.io/stillwell)";

export const url = (path: string) => `${STORE}/${path}`;

/**
 * A series file's URL. The file's key holds the source_id URL-encoded, so its URL encodes it again;
 * ordinary IDs come out unchanged.
 */
export function seriesUrl(product: string, id: string, year: number, epoch = 1) {
  const [source, ...rest] = id.split("/");
  const dir = encodeURIComponent(encodeURIComponent(rest.join("/")));
  return url(`${product}/${source}/${dir}${epoch > 1 ? `/${epoch}` : ""}/${year}.parquet`);
}

/**
 * A source's daily files of observed levels for the last `days` UTC days, oldest first. Today's is rewritten
 * every hour, and a day with no values has no file.
 */
export function recentUrls(source: string, days = 8, now = Date.now()) {
  const today = Math.floor(now / 86400e3);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date((today - days + 1 + i) * 86400e3).toISOString().slice(0, 10);
    return url(`recent/${source}/${day}.parquet`);
  });
}

/** A path on the site, under its base, such as /stillwell/query/ for /query/. */
export const sitePath = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

/** A station page's path, such as /stillwell/stations/rws/hoekvanholland/. */
export function stationPath(id: string) {
  const [source, ...rest] = id.split("/");
  return sitePath(`/stations/${source}/${encodeURIComponent(rest.join("/"))}/`);
}

/** The query page with this SQL in it. */
export const queryPath = (sql: string) => sitePath(`/query/#q=${encodeURIComponent(sql.trim())}`);
