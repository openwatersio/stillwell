import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { writeOffsets, writeStations } from "../src/store/parquet.ts";
import {
  offsetRows,
  replacements,
  tideStations,
  withDatums,
  type TideStation,
} from "../src/datums.ts";
import type { Epoch, StoredStation } from "../src/schema.ts";

/** One open epoch in `datum`. */
const open = (datum: string, fields: Partial<Epoch> = {}): Epoch => ({
  id: 1,
  datum,
  since: null,
  until: null,
  seen: null,
  reference: null,
  reference_since: null,
  datums: {},
  to_current: 0,
  state: "open",
  ...fields,
});

/** A station at `source/id`, with one open epoch in its datum unless `epochs` says otherwise. */
const station = (id: string, fields: Partial<StoredStation> = {}): StoredStation => {
  const [source, source_id] = id.split("/") as [string, string];
  const datum = fields.datum ?? "ZERO";
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
    datum,
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
    epochs: [open(datum)],
    ...fields,
  };
};

const tide = (id: string, fields: Partial<TideStation> = {}): TideStation => ({
  id,
  source: { id: id.slice(id.indexOf("/") + 1) },
  latitude: 0,
  longitude: 0,
  datums: {},
  license: { commercial_use: true },
  attribution: `credit for ${id}`,
  ...fields,
});

/** A level in a station's datum, referred to another of its datums. */
const convert = (s: StoredStation, level: number, datum: string) => level + s.datums[datum]!;

const round4 = (m: number) => Math.round(m * 1e4) / 1e4;

const byId = (stations: StoredStation[], id: string) => stations.find((s) => s.id === id)!;

