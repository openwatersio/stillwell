import { constituents as catalog } from "@slackwater/engine";
import { CANDIDATES } from "./candidates.ts";

/**
 * What the spectrum of a fit's held-out residual holds, species by species:
 * the lines standing above the continuum, the broad rise around the main
 * lines, and whether either tells the gauges that gain from shallow-water
 * compounds from those that don't. `scripts/residual-spectra.ts` makes the
 * fits; everything here works on their residuals and reads no store.
 *
 * The method follows Zetler and Cummings (1967, J. Mar. Res. 25, 103-114),
 * who took the Fourier amplitudes of a residual, named the values standing
 * above the continuum and left the energy between the line groups alone, and
 * Boesch and Müller-Navarra (2019, Ocean Sci. 15, 1363-1379), who set a
 * periodogram's bar at a percentile of its noise.
 */

/** Years fitted before the held-out years. */
export const WINDOWS = [2, 5, 19] as const;
/** Years no fit reads, which the constants predict. */
export const HELD_OUT_YEARS = 3;
/** The share of a window's hours the store must hold for it to be fitted. */
export const YEAR_SHARE = 2 / 3;

/**
 * The gauges: 20 of NOAA's, from Honolulu to Anchorage, Kartverket's 24, 7 of
 * Rijkswaterstaat's on the Dutch coast and 5 in the German Bight (Borkum
 * Fischerbalje, Helgoland Binnenhafen, Cuxhaven Steubenhöft, Husum and
 * Hamburg St. Pauli).
 */
// prettier-ignore
export const GAUGES: string[] = [
  ...["1612340", "1820000", "1770000", "8410140", "8443970", "8518750", "8545240", "8574680", "8638610", "8665530", "8724580", "8729840", "8761724", "8771450", "9410170", "9435380", "9449880", "9455920", "9462620", "9751639"].map((id) => `coops/${id}`),
  ...["AES", "ANX", "BGO", "BOO", "HAR", "HEI", "HFT", "HRO", "HVG", "KAB", "KSU", "MAY", "MSU", "NVK", "NYA", "OSC", "OSL", "RVK", "SVG", "TOS", "TRD", "TRG", "VAW", "VIK"].map((id) => `kartverket/${id}`),
  ...["vlissingen", "rilland.bath", "hoekvanholland", "ijmuiden.buitenhaven", "denhelder.marsdiep", "harlingen.waddenzee", "delfzijl"].map((id) => `rws/${id}`),
  ...["9340020", "9510070", "5990020", "9530020", "5952050"].map((id) => `pegelonline/${id}`),
];

/** The gauges whose spectra are drawn: four that gain from the compounds and two open-coast controls. */
export const FIGURES: Record<string, string> = {
  "coops/9455920": "anchorage",
  "rws/vlissingen": "vlissingen",
  "pegelonline/5990020": "cuxhaven",
  "coops/8545240": "philadelphia",
  "coops/1612340": "honolulu",
  "coops/9410170": "san-diego",
};

/**
 * The 59 shallow-water compounds NOAA publishes for Anchorage beyond the
 * candidates, by the engine's names, in the order NOAA lists them. NOAA's
 * 4MSL12 is the engine's 6MSN12.
 */
// prettier-ignore
export const COMPOUNDS: string[] = [
  "3MS8", "NO3", "MLN2S2", "3MS4", "4MS10", "MSL6", "3MN8", "2MLNS6", "MSKO7", "3MLS6", "MSK5", "2MLS4",
  "ML4", "2MP5", "MSN6", "2ML2S2", "2ML6", "2MSO7", "OQ2", "SKM2", "2NMLS6", "2MSN8", "2(MS)8", "3MP5",
  "SL4", "MNK5", "2NM6", "2MSL8", "3MSN10", "MNO5", "3M2S10", "2PO1", "5MS12", "M10", "4MN10", "2MNO7",
  "4MLS8", "3MK8", "2MSK8", "3MSK9", "4MSN12", "4M2S12", "3MSL10", "2(MN)8", "3KM5", "2NS2", "4MK9",
  "4MSK11", "3ML8", "6MSN12", "OP2", "M2(KS)2", "3MNK9", "2MS2K2", "2NMK7", "MKL2S2", "2M2NK9",
  "2KM(SN)2", "2SN(MK)2",
];

export interface Constant {
  name: string;
  amplitude: number;
  phase: number;
}

/** One fit: its constants, and observed minus predicted over the held-out hours as `pack` writes it. */
export interface Arm {
  constants: Constant[];
  residual: string;
}

export type FittedWindow =
  { years: number; hours: number; base: Arm; all: Arm } | { years: number; skipped: string };

/** A gauge's fits, as the cache keeps them. */
export interface Fitted {
  id: string;
  name: string;
  latitude: number;
  /** The first and last held-out year. */
  held_out: [number, number];
  /** Hours from the start of the first held-out year to the end of the last. */
  hours: number;
  /** The observed levels over those hours with the slow part filtered out, as `pack` writes them. */
  observed: string;
  windows: FittedWindow[];
}

/** What a run was made with. */
export interface Run {
  engine: string;
  method: number;
  node_corrections: string;
  final_years: Record<string, number>;
  sources: Record<
    string,
    { name: string; attribution: string; license: string; license_url: string }
  >;
  /** The credit of each gauge whose values carry one other than its source's. */
  credits: Record<string, string>;
}

/** An hourly series as base64 of its 32-bit floats, NaN where an hour has no value. */
export function pack(series: Float32Array): string {
  return Buffer.from(series.buffer, series.byteOffset, series.byteLength).toString("base64");
}

export function unpack(packed: string): Float32Array {
  const bytes = Buffer.from(packed, "base64");
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
}

// ---------------------------------------------------------------------------
// The spectrum

/** In place radix-2 FFT of a length that is a power of two. */
function fft2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/**
 * The discrete Fourier transform of a real series of any length, at its own
 * N frequencies k/N, by Bluestein's chirp transform: no padding, so the bins
 * are the series' own and independent of each other.
 */
export function dft(x: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = x.length;
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    // k² mod 2n keeps the angle exact for long series.
    const angle = (Math.PI * ((k * k) % (2 * n))) / n;
    cos[k] = Math.cos(angle);
    sin[k] = Math.sin(angle);
  }
  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    ar[k] = x[k]! * cos[k]!;
    ai[k] = -x[k]! * sin[k]!;
    br[k] = cos[k]!;
    bi[k] = sin[k]!;
    if (k) {
      br[m - k] = cos[k]!;
      bi[m - k] = sin[k]!;
    }
  }
  fft2(ar, ai);
  fft2(br, bi);
  for (let k = 0; k < m; k++) {
    const r = ar[k]! * br[k]! - ai[k]! * bi[k]!;
    // Conjugated, so the forward transform below is the inverse.
    ai[k] = -(ar[k]! * bi[k]! + ai[k]! * br[k]!);
    ar[k] = r;
  }
  fft2(ar, ai);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const r = ar[k]! / m;
    const i = -ai[k]! / m;
    re[k] = r * cos[k]! + i * sin[k]!;
    im[k] = i * cos[k]! - r * sin[k]!;
  }
  return { re, im };
}

/** A spectrum of an hourly series under a Hann taper, with missing hours given no weight. */
export interface Spectrum {
  /** Hours in the series, missing ones included. */
  n: number;
  /** The share of hours with a value. */
  coverage: number;
  /** Variance per bin, in m², for bins 0 to n/2: summed over the bins it is the series' variance. */
  power: Float64Array;
  /** The amplitude, in meters, a line centered on each bin would have. */
  amplitude: Float64Array;
  /** The taper's own power at each offset in bins, over its power at none: what a line leaks to its neighbors. */
  leak: Float64Array;
  /** The amplitude of a line whose bin holds a variance of one: what turns `power` into `amplitude`, which the gaps change. */
  scale: number;
}

export function spectrum(series: Float32Array): Spectrum {
  const n = series.length;
  let sum = 0;
  let count = 0;
  for (const x of series)
    if (Number.isFinite(x)) {
      sum += x;
      count++;
    }
  const mean = count ? sum / count : 0;
  const tapered = new Float64Array(n);
  const taper = new Float64Array(n);
  let weight = 0;
  let squares = 0;
  for (let t = 0; t < n; t++) {
    if (!Number.isFinite(series[t]!)) continue;
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * t) / n));
    taper[t] = w;
    tapered[t] = w * (series[t]! - mean);
    weight += w;
    squares += w * w;
  }
  const half = Math.floor(n / 2);
  const power = new Float64Array(half + 1);
  const amplitude = new Float64Array(half + 1);
  const leak = new Float64Array(half + 1);
  const x = dft(tapered);
  const w = dft(taper);
  for (let k = 0; k <= half; k++) {
    const square = x.re[k]! ** 2 + x.im[k]! ** 2;
    power[k] = (2 * square) / (n * squares);
    amplitude[k] = (2 * Math.sqrt(square)) / weight;
    leak[k] = (w.re[k]! ** 2 + w.im[k]! ** 2) / weight ** 2;
  }
  return {
    n,
    coverage: count / n,
    power,
    amplitude,
    leak,
    scale: Math.sqrt(2 * n * squares) / weight,
  };
}

/** Bins per cycle per day in a spectrum of `n` hours. */
const perCpd = (n: number) => n / 24;
/** Degrees per hour of one bin. */
const binSpeed = (n: number) => 360 / n;

/** Half the width of the running median the continuum is taken from: 0.04 cycles per day, and never under 30 bins. */
export const halfWidth = (n: number) => Math.max(Math.round(0.04 * perCpd(n)), 30);

/**
 * The continuum under a spectrum: the running median of the power over
 * `halfWidth` bins either side, over ln 2, which is the mean of the
 * exponential distribution a periodogram's noise has. A line fills three
 * bins of some 90, so it barely moves the median, and a rise as broad as the
 * window is followed.
 */
export function continuum(power: Float64Array, half: number): Float64Array {
  const out = new Float64Array(power.length);
  const window = new Float64Array(2 * half + 1);
  for (let k = 0; k < power.length; k++) {
    const lo = Math.max(1, k - half);
    const hi = Math.min(power.length - 1, k + half);
    const slice = window.subarray(0, hi - lo + 1);
    slice.set(power.subarray(lo, hi + 1));
    slice.sort();
    const mid = slice.length >> 1;
    const median = slice.length % 2 ? slice[mid]! : (slice[mid - 1]! + slice[mid]!) / 2;
    out[k] = median / Math.LN2;
  }
  return out;
}

