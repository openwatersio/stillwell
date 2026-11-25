import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createTidePredictor } from "@slackwater/engine";
import { engineVersion } from "../src/fit/fit.ts";
import { loadReferences, referenceIndex, type TideRecord } from "../src/fit/reference-links.ts";
import {
  constantsDigest,
  referencesDue,
  seenIn,
  type Reference,
  type ReferenceScore,
} from "../src/fit/references.ts";
import { scoreHeldOut } from "../src/fit/scores.ts";
import {
  dropFits,
  fitSource,
  readConstituents,
  readFits,
  readReferences,
  writeFits,
} from "../src/fit/store.ts";
import type { DataMatch } from "../src/matches.ts";
import { Flag, type Source, type SourceMetadata, type StoredStation } from "../src/schema.ts";
import { writeMatches } from "../src/matches.ts";
import { readYearStats, writeObservations, writeStations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import { writeYears, type YearRow } from "../src/store/years.ts";

const HOUR = 3_600_000;
const RELEASE = "@slackwater/database@test";
const M2 = { name: "M2", amplitude: 1, phase: 30 };
const K1 = { name: "K1", amplitude: 0.2, phase: 120 };

const record = (id: string, fields: Partial<TideRecord> = {}): TideRecord => ({
  id,
  source: { name: "TICON-4", id: id.slice(id.indexOf("/") + 1) },
  latitude: 59,
  longitude: 11,
  license: { type: "CC-BY-4.0", commercial_use: true },
  attribution: "credit",
  harmonic_constituents: [M2, K1],
  ...fields,
});
const at = (id: string, same_as: string[] = [], lat = 59, lon = 11) => ({ id, lat, lon, same_as });
const match = (a: string, b: string, fields: Partial<DataMatch> = {}): DataMatch => ({
  a,
  b,
  since: "2022-01-01T00:00:00Z",
  until: "2025-01-01T00:00:00Z",
  months: 36,
  hours: 26000,
  rms_m: 0.002,
  lag_h: 0,
  lag_rms_m: 0.002,
  ...fields,
});

describe("the records scored for a station", () => {
  const records = [
    record("ticon/kungsvik-2130-swe-smhi"),
    record("ticon/kungsvik-kun-swe-cmems"),
    record("noaa/8729840", { source: { name: "NOAA", id: "8729840" } }),
    record("linz/auckland", { source: { name: "LINZ", id: "auckland" } }),
  ];
  const smhi = at("smhi/2130", ["gesla/kungsvik-2130-swe-smhi", "gesla/kungsvik-kun-swe-cmems"]);
  const published = [
    smhi,
    at("gesla/kungsvik-2130-swe-smhi", ["smhi/2130"]),
    at("gesla/kungsvik-kun-swe-cmems", ["smhi/2130"]),
    at("coops/8729840"),
  ];
  const ids = (matches: DataMatch[], list = published, id = "smhi/2130") =>
    referenceIndex(records, RELEASE, list, matches)({ id })?.map((r) => r.id) ?? null;

  it("are those of linked series whose levels agree within 1 cm with no lag", () => {
    const agreed = [
      match("gesla/kungsvik-2130-swe-smhi", "smhi/2130"),
      match("gesla/kungsvik-kun-swe-cmems", "smhi/2130"),
    ];
    const found = referenceIndex(records, RELEASE, published, agreed)({ id: "smhi/2130" })!;
    assert.deepEqual(
      found.map((r) => [r.id, r.link, r.linked, r.nodeCorrections, r.assumed, r.release]),
      [
        [
          "ticon/kungsvik-2130-swe-smhi",
          "levels",
          "gesla/kungsvik-2130-swe-smhi",
          "iho",
          false,
          RELEASE,
        ],
        [
          "ticon/kungsvik-kun-swe-cmems",
          "levels",
          "gesla/kungsvik-kun-swe-cmems",
          "iho",
          false,
          RELEASE,
        ],
      ],
    );
    assert.equal(found[0]!.digest, constantsDigest([M2, K1]));
  });

  it("never those of a link nothing compared, or whose levels differ, lag or were compared too briefly", () => {
    const other = "gesla/kungsvik-kun-swe-cmems";
    assert.deepEqual(ids([]), []);
    for (const fields of [{ rms_m: 0.012 }, { lag_h: 1, lag_rms_m: 0.001 }, { months: 5 }])
      assert.deepEqual(ids([match(other, "smhi/2130", fields)]), []);
    // Levels that agree link nothing the published list doesn't already link.
    const unlinked = [{ ...smhi, same_as: [] }, ...published.slice(1)];
    assert.deepEqual(ids([match(other, "smhi/2130")], unlinked), []);
  });

  it("are a station's own by ID, where the record is where the station is", () => {
    const own = referenceIndex(records, RELEASE, published, []);
    assert.deepEqual(
      own({ id: "coops/8729840" })!.map((r) => [
        r.id,
        r.link,
        r.linked,
        r.nodeCorrections,
        r.assumed,
      ]),
      [["noaa/8729840", "id", null, "schureman", false]],
    );
    assert.deepEqual(
      own({ id: "gesla/kungsvik-kun-swe-cmems" })!.map((r) => [r.id, r.link]),
      [["ticon/kungsvik-kun-swe-cmems", "id"]],
    );
    // A record 100 km from the station that has its ID is a wrong ID.
    assert.deepEqual(ids([], [at("coops/8729840", [], 60, 11)], "coops/8729840"), []);
  });

  it("are none for a source whose IDs name no series, and can't be told for a station the published list lacks", () => {
    assert.deepEqual(ids([], [at("linz/auckland")], "linz/auckland"), []);
    assert.equal(ids([], published, "smhi/9999"), null);
  });
});

describe("a record's analysis and the held-out year", () => {
  it("is known only where the record gives its span", () => {
    assert.equal(seenIn({ epoch: { start: "1973-08-01", end: "2025-07-02" } }, 2025), true);
    assert.equal(seenIn({ epoch: { start: "1983-01-01", end: "2001-12-31" } }, 2025), false);
    assert.equal(seenIn({ epoch: null }, 2025), null);
    assert.equal(seenIn({ epoch: { start: "1983-01-01", end: "soon" } }, 2025), null);
    // A day that isn't a date, and a span that ends before it starts, say nothing.
    assert.equal(seenIn({ epoch: { start: "2025-02-31", end: "2025-11-30" } }, 2025), null);
    assert.equal(seenIn({ epoch: { start: "2025-12-31", end: "2025-01-01" } }, 2025), null);
  });
});

const reference = (fields: Partial<Reference> = {}): Reference => ({
  id: "ticon/a",
  source: "TICON-4",
  release: RELEASE,
  link: "levels",
  linked: "gesla/a",
  nodeCorrections: "iho",
  assumed: false,
  epoch: null,
  license: "CC-BY-4.0",
  commercialUse: true,
  attribution: "credit",
  constituents: [M2, K1],
  digest: constantsDigest([M2, K1]),
  ...fields,
});
const FITTED = "2026-11-25T00:00:00.000Z";
const scored = (r: Reference, version = "v", fitted = FITTED): ReferenceScore =>
  ({
    id: "test/a",
    version,
    fitted,
    reference: r.id,
    reference_license: r.license,
    reference_commercial_use: r.commercialUse,
    reference_attribution: r.attribution,
    digest: r.digest,
    link: r.link,
    linked: r.linked,
    node_corrections: r.nodeCorrections,
    node_corrections_assumed: r.assumed,
    seen: seenIn(r, 2024),
  }) as ReferenceScore;

/** A row with the columns the file needs that `scored` leaves out. */
const complete = (r: ReferenceScore): ReferenceScore => ({
  ...r,
  reference_source: "TICON-4",
  release: RELEASE,
  constituents: 2,
  unpredicted: 0,
  scored: FITTED,
  held_out: 2024,
  held_out_hours: 8000,
  turns: 1,
  turns_missed: 0,
});

describe("a fit's reference scores are due", () => {
  const fit = { version: "v", held_out: 2024, fitted: FITTED };

  it("not while its records are as they were scored, whatever release they came in", () => {
    const r = reference();
    assert.equal(referencesDue(fit, [], []), false);
    assert.equal(referencesDue(fit, [scored(r)], [{ ...r, release: "later" }]), false);
  });

  it("when a record joins or leaves the gauge, or a release changes its constants, span or link", () => {
    const r = reference();
    assert.equal(referencesDue(fit, [], [r]), true);
    assert.equal(referencesDue(fit, [scored(r)], []), true);
    const moved = [{ ...M2, amplitude: 1.01 }, K1];
    for (const changed of [
      reference({ constituents: moved, digest: constantsDigest(moved) }),
      reference({ epoch: { start: "2000-01-01", end: "2024-06-30" } }),
      reference({ link: "id", linked: null }),
      reference({ nodeCorrections: "schureman" }),
      reference({ commercialUse: false, license: "CC-BY-NC-4.0" }),
    ])
      assert.equal(referencesDue(fit, [scored(r)], [changed]), true);
  });

  it("when its rows are another fit's, and for a station without constants only to take rows away", () => {
    const r = reference();
    assert.equal(referencesDue(fit, [scored(r, "older")], [r]), true);
    // A fit taken again on a changed held-out year can keep its version, which covers the window only.
    assert.equal(referencesDue(fit, [scored(r, "v", "2026-10-01T00:00:00.000Z")], [r]), true);
    const none = { version: null, held_out: null, fitted: FITTED };
    assert.equal(referencesDue(none, [], [r]), false);
    assert.equal(referencesDue(none, [scored(r)], [r]), true);
  });
});

describe("a record's score", () => {
  it("is taken under the corrections its constants were fitted with", () => {
    // O1's nodal factor differs between the families, so a curve made under one is missed by the other.
    const constants = [M2, { name: "O1", amplitude: 0.5, phase: 200 }];
    const predictor = createTidePredictor(constants, { offset: false, nodeCorrections: "iho" });
    const observed = [];
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2024, 3, 1); t += HOUR)
      observed.push({ time: t, level: predictor.getWaterLevelAtTime({ time: new Date(t) }).level });
    const { others } = scoreHeldOut(observed, constants, {
      own: { constituents: constants, seen: null, nodeCorrections: "iho" },
      fits: { constituents: constants, seen: null },
    });
    assert.ok(others.own!.rms < 1e-9);
    assert.ok(others.fits!.rms > 1e-3);
    assert.equal(others.own!.seen, null);
  });
});

