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

const BASE = "https://datos-geodesia.ign.es/Red_de_Mareografos/";
const DAY = 86_400_000;

export const metadata: SourceMetadata = {
  id: "ign",
  name: "Instituto Geográfico Nacional (Spain)",
  url: "https://www.ign.es/web/gds-red-mareografos",
  license: {
    id: "IGN-attribution",
    name: "IGN tide-gauge data: attribution required",
    url: `${BASE}Leeme.txt`,
    commercial_use: false,
    redistribution: true,
  },
  attribution: "Área de Geodesia, Instituto Geográfico Nacional (IGN)",
  contact: { email: "ign@transportes.gob.es", url: "https://www.ign.es/web/gds-red-mareografos" },
  terms:
    "IGN's data-server README requires citing Área de Geodesia, IGN. Redistribution is permitted with attribution; commercial use is tagged false pending confirmation that IGN's CC BY 4.0 policy covers these series. See openwatersio/stillwell#181. Times are read as UTC, millimeters converted to meters and raw digital distances reversed; surveyed BM–JM offsets are applied where documented.",
  archive: "current",
  hourly: true,
  finalizes: true,
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
  return [...html.matchAll(/href="([^"<>]+)"/g)]
    .map((m) => m[1]!)
    .filter((f) => /^[A-Za-z0-9_.-]+\/?$/.test(f));
}