/** The lowest frequency examined, in cycles per day: below it the filter takes out a growing share of the residual and no tide the fits here are scored on lies. */
export const LOWEST_CPD = 0.5;
/** The first bin examined and the one past the last, which stops two bins short of the Nyquist frequency. */
const examined = (n: number): [number, number] => [
  Math.ceil(LOWEST_CPD * perCpd(n)),
  Math.floor(n / 2) - 1,
];

/** A small seeded generator, so the bars are the same on every run. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many series of white noise a bar is measured on. */
export const SURROGATES = 300;
/** The chance that a spectrum of noise alone has any bin over the bar. */
export const FAMILY_RATE = 0.05;

/** The bars a spectrum of `n` hours is held to, as power over the continuum. */
export interface Bar {
  n: number;
  /** Bins examined. */
  bins: number;
  /** Exceeded by any bin in `FAMILY_RATE` of spectra of white noise: what a line must reach. */
  family: number;
  /** The same from the exponential distribution with the continuum known, ln(bins / rate), for comparison. */
  analytic: number;
  /** The 99.5th percentile of one bin of white noise, Boesch and Müller-Navarra's level. */
  percentile: number;
}

const bars = new Map<number, Bar>();

/**
 * The bars for spectra of `n` hours, measured on white noise put through the
 * same taper, the same continuum and the same bins. White noise stands for
 * any continuum that is smooth over the median's window, since the bar is a
 * ratio to it. A real continuum that rises inside the window, a cusp, is not
 * covered.
 */
export function barFor(n: number): Bar {
  const known = bars.get(n);
  if (known) return known;
  const random = mulberry(n);
  const [first, end] = examined(n);
  const maxima: number[] = [];
  const ratios: number[] = [];
  const series = new Float32Array(n);
  for (let s = 0; s < SURROGATES; s++) {
    for (let t = 0; t < n; t += 2) {
      // Box-Muller.
      const r = Math.sqrt(-2 * Math.log(1 - random()));
      const a = 2 * Math.PI * random();
      series[t] = r * Math.cos(a);
      if (t + 1 < n) series[t + 1] = r * Math.sin(a);
    }
    const { power } = spectrum(series);
    const floor = continuum(power, halfWidth(n));
    let max = 0;
    for (let k = first; k < end; k++) {
      const ratio = power[k]! / floor[k]!;
      if (ratio > max) max = ratio;
      // A tenth of the bins is enough for one bin's percentile.
      if ((k + s) % 10 === 0) ratios.push(ratio);
    }
    maxima.push(max);
  }
  const quantile = (xs: number[], q: number) =>
    xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;
  const bar: Bar = {
    n,
    bins: end - first,
    family: quantile(maxima, 1 - FAMILY_RATE),
    analytic: Math.log((end - first) / FAMILY_RATE),
    percentile: quantile(ratios, 0.995),
  };
  bars.set(n, bar);
  return bar;
}

// ---------------------------------------------------------------------------
// Names for a frequency

interface Line {
  name: string;
  /** Degrees per hour. */
  speed: number;
  kind: "candidate" | "compound" | "catalog" | "built";
  /** For a built line, how many parents it sums. */
  order?: number;
}

const candidateNames = new Set(CANDIDATES.map((c) => c.name));
const compoundNames = new Set(COMPOUNDS);

/** Every line the engine's catalog defines, once each, with the candidates' own speeds for theirs. */
const NAMED: Line[] = (() => {
  const lines: Line[] = CANDIDATES.map((c) => ({
    name: c.name,
    speed: c.speed,
    kind: "candidate",
  }));
  const seen = new Set(candidateNames);
  for (const c of Object.values(catalog)) {
    if (seen.has(c.name) || !(c.speed > 0)) continue;
    seen.add(c.name);
    lines.push({
      name: c.name,
      speed: c.speed,
      kind: compoundNames.has(c.name) ? "compound" : "catalog",
    });
  }
  return lines.sort((a, b) => a.speed - b.speed);
})();

/** The most parents a built line sums. */
export const BUILT_ORDER = 8;

/**
 * Lines a catalog needn't hold: sums and differences of M2, S2, N2, K2, K1
 * and O1 and up to two cycles a year either side, of up to `BUILT_ORDER`
 * terms in all, each parent within the range `parents` gives it. Rossiter and Lennon (1968, Geophys. J. R. astr. Soc. 16,
 * 275-293) named the Thames's residual lines from such a set.
 */
const BUILT: Line[] = (() => {
  const speedOf = (name: string) => CANDIDATES.find((c) => c.name === name)!.speed;
  const parents: [string, number, number, number][] = [
    ["M2", speedOf("M2"), -3, 6],
    ["S2", speedOf("S2"), -3, 6],
    ["N2", speedOf("N2"), -2, 3],
    ["K2", speedOf("K2"), -2, 2],
    ["K1", speedOf("K1"), -2, 2],
    ["O1", speedOf("O1"), -2, 2],
    ["Sa", speedOf("Sa"), -2, 2],
  ];
  const lines: Line[] = [];
  const counts = new Array<number>(parents.length).fill(0);
  const walk = (i: number, speed: number, order: number) => {
    if (i === parents.length) {
      if (order < 2 || speed <= 0 || speed >= 180) return;
      const term = (n: number, name: string, lead: boolean) =>
        n === 0
          ? ""
          : `${n < 0 ? "−" : lead ? "" : "+"}${Math.abs(n) === 1 ? "" : Math.abs(n)}${name}`;
      let label = "";
      // Sums first, so a name starts with what is added.
      const order_ = [...counts.keys()].sort(
        (a, b) => Math.sign(counts[b]!) - Math.sign(counts[a]!),
      );
      for (const j of order_) label += term(counts[j]!, parents[j]![0], label === "");
      lines.push({ name: label, speed, kind: "built", order });
      return;
    }
    const [, parentSpeed, lo, hi] = parents[i]!;
    for (let n = lo; n <= hi; n++) {
      if (order + Math.abs(n) > BUILT_ORDER) continue;
      counts[i] = n;
      walk(i + 1, speed + n * parentSpeed, order + Math.abs(n));
    }
    counts[i] = 0;
  };
  walk(0, 0, 0);
  return lines.sort((a, b) => a.speed - b.speed);
})();

/** The lines of `sorted` within `tolerance` degrees per hour of `speed`. */
function near(sorted: readonly Line[], speed: number, tolerance: number): Line[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.speed < speed - tolerance) lo = mid + 1;
    else hi = mid;
  }
  const found: Line[] = [];
  for (let i = lo; i < sorted.length && sorted[i]!.speed <= speed + tolerance; i++)
    found.push(sorted[i]!);
  return found;
}

/** What a peak is called, and why. */
export interface Naming {
  /** Where the name is from: a candidate, one of the 59 compounds, another catalog line, or a combination built here. */
  kind: "candidate" | "compound" | "catalog" | "built" | "none";
  name: string | null;
  /** Other lines within a bin, which the spectrum can't tell from it. */
  others: string[];
  /** The nearest constituent the fit holds within a bin, and the peak's speed less its own; null where none is. */
  fitted: string | null;
  offset: number | null;
}

/**
 * The name of a peak at `speed`, from lines within one bin of it: the nearest
 * the catalog names, else the built line of fewest parents. `fitted` is the
 * nearest constituent the fit already holds within the same bin. A peak
 * beside one is either that constituent, larger, smaller or later in these
 * years than its constants say, or a neighbor the spectrum can't separate
 * from it.
 */
export function nameOf(speed: number, tolerance: number, fitted: ReadonlySet<string>): Naming {
  const byDistance = (a: Line, b: Line) => Math.abs(a.speed - speed) - Math.abs(b.speed - speed);
  const named = near(NAMED, speed, tolerance).sort(byDistance);
  const held = named.find((l) => fitted.has(l.name));
  const beside = { fitted: held?.name ?? null, offset: held ? speed - held.speed : null };
  if (named.length)
    return {
      kind: named[0]!.kind as Naming["kind"],
      name: named[0]!.name,
      others: named.slice(1).map((l) => l.name),
      ...beside,
    };
  const built = near(BUILT, speed, tolerance).sort(
    (a, b) => a.order! - b.order! || byDistance(a, b),
  );
  if (built.length)
    return {
      kind: "built",
      name: built[0]!.name,
      others: built
        .slice(1)
        .filter((l) => l.order === built[0]!.order)
        .map((l) => l.name),
      ...beside,
    };
  return { kind: "none", name: null, others: [], ...beside };
}

/** The share of the examined bins of a spectrum of `n` hours that some line, named or built, lies within a bin of. */
export function nameable(n: number): { named: number; any: number } {
  const [first, end] = examined(n);
  let named = 0;
  let any = 0;
  for (let k = first; k < end; k++) {
    const speed = k * binSpeed(n);
    const isNamed = near(NAMED, speed, binSpeed(n)).length > 0;
    if (isNamed) named++;
    if (isNamed || near(BUILT, speed, binSpeed(n)).length > 0) any++;
  }
  return { named: named / (end - first), any: any / (end - first) };
}

// ---------------------------------------------------------------------------
// Lines and species

/** A line standing above the continuum. */
export interface Peak {
  /** Degrees per hour, interpolated between bins. */
  speed: number;
  /** Cycles per day. */
  cpd: number;
  species: number;
  /** Meters. */
  amplitude: number;
  /** Power over the continuum at its bin. */
  ratio: number;
  kind: Naming["kind"];
  name: string | null;
  others: string[];
  fitted: string | null;
  offset: number | null;
}

/** A peak must stand this many times over what the stronger lines found leak into its bin. */
const LEAK_MARGIN = 4;

/**
 * The lines of a spectrum: bins whose power is at least `bar` times the
 * continuum and no less than their neighbors', strongest first, each kept
 * unless it lies within two bins of a stronger one or could be that one's
 * leakage through the taper and the gaps. Frequency and amplitude are
 * interpolated between the peak's bin and its larger neighbor (Grandke 1983,
 * IEEE Trans. Instrum. Meas. 32, 350-355).
 */