describe("fitSource with records to score", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-references-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  const source = {
    metadata: { id: "test", finalizes: true } as unknown as SourceMetadata,
  } as Source;
  const station = {
    id: "test/a",
    source: "test",
    source_id: "a",
    epochs: [{ id: 1, since: null, until: null, to_current: 0, state: "open" }],
  } as unknown as StoredStation;
  const options = (references: Reference[], now = "2026-11-25T00:00:00Z") => ({
    now: new Date(now),
    errata: [],
    references: () => references,
  });
  // The tide the levels are made from, under the fit's corrections, and one with M2 a tenth too small.
  const truth = reference({ id: "noaa/a", nodeCorrections: "schureman", link: "id", linked: null });
  const low = [{ ...M2, amplitude: 0.9 }, K1];
  const worse = reference({ constituents: low, digest: constantsDigest(low) });
  const rows: YearRow[] = [];

  it("scores each record on a worker thread beside the fit, on the fit's hours", async () => {
    const predictor = createTidePredictor([M2, K1], {
      offset: false,
      nodeCorrections: "schureman",
    });
    for (const year of [2022, 2023, 2024]) {
      const observations = [];
      for (let t = Date.UTC(year, 0, 1), i = 0; t < Date.UTC(year + 1, 0, 1); t += HOUR, i++)
        observations.push({
          time: t,
          // A fixed ripple, so the fit has noise to measure.
          level:
            predictor.getWaterLevelAtTime({ time: new Date(t) }).level + ((i * 7919) % 13) / 1000,
          flag: Flag.good,
        });
      const path = seriesPath(store, "levels", "test", "a", year);
      await writeObservations(path, observations, "NAVD88");
      rows.push({ id: "test/a", epoch: 1, year, ...(await readYearStats([path])).get(path)! });
    }
    await writeYears(store, "test", rows);
    const report = await fitSource(store, source, [station], options([truth, worse]));
    assert.deepEqual([report.fitted, report.failed], [["test/a"], []]);
    const fit = (await readFits(store, "test")).get("test/a")!;
    const scores = await readReferences(store, "test");
    assert.equal(scores.length, 2);
    const [good, bad] = scores;
    assert.deepEqual(
      [good!.reference, good!.link, good!.node_corrections, good!.version, good!.held_out],
      ["noaa/a", "id", "schureman", fit.version, 2024],
    );
    assert.equal(good!.held_out_hours, fit.held_out_hours);
    // The true constants leave the ripple, as the fit does; M2 a tenth too small leaves 0.1 m of M2.
    assert.ok(Math.abs(good!.held_out_rms_m! - fit.held_out_rms_m!) < 1e-4);
    assert.ok(Math.abs(bad!.held_out_rms_m! - 0.1 / Math.SQRT2) < 0.005);
    assert.ok(bad!.variance_difference_se_m2! > 0);
    assert.equal(bad!.digest, worse.digest);
    assert.equal(bad!.release, RELEASE);
    assert.equal(bad!.seen, null);
    assert.deepEqual([bad!.constituents, bad!.unpredicted], [2, 0]);
  });

  it("scores again, without fitting, when a release changes a record's constants", async () => {
    const before = (await readFits(store, "test")).get("test/a")!;
    const same = await fitSource(store, source, [station], options([truth, worse]));
    assert.deepEqual([same.fitted, same.rescored, same.current], [[], [], 1]);
    const now = "2026-12-01T00:00:00Z";
    const changed = await fitSource(store, source, [station], options([truth], now));
    assert.deepEqual([changed.fitted, changed.rescored, changed.failed], [[], ["test/a"], []]);
    assert.deepEqual((await readFits(store, "test")).get("test/a"), before);
    const scores = await readReferences(store, "test");
    assert.deepEqual(
      scores.map((r) => [r.reference, r.version, r.scored]),
      [["noaa/a", before.version, "2026-12-01T00:00:00.000Z"]],
    );
    assert.ok(Math.abs(scores[0]!.held_out_rms_m! - before.held_out_rms_m!) < 1e-4);
  });

  it("refuses to score against a held-out year that no longer scores the fit as its row says", async () => {
    const path = seriesPath(store, "levels", "test", "a", 2024);
    const observations = [];
    for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2025, 0, 1); t += HOUR)
      observations.push({ time: t, level: 0, flag: Flag.good });
    await writeObservations(path, observations, "NAVD88");
    // The years file still gives the old version, so the fit doesn't come due.
    const report = await fitSource(store, source, [station], options([truth, worse]));
    assert.deepEqual([report.fitted, report.rescored], [[], []]);
    assert.match(report.failed[0]!, /its row says/);
    assert.deepEqual(
      (await readReferences(store, "test")).map((r) => r.reference),
      ["noaa/a"],
    );
  });

  it("leaves a fit's scores as they are where its records can't be told", async () => {
    const before = await readReferences(store, "test");
    for (const references of [undefined, () => null]) {
      const report = await fitSource(store, source, [station], {
        now: new Date("2026-12-02T00:00:00Z"),
        errata: [],
        ...(references ? { references } : {}),
      });
      assert.deepEqual([report.rescored, report.failed, report.current], [[], [], 1]);
      assert.deepEqual(await readReferences(store, "test"), before);
    }
  });

  it("fits a station whose records can't be told without scores, which a later run takes", async () => {
    const report = await fitSource(store, source, [station], {
      now: new Date("2026-12-03T00:00:00Z"),
      errata: [],
      all: true,
      references: () => null,
    });
    assert.deepEqual([report.fitted, report.failed], [["test/a"], []]);
    assert.deepEqual(await readReferences(store, "test"), []);
    const later = await fitSource(
      store,
      source,
      [station],
      options([truth], "2026-12-04T00:00:00Z"),
    );
    assert.deepEqual([later.fitted, later.rescored], [[], ["test/a"]]);
    assert.equal((await readReferences(store, "test")).length, 1);
  });

  it("takes away scores no fit is left to join, as a build that doesn't keep the file leaves them", async () => {
    const [row] = await readReferences(store, "test");
    const fits = [...(await readFits(store, "test")).values()];
    await writeFits(store, "test", fits, await readConstituents(store, "test"), [
      row!,
      { ...row!, id: "test/b" },
    ]);
    const other = { ...station, id: "test/b", source_id: "b" } as StoredStation;
    await fitSource(store, source, [station, other], { now: new Date(), errata: [], only: [] });
    assert.deepEqual(
      (await readReferences(store, "test")).map((r) => r.id),
      ["test/a"],
    );
  });

  it("takes a fit's scores away when no record is left for its gauge, and with the station", async () => {
    const report = await fitSource(store, source, [station], options([]));
    assert.deepEqual(report.rescored, ["test/a"]);
    assert.deepEqual(await readReferences(store, "test"), []);
    assert.equal(engineVersion(), (await readFits(store, "test")).get("test/a")!.engine);
  });
});

