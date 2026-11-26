import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createTidePredictor } from "@slackwater/engine";
import { engineVersion, fitStation, type FitContext } from "../src/fit/fit.ts";
import { emptyInputs, readSeries, Unfit } from "../src/fit/series.ts";
import { fitSamples } from "../src/fit/window.ts";
import { Flag, type Observation, type SourceMetadata, type StoredStation } from "../src/schema.ts";
import { readYearStats, writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import type { YearRow } from "../src/store/years.ts";

const HOUR = 3_600_000;
const metadata = { id: "test", finalizes: true } as unknown as SourceMetadata;
const station = {
  id: "test/1",
  source: "test",
  source_id: "1",
  datum: "NAVD88",
  epochs: [{ id: 1, datum: "NAVD88", since: null, until: null, to_current: 0, state: "open" }],
} as unknown as StoredStation;

/** A year of hourly good values: four constituents, an annual cycle, a semiannual one that turns over each year, an offset and fixed noise of at most 1 cm. */
function yearOfValues(year: number): Observation[] {
  const predictor = createTidePredictor(
    [
      { name: "M2", amplitude: 1, phase: 30 },
      { name: "S2", amplitude: 0.3, phase: 60 },
      { name: "K1", amplitude: 0.2, phase: 120 },
      { name: "O1", amplitude: 0.15, phase: 200 },
      { name: "Sa", amplitude: 0.1, phase: 250 },
      // Opposite in alternate years, so its mean over the years is small beside their spread.
      { name: "Ssa", amplitude: 0.05, phase: year % 2 ? 40 : 220 },
    ],
    { offset: false, nodeCorrections: "schureman" },
  );
  let state = year;
  const rows: Observation[] = [];
  for (let time = Date.UTC(year, 0, 1); time < Date.UTC(year + 1, 0, 1); time += HOUR) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    rows.push({
      time,
      level:
        predictor.getWaterLevelAtTime({ time: new Date(time) }).level +
        0.4 +
        0.01 * (state / 2 ** 31 - 1),
      flag: Flag.good,
      source_flag: Flag.good,
    });
  }
  return rows;
}

describe("fitSamples", () => {
  it("gives fitStation's constants and verdicts on fitStation's window", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-fit-window-"));
    const years = new Map<string, YearRow>();
    for (const year of [2021, 2022, 2023, 2024]) {
      const file = seriesPath(root, "levels", "test", "1", year);
      await writeObservations(file, yearOfValues(year), "NAVD88");
      const stats = (await readYearStats([file])).get(file)!;
      years.set(`test/1 1 ${year}`, { id: "test/1", epoch: 1, year, ...stats });
    }
    const context: FitContext = {
      store: root,
      metadata,
      years,
      errata: [],
      now: new Date(Date.UTC(2026, 10, 25)),
      finalYear: 2024,
      engine: engineVersion(),
    };
    const { fit, constituents: rows } = await fitStation(station, context);
    assert.equal(fit.reason, null);

    const samples = await readSeries(
      station,
      { start: Date.parse(fit.since!), end: Date.parse(fit.until!) },
      "final",
      { ...context, inputs: emptyInputs() },
    );
    const window = fitSamples(samples);
    assert.equal(window.hours, fit.hours);
    assert.equal(window.z0, fit.z0_m);
    assert.equal(window.rms, fit.rms_m);
    assert.deepEqual(
      window.constituents.map((c) => [
        c.name,
        c.amplitude,
        c.phase,
        c.amplitudeInterval,
        c.phaseInterval,
        c.snr,
      ]),
      rows
        .filter((r) => r.kept)
        .sort(
          (a, b) =>
            window.constituents.findIndex((c) => c.name === a.name) -
            window.constituents.findIndex((c) => c.name === b.name),
        )
        .map((r) => [r.name, r.amplitude_m, r.phase_deg, r.amplitude_ci_m, r.phase_ci_deg, r.snr]),
    );
    assert.ok(window.constituents.some((c) => c.name === "Sa"));
    // The series puts candidates through every way of not being kept, so the two are compared on each.
    for (const reason of ["snr", "rayleigh", "seasonal"])
      assert.ok(
        window.verdicts.some((v) => v.reason === reason),
        `a candidate dropped for ${reason}`,
      );
    assert.deepEqual(
      window.verdicts,
      rows.map((r) => ({ name: r.name, kept: r.kept, reason: r.reason, conflict: r.conflict })),
    );
  });

  it("refuses a record under half a year", () => {
    const samples = yearOfValues(2021)
      .slice(0, 100 * 24)
      .map(({ time, level }) => ({ time, level }));
    assert.throws(() => fitSamples(samples), Unfit);
  });
});