export function peaksOf(
  spec: Spectrum,
  floor: Float64Array,
  bar: number,
  fitted: ReadonlySet<string>,
): Peak[] {
  const { n, power, amplitude, leak } = spec;
  const [first, end] = examined(n);
  const found: number[] = [];
  for (let k = first; k < end; k++)
    if (
      floor[k]! > 0 &&
      power[k]! >= bar * floor[k]! &&
      power[k]! >= power[k - 1]! &&
      power[k]! >= power[k + 1]!
    )
      found.push(k);
  found.sort((a, b) => power[b]! - power[a]!);
  const kept: number[] = [];
  for (const k of found) {
    let leaked = 0;
    let close = false;
    for (const j of kept) {
      const d = Math.abs(k - j);
      if (d <= 2) close = true;
      leaked += power[j]! * (leak[d]! / leak[0]!);
    }
    if (!close && power[k]! > LEAK_MARGIN * leaked) kept.push(k);
  }
  return kept
    .map((k) => {
      const side = amplitude[k + 1]! > amplitude[k - 1]! ? 1 : -1;
      const alpha = amplitude[k + side]! / amplitude[k]!;
      // The formula holds for a line between the peak's bin and its larger neighbor; noise and gaps
      // can put the ratio outside that, where it would move the line the wrong way.
      const delta = Math.min(0.5, Math.max(0, (2 * alpha - 1) / (alpha + 1)));
      const scallop =
        Math.abs(delta) < 1e-9
          ? 1
          : (Math.PI * delta * (1 - delta * delta)) / Math.sin(Math.PI * delta);
      const bin = k + side * delta;
      const speed = bin * binSpeed(n);
      const cpd = bin / perCpd(n);
      return {
        speed,
        cpd,
        species: speciesOf(cpd),
        amplitude: amplitude[k]! * scallop,
        ratio: power[k]! / floor[k]!,
        ...nameOf(speed, binSpeed(n), fitted),
      };
    })
    .sort((a, b) => a.speed - b.speed);
}

/** The highest species an hourly series holds: the twelfth lies against the Nyquist frequency. */
export const SPECIES = 12;
/** The species a frequency belongs to: the whole number of cycles per day nearest it. */
const speciesOf = (cpd: number) => Math.min(SPECIES, Math.max(1, Math.round(cpd)));

/** One species' share of a spectrum, each in m². */
export interface Band {
  species: number;
  /** All the variance in the band. */
  total: number;
  /** The continuum as it would be with no tide near: a line between its levels at the band's two edges. */
  floor: number;
  /** The continuum's rise above that floor: the broad rise around the lines, with no line in it. */
  rise: number;
  /** The lines' variance, half each amplitude squared. */
  lines: number;
  count: number;
}

/**
 * A spectrum by species. A species' band is the cycle per day around its
 * whole number, which holds all its lines and, at its two edges, no tide at
 * all. The floor runs between the continuum's levels at those edges, in the
 * logarithm, so the rise is what the continuum gains toward the lines.
 */
export function bandsOf(spec: Spectrum, floor: Float64Array, peaks: readonly Peak[]): Band[] {
  const per = perCpd(spec.n);
  const [first, end] = examined(spec.n);
  const edge = (cpd: number) => {
    const lo = Math.max(first, Math.round((cpd - 0.05) * per));
    const hi = Math.min(end, Math.round((cpd + 0.05) * per));
    if (hi - lo < 3) return null;
    const levels = [...floor.subarray(lo, hi)].sort((a, b) => a - b);
    return Math.log(Math.max(levels[levels.length >> 1]!, Number.MIN_VALUE));
  };
  const bands: Band[] = [];
  for (let species = 1; species <= SPECIES; species++) {
    const lo = Math.max(first, Math.round((species - 0.5) * per));
    const hi = Math.min(end, Math.round((species + 0.5) * per));
    const below = edge(species - 0.5);
    const above = edge(species + 0.5) ?? below;
    let total = 0;
    let base = 0;
    let rise = 0;
    for (let k = lo; k < hi; k++) {
      const share = (k / per - (species - 0.5)) / 1;
      const level = Math.exp(below! + (above! - below!) * Math.min(1, Math.max(0, share)));
      total += spec.power[k]!;
      base += level;
      rise += floor[k]! - level;
    }
    const own = peaks.filter((p) => p.species === species);
    bands.push({
      species,
      total,
      floor: base,
      rise,
      lines: own.reduce((s, p) => s + p.amplitude ** 2 / 2, 0),
      count: own.length,
    });
  }
  return bands;
}

// ---------------------------------------------------------------------------
// The measurement

const rmsOf = (series: Float32Array, from = 0, to = series.length) => {
  let sum = 0;
  let count = 0;
  for (let t = from; t < to; t++)
    if (Number.isFinite(series[t]!)) {
      sum += series[t]! ** 2;
      count++;
    }
  return count ? Math.sqrt(sum / count) : NaN;
};

/** What one fit's held-out residual holds. */
export interface Measured {
  /** Constituents the fit kept. */
  kept: number;
  /** RMS of the residual over the held-out hours, meters. */
  rms: number;
  bands: Band[];
  /** The lines; listed for the longest fits only. */
  peaks: Peak[];
  /** Bins over Boesch and Müller-Navarra's 99.5th percentile, which a spectrum of noise has in 0.5% of its bins. */
  over_percentile: number;
}

/** The measures a trigger could read from the fit of the candidates alone. */
export const MEASURES = {
  lines3: "Line energy, third-diurnal and up",
  lines2: "Line energy, semidiurnal",
  lines1: "Line energy, diurnal",
  lines: "Line energy, all species",
  count3: "Lines, third-diurnal and up",
  excess3: "Energy over the floor, third-diurnal and up",
  rise3: "Rise without lines, third-diurnal and up",
  total3: "All energy, third-diurnal and up",
  ratio3: "Energy over the floor's, third-diurnal and up",
  new3: "Line energy beside no fitted constituent, third-diurnal and up",
  expected: "Gain if every line were removed",
  expected3: "Gain if the lines third-diurnal and up were removed",
  expectedNew: "Gain if the lines beside no fitted constituent were removed",
  fitted3: "Fitted amplitudes, third-diurnal and up",
  m4m2: "M4 over M2",
  tide: "Fitted tide",
  rms: "Residual",
} as const;
export type Measure = keyof typeof MEASURES;
export const MEASURE_NAMES = Object.keys(MEASURES) as Measure[];
/** Measures in millimeters; the rest are ratios or counts. */
const IN_MM: readonly Measure[] = [
  "lines3",
  "lines2",
  "lines1",
  "lines",
  "excess3",
  "rise3",
  "total3",
  "new3",
  "expected",
  "expected3",
  "expectedNew",
  "fitted3",
  "tide",
  "rms",
];

const root = (x: number) => Math.sqrt(Math.max(0, x));

function measuresOf(m: Measured, constants: readonly Constant[]): Record<Measure, number> {
  const sum = (pick: (b: Band) => number, from: number, to = SPECIES) =>
    m.bands.filter((b) => b.species >= from && b.species <= to).reduce((s, b) => s + pick(b), 0);
  const speeds = new Map(NAMED.map((l) => [l.name, l.speed]));
  const amplitude = (name: string) => constants.find((c) => c.name === name)?.amplitude ?? 0;
  const lines = sum((b) => b.lines, 1);
  const energy = (peaks: readonly Peak[]) => peaks.reduce((s, p) => s + p.amplitude ** 2 / 2, 0);
  return {
    lines3: root(sum((b) => b.lines, 3)),
    lines2: root(sum((b) => b.lines, 2, 2)),
    lines1: root(sum((b) => b.lines, 1, 1)),
    lines: root(lines),
    count3: sum((b) => b.count, 3),
    excess3: root(sum((b) => b.total - b.floor, 3)),
    rise3: root(sum((b) => Math.max(0, b.rise), 3)),
    total3: root(sum((b) => b.total, 3)),
    ratio3: sum((b) => b.total, 3) / sum((b) => b.floor, 3),
    new3: root(energy(m.peaks.filter((p) => p.fitted === null && p.species >= 3))),
    expected: m.rms - root(m.rms ** 2 - lines),
    expected3: m.rms - root(m.rms ** 2 - sum((b) => b.lines, 3)),
    expectedNew: m.rms - root(m.rms ** 2 - energy(m.peaks.filter((p) => p.fitted === null))),
    fitted3: root(
      constants
        .filter((c) => (speeds.get(c.name) ?? 0) > 37.5)
        .reduce((s, c) => s + c.amplitude ** 2 / 2, 0),
    ),
    m4m2: amplitude("M2") ? amplitude("M4") / amplitude("M2") : 0,
    // Without Sa and Ssa, which every fit here holds whatever their yearly spread.
    tide: root(
      constants
        .filter((c) => (speeds.get(c.name) ?? 0) > 0.1)
        .reduce((s, c) => s + c.amplitude ** 2 / 2, 0),
    ),
    rms: m.rms,
  };
}

/** One held-out year by itself: a spectrum a third as fine. */
export interface Yearly {
  year: number;
  coverage: number;
  /** The trigger measures from the candidates' fit over this year alone. */
  measures: Record<Measure, number>;
  /** Hours with a residual. */
  hours: number;
  /** RMS of each fit's residual over the year, meters. */
  rms: { base: number; all: number };
}

export interface WindowResult {
  years: number;
  hours: number;
  base: Measured;
  all: Measured;
  /** What the compounds take off the held-out RMS, meters. */
  gain: number;
  measures: Record<Measure, number>;
  yearly: Yearly[];
}

export interface GaugeResult {
  id: string;
  name: string;
  latitude: number;
  held_out: [number, number];
  hours: number;
  coverage: number;
  /** RMS of the observed levels with the slow part filtered out, meters. */
  observed_rms: number;
  windows: (WindowResult | { years: number; skipped: string })[];
}

/** How one measure sorts the gauges that gain from those that don't. */
export interface Sorting {
  measure: Measure;
  /** Gauges sorted, gaining and not. */
  gaining: number;
  others: number;
  /** The chance a gauge that gains scores above one that doesn't. */
  auc: number;
  /** Rank correlation of the measure with the gain. */
  spearman: number;
  /** The cut with the fewest gauges on the wrong side, between two gauges' scores. */
  threshold: number;
  hits: number;
  misses: string[];
  false_alarms: string[];
  rejections: number;
  /** Gauges on the wrong side when each is sorted by the cut the others set. */
  left_out_errors: number;
}

