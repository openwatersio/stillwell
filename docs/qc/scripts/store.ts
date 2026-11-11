// Reads a station-year that export.py wrote, the way requalify reads the
// lake: levels as level() in src/store/parquet.ts returns them (a null is
// Number(null), 0 m), `source_flag` left out where it's null, flags started
// over with fromSource, the years either side as context, and the options
// qcFor gives the station.
import { readFileSync } from "node:fs";
import { fromSource } from "../../../src/qc.ts";
import { qcFor } from "../../../src/store/recent.ts";
import type { Observation } from "../../../src/schema.ts";

type Cell = [number, number | null, number, number | null];

export interface StationYear {
  station: { id: string; kind: string | null; tidal: boolean | null; tide_m: number | null };
  /** The year's rows as stored. */
  stored: Observation[];
  /** The year's rows with flags started over from the source's (`fromSource`). */
  start: Observation[];
  /** The years either side, as requalify passes them. */
  context: Observation[];
  options: ReturnType<typeof qcFor>;
}

const rowsOf = (cells: Cell[]): Observation[] =>
  cells.map(([time, level, flag, source]) => ({
    time,
    level: Number(level),
    flag: flag as Observation["flag"],
    ...(source === null ? {} : { source_flag: source as Observation["flag"] }),
  }));

export function load(file: string, year: number): StationYear {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const stored = rowsOf(data.years[year] ?? []);
  if (!stored.length) throw new Error(`${file} has no rows for ${year}`);
  return {
    station: data.station,
    stored,
    start: fromSource(stored),
    context: [...rowsOf(data.years[year - 1] ?? []), ...rowsOf(data.years[year + 1] ?? [])],
    options: qcFor(data.station),
  };
}

/** Whether QC raised a row to suspect or bad over its source's flag; a row with no `source_flag` counts as the source's good. */
export const raised = (r: Observation) => r.flag >= 3 && (r.source_flag ?? 0) < 3;
