import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import type { StoreReader } from "../src/errata.ts";
import type { StoredStation } from "../src/schema.ts";
import migration from "../src/migrations/20261121-ign-coruna-hourly.ts";
import { CORUNA_GAUGES } from "../src/same-as.ts";
import { errata, sourceOf } from "../src/sources/index.ts";
import { errataReader } from "../src/store/errata-reader.ts";
import { writeRows } from "../src/store/parquet.ts";

it("reads published Coruña identities back and refuses cross-gauge links or preference", async () => {
  const root = await mkdtemp(join(tmpdir(), "coruna-identity-"));
  const step = migration.steps.find((s) => s.check?.startsWith("Coruña's IGN"))!;
  assert.ok(step.verify);
  const identity = errata.find((e) => e.id === "ign-release-coverage")!;
  assert.ok(identity.check);
  const checks = [
    step.verify!,
    async (store: string) => {
      const reader = errataReader(() => store, store);
      await identity.check!(
        {
          ...reader,
          station: async () => (await sourceOf("ign").stations())[0]! as StoredStation,
          levels: async () => [
            { time: Date.UTC(2000, 0, 1), level: 1, flag: 3, source_flag: 0, epoch: 1 },
          ],
        },
        identity,
      );
    },
  ];
  const verify = async (store: string) => {
    for (const check of checks) await check(store);
  };
  const rejects = async (pattern: RegExp) => {
    for (const check of checks) await assert.rejects(check(root), pattern);
  };
  const rows = CORUNA_GAUGES.flatMap((group) =>
    group.map((id) => ({
      id,
      preferred: group.includes("ign/ACOR1")
        ? "cmems/Coruna2TG"
        : group.includes("uhslc/830")
          ? "uhslc/830"
          : "cmems/CorunaTG",
      same_as: group.filter((other) => other !== id),
      tide_station: null as string | null,
      datums_source: {} as Record<string, string>,
    })),
  );
  const write = () =>
    writeRows(
      `${root}/stations.parquet`,
      rows,
      {
        id: "VARCHAR",
        preferred: "VARCHAR",
        same_as: "VARCHAR[]",
        tide_station: "VARCHAR",
        datums_source: "MAP(VARCHAR, VARCHAR)",
      },
      "id",
    );
  try {
    await write();
    await verify(root);
    rows[0]!.tide_station = "ticon/la_coruna-830-esp-uhslc_fd";
    await write();
    await rejects(/predicts from another/);
    rows[0]!.tide_station = "ticon/unreviewed-coruna-record";
    await write();
    await rejects(/unreviewed prediction/);
    rows[0]!.tide_station = "ticon/coruna2tg-cor-esp-cmems";
    await write();
    await rejects(/unreviewed prediction/);
    rows[0]!.tide_station = null;
    rows[1]!.datums_source = { LAT: "computed" };
    await write();
    await rejects(/unvalidated computed datum/);
    rows[1]!.datums_source = {};
    const peers = rows[0]!.same_as;
    rows[0]!.same_as = [];
    await write();
    await rejects(/split group/);
    rows[0]!.same_as = peers;
    rows[0]!.same_as.push("uhslc/830b");
    await write();
    await rejects(/unreviewed Coruña alias/);
    rows[0]!.same_as.pop();
    for (const row of rows.filter((r) => r.id === "ign/ACOR1" || r.same_as.includes("ign/ACOR1")))
      row.preferred = "ign/ACOR1";
    await write();
    await rejects(/unexpected preferred/);
    for (const row of rows.filter((r) => r.id === "ign/ACOR1" || r.same_as.includes("ign/ACOR1")))
      row.preferred = "cmems/Coruna2TG";
    rows[0]!.same_as.push("cmems/CorunaTG");
    await write();
    await rejects(/cross-instrument same_as/);
    rows[0]!.same_as.pop();
    rows[0]!.preferred = "cmems/CorunaTG";
    await write();
    await rejects(/prefers another instrument/);
    rows[0]!.preferred = rows[0]!.id;
    rows[1]!.preferred = rows[1]!.id;
    await write();
    await rejects(/disagrees on preferred/);
    rows[0]!.preferred = "cmems/Coruna2TG";
    rows[1]!.preferred = "cmems/Coruna2TG";
    const absent = rows.pop()!.id;
    for (const row of rows) row.same_as = row.same_as.filter((id) => id !== absent);
    await write();
    await verify(root);
    rows.shift();
    await write();
    await rejects(/no ign\/ACOR1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps the clock windows suspect, the rest unflagged, and accepts source withdrawals", async () => {
  const { checkCorunaQuality } = await import("../src/sources/ign/check.ts");
  const at = (day: string, flag: 0 | 3 | 4, source_flag: 0 | 3 | 4 = 0) => ({
    time: Date.parse(day),
    level: 1,
    flag,
    source_flag,
  });
  const inside = at("2006-04-10", 3);
  const outside = Array.from({ length: 200 }, (_, i) => ({
    ...at("2013-01-01", 0),
    time: Date.parse("2013-01-01") + i * 3_600_000,
  }));
  assert.doesNotThrow(() => checkCorunaQuality([inside, ...outside]));
  assert.doesNotThrow(() =>
    checkCorunaQuality([inside, ...outside, at("2006-04-11", 4, 4), at("2014-01-01", 4, 4)]),
  );
  assert.throws(() => checkCorunaQuality([at("2006-04-10", 0), ...outside]), /clock windows/);
  assert.throws(
    () => checkCorunaQuality([inside, ...outside.map((o) => ({ ...o, flag: 3 as const }))]),
    /outside its clock windows/,
  );
  assert.throws(() => checkCorunaQuality([inside, ...outside, at("2013-06-01", 0, 3)]), /source/);
  assert.throws(() => checkCorunaQuality([]), /no ign\/ACOR1/);
});

it("checks each IGN clock window's flags and its offset against another gauge", async () => {
  const { CORUNA_CLOCK_WINDOWS } = await import("../src/sources/ign/check.ts");
  for (const w of CORUNA_CLOCK_WINDOWS) {
    const e = errata.find((e) => e.id === w.id)!;
    let flagged = true;
    let shift: number = w.lag;
    const store = {
      levels: async (station: string, since: string, until: string) => {
        const reference = station !== "ign/ACOR1";
        const out = [];
        for (let time = Date.parse(since); time < Date.parse(until); time += 3_600_000) {
          const spanned = time >= Date.parse(w.since) && time < Date.parse(w.until);
          out.push({
            time,
            // The reference leads or lags by the recorded offset.
            level: Math.sin(
              (((time - (reference ? 0 : -shift * 60_000)) / 3_600_000) * 2 * Math.PI) / 12.42,
            ),
            flag: !reference && flagged && spanned ? 3 : 0,
            source_flag: 0,
            epoch: 1,
          });
        }
        return out;
      },
    } as StoreReader;
    await e.check!(store, e);
    flagged = false;
    await assert.rejects(e.check!(store, e), /aren't suspect/, w.id);
    flagged = true;
    shift = 0;
    await assert.rejects(e.check!(store, e), /no longer shows/, w.id);
  }
});

it("requalifies direct and copied histories before publication", () => {
  const steps = migration.steps.map((s) => ("ingest" in s ? s.ingest : ""));
  for (const command of [
    "requalify ign ACOR1 2000 2025",
    "requalify cmems Coruna2TG 2019 2024",
    "requalify gesla coruna2tg-cor-esp-cmems 2019 2024",
  ]) {
    const index = steps.indexOf(command);
    assert.ok(index >= 0 && steps.indexOf("publish") > index, command);
  }
});

it("checks native-copy clock flags, their edges and independent controls", async () => {
  for (const [id, lag] of [
    ["cmems-coruna-clock-2020", -60],
    ["cmems-coruna-clock-2022", -20],
  ] as const) {
    const e = errata.find((e) => e.id === id)!;
    let inside = true,
      spill = false;
    let shift: number = lag;
    const store = {
      levels: async (station: string, since: string, until: string) => {
        const reference = station === "cmems/CorunaTG",
          step = reference ? 5 * 60000 : 3600000;
        const out = [];
        for (let time = Date.parse(since); time < Date.parse(until); time += step) {
          const inSpan = time >= Date.parse(e.since!) && time < Date.parse(e.until!);
          out.push({
            time,
            level: Math.sin(
              (((time + (reference ? 0 : shift * 60000)) / 3600000) * 2 * Math.PI) / 12.42,
            ),
            source_flag: 0,
            flag: reference ? 0 : inSpan ? (inside ? 3 : 0) : spill ? 3 : 0,
            epoch: 1,
          });
        }
        return out;
      },
    } as StoreReader;
    await e.check!(store, e);
    inside = false;
    await assert.rejects(e.check!(store, e), /aren't suspect/);
    inside = true;
    spill = true;
    await assert.rejects(e.check!(store, e), /outside the span/);
    spill = false;
    shift = 0;
    await assert.rejects(e.check!(store, e), /no longer shows/);
    const sparse = {
      levels: async (station: string, since: string, until: string) => {
        const reference = station === "cmems/CorunaTG",
          out = [];
        for (
          let time = Date.parse(since) + (reference ? 0 : -lag * 60000);
          time < Date.parse(until);
          time += 2 * 3600000
        )
          out.push({
            time,
            level: Math.sin(
              (((time + (reference ? 0 : lag * 60000)) / 3600000) * 2 * Math.PI) / 12.42,
            ),
            flag: reference
              ? 0
              : time >= Date.parse(e.since!) && time < Date.parse(e.until!)
                ? 3
                : 0,
            source_flag: 0,
            epoch: 1,
          });
        return out;
      },
    } as StoreReader;
    await assert.rejects(e.check!(sparse, e), /zero-lag control/);
  }
});
