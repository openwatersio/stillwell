import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Station } from "../src/schema.ts";
import { copyPairs, linkGauges, LINKS, nearPairs, PREFER, rank, UNLINKS } from "../src/same-as.ts";

const NOW = new Date("2026-11-01T00:00:00Z");

// The real decisions name stations these tests don't list, which would report them as dropped.
const DECISIONS = [...LINKS];
before(() => LINKS.splice(0));
after(() => LINKS.push(...DECISIONS));

/** A station at `source/id`, by default at 0,0 with levels and no record yet. */
const station = (
  id: string,
  fields: Partial<Station> & { contributor?: string | null } = {},
): Station => {
  const [source, source_id] = id.split("/") as [string, string];
  return {
    id,
    source,
    source_id,
    name: "",
    lat: 0,
    lon: 0,
    country_code: null,
    kind: null,
    interval_s: 3600,
    datum: "ZERO",
    datums: {},
    products: ["levels"],
    first: null,
    last: null,
    license: "CC0-1.0",
    commercial_use: true,
    attribution: "",
    tide_station: null,
    same_as: [],
    status: "active",
    live: false,
    min_interval_s: null,
    source_url: null,
    ...fields,
  };
};

/** Degrees of latitude in `m` meters. */
const m = (meters: number) => meters / 111_195;

describe("linkGauges", () => {
  it("groups every station an ID links, and lists the whole group in each", () => {
    const { stations, report } = linkGauges(
      [
        station("coops/1612340", { name: "Honolulu" }),
        station("uhslc/057", { name: "Honolulu", same_as: ["coops/1612340", "uhslc/057a"] }),
        station("uhslc/057a", { name: "Honolulu", lat: 0.5 }),
        station("usgs/1", { name: "Elsewhere", lat: 10 }),
      ],
      NOW,
    );
    const byId = new Map(stations.map((s) => [s.id, s]));
    assert.deepEqual(byId.get("uhslc/057a")!.same_as, ["coops/1612340", "uhslc/057"]);
    assert.deepEqual(byId.get("coops/1612340")!.same_as, ["uhslc/057", "uhslc/057a"]);
    assert.equal(byId.get("uhslc/057a")!.preferred, "coops/1612340");
    assert.deepEqual(byId.get("usgs/1")!.same_as, []);
    assert.equal(byId.get("usgs/1")!.preferred, "usgs/1");
    assert.deepEqual(report.pairs, { "coops~uhslc": { id: 1 }, "uhslc~uhslc": { id: 1 } });
  });

  it("drops an ID link to a station no list has, or one too far away for the same gauge", () => {
    const { stations, report } = linkGauges([
      station("bsh/1", { same_as: ["pegelonline/9", "pegelonline/2"] }),
      station("pegelonline/2", { lat: 1 }),
      // A source's own series of one gauge can be far apart, where it moved.
      station("uhslc/001", { same_as: ["uhslc/001a"] }),
      station("uhslc/001a", { lat: 1 }),
    ]);
    assert.deepEqual(stations[0]!.same_as, []);
    assert.deepEqual(stations[2]!.same_as, ["uhslc/001a"]);
    assert.deepEqual(report.dropped, [
      { from: "bsh/1", to: "pegelonline/9", reason: "no such station" },
      { from: "bsh/1", to: "pegelonline/2", reason: "111 km apart" },
    ]);
  });

  it("links stations of different sources by nearness and name", () => {
    const { stations, report } = linkGauges([
      station("usace/LRL.Calhoun", { name: "GREEN RIVER AT LOCK 2 AT CALHOUN" }),
      station("usgs/03320000", { name: "GREEN RIVER AT LOCK 2 AT CALHOUN, KY", lat: m(40) }),
    ]);
    assert.deepEqual(stations[0]!.same_as, ["usgs/03320000"]);
    assert.deepEqual(report.pairs, { "usace~usgs": { near: 1 } });
  });
});

