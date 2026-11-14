// Store URLs, shared by the build and the browser.

export const STORE = "https://stillwell.openwaters.io";

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

/** A source's last 7 days of observed levels, rewritten every hour. */
export const recentUrl = (source: string) => url(`recent/${source}.parquet`);

/** A path on the site, under its base, such as /stillwell/query/ for /query/. */
export const sitePath = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;

/** A station page's path, such as /stillwell/stations/rws/hoekvanholland/. */
export function stationPath(id: string) {
  const [source, ...rest] = id.split("/");
  return sitePath(`/stations/${source}/${encodeURIComponent(rest.join("/"))}/`);
}

/** The query page with this SQL in it. */
export const queryPath = (sql: string) => sitePath(`/query/#q=${encodeURIComponent(sql.trim())}`);
