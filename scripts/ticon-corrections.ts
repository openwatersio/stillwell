/**
 * Which nodal corrections TICON's constants were fitted under: refits each
 * TICON record's own GESLA file, over the span the record says it was
 * analyzed over, with the record's constituents, under each family the engine
 * fits with, and compares the constants with TICON's. A family TICON used
 * gives its amplitudes back with a ratio of 1 and no phase difference; the
 * families differ most in O1, Q1, J1, Mf and Mm. It also gives, for the two
 * families the engine predicts under, how far the curve TICON's diurnal and
 * faster constants predict is from the curve of the same family's refit, over
 * a year in the middle of the span, with and without M1 and OO1.
 * docs/fits.md has what it found (Nodal corrections).
 *
 * Reads the store (`STILLWELL_STORE`) and the installed `@slackwater/database`.
 * A record whose span is over 19 years takes more memory than a default heap.
 *
 *   STILLWELL_STORE=https://stillwell.openwaters.io node scripts/ticon-corrections.ts winchelsea_is_bc-7935-can-meds sandy_cove_bc-7786-can-meds
 */
import {
  constituents as catalog,
  createTidePredictor,
  fit,
  type HarmonicConstituent,
} from "@slackwater/engine";
import { Flag } from "../src/schema.ts";
import { readObservationsBetween } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import { STORE } from "../src/store/stores.ts";
import { readYears } from "../src/store/years.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const FAMILIES = ["iho", "schureman", "foreman"] as const;
/** The lines every family defines and corrects its own way (docs/fits.md, What it costs). */
const OWN_WAY = ["M1", "OO1"];

const files = process.argv.slice(2);
if (!files.length) throw new Error("usage: ticon-corrections.ts <GESLA file>...");
const { loadStations } = await import("@slackwater/database");
const db = await loadStations();
const years = await readYears(STORE, "gesla");
if (!years) throw new Error(`${STORE} has no years file for gesla`);

for (const file of files) {
  const record = db.byId(`ticon/${file}`);
  if (!record?.epoch) throw new Error(`no TICON record ${file} with a span`);
  const [start, end] = [Date.parse(record.epoch.start), Date.parse(record.epoch.end) + DAY_MS];
  const samples: { time: Date; value: number }[] = [];
  const rows = [...years.values()]
    .filter((r) => r.id === `gesla/${file}` && r.year !== null && r.epoch !== null)
    .sort((a, b) => a.year! - b.year!);
  for (const r of rows)
    for (const o of await readObservationsBetween(
      seriesPath(STORE, "levels", "gesla", file, r.year!, r.epoch!),
      start,
      end,
      true,
    ))
      if (o.flag === Flag.good && Number.isFinite(o.level))
        samples.push({ time: new Date(o.time), value: o.level });
  const theirs = record.harmonic_constituents.map(({ name, amplitude, phase }) => ({
    name,
    amplitude,
    phase,
  }));
  console.log(
    `\n${file}: latitude ${record.latitude.toFixed(1)}, ${record.epoch.start} to ${record.epoch.end}, ${samples.length} values on the hour`,
  );

  const fits: Record<string, HarmonicConstituent[]> = {};
  for (const family of FAMILIES) {
    // Foreman's set defines SA, S1 and M1 on other lines, which the engine refuses to fit there.
    let names = theirs.map((c) => c.name);
    for (;;) {
      try {
        fits[family] = fit(samples, names, {
          nodeCorrections: family,
          ...(family === "foreman" ? { latitude: record.latitude } : {}),
          dropDependent: true,
        }).constituents;
        break;
      } catch (error) {
        const refused = /notForemanLine: (\S+)/.exec(String(error))?.[1];
        if (!refused) throw error;
        names = names.filter((n) => n !== refused);
      }
    }
  }

  console.log(
    `  refit / TICON amplitude, and phase difference in degrees, of constants over 5 mm\n  ${"".padEnd(8)}${"TICON mm".padStart(9)}  ${FAMILIES.map((f) => f.padEnd(18)).join("")}`,
  );
  for (const t of theirs) {
    if (t.amplitude < 0.005) continue;
    const cells = FAMILIES.map((family) => {
      const c = fits[family]!.find((x) => x.name === t.name);
      if (!c) return "".padEnd(18);
      const phase = ((((c.phase - t.phase) % 360) + 540) % 360) - 180;
      return `${(c.amplitude / t.amplitude).toFixed(4)} ${phase.toFixed(2).padStart(7)}`.padEnd(18);
    });
    console.log(
      `  ${t.name.padEnd(8)}${(t.amplitude * 1000).toFixed(1).padStart(9)}  ${cells.join("")}`,
    );
  }

  const fast = (name: string) => (catalog[name]?.speed ?? 0) > 10;
  const middle = Math.floor((start + end) / 2 / HOUR_MS) * HOUR_MS;
  for (const [label, keep] of [
    ["diurnal and faster", fast],
    [`without ${OWN_WAY.join(" and ")}`, (n: string) => fast(n) && !OWN_WAY.includes(n)],
  ] as const)
    for (const family of ["iho", "schureman"] as const) {
      const options = { offset: false, nodeCorrections: family } as const;
      const a = createTidePredictor(
        theirs.filter((c) => keep(c.name)),
        options,
      );
      const b = createTidePredictor(
        fits[family]!.filter((c) => keep(c.name)),
        options,
      );
      let sum = 0;
      let n = 0;
      for (let t = middle; t < middle + 365 * DAY_MS; t += HOUR_MS) {
        const time = new Date(t);
        sum += (a.getWaterLevelAtTime({ time }).level - b.getWaterLevelAtTime({ time }).level) ** 2;
        n++;
      }
      console.log(
        `  TICON's curve against the ${family} refit's, ${label}: ${(Math.sqrt(sum / n) * 1000).toFixed(2)} mm RMS`,
      );
    }
}
