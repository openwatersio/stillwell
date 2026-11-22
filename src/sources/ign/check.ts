import { CORUNA_GAUGES } from "../../coruna-gauges.ts";
import { Flag, type Observation } from "../../schema.ts";

/** Clock uncertainty remains explicit while preserving source withdrawals. */
export function checkCorunaQuality(levels: Observation[]) {
  if (!levels.length || levels.some((o) => o.flag < Flag.suspect))
    throw new Error("ign/ACOR1 must remain suspect throughout its admitted interval");
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
