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

  it("links GESLA's copy of a JODC port gauge to JODC's, not to JMA's gauge nearby", () => {
    const hirarako = { name: "Hirarako", kind: "coastal" as const, lat: 24.8133, lon: 125.2783 };
    const { stations, report } = linkGauges([
      station("gesla/hirarako-0151-jpn-jodc_pahb", {
        ...hirarako,
        contributor: "JODC_PAHB",
        same_as: ["jodc/0151"],
      }),
      station("jodc/0151", hirarako),
      station("jma/R1", { name: "Hirara", kind: "coastal", lat: 24.8, lon: 125.2833 }),
    ]);
    assert.deepEqual(stations[0]!.same_as, ["jodc/0151"]);
    // A record GESLA names by ID isn't matched as a copy.
    assert.deepEqual(stations[2]!.same_as, []);
    assert.deepEqual(report.skipped, []);
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

  it("keeps a pair in UNLINKS apart, even through a third station", () => {
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

  it("links the gauges listed in LINKS that no rule matches", () => {
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
    LINKS.push(...DECISIONS.filter((d) => ["bodc/dev", "uhslc/805", "uhslc/850a"].includes(d.a)));
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

  it("links the records of one gauge the cross-station checks found", () => {
    const list = [
      station("gesla/delfzijl-del-nld-rws", { name: "Delfzijl", lat: 53.328, lon: 6.931 }),
      station("gesla/delfzijl-delfzl-nld-rws_hist", {
        name: "Delfzijl",
        lat: 53.326353,
        lon: 6.933123,
      }),
      station("gesla/delfzijltg-del-nld-cmems", { name: "DelfzijlTG", lat: 53.330002, lon: 6.934 }),
      station("gesla/eemshaven_haven-eem-nld-rws", {
        name: "Eemshaven haven",
        lat: 53.448702,
        lon: 6.828392,
      }),
      station("gesla/eemshaventg-eem-nld-cmems", {
        name: "EemshavenTG",
        lat: 53.463242,
        lon: 6.8389502,
      }),
      station("gesla/eemshaven_waddenzee-eem-nld-rws", {
        name: "Eemshaven Waddenzee",
        lat: 53.474392,
        lon: 6.821731,
      }),
      station("gesla/eemsmeetpaaltg-eem-nld-cmems", {
        name: "EemsMeetpaalTG",
        lat: 53.475536,
        lon: 6.8223701,
      }),
      station("gesla/eidersptg-eid-deu-cmems", { name: "EiderSPTG", lat: 54.265999, lon: 8.842 }),
      station("pegelonline/9530010", { name: "EIDER-SPERRWERK AP", lat: 54.265924, lon: 8.84213 }),
      station("gesla/degerby-deg-fin-cmems", { name: "Degerby", lat: 60.031898, lon: 20.3848 }),
      station("gesla/foglo_degerby-134252-fin-fmi", {
        name: "Foglo Degerby",
        lat: 60.03,
        lon: 20.38,
      }),
    ];
    const pairs = (linked: Station[]) =>
      linked.flatMap((s) => s.same_as.filter((o) => s.id < o).map((o) => `${s.id}~${o}`));
    const ids = new Set(list.map((s) => s.id));
    const ours = DECISIONS.filter((d) => ids.has(d.a) && ids.has(d.b));
    assert.equal(ours.length, 6);
    // Only the decisions link them: no rule links one source's own records, or these names.
    assert.deepEqual(pairs(linkGauges(list, NOW).stations), []);
    LINKS.push(...ours);
    try {
      const { stations, report } = linkGauges(list, NOW);
      const group = (id: string) => [id, ...stations.find((s) => s.id === id)!.same_as].sort();
      assert.deepEqual(group("gesla/delfzijltg-del-nld-cmems"), [
        "gesla/delfzijl-del-nld-rws",
        "gesla/delfzijl-delfzl-nld-rws_hist",
        "gesla/delfzijltg-del-nld-cmems",
      ]);
      assert.ok(
        group("gesla/eemshaventg-eem-nld-cmems").includes("gesla/eemshaven_haven-eem-nld-rws"),
      );
      assert.ok(
        group("gesla/eemsmeetpaaltg-eem-nld-cmems").includes(
          "gesla/eemshaven_waddenzee-eem-nld-rws",
        ),
      );
      assert.ok(group("gesla/eidersptg-eid-deu-cmems").includes("pegelonline/9530010"));
      assert.ok(
        group("gesla/degerby-deg-fin-cmems").includes("gesla/foglo_degerby-134252-fin-fmi"),
      );
      assert.deepEqual(report.dropped, []);
    } finally {
      LINKS.splice(0);
    }
  });

  it("links BODC's Portbury to the EA's Avonmouth Portbury and prefers the EA's readings", () => {
    const list = [
      // A longer record than the EA's, but every value flagged.
      station("bodc/ptb", {
        name: "Portbury",
        lat: 51.4992,
        lon: -2.727,
        first: "2022-04-01T00:00:00Z",
        last: "2026-10-31T00:00:00Z",
      }),
      station("ea/E72624", {
        name: "Avonmouth Portbury",
        lat: 51.50291,
        lon: -2.6988,
        first: "2025-11-01T00:00:00Z",
        last: "2026-10-31T00:00:00Z",
      }),
    ];
    assert.deepEqual(linkGauges(list, NOW).stations[0]!.same_as, []);
    LINKS.push(...DECISIONS.filter((d) => d.a === "bodc/ptb"));
    try {
      assert.equal(linkGauges(list, NOW).stations[0]!.preferred, "bodc/ptb");
      const { stations, report } = linkGauges(list, NOW, new Map([["bodc/ptb", 0]]));
      assert.deepEqual(stations[0]!.same_as, ["ea/E72624"]);
      assert.equal(stations[0]!.preferred, "ea/E72624");
      assert.deepEqual(report.dropped, []);
    } finally {
      LINKS.splice(0);
    }
  });

  it("links CMEMS's copies of WSV gauges that GESLA places too far off or names no side of", () => {
    const list = [
      station("gesla/rostocktg-ros-deu-cmems", { name: "RostockTG", lat: 54.083, lon: 12.155 }),
      station("pegelonline/9640018", {
        name: "ROSTOCK MÜHLENDAMM UW",
        lat: 54.083064,
        lon: 12.155109,
      }),
      station("pegelonline/9640002", {
        name: "ROSTOCK MÜHLENDAMM OW",
        lat: 54.082438,
        lon: 12.154273,
      }),
      station("gesla/wangeroogetg-wan-deu-cmems", {
        name: "WangeroogeTG",
        lat: 53.806,
        lon: 7.929,
      }),
      station("pegelonline/9420030", { name: "WANGEROOGE NORD", lat: 53.806299, lon: 7.9292 }),
      station("pegelonline/9420040", { name: "WANGEROOGE WEST", lat: 53.776238, lon: 7.867938 }),
      // GESLA's WSV record of the gauge, which its adapter links by number.
      station("gesla/wangeroogewest-9420040-deu-wsv", {
        name: "Wangeroogewest",
        lat: 53.777821,
        lon: 7.868833,
        same_as: ["pegelonline/9420040"],
      }),
      station("gesla/kielholtenautg-kie-deu-cmems", {
        name: "KielHoltenauTG",
        lat: 54.383,
        lon: 10.204,
      }),
      station("pegelonline/9610066", { name: "KIEL-HOLTENAU", lat: 54.372087, lon: 10.15705 }),
      station("gesla/luebecktg-lue-deu-cmems", { name: "LuebeckTG", lat: 53.9025, lon: 10.7745 }),
      station("pegelonline/9620090", { name: "LÜBECK-BAUHOF", lat: 53.893008, lon: 10.703065 }),
    ];
    const preferred = (linked: Station[]) =>
      linked.filter((s) => s.id.endsWith("-cmems")).map((s) => `${s.id}~${s.preferred}`);
    assert.deepEqual(
      preferred(linkGauges(list, NOW).stations).filter((p) => p.includes("pegelonline")),
      [],
    );
    const ids = new Set(list.map((s) => s.id));
    LINKS.push(...DECISIONS.filter((d) => ids.has(d.a) && ids.has(d.b)));
    try {
      const { stations, report } = linkGauges(list, NOW);
      assert.deepEqual(preferred(stations), [
        "gesla/rostocktg-ros-deu-cmems~pegelonline/9640018",
        "gesla/wangeroogetg-wan-deu-cmems~pegelonline/9420040",
        "gesla/kielholtenautg-kie-deu-cmems~pegelonline/9610066",
        "gesla/luebecktg-lue-deu-cmems~pegelonline/9620090",
      ]);
      const wangerooge = stations.find((s) => s.id === "gesla/wangeroogetg-wan-deu-cmems")!;
      assert.deepEqual(wangerooge.same_as.toSorted(), [
        "gesla/wangeroogewest-9420040-deu-wsv",
        "pegelonline/9420040",
      ]);
      assert.deepEqual(report.dropped, []);
    } finally {
      LINKS.splice(0);
    }
  });

  it("reports a LINKS or PREFER entry that names no station", () => {
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

  it("never pairs JMA's and JODC's gauges, which are separate instruments", () => {
    const at = { name: "Maizuru", kind: "coastal" as const };
    assert.equal(
      nearPairs([station("jma/MZ", at), station("jodc/HD24", { ...at, lat: m(30) })]).length,
      0,
    );
  });

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

  it("guesses for a copy whose named original is kept apart by UNLINKS", () => {
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
    // A non-commercial UHSLC copy loses to its live original on terms alone.
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
    // USGS relays a few CRMS gauges, so CPRA's series is preferred over a longer relay.
    const relayed = linkGauges([
      station("usgs/c", {
        name: "CRMS0282-H01-RT",
        same_as: ["crms/CRMS0282-H01"],
        ...record("2000-01-01T00:00:00Z", "2026-10-01T00:00:00Z"),
      }),
      station("crms/CRMS0282-H01", {
        name: "CRMS0282-H01",
        ...record("2013-10-01T06:00:00Z", "2026-07-01T00:00:00Z"),
      }),
    ]).stations;
    assert.equal(relayed[0]!.preferred, "crms/CRMS0282-H01");
    // GESLA's record of a site spans the gauges CPRA numbers anew as it moves
    // them; CRMS links them, so the record joins all of them and the gauge
    // still reporting is preferred over the site's first.
    const moved = linkGauges(
      [
        station("gesla/crms6302-crms6302-usa-crms", {
          same_as: ["crms/CRMS6302-H01"],
          ...record("2008-01-01T00:00:00Z", "2025-12-31T00:00:00Z"),
        }),
        station("crms/CRMS6302-H01", {
          same_as: ["crms/CRMS6302-H02"],
          status: "inactive",
          ...record("2009-01-01T00:00:00Z", "2010-12-31T00:00:00Z"),
        }),
        station("crms/CRMS6302-H02", {
          same_as: ["crms/CRMS6302-H01"],
          lat: m(200),
          ...record("2011-01-01T00:00:00Z", "2026-10-01T00:00:00Z"),
        }),
      ],
      NOW,
    ).stations;
    assert.deepEqual(moved[0]!.same_as, ["crms/CRMS6302-H01", "crms/CRMS6302-H02"]);
    for (const s of moved) assert.equal(s.preferred, "crms/CRMS6302-H02");
    assert.equal(best(station("usgs/b"), station("rws/a", { interval_s: 900 })), "rws/a");
    assert.equal(best(station("rws/b"), station("rws/a")), "rws/a");
    // A date that doesn't parse counts as no record, whichever way round.
    const bad = station("rws/b", record("not a date", "nor this"));
    assert.equal(best(bad, station("rws/a")), "rws/a");
    assert.equal(best(station("rws/a"), bad), "rws/a");
  });
});
