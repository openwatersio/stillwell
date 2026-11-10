/**
 * Writes src/sources/usgs/tidal-streams.ts: USGS `river` and `lake` stations
 * whose levels in the current datum epoch carry a tide (`tidal`), which QC treats as tide gauges. USGS types
 * some tidal streams as plain streams, and adds sites, so this runs again now
 * and then; a station it hasn't seen gets the river's two days.
 *
 *   node scripts/usgs-tidal-streams.ts
 *
 * Reads the public lake, or `WATER_LEVELS_LAKE`. Takes about an hour and a half.
 */
import { writeFile } from "node:fs/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { pool, qcFor } from "../src/lake/recent.ts";
import { readObservations } from "../src/lake/parquet.ts";
import { seriesPath, stationsPath } from "../src/lake/paths.ts";
import { fromSource, qc } from "../src/qc.ts";
import { Flag, type Kind, type Observation, type Station } from "../src/schema.ts";
import { source } from "../src/sources/usgs/index.ts";
import { TIDAL_STREAMS } from "../src/sources/usgs/tidal-streams.ts";
import { drains, tidal } from "../src/tidal.ts";

/**
 * Water this far above sea level, in meters, isn't tidal, whatever its fit
 * says: flash floods and dam schedules put 8 to 30 cm into M2 and O1 at
 * mountain streams and tailwaters (the Salt River near Roosevelt, the Colorado
 * at Lees Ferry), and the tidal streams measured sit within 10 m.
 */
const ABOVE_SEA_M = 10;
/** Days of the last year with values that a fit needs (`covered`). */
const COVERED_DAYS = 30;

const LAKE = (process.env.WATER_LEVELS_LAKE ?? "https://water-levels.openwaters.io").replace(
  /\/$/,
  "",
);
const db = await DuckDBInstance.create(":memory:");
const connection = await db.connect();
// A gage datum's altitude is in a sea-level datum (NAVD88, NGVD29, LMSL,
// PRVD02) or IGLD, which is above sea level too; an elevation series is in one.
const listed = (
  await connection.runAndReadAll(
    `WITH s AS (
       SELECT *, list_last(list_filter(epochs, lambda e: e.state = 'open')) AS open
       FROM '${stationsPath(LAKE)}'
       WHERE source = 'usgs' AND kind IN ('river', 'lake') AND "last" IS NOT NULL
     )
     SELECT source_id, kind, year(timezone('UTC', "last"))::INTEGER AS year,
       coalesce(open.id, 1)::INTEGER AS epoch,
       CASE WHEN coalesce(open.datum, datum) = 'GAGE'
         THEN map_values(coalesce(open.datums, datums))[1] ELSE 0 END AS altitude
     FROM s ORDER BY source_id`,
  )
).getRowObjectsJS() as {
  source_id: string;
  kind: Kind;
  epoch: number;
  year: number;
  altitude: number | null;
}[];
connection.closeSync();

const found: string[] = [];
const unread: string[] = [];
let read = 0;
await pool(listed, 12, async ({ source_id, kind, epoch, year, altitude }) => {
  // `tidal` fits the last 366 days, which the last two year files hold; a
  // missing file reads as none, and a station with no values in its last year,
  // or one it can't judge afresh, is reported rather than judged, staying in
  // the list if it's there.
  let rows: Observation[] = [];
  for (const y of [year - 1, year])
    rows = rows.concat(
      await readObservations(seriesPath(LAKE, "levels", "usgs", source_id, y, epoch)),
    );
  // A row written before `source_flag` was kept, flagged suspect or bad, may
  // hold QC's flag from either limit, so its station isn't judged afresh.
  const legacy = rows.some((r) => r.source_flag === undefined && r.flag >= Flag.suspect);
  if (legacy || !rows.some((r) => new Date(r.time).getUTCFullYear() === year)) {
    unread.push(source_id);
    // A station listed already stays until a run can read it.
    if (TIDAL_STREAMS.has(source_id)) found.push(source_id);
    return;
  }
  // Both limits judged afresh from USGS's own flags, since the lake's hold
  // whichever limit the list gave a station when they were written.
  const station = { kind } as Station;
  const start = fromSource(rows);
  const river = qc(start, qcFor({ ...source, tidal: () => false }, station));
  const tide = qc(start, qcFor({ ...source, tidal: () => true }, station));
  const times = river.map((r) => r.time);
  const levels = river.map((r) => r.level);
  const flags = river.map((r) => r.flag);
  if (
    covered(times, flags) &&
    tidal({ times, levels, source: flags }) &&
    !aboveSea(altitude, levels, flags) &&
    !drains(river, tide)
  )
    found.push(source_id);
  if (++read % 500 === 0) console.log(`${read} of ${listed.length} read, ${found.length} tidal`);
});
found.sort();

/**
 * Whether usable values fall on at least `COVERED_DAYS` days of the last year.
 * A storm-event gage records only while its reservoir fills, as at Ku Tree
 * Reservoir on Oahu, which has a few days of values spread over months: enough
 * span for `tidal`, and a fit of noise.
 */
function covered(times: number[], flags: number[]): boolean {
  // The year `tidal` fits, which ends at the last usable value.
  const usable = times.filter((_, i) => flags[i]! < Flag.suspect);
  const since = (usable.at(-1) ?? 0) - 366 * 86_400_000;
  const days = new Set(usable.filter((t) => t > since).map((t) => Math.floor(t / 86_400_000)));
  return days.size >= COVERED_DAYS;
}

/** Whether the water's median sits over `ABOVE_SEA_M`; a site with no altitude can't say. */
function aboveSea(altitude: number | null, levels: number[], flags: number[]): boolean {
  if (altitude === null) return false;
  const usable = levels
    .filter((l, i) => flags[i]! < Flag.suspect && Number.isFinite(l))
    .sort((a, b) => a - b);
  return altitude + (usable[usable.length >> 1] ?? 0) > ABOVE_SEA_M;
}

await writeFile(
  new URL("../src/sources/usgs/tidal-streams.ts", import.meta.url),
  `/**
 * USGS \`river\` and \`lake\` stations whose lunar tide, M2 and O1 together, is \`TIDE_M\`
 * or more over their last year in the lake (\`tidal\`), whose water sits within
 * 10 m of sea level where USGS gives the gage's altitude, and that don't drain
 * to a sill at low water (\`drains\` in src/tidal.ts), so QC treats them as tide
 * gauges rather than pooled rivers (\`qcFor\` in src/lake/recent.ts).
 * Generated by \`node scripts/usgs-tidal-streams.ts\`: ${found.length} of ${listed.length}.
 */
export const TIDAL_STREAMS = new Set([
${found.map((f) => `  ${JSON.stringify(f)},`).join("\n")}
]);
`,
);
console.log(`${found.length} of ${listed.length} river and lake stations are tidal`);
// A rerun on a lake missing a station's last year would drop it quietly; these say what changed.
const now = new Set(found);
console.log(`Added: ${found.filter((id) => !TIDAL_STREAMS.has(id)).join(", ") || "none"}`);
console.log(`Dropped: ${[...TIDAL_STREAMS].filter((id) => !now.has(id)).join(", ") || "none"}`);
console.log(`Not judged: ${unread.length ? unread.join(", ") : "none"}`);
