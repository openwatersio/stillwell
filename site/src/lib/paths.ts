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

// The bucket sends no Cache-Control, so a browser can keep a stale copy of a file the hourly ingest rewrites.
export const recentUrl = (source: string) =>
  `${url(`recent/${source}.parquet`)}?t=${Math.floor(Date.now() / 60000)}`;

/** A station page's path, such as /stations/rws/hoekvanholland/. */
export function stationPath(id: string) {
  const [source, ...rest] = id.split("/");
  return `/stations/${source}/${encodeURIComponent(rest.join("/"))}/`;
}

/** The query page with this SQL in it. */
export const queryPath = (sql: string) => `/query/#q=${encodeURIComponent(sql.trim())}`;
