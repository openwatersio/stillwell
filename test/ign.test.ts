import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it, mock } from "node:test";
import { fetchText, HttpError, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import { fromSource } from "../src/qc.ts";
import { spans } from "../src/errata.ts";
import * as ign from "../src/sources/ign/index.ts";
import { sourceOf, errata } from "../src/sources/index.ts";
import { linkGauges } from "../src/same-as.ts";
import type { Observation, Station } from "../src/schema.ts";
import type { StoredStation } from "../src/schema.ts";
import { refreshStation } from "../src/store/recent.ts";
import { judgeFetched } from "../src/store/requalify.ts";

ign.pacing.requestMs = 0;

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/ign-${name}`, import.meta.url), "utf8");
const base = "https://datos-geodesia.ign.es/Red_de_Mareografos/";
const listing = (path: string, files: string[]) =>
  `<html><h1>Index of /Red_de_Mareografos/${path}</h1><ul>${files.map((f) => `<li><a href="${f}">${f}</a></li>`).join("")}</ul></html>`;
function serve(routes: Record<string, string>): void {
  setTransport(async (url) => {
    const path = url.slice(base.length);
    if (!(path in routes)) throw new HttpError(`GET ${url} returned 404`, "");
    return routes[path]!;
  });
}
afterEach(() => setTransport(fetchText));

function hourlyYear(year: number, value = "-4000"): string {
  const start = Date.UTC(year, 0, 1);
  const hours = (Date.UTC(year + 1, 0, 1) - start) / 3_600_000;
  return (
    "200 NORTE 031 ACOR1 Datos horarios en mm respecto JM NP-615\n" +
    Array.from({ length: hours }, (_, i) => {
      const stamp = new Date(start + i * 3_600_000).toISOString();
      return (
        stamp.slice(0, 10).split("-").reverse().join("/") + " " + stamp.slice(11, 16) + " " + value
      );
    }).join("\n")
  );
}

describe("IGN", () => {
  it("publishes only errata relevant to the admitted Coruña product", () => {
    const ids = errata
      .filter(
        (e) => e.source === "ign" && (e.stations === null || e.stations.includes("ign/ACOR1")),
      )
      .map((e) => e.id)
      .sort();
    assert.deepEqual(ids, [
      "ign-coruna-clock",
      "ign-coruna-hourly-gaps",
      "ign-coruna-hourly-grid",
      "ign-release-coverage",
    ]);
  });

  it("reads the real recorded Coruña hourly leap-year file", async () => {
    serve({
      "ACOR1/procesados/horarios/200031_horarios_2000_JM.txt": fixture("coruna-hourly-2000.txt"),
    });
    const rows = await ign.corunaHourly(new Date("2000-01-02Z"), new Date("2000-01-04Z"));
    assert.equal(rows.length, 48);
    assert.equal(rows[0]!.time, Date.UTC(2000, 0, 2));
    assert.ok(
      rows.every(
        (r) => Number.isFinite(r.level) && r.flag === Flag.suspect && r.source_flag === Flag.good,
      ),
    );
  });

  it("ties stored clock requalification to exactly the admitted interval", () => {
    const expected = [Date.UTC(2000, 0, 1), Date.UTC(2024, 0, 1)];
    assert.deepEqual(ign.CORUNA_PERIOD, expected);
    const covered = spans({ id: "ign/ACOR1" }, errata);
    assert.deepEqual(covered, [ign.CORUNA_PERIOD]);
    const rows = [expected[0]! - 1, expected[0]!, expected[1]! - 1, expected[1]!].map((time) => ({
      time,
      level: -4,
      flag: Flag.suspect,
      source_flag: Flag.good,
    }));
    assert.deepEqual(
      fromSource(rows, covered).map((r) => r.flag),
      [Flag.good, Flag.suspect, Flag.suspect, Flag.good],
    );
  });

  it("credits source-only metadata with the known product period without inventing stored bounds", () => {
    const credit = ign.source.attribution?.({ first: null, last: null } as Station)!;
    assert.ok(credit.startsWith("Obra derivada de"));
    assert.ok(credit.includes("2000–2023 CC-BY 4.0 ign.es"));
    assert.equal(credit, ign.metadata.attribution);
  });

  it("publishes only the inactive Coruña hourly series", async () => {
    setTransport(async () => {
      throw new Error("closed historical metadata must not depend on the live network catalog");
    });
    const list = await sourceOf("ign").stations();
    assert.deepEqual(
      list.map((s) => s.source_id),
      ["ACOR1"],
    );
    const station = list[0]!;
    assert.equal(station.live, false);
    assert.equal(station.status, "inactive");
    assert.equal(station.interval_s, 3600);
    assert.equal(station.datum, "JM");
    assert.equal(station.datums.NMMA, 4.998);
    assert.equal(station.attribution, ign.metadata.attribution);
    assert.deepEqual(station.same_as, []);
  });

  it("admits only checked hourly years and flags every published clock", async () => {
    const files = [
      "200031_horarios_1999_JM.txt",
      "200031_horarios_2024_JM.txt",
      "200031_horarios_2000_BM.txt",
    ];
    const routes: Record<string, string> = {};
    for (let year = 2000; year <= 2023; year++) {
      const file = `200031_horarios_${year}_JM.txt`;
      files.push(file);
      routes[`ACOR1/procesados/horarios/${file}`] = hourlyYear(year);
    }
    routes["ACOR1/procesados/horarios/"] = listing("ACOR1/procesados/horarios", files);
    serve(routes);
    const station = { id: "ign/ACOR1", source_id: "ACOR1", datum: "JM" } as Station;
    const rows = await sourceOf("ign").observations!(
      station,
      new Date("1999-01-01Z"),
      new Date("2025-01-01Z"),
    );
    assert.equal(rows.length, 210384);
    assert.ok(rows.every((r) => r.flag === Flag.suspect && r.source_flag === Flag.good));
    assert.equal(rows[0]!.time, Date.UTC(2000, 0, 1));
    assert.equal(rows.at(-1)!.time, Date.UTC(2023, 11, 31, 23));
    assert.ok(
      (
        await ign.source.observations!(station, new Date("2000-01-01Z"), new Date("2000-01-02Z"))
      ).every((r) => r.flag === Flag.suspect),
    );
    await assert.rejects(
      () =>
        sourceOf("ign").observations!(
          { ...station, source_id: "ALAC1" },
          new Date("2000-01-01Z"),
          new Date("2001-01-01Z"),
        ),
      /withheld/,
    );
    await assert.rejects(
      () =>
        sourceOf("ign").observations!(
          { ...station, datum: "BM" },
          new Date("2000-01-01Z"),
          new Date("2001-01-01Z"),
        ),
      /datum/,
    );
  });

  it("does not treat a missing admitted hourly file as a deliberate coverage exclusion", async () => {
    serve({
      "ACOR1/procesados/horarios/": listing("ACOR1/procesados/horarios", [
        "200031_horarios_2004_JM.txt",
      ]),
      "ACOR1/procesados/horarios/200031_horarios_2004_JM.txt":
        "200 NORTE 031 ACOR1 Datos horarios en mm respecto JM NP-615\n31/12/2004 23:00 -4100",
    });
    const station = { id: "ign/ACOR1", source_id: "ACOR1", datum: "JM" } as Station;
    await assert.rejects(
      () =>
        sourceOf("ign").observations!(station, new Date("2005-01-01Z"), new Date("2006-01-01Z")),
      /missing.*2005|404/i,
    );
    setTransport(async () => {
      throw new Error("an excluded range must not fetch");
    });
    assert.deepEqual(
      await sourceOf("ign").observations!(
        station,
        new Date("2024-01-01Z"),
        new Date("2027-01-01Z"),
      ),
      [],
    );
  });

  it("uses the complete requested hourly year without fetching a predecessor", async () => {
    serve({ "ACOR1/procesados/horarios/200031_horarios_2001_JM.txt": hourlyYear(2001, "-4100") });
    const rows = await ign.corunaHourly(new Date("2001-01-01Z"), new Date("2001-01-02Z"));
    assert.equal(rows.length, 24);
    assert.equal(rows[0]!.level, -4.1);
    assert.equal(rows[0]!.flag, Flag.suspect);
    serve({
      "ACOR1/procesados/horarios/200031_horarios_2000_JM.txt": hourlyYear(2000).replace(
        "NP-615",
        "OTHER",
      ),
    });
    await assert.rejects(
      () => ign.corunaHourly(new Date("2000-01-01Z"), new Date("2000-01-02Z")),
      /benchmark mark/,
    );
  });

  it("refuses truncated, missing-hour and off-hour admitted files even for a one-day request", async () => {
    const complete = hourlyYear(2000);
    const lines = complete.split("\n");
    for (const body of [
      lines.slice(0, -1).join("\n"),
      lines.filter((_, i) => i !== 4).join("\n"),
      complete.replace("01/01/2000 01:00", "01/01/2000 01:30"),
    ]) {
      serve({ "ACOR1/procesados/horarios/200031_horarios_2000_JM.txt": body });
      await assert.rejects(
        () => ign.corunaHourly(new Date("2000-01-01Z"), new Date("2000-01-02Z")),
        /hourly grid/,
      );
    }
  });

  it("treats Coruña hourly -9999 as an unusable aggregate without inventing a level", async () => {
    serve({
      "ACOR1/procesados/horarios/200031_horarios_2000_JM.txt": hourlyYear(2000).replace(
        "01/01/2000 01:00 -4000",
        "01/01/2000 01:00 -9999",
      ),
    });
    const rows = await ign.corunaHourly(new Date("2000-01-01Z"), new Date("2000-01-02Z"));
    const marker = rows[1]!;
    assert.equal(marker.withdrawn, true);
    assert.equal(marker.flag, Flag.bad);
    assert.equal(marker.source_flag, Flag.bad);
    assert.ok(Number.isNaN(marker.level));
    const prior = { time: marker.time, level: -4.1, flag: Flag.suspect, source_flag: Flag.good };
    const merged = judgeFetched(
      [prior],
      [marker],
      rows[0]!.time,
      rows.at(-1)!.time + 3_600_000,
      {},
      [],
      true,
    );
    assert.deepEqual(
      merged.map((r) => [r.level, r.flag, r.source_flag]),
      [[-4.1, Flag.bad, Flag.bad]],
    );
    assert.deepEqual(
      judgeFetched([], [marker], rows[0]!.time, rows.at(-1)!.time + 3_600_000, {}, [], true),
      [],
    );
  });

  it("drops impossible-date missing placeholders without rolling them onto a real day", () => {
    const header = "220 MEDITERRANEO 047 MURC2 mm respecto JM NP1\n";
    const options = {
      year: 2024,
      gauge: "MURC2",
      raw: false,
      reference: "JM",
      sign: 1 as const,
      offset: 0,
    };
    const rows = ign.parse(
      header + "30/11/2024 23:59:00 -1000\n31/11/2024 00:00:00 ---\n01/12/2024 00:00:00 -1001",
      options,
    );
    assert.deepEqual(
      rows.map((r) => [r.time, r.level]),
      [
        [Date.UTC(2024, 10, 30, 23, 59), -1],
        [Date.UTC(2024, 11, 1), -1.001],
      ],
    );
    assert.throws(() => ign.parse(header + "31/11/2024 00:00:00 -1000", options));
    assert.throws(() => ign.parse(header + "31/11/2024 00:00:00 ---", options), /valid timestamp/);
  });
  it("keeps one identical reviewed export row, but refuses a conflicting duplicate", () => {
    const header = "370 CANARIAS 032 TN021 mm respecto BM NGZ-581\n";
    const options = {
      year: 2010,
      gauge: "TN021",
      raw: false,
      reference: "BM",
      sign: 1 as const,
      offset: 0,
    };
    const row = "15/02/2010 12:11:00 -2251";
    assert.equal(ign.parse(header + row + "\n" + row, options).length, 1);
    assert.throws(() => ign.parse(header + row + "\n15/02/2010 12:11:00 -2250", options));
  });
  it("refuses an unrecognized reviewed reference filename instead of silently omitting it", async () => {
    serve({
      "ALAC1/procesados/integros/": listing("ALAC1/procesados/integros", ["220051_2024_NMMA.txt"]),
      "ALAC1/procesados/horarios/": listing("ALAC1/procesados/horarios", []),
    });
    await assert.rejects(
      ign.levels("ALAC1", new Date("2024-01-01Z"), new Date("2025-01-01Z")),
      /filename/,
    );
  });
  it("refuses encoded or uppercase reviewed filenames before inventory filtering", async () => {
    for (const file of ["220051_2024_JM%20(1).txt", "220051_2024_JM.TXT"]) {
      serve({ "ALAC1/procesados/integros/": listing("ALAC1/procesados/integros", [file]) });
      await assert.rejects(
        () => ign.levels("ALAC1", new Date("2024-01-01Z"), new Date("2025-01-01Z")),
        /unsupported reviewed filename/,
      );
    }
  });
  it("renders the derived-product credit using actual stored observation dates", () => {
    const credit = ign.source.attribution?.({
      first: "1927-01-01T01:00:00Z",
      last: "2026-11-17T10:00:00Z",
    } as Station);
    assert.equal(
      credit,
      "Obra derivada de Red de Mareógrafos 1927-01-01–2026-11-17 CC-BY 4.0 ign.es; Área de Geodesia, Instituto Geográfico Nacional (IGN)",
    );
  });
  it("reads legacy unitless water-level exports using the agency-documented millimeters", () => {
    assert.equal(
      ign.parse("01/01/2022 00:00:00 1234", {
        year: 2022,
        gauge: "ACOR1",
        raw: true,
        sign: -1,
        offset: 0,
      })[0]!.level,
      -1.234,
    );
  });
  it("reads unquoted millimeters and blank invalidations in the historical ACOR1 format", () => {
    const rows = ign.parse("06/03/1950 12:00:00 2500 mm\n06/03/1950 13:00:00   mm", {
      year: 1950,
      gauge: "ACOR1",
      raw: true,
      sign: 1,
      offset: 0,
    });
    assert.equal(rows[0]!.level, 2.5);
    assert.equal(rows[1]!.flag, Flag.bad);
    assert.ok(rows[1]!.withdrawn);
  });
  it("invalidates stored readings through refetch and research refresh without inventing levels", async () => {
    const time = Date.UTC(2026, 10, 15, 5);
    const old: Observation = { time, level: -1.1, flag: Flag.good, source_flag: Flag.good };
    const header = "220 MEDITERRANEO 051 ALAC1 mm respecto JM NP1\n";
    const fetched = ign.parse(header + "15/11/2026 05:00:00 ---", {
      year: 2026,
      gauge: "ALAC1",
      raw: false,
      reference: "JM",
      sign: 1,
      offset: 0,
    });
    const expected = { ...old, flag: Flag.bad, source_flag: Flag.bad };
    assert.deepEqual(judgeFetched([old], fetched, time, time + 3600000, {}, [], true), [expected]);
    assert.deepEqual(judgeFetched([], fetched, time, time + 3600000, {}, [], true), []);
    serve({ "": fixture("root.html") });
    const listed = (await ign.stations()).find((s) => s.source_id === "ALAC1")!;
    const station = {
      ...listed,
      epochs: [
        {
          id: 1,
          datum: "JM",
          since: null,
          until: null,
          seen: null,
          reference: "NP1",
          reference_since: null,
          datums: {},
          to_current: 0,
          state: "open",
        },
      ],
    } as StoredStation;
    const summary = {
      title: "withdrawal",
      stations: 1,
      updated: 0,
      stale: [],
      failed: [],
      waiting: [],
      values: 0,
      files: 0,
    };
    const result = await refreshStation({
      source: { ...ign.source, observations: async () => fetched },
      station,
      previous: [{ ...old, station: station.id, epoch: 1 }],
      swept: undefined,
      since: time,
      now: time + 3600000,
      keepFrom: time - 86400000,
      summary,
    });
    assert.deepEqual(summary.failed, []);
    assert.equal(result.rows[0]!.source_flag, Flag.bad);
    assert.equal(result.rows[0]!.level, old.level);
    assert.equal(result.rows[0]!.received, undefined);
  });

  it("keeps explicit minute invalidations ahead of lower-precedence hourly values", async () => {
    serve({
      "ALAC1/procesados/integros/": listing("ALAC1/procesados/integros", ["220051_2024_JM.txt"]),
      "ALAC1/procesados/horarios/": listing("ALAC1/procesados/horarios", [
        "220051_horarios_2024_JM.txt",
      ]),
      "ALAC1/procesados/integros/220051_2024_JM.txt":
        "220 MEDITERRANEO 051 ALAC1 mm respecto JM NP1\n01/01/2024 00:00:00 9999",
      "ALAC1/procesados/horarios/220051_horarios_2024_JM.txt":
        "220 MEDITERRANEO 051 ALAC1 mm respecto JM NP1\n01/01/2024 00:00 -3300",
    });
    const out = await ign.levels("ALAC1", new Date("2024-01-01Z"), new Date("2024-01-02Z"));
    assert.equal(out[0]!.flag, Flag.bad);
  });

  it("reads a terminal annual boundary in its actual year even without the next year's file", async () => {
    serve({
      "TN031/procesados/integros/": listing("TN031/procesados/integros", ["370033_2021_BM.txt"]),
      "TN031/procesados/horarios/": listing("TN031/procesados/horarios", []),
      "TN031/procesados/integros/370033_2021_BM.txt":
        "370 CANARIAS 033 TN031 mm respecto BM NGAB161\n31/12/2021 23:59:00 -1530\n01/01/2022 00:00:00 -1525",
    });
    assert.equal(
      (await ign.levels("TN031", new Date("2021-01-01Z"), new Date("2022-01-01Z"))).length,
      1,
    );
    const next = await ign.levels("TN031", new Date("2022-01-01Z"), new Date("2022-01-02Z"));
    assert.deepEqual(
      next.map((r) => [r.time, r.level]),
      [[Date.UTC(2022, 0, 1), -1.525]],
    );
  });

  it("reads only the preceding file's terminal row when its other rows are malformed", async () => {
    serve({
      "TN031/procesados/integros/": listing("TN031/procesados/integros", ["370033_2021_BM.txt"]),
      "TN031/procesados/horarios/": listing("TN031/procesados/horarios", []),
      "TN031/procesados/integros/370033_2021_BM.txt":
        "370 CANARIAS 033 TN031 mm respecto BM NGAB161\n07/05/2109 00:17:00 -9999\n01/01/2022 00:00:00 -1525",
    });
    await assert.rejects(() =>
      ign.levels("TN031", new Date("2021-01-01Z"), new Date("2022-01-01Z")),
    );
    assert.equal(
      (await ign.levels("TN031", new Date("2022-01-01Z"), new Date("2022-01-02Z")))[0]!.level,
      -1.525,
    );
  });
  it("ignores a malformed preceding raw file without a terminal row", async () => {
    serve({
      "ALAC1/observados/": listing("ALAC1/observados", []),
      "ALAC1/observados/ficheros_anuales/": listing("ALAC1/observados/ficheros_anuales", [
        "220051_1633_2024.txt",
        "220051_1633_2025.txt",
      ]),
      "ALAC1/observados/ficheros_anuales/220051_1633_2024.txt": "malformed",
      "ALAC1/observados/ficheros_anuales/220051_1633_2025.txt": "01/01/2025 00:00:00 1000 mm",
    });
    assert.equal(
      (await ign.levels("ALAC1-1633", new Date("2025-01-01Z"), new Date("2026-01-01Z")))[0]!.level,
      -1,
    );
  });
  it("does not let an unrelated out-of-range reviewed object block a valid year", async () => {
    serve({
      "ALAC1/procesados/integros/": listing("ALAC1/procesados/integros", [
        "220052_1990_JM.txt",
        "220051_1990_NMMA.txt",
        "220051_2024_JM.txt",
      ]),
      "ALAC1/procesados/horarios/": listing("ALAC1/procesados/horarios", []),
      "ALAC1/procesados/integros/220051_2024_JM.txt":
        "220 MEDITERRANEO 051 ALAC1 mm respecto JM NP1\n01/01/2024 00:00:00 -3300",
    });
    assert.equal(
      (await ign.levels("ALAC1", new Date("2024-01-01Z"), new Date("2025-01-01Z")))[0]!.level,
      -3.3,
    );
  });

  it("fills internal annual gaps from daily exports and lets the daily revision win", async () => {
    serve({
      "ALAC1/observados/": listing("ALAC1/observados", ["2025/"]),
      "ALAC1/observados/ficheros_anuales/": listing("ALAC1/observados/ficheros_anuales", [
        "220051_1633_2025.txt",
      ]),
      "ALAC1/observados/ficheros_anuales/220051_1633_2025.txt":
        '01/01/2025 00:00:00 1000 "mm"\n01/01/2025 00:02:00 1002 "mm"',
      "ALAC1/observados/2025/": listing("ALAC1/observados/2025", ["220051_1633_20250101.txt"]),
      "ALAC1/observados/2025/220051_1633_20250101.txt":
        '01/01/2025 00:01:00 1001 "mm"\n01/01/2025 00:02:00 9999 "mm"',
    });
    const out = await ign.levels("ALAC1-1633", new Date("2025-01-01Z"), new Date("2026-01-01Z"));
    assert.deepEqual(
      out.map((r) => r.time),
      [0, 1, 2].map((m) => Date.UTC(2025, 0, 1, 0, m)),
    );
    assert.equal(out[2]!.flag, Flag.bad);
  });
  it("registers the adapter and links the two Alicante gauges to distinct GESLA copies", async () => {
    assert.equal(sourceOf("ign").metadata.id, "ign");
    serve({ "": fixture("root.html") });
    const list = (await ign.stations()) as Station[];
    const a = list.find((s) => s.source_id === "ALAC1")!;
    const b = list.find((s) => s.source_id === "ALAC2")!;
    const copy = (s: Station, id: string): Station => ({
      ...s,
      id,
      source: "gesla",
      source_id: id.slice(6),
      same_as: [],
      first: "2019-01-01T00:00:00Z",
      last: "2026-11-01T00:00:00Z",
    });
    const linked = linkGauges(
      [
        ...list.map((s) => ({ ...s, first: "2000-01-01T00:00:00Z", last: "2023-12-31T23:00:00Z" })),
        copy(a, "gesla/alicantetg-ali-esp-cmems"),
        copy(b, "gesla/alicante2tg-ali-esp-cmems"),
      ],
      new Date("2026-11-15Z"),
    ).stations;
    const first = linked.find((s) => s.id === a.id)!;
    assert.ok(first.same_as.includes("gesla/alicantetg-ali-esp-cmems"));
    assert.ok(!first.same_as.includes(b.id));
    assert.ok(!first.same_as.includes("gesla/alicante2tg-ali-esp-cmems"));
    const preferred = linked.find((s) => s.id === first.preferred)!;
    assert.equal(preferred.source, "ign");
  });
  it("lists all twelve gauges and keeps unknown raw references apart", async () => {
    serve({ "": fixture("root.html") });
    const list = await ign.stations();
    assert.equal(list.filter((s) => !s.source_id.includes("-")).length, 12);
    const alac = list.find((s) => s.source_id === "ALAC1")!;
    assert.equal(alac.datum, "JM");
    assert.equal(alac.datums.NMMA, 3.41);
    assert.equal(alac.live, false);
    assert.equal(list.find((s) => s.source_id === "ALAC1-1633")!.live, true);
    assert.equal(list.find((s) => s.source_id === "FUER1")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "MURC1")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "TN031")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "TN021-NGZ581")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "ALAC2-0806")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "ALAC1-0301")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "ALAC1-0702")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "TN013")!.datums.NMMA, undefined);
    assert.ok(list.every((s) => s.commercial_use));
    assert.ok(list.every((s) => s.license === "CC-BY-4.0"));
    assert.equal(ign.metadata.license.redistribution, true);
    assert.ok(alac.same_as.includes("ign/ALAC1-1633"));
  });

  it("keeps archived observations outside the sheet's stated sensor period", async () => {
    serve({
      "MURC1/observados/": listing("MURC1/observados", ["2001/"]),
      "MURC1/observados/2001/": listing("MURC1/observados/2001", []),
      "MURC1/observados/ficheros_anuales/": listing("MURC1/observados/ficheros_anuales", [
        "220046_0503_2001.txt",
      ]),
      "MURC1/observados/ficheros_anuales/220046_0503_2001.txt": '01/01/2001 00:00:00 583 "mm"',
    });
    const out = await ign.levels("MURC1-0503", new Date("2001-01-01Z"), new Date("2002-01-01Z"));
    assert.equal(out[0]!.level, -0.583);
  });

  it("reads annual-only years absent from daily directory listings", async () => {
    serve({
      "ALME2/observados/": listing("ALME2/observados", ["2000/"]),
      "ALME2/observados/ficheros_anuales/": listing("ALME2/observados/ficheros_anuales", [
        "220042_0901_1985.txt",
      ]),
      "ALME2/observados/ficheros_anuales/220042_0901_1985.txt": '01/01/1985 00:00:00 1500 "mm"',
    });
    const out = await ign.levels("ALME2-0901", new Date("1985-01-01Z"), new Date("1985-01-02Z"));
    assert.equal(out[0]!.level, 1.5);
  });

  it("signals a new TN031 reviewed reference rather than silently dropping it", async () => {
    serve({
      "TN031/procesados/integros/": listing("TN031/procesados/integros", ["370033_2025_JM.txt"]),
      "TN031/procesados/horarios/": listing("TN031/procesados/horarios", []),
      "TN031/procesados/integros/370033_2025_JM.txt":
        "370 CANARIAS 033 TN031 mm respecto JM SS.3\n01/01/2025 00:00:00 -18000",
    });
    await assert.rejects(
      ign.levels("TN031", new Date("2025-01-01Z"), new Date("2025-01-02Z")),
      /reference/,
    );
  });

  it("refuses an empty, shortened or unknown station catalog", async () => {
    for (const html of [
      listing("", []),
      fixture("root.html").replace('href="ALAC1/"', 'href="XXXXX/"'),
    ]) {
      serve({ "": html });
      await assert.rejects(ign.stations(), /catalog/);
    }
  });

  it("reads reviewed JM heights and historical arbitrary zeros without changing their direction", () => {
    const reviewed = ign.parse(fixture("reviewed.txt"), {
      year: 2024,
      gauge: "ALAC1",
      reference: "JM",
      raw: false,
      sign: 1,
      offset: 0,
    });
    assert.deepEqual(reviewed[0], { time: Date.UTC(2024, 0, 1), level: -3.364, flag: Flag.good });
    const historic = ign.parse(fixture("historic.txt"), {
      year: 1927,
      gauge: "ALAC1",
      raw: true,
      sign: 1,
      offset: 0,
    });
    assert.deepEqual(
      historic.find((r) => !r.withdrawn),
      {
        time: Date.UTC(1927, 0, 1, 1),
        level: 1.499,
        flag: Flag.preliminary,
      },
    );
  });

  it("converts a reviewed BM file only using its documented mark", () => {
    const out = ign.parse(
      "220 MEDITERRANEO 048 ALBO1 mm respecto BM C_Mfo\n01/01/2021 00:00:00 -1101",
      {
        year: 2021,
        gauge: "ALBO1",
        reference: "BM",
        mark: "C_Mfo",
        raw: false,
        sign: 1,
        offset: -14.804,
      },
    );
    assert.equal(out[0]!.level, -15.905);
  });

  it("prefers direct JM over converted BM, then minute over hourly values", async () => {
    serve({
      "ALBO1/procesados/integros/": listing("ALBO1/procesados/integros", [
        "220048_2021_BM.txt",
        "220048_2021_JM.txt",
      ]),
      "ALBO1/procesados/horarios/": listing("ALBO1/procesados/horarios", [
        "220048_horarios_2021_JM.txt",
      ]),
      "ALBO1/procesados/integros/220048_2021_BM.txt":
        "220 MEDITERRANEO 048 ALBO1 mm respecto BM C_Mfo\n01/01/2021 00:00:00 -1101",
      "ALBO1/procesados/integros/220048_2021_JM.txt":
        "220 MEDITERRANEO 048 ALBO1 mm respecto JM NG K 272\n01/01/2021 00:00:00 -15900",
      "ALBO1/procesados/horarios/220048_horarios_2021_JM.txt":
        "220 MEDITERRANEO 048 ALBO1 mm respecto JM NG K 272\n01/01/2021 00:00 -16000\n01/01/2021 01:00 -16010",
    });
    const out = await ign.levels("ALBO1", new Date("2021-01-01Z"), new Date("2021-01-01T02:00Z"));
    assert.deepEqual(
      out.map((r) => r.level),
      [-15.9, -16.01],
    );
  });

  it("reads the reviewed hourly format without seconds", () => {
    const result = ign.parse(fixture("hourly.txt"), {
      year: 2024,
      gauge: "ALAC1",
      reference: "JM",
      raw: false,
      sign: 1,
      offset: 0,
    });
    assert.deepEqual(result.slice(0, 2), [
      { time: Date.UTC(2024, 0, 1), level: -3.364, flag: Flag.good },
      { time: Date.UTC(2024, 0, 1, 1), level: -3.346, flag: Flag.good },
    ]);
  });

  it("deduplicates identical raw lines but refuses conflicting repeated timestamps", () => {
    const options = { year: 2026, gauge: "ALAC1", raw: true, sign: -1 as const, offset: 0 };
    const result = ign.parse(fixture("duplicates.txt"), options);
    assert.equal(result.filter((o) => o.time === Date.UTC(2026, 10, 12, 4, 5)).length, 1);
    assert.throws(() =>
      ign.parse('12/11/2026 04:05:00 798 "mm"\n12/11/2026 04:05:00 799 "mm"', options),
    );
  });

  it("carries explicit missing markers, retains ambiguous -9999 as suspect and rejects invalid rows", () => {
    const options = { year: 2024, gauge: "ALAC1", raw: true, sign: -1 as const, offset: 0 };
    assert.deepEqual(
      ign.parse(
        '01/01/2024 00:00:00 9999 "mm"\n01/01/2024 00:01:00 -9999 "mm"\n01/01/2024 00:02:00 --- "mm"',
        options,
      ),
      [
        { time: Date.UTC(2024, 0, 1), level: Number.NaN, flag: Flag.bad, withdrawn: true },
        { time: Date.UTC(2024, 0, 1, 0, 1), level: 9.999, flag: Flag.suspect },
        { time: Date.UTC(2024, 0, 1, 0, 2), level: Number.NaN, flag: Flag.bad, withdrawn: true },
      ],
    );
    for (const line of [
      '01/01/2024 00:00:00 14.2 "V"',
      '31/02/2024 00:00:00 1000 "mm"',
      '01/01/2023 00:00:00 1000 "mm"',
      "<html>error</html>",
    ])
      assert.throws(() => ign.parse(line, options));
    assert.throws(() =>
      ign.parse(fixture("reviewed.txt"), {
        ...options,
        raw: false,
        gauge: "ALAC2",
        reference: "JM",
      }),
    );
    assert.throws(() =>
      ign.parse(fixture("reviewed.txt"), { ...options, raw: false, reference: "BM" }),
    );
  });

  it("keeps raw sensor readings out of reviewed series, including when the reviewed inventory is short", async () => {
    serve({
      "TN013/procesados/integros/": listing("TN013/procesados/integros", ["370031_2024_JM.txt"]),
      "TN013/procesados/horarios/": listing("TN013/procesados/horarios", []),
      "TN013/procesados/integros/370031_2024_JM.txt":
        "370 CANARIAS 013 TN013 Serie integra en mm respecto JM NGR-333\n01/01/2024 00:00:00 -10271\n",
      "TN013/observados/": listing("TN013/observados", ["2024/"]),
      "TN013/observados/2024/": listing("TN013/observados/2024", ["370031_1631_20240101.txt"]),
      "TN013/observados/2024/370031_1631_20240101.txt":
        '01/01/2024 00:00:00 4834 "mm"\n01/01/2024 00:01:00 4830 "mm"\n01/01/2024 00:02:00 4825 "mm"\n',
    });
    const out = await ign.levels("TN013", new Date("2024-01-01Z"), new Date("2024-01-01T00:02Z"));
    assert.deepEqual(
      out.map((o) => [o.level, o.flag]),
      [[-10.271, Flag.good]],
    );
  });

  it("validates the named benchmark, not just the BM or JM role", () => {
    assert.throws(
      () =>
        ign.parse(fixture("reviewed.txt"), {
          year: 2024,
          gauge: "ALAC1",
          reference: "JM",
          mark: "NAP-943",
          raw: false,
          sign: 1,
          offset: 0,
        }),
      /mark/,
    );
  });

  it("preserves a numeric -9999 reviewed height as suspect instead of deleting it", () => {
    const out = ign.parse(
      "370 CANARIAS 013 TN013 Serie integra en mm respecto JM NGR-333\n01/01/2024 19:20:00 -9987\n01/01/2024 19:21:00 -9999\n01/01/2024 19:22:00 -10001",
      {
        year: 2024,
        gauge: "TN013",
        reference: "JM",
        mark: "NG R 333",
        raw: false,
        sign: 1,
        offset: 0,
      },
    );
    assert.deepEqual(
      out.map((o) => [o.level, o.flag]),
      [
        [-9.987, Flag.good],
        [-9.999, Flag.suspect],
        [-10.001, Flag.good],
      ],
    );
  });

  it("uses MURC1's published NAP-943 reference and isolates the older Tenerife benchmark", async () => {
    serve({
      "": fixture("root.html"),
      "TN021/procesados/integros/": listing("TN021/procesados/integros", ["370032_2008_BM.txt"]),
      "TN021/procesados/horarios/": listing("TN021/procesados/horarios", []),
      "TN021/procesados/integros/370032_2008_BM.txt":
        "370 CANARIAS 032 TN021 mm respecto BM NGZ-581\n01/01/2008 00:00:00 -2341",
    });
    const stations = await ign.stations();
    assert.equal(stations.find((s) => s.source_id === "MURC1")!.datums.NMMA, 2.313);
    assert.deepEqual(stations.find((s) => s.source_id === "TN021-NGZ581")!.datums, {});
    assert.deepEqual(
      await ign.levels("TN021", new Date("2008-01-01Z"), new Date("2008-01-02Z")),
      [],
    );
    const old = await ign.levels("TN021-NGZ581", new Date("2008-01-01Z"), new Date("2008-01-02Z"));
    assert.equal(old[0]!.level, -2.341);
  });

  it("does not let another sensor's annual export override the requested sensor's daily file", async () => {
    serve({
      "ALAC1/observados/": listing("ALAC1/observados", ["2025/"]),
      "ALAC1/observados/ficheros_anuales/": listing("ALAC1/observados/ficheros_anuales", [
        "220051_1603_2025.txt",
      ]),
      "ALAC1/observados/ficheros_anuales/220051_1603_2025.txt": '01/01/2025 00:00:00 1100 "mm"',
      "ALAC1/observados/2025/": listing("ALAC1/observados/2025", ["220051_1633_20250101.txt"]),
      "ALAC1/observados/2025/220051_1633_20250101.txt": '01/01/2025 00:00:00 1000 "mm"',
    });
    for (const end of ["2025-01-02Z", "2025-01-10Z"])
      assert.equal(
        (await ign.levels("ALAC1-1633", new Date("2025-01-01Z"), new Date(end)))[0]!.level,
        -1,
      );
  });

  it("does not turn an omitted reviewed file into preliminary replacements", async () => {
    serve({
      "TN013/procesados/integros/": listing("TN013/procesados/integros", []),
      "TN013/procesados/horarios/": listing("TN013/procesados/horarios", []),
      "TN013/observados/": listing("TN013/observados", ["2024/"]),
      "TN013/observados/2024/": listing("TN013/observados/2024", ["370031_1631_20240101.txt"]),
      "TN013/observados/2024/370031_1631_20240101.txt": '01/01/2024 00:00:00 4834 "mm"',
    });
    assert.deepEqual(
      await ign.levels("TN013", new Date("2024-01-01Z"), new Date("2024-01-02Z")),
      [],
    );
  });

  it("reads annual raw files for long historical requests, keeping sensor zeros separate", async () => {
    serve({
      "ALAC1/observados/": listing("ALAC1/observados", ["1927/", "ficheros_anuales/"]),
      "ALAC1/observados/ficheros_anuales/": listing("ALAC1/observados/ficheros_anuales", [
        "220051_0301_1927.txt",
      ]),
      "ALAC1/observados/ficheros_anuales/220051_0301_1927.txt": fixture("historic.txt"),
      "ALAC1/observados/1927/": listing("ALAC1/observados/1927", []),
    });
    const out = await ign.levels("ALAC1-0301", new Date("1927-01-01Z"), new Date("1928-01-01Z"));
    assert.equal(out.find((r) => !r.withdrawn)!.level, 1.499);
    await assert.rejects(
      ign.levels("ALAC1-2000", new Date("1927-01-01Z"), new Date("1928-01-01Z")),
      /station/,
    );
  });

  it("propagates failed inventories and wrong-datum requests", async () => {
    setTransport(async () => {
      throw new Error("upstream unavailable");
    });
    await assert.rejects(
      ign.levels("TN013", new Date("2024-01-01Z"), new Date("2024-01-02Z")),
      /upstream unavailable/,
    );
    await assert.rejects(
      ign.levels("ALAC1", new Date("2024-01-01Z"), new Date("2024-01-02Z"), "BM"),
      /datum/,
    );
  });

  it("keeps each sensor's intraday gaps separate from spare readings", async () => {
    serve({
      "ALAC1/observados/": listing("ALAC1/observados", ["2026/"]),
      "ALAC1/observados/2026/": listing("ALAC1/observados/2026", [
        "220051_1603_20260101.txt",
        "220051_1633_20260101.txt",
      ]),
      "ALAC1/observados/2026/220051_1633_20260101.txt":
        '01/01/2026 00:00:00 1000 "mm"\n01/01/2026 00:02:00 1002 "mm"',
      "ALAC1/observados/2026/220051_1603_20260101.txt": '01/01/2026 00:01:00 1100 "mm"',
    });
    const out = await ign.levels(
      "ALAC1-1633",
      new Date("2026-01-01T00:01Z"),
      new Date("2026-01-01T00:02Z"),
    );
    assert.deepEqual(out, []);
  });

  it("falls back to daily history when the annual export is absent", async () => {
    serve({
      "ALAC1/observados/": listing("ALAC1/observados", ["1927/"]),
      "ALAC1/observados/1927/": listing("ALAC1/observados/1927", ["220051_0301_19270101.txt"]),
      "ALAC1/observados/1927/220051_0301_19270101.txt": fixture("historic.txt")
        .split("\n")
        .slice(0, 24)
        .join("\n"),
    });
    const out = await ign.levels("ALAC1-0301", new Date("1927-01-01Z"), new Date("1928-01-01Z"));
    assert.equal(out.find((r) => !r.withdrawn)!.level, 1.499);
  });

  it("reads a minute-resolution annual export without exceeding the argument limit", async () => {
    const rows = Array.from({ length: 150_000 }, (_, i) => {
      const t = new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString();
      return `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)} ${t.slice(11, 19)} 1000 "mm"`;
    }).join("\n");
    serve({
      "ALAC1/observados/": listing("ALAC1/observados", ["2025/"]),
      "ALAC1/observados/ficheros_anuales/": listing("ALAC1/observados/ficheros_anuales", [
        "220051_1633_2025.txt",
      ]),
      "ALAC1/observados/ficheros_anuales/220051_1633_2025.txt": rows,
      "ALAC1/observados/2025/": listing("ALAC1/observados/2025", []),
    });
    assert.equal(
      (await ign.levels("ALAC1-1633", new Date("2025-01-01Z"), new Date("2026-01-01Z"))).length,
      150_000,
    );
  });

  it("uses current-year daily files across New Year even when an annual snapshot exists", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 15) });
    try {
      serve({
        "ALAC1/observados/": listing("ALAC1/observados", ["2025/", "2026/"]),
        "ALAC1/observados/ficheros_anuales/": listing("ALAC1/observados/ficheros_anuales", [
          "220051_1633_2025.txt",
          "220051_1633_2026.txt",
        ]),
        "ALAC1/observados/ficheros_anuales/220051_1633_2025.txt": '31/12/2025 00:00:00 1050 "mm"',
        "ALAC1/observados/2025/": listing("ALAC1/observados/2025", []),
        "ALAC1/observados/ficheros_anuales/220051_1633_2026.txt": '01/01/2026 00:00:00 900 "mm"',
        "ALAC1/observados/2026/": listing("ALAC1/observados/2026", ["220051_1633_20260101.txt"]),
        "ALAC1/observados/2026/220051_1633_20260101.txt": '01/01/2026 00:00:00 1000 "mm"',
      });
      const out = await ign.levels("ALAC1-1633", new Date("2025-12-31Z"), new Date("2026-01-10Z"));
      assert.deepEqual(
        out.map((r) => r.level),
        [-1.05, -1],
      );
    } finally {
      mock.timers.reset();
    }
  });
});