describe("linkGauges's limits", () => {
  it("never lets an inferred link join two stations of one source", () => {
    // A copy near two equally named gauges of one source links to the nearer.
    const { stations, report } = linkGauges([
      station("uhslc/802", { name: "Harbor Maloy", contributor: null }),
      station("kartverket/A", { name: "Harbor Maloy", lat: m(80) }),
      station("kartverket/B", { name: "Harbor Maloy", lat: m(-90) }),
    ]);
    assert.deepEqual(stations[0]!.same_as, ["kartverket/A"]);
    assert.deepEqual(stations[2]!.same_as, []);
    assert.deepEqual(report.skipped, [
      {
        a: "kartverket/B",
        b: "uhslc/802",
        how: "near",
        reason: "would join two kartverket stations",
      },
    ]);
  });

  it("never puts CO-OPS and USGS in one group, even through a copy of both", () => {
    const { stations, report } = linkGauges([
      station("uhslc/X", { name: "Kodiak", contributor: null, same_as: ["coops/1"] }),
      station("coops/1", { name: "Kodiak", lat: m(300) }),
      station("usgs/2", { name: "Kodiak Harbor", lat: m(50) }),
    ]);
    assert.deepEqual(stations[1]!.same_as, ["uhslc/X"]);
    assert.deepEqual(stations[2]!.same_as, []);
    assert.deepEqual(
      report.skipped.map((k) => k.reason),
      ["would join coops and usgs, which run separate gauges"],
    );
  });

  it("keeps a GESLA record whose values are another gauge's out of every group", () => {
    const uddevalla = { name: "Uddevalla", lat: 58.3451, lon: 11.9069 };
    const { stations, report } = linkGauges(
      [
        station("smhi/2541", uddevalla),
        station("gesla/uddevalla-2541-swe-smhi", {
          ...uddevalla,
          lat: 58.3475,
          lon: 11.8948,
          status: "inactive",
          products: [],
          // As a list from before the record was dropped has it.
          same_as: ["smhi/2541"],
        }),
        station("gesla/uddevalla-udd-swe-cmems", { ...uddevalla, lat: 58.3475, lon: 11.8948 }),
        station("uhslc/9", { same_as: ["gesla/uddevalla-2541-swe-smhi"] }),
        // REFMAR lists a gauge it hides with no products, but its values are its own.
        station("refmar/3", { name: "Brest", lat: 48.38, lon: -4.5, products: [] }),
        station("gesla/brest-3-fra-refmar", {
          name: "Brest",
          lat: 48.38,
          lon: -4.5,
          same_as: ["refmar/3"],
        }),
      ],
      NOW,
    );
    const byId = new Map(stations.map((s) => [s.id, s]));
    assert.deepEqual(byId.get("refmar/3")!.same_as, ["gesla/brest-3-fra-refmar"]);
    assert.deepEqual(
      report.dropped.map((d) => [d.from, d.to, d.reason]),
      [["uhslc/9", "gesla/uddevalla-2541-swe-smhi", "a GESLA record in DROPPED"]],
    );
    assert.deepEqual(byId.get("gesla/uddevalla-2541-swe-smhi")!.same_as, []);
    assert.deepEqual(byId.get("smhi/2541")!.same_as, ["gesla/uddevalla-udd-swe-cmems"]);
    assert.equal(
      byId.get("gesla/uddevalla-2541-swe-smhi")!.preferred,
      "gesla/uddevalla-2541-swe-smhi",
    );
  });

  it("keeps a pair a person unlinked apart, even through a third station", () => {
    UNLINKS.push({ a: "a/1", b: "b/1", note: "test" });
    try {
      const { stations, report } = linkGauges([
        station("a/1", { same_as: ["b/1", "c/1"] }),
        station("b/1", { same_as: ["c/1"] }),
        station("c/1"),
      ]);
      const groups = stations.map((s) => s.same_as);
      assert.ok(!groups[0]!.includes("b/1") && !groups[1]!.includes("a/1"));
      assert.equal(report.skipped.length, 2);
    } finally {
      UNLINKS.pop();
    }
  });

  it("links GESLA's CMEMS copy of Uddevalla to SMHI's gauge, which the copy rule skips", () => {
    const uddevalla = { name: "Uddevalla", lat: 58.3475, lon: 11.8948, kind: "river" as const };
    const list = [
      station("gesla/uddevalla-udd-swe-cmems", uddevalla),
      station("smhi/2541", { name: "Uddevalla", lat: 58.3451, lon: 11.9069, kind: "coastal" }),
    ];
    assert.equal(linkGauges(list, NOW).stations[0]!.same_as.length, 0);
    LINKS.push(...DECISIONS.filter((d) => d.b === "smhi/2541"));
    try {
      const { stations, report } = linkGauges(list, NOW);
      assert.deepEqual(stations[0]!.same_as, ["smhi/2541"]);
      assert.equal(stations[0]!.preferred, "smhi/2541");
      assert.deepEqual(report.dropped, []);
    } finally {
      LINKS.splice(0);
    }
  });

  it("links the gauges a person matched that no rule does", () => {
    const list = [
      station("bodc/dev", { name: "Devonport", lat: 50.36839, lon: -4.18525 }),
      station("ea/E72139", { name: "Plymouth", lat: 50.368401, lon: -4.185217 }),
      station("uhslc/805", { name: "Vardo", lat: 70.3333, lon: 31.1, contributor: "NHS" }),
      station("kartverket/VAW", { name: "Vardø", lat: 70.374978, lon: 31.104015 }),
      station("uhslc/850a", { name: "Ile Royale", lat: 5.285, lon: -52.585, contributor: "SHOM" }),
      station("refmar/749", { name: "ILE ROYALE", lat: 5.284333, lon: -52.5865 }),
      station("refmar/127", { name: "ILE ROYALE ANSE LEGOFF", lat: 5.28833333, lon: -52.5866667 }),
    ];
    const pairs = (linked: Station[]) =>
      linked.flatMap((s) => s.same_as.filter((o) => s.id < o).map((o) => `${s.id}~${o}`));
    assert.deepEqual(pairs(linkGauges(list, NOW).stations), []);
    LINKS.push(...DECISIONS.filter((d) => d.b !== "smhi/2541"));
    try {
      const { stations, report } = linkGauges(list, NOW);
      assert.deepEqual(pairs(stations).sort(), [
        "bodc/dev~ea/E72139",
        "kartverket/VAW~uhslc/805",
        "refmar/749~uhslc/850a",
      ]);
      assert.deepEqual(report.dropped, []);
    } finally {
      LINKS.splice(0);
    }
  });

  it("reports a person's decision that names no station", () => {
    LINKS.push({ a: "a/1", b: "gone/1", note: "test" });
    PREFER["gone/2"] = "test";
    try {
      const { report } = linkGauges([station("a/1")]);
      assert.deepEqual(
        report.dropped.map((d) => d.reason),
        ["LINKS names no such station", "PREFER names no such station"],
      );
    } finally {
      LINKS.pop();
      delete PREFER["gone/2"];
    }
  });
});