// Operator values are the operators' own APIs and tables, read 2026-11-12.
describe("withDatums against operators' published levels", () => {
  it("converts CO-OPS Seattle from STND as CO-OPS does", () => {
    const seattle = station("coops/9447130", {
      datum: "STND",
      datums: { MSL: -4.443, MLLW: -2.419, NAVD88: -3.134 },
    });
    const record = tide("noaa/9447130", {
      datums: { STND: 0, MSL: 4.443, MLLW: 2.419, LAT: 1.1089039 },
      chart_datum: "MLLW",
      epoch: { start: "1983-01-01", end: "2001-12-31" },
    });
    const [s] = withDatums([seattle], [record]).stations;
    // CO-OPS water_level for 2026-11-01 00:00 UTC: 4.994 STND, 2.574 MLLW, 0.551 MSL.
    assert.ok(Math.abs(convert(s!, 4.994, "MLLW") - 2.574) <= 0.0015);
    assert.ok(Math.abs(convert(s!, 4.994, "MSL") - 0.551) <= 0.0015);
    assert.equal(s!.chart_datum, "MLLW");
    assert.equal(s!.frame, "gauge");
    assert.equal(s!.tide_station, "noaa/9447130");
    assert.deepEqual(s!.datums_source, {
      MSL: "slackwater-database",
      MLLW: "slackwater-database",
      LAT: "slackwater-database",
      NAVD88: "source",
    });
    assert.deepEqual(s!.datums_epoch!.MSL, { start: "1983-01-01", end: "2001-12-31" });
  });

  it("converts Kartverket Bergen from chart datum as Kartverket does", () => {
    const bergen = station("kartverket/BGO", {
      datum: "CD",
      datums: { NN2000: -1.022, MSL: -0.952 },
    });
    const record = tide("kartverket/BGO", {
      datums: { CD: 0, LAT: 0, MSL: 0.952, NN2000: 1.022 },
      chart_datum: "CD",
    });
    const [s] = withDatums([bergen], [record]).stations;
    // Kartverket's observation at 2026-11-01 00:00 UTC: 113.1 cm above CD, 17.9 cm above MSL.
    assert.ok(Math.abs(convert(s!, 1.131, "MSL") - 0.179) <= 0.0005);
    // Already in chart datum, and slackwater-database's record is the same series.
    assert.equal(s!.chart_datum, "CD");
    assert.equal(s!.frame, "gauge");
  });

  it("gives a PEGELONLINE gauge BSH's SKN through NHN", () => {
    // BSH: Cuxhaven Steubenhöft's PNP is 5.03 m below NHN, SKN 3.02 m above PNP.
    const bsh = station("bsh/506P", {
      datum: "PNP",
      datums: { NHN: -5.03, SKN: -3.02 },
      same_as: ["pegelonline/5990020"],
    });
    // PEGELONLINE gives the same gauge's zero as NHN −5.033 m.
    const wsv = station("pegelonline/5990020", {
      datum: "PNP",
      datums: { NHN: -5.033 },
      same_as: ["bsh/506P"],
    });
    const s = byId(withDatums([bsh, wsv], []).stations, "pegelonline/5990020");
    assert.ok(Math.abs(convert(s, 8, "SKN") - (8 - 3.02)) <= 0.005);
    assert.equal(s.datums_source!.SKN, "computed");
    assert.equal(s.chart_datum, "SKN");
    assert.equal(s.frame, "source");
  });

  it("gives an EA gauge chart datum, MSL and LAT through BODC's record of it", () => {
    // NTSLF: Aberdeen's Admiralty Chart Datum is 2.25 m below ODN.
    const ea = station("ea/E70739", {
      datum: "AOD",
      same_as: ["bodc/abe", "gesla/aberdeen-abe-gbr-bodc"],
    });
    const bodc = station("bodc/abe", {
      datum: "CD",
      datums: { AOD: -2.25 },
      same_as: ["ea/E70739", "gesla/aberdeen-abe-gbr-bodc"],
    });
    const gesla = station("gesla/aberdeen-abe-gbr-bodc", {
      same_as: ["ea/E70739", "bodc/abe"],
      datum_information: "Admiralty Chart Datum (ACD)",
    } as Partial<StoredStation>);
    const record = tide("ticon/aberdeen-abe-gbr-bodc", {
      datums: { MSL: 2.608, LAT: 0.062 },
      datum_frame: "gauge",
      chart_datum: "LAT",
      datum_epoch: { start: "2007-11-01", end: "2008-10-31" },
    });
    const out = withDatums([ea, bodc, gesla], [record]).stations;
    const s = byId(out, "ea/E70739");
    // 1 m above ODN is 3.25 m above chart datum, and MSL is 2.608 m above chart datum.
    assert.ok(Math.abs(convert(s, 1, "MSL") - (3.25 - 2.608)) <= 0.0005);
    assert.ok(Math.abs(convert(s, 1, "LAT") - (3.25 - 0.062)) <= 0.0005);
    assert.equal(s.datums_source!.MSL, "computed");
    assert.deepEqual(s.datums_epoch!.MSL, { start: "2007-11-01", end: "2008-10-31" });
    assert.equal(s.tide_station, "ticon/aberdeen-abe-gbr-bodc");
    // Its chart datum is BODC's own, Admiralty Chart Datum: 1 m above ODN is 3.25 m above it.
    assert.equal(s.chart_datum, "CD");
    assert.ok(Math.abs(convert(s, 1, "CD") - 3.25) <= 0.0005);
    assert.deepEqual(s.datums_attribution, ["credit for ticon/aberdeen-abe-gbr-bodc"]);
    assert.equal(s.frame, "source");
    assert.equal(byId(out, "gesla/aberdeen-abe-gbr-bodc").frame, "gauge");
  });
});

