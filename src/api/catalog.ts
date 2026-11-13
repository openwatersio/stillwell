import type { ClickHouse } from "../realtime/clickhouse.ts";

/** What the levels API needs of a station from `stations.parquet`. */
export interface CatalogStation {
  id: string;
  source: string;
  name: string;
  /** The current epoch's own reference, such as NAP, STND or PNP. */
  datum: string | null;
  chart_datum: string | null;
  frame: string | null;
  commercial_use: boolean;
  attribution: string;
  datums_attribution: string[];
  tide_station: string | null;
  min_interval_s: number | null;
  /** Whether the server polls the station for levels: live, active and with levels, as the poller picks them. */
  polled: boolean;
  /** How often the station records a value, in seconds. */
  interval_s: number | null;
  /** The current epoch: the last one open. */
  epoch: number | null;
  /** Each epoch's span, and its meters to the current epoch, null where it doesn't convert. */
  epochs: Map<number, CatalogEpoch>;
  /** Each epoch's meters to add to refer a level in it to each named datum, from `stations/offsets.parquet`. */
  offsets: Map<number, Map<string, number>>;
}

/** An epoch's span in ms, either end null when open, and its meters to the current epoch. */
export interface CatalogEpoch {
  since: number | null;
  until: number | null;
  to_current: number | null;
}

export type Catalog = Map<string, CatalogStation>;

/**
 * The public stations and their offsets, from `stations.parquet` and
 * `stations/offsets.parquet` in `store`, read by ClickHouse, which keeps the
 * reading out of the API's own memory.
 */
export async function loadCatalog(ch: ClickHouse, store: string): Promise<Catalog> {
  const read = (file: string, columns: string) =>
    ch.query<Record<string, unknown>>(
      `SELECT ${columns} FROM url({url:String}, Parquet) SETTINGS date_time_output_format = 'iso'`,
      { url: `${store}/${file}` },
    );
  const [stations, offsets] = await Promise.all([
    read(
      "stations.parquet",
      `id, source, name, datum, chart_datum, frame, commercial_use, attribution, datums_attribution,
       tide_station, min_interval_s, interval_s, live, status, products, epochs.id AS epoch_ids, epochs.since AS since, epochs.until AS until,
       epochs.to_current AS to_current, epochs.state AS state`,
    ),
    read("stations/offsets.parquet", "station, epoch, datum, offset_m"),
  ]);
  // An empty file is a failed read or a broken publish; the last list keeps serving.
  if (!stations.length) throw new Error(`no stations in ${store}/stations.parquet`);
  if (!offsets.length) throw new Error(`no offsets in ${store}/stations/offsets.parquet`);
  return buildCatalog(stations, offsets);
}

/**
 * The catalog of `stations.parquet`'s rows, with each epoch's `id`, `since`,
 * `until`, `to_current` and `state` as arrays in step (`epoch_ids` for the
 * IDs), and `stations/offsets.parquet`'s.
 */
export function buildCatalog(
  stations: Record<string, unknown>[],
  offsets: Record<string, unknown>[],
): Catalog {
  const catalog: Catalog = new Map();
  for (const s of stations) {
    // Each epoch's fields, as arrays in step.
    const ids = (s.epoch_ids as (number | string)[]).map(Number);
    const [since, until, toCurrent, state] = [s.since, s.until, s.to_current, s.state] as [
      (string | null)[],
      (string | null)[],
      (number | null)[],
      string[],
    ];
    const open = ids.findLastIndex((_, i) => state[i] === "open");
    catalog.set(String(s.id), {
      id: String(s.id),
      source: String(s.source),
      name: String(s.name),
      datum: (s.datum as string | null) ?? null,
      chart_datum: (s.chart_datum as string | null) ?? null,
      frame: (s.frame as string | null) ?? null,
      commercial_use: s.commercial_use === true,
      attribution: String(s.attribution ?? ""),
      datums_attribution: (s.datums_attribution as string[] | null) ?? [],
      tide_station: (s.tide_station as string | null) ?? null,
      min_interval_s: (s.min_interval_s as number | null) ?? null,
      interval_s: (s.interval_s as number | null) ?? null,
      polled:
        s.live === true &&
        s.status === "active" &&
        ((s.products as string[] | null) ?? []).includes("levels"),
      epoch: open < 0 ? null : ids[open]!,
      // A held epoch waits on a decision, so its values aren't part of the series in any datum.
      epochs: new Map(
        ids.flatMap((id, i) =>
          state[i] === "held"
            ? []
            : [
                [
                  id,
                  { since: ms(since[i]!), until: ms(until[i]!), to_current: toCurrent[i]! },
                ] as const,
              ],
        ),
      ),
      offsets: new Map(),
    });
  }
  for (const o of offsets) {
    const station = catalog.get(String(o.station));
    if (!station) continue;
    const epoch = Number(o.epoch);
    let byDatum = station.offsets.get(epoch);
    if (!byDatum) station.offsets.set(epoch, (byDatum = new Map()));
    byDatum.set(String(o.datum), Number(o.offset_m));
  }
  return catalog;
}

function ms(time: string | null): number | null {
  return time === null ? null : Date.parse(time);
}