describe("nearPairs", () => {
  const pair = (a: Partial<Station>, b: Partial<Station>) =>
    nearPairs([station("usace/a", a), station("usgs/b", { lat: m(30), ...b })]).length === 1;

  it("needs a shared identifying word, never name alone", () => {
    assert.ok(pair({ name: "Clay" }, { name: "ELK RIVER AT CLAY, WV" }));
    assert.ok(!pair({ name: "Clay" }, { name: "Clay", lat: m(150) }));
    assert.ok(!pair({ name: "Narrows" }, { name: "WOLF CREEK NEAR BLUEFIELD" }));
  });

  it("never pairs CO-OPS with USGS or USACE, whose gauges at one pier are separate instruments", () => {
    const at = (id: string, name: string, lat = 0) => station(id, { name, lat });
    assert.deepEqual(
      nearPairs([
        at("coops/8665530", "Charleston"),
        at("usgs/021720711", "COOPER RIVER AT CHARLESTON, SC", m(18)),
      ]),
      [],
    );
    assert.deepEqual(
      nearPairs([
        at("coops/8765251", "Cypremort Point"),
        at("usace/MVN.Cyremort_Point", "Cypremort Point, LA", m(20)),
      ]),
      [],
    );
  });

  it("never pairs two stations of one source", () => {
    const pairs = nearPairs([
      station("rws/a", { name: "Knock" }),
      station("rws/b", { name: "Knock", lat: m(10) }),
    ]);
    assert.deepEqual(pairs, []);
  });

  it("keeps the two sides of a dam, lock or barrier apart", () => {
    assert.ok(
      !pair({ name: "Hannibal Locks and Dam Pool" }, { name: "Hannibal Lock and Dam (lower)" }),
    );
    assert.ok(pair({ name: "Felsenthal L&D Lower" }, { name: "Felsenthal L&D (lower)" }));
    assert.ok(pair({ name: "Wills Creek Outflow" }, { name: "Wills Creek bl Wills Creek Dam" }));
    // PEGELONLINE's UP is Unterpegel, the downstream gauge.
    assert.ok(pair({ name: "Geesthacht, Elbe, Wehr, Unterpegel" }, { name: "WEHR GEESTHACHT UP" }));
    assert.ok(!pair({ name: "Pinnau-Sperrwerk, Binnenpegel" }, { name: "PINNAU-SPERRWERK AP" }));
    assert.ok(!pair({ name: "Stör-Sperrwerk, Außenpegel" }, { name: "STÖR-SPERRWERK BP" }));
  });

  it("reads a compass word as a side only at the end of a name", () => {
    assert.ok(
      !pair(
        { name: "Schooner Bayou Control Structure - East (76600)" },
        { name: "Schooner Bayou" },
      ),
    );
    assert.ok(
      pair({ name: "East Fork Whitewater River at Brookville" }, { name: "Brookville Lake" }),
    );
  });
});