describe("withDatums", () => {
  // TICON's RWS records are in NAP, and the inventory names their RWS series.
  const amaliahaven = (epochs?: Epoch[], period = { start: "2014-01-01", end: "2014-12-31" }) => {
    const rws = station("rws/maasvlakte.amaliahaven", {
      datum: "NAP",
      ...(epochs ? { epochs } : {}),
    });
    const record = tide("ticon/amaliahaven-amlahvn-nld-rws", {
      datums: { MSL: 0.028, LAT: -1.207 },
      datum_frame: "gauge",
      chart_datum: "LAT",
      datum_epoch: period,
    });
    const csv = [
      "ticon_id,replacement_id,distance_km",
      "amaliahaven-amlahvn-nld-rws,rws/maasvlakte.amaliahaven,0",
    ].join("\n");
    return withDatums([rws], [record], replacements(csv)).stations[0]!;
  };
  const oldNap = open("NAP", {
    until: "2005-01-01T00:00:00.000Z",
    to_current: null,
    state: "closed",
  });
  const newNap = open("NAP", { id: 2, since: "2005-01-01T00:00:00.000Z" });

  it("takes a TICON RWS record's datums in NAP for the RWS series the inventory names", () => {
    const s = amaliahaven();
    assert.deepEqual(s.datums, { MSL: -0.028, LAT: 1.207 });
    assert.equal(s.chart_datum, "LAT");
    assert.equal(s.frame, "gauge");
  });

  it("uses datums reduced after an epoch that doesn't convert", () => {
    assert.equal(amaliahaven([oldNap, newNap]).datums.MSL, -0.028);
  });

  it("leaves out datums reduced over an epoch that doesn't convert", () => {
    const s = amaliahaven([oldNap, newNap], { start: "2000-09-01", end: "2018-08-31" });
    assert.deepEqual(s.datums, {});
    assert.equal(s.frame, "unknown");
  });

  it("drops a join to a record more than 10 km away", () => {
    const gesla = station("gesla/port_stanley-290a-gbr-uhslc_rq", { lat: -51.69, lon: -57.865 });
    const record = tide("ticon/port_stanley-290a-gbr-uhslc_rq", {
      latitude: -52.7,
      longitude: -57.867,
      datums: { MSL: 1 },
      datum_frame: "gauge",
    });
    const { stations, report } = withDatums([gesla], [record]);
    assert.equal(stations[0]!.tide_station, null);
    assert.deepEqual(stations[0]!.datums, {});
    assert.equal(report.far.length, 1);
  });

  it("leaves a record in the constituent frame out", () => {
    const gesla = station("gesla/a-1-x-uhslc_fd");
    const record = tide("ticon/a-1-x-uhslc_fd", { datums: { MSL: 0 }, datum_frame: "constituent" });
    const [s] = withDatums([gesla], [record]).stations;
    assert.deepEqual(s!.datums, {});
    // Still the gauge's slackwater-database station.
    assert.equal(s!.tide_station, "ticon/a-1-x-uhslc_fd");
  });

  it("links a duplicate record's series to the station that replaces it", () => {
    const gesla = station("gesla/a-1-x-uhslc_rq", { same_as: ["uhslc/1"] });
    const uhslc = station("uhslc/1", { same_as: ["gesla/a-1-x-uhslc_rq"] });
    const record = tide("ticon/a-1-x-uhslc_rq", {
      datums: { MSL: 1, LAT: 0 },
      datum_frame: "gauge",
      chart_datum: "LAT",
      redundant: "ticon/a-1-x-uhslc_fd",
    });
    const out = withDatums([gesla, uhslc], [record]).stations;
    const s = byId(out, "gesla/a-1-x-uhslc_rq");
    assert.equal(s.tide_station, "ticon/a-1-x-uhslc_fd");
    assert.equal(s.datums.MSL, -1);
    // Its datums are another record's than the one predicting for it.
    assert.equal(s.frame, "source");
    assert.equal(byId(out, "uhslc/1").tide_station, "ticon/a-1-x-uhslc_fd");
  });

  it("reports where slackwater-database and the source disagree", () => {
    const s = station("coops/1", { datum: "STND", datums: { MSL: -1 } });
    const record = tide("noaa/1", { datums: { STND: 0, MSL: 1.2 } });
    assert.deepEqual(withDatums([s], [record]).report.disagree, [
      "coops/1 MSL: source -1, noaa/1 -1.2",
    ]);
  });
});

