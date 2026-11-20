import type { Flag } from "../schema.ts";
import type { StationObservation } from "../store/parquet.ts";
import type { LiveCell, PollRow } from "../../workers/live/types.ts";

export type { LiveCell, PollRow };

/** Where the poller keeps each live station's window: D1, through the live Worker's store endpoint. */
export interface ObservationStore {
  /** The named stations' values from `from` on, sorted by station and time. */
  read(stations: string[], from: number): Promise<StationObservation[]>;
  /** Write rows, replacing any at the same station and time. */
  write(rows: StationObservation[]): Promise<void>;
  /** Delete the given values. */
  remove(values: { station: string; time: number }[]): Promise<void>;
  /** Delete every value of the given stations. */
  removeStations(stations: string[]): Promise<void>;
  /** The stations with values whose ID starts with `<source>/`. */
  stations(source: string): Promise<string[]>;
}

export const toCell = (r: StationObservation): LiveCell => [
  r.epoch,
  r.time,
  r.level,
  r.flag,
  r.source_flag ?? null,
  r.received ?? null,
];

export function fromCell(station: string, c: LiveCell): StationObservation {
  return {
    station,
    epoch: c[0],
    time: c[1],
    level: c[2],
    flag: c[3] as Flag,
    ...(c[4] === null ? {} : { source_flag: c[4] as Flag }),
    ...(c[5] === null ? {} : { received: c[5] }),
  };
}

/** Requests at most this many stations or values at once, to keep each request and its D1 statements small. */
const CHUNK = 2000;

/**
 * The live store at `base`, the live Worker's store endpoint (workers/live/store.ts), sending `token` as its bearer
 * token.
 */
export function liveStore(
  base: string,
  token = process.env.STILLWELL_LIVE_TOKEN ?? "",
): ObservationStore & {
  poll(row: PollRow): Promise<void>;
  day(
    source: string,
    day: string,
    after: string,
    limit: number,
  ): Promise<{ rows: StationObservation[]; next: string | null }>;
  put(key: string, body: Uint8Array): Promise<void>;
} {
  async function call<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
      ...init,
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }
  return {
    async read(stations, from) {
      const out: StationObservation[] = [];
      for (let i = 0; i < stations.length; i += CHUNK) {
        const { rows } = await call<{ rows: [string, LiveCell[]][] }>("/read", {
          stations: stations.slice(i, i + CHUNK),
          from,
        });
        for (const [station, cells] of rows) for (const c of cells) out.push(fromCell(station, c));
      }
      return out;
    },
    async write(rows) {
      for (let i = 0; i < rows.length; i += CHUNK * 10)
        await call("/write", {
          rows: rows.slice(i, i + CHUNK * 10).map((r) => [r.station, toCell(r)]),
        });
    },
    async remove(values) {
      for (let i = 0; i < values.length; i += CHUNK * 10)
        await call("/remove", { values: values.slice(i, i + CHUNK * 10) });
    },
    async removeStations(stations) {
      for (let i = 0; i < stations.length; i += CHUNK)
        await call("/remove-stations", { stations: stations.slice(i, i + CHUNK) });
    },
    async stations(source) {
      return (await call<{ stations: string[] }>(`/stations?source=${encodeURIComponent(source)}`))
        .stations;
    },
    async poll(row) {
      await call("/polls", row);
    },
    async day(source, day, after, limit) {
      const page = await call<{ rows: [string, LiveCell[]][]; next: string | null }>("/day", {
        source,
        day,
        after,
        limit,
      });
      return {
        rows: page.rows.flatMap(([station, cells]) => cells.map((c) => fromCell(station, c))),
        next: page.next,
      };
    },
    async put(key, body) {
      const response = await fetch(`${base}/files/${key}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
        body: body as BodyInit,
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) throw new Error(`put ${key}: ${response.status} ${await response.text()}`);
    },
  };
}
