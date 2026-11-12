import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Station } from "../src/schema.ts";
import {
  adoptSiblings,
  parseId,
  replacement,
  sharesWord,
  usgsSite,
  type TiconRecord,
} from "../src/ticon.ts";

function record(id: string, fields: Partial<TiconRecord> = {}): TiconRecord {
  return {
    id,
    name: "",
    country: "",
    lat: 0,
    lon: 0,
    ...parseId(id),
    commercial_use: true,
    epoch: { start: "2000-01-01", end: "2020-12-31" },
    published: true,
    accepted: true,
    ...fields,
  };
}

function station(id: string, name: string, lat: number, lon: number): Station {
  return {
    id,
    source: id.split("/")[0]!,
    source_id: id.split("/")[1]!,
    name,
    lat,
    lon,
    country_code: null,
    kind: null,
    interval_s: null,
    datum: "NAP",
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
    live: true,
    min_interval_s: null,
    source_url: null,
  };
}

describe("TICON replacements", () => {
  it("reads the originator's code from the id", () => {
    assert.deepEqual(parseId("seattle-9447130-usa-noaa"), {
      code: "9447130",
      iso3: "usa",
      contributor: "noaa",
    });
    assert.equal(replacement(record("seattle-9447130-usa-noaa"), {}).id, "coops/9447130");
  });

  it("counts a NOAA record ready once CO-OPS lists its station", () => {
    const lists = { coops: [station("coops/9447130", "Seattle", 47.6, -122.34)] };
    const seattle = replacement(
      record("seattle-9447130-usa-noaa", { lat: 47.6, lon: -122.34 }),
      lists,
    );
    assert.deepEqual([seattle.id, seattle.status], ["coops/9447130", "ready"]);
    const missing = replacement(record("x-1234567-usa-noaa"), lists);
    assert.deepEqual([missing.id, missing.status], [null, "unmatched"]);
  });

  it("maps a California record by its DWR number or its CDEC code", () => {
    const lists = {
      dwr: [
        station("dwr/B95339Q", "Clifton Court Intake", 37.83, -121.55),
        station("dwr/B95340", "Old River at Clifton Court Ferry", 37.83, -121.55),
      ],
    };
    const intake = replacement(record("clifton_court_intake-b95339-usa-cdwr"), lists);
    assert.deepEqual([intake.id, intake.status], ["dwr/B95339Q", "ready"]);
    const ferry = replacement(record("x-b95340-usa-cdwr"), lists);
    assert.equal(ferry.id, "dwr/B95340");
    // Before the list is in the store, the id comes from the adapter's own list, with its Q.
    assert.equal(replacement(record("x-b95339-usa-cdwr"), {}).id, "dwr/B95339Q");
    // A CDEC code goes to CDEC, by code.
    const beldon = replacement(record("beldon_landing-bdl-usa-cdwr"), {});
    assert.deepEqual([beldon.id, beldon.status], ["cdec/BDL", "planned"]);
    const withCdec = { cdec: [station("cdec/BDL", "Beldon Landing", 38.19, -121.97)] };
    assert.equal(replacement(record("beldon_landing-bdl-usa-cdwr"), withCdec).status, "ready");
    // One USGS runs isn't in CDEC's list.
    assert.equal(replacement(record("rio_vista-ryi-usa-cdwr"), withCdec).status, "unmatched");
  });

  it("maps a REFMAR record to its gauge's SHOM id", () => {
    const brest = record("brest-3-fra-refmar", { lat: 48.38, lon: -4.5 });
    assert.deepEqual(
      [replacement(brest, {}).id, replacement(brest, {}).status],
      ["refmar/3", "planned"],
    );
    const lists = { refmar: [station("refmar/3", "BREST", 48.38, -4.5)] };
    assert.equal(replacement(brest, lists).status, "ready");
  });

  it("sends a UHSLC relay to the originator slackwater-database's provenance declares", () => {
    const relay = record("honolulu-057a-usa-uhslc_rq", { declared: "noaa/1612340" });
    assert.deepEqual(replacement(relay, {}), {
      source: "coops",
      id: "coops/1612340",
      status: "planned",
      note: "UHSLC relay of noaa/1612340",
    });
    assert.equal(replacement(record("abashiri-347a-jpn-uhslc_rq"), {}).id, "uhslc/347a");
  });

  it("finds a UHSLC version in its FD series when that series carries it", () => {
    const lists = {
      uhslc: [
        { ...station("uhslc/001", "Pohnpei", 6.98, 158.2), source_id: "001", version: "C" },
        { ...station("uhslc/001a", "Pohnpei", 6.98, 158.23), source_id: "001a", version: "A" },
      ],
    };
    const ids = [
      "pohnpei-001-fsm-uhslc_fd",
      "pohnpei-001a-fsm-uhslc_rq",
      "pohnpei-001c-fsm-uhslc_rq",
    ]
      .map((id) => replacement(record(id, { lat: 6.98, lon: 158.2 }), lists))
      .map((r) => [r.id, r.status]);
    assert.deepEqual(ids, [
      ["uhslc/001", "ready"],
      ["uhslc/001a", "ready"],
      ["uhslc/001", "ready"],
    ]);
    // An FD record whose FD series is gone is its latest version's.
    const ended = { uhslc: [{ ...station("uhslc/281a", "Cananeia", -25, -48), version: "A" }] };
    assert.equal(replacement(record("cananeia-281-bra-uhslc_fd"), ended).id, "uhslc/281a");
    // A contributor's terms that bar commercial use keep a listed station from being cleared.
    const nonCommercial = {
      uhslc: [
        { ...station("uhslc/001", "Pohnpei", 6.98, 158.2), version: "C", commercial_use: false },
      ],
    };
    assert.equal(
      replacement(record("pohnpei-001c-fsm-uhslc_rq"), nonCommercial).status,
      "restricted",
    );
    // SANHO's gauges aren't listed, and Walvis Bay, in Namibia, is withheld.
    assert.equal(replacement(record("durban-181a-zaf-uhslc_rq"), lists).status, "restricted");
    assert.equal(replacement(record("walvis_bay-220a-nam-uhslc_rq"), lists).status, "restricted");
    // Lüderitz is withheld too, even from a list that still has it.
    const luderitz = {
      uhslc: [{ ...station("uhslc/702", "Luderitz", -26.64, 15.15), version: "A" }],
    };
    assert.equal(replacement(record("luderitz-702a-zaf-uhslc_rq"), luderitz).status, "restricted");
  });

  it("matches WSV records by PEGELONLINE number", () => {
    const lists = { pegelonline: [station("pegelonline/5930070", "ALTENGAMME", 53.43, 10.3)] };
    const match = replacement(
      record("altengamme-5930070-deu-wsv", { lat: 53.43, lon: 10.29 }),
      lists,
    );
    assert.equal(match.id, "pegelonline/5930070");
    assert.equal(match.status, "ready");
  });

  it("matches RWS and CMEMS records by position, with a name check beyond 1 km", () => {
    const lists = {
      rws: [
        station("rws/a12", "A12 platform", 55.4, 3.84),
        station("rws/hollandsdiep.noordwest2", "Hollandsdiep noordwest 2", 51.7, 4.4),
      ],
    };
    const a12 = record("a121tg-a12-nld-cmems", { name: "A121TG", lat: 55.4, lon: 3.81 });
    assert.equal(replacement(a12, lists).id, "rws/a12");
    // Sharing only "noord" isn't enough to match 1.8 km away.
    const rak = record("rak_noord-raknd-nld-rws_hist", {
      name: "Rak_noord",
      lat: 51.7,
      lon: 4.426,
    });
    assert.equal(replacement(rak, lists).status, "unmatched");
  });

  it("pads USGS site numbers TICON shortened", () => {
    assert.equal(
      replacement(record("abercorn_creek_at_mouth-2198820-usa-usgs"), {}).id,
      "usgs/02198820",
    );
    assert.equal(replacement(record("x-394118122051301-usa-usgs"), {}).id, "usgs/394118122051301");
  });

  it("finds a 9-digit USGS site TICON shortened to 8, once USGS lists it", () => {
    const lists = {
      usgs: [
        station("usgs/021720825", "Ashley River", 32.9, -80.1),
        station("usgs/02198820", "Abercorn Creek", 32.2, -81.2),
      ],
    };
    const ashley = record("ashley-21720825-usa-usgs", { lat: 32.9, lon: -80.1 });
    assert.deepEqual(
      [replacement(ashley, lists).id, replacement(ashley, lists).status],
      ["usgs/021720825", "ready"],
    );
    const abercorn = record("abercorn_creek_at_mouth-2198820-usa-usgs", { lat: 32.2, lon: -81.2 });
    assert.equal(replacement(abercorn, lists).id, "usgs/02198820");
    assert.equal(replacement(record("x-11006988-usa-usgs"), lists).status, "unmatched");
    // When USGS has both an 8-digit site and the 9-digit one with a zero in front, the nearer is the gauge.
    const both = { usgs: [station("usgs/21720825", "Elsewhere", 45, -100), ...lists.usgs] };
    assert.equal(replacement(ashley, both).id, "usgs/021720825");
  });

  it("restores USGS site numbers to 8, 10 or 15 digits", () => {
    assert.deepEqual(["2198820", "158540095", "39411812205130", "12345678"].map(usgsSite), [
      "02198820",
      "0158540095",
      "039411812205130",
      "12345678",
    ]);
  });

  it("holds CMEMS copies back until they match a station of the national feed", () => {
    const match = replacement(record("goteborgtg-got-swe-cmems"), {});
    assert.deepEqual([match.source, match.status], ["smhi", "to_match"]);
    // Without the national list to match against, even a source with an adapter isn't ready.
    const dutch = replacement(record("x-y-nld-cmems"), {});
    assert.deepEqual([dutch.status, dutch.id], ["to_match", null]);
  });

  it("matches SMHI records by station number and Marine Institute records by place", () => {
    const smhi = replacement(record("arko-2545-swe-smhi"), {});
    assert.deepEqual([smhi.id, smhi.status], ["smhi/2545", "planned"]);
    const listed = replacement(record("arko-2545-swe-smhi", { lat: 58.48, lon: 16.96 }), {
      smhi: [station("smhi/2545", "Arkö", 58.48, 16.96)],
    });
    assert.deepEqual([listed.id, listed.status], ["smhi/2545", "ready"]);
    const irish = replacement(
      record("ballycotton_harbour-bal-irl-mi_c", {
        name: "Ballycotton_Harbour",
        lat: 51.83,
        lon: -8.0,
      }),
      {
        "marine-institute": [
          station("marine-institute/ballycotton", "Ballycotton Harbour", 51.83, -8.0),
        ],
      },
    );
    assert.deepEqual([irish.id, irish.status], ["marine-institute/ballycotton", "ready"]);
    // River gauges aren't in the coastal list, however close a coastal gauge is.
    const river = replacement(
      record("wolftone_bridge-wol-irl-mi_r", { name: "Wolftone_Bridge", lat: 53.27, lon: -9.05 }),
      {
        "marine-institute": [station("marine-institute/galway-port", "Galway Port", 53.27, -9.05)],
      },
    );
    assert.deepEqual([river.id, river.status], [null, "unmatched"]);
  });

  it("checks Kartverket records against its list once there is one", () => {
    const bergen = record("bergen-bgo-nor-nhs", { lat: 60.4, lon: 5.3 });
    assert.deepEqual(replacement(bergen, {}).status, "planned");
    const listed = replacement(bergen, {
      kartverket: [station("kartverket/BGO", "Bergen", 60.4, 5.3)],
    });
    assert.deepEqual([listed.id, listed.status], ["kartverket/BGO", "ready"]);
    assert.equal(replacement(bergen, { kartverket: [] }).status, "unmatched");
  });

  it("doesn't count an inactive PEGELONLINE station as ready", () => {
    const gone = {
      ...station("pegelonline/5930070", "ALTENGAMME", 53.43, 10.3),
      status: "inactive" as const,
    };
    const match = replacement(record("altengamme-5930070-deu-wsv", { lat: 53.43, lon: 10.3 }), {
      pegelonline: [gone],
    });
    assert.equal(match.status, "unmatched");
  });

  it("tells an outer harbor from an inner one, and won't guess between them", () => {
    const lists = {
      rws: [
        station(
          "rws/kornwerderzand.ijsselmeer.binnenhaven",
          "Kornwerderzand, IJsselmeer, binnenhaven",
          53.0727,
          5.3365,
        ),
        station(
          "rws/kornwerderzand.waddenzee.buitenhaven",
          "Kornwerderzand, Waddenzee, buitenhaven",
          53.0759,
          5.3324,
        ),
      ],
    };
    const at = { lat: 53.0742, lon: 5.3362 };
    const outer = replacement(
      record("kornwerderzand_buiten-kornwdzbtn-nld-rws_hist", {
        name: "Kornwerderzand_buiten",
        ...at,
      }),
      lists,
    );
    assert.equal(outer.id, "rws/kornwerderzand.waddenzee.buitenhaven");
    const either = replacement(
      record("kornwerderzandtg-kor-nld-cmems", { name: "KornwerderzandTG", ...at }),
      lists,
    );
    assert.equal(either.status, "unmatched");
    assert.match(either.note!, /Ambiguous/);
    // A station at the record's own position wins outright.
    const exact = replacement(
      record("kornwerderzandtg-kor-nld-cmems", {
        name: "KornwerderzandTG",
        lat: 53.0727,
        lon: 5.3365,
      }),
      lists,
    );
    assert.equal(exact.id, "rws/kornwerderzand.ijsselmeer.binnenhaven");
  });

  it("takes a LINKS entry for a CMEMS record over the station at its position", () => {
    // CMEMS places its copy of Wangerooge West 40 m from Wangerooge Nord.
    const lists = {
      pegelonline: [
        station("pegelonline/9420030", "WANGEROOGE NORD", 53.806299, 7.9292),
        station("pegelonline/9420040", "WANGEROOGE WEST", 53.776238, 7.867938),
      ],
    };
    const match = replacement(
      record("wangeroogetg-wan-deu-cmems", { name: "WangeroogeTG", lat: 53.806, lon: 7.929 }),
      lists,
    );
    assert.deepEqual([match.id, match.distance_km], ["pegelonline/9420040", 5.2]);
    // With West gone, Nord at the record's position is still the wrong gauge.
    const stale = replacement(
      record("wangeroogetg-wan-deu-cmems", { name: "WangeroogeTG", lat: 53.806, lon: 7.929 }),
      { pegelonline: lists.pegelonline.slice(0, 1) },
    );
    assert.deepEqual([stale.id, stale.status], [null, "to_match"]);
    // A link to another GESLA record names no national station, so position still decides.
    const meetpaal = replacement(
      record("eemsmeetpaaltg-eem-nld-cmems", { name: "EemsMeetpaalTG", lat: 53.45, lon: 6.83 }),
      { rws: [station("rws/eemshaven.waddenzee", "Eemshaven Waddenzee", 53.451, 6.83)] },
    );
    assert.equal(meetpaal.id, "rws/eemshaven.waddenzee");
  });

  it("prefers a station sharing the place name over a nearer one sharing only common words", () => {
    const lists = {
      rws: [
        station("rws/x.haven.buiten", "X haven buiten", 53.0, 5.0),
        station("rws/harlingen", "Harlingen", 53.0, 5.05),
      ],
    };
    const match = replacement(
      record("harlingen_haven_buiten-h-nld-rws", {
        name: "Harlingen haven buiten",
        lat: 53.0,
        lon: 5.012,
      }),
      lists,
    );
    assert.equal(match.id, "rws/harlingen");
  });

  it("sends a JODC relay of a NOAA gauge to CO-OPS as planned", () => {
    const relay = record("x-hd01-jpn-jodc_jcg", { declared: "noaa/1234567" });
    assert.deepEqual(
      [replacement(relay, {}).id, replacement(relay, {}).status],
      ["coops/1234567", "planned"],
    );
  });

  it("sends a UK gauge to BODC whether CMEMS or BODC relays it", () => {
    const cmems = replacement(record("aberdeen-abe-gbr-cmems"), {});
    const bodc = replacement(record("aberdeen-abe-gbr-bodc"), {});
    assert.deepEqual([cmems.source, cmems.status], ["bodc", "to_match"]);
    assert.deepEqual([bodc.source, bodc.status], ["bodc", "planned"]);
  });

  it("matches BODC and UK CMEMS records to the EA's gauge once its list is there", () => {
    const at = { lat: 57.144, lon: -2.08 };
    assert.equal(replacement(record("aberdeen-abe-gbr-bodc", at), {}).status, "planned");
    const lists = { ea: [station("ea/E70739", "Aberdeen", 57.14406, -2.08013)] };
    for (const id of ["aberdeen-abe-gbr-bodc", "aberdeen-abe-gbr-cmems"]) {
      const match = replacement(record(id, at), lists);
      assert.deepEqual([match.id, match.status], ["ea/E70739", "ready"]);
    }
    // NOC's gauges outside the UK network aren't in BODC's open data.
    const ascension = replacement(
      record("ascension-asc-gbr-noc", { lat: -7.9, lon: -14.4 }),
      lists,
    );
    assert.deepEqual([ascension.source, ascension.status], ["bodc", "restricted"]);
  });

  it("matches an unmatched record through its slackwater-database station", () => {
    const rows = adoptSiblings([
      {
        record: record("a-1-nld-rws", { station: "nl/a" }),
        replacement: { source: "rws", id: "rws/a", status: "ready" as const },
      },
      {
        record: record("atg-a-nld-cmems", { station: "nl/a" }),
        replacement: { source: "rws", id: null, status: "unmatched" as const, note: "why" },
      },
      {
        record: record("btg-b-nld-cmems", { station: "nl/b" }),
        replacement: { source: "rws", id: null, status: "unmatched" as const },
      },
    ]);
    assert.equal(rows[1]!.replacement.id, "rws/a");
    assert.match(
      rows[1]!.replacement.note!,
      /^Same slackwater-database station as a-1-nld-rws; why/,
    );
    assert.equal(rows[2]!.replacement.status, "unmatched");
  });

  it("keeps restricted contributors on TICON", () => {
    assert.equal(replacement(record("victoria-07120-can-meds"), {}).status, "restricted");
  });
});

describe("sharesWord", () => {
  it("finds a word inside a run-together name", () => {
    assert.ok(sharesWord("KielHoltenauTG", "KIEL-HOLTENAU"));
  });

  it("matches German transliterations", () => {
    assert.ok(sharesWord("WarnemuendeTG", "WARNEMÜNDE"));
  });

  it("spells out letters that don't decompose", () => {
    assert.ok(sharesWord("Maloy", "Måløy"));
    assert.ok(sharesWord("Hornbaek", "Hornbæk"));
    assert.ok(sharesWord("Strasse", "Straße"));
  });

  it("ignores directions and harbor words", () => {
    assert.ok(!sharesWord("Rak noord", "Hollandsdiep noordwest"));
    assert.ok(!sharesWord("Oude haven", "Nieuwe haven"));
  });
});