describe("withDatums with terms, epochs and frames", () => {
  it("gives an EA gauge BODC's chart datum with no slackwater-database record", () => {
    const ea = station("ea/E70739", { datum: "AOD", same_as: ["bodc/abe"] });
    const bodc = station("bodc/abe", {
      datum: "CD",
      datums: { AOD: -2.25 },
      same_as: ["ea/E70739"],
      attribution: "British Oceanographic Data Centre",
    });
    const s = byId(withDatums([ea, bodc], []).stations, "ea/E70739");
    assert.deepEqual(s.datums, { CD: 2.25 });
    assert.equal(s.chart_datum, "CD");
    // BODC's offsets are used, so its credit goes with them.
    assert.deepEqual(s.datums_attribution, ["British Oceanographic Data Centre"]);
  });

  it("keeps a record that bars commercial use from a station that allows it", () => {
    const gesla = station("gesla/a-1-x-cmems");
    const record = tide("ticon/a-1-x-cmems", {
      datums: { MSL: 1 },
      datum_frame: "gauge",
      license: { commercial_use: false },
    });
    assert.deepEqual(withDatums([gesla], [record]).stations[0]!.datums, {});
    const restricted = station("gesla/a-1-x-cmems", { commercial_use: false });
    assert.deepEqual(withDatums([restricted], [record]).stations[0]!.datums, { MSL: -1 });
  });

  it("carries nothing from a series that bars commercial use to one that allows it", () => {
    const rws = station("rws/x", { datum: "NAP", same_as: ["gesla/x-1-nld-cmems"] });
    const gesla = station("gesla/x-1-nld-cmems", {
      commercial_use: false,
      same_as: ["rws/x"],
      datum_information: "Normal Amsterdam Level",
    } as Partial<StoredStation>);
    const record = tide("ticon/x-1-nld-cmems", {
      datums: { MSL: 0.1 },
      datum_frame: "gauge",
      license: { commercial_use: false },
    });
    const out = withDatums([rws, gesla], [record]).stations;
    assert.deepEqual(byId(out, "gesla/x-1-nld-cmems").datums, { MSL: -0.1 });
    assert.deepEqual(byId(out, "rws/x").datums, {});
  });

  it("carries nothing reduced over an epoch of the receiving series that doesn't convert", () => {
    const rws = station("rws/x", {
      datum: "NAP",
      same_as: ["gesla/x-1-nld-rws_hist"],
      epochs: [
        open("NAP", { until: "2005-01-01T00:00:00.000Z", to_current: null, state: "closed" }),
        open("NAP", { id: 2, since: "2005-01-01T00:00:00.000Z" }),
      ],
    });
    const gesla = station("gesla/x-1-nld-rws_hist", {
      same_as: ["rws/x"],
      datum_information: "Normal Amsterdam Level",
    } as Partial<StoredStation>);
    const record = tide("ticon/x-1-nld-rws_hist", {
      datums: { MSL: 0.1 },
      datum_frame: "gauge",
      datum_epoch: { start: "2000-01-01", end: "2018-12-31" },
    });
    const out = withDatums([rws, gesla], [record]).stations;
    assert.deepEqual(byId(out, "gesla/x-1-nld-rws_hist").datums, { MSL: -0.1 });
    assert.deepEqual(byId(out, "rws/x").datums, {});
  });

  it("leaves out datums reduced over an epoch that converts by more than 5 cm, or overlaps the period's first day", () => {
    const epochs = (to_current: number, until: string) => [
      open("ZERO", { until, to_current, state: "closed" }),
      open("ZERO", { id: 2, since: until }),
    ];
    const record = tide("ticon/x-1-y-uhslc_fd", {
      datums: { MSL: 2 },
      datum_frame: "gauge",
      datum_epoch: { start: "2000-01-01", end: "2001-12-31" },
    });
    const msl = (e: Epoch[]) =>
      withDatums([station("gesla/x-1-y-uhslc_fd", { epochs: e })], [record]).stations[0]!.datums
        .MSL;
    assert.equal(msl(epochs(0.03, "2010-01-01T00:00:00.000Z")), -2);
    // 5 cm exactly, though the float from a difference of offsets is a hair over.
    assert.equal(msl(epochs(0.1 - 0.05 + 1e-15, "2010-01-01T00:00:00.000Z")), -2);
    assert.equal(msl(epochs(1, "2010-01-01T00:00:00.000Z")), undefined);
    // An epoch that ends as the period starts doesn't overlap it; one that ends in its first day does.
    assert.equal(msl(epochs(1, "2000-01-01T00:00:00.000Z")), -2);
    assert.equal(msl(epochs(1, "2000-01-01T06:00:00.000Z")), undefined);
    // A period's last date is a whole day, so an epoch that starts during it overlaps it.
    const later = (since: string) => [
      open("ZERO", { until: since, state: "closed" }),
      open("ZERO", {
        id: 2,
        since,
        until: "2010-01-01T00:00:00.000Z",
        to_current: null,
        state: "closed",
      }),
      open("ZERO", { id: 3, since: "2010-01-01T00:00:00.000Z" }),
    ];
    assert.equal(msl(later("2001-12-31T06:00:00.000Z")), undefined);
    assert.equal(msl(later("2002-01-01T00:00:00.000Z")), -2);
  });

  it("calls a station's frame its source's when its record's datums were left out", () => {
    const bergen = station("kartverket/BGO", {
      datum: "CD",
      datums: { MSL: -0.952 },
      epochs: [
        open("CD", { until: "2010-01-01T00:00:00.000Z", to_current: null, state: "closed" }),
        open("CD", { id: 2, since: "2010-01-01T00:00:00.000Z" }),
      ],
    });
    const record = tide("kartverket/BGO", {
      datums: { CD: 0, MSL: 0.952 },
      chart_datum: "CD",
      epoch: { start: "2006-01-01", end: "2020-12-31" },
    });
    const [s] = withDatums([bergen], [record]).stations;
    assert.equal(s!.chart_datum, "CD");
    assert.equal(s!.frame, "source");
    assert.equal(s!.datums_source!.MSL, "source");
  });

  it("leaves a record in the constituent frame out whatever its source", () => {
    const s = station("coops/1", { datum: "STND" });
    const record = tide("noaa/1", { datums: { STND: 0, MSL: 0 }, datum_frame: "constituent" });
    assert.deepEqual(withDatums([s], [record]).stations[0]!.datums, {});
  });
});