describe("copyPairs", () => {
  const nhs = { contributor: "Norwegian Hydrographic Services", kind: "coastal" as const };
  const ids = (stations: Station[]) => copyPairs(stations).map(([a, b]) => `${a.id} ${b.id}`);

  it("links a copy to its original farther off than nearness allows, since copies round positions", () => {
    assert.deepEqual(
      ids([
        station("uhslc/802", { name: "Maloy", ...nhs }),
        station("kartverket/MAY", { name: "Måløy", lat: m(185), kind: "coastal" }),
      ]),
      ["uhslc/802 kartverket/MAY"],
    );
    // Not from a series the redistributor runs itself.
    assert.deepEqual(
      ids([
        station("uhslc/015", {
          name: "Papeete",
          contributor: "University of Hawaii Sea Level Center",
        }),
        station("refmar/383", { name: "PAPEETE", lat: m(600) }),
      ]),
      [],
    );
  });

  it("takes the best-named match in each source, and none when two are as good", () => {
    const copy = station("uhslc/819", { name: "Goteborg-Torshamnen", ...nhs });
    assert.deepEqual(
      ids([
        copy,
        station("smhi/2109", { name: "Göteborg-Torshamnen", lat: m(900) }),
        station("smhi/33089", { name: "Göteborg-Krossholmen", lat: m(300) }),
      ]),
      ["uhslc/819 smhi/2109"],
    );
    assert.deepEqual(
      ids([
        station("uhslc/850a", { name: "Ile Royale", ...nhs }),
        station("refmar/749", { name: "ILE ROYALE", lat: m(180) }),
        station("refmar/127", { name: "ILE ROYALE ANSE LEGOFF", lat: m(-400) }),
      ]),
      [],
    );
  });

  it("doesn't take one source's linked series of a gauge as rivals", () => {
    const uh = { contributor: "University of Hawaii Sea Level Center" };
    assert.deepEqual(
      ids([
        station("refmar/6385", { name: "PAPEETE UHSLC" }),
        station("uhslc/015", { name: "Papeete", lat: m(300), same_as: ["uhslc/015a"], ...uh }),
        station("uhslc/015a", { name: "Papeete", lat: m(-400), ...uh }),
      ]),
      ["refmar/6385 uhslc/015"],
    );
  });

  it("guesses for a copy whose named original didn't hold", () => {
    const { stations } = linkGauges([
      station("uhslc/039a", { name: "Kodiak Island", ...nhs, same_as: ["coops/9999999"] }),
      station("coops/9457292", { name: "Kodiak Island", lat: m(800), kind: "coastal" }),
    ]);
    assert.deepEqual(stations[0]!.same_as, ["coops/9457292"]);
  });

  it("guesses for a copy whose named original a person unlinked", () => {
    UNLINKS.push({ a: "uhslc/039a", b: "coops/1111111", note: "test" });
    try {
      const { stations } = linkGauges([
        station("uhslc/039a", { name: "Kodiak Island", ...nhs, same_as: ["coops/1111111"] }),
        station("coops/1111111", { name: "Elsewhere", lat: m(900), kind: "coastal" }),
        station("coops/9457292", { name: "Kodiak Island", lat: m(800), kind: "coastal" }),
      ]);
      assert.deepEqual(stations[0]!.same_as, ["coops/9457292"]);
    } finally {
      UNLINKS.pop();
    }
  });

  it("breaks an exact tie by ID, whatever the list order", () => {
    const copy = station("uhslc/1", { name: "Kodiak", ...nhs });
    const a = station("coops/b", { name: "Kodiak", lat: m(500), lon: m(40), kind: "coastal" });
    const b = station("coops/a", { name: "Kodiak", lat: m(500), lon: m(-40), kind: "coastal" });
    for (const list of [
      [copy, a, b],
      [copy, b, a],
    ])
      assert.deepEqual(ids(list.map((s) => ({ ...s }))), ["uhslc/1 coops/a"]);
  });

  it("leaves a copy whose adapter named the original", () => {
    const { stations } = linkGauges([
      station("uhslc/057", { name: "Honolulu", ...nhs, same_as: ["coops/1612340"] }),
      station("coops/1612340", { name: "Honolulu", lat: m(400) }),
      station("usace/x", { name: "Honolulu Harbor", lat: m(1500) }),
    ]);
    assert.deepEqual(stations[2]!.same_as, []);
  });

  it("never matches a coastal copy to a river named for the same town", () => {
    assert.deepEqual(
      ids([
        station("uhslc/559", { name: "Sitka", ...nhs }),
        station("usgs/15087700", { name: "INDIAN R AT SITKA AK", lat: m(1500), kind: "river" }),
      ]),
      [],
    );
  });
});

