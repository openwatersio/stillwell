import { sql } from "./duckdb.js";

export const STORE = "https://stillwell.openwaters.io";

export const url = (path) => `${STORE}/${path}`;

export const json = (path) =>
  fetch(url(path)).then((r) =>
    r.ok ? r.json() : Promise.reject(new Error(`${path}: HTTP ${r.status}`)),
  );

// The bucket sends no Cache-Control, so a browser can keep a stale copy of a file the hourly ingest rewrites.
export const recentUrl = (source) =>
  `${url(`recent/${source}.parquet`)}?t=${Math.floor(Date.now() / 60000)}`;

// A file's key holds the source_id URL-encoded, so its URL encodes it again; ordinary IDs come out unchanged.
export function seriesUrl(product, id, year, epoch = 1) {
  const [source, ...rest] = id.split("/");
  const dir = encodeURIComponent(encodeURIComponent(rest.join("/")));
  return url(`${product}/${source}/${dir}${epoch > 1 ? `/${epoch}` : ""}/${year}.parquet`);
}

/** URLs of the observed-level year files a station has between two years, from its source's years list. */
export async function yearFiles(id, from, to) {
  const source = id.split("/")[0];
  const rows = await sql`
    SELECT epoch, year FROM read_parquet(${url(`stations/years/${source}.parquet`)})
    WHERE id = ${id} AND year BETWEEN ${from} AND ${to}
    ORDER BY epoch, year`;
  return Array.from(rows, (r) => ({
    epoch: r.epoch,
    year: r.year,
    url: seriesUrl("obs", id, r.year, r.epoch),
  }));
}

// Components are served from <root>/_import/components/, so the site root is two levels up, wherever it's hosted.
const root = new URL("../../", import.meta.url);
const page = (path) => new URL(path, root).href;

/** A link to the query page with this SQL in it. */
export const queryLink = (text) => page(`query#q=${encodeURIComponent(text.trim())}`);

/** The query string parameter, such as ?id=. */
export const param = (name) => new URLSearchParams(location.search).get(name);

export const gaugeLink = (id) => page(`gauge?id=${encodeURIComponent(id)}`);
export const sourceLink = (id) => page(`source?id=${encodeURIComponent(id)}`);