describe("withDatums with two records for a station", () => {
  it("takes the record whose datums it can use, whichever comes first", () => {
    const rws = station("rws/vlissingen", {
      datum: "NAP",
      epochs: [
        open("NAP", { until: "2005-01-01T00:00:00.000Z", to_current: null, state: "closed" }),
        open("NAP", { id: 2, since: "2005-01-01T00:00:00.000Z" }),
      ],
    });
    const hist = tide("ticon/vlissingen-vlissgn-nld-rws_hist", {
      datums: { MSL: 0.02 },
      datum_frame: "gauge",
      datum_epoch: { start: "2000-09-01", end: "2018-08-31" },
    });
    const recent = tide("ticon/vlissingen-vlis-nld-rws", {
      datums: { MSL: 0.03 },
      datum_frame: "gauge",
      datum_epoch: { start: "2023-01-01", end: "2025-12-31" },
    });
    const csv = [
      "ticon_id,replacement_id,distance_km",
      "vlissingen-vlissgn-nld-rws_hist,rws/vlissingen,0",
      "vlissingen-vlis-nld-rws,rws/vlissingen,0",
      "vlissingen-x-nld-rws,rws/vlissingen,",
    ].join("\n");
    for (const order of [
      [hist, recent],
      [recent, hist],
    ]) {
      const [s] = withDatums([rws], order, replacements(csv)).stations;
      assert.equal(s!.datums.MSL, -0.03);
      assert.equal(s!.tide_station, "ticon/vlissingen-vlis-nld-rws");
    }
    // A row with no distance isn't a match.
    assert.equal(replacements(csv).has("vlissingen-x-nld-rws"), false);
  });

  it("credits every record whose values a station holds", () => {
    const a = station("gesla/a-1-x-uhslc_fd", { same_as: ["gesla/b-2-x-bodc"] });
    const b = station("gesla/b-2-x-bodc", {
      same_as: ["gesla/a-1-x-uhslc_fd"],
      datum_information: "Admiralty Chart Datum",
    } as Partial<StoredStation>);
    const ea = station("ea/1", { datum: "CD", same_as: ["gesla/b-2-x-bodc"] });
    const records = [
      tide("ticon/a-1-x-uhslc_fd", { datums: { MSL: 1 }, datum_frame: "gauge" }),
      tide("ticon/b-2-x-bodc", { datums: { MSL: 2, LAT: 0.1 }, datum_frame: "gauge" }),
    ];
    const out = withDatums([a, b, { ...ea, same_as: ["gesla/b-2-x-bodc"] }], records).stations;
    assert.deepEqual(byId(out, "ea/1").datums_attribution, ["credit for ticon/b-2-x-bodc"]);
    assert.deepEqual(byId(out, "gesla/a-1-x-uhslc_fd").datums_attribution, [
      "credit for ticon/a-1-x-uhslc_fd",
    ]);
  });
});

