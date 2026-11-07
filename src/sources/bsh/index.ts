import { getJson, getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";
import type { EventIndex, TransitExtreme } from "../../types.ts";
import * as pegelonline from "../pegelonline/index.ts";

/**
 * BSH tide predictions (https://gezeiten.bsh.de/) for German gauges.
 *
 * BSH computes high and low waters with the harmonic representation of
 * inequalities (HRoI, "HDdU" in the file headers) and draws the curve between
 * them from a mean observed tide curve. It publishes the current year, and the
 * next from about August. Use is free, including commercially, under Anlage 4 of
 * BSH's fee schedule; see openwatersio/slackwater-database#335 for the terms.
 *
 * Observed levels at these gauges come from PEGELONLINE, linked by `same_as`.
 */
const SITE = "https://gezeiten.bsh.de";
const FILES = "https://filebox.bsh.de/index.php/s/SbJ3z5NBkpOZloY/download";

export const ATTRIBUTION =
  "Datenquelle: Gezeitenvorausberechnungen ©, Bundesamt für Seeschifffahrt und Hydrographie";

export const metadata: SourceMetadata = {
  id: "bsh",
  name: "Bundesamt für Seeschifffahrt und Hydrographie (BSH)",
  url: "https://gezeiten.bsh.de/",
  license: {
    id: "BSH-Anlage-4",
    name: "BSH Entgeltverzeichnis digitale Daten, Anlage 4",
    url: "https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.pdf",
    commercial_use: true,
    redistribution: true,
  },
  attribution: ATTRIBUTION,
  terms:
    "A calendar year's predictions may be published online only from 1 August of the year before.",
};

interface OverviewGauge {
  station_name: string;
  bshnr: string;
  latitude: number;
  longitude: number;
  gauge_group: number;
  seo_id: string;
}

export interface GaugeYear {
  level_tidalvalues?: string;
  MHW?: number;
  MNW?: number;
  MHWI?: string;
  MNWI?: string;
  "PNP (unter NHN)"?: number | null;
  "SKN (unter NHN)"?: number | null;
  "SKN (ueber PNP)"?: number | null;
  has_height?: boolean;
  has_curve?: boolean;
}

export interface Gauge extends ListedStation {
  bshnr: string;
  pegelonline_uuid?: string;
  /** Years with published predictions. */
  years: number[];
  /** Mean high- and low-water lunitidal intervals, in hours. */
  mhwi?: number;
  mlwi?: number;
}

export async function gauges(): Promise<OverviewGauge[]> {
  const overview = await getJson<{ gauges: OverviewGauge[] }>(`${SITE}/data/tides_overview.json`, {
    fresh: true,
  });
  return overview.gauges;
}

/**
 * Metadata for one gauge. Its datum and offsets come from the latest year that
 * names a datum, or the latest year when none does.
 */
export async function gauge(bshnr: string): Promise<Gauge> {
  const detail = await getJson<
    OverviewGauge & { pegelonline_uuid?: string; years: Record<string, GaugeYear>[] }
  >(`${SITE}/data/DE_${bshnr.padStart(5, "_")}_tides.json`);
  const years = Object.assign({}, ...detail.years) as Record<string, GaugeYear>;
  const numbers = Object.keys(years).map(Number).sort();
  const named = numbers.toReversed().find((y) => years[String(y)]?.level_tidalvalues);
  const year = years[String(named ?? numbers.at(-1))] ?? {};
  const datum = year.level_tidalvalues ?? null;
  return {
    ...stationDefaults(metadata),
    id: `bsh/${detail.bshnr}`,
    source_id: detail.bshnr,
    bshnr: detail.bshnr,
    name: detail.station_name,
    lat: detail.latitude,
    lon: detail.longitude,
    country_code: "DE",
    kind: null,
    interval_s: null,
    datum,
    datums: datum ? offsets(year, datum) : {},
    products: ["predictions", "predicted_extremes"],
    first: null,
    last: null,
    tide_station: null,
    same_as: [],
    status: "active",
    live: false,
    min_interval_s: null,
    source_url: `${SITE}/${detail.seo_id}`,
    pegelonline_uuid: detail.pegelonline_uuid,
    years: numbers,
    mhwi: hours(year.MHWI),
    mlwi: hours(year.MNWI),
  };
}

/**
 * Meters to add to a level in `datum` for each other datum. BSH gives PNP and
 * SKN as heights relative to NHN in centimeters (−500 is 5 m below), or SKN as
 * a height above PNP, and leaves the ones it doesn't know null.
 */
export function offsets(year: GaugeYear, datum: string): Record<string, number> {
  const cm = (v: number | null | undefined) => (typeof v === "number" ? v : undefined);
  const pnp = cm(year["PNP (unter NHN)"]);
  const sknAbovePnp = cm(year["SKN (ueber PNP)"]);
  const skn =
    cm(year["SKN (unter NHN)"]) ??
    (pnp !== undefined && sknAbovePnp !== undefined ? pnp + sknAbovePnp : undefined);
  const heights: Record<string, number | undefined> = { NHN: 0, PNP: pnp, SKN: skn };
  const own = heights[datum];
  const datums: Record<string, number> = {};
  if (own === undefined) return datums;
  for (const [name, height] of Object.entries(heights))
    if (name !== datum && height !== undefined) datums[name] = Math.round(own - height) / 100;
  return datums;
}

/** Every gauge, linked to its PEGELONLINE series where BSH names one. */
export async function stations(): Promise<ListedStation[]> {
  const numberOf = new Map(
    (await pegelonline.list()).map((s) => [s.uuid, `pegelonline/${s.number}`]),
  );
  const list: ListedStation[] = [];
  for (const g of await gauges()) {
    const {
      bshnr: _,
      pegelonline_uuid,
      years: __,
      mhwi: ___,
      mlwi: ____,
      ...station
    } = await gauge(g.bshnr);
    const linked = pegelonline_uuid && numberOf.get(pegelonline_uuid);
    list.push({ ...station, same_as: linked ? [linked] : [] });
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Predicted high and low waters for one year, with transit numbers. With
 * `datum`, throws if the year's file is in another.
 */
export async function extremes(
  bshnr: string,
  year: number,
  datum?: string,
): Promise<(TransitExtreme & { flag: Flag })[]> {
  const rows = await rowsOf(bshnr, year, "vb_hwnw", datum);
  return rows
    .filter((r) => r.kind === "H" || r.kind === "N")
    .map((r) => ({
      time: r.time,
      level: r.level,
      type: r.kind === "H" ? ("high" as const) : ("low" as const),
      transit: r.transit,
      event: r.event as EventIndex,
      flag: Flag.good,
    }));
}

/** The predicted 10-minute curve for one year, checked against `datum` like `extremes`. */
export async function curve(bshnr: string, year: number, datum?: string): Promise<Observation[]> {
  const rows = await rowsOf(bshnr, year, "vb_kurv", datum);
  return rows
    .filter((r) => r.kind === "K")
    .map((r) => ({ time: r.time, level: r.level, flag: Flag.good }));
}

interface Row {
  kind: string;
  time: number;
  level: number;
  transit: number;
  event: number;
}

/** A year's rows, or none when BSH hasn't published that year. */
async function rowsOf(
  bshnr: string,
  year: number,
  path: string,
  datum: string | undefined,
): Promise<Row[]> {
  const file = `DE_${bshnr.padStart(5, "_")}${year}.txt`;
  const url = `${FILES}?path=/${path}/deu${year}&files=${file}`;
  let text: string;
  try {
    text = await getText(url);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("returned 404")) return [];
    throw error;
  }
  if (!text.startsWith("I_E#")) throw new Error(`BSH ${file} is not a prediction file`);
  const unit = /C05#[^#]*#\s*([^#\s]+)/.exec(text)?.[1];
  if (unit !== "m") throw new Error(`BSH ${file} height unit is ${unit}, not m`);
  // BSH names each year's datum, and a gauge can move from PNP to SKN between years.
  const level = /C03#[^#]*#\s*([^#\s]+)/.exec(text)?.[1];
  if (datum && level !== datum)
    throw new Error(`BSH ${file} heights are in ${level}, not ${datum}`);
  return parse(text);
}

/**
 * Parse the `VB2` rows of a BSH prediction file. Fields are `#`-separated:
 * id, flag, kind (H, N or K), weekday, date, local time, height (m), day of
 * year, UTC offset, transit number, event index and Julian date. The Julian date
 * is UTC and finer than the minute-resolution local time, so times come from it.
 */
export function parse(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("VB2#")) continue;
    const f = line.split("#").map((s) => s.trim());
    const jd = Number(f[13]);
    rows.push({
      kind: f[3]!,
      time: Math.round((jd - 2440587.5) * 86_400) * 1000,
      level: Number(f[7]),
      transit: Number(f[11]),
      event: Number(f[12]),
    });
  }
  return rows;
}

function hours(hhmm: string | undefined): number | undefined {
  const match = hhmm && /^(\d+):(\d+)$/.exec(hhmm);
  return match ? Number(match[1]) + Number(match[2]) / 60 : undefined;
}

/** Calls `get` for each calendar year [start, end) touches, keeping rows inside it. */
async function byYear<T extends { time: number }>(
  start: Date,
  end: Date,
  get: (year: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (
    let year = start.getUTCFullYear();
    year <= new Date(end.getTime() - 1).getUTCFullYear();
    year++
  )
    rows.push(...(await get(year)));
  return rows.filter((r) => r.time >= start.getTime() && r.time < end.getTime());
}

export const source: Source = {
  metadata,
  stations,
  predictions: (s, start, end) => byYear(start, end, (year) => curve(s.source_id, year, s.datum)),
  predictedExtremes: (s, start, end) =>
    byYear(start, end, (year) => extremes(s.source_id, year, s.datum)),
};