export interface Report {
  run: Run;
  /** The gain, in meters, from which a gauge counts as gaining. */
  gain_bar: number;
  bars: Bar[];
  nameable: { named: number; any: number };
  gauges: GaugeResult[];
  /** By window in years, each measure's sorting of that window's gauges on that window's gains. */
  sortings: Record<string, Sorting[]>;
  /** The 19-year cut of each measure applied to the shorter windows' fits. */
  carried: {
    measure: Measure;
    years: number;
    hits: number;
    misses: string[];
    false_alarms: string[];
    rejections: number;
  }[];
  /** Each measure's 19-year sorting with one source's gauges sorted by the cut the other sources set. */
  by_source: {
    measure: Measure;
    source: string;
    gaining: number;
    others: number;
    errors: number;
    /** Null where the other sources have gauges of one kind only, so no cut. */
    threshold: number | null;
  }[];
  /** The 19-year sorting under other gains to count as gaining, in meters. */
  other_bars: { gain_bar: number; sortings: Sorting[] }[];
  /** The measure read from the first held-out year, sorting the gain over the other two. */
  apart: Record<string, Sorting[]>;
  /** By window, gauges whose side of the cut the first held-out years set differs between held-out years, for each measure. */
  unsteady: { measure: Measure; years: number; gauges: string[] }[];
  resolved: Resolved[];
}

/** The gauges whose lines beside a fitted constituent are looked at again over the fitted years. */
export const RESOLVED: string[] = [
  "coops/9455920",
  "coops/8410140",
  "coops/8545240",
  "rws/delfzijl",
  "pegelonline/5990020",
  "coops/9410170",
];
/** The smallest held-out line looked at again, meters. */
export const RESOLVED_FROM = 0.005;

/** One held-out line beside a fitted constituent, as the spectra of the fitted years show it. */
export interface ResolvedLine {
  /** The held-out line. */
  speed: number;
  amplitude: number;
  fitted: string;
  fitted_speed: number;
  /** The largest residual bin of the fitted years within a held-out bin of the line, and what it holds, meters. */
  at: number;
  residual: number;
  observed: number;
  predicted: number;
  /** What the prediction from L2's constant alone holds in that bin. */
  l2: number;
  /** The catalog's nearest line to that bin within two of the fitted years' bins, the fitted constituent or another. */
  line: string | null;
  reading: Reading;
}

/** The spectra of the years a gauge's longest fit read, as the cache keeps them: the amplitude in each bin, as `pack` writes it. */
export interface FittedYears {
  id: string;
  /** Hours in the fitted years and the share with a value. */
  hours: number;
  coverage: number;
  observed: string;
  predicted: string;
  residual: string;
  /** The prediction from L2's constant alone. */
  l2: string;
}

/** A gauge's lines beside fitted constituents over the years of the longest fit. */
export interface Resolved {
  id: string;
  hours: number;
  coverage: number;
  lines: ResolvedLine[];
}

/** How much larger one of observed and predicted must be for a line to be read as in one and not the other. */
export const ONE_SIDED = 3;

export type Reading =
  "observed, not predicted" | "predicted, not observed" | "in both" | "the constituent itself";

/** The speed of a constituent the catalog names. */
export const speedOf = (name: string) => NAMED.find((l) => l.name === name)?.speed;

/**
 * Held-out lines beside a fitted constituent can't be told from it in three
 * years. The fitted years are long enough to tell it from a neighbor two bins
 * of their own spectra away, which a perigee cycle is and a node cycle is
 * not. For each such line of `peaks`, this finds the largest residual bin
 * within one held-out bin of it, in spectra of the observed levels, the
 * prediction and their difference. Where the observed levels hold a line
 * there and the prediction none, the fit lacks a constituent. Where the
 * prediction holds one the observed levels lack, a constituent's nodal
 * correction puts it there.
 *
 * Under the taper a line fills its neighbors with half its own amplitude, so
 * a bin next to a fitted constituent holds that constituent and says nothing
 * of a line beside it. Next to the line's own constituent the reading is "the
 * constituent itself": its size or phase in these years differs from its
 * constants'. Next to any other fitted constituent the bin is passed over.
 * `fitted` is every constituent the fit holds.
 */
export function resolveLines(
  peaks: readonly Peak[],
  heldOutHours: number,
  fitted: readonly string[],
  years: {
    n: number;
    observed: Float32Array;
    predicted: Float32Array;
    residual: Float32Array;
    l2: Float32Array;
  },
): ResolvedLine[] {
  const bin = binSpeed(years.n);
  const reach = Math.round(binSpeed(heldOutHours) / bin);
  const binOf = (name: string) => Math.round((speedOf(name) ?? NaN) / bin);
  const held = new Set(fitted.map(binOf));
  return peaks
    .filter((p) => p.fitted !== null && p.amplitude >= RESOLVED_FROM)
    .sort((a, b) => b.amplitude - a.amplitude)
    .flatMap((p) => {
      const own = binOf(p.fitted!);
      const center = Math.round(p.speed / bin);
      let at = -1;
      for (let k = center - reach; k <= center + reach; k++) {
        const beside = [k - 1, k, k + 1].some((j) => held.has(j) && Math.abs(j - own) > 1);
        if (!beside && (at < 0 || years.residual[k]! > years.residual[at]!)) at = k;
      }
      if (at < 0) return [];
      const [observed, predicted] = [years.observed[at]!, years.predicted[at]!];
      return [
        {
          speed: p.speed,
          amplitude: p.amplitude,
          fitted: p.fitted!,
          fitted_speed: speedOf(p.fitted!)!,
          at: at * bin,
          residual: years.residual[at]!,
          observed,
          predicted,
          l2: years.l2[at]!,
          line: nameOf(at * bin, 2 * bin, new Set()).name,
          reading:
            Math.abs(at - own) <= 1
              ? "the constituent itself"
              : observed >= ONE_SIDED * predicted
                ? "observed, not predicted"
                : predicted >= ONE_SIDED * observed
                  ? "predicted, not observed"
                  : "in both",
        },
      ];
    });
}

/** A gauge counts as gaining from the compounds at a millimeter off its held-out RMS. */
export const GAIN_BAR = 0.001;

function measured(
  series: Float32Array,
  constants: readonly Constant[],
): { measured: Measured; spec: Spectrum; floor: Float64Array } {
  const spec = spectrum(series);
  const floor = continuum(spec.power, halfWidth(spec.n));
  const bar = barFor(spec.n);
  const peaks = peaksOf(spec, floor, bar.family, new Set(constants.map((c) => c.name)));
  const [first, end] = examined(spec.n);
  let over = 0;
  for (let k = first; k < end; k++) if (spec.power[k]! > bar.percentile * floor[k]!) over++;
  return {
    measured: {
      kept: constants.length,
      rms: rmsOf(series),
      bands: bandsOf(spec, floor, peaks),
      peaks,
      over_percentile: over,
    },
    spec,
    floor,
  };
}

function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && order[j]![0] === order[i]![0]) j++;
    for (let k = i; k < j; k++) out[order[k]![1]] = (i + j - 1) / 2;
    i = j;
  }
  return out;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const [ma, mb] = [mean(a), mean(b)];
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : NaN;
}

interface Scored {
  id: string;
  score: number;
  gain: number;
}

/** The cut with the fewest of `rows` on the wrong side, taken midway between two scores; null where one kind is missing. */
function cutOf(rows: readonly Scored[], bar: number): number | null {
  if (!rows.some((r) => r.gain >= bar) || !rows.some((r) => r.gain < bar)) return null;
  const scores = [...new Set(rows.map((r) => r.score))].sort((a, b) => a - b);
  // One score for every row sorts nothing.
  if (scores.length < 2) return null;
  let best = { errors: Infinity, cut: NaN };
  for (let i = 0; i + 1 < scores.length; i++) {
    const cut = (scores[i]! + scores[i + 1]!) / 2;
    const errors = rows.filter((r) => r.score > cut !== r.gain >= bar).length;
    if (errors < best.errors) best = { errors, cut };
  }
  return best.cut;
}

function sideCounts(rows: readonly Scored[], cut: number, bar: number) {
  const gaining = rows.filter((r) => r.gain >= bar);
  const others = rows.filter((r) => r.gain < bar);
  return {
    hits: gaining.filter((r) => r.score > cut).length,
    misses: gaining.filter((r) => r.score <= cut).map((r) => r.id),
    false_alarms: others.filter((r) => r.score > cut).map((r) => r.id),
    rejections: others.filter((r) => r.score <= cut).length,
  };
}

/** How `measure` sorts `rows`; null where the rows are all of one kind. */
export function sortingOf(measure: Measure, rows: readonly Scored[], bar: number): Sorting | null {
  const cut = cutOf(rows, bar);
  if (cut === null) return null;
  const gaining = rows.filter((r) => r.gain >= bar);
  const others = rows.filter((r) => r.gain < bar);
  let above = 0;
  for (const g of gaining)
    for (const o of others) above += g.score > o.score ? 1 : g.score === o.score ? 0.5 : 0;
  let leftOut = 0;
  for (const row of rows) {
    const cutWithout = cutOf(
      rows.filter((r) => r !== row),
      bar,
    );
    if (cutWithout === null || row.score > cutWithout !== row.gain >= bar) leftOut++;
  }
  return {
    measure,
    gaining: gaining.length,
    others: others.length,
    auc: above / (gaining.length * others.length),
    spearman: correlation(ranks(rows.map((r) => r.score)), ranks(rows.map((r) => r.gain))),
    threshold: cut,
    ...sideCounts(rows, cut, bar),
    left_out_errors: leftOut,
  };
}

/** What a figure is drawn from: both fits' 19-year spectra and the continuum under the longer fit's. */
export interface Drawn {
  id: string;
  name: string;
  n: number;
  base: Float64Array;
  all: Float64Array;
  floor: Float64Array;
  /** The spectrum's `scale`. */
  scale: number;
  peaks: Peak[];
}

