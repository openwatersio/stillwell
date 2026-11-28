import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { constituents } from "@slackwater/engine";
import {
  bandsOf,
  barFor,
  COMPOUNDS,
  continuum,
  dft,
  figure,
  FIGURES,
  GAUGES,
  halfWidth,
  measure,
  nameOf,
  pack,
  peaksOf,
  render,
  RESOLVED,
  resolveLines,
  sortingOf,
  spectrum,
  unpack,
  type Fitted,
} from "../src/fit/residual-spectrum.ts";

const RAD = Math.PI / 180;

/** Seeded Gaussian noise. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** A year of hourly noise of 20 mm with the lines given as [degrees per hour, meters]. */
function series(lines: [number, number][], seed = 1, hours = 8760): Float32Array {
  const gauss = noise(seed);
  return Float32Array.from({ length: hours }, (_, t) =>
    lines.reduce(
      (s, [speed, amplitude]) => s + amplitude * Math.cos(speed * RAD * t + 1),
      0.02 * gauss(),
    ),
  );
}

describe("the residual spectrum", () => {
  it("transforms a series of any length as the direct sum does", () => {
    const x = Float64Array.from({ length: 37 }, (_, t) => Math.sin(0.7 * t) + 0.3 * t);
    const { re, im } = dft(x);
    for (let k = 0; k < x.length; k++) {
      let r = 0;
      let i = 0;
      for (let t = 0; t < x.length; t++) {
        r += x[t]! * Math.cos((2 * Math.PI * k * t) / x.length);
        i -= x[t]! * Math.sin((2 * Math.PI * k * t) / x.length);
      }
      assert.ok(Math.abs(r - re[k]!) < 1e-9 && Math.abs(i - im[k]!) < 1e-9, `bin ${k}`);
    }
  });

  it("packs a series with its missing hours", () => {
    const packed = unpack(pack(Float32Array.from([0.5, NaN, -1.25])));
    assert.deepEqual([...packed], [0.5, NaN, -1.25]);
  });

  it("sums to the series' variance, gaps or not", () => {
    const whole = series([[28.9841042, 0.05]]);
    const expected = 0.02 ** 2 + 0.05 ** 2 / 2;
    const total = (s: Float32Array) => spectrum(s).power.reduce((sum, p) => sum + p, 0);
    assert.ok(Math.abs(total(whole) / expected - 1) < 0.05);
    const gapped = whole.slice();
    gapped.fill(NaN, 2000, 2900);
    assert.ok(Math.abs(total(gapped) / expected - 1) < 0.08);
    assert.ok(Math.abs(spectrum(gapped).coverage - (8760 - 900) / 8760) < 1e-9);
  });

  it("finds a line between two bins at its own speed and amplitude", () => {
    // 2MN6's speed is not a whole number of cycles in a year.
    const spec = spectrum(series([[86.407938, 0.004]]));
    const floor = continuum(spec.power, halfWidth(spec.n));
    const peaks = peaksOf(spec, floor, barFor(spec.n).family, new Set());
    assert.equal(peaks.length, 1);
    assert.ok(Math.abs(peaks[0]!.speed - 86.407938) < 0.005, String(peaks[0]!.speed));
    assert.ok(Math.abs(peaks[0]!.amplitude - 0.004) < 0.0006, String(peaks[0]!.amplitude));
    assert.equal(peaks[0]!.name, "2MN6");
    assert.equal(peaks[0]!.species, 6);
  });

  it("calls a strong line's leakage through a gap no line", () => {
    const gapped = series([[28.9841042, 1.5]]);
    gapped.fill(NaN, 3000, 3600);
    const spec = spectrum(gapped);
    const floor = continuum(spec.power, halfWidth(spec.n));
    const peaks = peaksOf(spec, floor, barFor(spec.n).family, new Set(["M2"]));
    assert.deepEqual(
      peaks.map((p) => p.name),
      ["M2"],
    );
  });

  it("holds noise to a bar that few spectra of noise reach", () => {
    const bar = barFor(8760);
    // The median's scatter puts the bar over the one for a continuum known exactly.
    assert.ok(bar.family > bar.analytic && bar.family < bar.analytic + 5, String(bar.family));
    assert.ok(bar.percentile > 5 && bar.percentile < 6, String(bar.percentile));
    let withPeaks = 0;
    for (let seed = 100; seed < 140; seed++) {
      const spec = spectrum(series([], seed));
      const floor = continuum(spec.power, halfWidth(spec.n));
      if (peaksOf(spec, floor, bar.family, new Set()).length) withPeaks++;
    }
    // One in twenty is expected; six of forty would be far over it.
    assert.ok(withPeaks <= 5, `${withPeaks} of 40 spectra of noise had a line`);
  });

  it("puts a line's energy in its species and a broad rise in the rise", () => {
    const gauss = noise(9);
    // Slow noise, a two-day running mean, riding on the tide: a rise around M2 with no line in it.
    const raw = Float64Array.from({ length: 8760 + 48 }, () => gauss());
    let sum = 0;
    const slow = new Float64Array(8760);
    for (let t = 0; t < raw.length; t++) {
      sum += raw[t]! - (t >= 48 ? raw[t - 48]! : 0);
      if (t >= 48) slow[t - 48] = sum / Math.sqrt(48);
    }
    const swelling = Float32Array.from(
      { length: 8760 },
      (_, t) =>
        0.02 * gauss() +
        0.1 * slow[t]! * Math.cos(28.9841042 * RAD * t) +
        0.005 * Math.cos(57.9682084 * RAD * t),
    );
    const spec = spectrum(swelling);
    const floor = continuum(spec.power, halfWidth(spec.n));
    const peaks = peaksOf(spec, floor, barFor(spec.n).family, new Set());
    const bands = bandsOf(spec, floor, peaks);
    assert.equal(bands.length, 12);
    const fourth = bands[3]!;
    assert.equal(fourth.count, 1);
    assert.ok(Math.abs(Math.sqrt(fourth.lines) - 0.005 / Math.SQRT2) < 0.001);
    // The swelling noise lifts the continuum around M2 over the band's edges, and nowhere else as much.
    const second = bands[1]!;
    assert.ok(second.rise > 0.5 * second.floor, `${second.rise} over ${second.floor}`);
    assert.ok(bands.every((b) => b.species === 2 || b.rise < second.rise / 4));
  });

  it("names a peak for a fitted line first, then the catalog, then a built line", () => {
    const tolerance = 360 / 26304;
    const m2 = 28.9841042;
    assert.equal(nameOf(m2, tolerance, new Set(["M2"])).fitted, "M2");
    assert.equal(nameOf(m2, tolerance, new Set(["S2"])).fitted, null);
    assert.equal(nameOf(m2, tolerance, new Set()).name, "M2");
    assert.equal(nameOf(116.9523127, tolerance, new Set()).kind, "compound");
    assert.equal(nameOf(116.9523127, tolerance, new Set(["3MS8"])).fitted, "3MS8");
    // L2's neighbor two perigee cycles on is within a bin of L2.
    const beside = nameOf(29.5377, tolerance, new Set(["L2"]));
    assert.equal(beside.fitted, "L2");
    assert.ok(Math.abs(beside.offset! - 0.0092) < 0.0005);
    // Two of S2 and O1 less a cycle a year is no catalog line.
    const built = nameOf(2 * 30 + 13.9430356 - 0.0410686, tolerance, new Set());
    assert.equal(built.kind, "built");
    assert.equal(built.name, "2S2+O1−Sa");
    assert.equal(nameOf(20.5, tolerance, new Set()).kind, "none");
  });

  it("keeps a line's speed between its bin and its larger neighbor", () => {
    for (let seed = 200; seed < 230; seed++) {
      const spec = spectrum(series([[57.9682084, 0.0012]], seed));
      const floor = continuum(spec.power, halfWidth(spec.n));
      for (const peak of peaksOf(spec, floor, 4, new Set())) {
        const bins = peak.speed / (360 / spec.n);
        const k = Math.round(bins);
        assert.ok(spec.power[k]! >= spec.power[k - 1]! && spec.power[k]! >= spec.power[k + 1]!);
        assert.ok(Math.abs(bins - k) <= 0.5 + 1e-9, String(bins - k));
      }
    }
  });

  it("reads a held-out line again in the fitted years", () => {
    const n = 166560;
    const bin = 360 / n;
    const at = (speed: number) => Math.round(speed / bin);
    const empty = () => new Float32Array(n / 2 + 1);
    const [observed, predicted, residual, l2] = [empty(), empty(), empty(), empty()];
    const speeds = { "2N2": 27.8953548, L2: 29.5284789, M2: 28.9841042, "3L2": 29.5331208 };
    // A line the fit lacks, two perigee cycles below 2N2.
    observed[at(speeds["2N2"] - 0.0092)] = 0.04;
    residual[at(speeds["2N2"] - 0.0092)] = 0.04;
    // A line the prediction adds, two perigee cycles above L2.
    predicted[at(speeds.L2 + 0.0092)] = 0.03;
    l2[at(speeds.L2 + 0.0092)] = 0.029;
    residual[at(speeds.L2 + 0.0092)] = 0.03;
    // M2 a little larger than predicted: its own bin and the taper's spread into the next.
    for (const [offset, share] of [
      [0, 1],
      [1, 0.5],
    ] as const) {
      observed[at(speeds.M2) + offset] = 2.02 * share;
      predicted[at(speeds.M2) + offset] = 2 * share;
      residual[at(speeds.M2) + offset] = 0.02 * share;
    }
    // A larger residual next to another fitted constituent, which is that constituent's.
    residual[at(speeds["3L2"]) + 1] = 0.5;
    const peak = (speed: number, fitted: string) => ({
      speed,
      cpd: speed / 15,
      species: 2,
      amplitude: 0.03,
      ratio: 100,
      kind: "catalog" as const,
      name: null,
      others: [],
      fitted,
      offset: 0,
    });
    const lines = resolveLines(
      [
        peak(speeds["2N2"] - 0.009, "2N2"),
        peak(speeds.L2 + 0.009, "L2"),
        peak(speeds.M2 - 0.002, "M2"),
        { ...peak(speeds.M2, "M2"), amplitude: 0.001 },
      ],
      26304,
      ["2N2", "L2", "M2", "3L2"],
      { n, observed, predicted, residual, l2 },
    );
    assert.deepEqual(
      lines.map((l) => [l.fitted, l.reading]),
      [
        ["2N2", "observed, not predicted"],
        ["L2", "predicted, not observed"],
        ["M2", "the constituent itself"],
      ],
    );
    assert.equal(lines[0]!.line, "2MK2");
    assert.deepEqual(
      lines.map((l) => Math.round(l.l2 * 1000)),
      [0, 29, 0],
    );
    assert.ok(Math.abs(lines[0]!.at - (speeds["2N2"] - 0.0092)) < bin);
  });

  it("lists gauges and compounds the engine knows", () => {
    assert.equal(COMPOUNDS.length, 59);
    assert.equal(new Set(COMPOUNDS).size, 59);
    assert.deepEqual(
      COMPOUNDS.filter((name) => !constituents[name]),
      [],
    );
    assert.equal(GAUGES.length, 56);
    assert.equal(new Set(GAUGES).size, 56);
    // A gauge drawn or read again that isn't fitted would stop a run after its fits.
    for (const id of [...Object.keys(FIGURES), ...RESOLVED]) assert.ok(GAUGES.includes(id), id);
  });

  it("measures gauges, sorts them and writes the report and a figure", () => {
    const hours = 26280;
    // Four gauges: two whose compounds take a sixth-diurnal line out of the residual, two with none to take.
    const gauge = (id: string, seed: number, line: number): Fitted => {
      const base = series(line ? [[86.407938, line]] : [], seed, hours);
      const all = series([], seed, hours);
      const constants = [
        { name: "M2", amplitude: 1, phase: 0 },
        { name: "M4", amplitude: 0.05, phase: 0 },
        { name: "Sa", amplitude: 0.3, phase: 0 },
      ];
      return {
        id,
        name: id,
        latitude: 0,
        held_out: [2021, 2023],
        hours,
        observed: pack(base),
        windows: [
          { years: 2, skipped: "not fitted" },
          { years: 5, skipped: "not fitted" },
          {
            years: 19,
            hours: 160000,
            base: { constants, residual: pack(base) },
            all: { constants, residual: pack(all) },
          },
        ],
      };
    };
    const ids = [...Object.keys(FIGURES).slice(0, 1), "coops/a", "coops/b", "coops/c"];
    const fitted = ids.map((id, i) => gauge(id, 300 + i, i < 2 ? 0.02 : 0));
    const run = {
      engine: "engine",
      method: 1,
      node_corrections: "schureman",
      final_years: { coops: 2023 },
      sources: {
        coops: {
          name: "A source",
          attribution: "Its credit",
          license: "Its license",
          license_url: "https://example.org/license",
        },
      },
      credits: { "coops/a": "An archive's credit" },
    };
    const { report, drawn } = measure(run, fitted);
    const windows = report.gauges.map((g) => g.windows[2]!);
    for (const [i, w] of windows.entries()) {
      assert.ok(!("skipped" in w));
      // 20 mm of line in 20 mm of noise is 4 mm of RMS.
      assert.ok(
        i < 2 ? Math.abs(w.gain - 0.0041) < 0.0005 : Math.abs(w.gain) < 1e-9,
        String(w.gain),
      );
      assert.ok(i < 2 ? w.measures.lines3 > 0.012 : w.measures.lines3 < 0.004);
      // Sa is not in the fitted tide.
      assert.ok(Math.abs(w.measures.tide - Math.sqrt((1 + 0.05 ** 2) / 2)) < 1e-9);
      assert.equal(w.yearly.length, 3);
    }
    const sorting = report.sortings[19]!.find((s) => s.measure === "lines3")!;
    assert.deepEqual([sorting.hits, sorting.misses, sorting.false_alarms], [2, [], []]);
    assert.equal(report.sortings[2]!.length, 0);
    const markdown = render(report);
    for (const text of [
      "## Method",
      "### Totals",
      "A source: Its credit. [Its license](https://example.org/license).",
      "An archive's credit",
    ])
      assert.ok(markdown.includes(text), text);
    assert.ok(!markdown.includes("NaN") && !markdown.includes("undefined"));
    assert.equal(drawn.length, 1);
    const svg = figure(drawn[0]!, barFor(hours).family);
    assert.ok(svg.startsWith("<svg") && !svg.includes("NaN"));
  });

  it("sorts gauges by the cut with the fewest on the wrong side", () => {
    const rows = [
      { id: "a", score: 1, gain: 0 },
      { id: "b", score: 2, gain: 0 },
      { id: "c", score: 3, gain: 0.002 },
      { id: "d", score: 5, gain: 0.004 },
      { id: "e", score: 4, gain: 0 },
    ];
    const sorting = sortingOf("lines3", rows, 0.001)!;
    assert.equal(sorting.gaining, 2);
    assert.equal(sorting.hits + sorting.misses.length, 2);
    assert.equal(sorting.misses.length + sorting.false_alarms.length, 1);
    assert.ok(Math.abs(sorting.auc - 5 / 6) < 1e-9);
    assert.equal(sortingOf("lines3", rows.slice(0, 2), 0.001), null);
    // One score for every gauge sorts nothing.
    const tied = rows.map((r) => ({ ...r, score: 1 }));
    assert.equal(sortingOf("lines3", tied, 0.001), null);
  });
});
