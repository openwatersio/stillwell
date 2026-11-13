// What QC's rules and `judge` do, kept beside the `RULES` and `JUDGE` they
// were recorded under, so a change to either can't land without its version.
// Regenerating refuses a changed output under an unchanged version. After a bump:
//
//   UPDATE_RULES=1 node --test test/rules.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { qc } from "../src/qc.ts";
import { qcFor } from "../src/store/recent.ts";
import { JUDGE, RULES, RULES_HISTORY, judge, reaches } from "../src/store/analysis.ts";
import { Flag, type Observation, type StoredStation } from "../src/schema.ts";

const FIXTURE = new URL("fixtures/rules.json", import.meta.url);
const MIN = 60_000;
const HOUR = 3_600_000;
const T = Date.UTC(2025, 0, 1);
const M2_H = 12.4206012;

const round = (x: number) => Math.round(x * 1e4) / 1e4;
const series = (n: number, step: number, level: (h: number, i: number) => number): Observation[] =>
  Array.from({ length: n }, (_, i) => ({
    time: T + i * step,
    level: round(level((i * step) / HOUR, i)),
    flag: Flag.good,
  }));
const tide = (a: number) => (h: number) => a * Math.cos((2 * Math.PI * h) / M2_H);
const set = (rows: Observation[], from: number, to: number, level: (i: number) => number) => {
  for (let i = from; i < to; i++) rows[i]!.level = round(level(i));
  return rows;
};

/** Series for `qc`: the QC evaluation's synthetic cases and the `qc` tests' shapes. */
const QC_SERIES: Record<string, () => Observation[]> = {
  "clean 2 m tide, 10 min": () => series(1000, 10 * MIN, tide(2)),
  "spike, flatline and far level": () => {
    const rows = series(1000, 10 * MIN, tide(2));
    rows[100]!.level += 0.6;
    set(rows, 500, 540, () => 1.5);
    rows[800]!.level = 15;
    return rows;
  },
  "harbor drying to its floor half the time": () =>
    series(1000, 10 * MIN, (h) => Math.max(7.3, 7.3 + 6 * Math.cos((2 * Math.PI * h) / M2_H))),
  "held reading while the tide moves": () =>
    set(series(1000, 10 * MIN, tide(2)), 300, 308, () => -7.45),
  "stuck 8 h dithering 1 mm, 6 min": () =>
    set(series(720, 6 * MIN, tide(1)), 240, 320, (i) => 0.42 + ((i % 3) - 1) * 0.001),
  "stuck 8 h dithering 3 mm, 6 min": () =>
    set(series(720, 6 * MIN, tide(1)), 240, 320, (i) => 0.42 + (i % 2) * 0.003),
  "equal values across a 60 h gap, hourly": () => {
    const rows = series(160, HOUR, (h) => 1 + 0.01 * Math.sin(h / 3));
    set(rows, 48, 50, () => 1.2345);
    set(rows, 110, 112, () => 1.2345);
    return rows.filter((_, i) => i < 50 || i >= 110);
  },
  "mixed 6 min and hourly with a spike": () => {
    const fine = series(14 * 240, 6 * MIN, tide(1));
    const start = fine.at(-1)!.time + HOUR;
    const hourly = series(7 * 24, HOUR, tide(1)).map((r) => ({ ...r, time: r.time - T + start }));
    hourly[100]!.level += 3;
    return [...fine, ...hourly];
  },
  "7-day surge of 1.2 m on a 0.1 m tide": () =>
    series(7 * 240, 6 * MIN, (h) => tide(0.1)(h) + 1.2 * Math.exp(-(((h - 120) / 10) ** 2) / 2)),
  "offset run of 4 h at -7 m, 5 min": () =>
    set(series(3 * 288, 5 * MIN, tide(1.6)), 360, 408, (i) => -7 + 0.05 * Math.sin(i)),
  // Long enough for the residual jump rule's tide fit, which needs 30 days of hourly values.
  "40 days with an offset run and a lone 0 m before a gap, 10 min": () => {
    const rows = set(
      series(40 * 144, 10 * MIN, tide(1.6)),
      2000,
      2024,
      (i) => -7 + 0.05 * Math.sin(i),
    );
    rows[4000]!.level = 0;
    return rows.filter((_, i) => i <= 4000 || i > 4006);
  },
  "lone 0 m before a 1 h gap, 15 min": () => {
    const rows = series(3 * 96, 15 * MIN, tide(3.4));
    rows[150]!.level = 0;
    return rows.filter((_, i) => i <= 150 || i > 154);
  },
  "steep 9 m tide with a 45 min gap, 15 min": () =>
    series(3 * 96, 15 * MIN, tide(4.5)).filter((_, i) => i < 151 || i > 153),
  "two NaN in a 7-day tide, 6 min": () => {
    const rows = series(7 * 240, 6 * MIN, tide(1));
    rows[300]!.level = NaN;
    rows[900]!.level = NaN;
    return rows;
  },
  "whole centimeters on a 9 cm tide held 8 h": () =>
    series(7 * 96, 15 * MIN, (h) => Math.round(100 * (h % 168 < 8 ? -0.09 : tide(0.09)(h))) / 100),
  "pooled river let up for 5 h": () =>
    series(53, HOUR, (h) => (h >= 24 && h < 29 ? 3.5 : 3) + (Math.round(h) % 2) * 0.01),
  "pool flat six days then rising": () =>
    series(7 * 24, HOUR, (h) => (h < 144 ? 4 + (Math.round(h) % 2) * 0.01 : 4 + (h - 144) / 12)),
  "a year of 30,479.695 m placeholders": () => series(500, 15 * MIN, () => 30479.695),
  "placeholders among a tide": () =>
    set(series(1000, 10 * MIN, tide(2)), 400, 500, (i) => (i % 2 ? -30479.695 : 3047.7)),
  "gauge 250 m up with a 300 m value": () => {
    const rows = series(200, 10 * MIN, (h) => 250 + tide(2)(h));
    rows[50]!.level = 300;
    return rows;
  },
};

