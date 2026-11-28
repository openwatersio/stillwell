import { CORUNA_GAUGES } from "../../coruna-gauges.ts";
import { Flag, type Observation } from "../../schema.ts";

/**
 * The spans, `since` to before `until`, where ign/ACOR1 runs off other gauges,
 * as docs/results/ign-coruna-windows-2026-11-28/lags.mjs derives them. `probe`
 * starts a week whose levels fit `reference` better `lag` minutes away than at
 * the same time: negative where IGN is late, positive where it is early.
 */
export const CORUNA_CLOCK_WINDOWS = [
  {
    id: "ign-coruna-clock-2000-10",
    since: "2000-09-30",
    until: "2000-11-04",
    offset: "9 to 14 minutes early",
    gauges: "IEO's gauge alone, since REDMAR has no data then",
    reference: "uhslc/830",
    probe: "2000-10-07",
    lag: 10,
  },
  {
    id: "ign-coruna-clock-2000-11",
    since: "2000-11-18",
    until: "2001-01-20",
    offset: "9 to 16 minutes early",
    gauges: "IEO's gauge alone, since REDMAR has no data then",
    reference: "uhslc/830",
    probe: "2000-11-25",
    lag: 10,
  },
  {
    id: "ign-coruna-clock-2004-03",
    since: "2004-03-27",
    until: "2004-04-24",
    offset: "8 to 9 minutes early",
    gauges: "REDMAR's gauge alone, since IEO's has no data then",
    reference: "cmems/CorunaTG",
    probe: "2004-04-03",
    lag: 10,
  },
  {
    id: "ign-coruna-clock-2004-09",
    since: "2004-09-25",
    until: "2004-11-27",
    offset: "9 to 12 minutes early",
    gauges: "REDMAR's gauge, and IEO's in the one week it has data",
    reference: "cmems/CorunaTG",
    probe: "2004-10-16",
    lag: 10,
  },
  {
    id: "ign-coruna-clock-2006-03",
    since: "2006-03-18",
    until: "2006-05-06",
    offset: "8 to 15 minutes late",
    gauges: "IEO's and REDMAR's gauges",
    reference: "cmems/CorunaTG",
    probe: "2006-04-15",
    lag: -10,
  },
  {
    id: "ign-coruna-clock-2006-11",
    since: "2006-11-25",
    until: "2007-03-10",
    offset: "9 to 19 minutes late",
    gauges: "IEO's and REDMAR's gauges",
    reference: "cmems/CorunaTG",
    probe: "2007-02-24",
    lag: -20,
  },
  {
    id: "ign-coruna-clock-2007-12",
    since: "2007-12-22",
    until: "2008-01-19",
    offset: "8 to 13 minutes late",
    gauges: "IEO's and REDMAR's gauges",
    reference: "cmems/CorunaTG",
    probe: "2007-12-22",
    lag: -10,
  },
  {
    id: "ign-coruna-clock-2011-11",
    since: "2011-11-26",
    until: "2012-05-19",
    offset: "8 to 20 minutes late",
    gauges: "IEO's and REDMAR's gauges",
    reference: "cmems/CorunaTG",
    probe: "2012-05-05",
    lag: -20,
  },
] as const;

const inWindow = (time: number) =>
  CORUNA_CLOCK_WINDOWS.some((w) => time >= Date.parse(w.since) && time < Date.parse(w.until));

/** The windows are suspect, the rest keeps its ordinary flags, and source withdrawals are preserved. */
export function checkCorunaQuality(levels: Observation[]) {
  if (!levels.length) throw new Error("the store holds no ign/ACOR1 levels");
  const inside = levels.filter((o) => inWindow(o.time));
  if (inside.some((o) => o.flag < Flag.suspect))
    throw new Error("ign/ACOR1 must be suspect throughout its clock windows");
  // QC and withdrawals may flag up to 1% of the values outside the windows.
  const outside = levels.filter((o) => !inWindow(o.time));
  const flagged = outside.filter((o) => o.flag >= Flag.suspect).length;
  if (flagged > outside.length / 100)
    throw new Error(
      `${flagged} of ign/ACOR1's ${outside.length} levels outside its clock windows are suspect`,
    );
  if (
    levels.some(
      (o) => o.source_flag !== Flag.good && !(o.flag === Flag.bad && o.source_flag === Flag.bad),
    )
  )
    throw new Error("ign/ACOR1 lost its reviewed source flags");
}

/** Check published identities, including withdrawn optional copies and catalog prediction aliases. */
export function verifyCorunaIdentities(rows: Record<string, unknown>[]) {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  if (!byId.has("ign/ACOR1")) throw new Error("Coruña identity check: no ign/ACOR1");
  const known = new Set(CORUNA_GAUGES.flat());
  for (const group of CORUNA_GAUGES) {
    const present = group.filter((id) => byId.has(id));
    if (!present.length) throw new Error(`Coruña instrument group missing: ${group.join(", ")}`);
    const preferred = new Set<string>();
    for (const id of present) {
      const row = byId.get(id)!;
      const actual = (row.same_as as { items: string[] }).items;
      if (actual.some((other) => known.has(other) && !group.includes(other)))
        throw new Error(`${id} has cross-instrument same_as: ${actual.join(", ")}`);
      if (actual.some((other) => !known.has(other)))
        throw new Error(`${id} has an unreviewed Coruña alias`);
      if (present.some((other) => other !== id && !actual.includes(other)))
        throw new Error(`${id} has a split group`);
      const choice = String(row.preferred);
      if (!present.includes(choice)) throw new Error(`${id} prefers another instrument: ${choice}`);
      preferred.add(choice);
      const prediction = String(row.tide_station ?? "");
      const predicted = prediction.startsWith("ticon/") ? `gesla/${prediction.slice(6)}` : "";
      if (known.has(predicted) && !group.includes(predicted))
        throw new Error(`${id} predicts from another Coruña instrument: ${prediction}`);
      const allowed = group
        .filter((id) => id.startsWith("gesla/"))
        .map((id) => `ticon/${id.slice(6)}`);
      if (prediction && (group.includes("ign/ACOR1") || !allowed.includes(prediction)))
        throw new Error(`${id} has an unreviewed prediction: ${prediction}`);
      const offsets = row.datums_source as
        { entries: { key: string; value: string }[] } | undefined;
      if (
        group.includes("ign/ACOR1") &&
        offsets?.entries.some((e) => ["MSL", "LAT"].includes(e.key) && e.value === "computed")
      )
        throw new Error(`${id} has an unvalidated computed datum`);
    }
    if (preferred.size > 1)
      throw new Error(`Coruña group disagrees on preferred: ${group.join(", ")}`);
    const primary = group.includes("ign/ACOR1")
      ? "cmems/Coruna2TG"
      : group.includes("uhslc/830")
        ? "uhslc/830"
        : "cmems/CorunaTG";
    if (present.includes(primary) && !preferred.has(primary))
      throw new Error(`Coruña group has unexpected preferred: expected ${primary}`);
  }
}
