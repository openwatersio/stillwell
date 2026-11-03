import { cachedJson, cachedText } from "../cache.ts";
import type { EventIndex, Sample, Station, TransitExtreme } from "../types.ts";

/**
 * BSH tide predictions (https://gezeiten.bsh.de/) for German gauges.
 *
 * BSH computes high and low waters with the harmonic representation of
 * inequalities (HRoI, "HDdU" in the file headers) and draws the curve between
 * them from a mean observed tide curve. It publishes the current year, and the
 * next from about August. Use is free, including commercially, under Anlage 4 of
 * BSH's fee schedule; see openwatersio/slackwater-database#335 for the terms.
 *
 * Observed levels at these gauges come from PEGELONLINE, linked by
 * `pegelonline_uuid`.
 */
const SITE = "https://gezeiten.bsh.de";
const FILES = "https://filebox.bsh.de/index.php/s/SbJ3z5NBkpOZloY/download";

export const ATTRIBUTION =
  "Datenquelle: Gezeitenvorausberechnungen ©, Bundesamt für Seeschifffahrt und Hydrographie";

interface OverviewGauge {
  station_name: string;
  bshnr: string;
  latitude: number;
  longitude: number;
  gauge_group: number;
  seo_id: string;
}

interface GaugeYear {
  level_tidalvalues?: string;
  MHW?: number;
  MNW?: number;
  MHWI?: string;
  MNWI?: string;
  "PNP (unter NHN)"?: number;
  "SKN (unter NHN)"?: number;
  "SKN (ueber PNP)"?: number;
  has_height?: boolean;
  has_curve?: boolean;
}

export interface Gauge extends Station {
  bshnr: string;
  pegelonline_uuid?: string;
  /** Years with published predictions. */
  years: number[];
  /** Mean high- and low-water lunitidal intervals, in hours. */
  mhwi?: number;
  mlwi?: number;
}

export async function gauges(): Promise<OverviewGauge[]> {
  const overview = await cachedJson<{ gauges: OverviewGauge[] }>(
    `${SITE}/data/tides_overview.json`,
  );
  return overview.gauges;
}

/** Metadata for one gauge, with datum offsets from the latest published year. */
export async function gauge(bshnr: string): Promise<Gauge> {
  const detail = await cachedJson<
    OverviewGauge & { pegelonline_uuid?: string; years: Record<string, GaugeYear>[] }
  >(`${SITE}/data/DE_${bshnr.padStart(5, "_")}_tides.json`);
  const years = Object.assign({}, ...detail.years) as Record<string, GaugeYear>;
  const numbers = Object.keys(years).map(Number).sort();
  const latest = years[String(numbers.at(-1))] ?? {};
  const offsets: Record<string, number> = {};
  // BSH gives these in centimeters, as depths below NHN or a height above PNP.
  if (latest["PNP (unter NHN)"] !== undefined) offsets.NHN = latest["PNP (unter NHN)"] / 100;
  if (latest["SKN (ueber PNP)"] !== undefined) offsets.SKN = -latest["SKN (ueber PNP)"] / 100;
  return {
    id: `bsh:${detail.bshnr}`,
    bshnr: detail.bshnr,
    name: detail.station_name,
    lat: detail.latitude,
    lon: detail.longitude,
    datum: latest.level_tidalvalues ?? "PNP",
    offsets,
    pegelonline_uuid: detail.pegelonline_uuid,
    years: numbers,
    mhwi: hours(latest.MHWI),
    mlwi: hours(latest.MNWI),
    source_url: `${SITE}/${detail.seo_id}`,
  };
}

/** Predicted high and low waters for one year, with transit numbers. */
export async function extremes(bshnr: string, year: number): Promise<TransitExtreme[]> {
  const rows = await rowsOf(bshnr, year, "vb_hwnw");
  return rows
    .filter((r) => r.kind === "H" || r.kind === "N")
    .map((r) => ({
      time: r.time,
      level: r.level,
      type: r.kind === "H" ? ("high" as const) : ("low" as const),
      transit: r.transit,
      event: r.event as EventIndex,
    }));
}

/** The predicted 10-minute curve for one year. */
export async function curve(bshnr: string, year: number): Promise<Sample[]> {
  const rows = await rowsOf(bshnr, year, "vb_kurv");
  return rows.filter((r) => r.kind === "K").map((r) => ({ time: r.time, level: r.level }));
}

interface Row {
  kind: string;
  time: number;
  level: number;
  transit: number;
  event: number;
}

async function rowsOf(bshnr: string, year: number, path: string): Promise<Row[]> {
  const file = `DE_${bshnr.padStart(5, "_")}${year}.txt`;
  const url = `${FILES}?path=/${path}/deu${year}&files=${file}`;
  const text = await cachedText(url);
  if (!text.startsWith("I_E#")) throw new Error(`BSH ${file} is not a prediction file`);
  const unit = /C05#[^#]*#\s*([^#\s]+)/.exec(text)?.[1];
  if (unit !== "m") throw new Error(`BSH ${file} height unit is ${unit}, not m`);
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