/** Every option set `qcFor` gives, by kind, verdict and tide. */
const STATIONS = Object.fromEntries(
  ["coastal", "estuary", "river", "lake", null].flatMap((kind) =>
    [true, false, null].flatMap((tidal) =>
      [0.09, 1, null].map((tide_m) => [
        `${kind} tidal ${tidal} tide ${tide_m}`,
        JSON.stringify(qcFor({ kind, tidal, tide_m } as Parameters<typeof qcFor>[0])),
      ]),
    ),
  ),
);
const OPTIONS = [...new Set(Object.values(STATIONS))];

const station = (kind: string | null, extra: Partial<StoredStation> = {}) =>
  ({
    id: "test/1",
    source: "test",
    source_id: "1",
    datum: "NAVD88",
    datums: {},
    kind,
    epochs: [{ id: 1, datum: "NAVD88", state: "open" }],
    ...extra,
  }) as unknown as StoredStation;

/** Stations and series for `judge`: tides, still water, drained creeks and high water. */
const JUDGE_CASES: Record<string, () => [StoredStation, Observation[]]> = {
  "river with a 0.5 m tide": () => [station("river"), series(90 * 96, 15 * MIN, tide(0.5))],
  "pooled river with a flood": () => [
    station("river"),
    series(
      90 * 96,
      15 * MIN,
      (h) => 0.3 + 0.05 * Math.sin((2 * Math.PI * h) / 240) + (h > 1000 && h < 1500 ? 2 : 0),
    ),
  ],
  "river 20 days": () => [station("river"), series(20 * 96, 15 * MIN, tide(0.5))],
  "river 600 m up": () => [
    station("river", { datum: "GAGE", datums: { NAVD88: 600 } } as Partial<StoredStation>),
    series(90 * 96, 15 * MIN, tide(0.4)),
  ],
  "creek drained to a sill": () => [
    station("river"),
    series(90 * 96, 15 * MIN, (h) => (h % 168 < 8 ? -0.5 : tide(0.5)(h))),
  ],
  "coast held dry weekly": () => [
    station("coastal"),
    series(90 * 96, 15 * MIN, (h) => (h % 168 < 8 ? -0.5 : tide(0.5)(h))),
  ],
  "creek drained to a sill, dithering 1 mm": () => [
    station("river"),
    series(90 * 96, 15 * MIN, (h, i) =>
      h % 168 < 8 ? -0.5 + ((i % 3) - 1) * 0.001 : tide(0.5)(h),
    ),
  ],
  "whole-centimeter 12 cm tide held weekly": () => [
    station("river"),
    series(90 * 96, 15 * MIN, (h) => Math.round(100 * (h % 168 < 8 ? -0.12 : tide(0.12)(h))) / 100),
  ],
  "unlabeled whole-centimeter 12 cm tide held weekly": () => [
    station(null),
    series(90 * 96, 15 * MIN, (h) => Math.round(100 * (h % 168 < 8 ? -0.12 : tide(0.12)(h))) / 100),
  ],
  "estuary surge on a 10 cm tide": () => [
    station("estuary"),
    series(90 * 96, 15 * MIN, (h) => tide(0.1)(h) + (h > 1000 && h < 1168 ? 1.06 : 0)),
  ],
};

/** The rows QC flagged, as `index:flag`. */
const marks = (rows: Observation[]) =>
  rows.flatMap((r, i) => (r.flag === Flag.good ? [] : [`${i}:${r.flag}`])).join(" ");

/** Days judged with the days either side as context, as requalify and backfill judge years. */
const QC_CONTEXT: Record<string, () => [Observation[], Observation[]]> = {
  "spike, flatline, NaN and placeholder at the edges": () => {
    const rows = series(3 * 144, 10 * MIN, tide(2));
    rows[144]!.level += 0.6;
    set(rows, 260, 330, () => 1.5);
    rows[100]!.level = -30479.695;
    rows[300]!.level = NaN;
    return [rows.slice(144, 288), [...rows.slice(0, 144), ...rows.slice(288)]];
  },
};

