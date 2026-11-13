import { getText, HttpError } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
  type Station,
} from "../../schema.ts";

/**
 * The Japan Meteorological Agency's tide gauges: hourly levels in centimeters
 * above each station's observation datum (観測基準面, DL), in JST, one text
 * file per station and month. See README.md.
 */
const SITE = "https://www.data.jma.go.jp/kaiyou";
const DATUM = "DL";

export const metadata: SourceMetadata = {
  id: "jma",
  name: "Japan Meteorological Agency (JMA)",
  url: `${SITE}/db/tide/genbo/index.php`,
  license: {
    id: "PDL-1.0",
    name: "Public Data License (Version 1.0)",
    url: "https://www.jma.go.jp/jma/en/copyright.html",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Japan Meteorological Agency",
  contact: { url: "https://ds.data.jma.go.jp/homepage.php/index.php" },
  terms:
    "JMA's website content is under the Public Data License 1.0, compatible with CC BY 4.0, commercial use included. Credit the source as 出典：気象庁ホームページ (Source: Japan Meteorological Agency website) with the page's URL, and say the data was edited. Changes in the store: times converted from JST to UTC, levels from centimeters to meters, and quality flags added; the current and previous month's provisional values are marked preliminary.",
  // The historical files are shifted to each station's current observation datum.
  archive: "current",
  // Provisional values appear around noon the next day, too late for hourly ingest.
  hourly: false,
  // Provisional values are replaced by final ones around the 20th of the next month.
  finalizes: true,
  utc_offsets: [9, 9],
};

const HOUR_MS = 3_600_000;
const JST_MS = 9 * HOUR_MS;
/** The first month of the final set; earlier months come from the historical set. */
const FINAL_SINCE = Date.UTC(1997, 3, 1);

/** A JMA station as listed, with the record's first and last months, which a backfill keeps to. */
export type JmaStation = ListedStation & { record_start: string | null; record_end: string | null };

/**
 * Station names in English, by JMA's code. JMA publishes its lists in
 * Japanese only; a code missing here keeps its Japanese name.
 */
const NAMES: Record<string, string> = {
  AB: "Aburatsu",
  AS: "Abashiri",
  AW: "Awa-Yuki",
  AY: "Ayukawa",
  B3: "Otaru",
  CC: "Chichijima",
  CS: "Choshi Fishing Port",
  D5: "Ito",
  D9: "Nachikatsuura",
  DJ: "Minamidaito",
  DS: "Shimonoseki",
  FE: "Fukue",
  FK: "Fukaura",
  FU: "Fukahori",
  G9: "Irozaki",
  GB: "Gobo",
  H1: "Shimotsu",
  HA: "Hamada",
  HC: "Hachinohe",
  HD: "Haneda",
  HF: "Hofu",
  HK: "Hakodate",
  HN: "Hanasaki",
  I4: "Akabane",
  IS: "Ishigaki",
  IW: "Iwasaki",
  KB: "Kobe",
  KC: "Kochi",
  KG: "Kagoshima",
  KM: "Komatsushima",
  KN: "Kumano",
  KR: "Kushiro",
  KS: "Kushimoto",
  KT: "Kuchinotsu",
  L4: "Kochi-Yokohama",
  MC: "Minamitorishima",
  ME: "Megami",
  MI: "Maisaka",
  MJ: "Miyakejima",
  MK: "Makurazaki",
  MR: "Mera",
  MS: "Misumi",
  MT: "Matsuyama",
  MU: "Cape Muroto",
  MY: "Miyako",
  MZ: "Maizuru",
  N5: "Tsushima-Hitakatsu",
  NG: "Nagoya",
  NH: "Naha",
  NS: "Nagasaki",
  O1: "Tsushima",
  O7: "Minamata",
  O9: "Amami",
  OD: "Odawara",
  OF: "Ofunato",
  OK: "Okada",
  OM: "Omaezaki",
  ON: "Onahama",
  OS: "Osaka",
  OU: "Oura",
  OW: "Owase",
  R1: "Hirara",
  RH: "Reihoku",
  S0: "Sado",
  SA: "Saigo",
  SH: "Shimokita",
  SK: "Sakai",
  SM: "Shimizu Port",
  SR: "Shirahama",
  SS: "Dannoura",
  ST: "Sumoto",
  SZ: "Noto",
  T2: "Miyazu",
  TA: "Takamatsu",
  TB: "Toba",
  TE: "Tomie",
  TJ: "Tanegashima",
  TK: "Tokyo",
  TN: "Tannowa",
  TS: "Tosashimizu",
  TU: "Tonoura",
  TY: "Toyama",
  UC: "Uchiura",
  UN: "Uno",
  UR: "Uragami",
  UW: "Uwajima",
  WN: "Wakkanai",
  WY: "Wakayama",
  X5: "Saiki",
  YJ: "Yonaguni",
};

/**
 * Closed stations' last positions, in degrees and minutes, from each one's
 * history page (sea_lev_var_his.php); the current list gives only open ones.
 * Positions before 2003 are in the Tokyo datum, a few hundred meters off WGS 84.
 */
const CLOSED: Record<string, [number, number, number, number]> = {
  CS: [35, 45, 140, 52],
  D5: [34, 58, 139, 7],
  D9: [33, 37, 135, 57],
  DS: [33, 55, 130, 56],
  FU: [32, 41, 129, 49],
  H1: [34, 6, 135, 9],
  HC: [40, 32, 141, 32],
  HD: [35, 33, 139, 46],
  HF: [34, 3, 131, 35],
  IW: [40, 35, 139, 55],
  L4: [33, 32, 133, 34],
  ME: [32, 43, 129, 51],
  MS: [32, 37, 130, 27],
  O1: [34, 16, 129, 19],
  O7: [32, 13, 130, 23],
  R1: [24, 48, 125, 17],
  SS: [33, 58, 130, 57],
  T2: [35, 32, 135, 12],
  TE: [32, 37, 128, 46],
  TU: [34, 54, 132, 4],
};

const degrees = (d: number, m: number) => Math.round((d + m / 60) * 10_000) / 10_000;

/** Each `<tr class="mtx">` row's cells as text. */
function rows(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*class="mtx"[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(([, row]) =>
      [...row!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) =>
        cell!
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    )
    .filter((cells) => cells.length >= 6 && /^[A-Z0-9]{2}$/.test(cells[1]!));
}

/** `1955年1月` as the instant that JST month starts, or null for `-`. */
function monthStart(text: string, after = 0): number | null {
  if (text === "-") return null;
  const m = /^(\d{4})年(\d{1,2})月$/.exec(text);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12)
    throw new Error(`JMA's station list has ${text} for a month`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1 + after, 1) - JST_MS;
}

/**
 * Every station in JMA's historical list, with its first and last months, and
 * any the current list adds. The current list gives open stations' positions;
 * a closed one's comes from `CLOSED`, or the store's list.
 */
export async function stations(previous: Station[] = []): Promise<JmaStation[]> {
  const [history, current] = await Promise.all([
    getText(`${SITE}/db/tide/sea_lev_var/station_history.php`, { fresh: true, pace }),
    getText(`${SITE}/db/tide/genbo/station.php`, { fresh: true, pace }),
  ]);
  const spans = new Map(rows(history).map((c) => [c[1]!, c]));
  const open = new Map(rows(current).map((c) => [c[1]!, c]));
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!spans.size || !open.size) throw new Error("JMA listed no tide stations");
  const known = new Map(previous.map((s) => [s.source_id, s]));
  return [...new Set([...spans.keys(), ...open.keys()])]
    .map((code): JmaStation => {
      const span = spans.get(code);
      const now = open.get(code);
      const end = span ? monthStart(span[4]!, 1) : null;
      const begun = span ? monthStart(span[3]!) : null;
      if (span && begun === null) throw new Error(`JMA ${code} has no first month`);
      const at = now
        ? [now[4]!, now[5]!].map((p) => {
            const m = /(\d+)\D+(\d+)/.exec(p);
            if (!m) throw new Error(`JMA ${code}'s position ${p} isn't degrees and minutes`);
            return degrees(Number(m[1]), Number(m[2]));
          })
        : CLOSED[code]
          ? [degrees(CLOSED[code][0], CLOSED[code][1]), degrees(CLOSED[code][2], CLOSED[code][3])]
          : known.has(code)
            ? [known.get(code)!.lat, known.get(code)!.lon]
            : null;
      if (!at) throw new Error(`JMA ${code} is closed and has no known position; add it to CLOSED`);
      const active = end === null;
      return {
        ...stationDefaults(metadata),
        id: `jma/${code}`,
        source_id: code,
        name: NAMES[code] ?? span?.[2] ?? now![2]!,
        lat: at[0]!,
        lon: at[1]!,
        country_code: "JP",
        kind: "coastal",
        interval_s: 3600,
        datum: DATUM,
        datums: {},
        products: ["levels"],
        first: null,
        last: null,
        tide_station: null,
        same_as: [],
        status: active ? "active" : "inactive",
        // Values arrive a day or more after they're measured.
        live: false,
        min_interval_s: null,
        source_url: `${SITE}/db/tide/sea_lev_var/sea_lev_var_his.php?stn=${code}`,
        record_start: begun === null ? null : iso(begun),
        record_end: end === null ? null : iso(end),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const iso = (t: number) => new Date(t).toISOString();

/**
 * Hourly levels in meters above the station's DL over [start, end), one JST
 * month's file at a time: the historical set before April 1997, the final set
 * from then, and the provisional set for the current and previous month where
 * the final one isn't out yet.
 */
export async function levels(
  code: string,
  start: Date,
  end: Date,
  {
    datum,
    record_start,
    record_end,
  }: Partial<Pick<JmaStation, "datum" | "record_start" | "record_end">> = {},
): Promise<Observation[]> {
  if ((datum ?? DATUM) !== DATUM) throw new Error(`JMA ${code} is read in ${DATUM}, not ${datum}`);
  if (!/^[A-Z0-9]{2}$/.test(code)) throw new Error(`Not a JMA station: ${code}`);
  const from = Math.max(start.getTime(), record_start ? Date.parse(record_start) : -Infinity);
  const to = Math.min(end.getTime(), record_end ? Date.parse(record_end) : Infinity);
  const out: Observation[] = [];
  const now = new Date(Date.now() + JST_MS);
  // The provisional set holds the current JST month and the one before.
  const provisionalSince = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const first = new Date(from + JST_MS);
  // JST months that brought values, as the UTC month each one mostly covers.
  const filled = new Set<number>();
  for (
    let month = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    month - JST_MS < to;
    month = Date.UTC(new Date(month).getUTCFullYear(), new Date(month).getUTCMonth() + 1, 1)
  ) {
    const values = await monthOf(code, month, month >= provisionalSince);
    if (values.length) filled.add(month);
    out.push(...values.filter((o) => o.time >= from && o.time < to));
  }
  // A UTC month's last 9 hours come from the next JST month's file. Where its
  // own JST month brought nothing, or wasn't read, they'd count alone as a
  // fetch of the month, and a merge would replace what the store holds for it
  // with them, so they're dropped.
  return out.filter((o) => {
    const d = new Date(o.time);
    return filled.has(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
}

/** One JST month's values, or none where JMA has no file for it. */
async function monthOf(code: string, month: number, recent: boolean): Promise<Observation[]> {
  const d = new Date(month);
  const yyyy = String(d.getUTCFullYear());
  const yyyymm = `${yyyy}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const set = month < FINAL_SINCE ? "sea_lev_var" : "genbo";
  try {
    // A recent final file can still appear or change, so it isn't cached.
    const text = await getText(
      `${SITE}/data/db/tide/${set}/${yyyy}/${yyyymm}/hry${yyyymm}${code}.txt`,
      {
        fresh: recent,
        pace,
        // Final files are cached, so a 200 that isn't a whole month's file mustn't be.
        keep: (t) => {
          try {
            return !!parse(t, code, month, Flag.good);
          } catch {
            return false;
          }
        },
      },
    );
    return parse(text, code, month, Flag.good);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (!recent) return [];
  try {
    const text = await getText(`${SITE}/data/db/tide/sokuho/${yyyymm}/z_hry${yyyymm}${code}.txt`, {
      fresh: true,
      pace,
    });
    return parse(text, code, month, Flag.preliminary);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return [];
  }
}

const isMissing = (error: unknown) =>
  error instanceof HttpError && / returned 404$/.test(error.message);

/**
 * One month's hourly file: a line per day, 24 three-column values for hours
 * 0 to 23 JST in centimeters, blank where missing, then the two-digit year,
 * month, day and station code in columns 73 to 80. The final set adds high
 * and low waters after column 80, which aren't read.
 */
export function parse(text: string, code: string, month: number, flag: Flag): Observation[] {
  const d = new Date(month);
  const yy = String(d.getUTCFullYear() % 100).padStart(2, " ");
  const mm = String(d.getUTCMonth() + 1).padStart(2, " ");
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const seen = new Set<number>();
  const out: Observation[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const dayOf = (line: string) => Number(line.slice(76, 78));
  for (const [i, line] of lines.entries()) {
    const stamp = line.slice(72, 80);
    if (
      stamp.slice(0, 4).replace(/ /g, "0") !== `${yy}${mm}`.replace(/ /g, "0") ||
      stamp.slice(6) !== code
    )
      throw new Error(
        `JMA ${code}'s file for ${d.toISOString().slice(0, 7)} has a line for ${stamp}`,
      );
    let day = dayOf(line);
    if (!(day >= 1 && day <= days) || seen.has(day)) {
      // A mistyped day between two lines stamped two days apart is the day between
      // them: Saigo's 22 October 1980 is stamped the 20th. A copy of another line
      // is a repeat, not a mistyped day.
      const before = i > 0 ? dayOf(lines[i - 1]!) : NaN;
      const after = i + 1 < lines.length ? dayOf(lines[i + 1]!) : NaN;
      const values = line.slice(0, 72);
      if (
        !(before >= 1 && after <= days) ||
        after - before !== 2 ||
        seen.has(before + 1) ||
        lines.some((other, j) => j !== i && other.slice(0, 72) === values)
      )
        throw new Error(`JMA ${code}: not a day, or a day twice: ${stamp}`);
      day = before + 1;
    }
    seen.add(day);
    for (let hour = 0; hour < 24; hour++) {
      const cell = line.slice(hour * 3, hour * 3 + 3).trim();
      if (!cell) continue;
      if (!/^-?\d+$/.test(cell)) throw new Error(`JMA ${code}: not a level: ${cell}`);
      out.push({
        time: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day, hour) - JST_MS,
        level: Number(cell) / 100,
        flag,
      });
    }
  }
  // Every day has a line, blank where nothing was measured, so a short file was cut off.
  if (seen.size !== days)
    throw new Error(
      `JMA ${code}'s file for ${d.toISOString().slice(0, 7)} has ${seen.size} of ${days} days`,
    );
  return out;
}

/** JMA publishes no rate limit; requests start a third of a second apart. */
export const pacing = { requestMs: 300 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

export const source: Source = {
  metadata,
  stations,
  observations: (s, start, end) => levels(s.source_id, start, end, s as JmaStation),
};
