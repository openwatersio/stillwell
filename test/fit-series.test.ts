import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Erratum } from "../src/errata.ts";
import {
  emptyInputs,
  errataIn,
  finalYear,
  readSeries,
  settledBefore,
  Unfit,
  type ReadContext,
} from "../src/fit/series.ts";
import {
  Flag,
  type Epoch,
  type Observation,
  type SourceMetadata,
  type StoredStation,
} from "../src/schema.ts";
import { readYearStats, writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import type { YearRow } from "../src/store/years.ts";

const at = (iso: string) => Date.parse(`${iso}Z`);

const finalizing = { id: "test", finalizes: true } as unknown as SourceMetadata;
const settling = (months?: number) =>
  ({ id: "test", finalizes: false, settles_after_months: months }) as unknown as SourceMetadata;

const epoch = (
  id: number,
  since: string | null,
  until: string | null,
  to_current: number | null = 0,
  state: Epoch["state"] = until ? "closed" : "open",
): Epoch => ({
  id,
  datum: "NAVD88",
  since,
  until,
  seen: null,
  reference: null,
  reference_since: null,
  datums: {},
  to_current,
  state,
});

const station = (epochs: Epoch[], extra: object = {}) =>
  ({
    id: "test/1",
    source: "test",
    source_id: "1",
    datum: "NAVD88",
    epochs,
    ...extra,
  }) as unknown as StoredStation;

const erratum = (e: Partial<Erratum>): Erratum => ({
  id: "test-e",
  source: "test",
  stations: null,
  since: null,
  until: null,
  error: "",
  handling: "kept",
  response: "",
  evidence: null,
  reported: null,
  report: null,
  fit: null,
  ...e,
});

const obs = (time: string, level: number, flag: Flag = Flag.good): Observation => ({
  time: at(time),
  level,
  flag,
  source_flag: flag,
});

/** A temp store whose year files are written and counted in a years map as the store would. */
function fixture() {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-series-"));
  const years = new Map<string, YearRow>();
  const put = async (rows: Observation[], year: number, epochId = 1, count = true) => {
    const file = seriesPath(store, "levels", "test", "1", year, epochId);
    await writeObservations(file, rows, "NAVD88");
    if (!count) return;
    const stats = (await readYearStats([file])).get(file)!;
    years.set(`test/1 ${epochId} ${year}`, { id: "test/1", epoch: epochId, year, ...stats });
  };
  const context = (overrides: Partial<ReadContext> = {}): ReadContext => ({
    store,
    metadata: finalizing,
    years,
    errata: [],
    now: new Date(at("2026-11-25T00:00")),
    inputs: emptyInputs(),
    ...overrides,
  });
  return { store, years, put, context };
}

const period = (start: string, end: string) => ({ start: at(start), end: at(end) });
const y2024 = period("2024-01-01T00:00", "2025-01-01T00:00");
const open = station([epoch(1, null, null)]);

describe("settledBefore", () => {
  const settled = (metadata: SourceMetadata, now: string) =>
    settledBefore(metadata, new Date(at(now)))?.toISOString() ?? null;

  it("is null for a source that finalizes", () => {
    assert.equal(settled(finalizing, "2026-11-25T00:00"), null);
  });

  it("is the start of the latest year that ended the revision window ago", () => {
    assert.equal(settled(settling(12), "2026-11-25T00:00"), "2025-01-01T00:00:00.000Z");
    assert.equal(settled(settling(12), "2026-01-01T00:00"), "2025-01-01T00:00:00.000Z");
    assert.equal(settled(settling(12), "2025-12-31T00:00"), "2024-01-01T00:00:00.000Z");
    assert.equal(settled(settling(6), "2026-07-01T00:00"), "2026-01-01T00:00:00.000Z");
    assert.equal(settled(settling(6), "2026-06-30T00:00"), "2025-01-01T00:00:00.000Z");
  });

  it("throws Unfit where the source states no revision window", () => {
    assert.throws(() => settledBefore(settling(), new Date(at("2026-11-25T00:00"))), Unfit);
  });
});

describe("finalYear", () => {
  const now = new Date(at("2026-11-25T00:00"));
  const row = (id: string, year: number, preliminary: number, epochId = 1): [string, YearRow] => [
    `${id} ${epochId} ${year}`,
    { id, epoch: epochId, year, hours: 100, flags: [100, 0, preliminary, 0, 0], version: "v" },
  ];
  const marker = (id: string): [string, YearRow] => [
    `${id} null null`,
    { id, epoch: null, year: null },
  ];

  it("is the year before settledBefore for a source that never finalizes", () => {
    assert.equal(finalYear(settling(12), new Map(), now), 2024);
  });

  it("is the latest year in which most stations have no preliminary values", () => {
    const years = new Map([
      row("test/a", 2023, 0),
      row("test/b", 2023, 0),
      row("test/c", 2023, 0),
      row("test/a", 2024, 0),
      row("test/b", 2024, 0),
      row("test/c", 2024, 5),
      row("test/a", 2025, 5),
      row("test/b", 2025, 5),
      row("test/c", 2025, 0),
    ]);
    assert.equal(finalYear(finalizing, years, now), 2024);
  });

  it("counts a station's preliminary values over all its epochs", () => {
    const years = new Map([
      row("test/a", 2024, 0, 1),
      row("test/a", 2024, 3, 2),
      row("test/b", 2024, 4),
      row("test/a", 2023, 0),
      row("test/b", 2023, 0),
    ]);
    assert.equal(finalYear(finalizing, years, now), 2023);
  });

  it("ignores a station marked as being written", () => {
    const years = new Map([
      row("test/a", 2024, 0),
      row("test/b", 2024, 0),
      row("test/c", 2024, 9),
      row("test/d", 2024, 9),
      row("test/c", 2023, 9),
      row("test/d", 2023, 9),
      row("test/a", 2023, 0),
      marker("test/c"),
      marker("test/d"),
    ]);
    assert.equal(finalYear(finalizing, years, now), 2024);
  });

  it("never returns the current year", () => {
    const years = new Map([row("test/a", 2026, 0), row("test/a", 2025, 0)]);
    assert.equal(finalYear(finalizing, years, now), 2025);
  });

  it("throws Unfit where no year qualifies", () => {
    assert.throws(() => finalYear(finalizing, new Map(), now), Unfit);
    assert.throws(() => finalYear(finalizing, new Map([row("test/a", 2024, 7)]), now), Unfit);
    assert.throws(() => finalYear(finalizing, new Map([row("test/a", 2026, 0)]), now), Unfit);
  });
});

describe("errataIn", () => {
  const own = { id: "test/1", source: "test" };
  const p = period("2024-01-01T00:00", "2025-01-01T00:00");
  const ids = (errata: Erratum[]) => errataIn(errata, own, p).map((e) => e.id);

  it("picks the errata of the station or source that overlap the period", () => {
    const errata = [
      erratum({ id: "listed", stations: ["test/1"], since: "2024-06-01", until: "2024-06-05" }),
      erratum({ id: "source", since: "2024-02-01", until: "2024-02-02" }),
      erratum({ id: "other", stations: ["test/2"], since: "2024-06-01", until: "2024-06-05" }),
    ];
    assert.deepEqual(ids(errata), ["listed", "source"]);
  });

  it("leaves out one that ends where the period starts or starts where it ends", () => {
    const errata = [
      erratum({ id: "before", since: "2023-12-01", until: "2024-01-01" }),
      erratum({ id: "after", since: "2025-01-01", until: "2025-02-01" }),
      erratum({ id: "last-day", since: "2024-12-31", until: "2025-01-01" }),
    ];
    assert.deepEqual(ids(errata), ["last-day"]);
  });

  it("treats an open end as overlapping", () => {
    const errata = [
      erratum({ id: "open", since: null, until: null }),
      erratum({ id: "until-only", since: null, until: "2024-03-01" }),
      erratum({ id: "since-only", since: "2024-03-01", until: null }),
      erratum({ id: "before", since: null, until: "2024-01-01" }),
      erratum({ id: "after", since: "2025-01-01", until: null }),
    ];
    assert.deepEqual(ids(errata), ["open", "until-only", "since-only"]);
  });
});

describe("readSeries", () => {
  it("reads only values on the hour, sorted", async () => {
    const f = fixture();
    await f.put(
      [
        obs("2024-01-01T02:00", 3),
        obs("2024-01-01T00:30", 9),
        obs("2024-01-01T01:00", 2),
        obs("2024-01-01T01:30", 9),
        obs("2024-01-01T00:00", 1),
      ],
      2024,
    );
    const got = await readSeries(open, y2024, "final", f.context());
    assert.deepEqual(got, [
      { time: at("2024-01-01T00:00"), level: 1 },
      { time: at("2024-01-01T01:00"), level: 2 },
      { time: at("2024-01-01T02:00"), level: 3 },
    ]);
  });

  // One value of each flag on day 1, before the QC start, and on day 5, after it; the level
  // names the day and flag.
  const flagged = async () => {
    const f = fixture();
    const rows = (day: string) =>
      [Flag.good, Flag.preliminary, Flag.suspect, Flag.bad, Flag.interpolated].map((flag) =>
        obs(`2024-01-${day}T0${flag}:00`, flag + Number(day) * 10, flag),
      );
    await f.put([...rows("01"), ...rows("05")], 2024);
    return f;
  };
  const qc = station([epoch(1, null, null)], { source_qc_start: "2024-01-03T00:00:00Z" });
  const levels = (samples: { level: number }[]) => samples.map((s) => s.level);

  it("takes good values as final, and preliminary ones before the QC start", async () => {
    const f = await flagged();
    assert.deepEqual(levels(await readSeries(qc, y2024, "final", f.context())), [10, 12, 50]);
  });

  it("takes only good values as final from a station with no QC start", async () => {
    const f = await flagged();
    assert.deepEqual(levels(await readSeries(open, y2024, "final", f.context())), [10, 50]);
  });

  it("takes good and preliminary values as measured", async () => {
    const f = await flagged();
    assert.deepEqual(
      levels(await readSeries(qc, y2024, "measured", f.context())),
      [10, 12, 50, 52],
    );
  });

  it("moves each epoch's levels to the current datum and keeps to its span", async () => {
    const f = fixture();
    const epochs = [
      epoch(1, null, "2021-01-01T00:00:00Z", 0.5),
      epoch(2, "2021-01-01T00:00:00Z", "2022-01-01T00:00:00Z", 0),
      epoch(3, "2022-01-01T00:00:00Z", null, null),
    ];
    await f.put([obs("2020-12-31T22:00", 4), obs("2020-12-31T23:00", 1)], 2020, 1);
    // Epoch 2 holds nothing before 2021, so its value then is outside its span.
    await f.put([obs("2020-12-31T23:00", 99), obs("2021-01-01T00:00", 2)], 2021, 2);
    await f.put([obs("2022-01-01T00:00", 7)], 2022, 3);
    const got = await readSeries(
      station(epochs),
      period("2020-12-31T00:00", "2023-01-01T00:00"),
      "final",
      f.context(),
    );
    assert.deepEqual(got, [
      { time: at("2020-12-31T22:00"), level: 4.5 },
      { time: at("2020-12-31T23:00"), level: 1.5 },
      { time: at("2021-01-01T00:00"), level: 2 },
    ]);
  });

  it("lets another epoch's value win over a rejected epoch's at the same time", async () => {
    for (const rejected of [1, 2]) {
      const f = fixture();
      const epochs = [1, 2].map((id) =>
        epoch(id, null, null, 0, id === rejected ? "rejected" : "open"),
      );
      await f.put([obs("2024-01-01T00:00", 1)], 2024, 1);
      await f.put([obs("2024-01-01T00:00", 2), obs("2024-01-01T01:00", 3)], 2024, 2);
      const got = await readSeries(station(epochs), y2024, "final", f.context());
      assert.deepEqual(levels(got), rejected === 1 ? [2, 3] : [1, 3]);
    }
  });

  describe("errata", () => {
    const read = async (errata: Erratum[]) => {
      const f = fixture();
      await f.put(
        [1, 2, 3, 4, 5].map((d) => obs(`2024-01-0${d}T00:00`, d)),
        2024,
      );
      return levels(await readSeries(open, y2024, "final", f.context({ errata })));
    };
    const span = { since: "2024-01-02", until: "2024-01-04" };

    it("drops the values of a kept erratum decided as drop", async () => {
      assert.deepEqual(await read([erratum({ ...span, fit: "drop" })]), [1, 4, 5]);
    });

    it("keeps the values of a kept erratum decided as keep", async () => {
      assert.deepEqual(await read([erratum({ ...span, fit: "keep" })]), [1, 2, 3, 4, 5]);
    });

    it("throws Unfit naming a kept erratum with no decision", async () => {
      await assert.rejects(
        read([erratum({ ...span, id: "test-undecided", fit: null })]),
        (e: Error) => e instanceof Unfit && e.message.includes("test-undecided"),
      );
    });

    it("reads past an undecided erratum with another handling or outside the period", async () => {
      assert.deepEqual(
        await read([
          erratum({ ...span, id: "test-flagged", handling: "flagged", fit: null }),
          erratum({ id: "test-later", since: "2026-01-01", until: "2026-01-02", fit: null }),
        ]),
        [1, 2, 3, 4, 5],
      );
    });
  });

  describe("a source that never finalizes", () => {
    const setup = async () => {
      const f = fixture();
      await f.put([obs("2024-06-01T00:00", 1, Flag.preliminary)], 2024);
      await f.put([obs("2025-06-01T00:00", 2, Flag.preliminary)], 2025);
      return f;
    };
    const later = period("2025-01-01T00:00", "2026-01-01T00:00");

    it("reads preliminary values as final up to the settled instant", async () => {
      const f = await setup();
      const context = f.context({ metadata: settling(12) });
      assert.deepEqual(levels(await readSeries(open, y2024, "final", context)), [1]);
      assert.equal(context.inputs.settled_before, "2025-01-01T00:00:00.000Z");
    });

    it("throws Unfit for final values after it, but reads them as measured", async () => {
      const f = await setup();
      await assert.rejects(
        readSeries(open, later, "final", f.context({ metadata: settling(12) })),
        Unfit,
      );
      const got = await readSeries(open, later, "measured", f.context({ metadata: settling(12) }));
      assert.deepEqual(levels(got), [2]);
    });
  });

  it("throws Unfit for a station whose year files are being written", async () => {
    const f = fixture();
    await f.put([obs("2024-01-01T00:00", 1)], 2024);
    f.years.set("test/1 null null", { id: "test/1", epoch: null, year: null });
    await assert.rejects(readSeries(open, y2024, "final", f.context()), Unfit);
  });

  it("reads nothing from a year the years file doesn't count", async () => {
    const f = fixture();
    await f.put([obs("2023-06-01T00:00", 1)], 2023, 1, false);
    await f.put([obs("2024-06-01T00:00", 2)], 2024);
    const got = await readSeries(
      open,
      period("2023-01-01T00:00", "2025-01-01T00:00"),
      "final",
      f.context(),
    );
    assert.deepEqual(got, [{ time: at("2024-06-01T00:00"), level: 2 }]);
  });

  it("records what it read in the inputs", async () => {
    const f = fixture();
    await f.put([obs("2023-12-31T23:00", 1)], 2023);
    await f.put([obs("2024-01-01T00:00", 2)], 2024);
    const touching = erratum({
      id: "test-t",
      since: "2024-02-01",
      until: "2024-02-03",
      fit: "keep",
    });
    const elsewhere = erratum({ id: "test-x", stations: ["test/2"], since: "2024-02-01" });
    const context = f.context({ errata: [touching, elsewhere] });
    await readSeries(
      station([epoch(1, null, null, 0.25)], { source_qc_start: "2020-01-01T00:00:00Z" }),
      period("2023-01-01T00:00", "2025-01-01T00:00"),
      "final",
      context,
    );
    const { inputs } = context;
    assert.deepEqual(inputs.versions, {
      "1 2023": f.years.get("test/1 1 2023")!.version,
      "1 2024": f.years.get("test/1 1 2024")!.version,
    });
    assert.deepEqual(inputs.errata, {
      "test-t": { handling: "kept", since: "2024-02-01", until: "2024-02-03", fit: "keep" },
    });
    assert.equal(inputs.source_qc_start, "2020-01-01T00:00:00Z");
    assert.equal(inputs.settled_before, null);
    assert.deepEqual(
      inputs.epochs.map((e) => [e.id, e.to_current, e.state]),
      [[1, 0.25, "open"]],
    );
  });
});