function record() {
  const flags: Record<string, Record<string, string>> = {};
  for (const options of OPTIONS)
    flags[options] = Object.fromEntries(
      Object.entries(QC_SERIES).map(([name, rows]) => [
        name,
        marks(qc(rows(), JSON.parse(options))),
      ]),
    );
  for (const options of OPTIONS)
    for (const [name, make] of Object.entries(QC_CONTEXT)) {
      const [rows, context] = make();
      flags[options]![name] = marks(qc(rows, JSON.parse(options), context));
    }
  const verdicts = Object.fromEntries(
    Object.entries(JUDGE_CASES).map(([name, make]) => {
      const verdict = judge(...make());
      return [name, { ...verdict, tide_m: verdict.tide_m === null ? null : round(verdict.tide_m) }];
    }),
  );
  return {
    rules: RULES,
    judge: JUDGE,
    options: STATIONS,
    flags,
    verdicts,
    previous: undefined as Snapshot | undefined,
  };
}

/** The flags of a rules version, which the next keeps to check its own against. */
type Snapshot = {
  rules: string;
  options: Record<string, string>;
  flags: Record<string, Record<string, string>>;
};

/** Flags by option set and case, as one record. */
const flat = (flags: Record<string, Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(flags).flatMap(([options, cases]) =>
      Object.entries(cases).map(([name, marks]) => [`${options} ${name}`, marks]),
    ),
  );

/** Both records cut to the cases they share, so adding a case needs no new version. */
const shared = <T>(a: Record<string, T>, b: Record<string, T>) =>
  [a, b].map((x, i) => Object.fromEntries(Object.entries(x).filter(([k]) => k in (i ? a : b)))) as [
    Record<string, T>,
    Record<string, T>,
  ];

describe("RULES and JUDGE", () => {
  it("keep every version, in the order they shipped", () => {
    const names = RULES_HISTORY.map((v) => v.rules);
    assert.equal(new Set(names).size, names.length, "A version name is used twice");
    // Rows in the store carry these; a version is only ever added at the end, and its rule never changes.
    assert.deepEqual(RULES_HISTORY.slice(0, 5), [
      { rules: "tidal-1", rule: null },
      { rules: "held-1", rule: null },
      { rules: "jumps-1", rule: null },
      { rules: "span-1", rule: null },
      { rules: "outliers-1", rule: "outliers" },
    ]);
  });

  it("change whenever what the rules do changes", () => {
    const now = record();
    const was = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof now;
    const regenerate =
      "then regenerate test/fixtures/rules.json with UPDATE_RULES=1 node --test test/rules.test.ts";
    const cases = (r: typeof now) => [
      Object.keys(Object.values(r.flags)[0]!),
      Object.keys(r.verdicts),
    ];
    if (!process.env.UPDATE_RULES)
      assert.deepEqual(cases(now), cases(was), `The cases changed: ${regenerate}`);
    if (was.rules === RULES) {
      assert.deepEqual(
        now.options,
        was.options,
        `qcFor's options changed: add a version to RULES_HISTORY in src/store/analysis.ts, ${regenerate}`,
      );
      assert.deepEqual(
        ...shared(flat(now.flags), flat(was.flags)),
        `QC's flags changed: add a version to RULES_HISTORY in src/store/analysis.ts, ${regenerate}`,
      );
    }
    if (was.judge === JUDGE)
      assert.deepEqual(
        ...shared(now.verdicts, was.verdicts),
        `judge's verdicts changed: bump JUDGE in src/store/analysis.ts, ${regenerate}`,
      );
    // The snapshot keeps the last version's flags, so every run checks that
    // flags changed since then only for the stations the versions since reach,
    // compared station by station, since a change to `qcFor` changes an option set's key too.
    const before =
      was.rules === RULES
        ? was.previous
        : { rules: was.rules, options: was.options, flags: was.flags };
    if (before) {
      assert.ok(
        RULES_HISTORY.some((v) => v.rules === before.rules),
        `The snapshot's ${before.rules} isn't in RULES_HISTORY`,
      );
      const since = RULES_HISTORY.slice(
        RULES_HISTORY.findIndex((v) => v.rules === before.rules) + 1,
      );
      if (since.every((v) => v.rule !== null))
        assert.deepEqual(
          now.options,
          before.options,
          `qcFor's options changed, which reaches any station: give the version a null rule in RULES_HISTORY`,
        );
      for (const [label, options] of Object.entries(now.options))
        if (!reaches(before.rules, JSON.parse(options)) && before.options[label])
          assert.deepEqual(
            ...shared(now.flags[options] ?? {}, before.flags[before.options[label]!] ?? {}),
            `QC's flags changed for ${label}, which no rule changed since ${before.rules} reaches: name the rule the change reaches in RULES_HISTORY, or null`,
          );
    }
    now.previous = before;
    if (process.env.UPDATE_RULES) writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n");
    else
      assert.deepEqual([was.rules, was.judge], [RULES, JUDGE], `A version changed: ${regenerate}`);
  });
});