describe("withDatums through the TICON inventory", () => {
  const csv = "ticon_id,replacement_id,distance_km\nk13a-k13-nld-rws,rws/k13a.platform,0";
  const record = tide("ticon/k13a-k13-nld-rws", { datums: { MSL: 0.1 }, datum_frame: "gauge" });
  const rws = station("rws/k13a.platform", { datum: "NAP" });

  it("joins nothing where the record's GESLA file says it's in another zero", () => {
    const gesla = station("gesla/k13a-k13-nld-rws", {
      datum_information: "Mean sea level",
    } as Partial<StoredStation>);
    const out = withDatums([rws, gesla], [record], replacements(csv)).stations;
    assert.deepEqual(byId(out, "rws/k13a.platform").datums, {});
  });

  it("takes a record with no reduction period only where every epoch converts", () => {
    const closed = open("NAP", {
      until: "2005-01-01T00:00:00.000Z",
      to_current: null,
      state: "closed",
    });
    const later = open("NAP", { id: 2, since: "2005-01-01T00:00:00.000Z" });
    assert.equal(withDatums([rws], [record], replacements(csv)).stations[0]!.datums.MSL, -0.1);
    const split = { ...rws, epochs: [closed, later] };
    assert.deepEqual(withDatums([split], [record], replacements(csv)).stations[0]!.datums, {});
  });
});

describe("withDatums across a distance", () => {
  it("carries SKN along a link of any length, but MSL only within 1 km", () => {
    // About 2.7 km apart, as BSH's and PEGELONLINE's Geesthacht are.
    const bsh = station("bsh/732D", {
      datum: "PNP",
      lat: 53.42333,
      lon: 10.33472,
      datums: { NHN: -5.02, SKN: -4.21, MSL: -6 },
      same_as: ["pegelonline/5930060"],
    });
    const wsv = station("pegelonline/5930060", {
      datum: "PNP",
      lat: 53.426505,
      lon: 10.374522,
      datums: { NHN: -0.024 },
      same_as: ["bsh/732D"],
    });
    const s = byId(withDatums([bsh, wsv], []).stations, "pegelonline/5930060");
    assert.equal(s.datums.SKN, round4(-0.024 + 5.02 - 4.21));
    assert.equal(s.datums.MSL, undefined);
  });
});

