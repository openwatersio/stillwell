import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, HttpError, setTransport, type RequestOptions } from "../src/http.ts";
import { qcFor } from "../src/store/recent.ts";
import { qc } from "../src/qc.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as smhi from "../src/sources/smhi/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Requests made, with their options. */
let requests: [string, RequestOptions][] = [];

/** Answer requests from fixtures, by the first pattern the URL matches. */
function serve(routes: [RegExp, string | (() => string)][]): void {
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return typeof route[1] === "function" ? route[1]() : route[1];
  });
}

/** Arkö's archive and latest day, recorded at 01:39 UTC on 7 November 2026. */
const RECORDED = Date.parse("2026-11-07T01:39:00Z");
const arko: [RegExp, string][] = [
  [/2545\/period\/corrected-archive/, fixture("smhi-archive.csv")],
  [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
];

const iso = (t: number) => new Date(t).toISOString();

describe("smhi", () => {
  smhi.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
    smhi.forgetArchives();
    mock.timers.enable({ apis: ["Date"], now: RECORDED });
  });

  afterEach(() => {
    setTransport(fetchText);
    mock.timers.reset();
  });

  it("keeps a calm Baltic day's held centimeter good, but not a held millimeter", () => {
    // A week of hourly levels, `steps` to the meter, holding 0.4 m for `held` hourly values.
    const series = (held: number, steps: number) =>
      Array.from({ length: 7 * 24 }, (_, i) => ({
        time: Date.UTC(1960, 3, 25) + i * 3_600_000,
        level:
          i >= 48 && i < 48 + held
            ? 0.4
            : Math.round(steps * (0.22 + 0.08 * Math.sin(i / 10))) / steps,
        flag: Flag.good,
      }));
    // A tide gauge with a tide as small as Göteborg's, as SMHI's west coast has.
    const smallTide = { kind: "coastal", tidal: true, tide_m: 0.09 } as Station;
    const flags = (held: number, steps: number) =>
      qc(series(held, steps), qcFor(smallTide)).map((r) => r.flag);
    // Landsort's whole centimeters held one value for up to 34 hours on calm days.
    assert.ok(flags(48, 100).every((f) => f === Flag.good)); // 47 hours
    assert.equal(flags(49, 100)[60], Flag.suspect); // 48 hours: a stuck gauge
    // Since 2004 SMHI reports millimeters, which a calm day doesn't hold.
    assert.equal(flags(9, 1000)[50], Flag.suspect);
    // A few whole-centimeter changes around a long hold don't say which it is.
    const short = series(9, 100).slice(36, 66);
    assert.equal(qc(short, qcFor(smallTide))[15]!.flag, Flag.suspect);
    // Most gauges switched in the middle of 2004, so each hold is judged by its own weeks.
    const switched = [...series(30, 100), ...series(9, 1000)].map((r, i) => ({
      ...r,
      time: Date.UTC(2004, 5, 1) + i * 3_600_000,
    }));
    const marked = qc(switched, qcFor(smallTide));
    assert.equal(marked[60]!.flag, Flag.good);
    assert.equal(marked[7 * 24 + 50]!.flag, Flag.suspect);
  });

  it("lists every sea-level station with its record span", async () => {
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/period\/(latest-day|corrected-archive)/, fixture("smhi-latest-day.csv")],
    ]);
    const stations = await smhi.stations();
    assert.deepEqual(
      stations.map((s) => [s.id, s.status, s.live, s.kind, s.record_start, s.record_end]),
      [
        ["smhi/2088", "active", true, "coastal", "1886-12-01T00:00:00.000Z", null],
        ["smhi/2545", "active", true, "coastal", "2014-04-02T07:00:00.000Z", null],
        [
          "smhi/33092",
          "inactive",
          false,
          "estuary",
          "2010-10-20T08:00:00.000Z",
          "2013-05-15T13:00:00.000Z",
        ],
        ["smhi/33094", "active", true, "estuary", "2010-08-27T11:00:00.000Z", null],
      ],
    );
    const arkoStation = stations.find((s) => s.id === "smhi/2545")!;
    assert.equal(arkoStation.datum, "RH2000");
    assert.equal(arkoStation.country_code, "SE");
    assert.equal(arkoStation.interval_s, 3600);
    assert.equal(arkoStation.license, "CC-BY-4.0");
    assert.equal(arkoStation.attribution, "SMHI");
    assert.equal(requests[0]![1].fresh, true);
  });

  it("records where SMHI says its checks of each station start", async () => {
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      // Brofjorden's notes, which say its data before 1 July 2019 is unchecked, stand in for Lärjeholm's.
      [/33094\/period\/latest-day/, fixture("smhi-latest-day-brofjorden.csv")],
      [/33092\/period\/corrected-archive/, fixture("smhi-archive-closed.csv")],
      [/2088\/period\/latest-day/, () => fixture("smhi-latest-day.csv").slice(0, 600)],
      [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
    ]);
    const qcStarts = (list: smhi.SmhiStation[]) =>
      Object.fromEntries(list.map((s) => [s.id, s.source_qc_start]));
    const first = await smhi.stations();
    assert.deepEqual(qcStarts(first), {
      // Notes cut short say nothing either way, so the station has none until they don't.
      "smhi/2088": undefined,
      "smhi/2545": null,
      "smhi/33092": null,
      "smhi/33094": "2019-07-01T00:00:00Z",
    });
    // A closed station's archive is read once; a failed or cut-short read keeps what was known.
    requests = [];
    const previous = first.map((s) =>
      s.id === "smhi/2088" || s.id === "smhi/2545"
        ? { ...s, source_qc_start: "2019-07-01T00:00:00Z" }
        : s,
    ) as unknown as Station[];
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/2088\/period\/latest-day/, () => fixture("smhi-latest-day.csv").slice(0, 600)],
      [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
    ]);
    assert.deepEqual(qcStarts(await smhi.stations(previous)), {
      "smhi/2088": "2019-07-01T00:00:00Z",
      // Notes that stop giving a date are SMHI's word that it no longer holds.
      "smhi/2545": null,
      "smhi/33092": null,
      "smhi/33094": "2019-07-01T00:00:00Z",
    });
    assert.ok(!requests.some(([url]) => url.includes("33092/period/corrected-archive")));
  });

  /** Arkö's archive, its values replaced by hourly ones to the previous UTC midnight with the quality codes `runs` gives. */
  function archive(runs: [string, number][]): string {
    const lines = fixture("smhi-archive.csv").split("\n");
    const notes = lines.slice(7, 20).map((l) => l.split(";").slice(4).join(";"));
    const codes = runs.flatMap(([q, n]) => Array<string>(n).fill(q));
    const start = Date.parse("2026-11-07T00:00:00Z") - (codes.length - 1) * 3_600_000;
    const rows = codes.map(
      (q, i) =>
        `${iso(start + i * 3_600_000)
          .slice(0, 19)
          .replace("T", " ")};1.0;${q};0` + (notes[i] ? `;${notes[i]}` : ""),
    );
    return [...lines.slice(0, 7), ...rows].join("\n");
  }

  it("infers where SMHI's checks start at a station whose notes give no date", async () => {
    // Uddevalla's shape: years of O, then G but for a few hours, and this month's O.
    const uddevalla = archive([
      ["O", 2000],
      ["G", 60_000],
      ["O", 5],
      ["G", 8000],
      ["O", 200],
    ]);
    const routes: [RegExp, string | (() => string)][] = [
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/33094\/period\/latest-day/, fixture("smhi-latest-day-brofjorden.csv")],
      [/33092\/period\/corrected-archive/, fixture("smhi-archive-closed.csv")],
      [/2088\/period\/latest-day/, () => fixture("smhi-latest-day.csv").slice(0, 600)],
      [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
      [/2545\/period\/corrected-archive/, uddevalla],
    ];
    serve(routes);
    const qcStarts = (list: smhi.SmhiStation[]) =>
      Object.fromEntries(
        list.map((s) => [
          s.id,
          [s.source_qc_start, s.source_qc_start_inferred, s.inferred_qc_start],
        ]),
      );
    const first = await smhi.stations();
    assert.deepEqual(qcStarts(first), {
      "smhi/2088": [undefined, undefined, undefined],
      "smhi/2545": ["2019-01-26T04:00:00Z", true, "2019-01-26T04:00:00Z"],
      // All O, so nothing marks where checks start.
      "smhi/33092": [null, null, null],
      // A stated date takes the place of an inferred one, and needs no archive.
      "smhi/33094": ["2019-07-01T00:00:00Z", false, undefined],
    });
    assert.ok(!requests.some(([url]) => url.includes("33094/period/corrected-archive")));
    // The answer is kept, so the archive isn't read again.
    requests = [];
    const second = await smhi.stations(first as unknown as Station[]);
    assert.deepEqual(qcStarts(second), qcStarts(first));
    assert.ok(!requests.some(([url]) => url.includes("2545/period/corrected-archive")));
  });

  it("infers nothing from an archive cut short, and reads it again", async () => {
    const whole = archive([
      ["O", 2000],
      ["G", 60_000],
    ]);
    let text = whole.slice(0, whole.length / 2);
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
      [/2545\/period\/corrected-archive/, () => text],
    ]);
    const first = await smhi.stations();
    const arko = (list: smhi.SmhiStation[]) => list.find((s) => s.id === "smhi/2545")!;
    assert.equal(arko(first).source_qc_start, null);
    assert.ok(!("inferred_qc_start" in arko(first)));
    text = whole;
    const second = await smhi.stations(first as unknown as Station[]);
    assert.equal(arko(second).inferred_qc_start, "2020-01-03T01:00:00Z");
  });

  it("reads a closed station's archive again for a date a list kept without its label", async () => {
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/33092\/period\/corrected-archive/, fixture("smhi-archive-closed.csv")],
    ]);
    // A build that predates the label drops it, though the date was inferred.
    const previous = [
      { id: "smhi/33092", source_qc_start: "2010-01-01T00:00:00Z" },
    ] as unknown as Station[];
    const closed = (await smhi.stations(previous)).find((s) => s.id === "smhi/33092")!;
    assert.ok(requests.some(([url]) => url.includes("33092/period/corrected-archive")));
    // Its notes state no date, so the date isn't passed off as stated.
    assert.equal(closed.source_qc_start, null);
    assert.equal(closed.source_qc_start_inferred, null);
  });

  it("keeps an unlabeled date unlabeled until a read settles it", async () => {
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/2545\/period\/latest-day/, () => fixture("smhi-latest-day.csv").slice(0, 600)],
    ]);
    const previous = [
      { id: "smhi/2545", source_qc_start: "2010-01-01T00:00:00Z" },
      { id: "smhi/33092", source_qc_start: "2010-01-01T00:00:00Z" },
    ] as unknown as Station[];
    const list = await smhi.stations(previous);
    // Arkö's notes are cut short, and 33092's archive fails.
    for (const id of ["smhi/2545", "smhi/33092"]) {
      const station = list.find((s) => s.id === id)!;
      assert.equal(station.source_qc_start, "2010-01-01T00:00:00Z");
      assert.ok(!("source_qc_start_inferred" in station), id);
    }
  });

  it("keeps an unlabeled date when its notes state none and its archive fails", async () => {
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
    ]);
    const previous = [
      { id: "smhi/2545", source_qc_start: "2010-01-01T00:00:00Z" },
    ] as unknown as Station[];
    const arko = (await smhi.stations(previous)).find((s) => s.id === "smhi/2545")!;
    assert.equal(arko.source_qc_start, "2010-01-01T00:00:00Z");
    assert.ok(!("source_qc_start_inferred" in arko));
  });

  it("infers again when SMHI's notes stop giving a date", async () => {
    serve([
      [/parameter\/6\.json/, fixture("smhi-stations.json")],
      [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
      [
        /2545\/period\/corrected-archive/,
        archive([
          ["O", 2000],
          ["G", 60_000],
        ]),
      ],
    ]);
    // An answer kept from before SMHI stated a date may predate checks it has made since.
    const previous = [
      {
        id: "smhi/2545",
        source_qc_start: "2019-07-01T00:00:00Z",
        source_qc_start_inferred: false,
        inferred_qc_start: "2010-01-01T00:00:00Z",
      },
    ] as unknown as Station[];
    const arko = (await smhi.stations(previous)).find((s) => s.id === "smhi/2545")!;
    assert.equal(arko.source_qc_start, "2020-01-03T01:00:00Z");
    assert.equal(arko.source_qc_start_inferred, true);
  });

  it("infers no QC start from G values that don't mark checks starting", () => {
    const start = Date.parse("2010-01-01T00:00:00Z");
    const values = (runs: [Flag, number][]) =>
      runs
        .flatMap(([flag, n]) => Array<Flag>(n).fill(flag))
        .map((flag, i) => ({ time: start + i * 3_600_000, level: 0, flag }));
    const { good, preliminary } = Flag;
    // The first G after a month or more of values that aren't.
    assert.equal(
      smhi.inferQcStart(
        values([
          [preliminary, 720],
          [good, 100_000],
        ]),
        RECORDED,
      ),
      "2010-01-31T00:00:00Z",
    );
    // Less than a month isn't a gap in checking.
    assert.equal(
      smhi.inferQcStart(
        values([
          [preliminary, 719],
          [good, 100_000],
        ]),
        RECORDED,
      ),
      null,
    );
    // A run that ends within the last year may still be checked, as Barsebäck's Y.
    assert.equal(
      smhi.inferQcStart(
        values([
          [preliminary, 720],
          [good, 140_000],
          [preliminary, 2000],
          [good, 1000],
        ]),
        RECORDED,
      ),
      "2010-01-31T00:00:00Z",
    );
    // O mixed in after G, as at Flinten 16: one hour in ten isn't checked.
    const mixed = Array.from({ length: 10_000 }, (): [Flag, number][] => [
      [good, 9],
      [preliminary, 1],
    ]).flat();
    assert.equal(smhi.inferQcStart(values([[preliminary, 720], ...mixed]), RECORDED), null);
    // A gap in the values across the year's edge keeps the start before it.
    const gapped = [
      ...values([
        [preliminary, 720],
        [good, 100_000],
        [preliminary, 720],
      ]),
      { time: RECORDED - 200 * 86_400_000, level: 0, flag: good },
    ];
    assert.equal(smhi.inferQcStart(gapped, RECORDED), "2010-01-31T00:00:00Z");
    // A short G spell just before the year's edge leaves too little to judge by.
    const spell = [
      ...values([[preliminary, 130_000]]),
      { time: RECORDED - 366 * 86_400_000, level: 0, flag: good },
    ];
    assert.equal(smhi.inferQcStart(spell, RECORDED), null);
    // All O, or no gap at all.
    assert.equal(smhi.inferQcStart(values([[preliminary, 100_000]]), RECORDED), null);
    assert.equal(smhi.inferQcStart(values([[good, 100_000]]), RECORDED), null);
  });

  it("stops reading stations' notes when SMHI refuses them", async () => {
    setTransport(async (url) => {
      if (/parameter\/6\.json/.test(url)) return fixture("smhi-stations.json");
      throw new HttpError(`GET ${url} returned 403`, "");
    });
    await assert.rejects(smhi.stations(), / returned 403/);
  });

  it("takes no QC start from a note whose date isn't one", () => {
    const note = (date: string) => `;;Data före ${date} är ej kvalitetskontrollerad`;
    assert.equal(smhi.qcStartOf(note("2019-07-01")), "2019-07-01T00:00:00Z");
    assert.equal(smhi.qcStartOf(note("2019-13-45")), undefined);
    // Date rolls this over to 3 March rather than refusing it.
    assert.equal(smhi.qcStartOf(note("2019-02-31")), undefined);
  });

  it("refuses an empty station list", async () => {
    serve([[/parameter\/6\.json/, JSON.stringify({ station: [] })]]);
    await assert.rejects(smhi.stations(), /no sea-level stations/);
  });

  it("reads the last hours from latest-day alone, in meters at UTC", async () => {
    serve(arko);
    const levels = await smhi.levels(
      "2545",
      new Date(RECORDED - 12 * 3_600_000),
      new Date(RECORDED),
    );
    assert.deepEqual(
      requests.map(([url]) => url.replace(/.*station\//, "")),
      ["2545/period/latest-day/data.csv"],
    );
    assert.deepEqual(levels.at(-1), {
      time: Date.parse("2026-11-07T00:00:00Z"),
      level: 0.022,
      // G, but within the month SMHI may still correct.
      flag: Flag.preliminary,
    });
    assert.equal(levels.length, 11);
  });

  it("joins the archive and latest-day without gaps or repeats", async () => {
    serve(arko);
    const start = Date.parse("2026-11-04T00:00:00Z");
    const levels = await smhi.levels("2545", new Date(start), new Date(RECORDED + 3_600_000));
    assert.deepEqual(
      requests.map(([url]) => url.replace(/.*period\//, "")),
      ["corrected-archive/data.csv", "latest-day/data.csv"],
    );
    assert.equal(iso(levels[0]!.time), iso(start));
    assert.ok(levels.every((l, i) => i === 0 || l.time - levels[i - 1]!.time === 3_600_000));
    const latest = smhi.parse(fixture("smhi-latest-day.csv"), "2545", "RH2000");
    assert.equal(levels.at(-1)!.time, latest.last);
  });

  it("reads each archive once per process and slices it by range", async () => {
    serve(arko);
    await smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-05Z"));
    const day = await smhi.levels("2545", new Date("2026-11-05Z"), new Date("2026-11-06Z"));
    assert.equal(day.length, 24);
    assert.equal(requests.filter(([url]) => /corrected-archive/.test(url)).length, 1);
  });

  it("maps G to good, O and Y to preliminary, and others to suspect once SMHI's corrections are done", async () => {
    mock.timers.setTime(Date.parse("2027-03-01T00:00:00Z"));
    // Recorded archives hold no Y, so one value is changed to it here.
    const archive = fixture("smhi-archive.csv")
      .replace("2026-11-04 05:00:00;7.6;G", "2026-11-04 05:00:00;7.6;Y")
      .replace("2026-11-04 06:00:00;7.1;G", "2026-11-04 06:00:00;7.1;X");
    serve([[/corrected-archive/, archive]]);
    const levels = await smhi.levels("2545", new Date("2014-01-01Z"), new Date("2026-11-05Z"));
    const flags = Object.fromEntries(levels.map((l) => [iso(l.time), l.flag]));
    assert.equal(flags["2014-04-02T08:00:00.000Z"], Flag.preliminary);
    assert.equal(flags["2026-11-04T04:00:00.000Z"], Flag.good);
    assert.equal(flags["2026-11-04T05:00:00.000Z"], Flag.preliminary);
    assert.equal(flags["2026-11-04T06:00:00.000Z"], Flag.suspect);
    assert.equal(levels.find((l) => iso(l.time) === "2014-04-02T08:00:00.000Z")!.level, -0.006);
  });

  it("refuses values in another height system", async () => {
    serve([[/corrected-archive/, fixture("smhi-archive.csv").replace("RH2000", "RH70")]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-05Z")),
      /measured from RH70, not RH2000/,
    );
  });

  it("refuses a stale archive whose own end note matches its last row", async () => {
    const text = fixture("smhi-archive.csv");
    // A copy built on 5 November: its rows and its note end together.
    const stale = text
      .slice(0, text.indexOf("2026-11-05 01:00:00"))
      .replace("t.o.m.) = 2026-11-07 01:00:00", "t.o.m.) = 2026-11-05 01:00:00");
    serve([[/corrected-archive/, stale]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-07Z")),
      /archive ends at 2026-11-05T00:00:00.000Z, before 2026-11-06T00:00:00/,
    );
    // A closed station's archive only has to reach the end the list gives.
    smhi.forgetArchives();
    const levels = await smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-06Z"), {
      record_end: "2026-11-05T01:00:00.000Z",
    });
    assert.ok(levels.length);
  });

  it("reads a closed station's final archive whose last hours have no values", async () => {
    // Landsort's archive ends at 09:00, though its note and the list give 12:00.
    const text = fixture("smhi-archive.csv");
    const final = text.slice(0, text.indexOf("2026-11-05 01:00:00"));
    const range = [new Date("2026-11-04Z"), new Date("2026-11-06Z")] as const;
    serve([[/corrected-archive/, final]]);
    const levels = await smhi.levels("2545", ...range, { record_end: "2026-11-05T03:00:00.000Z" });
    assert.ok(levels.length);
    // A stale copy's note ends with its own rows, so it gets only the hour's slack.
    smhi.forgetArchives();
    serve([
      [
        /corrected-archive/,
        final.replace("t.o.m.) = 2026-11-07 01:00:00", "t.o.m.) = 2026-11-05 00:00:00"),
      ],
    ]);
    await assert.rejects(
      smhi.levels("2545", ...range, { record_end: "2026-11-05T03:00:00.000Z" }),
      /archive ends at 2026-11-05T00:00:00.000Z, before 2026-11-05T03:00:00/,
    );
    // More than six hours short is cut, whatever its note says.
    smhi.forgetArchives();
    serve([[/corrected-archive/, final]]);
    await assert.rejects(
      smhi.levels("2545", ...range, { record_end: "2026-11-05T07:00:00.000Z" }),
      /archive ends at 2026-11-05T00:00:00.000Z, before 2026-11-05T07:00:00/,
    );
    smhi.forgetArchives();
    assert.ok(
      (await smhi.levels("2545", ...range, { record_end: "2026-11-05T06:00:00.000Z" })).length,
    );
    // A station that closed at the previous UTC midnight gets the slack too.
    smhi.forgetArchives();
    serve([[/corrected-archive/, text.slice(0, text.indexOf("2026-11-05 22:00:00"))]]);
    assert.ok(
      (await smhi.levels("2545", ...range, { record_end: "2026-11-06T00:00:00.000Z" })).length,
    );
  });

  it("refuses an archive cut within its last day, read after the station's year", async () => {
    mock.timers.setTime(Date.parse("2027-03-01T00:00:00Z"));
    const text = fixture("smhi-archive.csv");
    const cut = text.slice(0, text.indexOf("2026-11-06 13:00:00"));
    serve([[/corrected-archive/, cut]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-01-01Z"), new Date("2027-01-01Z")),
      /archive ends at 2026-11-06T12:00:00.000Z, before 2027-02-28T00:00:00/,
    );
  });

  it("reads a few hours of latest-day whose notes stop before the height system", async () => {
    const short = fixture("smhi-latest-day.csv")
      .split("\n")
      .filter((l) => !/^2026-11-06 (0[3-9]|1\d|2\d)/.test(l))
      .map((l) => l.replace(/;;[^;]*Höjdsystem[^\r\n]*/, ";;"))
      .join("\n");
    serve([[/latest-day/, short]]);
    const levels = await smhi.levels(
      "2545",
      new Date(RECORDED - 12 * 3_600_000),
      new Date(RECORDED),
    );
    assert.ok(levels.length > 0);
  });

  it("refuses an archive that ends before SMHI says it runs to", async () => {
    const cut = fixture("smhi-archive.csv").split("\n").slice(0, -40).join("\n");
    serve([[/corrected-archive/, cut]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-07Z")),
      /archive ends at .* before 2026-11-06T00:00:00/,
    );
    // A range that ends inside what the archive holds loses nothing, so it's read.
    assert.ok((await smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-05Z"))).length);
  });

  it("asks for nothing outside a closed station's record", async () => {
    serve([[/33092\/period\/corrected-archive/, fixture("smhi-archive-closed.csv")]]);
    const span = {
      record_start: "2010-10-20T08:00:00.000Z",
      record_end: "2013-05-15T13:00:00.000Z",
    };
    assert.deepEqual(
      await smhi.levels("33092", new Date("2009-01-01Z"), new Date("2010-01-01Z"), span),
      [],
    );
    assert.deepEqual(
      await smhi.levels("33092", new Date("2014-01-01Z"), new Date("2015-01-01Z"), span),
      [],
    );
    assert.equal(requests.length, 0);
    const levels = await smhi.levels(
      "33092",
      new Date("2013-01-01Z"),
      new Date("2014-01-01Z"),
      span,
    );
    assert.equal(levels.length, 24);
    // A closed station's last year needs no latest-day.
    assert.equal(requests.length, 1);
  });

  it("never lets a cache keep a response", async () => {
    serve([[/parameter\/6\.json/, fixture("smhi-stations.json")], ...arko]);
    await smhi.stations();
    await smhi.levels("2545", new Date("2026-11-04Z"), new Date(RECORDED));
    // The list, each of its four stations' notes, Arkö's archive for its QC start, then its archive and latest day.
    assert.equal(requests.length, 8);
    assert.ok(requests.every(([, options]) => options.fresh === true && !options.keep));
  });
});