export async function stations(): Promise<ListedStation[]> {
  const codes = (await inventory(""))
    .filter((f) => f.endsWith("/") && f !== "fichas/")
    .map((f) => f.slice(0, -1));
  if (codes.length !== Object.keys(gauges).length || codes.some((c) => !gauges[c]))
    throw new Error("IGN station catalog changed; check the station sheets");
  return codes
    .flatMap((code) => {
      const g = gauges[code]!;
      const ids = [
        code,
        ...(g.bmHeight === null ? [`${code}-BM`] : []),
        ...g.charts.map((s) => `${code}-${s}`),
      ];
      return ids.map((id): ListedStation => {
        const part = id.slice(code.length + 1);
        const datum = part === "BM" ? "BM" : part ? "ZERO" : "JM";
        const live = !g.last && (part === "BM" || (!part && g.bmHeight !== null));
        return {
          ...stationDefaults(metadata),
          id: `ign/${id}`,
          source_id: id,
          name: `${g.name}${part ? ` (${part})` : ""}`,
          lat: g.lat,
          lon: g.lon,
          country_code: "ES",
          kind: "coastal",
          interval_s: part && part !== "BM" ? 3600 : null,
          datum,
          datums: datum === "JM" ? { [g.origin]: g.jmHeight } : {},
          reference: {
            id: datum === "JM" ? g.jm : datum === "BM" ? g.bm : `${code}/${part}`,
            since: null,
          },
          products: ["levels"],
          first: null,
          last: null,
          tide_station: null,
          same_as: ids.filter((other) => other !== id).map((other) => `ign/${other}`),
          status: g.last || (part && part !== "BM") ? "inactive" : "active",
          live,
          min_interval_s: 3600,
          source_url: `${BASE}fichas/${code}.pdf`,
        };
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

interface ParseOptions {
  year: number;
  gauge: string;
  raw: boolean;
  reference?: string;
  sign: 1 | -1;
  offset: number;
  day?: string;
}
export function parse(body: string, options: ParseOptions): Observation[] {
  const { year, gauge, raw, reference, sign, offset, day } = options;
  const lines = body.trim().split(/\r?\n/);
  if (!raw) {
    const header = lines.shift()!;
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
  for (const line of lines) {
    if (!line.trim()) continue;
    // IGN's hourly means omit seconds; minute and raw files include them.
    const m =
      /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(-?\d+(?:\.\d+)?|---)(?:\s+"(mm)")?\s*$/.exec(
        line,
      );
    if (!m || (raw && !m[8])) throw new Error(`IGN ${gauge}: invalid water-level row: ${line}`);
    const stamp = `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}.000Z`;
    const time = Date.parse(stamp);
    // Exact duplicate logger rows carry no second observation: erratum `ign-duplicate-raw-rows`.
    if (raw && time === previous && line === previousLine) continue;
    if (
      !Number.isFinite(time) ||
      new Date(time).toISOString() !== stamp ||
      Number(m[3]) !== year ||
      (day && `${m[3]}${m[2]}${m[1]}` !== day) ||
      time <= previous
    )
      throw new Error(`IGN ${gauge}: invalid or out-of-order timestamp: ${stamp}`);
    previous = time;
    previousLine = line;
    if (m[7] === "---" || Math.abs(Number(m[7])) === 9999) continue;
    out.push({
      time,
      level: Math.round(((sign * Number(m[7])) / 1000 + offset) * 1e6) / 1e6,
      flag: raw ? Flag.preliminary : Flag.good,
    });
  }
  if (!lines.some((l) => l.trim())) throw new Error(`IGN ${gauge}: empty data file`);
  return out;
}

function bmToJm(g: Gauge): number {
  if (g.bmHeight === null) throw new Error(`IGN has no surveyed BM–JM offset for ${g.name}`);
  return g.bmHeight - g.jmHeight;
}

async function reviewed(code: string, g: Gauge, from: number, to: number): Promise<Observation[]> {
  const out = new Map<number, Observation>();
  // Minute values win over hourly means where both series provide a timestamp.
  for (const folder of ["integros", "horarios"]) {
    const path = `${code}/procesados/${folder}/`;
    for (const file of await inventory(path)) {
      const m = /^(\d{6})_(?:horarios_)?(\d{4})_(JM|BM)\.txt$/.exec(file);
      if (!m) continue;
      if (m[1] !== g.number) throw new Error(`IGN ${code}: another station in catalog: ${file}`);
      const year = Number(m[2]);
      if (Date.UTC(year, 0, 1) >= to || Date.UTC(year + 1, 0, 1) <= from) continue;
      const offset = m[3] === "BM" ? bmToJm(g) : 0;
      for (const o of parse(await text(path + file), {
        year,
        gauge: code,
        reference: m[3]!,
        raw: false,
        sign: 1,
        offset,
      }))
        if (!out.has(o.time)) out.set(o.time, o);
    }
  }
  return [...out.values()];
}

async function rawLevels(
  code: string,
  g: Gauge,
  sensor: string | null,
  offset: number,
  from: number,
  to: number,
): Promise<Observation[]> {
  const path = `${code}/observados/`;
  const yearLinks = await inventory(path);
  const supported = sensor ? [sensor] : g.sensors;
  const out = new Map<number, Observation>();
  const selectedDay = new Map<string, string>();
  for (const link of yearLinks) {
    if (!/^\d{4}\/$/.test(link)) continue;
    const year = Number(link.slice(0, 4));
    if (Date.UTC(year, 0, 1) >= to || Date.UTC(year + 1, 0, 1) <= from) continue;
    let annual = to - from > 7 * DAY && year < new Date().getUTCFullYear();
    let dir = annual ? `${path}ficheros_anuales/` : `${path}${year}/`;
    let files = await inventory(dir, annual);
    const matches = (names: string[], size: number) =>
      names
        .map((file) => ({ file, match: /^(\d{6})_(\d{4})_(\d{4}|\d{8})\.txt$/.exec(file) }))
        .filter(
          ({ match: m }) =>
            m &&
            m[1] === g.number &&
            supported.includes(m[2]!) &&
            Number(m[3]!.slice(0, 4)) === year &&
            m[3]!.length === size,
        )
        .sort((a, b) => supported.indexOf(a.match![2]!) - supported.indexOf(b.match![2]!));
    let matching = matches(files, annual ? 4 : 8);
    if (annual && !matching.length) {
      annual = false;
      dir = `${path}${year}/`;
      files = await inventory(dir);
      matching = matches(files, 8);
    }
    for (const { file, match: m } of matching) {
      const day = annual ? undefined : m![3]!;
      if (day) {
        const start = Date.UTC(year, Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
        if (start >= to || start + DAY <= from || selectedDay.has(day)) continue;
      }
      const rows = parse(await text(dir + file), {
        year,
        gauge: code,
        raw: true,
        sign: sensor ? 1 : -1,
        offset,
        day,
      });
      for (const o of rows) {
        const date = new Date(o.time).toISOString().slice(0, 10).replaceAll("-", "");
        if (selectedDay.has(date) && selectedDay.get(date) !== m![2]) continue;
        selectedDay.set(date, m![2]!);
        if (o.time < from || o.time >= to) continue;
        if (!out.has(o.time)) out.set(o.time, o);
      }
    }
  }
  return [...out.values()];
}

export async function levels(
  id: string,
  start: Date,
  end: Date,
  datum?: string,
): Promise<Observation[]> {
  const [code, part] = id.split("-");
  const g = gauges[code!];
  if (
    !g ||
    (part && part !== "BM" && !g.charts.includes(part)) ||
    id !== `${code}${part ? `-${part}` : ""}` ||
    (part === "BM" && g.bmHeight !== null)
  )
    throw new Error(`Not an IGN station: ${id}`);
  const expected = part === "BM" ? "BM" : part ? "ZERO" : "JM";
  if (datum && datum !== expected)
    throw new Error(`IGN ${id}: expected datum ${expected}, got ${datum}`);
  const from = Math.max(start.getTime(), Date.UTC(g.first, 0, 1));
  const to = Math.min(end.getTime(), g.last ? Date.UTC(g.last + 1, 0, 1) : Infinity);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("IGN needs finite dates");
  if (from >= to) return [];
  const out = new Map<number, Observation>();
  if (!part) for (const o of await reviewed(code!, g, from, to)) out.set(o.time, o);
  const rawFrom = part && part !== "BM" ? from : Math.max(from, Date.UTC(g.digitalSince, 0, 1));
  if ((part || g.bmHeight !== null) && rawFrom < to) {
    const offset = !part ? bmToJm(g) : 0;
    for (const o of await rawLevels(
      code!,
      g,
      part && part !== "BM" ? part : null,
      offset,
      rawFrom,
      to,
    ))
      if (!out.has(o.time)) out.set(o.time, o);
  }
  return [...out.values()]
    .filter((o) => o.time >= from && o.time < to)
    .sort((a, b) => a.time - b.time);
}

export const source: Source = {
  metadata,
  stations,
  observations: (s, start, end) => levels(s.source_id, start, end, s.datum),
  keepsStored: true,
};
