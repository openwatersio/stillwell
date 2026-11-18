import { getText, HttpError } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";
import { gauges, type Gauge } from "./catalog.ts";
import recordedPeriods from "./periods.json" with { type: "json" };

const periods: Record<string, (number | null)[]> = recordedPeriods;

const BASE = "https://datos-geodesia.ign.es/Red_de_Mareografos/";
const DAY = 86_400_000;
export const CORUNA_PERIOD = [Date.UTC(2000, 0, 1), Date.UTC(2024, 0, 1)] as const;
const productYears = `${new Date(CORUNA_PERIOD[0]).getUTCFullYear()}–${new Date(CORUNA_PERIOD[1]).getUTCFullYear() - 1}`;

export const metadata: SourceMetadata = {
  id: "ign",
  name: "Instituto Geográfico Nacional (Spain)",
  url: "https://www.ign.es/web/gds-red-mareografos",
  license: {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International",
    url: "https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf",
    commercial_use: true,
    redistribution: true,
  },
  attribution: `Obra derivada de Red de Mareógrafos, Coruña horarios ${productYears} CC-BY 4.0 ign.es; Área de Geodesia, Instituto Geográfico Nacional (IGN)`,
  contact: { email: "ign@transportes.gob.es", url: "https://www.ign.es/web/gds-red-mareografos" },
  terms:
    "IGN confirmed on 2026-11-17 that its tide-gauge series are CC BY 4.0 under Orden FOM/2807/2015, including commercial use and redistribution. Cite Área de Geodesia, IGN and use the product and data date in IGN's attribution formula: <product> <date> CC-BY 4.0 ign.es; prefix derived products with Obra derivada de. See https://github.com/openwatersio/stillwell/issues/181#issuecomment-6945552785. The public release contains only Coruña reviewed hourly JM observations from 2000 through 2023, converted from millimeters to meters. Historical clock labels are unconfirmed and every released observation is suspect. Other series, products and periods are withheld pending issue #181.",
  archive: "current",
  hourly: false,
  finalizes: false,
};

export const pacing = { requestMs: 350 };
let nextSlot = 0;
async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}
const text = (path: string) => getText(`${BASE}${path}`, { fresh: true, pace });

async function inventory(path: string, optional = false): Promise<string[]> {
  let html: string;
  try {
    html = await text(path);
  } catch (e) {
    if (optional && e instanceof HttpError && / returned 404$/.test(e.message)) return [];
    throw e;
  }
  const heading = `Index of /Red_de_Mareografos${path ? `/${path.replace(/\/$/, "")}` : ""}`;
  if (!html.includes(`<h1>${heading}</h1>`) || !html.includes("</html>"))
    throw new Error(`IGN invalid catalog at ${path}`);
  const links = [...html.matchAll(/href="([^"<>]+)"/g)].map((m) => m[1]!);
  if (path.includes("/procesados/"))
    for (const file of links)
      if (/\.txt$/i.test(file) && !/^[A-Za-z0-9_.-]+\.txt$/.test(file))
        throw new Error(`IGN ${path}: unsupported reviewed filename ${file}`);
  return links.filter((f) => /^[A-Za-z0-9_.-]+\/?$/.test(f));
}

const oldBm: Record<string, string> = { TN021: "NGZ581", TN031: "NGAB161" };
const normalizedMark = (mark: string) => mark.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Candidate research catalog; the registered source admits only the closed Coruña series. */
export async function stations(): Promise<ListedStation[]> {
  const codes = (await inventory(""))
    .filter((f) => f.endsWith("/") && f !== "fichas/")
    .map((f) => f.slice(0, -1));
  if (
    new Set(codes).size !== Object.keys(gauges).length ||
    codes.length !== Object.keys(gauges).length ||
    codes.some((c) => !gauges[c])
  )
    throw new Error("IGN station catalog changed; check the station sheets");
  return candidateStations(codes);
}