describe("withDatums with records it can't trust", () => {
  it("joins nothing to a GESLA file whose values are another gauge's", () => {
    const smhi = station("smhi/2541", { datum: "RH2000" });
    const record = tide("ticon/uddevalla-2541-swe-smhi", {
      datums: { MSL: 0.1 },
      datum_frame: "gauge",
    });
    const csv = "ticon_id,replacement_id,distance_km\nuddevalla-2541-swe-smhi,smhi/2541,0.75";
    const [s] = withDatums([smhi], [record], replacements(csv)).stations;
    assert.deepEqual(s!.datums, {});
    assert.equal(s!.tide_station, null);
  });

  it("calls the frame unknown when the tide station's datums are in the constituent frame", () => {
    const coops = station("coops/1", { datum: "STND", datums: { MLLW: -1 } });
    const record = tide("noaa/1", { datums: { MSL: 0, MLLW: -1 }, datum_frame: "constituent" });
    const [s] = withDatums([coops], [record]).stations;
    assert.equal(s!.chart_datum, "MLLW");
    assert.equal(s!.frame, "unknown");
  });

  it("drops a join to a record with no position", () => {
    const gesla = station("gesla/a-1-x-uhslc_fd");
    const record = tide("ticon/a-1-x-uhslc_fd", {
      latitude: NaN,
      datums: { MSL: 1 },
      datum_frame: "gauge",
    });
    assert.equal(withDatums([gesla], [record]).report.far.length, 1);
  });

  it("breaks a tie between usable records by the later reduction", () => {
    const rws = station("rws/x", { datum: "NAP" });
    const record = (id: string, end: string, msl: number) =>
      tide(id, {
        datums: { MSL: msl },
        datum_frame: "gauge",
        datum_epoch: { start: "2000-01-01", end },
      });
    const older = record("ticon/x-a-nld-rws", "2010-12-31", 0.1);
    const newer = record("ticon/x-b-nld-rws", "2020-12-31", 0.2);
    const csv = "ticon_id,replacement_id,distance_km\nx-a-nld-rws,rws/x,0\nx-b-nld-rws,rws/x,0";
    for (const order of [
      [older, newer],
      [newer, older],
    ])
      assert.equal(withDatums([rws], order, replacements(csv)).stations[0]!.datums.MSL, -0.2);
  });
});