export function measure(
  run: Run,
  gauges: readonly Fitted[],
  fittedYears: readonly FittedYears[] = [],
): { report: Report; drawn: Drawn[] } {
  const drawn: Drawn[] = [];
  const results: GaugeResult[] = gauges.map((gauge) => {
    const observed = unpack(gauge.observed);
    const coverage =
      observed.reduce((count, x) => count + (Number.isFinite(x) ? 1 : 0), 0) / observed.length;
    const yearStart = (year: number) =>
      (Date.UTC(year, 0, 1) - Date.UTC(gauge.held_out[0], 0, 1)) / 3_600_000;
    return {
      id: gauge.id,
      name: gauge.name,
      latitude: gauge.latitude,
      held_out: gauge.held_out,
      hours: gauge.hours,
      coverage,
      observed_rms: rmsOf(observed),
      windows: gauge.windows.map((window) => {
        if ("skipped" in window) return window;
        const [baseSeries, allSeries] = [unpack(window.base.residual), unpack(window.all.residual)];
        const base = measured(baseSeries, window.base.constants);
        const all = measured(allSeries, window.all.constants);
        if (window.years === WINDOWS.at(-1) && FIGURES[gauge.id])
          drawn.push({
            id: gauge.id,
            name: gauge.name,
            n: base.spec.n,
            base: base.spec.amplitude,
            all: all.spec.amplitude,
            floor: all.floor,
            scale: all.spec.scale,
            peaks: all.measured.peaks,
          });
        const yearly: Yearly[] = [];
        for (let year = gauge.held_out[0]; year <= gauge.held_out[1]; year++) {
          const [from, to] = [yearStart(year), yearStart(year + 1)];
          const slice = baseSeries.slice(from, to);
          const one = measured(slice, window.base.constants);
          // A year with under half its hours has no spectrum worth reading.
          if (one.spec.coverage < 0.5) continue;
          yearly.push({
            year,
            coverage: one.spec.coverage,
            measures: measuresOf(one.measured, window.base.constants),
            hours: Math.round(one.spec.coverage * (to - from)),
            rms: { base: rmsOf(baseSeries, from, to), all: rmsOf(allSeries, from, to) },
          });
        }
        // The lines themselves are reported for the longest fits; the shorter ones keep their counts and energies.
        const slim = (m: Measured): Measured =>
          window.years === WINDOWS.at(-1) ? m : { ...m, peaks: [] };
        return {
          years: window.years,
          hours: window.hours,
          base: slim(base.measured),
          all: slim(all.measured),
          gain: base.measured.rms - all.measured.rms,
          measures: measuresOf(base.measured, window.base.constants),
          yearly,
        };
      }),
    };
  });

  const windowOf = (gauge: GaugeResult, years: number) => {
    const window = gauge.windows.find((w) => w.years === years);
    return window && !("skipped" in window) ? window : null;
  };
  const rowsOf = (years: number, m: Measure): Scored[] =>
    results.flatMap((g) => {
      const w = windowOf(g, years);
      return w ? [{ id: g.id, score: w.measures[m], gain: w.gain }] : [];
    });
  const sortAll = (rows: (m: Measure) => Scored[], bar: number) =>
    MEASURE_NAMES.flatMap((m) => sortingOf(m, rows(m), bar) ?? []);

  const sortings: Report["sortings"] = {};
  for (const years of WINDOWS) sortings[years] = sortAll((m) => rowsOf(years, m), GAIN_BAR);

  const longest = WINDOWS.at(-1)!;
  const carried: Report["carried"] = [];
  for (const sorting of sortings[longest]!)
    for (const years of WINDOWS.filter((y) => y !== longest))
      carried.push({
        measure: sorting.measure,
        years,
        ...sideCounts(rowsOf(years, sorting.measure), sorting.threshold, GAIN_BAR),
      });

  const bySource: Report["by_source"] = [];
  for (const m of MEASURE_NAMES)
    for (const source of Object.keys(run.sources)) {
      const rows = rowsOf(longest, m);
      const own = rows.filter((r) => r.id.startsWith(`${source}/`));
      const cut = cutOf(
        rows.filter((r) => !r.id.startsWith(`${source}/`)),
        GAIN_BAR,
      );
      bySource.push({
        measure: m,
        source,
        gaining: own.filter((r) => r.gain >= GAIN_BAR).length,
        others: own.filter((r) => r.gain < GAIN_BAR).length,
        errors:
          cut === null
            ? own.length
            : own.filter((r) => r.score > cut !== r.gain >= GAIN_BAR).length,
        threshold: cut,
      });
    }

  // The measure from the first held-out year against the gain over the years after it, so one
  // year's noise isn't in both.
  const apart: Report["apart"] = {};
  for (const years of WINDOWS)
    apart[years] = sortAll(
      (m) =>
        results.flatMap((g) => {
          const w = windowOf(g, years);
          if (!w || w.yearly.length < 2) return [];
          const later = w.yearly.slice(1);
          const pooled = (arm: "base" | "all") =>
            // Over the hours scored, as the gain of the three years together is.
            Math.sqrt(
              later.reduce((s, y) => s + y.hours * y.rms[arm] ** 2, 0) /
                later.reduce((s, y) => s + y.hours, 0),
            );
          return [
            { id: g.id, score: w.yearly[0]!.measures[m], gain: pooled("base") - pooled("all") },
          ];
        }),
      GAIN_BAR,
    );

  const unsteady: Report["unsteady"] = [];
  for (const years of WINDOWS)
    for (const sorting of apart[years]!)
      unsteady.push({
        measure: sorting.measure,
        years,
        gauges: results.flatMap((g) => {
          const w = windowOf(g, years);
          if (!w || w.yearly.length < 2) return [];
          const sides = new Set(
            w.yearly.map((y) => y.measures[sorting.measure] > sorting.threshold),
          );
          return sides.size > 1 ? [g.id] : [];
        }),
      });

  const hours = results[0]!.hours;
  return {
    report: {
      run,
      gain_bar: GAIN_BAR,
      bars: [barFor(hours), barFor(8760)],
      nameable: nameable(hours),
      gauges: results,
      sortings,
      carried,
      by_source: bySource,
      other_bars: [0.0005, 0.002].map((bar) => ({
        gain_bar: bar,
        sortings: sortAll((m) => rowsOf(longest, m), bar),
      })),
      apart,
      unsteady,
      resolved: fittedYears.map((years) => {
        const fit = gauges
          .find((g) => g.id === years.id)!
          .windows.find((w) => w.years === longest)!;
        const result = windowOf(
          results.find((g) => g.id === years.id)!,
          longest,
        );
        if ("skipped" in fit || !result)
          throw new Error(`${years.id} has fitted years and no ${longest}-year fit`);
        return {
          id: years.id,
          hours: years.hours,
          coverage: years.coverage,
          lines: resolveLines(
            result.all.peaks,
            results[0]!.hours,
            fit.all.constants.map((c) => c.name),
            {
              n: years.hours,
              observed: unpack(years.observed),
              predicted: unpack(years.predicted),
              residual: unpack(years.residual),
              l2: unpack(years.l2),
            },
          ),
        };
      }),
    },
    drawn,
  };
}

// ---------------------------------------------------------------------------
// The report

const mm = (meters: number, digits = 1) => (meters * 1000).toFixed(digits);
const shown = (m: Measure, value: number) =>
  IN_MM.includes(m) ? mm(value) : m === "count3" ? String(value) : value.toPrecision(3);
const unitOf = (m: Measure) => (IN_MM.includes(m) ? "mm" : m === "count3" ? "lines" : "ratio");
const short = (id: string) => id.split("/")[1]!;

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function sortingRows(sortings: readonly Sorting[], label: (id: string) => string): string[][] {
  return sortings.map((s) => [
    MEASURES[s.measure],
    s.auc.toFixed(2),
    s.spearman.toFixed(2),
    `${shown(s.measure, s.threshold)} ${unitOf(s.measure)}`,
    `${s.hits} of ${s.gaining}`,
    s.misses.map(label).join("; ") || "none",
    s.false_alarms.map(label).join("; ") || "none",
    String(s.left_out_errors),
  ]);
}

const SORTING_HEAD = [
  "Measure",
  "AUC",
  "Rank correlation with gain",
  "Cut",
  "Gaining gauges above it",
  "Missed",
  "False alarms",
  "Wrong when left out",
];