function candidateStations(codes: string[]): ListedStation[] {
  return codes
    .flatMap((code) => {
      const g = gauges[code]!;
      const ids = [
        code,
        ...(code === "TN021" ? [`${code}-${oldBm[code]}`] : []),
        ...[...g.sensors, ...g.charts].map((sensor) => `${code}-${sensor}`),
      ];
      return ids.map((id): ListedStation => {
        const part = id.slice(code.length + 1);
        const endYear = periods[id]?.[1];
        const ended = endYear != null && endYear <= new Date().getUTCFullYear();
        const historicalBm = part === oldBm[code] || (!part && code === "TN031");
        const raw = g.sensors.includes(part) || g.charts.includes(part);
        const datum = historicalBm || g.sensors.includes(part) ? "BM" : part ? "ZERO" : "JM";
        const reference = historicalBm ? oldBm[code]! : raw ? `${code}/${part}` : g.jm;
        return {
          ...stationDefaults(metadata),
          id: `ign/${id}`,
          source_id: id,
          name: `${g.name}${part ? ` (${part})` : ""}`,
          lat: g.lat,
          lon: g.lon,
          country_code: "ES",
          kind: "coastal",
          interval_s: g.charts.includes(part) ? 3600 : null,
          datum,
          datums: datum === "JM" ? { [g.origin]: g.jmHeight } : {},
          reference: { id: reference, since: null },
          products: ["levels"],
          first: null,
          last: null,
          tide_station: null,
          same_as: ids.filter((other) => other !== id).map((other) => `ign/${other}`),
          status: g.last || ended || g.charts.includes(part) ? "inactive" : "active",
          live: !g.last && !ended && part === g.sensors[0],
          min_interval_s: 3600,
          source_url: `${BASE}fichas/${code}.pdf`,
        };
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

interface ParseOptions {
  mark?: string;
  year: number;
  gauge: string;
  raw: boolean;
  reference?: string;
  sign: 1 | -1;
  offset: number;
  day?: string;
  boundaryOnly?: boolean;
}
export function parse(body: string, options: ParseOptions): Observation[] {
  // Malformed published exports stay refused: erratum `ign-export-integrity`.
  const { year, gauge, raw, reference, sign, offset, day, mark } = options;
  let lines = body.trim().split(/\r?\n/);
  // Only the closing row belongs to this request: erratum `ign-export-boundaries`.
  if (options.boundaryOnly) {
    const last = lines.at(-1)!;
    const boundary = day
      ? new Date(Date.UTC(year, Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))) + DAY)
      : new Date(Date.UTC(year + 1, 0, 1));
    const date = boundary.toISOString().slice(0, 10).split("-").reverse().join("/");
    if (!last.startsWith(date + " ") || !/\s00:00(?::00)?\s/.test(last)) return [];
    lines = raw ? [last] : [lines[0]!, last];
  }
  const fileStart = day
    ? Date.UTC(year, Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)))
    : Date.UTC(year, 0, 1);
  if (day && new Date(fileStart).toISOString().slice(0, 10).replaceAll("-", "") !== day)
    throw new Error(`IGN ${gauge}: invalid file day ${day}`);
  const fileEnd = day ? fileStart + DAY : Date.UTC(year + 1, 0, 1);
  if (!raw) {
    const header = lines.shift()!;
    const actualMark = /respecto\s+(?:JM|BM)\s+(.+?)\s*$/i.exec(header)?.[1];
    if (mark && (!actualMark || normalizedMark(actualMark) !== normalizedMark(mark)))
      throw new Error(`IGN ${gauge}: unexpected benchmark mark ${actualMark}`);
    if (
      !new RegExp(`\\b${gauge}\\b`).test(header) ||
      !new RegExp(`respecto\\s+${reference}\\b`, "i").test(header) ||
      !/\bmm\b/.test(header)
    )
      throw new Error(`IGN ${gauge}: wrong station, units or reference in header`);
  }
  const out: Observation[] = [];
  let previous = -Infinity;
  let previousLine = "";
  const records = lines.filter((line) => line.trim());
  for (const [i, line] of records.entries()) {
    if (!line.trim()) continue;
    // IGN's hourly means omit seconds; minute and raw files include them.
    // Inline units follow the documented export convention: erratum `ign-export-boundaries`.
    const m =
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(-?\d+(?:\.\d+)?|---)?\s*(?:"(mm)"|(mm))?\s*$/.exec(
        line,
      );
    if (!m || (m[7] === undefined && (!raw || (!m[8] && !m[9]))))
      throw new Error(`IGN ${gauge}: invalid water-level row: ${line}`);
    const stamp = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}.000Z`;
    const time = Date.parse(stamp);
    const missing = m[7] === undefined || m[7] === "---" || Number(m[7]) === 9999;
    if (!Number.isFinite(time) || new Date(time).toISOString() !== stamp) {
      // A nonexistent missing date cannot invalidate a real observation: erratum `ign-invalid-missing-dates`.
      if (missing) continue;
      throw new Error(`IGN ${gauge}: invalid timestamp: ${stamp}`);
    }
    // Exact duplicate export rows carry no second observation: erratum `ign-duplicate-raw-rows`.
    if (time === previous && line === previousLine) continue;
    if (
      time < fileStart ||
      time > fileEnd ||
      (time === fileEnd && i !== records.length - 1) ||
      time <= previous
    )
      throw new Error(`IGN ${gauge}: invalid or out-of-order timestamp: ${stamp}`);
    previous = time;
    previousLine = line;
    if (missing) {
      out.push({ time, level: Number.NaN, flag: Flag.bad, withdrawn: true });
      continue;
    }
    out.push({
      time,
      level: Math.round(((sign * Number(m[7])) / 1000 + offset) * 1e6) / 1e6,
      // Numeric -9999 is both a real height and an undocumented sentinel: erratum `ign-negative-sentinel`.
      flag: Number(m[7]) === -9999 ? Flag.suspect : raw ? Flag.preliminary : Flag.good,
    });
  }
  if (!lines.some((l) => l.trim())) throw new Error(`IGN ${gauge}: empty data file`);
  if (!out.length) throw new Error(`IGN ${gauge}: no valid timestamps in data file`);
  return out;
}

function bmToJm(g: Gauge): number {
  if (g.bmHeight === null) throw new Error(`IGN has no surveyed BM–JM offset for ${g.name}`);
  return g.bmHeight - g.jmHeight;
}

async function reviewed(
  code: string,
  g: Gauge,
  part: string | undefined,
  from: number,
  to: number,
): Promise<Observation[]> {
  const out = new Map<number, Observation>();
  for (const folder of ["integros", "horarios"]) {
    const path = `${code}/procesados/${folder}/`;
    const files = (await inventory(path)).sort(
      (a, b) => Number(a.endsWith("_BM.txt")) - Number(b.endsWith("_BM.txt")) || b.localeCompare(a),
    );
    for (const file of files) {
      const namedYear = /_(\d{4})_/.exec(file)?.[1];
      if (
        namedYear &&
        (Date.UTC(Number(namedYear), 0, 1) >= to || Date.UTC(Number(namedYear) + 1, 0, 1) < from)
      )
        continue;
      const m = /^(\d{6})_(?:horarios_)?(\d{4})_(JM|BM)\.txt$/.exec(file);
      if (!m) {
        if (file.endsWith(".txt") && !/_old\.txt$/.test(file))
          throw new Error(`IGN ${code}: unsupported reviewed filename ${file}`);
        continue;
      }
      if (m[1] !== g.number) throw new Error(`IGN ${code}: another station in catalog: ${file}`);
      const year = Number(m[2]);
      if (Date.UTC(year, 0, 1) >= to || Date.UTC(year + 1, 0, 1) < from) continue;
      const body = await text(path + file);
      if (
        Date.UTC(year + 1, 0, 1) === from &&
        !new RegExp(`01/01/${year + 1}\\s+00:00(?::00)?\\s`).test(
          body.trim().split(/\r?\n/).at(-1)!,
        )
      )
        continue;
      const named = /respecto\s+(JM|BM)\s+(.+?)\s*$/i.exec(body.split(/\r?\n/)[0]!);
      if (!named || named[1]!.toUpperCase() !== m[3])
        throw new Error(`IGN ${code}: invalid reference in ${file}`);
      const historical = m[3] === "BM" && normalizedMark(named[2]!) === oldBm[code];
      // Alborán’s sheet/header spelling differs: erratum `ign-reviewed-marks`.
      const currentMark = m[3] === "JM" ? g.jm : code === "ALBO1" ? "C_Mfo" : g.bm;
      if (!historical && normalizedMark(named[2]!) !== normalizedMark(currentMark))
        throw new Error(`IGN ${code}: unexpected benchmark mark ${named[2]}`);
      if (code === "TN031" && !historical)
        throw new Error(`IGN TN031: new reviewed reference in ${file}; update the catalog`);
      if (historical !== ((part !== undefined && part === oldBm[code]) || code === "TN031"))
        continue;
      if (part && !historical) continue;
      const mark = historical ? oldBm[code]! : currentMark;
      const offset = !historical && m[3] === "BM" ? bmToJm(g) : 0;
      for (const o of parse(body, {
        year,
        gauge: code,
        reference: m[3]!,
        mark,
        raw: false,
        sign: 1,
        offset,
        boundaryOnly: Date.UTC(year + 1, 0, 1) === from,
      }))
        if (o.time >= from && o.time < to && !out.has(o.time)) out.set(o.time, o);
    }
  }
  return [...out.values()];
}

async function rawLevels(
  code: string,
  g: Gauge,
  sensor: string,
  from: number,
  to: number,
): Promise<Observation[]> {
  const path = `${code}/observados/`;
  const yearLinks = await inventory(path);
  const dailyYears = new Set(
    yearLinks.filter((f) => /^\d{4}\/$/.test(f)).map((f) => Number(f.slice(0, 4))),
  );
  const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1);
  const annualNames = await inventory(`${path}ficheros_anuales/`, true);
  const annualYears = annualNames.flatMap((file) => {
    const m = /^(\d{6})_(\d{4})_(\d{4})\.txt$/.exec(file);
    return m && m[1] === g.number && m[2] === sensor ? [Number(m[3])] : [];
  });
  const out = new Map<number, Observation>();
  for (const year of [...new Set([...dailyYears, ...annualYears])].sort((a, b) => a - b)) {
    if (Date.UTC(year, 0, 1) >= to || Date.UTC(year + 1, 0, 1) < from) continue;
    const candidates: { file: string; dir: string; day?: string }[] = [];
    if (annualYears.includes(year) && (Date.UTC(year, 0, 1) < yearStart || !dailyYears.has(year))) {
      for (const file of annualNames)
        if (file === `${g.number}_${sensor}_${year}.txt`)
          candidates.push({ file, dir: `${path}ficheros_anuales/` });
    }
    if (dailyYears.has(year)) {
      const dir = `${path}${year}/`;
      for (const file of (await inventory(dir)).sort()) {
        const m = /^(\d{6})_(\d{4})_(\d{8})\.txt$/.exec(file);
        if (!m || m[1] !== g.number || m[2] !== sensor || Number(m[3]!.slice(0, 4)) !== year)
          continue;
        const day = m[3]!;
        const start = Date.UTC(year, Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
        if (start >= to || start + DAY < from) continue;
        candidates.push({ file, dir, day });
      }
    }
    for (const { file, dir, day } of candidates) {
      for (const o of parse(await text(dir + file), {
        year,
        gauge: code,
        raw: true,
        sign: g.charts.includes(sensor) && !(code === "MURC1" && sensor === "0503") ? 1 : -1,
        offset: 0,
        day,
        boundaryOnly: day
          ? Date.UTC(year, Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))) + DAY === from
          : Date.UTC(year + 1, 0, 1) === from,
      }))
        if (o.time >= from && o.time < to) out.set(o.time, o);
    }
  }
  return [...out.values()];
}

/** Candidate research parser; registered observations use corunaHourly admission instead. */
export async function levels(
  id: string,
  start: Date,
  end: Date,
  datum?: string,
): Promise<Observation[]> {
  const [code, part] = id.split("-");
  const g = gauges[code!];
  const special = code === "TN021" && part === oldBm[code];
  if (
    !g ||
    (part && !special && ![...g.sensors, ...g.charts].includes(part)) ||
    id !== `${code}${part ? `-${part}` : ""}`
  )
    throw new Error(`Not an IGN station: ${id}`);
  const sensor = !!part && !special;
  const expected =
    special || (!part && code === "TN031") || g.sensors.includes(part ?? "")
      ? "BM"
      : part
        ? "ZERO"
        : "JM";
  if (datum && datum !== expected)
    throw new Error(`IGN ${id}: expected datum ${expected}, got ${datum}`);
  const from = start.getTime();
  const to = end.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("IGN needs finite dates");
  if (from >= to) return [];
  const out = sensor
    ? await rawLevels(code!, g, part!, from, to)
    : await reviewed(code!, g, part, from, to);
  return out.filter((o) => o.time >= from && o.time < to).sort((a, b) => a.time - b.time);
}

/** The admitted hourly archive; other products and periods remain research-only. */
export async function corunaHourly(start: Date, end: Date, datum = "JM"): Promise<Observation[]> {
  if (datum !== "JM") throw new Error(`IGN ACOR1: expected datum JM, got ${datum}`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
    throw new Error("IGN needs finite dates");
  const from = Math.max(start.getTime(), CORUNA_PERIOD[0]);
  const to = Math.min(end.getTime(), CORUNA_PERIOD[1]);
  if (from >= to) return [];
  const path = "ACOR1/procesados/horarios/";
  const out = new Map<number, Observation>();
  // Admission and clock uncertainty: errata `ign-release-coverage` and `ign-coruna-clock`.
  for (
    let year = new Date(CORUNA_PERIOD[0]).getUTCFullYear();
    year < new Date(CORUNA_PERIOD[1]).getUTCFullYear();
    year++
  ) {
    const nextYear = Date.UTC(year + 1, 0, 1);
    if (Date.UTC(year, 0, 1) >= to || nextYear <= from) continue;
    const file = `200031_horarios_${year}_JM.txt`;
    const rows = parse(await text(path + file), {
      year,
      gauge: "ACOR1",
      raw: false,
      reference: "JM",
      mark: gauges.ACOR1!.jm,
      sign: 1,
      offset: 0,
    }).filter((row) => row.time < nextYear);
    // A changed/truncated annual grid is not an admitted file: erratum `ign-coruna-hourly-grid`.
    const first = Date.UTC(year, 0, 1);
    if (
      rows.length !== (nextYear - first) / 3_600_000 ||
      rows.some((row, i) => row.time !== first + i * 3_600_000)
    )
      throw new Error(`IGN ACOR1 ${year}: incomplete or off-hour hourly grid`);
    for (const row of rows)
      if (row.time >= from && row.time < to) {
        // This hourly product uses -9999 for unusable aggregates: erratum `ign-coruna-hourly-gaps`.
        const value =
          row.level === -9.999
            ? { ...row, level: Number.NaN, flag: Flag.bad, withdrawn: true as const }
            : row;
        out.set(row.time, {
          ...value,
          source_flag: value.flag,
          flag: Math.max(value.flag, Flag.suspect) as Flag,
        });
      }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

export const source: Source = {
  metadata,
  attribution: (station) => {
    if (!station.first || !station.last) return metadata.attribution;
    const first = station.first.slice(0, 10);
    const last = station.last.slice(0, 10);
    const date = first === last ? first : `${first}–${last}`;
    return `Obra derivada de Red de Mareógrafos ${date} CC-BY 4.0 ign.es; Área de Geodesia, Instituto Geográfico Nacional (IGN)`;
  },
  withheld: (id) =>
    id === "ACOR1"
      ? null
      : "IGN coverage withheld pending calibration and clock evidence; see ign-release-coverage and issue #181",
  stations: async () =>
    candidateStations(["ACOR1"])
      .filter((s) => s.source_id === "ACOR1")
      .map((s) => ({ ...s, interval_s: 3600, status: "inactive", live: false, same_as: [] })),
  observations: (s, start, end) => {
    if (s.source_id !== "ACOR1")
      throw new Error(`IGN ${s.source_id}: withheld; see ign-release-coverage and issue #181`);
    return corunaHourly(start, end, s.datum);
  },
  keepsStored: true,
};
