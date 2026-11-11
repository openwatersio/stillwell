import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { DatumChanged } from "../src/epochs.ts";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as kartverket from "../src/sources/kartverket/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Answer requests from fixtures, by the first pattern the URL matches, recording each request. */
function serve(routes: [RegExp, string | (() => string)][]): [string, RequestOptions][] {
  const requests: [string, RequestOptions][] = [];
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return typeof route[1] === "function" ? route[1]() : route[1];
  });
  return requests;
}

afterEach(() => setTransport(fetchText));

// Fixtures were recorded on 7 November 2026; the adapters judge age against the clock.
beforeEach(() => mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-07T02:00:00Z") }));
afterEach(() => mock.timers.reset());

describe("kartverket", () => {
  kartverket.pacing.requestMs = 0;

  const listRoutes: [RegExp, string][] = [
    [/tide_request=stationlist/, fixture("kartverket-stations.xml")],
    ...["BGO", "NYA", "VAW"].flatMap((c): [RegExp, string][] => [
      [new RegExp(`tide_request=obstime&stationcode=${c}`), fixture(`kartverket-obstime-${c}.xml`)],
      [
        new RegExp(`tide_request=stationlevels&stationcode=${c}`),
        fixture(`kartverket-levels-${c}.xml`),
      ],
    ]),
  ];

  it("lists permanent gauges with their first observation and datum offsets", async () => {
    const requests = serve(listRoutes);
    const stations = await kartverket.stations();
    assert.deepEqual(
      stations.map((s) => s.id),
      ["kartverket/BGO", "kartverket/NYA", "kartverket/VAW"],
    );
    const bgo = stations[0]!;
    assert.equal(bgo.name, "Bergen");
    assert.equal(bgo.country_code, "NO");
    assert.equal(bgo.datum, "CD");
    assert.equal(bgo.interval_s, 600);
    assert.deepEqual(bgo.datums, { NN2000: -1.022, MSL: -0.952 });
    assert.equal(bgo.record_start, "1988-07-13T11:40:00.000Z");
    assert.equal(bgo.license, "CC-BY-4.0");
    assert.equal(bgo.commercial_use, true);
    const nya = stations[1]!;
    assert.equal(nya.name, "Ny-Ålesund");
    assert.equal(nya.country_code, "SJ");
    // Ny-Ålesund has no NN2000.
    assert.deepEqual(nya.datums, { MSL: -0.952 });
    assert.ok(requests.every(([, options]) => options.fresh));
  });

  it("lists a gauge whose details fail, without them", async () => {
    serve([
      [/tide_request=obstime&stationcode=NYA/, "<tide><error>No data</error></tide>"],
      [/tide_request=stationlevels&stationcode=NYA/, "<tide></tide>"],
      ...listRoutes,
    ]);
    const nya = (await kartverket.stations()).find((s) => s.id === "kartverket/NYA")!;
    assert.equal(nya.record_start, null);
    assert.deepEqual(nya.datums, {});
    assert.equal(nya.datum, "CD");
  });

  it("keeps a gauge's first observation when it can't be read, and sees chart datum move", async () => {
    serve(listRoutes);
    const previous = (await kartverket.stations()) as Station[];
    const timeout: [RegExp, string] = [
      /obstime&stationcode=VAW/,
      "<tide><error>timeout</error></tide>",
    ];
    serve([timeout, ...listRoutes]);
    const vaw = (await kartverket.stations(previous)).find((s) => s.id === "kartverket/VAW")!;
    assert.equal(vaw.record_start, (previous[2] as Partial<typeof vaw>).record_start);
    assert.ok(vaw.record_start);
    // Offsets that can't be read are kept from the lake's list.
    serve([
      [/stationlevels&stationcode=BGO/, "<tide><error>timeout</error></tide>"],
      ...listRoutes,
    ]);
    const kept = (await kartverket.stations(previous)).find((s) => s.id === "kartverket/BGO")!;
    assert.deepEqual(kept.datums, previous[0]!.datums);
    const bgo = previous[0]!;
    const moved = (nn2000: number) => ({ ...bgo, datums: { ...bgo.datums, NN2000: nn2000 } });
    assert.equal(kartverket.seriesChanged(bgo, moved(-1.03)), null);
    assert.match(
      kartverket.seriesChanged(bgo, moved(-1.1))!,
      /chart datum is now 1.1 m below NN2000, not 1.022/,
    );
  });

  it("refuses a backfill once chart datum has moved against NN2000", async () => {
    kartverket.forgetChecks();
    serve([
      [/stationlevels&stationcode=BGO/, fixture("kartverket-levels-BGO.xml")],
      [/stationdata/, fixture("kartverket-obs-1990.xml")],
    ]);
    const range = [new Date("1990-01-01T00:00Z"), new Date("1990-01-01T03:00Z")] as const;
    assert.ok((await kartverket.levels("BGO", ...range, { datums: { NN2000: -1.022 } })).length);
    kartverket.forgetChecks();
    await assert.rejects(
      kartverket.levels("BGO", ...range, { datums: { NN2000: -1.2 } }),
      /chart datum is now 1.022 m below NN2000, not 1.2; run ingest stations/,
    );
    // Hourly ingest's few hours too: compaction folds them into the year files. It's a
    // DatumChanged whose reference is the refresh's reason, so Ingest hourly asks for a
    // refresh and a change rejected in overrides.epochs matches its epoch.
    kartverket.forgetChecks();
    serve([
      [/stationlevels&stationcode=BGO/, fixture("kartverket-levels-BGO.xml")],
      [/stationdata/, fixture("kartverket-obs-recent.xml")],
    ]);
    const bgo = { datums: { NN2000: -1.2 } } as unknown as Station;
    const reason = kartverket.seriesChanged(bgo, { datums: { NN2000: -1.022 } } as never);
    await assert.rejects(
      kartverket.levels("BGO", new Date(Date.now() - 12 * 3_600_000), new Date(), {
        datums: { NN2000: -1.2 },
      }),
      (error) =>
        error instanceof DatumChanged && error.datum === "CD" && error.reference === reason,
    );
  });

  it("checks chart datum strictly for a backfill and leniently for hourly ingest", async () => {
    kartverket.forgetChecks();
    // The recorded recent values are from early on 5 November.
    mock.timers.setTime(Date.parse("2026-11-05T02:00:00Z"));
    serve([
      [/stationlevels/, "<tide><error>timeout</error></tide>"],
      [/stationdata/, fixture("kartverket-obs-recent.xml")],
    ]);
    const recent = await kartverket.levels(
      "BGO",
      new Date(Date.now() - 12 * 3_600_000),
      new Date(),
      {
        datums: { NN2000: -1.022 },
      },
    );
    assert.ok(recent.length);
    await assert.rejects(
      kartverket.levels("BGO", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T03:00Z"), {
        datums: { NN2000: -1.022 },
      }),
      /timeout/,
    );
    // An answer that gives no NN2000 can't say the datum stayed either.
    kartverket.forgetChecks();
    serve([
      [/stationlevels/, "<tide></tide>"],
      [/stationdata/, fixture("kartverket-obs-1990.xml")],
    ]);
    await assert.rejects(
      kartverket.levels("BGO", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T03:00Z"), {
        datums: { NN2000: -1.022 },
      }),
      /don't give NN2000/,
    );
    // A list with no baseline can't be checked, so a backfill waits for a refresh.
    kartverket.forgetChecks();
    serve([
      [/stationlevels&stationcode=BGO/, fixture("kartverket-levels-BGO.xml")],
      [/stationdata/, fixture("kartverket-obs-1990.xml")],
    ]);
    await assert.rejects(
      kartverket.levels("BGO", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T03:00Z"), {
        datums: {},
      }),
      /no NN2000 in the lake's list/,
    );
    // Ny-Ålesund has none to give, so it backfills unchecked.
    serve([
      [/stationlevels&stationcode=NYA/, fixture("kartverket-levels-NYA.xml")],
      [/stationdata/, fixture("kartverket-obs-1990.xml").replaceAll("BGO", "NYA")],
    ]);
    await kartverket.levels("NYA", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T03:00Z"), {
      datums: { MSL: -0.952 },
    });
  });

  it("counts a move of exactly a centimeter as none", () => {
    const at = (nn2000: number) => ({ datums: { NN2000: nn2000 } }) as unknown as Station;
    assert.equal(kartverket.seriesChanged(at(-1.022), at(-1.032)), null);
    assert.equal(kartverket.seriesChanged(at(-1.02), at(-1.03)), null);
    assert.ok(kartverket.seriesChanged(at(-1.022), at(-1.033)));
  });

  it("keeps NN2000 from the lake's list when a reply leaves it out", async () => {
    serve(listRoutes);
    const previous = (await kartverket.stations()) as Station[];
    const noNn2000 = fixture("kartverket-levels-BGO.xml").replace(
      /<reflevel[^>]*code="NN2000"[^>]*\/>/,
      "",
    );
    assert.notEqual(noNn2000, fixture("kartverket-levels-BGO.xml"));
    serve([[/stationlevels&stationcode=BGO/, noNn2000], ...listRoutes]);
    const bgo = (await kartverket.stations(previous)).find((s) => s.id === "kartverket/BGO")!;
    assert.equal(bgo.datums.NN2000, -1.022);
    // Other offsets aren't carried: a new epoch mustn't start with the old datum's.
    const noMsl = fixture("kartverket-levels-BGO.xml").replace(
      /<reflevel[^>]*code="MSL"[^>]*\/>/,
      "",
    );
    serve([[/stationlevels&stationcode=BGO/, noMsl], ...listRoutes]);
    const without = (await kartverket.stations(previous)).find((s) => s.id === "kartverket/BGO")!;
    assert.equal(without.datums.MSL, undefined);
  });

  it("refuses an empty station list", async () => {
    serve([[/stationlist/, "<tide><stationinfo></stationinfo></tide>"]]);
    await assert.rejects(kartverket.stations(), /listed no stations/);
  });

  it("reads levels in meters at UTC instants, asking for UTC", async () => {
    const requests = serve([[/stationdata/, fixture("kartverket-obs-1990.xml")]]);
    const values = await kartverket.levels(
      "BGO",
      new Date("1990-01-01T00:00Z"),
      new Date("1990-01-01T03:00Z"),
    );
    const url = new URL(requests[0]![0]);
    assert.equal(url.searchParams.get("tzone"), "0");
    assert.equal(url.searchParams.get("dst"), "0");
    assert.equal(url.searchParams.get("refcode"), "cd");
    assert.equal(url.searchParams.get("fromtime"), "1990-01-01T00:00");
    // The end is exclusive, though the API's `totime` isn't.
    assert.equal(values.length, 18);
    assert.deepEqual(values[0], {
      time: Date.parse("1990-01-01T00:00Z"),
      level: 1.393,
      flag: Flag.good,
    });
    assert.equal(values.at(-1)!.time, Date.parse("1990-01-01T02:50Z"));
  });

  it("flags values from the last year preliminary", async () => {
    serve([[/stationdata/, fixture("kartverket-obs-recent.xml")]]);
    const values = await kartverket.levels(
      "BGO",
      new Date("2026-11-05T00:00Z"),
      new Date("2026-11-05T02:00Z"),
    );
    assert.equal(values.length, 12);
    assert.ok(values.every((v) => v.flag === Flag.preliminary));
  });

  it("suspects an undocumented flag", async () => {
    serve([
      [/stationdata/, fixture("kartverket-obs-1990.xml").replace('flag="obs"', 'flag="xyz"')],
    ]);
    const [first] = await kartverket.levels(
      "BGO",
      new Date("1990-01-01T00:00Z"),
      new Date("1990-01-01T01:00Z"),
    );
    assert.equal(first!.flag, Flag.suspect);
  });

  it("refuses levels in another datum", async () => {
    serve([[/stationdata/, fixture("kartverket-obs-msl.xml")]]);
    await assert.rejects(
      kartverket.levels("BGO", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T00:30Z")),
      /measured from MSL, not CD/,
    );
  });

  it("fails on an error element", async () => {
    serve([[/stationdata/, fixture("kartverket-error.xml")]]);
    await assert.rejects(
      kartverket.levels("BGO", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T00:30Z")),
      /No stations found/,
    );
  });

  it("splits requests at UTC years and keeps to the station's record", async () => {
    const requests = serve([[/stationdata/, "<tide><stationdata></stationdata></tide>"]]);
    await kartverket.levels("BGO", new Date("1980-01-01T00:00Z"), new Date("1990-06-01T00:00Z"), {
      record_start: "1988-07-13T11:40:00.000Z",
    });
    assert.deepEqual(
      requests.map(([u]) => new URL(u).searchParams.get("fromtime")),
      ["1988-07-12T11:40", "1989-01-01T00:00", "1990-01-01T00:00"],
    );
  });

  it("caches only final responses that run to the end of the range", async () => {
    const requests = serve([[/stationdata/, fixture("kartverket-obs-1990.xml")]]);
    await kartverket.levels("BGO", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T03:00Z"));
    await kartverket.levels("BGO", new Date("1990-01-01T00:00Z"), new Date("1990-01-01T04:00Z"));
    const keep = requests.map(([, options]) => options.keep!(fixture("kartverket-obs-1990.xml")));
    assert.deepEqual(keep, [true, false]);
    const recent = fixture("kartverket-obs-recent.xml");
    assert.equal(kartverket.final(recent, Date.parse("2026-11-05T01:50Z")), false);
    assert.equal(
      kartverket.final(recent, Date.parse("2026-11-05T01:50Z"), Date.parse("2028-01-01T00:00Z")),
      true,
    );
    assert.equal(kartverket.final(fixture("kartverket-error.xml"), 0), false);
  });
});
