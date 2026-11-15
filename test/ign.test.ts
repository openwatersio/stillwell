import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fetchText, HttpError, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as ign from "../src/sources/ign/index.ts";
import { sourceOf } from "../src/sources/index.ts";
import { linkGauges } from "../src/same-as.ts";
import type { Station } from "../src/schema.ts";

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

describe("IGN", () => {
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
        ...list,
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
    assert.equal(list.find((s) => s.source_id === "ALAC1-0301")!.status, "inactive");
    assert.equal(list.find((s) => s.source_id === "TN013")!.datums.NMMA, undefined);
    assert.ok(list.every((s) => !s.commercial_use));
    assert.equal(ign.metadata.license.redistribution, true);
    assert.ok(alac.same_as.includes("ign/ALAC1-1633"));
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
    assert.deepEqual(historic[0], {
      time: Date.UTC(1927, 0, 1, 1),
      level: 1.499,
      flag: Flag.preliminary,
    });
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

  it("drops documented missing markers, retains ambiguous -9999 as suspect and rejects invalid rows", () => {
    const options = { year: 2024, gauge: "ALAC1", raw: true, sign: -1 as const, offset: 0 };
    assert.deepEqual(
      ign.parse(
        '01/01/2024 00:00:00 9999 "mm"\n01/01/2024 00:01:00 -9999 "mm"\n01/01/2024 00:02:00 --- "mm"',
        options,
      ),
      [{ time: Date.UTC(2024, 0, 1, 0, 1), level: 9.999, flag: Flag.suspect }],
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
    });
    const out = await ign.levels("ALAC1-0301", new Date("1927-01-01Z"), new Date("1928-01-01Z"));
    assert.equal(out[0]!.level, 1.499);
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
    assert.equal(out[0]!.level, 1.499);
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
    });
    assert.equal(
      (await ign.levels("ALAC1-1633", new Date("2025-01-01Z"), new Date("2026-01-01Z"))).length,
      150_000,
    );
  });
});