describe("dropFits", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-references-drop-"));
  after(() => rmSync(store, { recursive: true, force: true }));

  it("takes a station's reference scores with its fit", async () => {
    const row = (id: string) => ({ ...scored(reference()), id }) as ReferenceScore;
    const fit = (id: string) => ({ id, fitted: FITTED, engine: "e", inputs: "{}", version: "v" });
    await writeFits(
      store,
      "test",
      [fit("test/a"), fit("test/b")] as never,
      [],
      [row("test/a"), row("test/b")].map(complete),
    );
    assert.deepEqual(await dropFits(store, "test", (id) => id === "test/a"), ["test/a"]);
    assert.deepEqual(
      (await readReferences(store, "test")).map((r) => r.id),
      ["test/b"],
    );
  });
});

describe("loadReferences", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-references-load-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  const listed = (id: string, same_as: string[]) =>
    ({
      id,
      source: id.split("/")[0],
      source_id: id.slice(id.indexOf("/") + 1),
      name: id,
      lat: 58.9967,
      lon: 11.1272,
      datum: "RH2000",
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      license: "CC-BY-4.0",
      commercial_use: true,
      attribution: "x",
      tide_station: null,
      same_as,
      status: "active",
      live: false,
      interval_s: 3600,
      kind: "coastal",
      country: "SE",
      timezone: "UTC",
      epochs: [],
    }) as unknown as StoredStation;
  const gesla = "gesla/kungsvik-2130-swe-smhi";
  const all = () => true;
  const fit = { id: "smhi/2130", fitted: FITTED, engine: "e", inputs: "{}", version: "v" };

  it("refuses a store with no published stations, which no link can be told without", async () => {
    await assert.rejects(loadReferences(store, "smhi", all), /run `ingest publish` first/);
  });

  it("links the installed database's records by the store's published list and comparisons", async () => {
    await writeStations(join(store, "stations.parquet"), [
      listed(gesla, ["smhi/2130"]),
      listed("smhi/2130", [gesla]),
    ]);
    // No comparisons yet: only a record with the station's own ID.
    assert.deepEqual((await loadReferences(store, "smhi", all))({ id: "smhi/2130" }), []);
    await writeMatches(store, [match(gesla, "smhi/2130")]);
    const [found] = (await loadReferences(store, "smhi", all))({ id: "smhi/2130" })!;
    assert.deepEqual(
      [found!.id, found!.link, found!.linked, found!.constituents.length > 10],
      ["ticon/kungsvik-2130-swe-smhi", "levels", gesla, true],
    );
    assert.match(found!.release, /^@slackwater\/database@\d/);
    // A withheld series links nothing, whatever a list from before it was withheld says.
    const shown = (id: string) => id !== gesla;
    assert.deepEqual((await loadReferences(store, "smhi", shown))({ id: "smhi/2130" }), []);
  });

  it("refuses to lose the comparisons a source's stored scores rest on", async () => {
    const row = { ...scored(reference()), id: "smhi/2130" };
    await writeFits(store, "smhi", [fit] as never, [], [complete(row)]);
    rmSync(join(store, "stations/matches.parquet"));
    await assert.rejects(loadReferences(store, "smhi", all), /reference scores rest on/);
    // Another source's scores don't rest on them, and nor do scores linked to a series no longer shown.
    assert.ok(await loadReferences(store, "pegelonline", all));
    assert.ok(await loadReferences(store, "smhi", (id) => id !== "gesla/a"));
  });

  it("refuses comparisons that no longer hold up many of a source's scores at once, unless accepted", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      complete({ ...scored(reference({ linked: `gesla/${i}` })), id: `smhi/${i}` }),
    );
    await writeFits(store, "smhi", rows.map((r) => ({ ...fit, id: r.id })) as never, [], rows);
    const agree = (n: number) =>
      writeMatches(
        store,
        Array.from({ length: n }, (_, i) => match(`gesla/${i}`, `smhi/${i}`)),
      );
    // A file written short: 10 of the 30 pairs are left.
    await agree(10);
    await assert.rejects(loadReferences(store, "smhi", all), /no longer shows 20 of the 30 pairs/);
    assert.ok(await loadReferences(store, "smhi", all, true));
    // A few pairs that stopped agreeing are the comparisons' to say.
    await agree(25);
    assert.ok(await loadReferences(store, "smhi", all));
  });
});