describe("the published files", () => {
  it("write and read back a station's datums and offsets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "datums-"));
    try {
      const [s] = withDatums(
        [station("coops/9447130", { datum: "STND", datums: { NAVD88: -3.134 } })],
        [
          tide("noaa/9447130", {
            datums: { STND: 0, MSL: 4.443, MLLW: 2.419 },
            chart_datum: "MLLW",
            epoch: { start: "1983-01-01", end: "2001-12-31" },
          }),
        ],
      ).stations;
      await writeStations(join(dir, "stations.parquet"), [s!]);
      await writeOffsets(join(dir, "offsets.parquet"), offsetRows(s!));
      const db = await (await DuckDBInstance.create(":memory:")).connect();
      const [row] = (
        await db.runAndReadAll(
          `SELECT chart_datum, frame, datums_source['MSL'] AS msl_source, strftime(datums_epoch['MSL'].start, '%Y-%m-%d') AS msl_start, datums_attribution FROM '${join(dir, "stations.parquet")}'`,
        )
      ).getRowObjectsJson();
      assert.deepEqual(row, {
        chart_datum: "MLLW",
        frame: "gauge",
        msl_source: "slackwater-database",
        msl_start: "1983-01-01",
        datums_attribution: ["credit for noaa/9447130"],
      });
      const offsets = (
        await db.runAndReadAll(`SELECT datum, offset_m FROM '${join(dir, "offsets.parquet")}'`)
      ).getRowObjectsJson();
      assert.deepEqual(offsets, [
        { datum: "MLLW", offset_m: -2.419 },
        { datum: "MSL", offset_m: -4.443 },
        { datum: "NAVD88", offset_m: -3.134 },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("tideStations", () => {
  it("reads the installed slackwater-database, with its copies' replacements", async () => {
    const all = await tideStations();
    const seattle = all.find((t) => t.id === "noaa/9447130")!;
    assert.equal(seattle.source.id, "9447130");
    assert.equal(seattle.datums.STND, 0);
    assert.equal(seattle.license.commercial_use, true);
    assert.ok(all.some((t) => typeof t.redundant === "string"));
    assert.ok(all.some((t) => t.redundant === null));
    // The shapes the joins rely on, so a database update that changes them fails here.
    const aberdeen = all.find((t) => t.id === "ticon/aberdeen-abe-gbr-bodc")!;
    assert.equal(aberdeen.source.id, "aberdeen-abe-gbr-bodc");
    assert.equal(aberdeen.datum_frame, "gauge");
    assert.equal(all.find((t) => t.id === "kartverket/BGO")!.datums.CD, 0);
    assert.ok(all.some((t) => t.id.startsWith("ticon/") && t.id.endsWith("-nld-rws")));
  });
});

describe("offsetRows", () => {
  it("gives no row for a station's own label unless it's the station's chart datum", () => {
    // RWS's offshore platforms are measured from RWS's own MSL, with no surveyed offsets.
    const k13a = station("rws/k13a", { datum: "MSL" });
    const [platform] = withDatums([k13a], []).stations;
    assert.deepEqual(platform!.datums, {});
    assert.equal(platform!.chart_datum, null);
    assert.deepEqual(offsetRows(platform!), []);
    // Kartverket's chart datum is the named datum CD, so a level in it needs no conversion.
    const bergen = station("kartverket/BGO", { datum: "CD", datums: { MSL: -0.952 } });
    const [cd] = withDatums([bergen], []).stations;
    assert.deepEqual(offsetRows(cd!), [
      { station: "kartverket/BGO", epoch: 1, datum: "MSL", offset_m: -0.952 },
      { station: "kartverket/BGO", epoch: 1, datum: "CD", offset_m: 0 },
    ]);
  });

  it("converts an epoch in another datum to every current one", () => {
    const s = station("coops/1", {
      datum: "MLLW",
      datums: { MSL: -1 },
      epochs: [
        open("STND", { until: "2010-01-01T00:00:00.000Z", to_current: -2, state: "closed" }),
        open("MLLW", { id: 2, since: "2010-01-01T00:00:00.000Z" }),
      ],
    });
    assert.deepEqual(
      offsetRows(s).filter((r) => r.epoch === 1),
      [{ station: "coops/1", epoch: 1, datum: "MSL", offset_m: -3 }],
    );
  });

  it("puts each epoch that converts in every current datum, and the rest in their frozen offsets", () => {
    const s = station("rws/x", {
      datum: "NAP",
      datums: { MSL: -0.1 },
      epochs: [
        open("NAP", {
          until: "2005-01-01T00:00:00.000Z",
          to_current: null,
          state: "closed",
          datums: { X: 1 },
        }),
        open("MSL", {
          id: 2,
          until: "2010-01-01T00:00:00.000Z",
          to_current: 0.25,
          state: "closed",
        }),
        open("NAP", { id: 3, since: "2010-01-01T00:00:00.000Z" }),
      ],
    });
    assert.deepEqual(offsetRows(s), [
      { station: "rws/x", epoch: 1, datum: "X", offset_m: 1 },
      { station: "rws/x", epoch: 2, datum: "MSL", offset_m: 0.15 },
      { station: "rws/x", epoch: 3, datum: "MSL", offset_m: -0.1 },
    ]);
  });
});