describe("rank", () => {
  const best = (...stations: Station[]) =>
    stations.reduce((a, b) => (rank(a, b, NOW) < 0 ? a : b)).id;
  const record = (first: string, last: string) => ({ first, last });
  const live = record("2001-12-17T00:00:00Z", "2026-10-01T00:00:00Z");

  it("prefers a series with levels, then one whose terms allow commercial use", () => {
    // A BOM-contributed UHSLC copy is non-commercial; its live original wins on terms alone.
    assert.equal(
      best(station("uhslc/001", { commercial_use: false, ...live }), station("refmar/9", live)),
      "refmar/9",
    );
    // Even over a live series: the API serves only commercial terms until tokens exist.
    assert.equal(
      best(station("dmi/1", { commercial_use: false, ...live }), station("uhslc/837a")),
      "uhslc/837a",
    );
  });

  it("then one still reporting", () => {
    assert.equal(
      best(station("bsh/1", { products: ["predictions"] }), station("pegelonline/1")),
      "pegelonline/1",
    );
    // UHSLC's own version that ended in 2004 loses to the live series carrying a copy.
    assert.equal(
      best(
        station("uhslc/001b", {
          contributor: "University of Hawaii Sea Level Center",
          ...record("1974-01-01T00:00:00Z", "2004-12-31T00:00:00Z"),
        }),
        station("uhslc/001", {
          contributor: "National Tidal Centre, Bureau of Meteorology",
          ...live,
        }),
      ),
      "uhslc/001",
    );
    assert.equal(
      best(station("coops/1", { status: "inactive", ...live }), station("uhslc/057", live)),
      "uhslc/057",
    );
  });

  it("then the originator's over a copy, the longer record, the finer interval, and the ID", () => {
    const nos = { contributor: "National Ocean Service (NOS)" };
    assert.equal(
      best(
        station("coops/1", live),
        station("uhslc/057", { ...nos, ...record("1905-01-01T00:00:00Z", "2026-10-01T00:00:00Z") }),
      ),
      "coops/1",
    );
    // A UHSLC station with no contributor on file counts as a copy.
    assert.equal(best(station("coops/1"), station("uhslc/099", { contributor: null })), "coops/1");
    // UHSLC's own gauges are originals, and REFMAR's copies of them aren't.
    assert.equal(
      best(
        station("refmar/6385", { name: "PAPEETE UHSLC", ...live }),
        station("uhslc/015", { contributor: "University of Hawaii Sea Level Center", ...live }),
      ),
      "uhslc/015",
    );
    assert.equal(
      best(
        station("rws/a", { ...record("2000-01-01T00:00:00Z", "2026-10-01T00:00:00Z") }),
        station("rws/b", { ...record("1990-01-01T00:00:00Z", "2026-10-01T00:00:00Z") }),
      ),
      "rws/b",
    );
    // USACE relays USGS's gauges, so in a group with one it's the copy, whatever its interval.
    const linked = linkGauges([
      station("usgs/b", { name: "Calhoun" }),
      station("usace/a", { name: "Calhoun", interval_s: 900, lat: m(30) }),
    ]).stations;
    assert.equal(linked[1]!.preferred, "usgs/b");
    assert.equal(best(station("usgs/b"), station("rws/a", { interval_s: 900 })), "rws/a");
    assert.equal(best(station("rws/b"), station("rws/a")), "rws/a");
    // A date that doesn't parse counts as no record, whichever way round.
    const bad = station("rws/b", record("not a date", "nor this"));
    assert.equal(best(bad, station("rws/a")), "rws/a");
    assert.equal(best(station("rws/a"), bad), "rws/a");
  });
});
