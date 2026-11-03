import { cachedJson } from "../cache.ts";
import type { Sample, Station } from "../types.ts";

/**
 * PEGELONLINE, the WSV's real-time gauge service (DL-DE/Zero-2.0). It keeps 31
 * days of raw water levels in centimeters above gauge zero (PNP), at 1-minute
 * resolution at tide gauges. Longer records have to be collected by fetching on
 * a schedule.
 */
const API = "https://www.pegelonline.wsv.de/webservices/rest-api/v2";

interface ApiStation {
  uuid: string;
  number: string;
  shortname: string;
  longname: string;
  latitude?: number;
  longitude?: number;
  water: { shortname: string };
  timeseries?: {
    shortname: string;
    unit: string;
    gaugeZero?: { unit: string; value: number; validFrom: string };
  }[];
}

/** Stations with a water-level (`W`) series. */
export async function stations(): Promise<Station[]> {
  const list = await cachedJson<ApiStation[]>(
    `${API}/stations.json?includeTimeseries=true&timeseries=W`,
    { fresh: true },
  );
  return list.filter((s) => s.latitude !== undefined).map(toStation);
}

export async function station(uuid: string): Promise<Station> {
  return toStation(
    await cachedJson<ApiStation>(`${API}/stations/${uuid}.json?includeTimeseries=true`, {
      fresh: true,
    }),
  );
}

/** Water levels in meters above gauge zero over the last `days` (at most 31). */
export async function levels(uuid: string, days = 31): Promise<Sample[]> {
  const values = await cachedJson<{ timestamp: string; value: number }[]>(
    `${API}/stations/${uuid}/W/measurements.json?start=P${days}D`,
    { fresh: true },
  );
  return values.map((v) => ({ time: Date.parse(v.timestamp), level: v.value / 100 }));
}

function toStation(s: ApiStation): Station {
  const zero = s.timeseries?.find((t) => t.shortname === "W")?.gaugeZero;
  const offsets: Record<string, number> = {};
  if (zero && /NHN/.test(zero.unit)) offsets.NHN = zero.value;
  return {
    id: `pegelonline:${s.uuid}`,
    name: s.longname,
    lat: s.latitude!,
    lon: s.longitude!,
    datum: "PNP",
    offsets,
    source_url: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${s.number}`,
  };
}