export function render(report: Report): string {
  const { run, gauges } = report;
  const label = (id: string) => gauges.find((g) => g.id === id)?.name || short(id);
  const window = (g: GaugeResult, years: number) => {
    const w = g.windows.find((x) => x.years === years);
    return w && !("skipped" in w) ? w : null;
  };
  const [long, yearBar] = report.bars as [Bar, Bar];
  const bin = binSpeed(long.n);
  const lines: string[] = [];
  const say = (...text: string[]) => lines.push(...text, "");

  say(
    "# Residual spectra",
    "",
    "Whether the spectrum of a fit's residual tells which gauges need shallow-water compounds, and what the residual holds once they are fitted. Written by `scripts/residual-spectra.ts`; the figures and every number come from that run. It measures and proposes no list or rule.",
  );
  say(
    `Engine ${run.engine}, fit method ${run.method}, ${run.node_corrections} nodal corrections. ${gauges.length} gauges: ${Object.entries(
      run.sources,
    )
      .map(
        ([id, s]) =>
          `${gauges.filter((g) => g.id.startsWith(`${id}/`)).length} of ${s.name} (${s.license}), held out ${run.final_years[id]! - HELD_OUT_YEARS + 1} to ${run.final_years[id]}`,
      )
      .join("; ")}.`,
  );

  say("## Method");
  say(
    `**Fits.** Each gauge is fitted over the ${WINDOWS.join(", ")} years before the ${HELD_OUT_YEARS} that end with its source's last year of final values, once with the ${CANDIDATES.length} candidates and once with NOAA's ${COMPOUNDS.length} Anchorage compounds offered after them. Selection and the robust fit are the store's, but for Sa and Ssa, which every fit here holds and the store's keeps only where their yearly spread allows. The residuals have the slow part filtered out, so the two don't enter them; they are in the counts of constituents kept and not in the "fitted tide". A window is fitted where the store holds two thirds of its hours, and a gauge where a third of its held-out hours can be scored.`,
    "",
    `**Residual.** Each fit's constants predict the ${HELD_OUT_YEARS} held-out years, which no fit read. The residual is observed minus predicted on the hour, with the slow part taken out by the Godin filter the fits' own scores use. An hour counts where the 71 hours around it all have values. The gain from the compounds is the difference of the two fits' residual RMS over those hours, and a gauge gains at ${mm(report.gain_bar, 0)} mm or more.`,
    "",
    `**Spectrum.** The ${HELD_OUT_YEARS} years are one series of ${long.n.toLocaleString("en-US")} hours under a Hann taper, with missing hours given no weight, transformed at its own frequencies without padding. One bin is ${bin.toFixed(4)}°/h, a third of a cycle per year. Under the taper a line fills three bins, and a peak within two bins of a stronger one counts as part of it, so two lines show apart from three bins, ${(3 * bin).toFixed(3)}°/h. That separates lines a cycle per year apart (${CANDIDATES.find((c) => c.name === "Sa")!.speed.toFixed(3)}°/h), such as S2 from T2 and M2 from MA2. It does not separate lines that differ by the perigee's 8.85-year cycle (0.005°/h) or the node's 18.6 (0.002°/h), nor a K2 + N2 product from an M2 + L2 product (0.009°/h), nor two names on one frequency such as L2 and 2MN2. One held-out year alone gives bins of ${binSpeed(yearBar.n).toFixed(3)}°/h, and then S2, T2, R2 and K2 fall in one peak, as do K1, S1 and P1, and M2 with MA2 and MB2.`,
    "",
    `**Fit resolution.** The fits themselves separate lines one cycle apart over their window: ${WINDOWS.map((y) => `${(360 / (y * 8766)).toFixed(4)}°/h over ${y} years`).join(", ")}.`,
    "",
    `**Continuum.** The running median of the power over ${halfWidth(long.n)} bins either side (0.04 cycles per day), divided by ln 2. A line occupies 3 of the ${2 * halfWidth(long.n) + 1} bins, so it barely moves the median, and a rise as broad as the window is followed as continuum. One year's spectrum has a third of the bins, and its window is ${halfWidth(yearBar.n)} bins either side, ${(halfWidth(yearBar.n) / perCpd(yearBar.n)).toFixed(2)} cycles per day.`,
    "",
    `**The bar for a line.** A spectrum has ${long.bins.toLocaleString("en-US")} bins from ${LOWEST_CPD} cycles per day to the Nyquist frequency, and every one is examined. A line is a bin whose power is ${long.family.toFixed(1)} times the continuum or more, the level any bin of a spectrum of white noise exceeds in ${FAMILY_RATE * 100}% of ${SURROGATES} simulated series put through the same taper, continuum and bins. With the continuum known exactly the level would be ln(${long.bins}/${FAMILY_RATE}) = ${long.analytic.toFixed(1)}; the median's own scatter raises it. So a gauge with no line at all shows one in about one spectrum in twenty. For comparison, the 99.5th percentile of a single bin, the level Boesch and Müller-Navarra (2019) hold a periodogram to, is ${long.percentile.toFixed(1)} here, and noise alone puts ${Math.round(0.005 * long.bins)} bins over it. For one year's spectrum (${yearBar.bins.toLocaleString("en-US")} bins) the bar is ${yearBar.family.toFixed(1)}.`,
    "",
    "**Lines.** Peaks over the bar, strongest first. One within two bins of a stronger line is part of it. One that the stronger lines could have leaked, through the taper and the record's gaps, at a quarter of its power or more is dropped. Frequency and amplitude are interpolated between the peak's two largest bins.",
    "",
    `**Names.** A peak takes the name of the nearest line in the engine's catalog within one bin, else the combination of fewest terms among sums and differences of M2, S2, N2, K2, K1 and O1 with up to two cycles per year either side, of up to ${BUILT_ORDER} terms. Apart from the name, a peak is "beside a fitted constituent" where one the fit holds lies within a bin. ${(report.nameable.named * 100).toFixed(0)}% of all bins lie within a bin of a catalog line and ${(report.nameable.any * 100).toFixed(0)}% within a bin of a catalog or built line, so a built name alone is weak evidence that a peak is that compound.`,
    "",
    `**Species.** Species n is the band from n − 0.5 to n + 0.5 cycles per day; the twelfth stops at the Nyquist frequency. Its floor runs between the continuum's levels at the two edges, where no tide lies. The rise is the continuum's energy above that floor: a broad rise around the lines with the lines themselves left out. Line energy is half the sum of the lines' squared amplitudes. Where the continuum bends between the edges, as it does in the diurnal band and in the odd species beside a strong even one, the straight floor lies above it and the rise reads zero. Energies are given as their square roots, in millimeters.`,
  );

  const longest = WINDOWS.at(-1)!;
  say("## Does the residual tell which gauges gain");
  for (const years of [...WINDOWS].reverse()) {
    const sortings = report.sortings[years]!;
    const first = sortings[0];
    say(
      `### Fits of ${years} years`,
      "",
      first
        ? `${first.gaining} gauges gain ${mm(report.gain_bar, 0)} mm or more from the compounds and ${first.others} don't. Each measure is read from the fit of the candidates alone. The cut is the one with the fewest gauges on the wrong side. "Wrong when left out" sorts each gauge by the cut the other gauges set.`
        : "The gauges are all of one kind, so there is nothing to sort.",
      "",
      table(SORTING_HEAD, sortingRows(sortings, label)),
    );
  }
  say(
    "### The 19-year cuts on shorter fits",
    "",
    "Each measure's cut from the 19-year fits, applied to the same measure from the shorter fits and scored on the shorter fits' own gains.",
    "",
    table(
      ["Measure", "Fit", "Gaining gauges above the cut", "Missed", "False alarms"],
      report.carried.map((c) => [
        MEASURES[c.measure],
        `${c.years} years`,
        `${c.hits} of ${c.hits + c.misses.length}`,
        c.misses.map(label).join("; ") || "none",
        c.false_alarms.map(label).join("; ") || "none",
      ]),
    ),
  );
  say(
    "### One source sorted by the others' cut",
    "",
    "The 19-year fits. Each source's gauges are sorted by the cut the other sources' gauges set, so a cut that only describes one coast shows.",
    "",
    table(
      ["Measure", ...Object.keys(run.sources).map((s) => run.sources[s]!.name.split(" (")[0]!)],
      MEASURE_NAMES.map((m) => [
        MEASURES[m],
        ...Object.keys(run.sources).map((source) => {
          const row = report.by_source.find((r) => r.measure === m && r.source === source)!;
          return `${row.errors} wrong of ${row.gaining + row.others} (${row.gaining} gaining)`;
        }),
      ]),
    ),
  );
  say(
    "### Another gain to count as gaining",
    "",
    ...report.other_bars.flatMap((other) => [
      `At ${mm(other.gain_bar)} mm, ${gauges.filter((g) => (window(g, longest)?.gain ?? -Infinity) >= other.gain_bar).length} gauges gain.`,
      "",
      table(SORTING_HEAD, sortingRows(other.sortings, label)),
      "",
    ]),
  );
  say(
    "### One year's spectrum against the later years' gain",
    "",
    `The measure and the gain above come from the same ${HELD_OUT_YEARS} years, so a line in those years counts toward both. Here each measure is read from a gauge's first held-out year with half its hours, alone, at a third of the resolution, and sorts the gain over the years after it. A gauge with one such year is left out.`,
  );
  for (const years of [...WINDOWS].reverse())
    say(
      `**Fits of ${years} years.**`,
      "",
      table(SORTING_HEAD, sortingRows(report.apart[years]!, label)),
    );
  say(
    "Gauges that fall on different sides of that cut in different held-out years:",
    "",
    table(
      ["Measure", ...[...WINDOWS].reverse().map((y) => `${y}-year fits`)],
      MEASURE_NAMES.map((m) => [
        MEASURES[m],
        ...[...WINDOWS].reverse().map((years) => {
          const row = report.unsteady.find((u) => u.measure === m && u.years === years);
          return row ? row.gauges.map(label).join("; ") || "none" : "not sorted";
        }),
      ]),
    ),
  );

  const perGauge = (years: number) =>
    table(
      [
        "Gauge",
        "Residual, candidates",
        "Gain",
        "Lines D1",
        "Lines D2",
        "Lines D3+",
        "Count D3+",
        "Rise D3+",
        "All energy D3+",
        "Fitted D3+",
      ],
      gauges.flatMap((g) => {
        const w = window(g, years);
        if (!w) return [];
        const m = w.measures;
        return [
          [
            `${label(g.id)} (${short(g.id)})`,
            mm(w.base.rms),
            `${w.gain >= report.gain_bar ? "**" : ""}${mm(w.gain, 2)}${w.gain >= report.gain_bar ? "**" : ""}`,
            mm(m.lines1),
            mm(m.lines2),
            mm(m.lines3),
            String(m.count3),
            mm(m.rise3),
            mm(m.total3),
            mm(m.fitted3),
          ],
        ];
      }),
    );
  say(
    "### Each gauge",
    "",
    "From the fit of the candidates alone, in millimeters. A gain in bold is a millimeter or more.",
  );
  for (const years of [...WINDOWS].reverse())
    say(`**Fits of ${years} years.**`, "", perGauge(years));

  say("## What is left after the compounds");
  say(
    `The ${longest}-year fits with the compounds offered. Lines and rise are kept apart, as Zetler and Cummings kept the peaks from the energy between the line groups. "Lines beside a fitted constituent" are peaks within a bin of a constituent the fit already holds: either that constituent, larger, smaller or later in these years than its constants say, or a neighbor the ${HELD_OUT_YEARS}-year spectrum can't separate from it. "Other lines" are within a bin of no fitted constituent. "More to gain" is what the residual RMS would lose if every other line were removed exactly.`,
    "",
    table(
      [
        "Gauge",
        "Kept",
        "Residual",
        "Floor",
        "Rise",
        "Lines beside a fitted constituent",
        "Other lines",
        "Largest other line",
        "More to gain",
      ],
      gauges.flatMap((g) => {
        const w = window(g, longest);
        if (!w) return [];
        const sum = (pick: (b: Band) => number) =>
          root(w.all.bands.reduce((s, b) => s + pick(b), 0));
        const energy = (peaks: Peak[]) => root(peaks.reduce((s, p) => s + p.amplitude ** 2 / 2, 0));
        const fitted = w.all.peaks.filter((p) => p.fitted !== null);
        const other = w.all.peaks.filter((p) => p.fitted === null);
        const largest = [...other].sort((a, b) => b.amplitude - a.amplitude)[0];
        const otherEnergy = other.reduce((s, p) => s + p.amplitude ** 2 / 2, 0);
        return [
          [
            `${w.gain >= report.gain_bar ? "**" : ""}${label(g.id)}${w.gain >= report.gain_bar ? "**" : ""}`,
            String(w.all.kept),
            mm(w.all.rms),
            mm(sum((b) => (b.species >= 2 ? b.floor : 0))),
            mm(sum((b) => (b.species >= 2 ? Math.max(0, b.rise) : 0))),
            `${fitted.length}, ${mm(energy(fitted))}`,
            `${other.length}, ${mm(energy(other))}`,
            largest
              ? `${largest.name ?? "unnamed"} ${largest.speed.toFixed(3)}°/h, ${mm(largest.amplitude)}`
              : "none",
            mm(w.all.rms - root(w.all.rms ** 2 - otherEnergy), 2),
          ],
        ];
      }),
    ),
    "",
    "Millimeters; counts before the comma. Floor and rise are for the semidiurnal species and up, since the diurnal band's floor falls too steeply for a straight line. Gauges in bold gain a millimeter or more from the compounds.",
  );

  {
    const median = (xs: number[]) => {
      const sorted = [...xs].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    };
    const energyOf = (peaks: Peak[]) => peaks.reduce((s, p) => s + p.amplitude ** 2 / 2, 0);
    const rows = gauges.flatMap((g) => {
      const w = window(g, longest);
      if (!w) return [];
      const other = w.all.peaks.filter((p) => p.fitted === null);
      const high = w.all.bands.filter((b) => b.species >= 2);
      const rise = (arm: Measured) =>
        arm.bands.filter((b) => b.species >= 2).reduce((s, b) => s + Math.max(0, b.rise), 0);
      return [
        {
          id: g.id,
          gaining: w.gain >= report.gain_bar,
          other,
          before: w.base.peaks.filter((p) => p.fitted === null).length,
          more: w.all.rms - root(w.all.rms ** 2 - energyOf(other)),
          floor: high.reduce((s, b) => s + b.floor, 0),
          rise: rise(w.all),
          riseBefore: rise(w.base),
          beside: energyOf(w.all.peaks.filter((p) => p.fitted !== null && p.species >= 2)),
          apart: energyOf(other.filter((p) => p.species >= 2)),
          years: w.yearly.length,
        },
      ];
    });
    const groups = [true, false].map((gaining) => rows.filter((r) => r.gaining === gaining));
    const [gaining, rest] = groups as [typeof rows, typeof rows];
    const mean = (set: typeof rows, pick: (r: (typeof rows)[number]) => number) =>
      set.reduce((s, r) => s + pick(r), 0) / Math.max(1, set.length);
    const counts = (set: typeof rows) => set.map((r) => r.other.length);
    const kinds = new Map<string, number>();
    const recurring = new Map<string, { gauges: number; largest: number; speed: number }>();
    for (const r of gaining) {
      const seen = new Set<string>();
      for (const p of r.other) {
        kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
        if (!p.name) continue;
        const e = recurring.get(p.name) ?? { gauges: 0, largest: 0, speed: p.speed };
        if (!seen.has(p.name)) e.gauges++;
        seen.add(p.name);
        e.largest = Math.max(e.largest, p.amplitude);
        recurring.set(p.name, e);
      }
    }
    const lines = gaining.reduce((s, r) => s + r.other.length, 0);
    const catalogued = lines - (kinds.get("built") ?? 0) - (kinds.get("none") ?? 0);
    const share = (set: typeof rows) => {
      const [rise, beside, apart] = [
        mean(set, (r) => r.rise),
        mean(set, (r) => r.beside),
        mean(set, (r) => r.apart),
      ];
      const all = rise + beside + apart;
      return `${((100 * rise) / all).toFixed(0)}% rise, ${((100 * beside) / all).toFixed(0)}% lines beside a fitted constituent, ${((100 * apart) / all).toFixed(0)}% other lines`;
    };
    const short2 = rows.filter((r) => r.years < HELD_OUT_YEARS).map((r) => label(r.id));
    say(
      "### Totals",
      "",
      `Over the ${rows.length} gauges with a ${longest}-year fit, with the compounds fitted. Energies are means over the gauges of a group, in the semidiurnal species and up, as square roots.`,
      "",
      `- **Other lines, gauges that gain (${gaining.length}).** Median ${median(counts(gaining))}, from ${Math.min(...counts(gaining))} to ${Math.max(...counts(gaining))}. Before the compounds the median was ${median(gaining.map((r) => r.before))}.`,
      `- **Other lines, the rest (${rest.length}).** Median ${median(counts(rest))}, at most ${Math.max(...counts(rest))}, and ${rest.filter((r) => !r.other.length).length} gauges have none.`,
      `- **More to gain of ${mm(report.gain_bar, 0)} mm or more.** ${
        rows
          .filter((r) => r.more >= report.gain_bar)
          .sort((a, b) => b.more - a.more)
          .map((r) => `${label(r.id)} ${mm(r.more)}`)
          .join("; ") || "No gauge"
      }.`,
      `- **Names of the other lines at the gauges that gain.** Of ${lines}, ${catalogued} have a catalog line within a bin, ${kinds.get("built") ?? 0} only a built one and ${kinds.get("none") ?? 0} neither.`,
      `- **Lines at half the gauges that gain or more.** ${
        [...recurring]
          .filter(([, e]) => e.gauges >= gaining.length / 2)
          .sort((a, b) => b[1].gauges - a[1].gauges || b[1].largest - a[1].largest)
          .map(
            ([name, e]) =>
              `${name} (${e.speed.toFixed(3)}°/h) at ${e.gauges}, up to ${mm(e.largest)} mm`,
          )
          .join("; ") || "None"
      }.`,
      ...(
        [
          ["Gauges that gain", gaining],
          ["The rest", rest],
        ] as const
      ).map(
        ([name, set]) =>
          `- **${name}.** Floor ${mm(root(mean(set, (r) => r.floor)))} mm, rise ${mm(root(mean(set, (r) => r.rise)))} mm (${mm(root(mean(set, (r) => r.riseBefore)))} mm before the compounds), lines beside a fitted constituent ${mm(root(mean(set, (r) => r.beside)))} mm, other lines ${mm(root(mean(set, (r) => r.apart)))} mm. Of the energy over the floor: ${share(set)}.`,
      ),
      `- **Gauges with fewer than ${HELD_OUT_YEARS} held-out years holding half their hours.** ${short2.join("; ") || "None"}.`,
    );
  }

  say(
    "### By species",
    "",
    `Square roots of the energy summed over the gauges that gain and over the rest, per gauge (root mean over gauges), ${longest}-year fits, in millimeters.`,
  );
  const group = (
    gaining: boolean,
    arm: "base" | "all",
    pick: (b: Band) => number,
    species: number,
  ) => {
    const picked = gauges.flatMap((g) => {
      const w = window(g, longest);
      return w && w.gain >= report.gain_bar === gaining ? [pick(w[arm].bands[species - 1]!)] : [];
    });
    return mm(root(picked.reduce((s, x) => s + x, 0) / Math.max(1, picked.length)));
  };
  for (const gaining of [true, false])
    say(
      `**Gauges that ${gaining ? "gain" : "don't gain"}.**`,
      "",
      table(
        [
          "Species",
          "Floor",
          "Rise, candidates",
          "Rise, with compounds",
          "Lines, candidates",
          "Lines, with compounds",
        ],
        Array.from({ length: SPECIES }, (_, i) => i + 1).map((species) => [
          String(species),
          group(gaining, "all", (b) => b.floor, species),
          group(gaining, "base", (b) => Math.max(0, b.rise), species),
          group(gaining, "all", (b) => Math.max(0, b.rise), species),
          group(gaining, "base", (b) => b.lines, species),
          group(gaining, "all", (b) => b.lines, species),
        ]),
      ),
    );

  say(
    "### The lines left",
    "",
    `Every line over the bar in the ${longest}-year fit with the compounds, for the gauges drawn below and every other gauge that gains. Speed in degrees per hour, amplitude in millimeters, and the power's ratio to the continuum. "Built" marks a combination no catalog entry names. The last column is the nearest constituent the fit holds within a bin, with the peak's speed less its own.`,
  );
  for (const g of gauges) {
    const w = window(g, longest);
    if (!w || !(w.gain >= report.gain_bar || FIGURES[g.id])) continue;
    const peaks = [...w.all.peaks].sort((a, b) => b.amplitude - a.amplitude);
    say(
      `**${label(g.id)}** (${g.id}): ${peaks.length} lines, ${peaks.filter((p) => p.fitted === null).length} of them beside no fitted constituent.`,
      "",
      peaks.length
        ? table(
            [
              "Speed",
              "Species",
              "Amplitude",
              "Ratio",
              "Nearest line",
              "Also within a bin",
              "Fitted constituent beside it",
            ],
            peaks
              .slice(0, 25)
              .map((p) => [
                p.speed.toFixed(4),
                String(p.species),
                mm(p.amplitude),
                p.ratio.toFixed(0),
                p.kind === "built" ? `${p.name}, built` : (p.name ?? "unnamed"),
                p.others.slice(0, 4).join(", "),
                p.fitted
                  ? `${p.fitted} ${p.offset! < 0 ? "−" : "+"}${Math.abs(p.offset!).toFixed(4)}`
                  : "",
              ]),
          ) + (peaks.length > 25 ? `\n\nThe 25 largest of ${peaks.length}.` : "")
        : "No line over the bar.",
    );
  }

  if (report.resolved.length) {
    say(
      "### Lines beside a fitted constituent, over the fitted years",
      "",
      `Three years can't tell a constituent from a neighbor a perigee cycle (0.005°/h) or two (0.009°/h) away. The ${longest} fitted years have bins of ${binSpeed(report.resolved[0]!.hours).toFixed(4)}°/h and show two lines apart from ${(2 * binSpeed(report.resolved[0]!.hours)).toFixed(4)}°/h, which separates those and does not separate a neighbor a node cycle (0.002°/h) away. For each held-out line of ${mm(RESOLVED_FROM, 0)} mm or more beside a fitted constituent, the table gives the largest residual bin of the fitted years within a held-out bin of it, and the amplitude of the observed levels and of the fit's own prediction in that bin. "Observed, not predicted" is a line ${ONE_SIDED} times larger in the observed levels than in the prediction: the fit holds no constituent there. "Predicted, not observed" is the reverse: a constituent's nodal correction puts a line where the levels have none. "Predicted from L2 alone" is what a prediction from L2's constant and nothing else holds in the bin: where it is most of the prediction, L2's nodal correction is what puts the line there. "In both" is a line both hold at different sizes. Under the taper a line fills the bins next to it with half its amplitude, so a largest bin next to the fitted constituent is "the constituent itself", whose size or phase in these years differs from its constants', and a bin next to any other fitted constituent is passed over; a line with no other bin in reach is left out. These are the years the fit read, so they show what the constants hold and lack, not how they predict. Amplitudes are those of a line centered on the bin and read up to a sixth low for one between two bins.`,
    );
    for (const r of report.resolved)
      say(
        `**${label(r.id)}** (${r.id}), ${(r.coverage * 100).toFixed(0)}% of the fitted hours.`,
        "",
        r.lines.length
          ? table(
              [
                "Held-out line",
                "Amplitude",
                "Fitted constituent",
                "Largest residual bin, fitted years",
                "From the constituent",
                "Catalog line there",
                "Residual",
                "Observed",
                "Predicted",
                "Predicted from L2 alone",
                "Reading",
              ],
              r.lines.map((l) => [
                l.speed.toFixed(4),
                mm(l.amplitude),
                `${l.fitted} ${l.fitted_speed.toFixed(4)}`,
                l.at.toFixed(4),
                `${l.at - l.fitted_speed < 0 ? "−" : "+"}${Math.abs(l.at - l.fitted_speed).toFixed(4)}`,
                l.line ?? "none",
                mm(l.residual),
                mm(l.observed),
                mm(l.predicted),
                mm(l.l2),
                l.reading,
              ]),
            )
          : "No such line.",
      );
  }

  say(
    "## Spectra",
    "",
    `Amplitude spectra of the held-out residual of the ${longest}-year fits: the amplitude a line centered on each bin would have. Blue is the fit of the candidates alone, orange the fit with the compounds, and the dark line the continuum under the orange spectrum times the bar, which a line must reach. The top panel covers every species, drawn as the largest value in each pixel column. The others are the semidiurnal, quarter-diurnal and sixth-diurnal groups at full resolution, with the three largest lines left in each circled and named for the fitted constituent beside them, or else for the nearest line.`,
  );
  for (const [id, file] of Object.entries(FIGURES))
    say(
      `### ${label(id)}`,
      "",
      `![Residual spectra at ${label(id)}](residual-spectra/${file}.svg)`,
    );

  say(
    "## Per-gauge coverage",
    "",
    table(
      ["Gauge", "Held out", "Hours scored", ...WINDOWS.map((y) => `${y}-year fit`)],
      gauges.map((g) => [
        `${label(g.id)} (${g.id})`,
        `${g.held_out[0]} to ${g.held_out[1]}`,
        `${(g.coverage * 100).toFixed(0)}%`,
        ...WINDOWS.map((y) => {
          const w = g.windows.find((x) => x.years === y)!;
          return "skipped" in w ? w.skipped : `${w.base.kept} and ${w.all.kept} kept`;
        }),
      ]),
    ),
  );
  say(
    "## Sources",
    "",
    "The figures here are derived from each source's water levels.",
    "",
    ...Object.values(run.sources).map(
      (s) => `- ${s.name}: ${s.attribution}. [${s.license}](${s.license_url}).`,
    ),
    ...Object.entries(run.credits).map(([id, credit]) => `- ${label(id)} (${id}): ${credit}.`),
  );
  return lines.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// The figures

const SURFACE = "#fcfcfb";
const INK = "#1a1a19";
const MUTED = "#6b6a63";
const GRID = "#e4e3dd";
const BLUE = "#2a78d6";
const ORANGE = "#eb6834";

/** One gauge's spectra as an SVG: every species, then three groups at full resolution. */
export function figure(drawn: Drawn, bar: number): string {
  const width = 960;
  const left = 64;
  const right = 16;
  const panelHeight = 150;
  const gap = 46;
  const top = 44;
  const per = perCpd(drawn.n);
  const panels: { title: string; from: number; to: number; full: boolean }[] = [
    { title: "All species", from: LOWEST_CPD, to: 12, full: false },
    { title: "Semidiurnal", from: 1.76, to: 2.1, full: true },
    { title: "Quarter-diurnal", from: 3.62, to: 4.1, full: true },
    { title: "Sixth-diurnal", from: 5.5, to: 6.1, full: true },
  ];
  const height = top + panels.length * (panelHeight + gap);
  // One scale for the four panels, in decades of millimeters.
  const [first, end] = examined(drawn.n);
  let max = 0;
  for (let k = first; k < end; k++) {
    max = Math.max(max, drawn.base[k]!, drawn.all[k]!);
  }
  // A residual of nothing still gets axes.
  const hi = max > 0 ? Math.ceil(Math.log10(max * 1000)) : 0;
  const lo = hi - 3;
  const title = (drawn.name || drawn.id)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="12">`,
    `<title>Residual spectra at ${title}</title>`,
    `<rect width="${width}" height="${height}" fill="${SURFACE}"/>`,
    `<text x="${left}" y="20" fill="${INK}" font-size="14" font-weight="600">${title}: held-out residual, amplitude per bin</text>`,
    `<g transform="translate(${left + 470},16)"><rect width="14" height="3" y="-4" fill="${BLUE}"/><text x="20" fill="${INK}">Candidates alone</text><rect x="140" width="14" height="3" y="-4" fill="${ORANGE}"/><text x="160" fill="${INK}">With the compounds</text><rect x="296" width="14" height="2" y="-3.5" fill="${INK}"/><text x="316" fill="${INK}">Bar for a line</text></g>`,
  ];
  // The amplitude a line at the bar would have in a bin whose continuum is `power`.
  const barAmplitude = (power: number) => drawn.scale * Math.sqrt(bar * power);
  panels.forEach((panel, i) => {
    const y0 = top + i * (panelHeight + gap);
    const plot = width - left - right;
    const x = (cpd: number) => left + ((cpd - panel.from) / (panel.to - panel.from)) * plot;
    const y = (meters: number) => {
      const level = Math.log10(Math.max(meters * 1000, 10 ** lo));
      return y0 + panelHeight - ((level - lo) / (hi - lo)) * panelHeight;
    };
    out.push(`<text x="${left}" y="${y0 - 6}" fill="${MUTED}">${panel.title}</text>`);
    for (let decade = lo; decade <= hi; decade++) {
      const yy = y(10 ** decade / 1000);
      out.push(
        `<line x1="${left}" x2="${width - right}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${GRID}"/>`,
        `<text x="${left - 6}" y="${(yy + 4).toFixed(1)}" fill="${MUTED}" text-anchor="end">${10 ** decade >= 1 ? 10 ** decade : (10 ** decade).toFixed(-decade)} mm</text>`,
      );
    }
    const step = panel.full ? 0.05 : 1;
    for (let tick = Math.ceil(panel.from / step) * step; tick <= panel.to + 1e-9; tick += step)
      out.push(
        `<text x="${x(tick).toFixed(1)}" y="${y0 + panelHeight + 15}" fill="${MUTED}" text-anchor="middle">${tick.toFixed(panel.full ? 2 : 0)}</text>`,
      );
    const from = Math.max(first, Math.round(panel.from * per));
    const to = Math.min(end, Math.round(panel.to * per));
    const path = (values: (k: number) => number, envelope: boolean) => {
      const points: string[] = [];
      if (!envelope) {
        for (let k = from; k < to; k++)
          points.push(`${x(k / per).toFixed(1)},${y(values(k)).toFixed(1)}`);
      } else {
        // The largest value in each pixel column.
        let column = -1;
        let best = 0;
        const flush = () => column >= 0 && points.push(`${column},${y(best).toFixed(1)}`);
        for (let k = from; k < to; k++) {
          const px = Math.round(x(k / per));
          if (px !== column) {
            flush();
            column = px;
            best = 0;
          }
          best = Math.max(best, values(k));
        }
        flush();
      }
      return points.join(" ");
    };
    out.push(
      `<polyline fill="none" stroke="${BLUE}" stroke-width="1" stroke-linejoin="round" points="${path((k) => drawn.base[k]!, !panel.full)}"/>`,
      `<polyline fill="none" stroke="${ORANGE}" stroke-width="1" stroke-linejoin="round" points="${path((k) => drawn.all[k]!, !panel.full)}"/>`,
      `<polyline fill="none" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" points="${path((k) => barAmplitude(drawn.floor[k]!), !panel.full)}"/>`,
    );
    if (panel.full) {
      // The largest lines left, named, so a reader can find them in the table.
      const inside = drawn.peaks
        .filter((p) => p.cpd >= panel.from && p.cpd <= panel.to)
        .sort((a, b) => b.amplitude - a.amplitude)
        .slice(0, 3);
      for (const p of inside)
        out.push(
          `<circle cx="${x(p.cpd).toFixed(1)}" cy="${y(p.amplitude).toFixed(1)}" r="4" fill="none" stroke="${INK}" stroke-width="1.5"/>`,
          `<text x="${(x(p.cpd) + 7).toFixed(1)}" y="${(y(p.amplitude) - 5).toFixed(1)}" fill="${INK}" font-size="11">${p.fitted ?? p.name ?? "unnamed"}</text>`,
        );
    }
    out.push(
      `<line x1="${left}" x2="${width - right}" y1="${y0 + panelHeight}" y2="${y0 + panelHeight}" stroke="${MUTED}"/>`,
    );
    if (i === panels.length - 1)
      out.push(
        `<text x="${left + plot / 2}" y="${y0 + panelHeight + 34}" fill="${MUTED}" text-anchor="middle">Cycles per day</text>`,
      );
  });
  out.push("</svg>");
  return out.join("\n") + "\n";
}
