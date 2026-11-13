// Pinned: the package's latest tag is an older beta without fit().
import { fit } from "npm:@slackwater/engine@1.0.0-beta.11";

// NOAA's 37 standard constituents, by the names @slackwater/engine knows them.
export const NOAA37 = [
  "M2",
  "S2",
  "N2",
  "K1",
  "M4",
  "O1",
  "M6",
  "MK3",
  "S4",
  "MN4",
  "NU2",
  "S6",
  "MU2",
  "2N2",
  "OO1",
  "LAM2",
  "S1",
  "M1",
  "J1",
  "MM",
  "SSA",
  "SA",
  "MSF",
  "MF",
  "RHO",
  "Q1",
  "T2",
  "R2",
  "2Q1",
  "P1",
  "2SM2",
  "M3",
  "L2",
  "2MK3",
  "K2",
  "M8",
  "MS4",
];

/** Least-squares harmonic constants, with IHO nodal corrections at every sample, from rows of { time, level }. */
export function harmonics(rows, names = NOAA37) {
  const result = fit(
    rows.map((d) => ({ time: d.time, value: d.level })),
    names,
  );
  return new Map(
    result.constituents.map((c) => [c.name, { amplitude: c.amplitude, phase: c.phase }]),
  );
}

let pyodide;

/** UTide's solve, run in the browser through Pyodide, loaded on first use. */
export async function utide(rows, lat, names) {
  if (!pyodide) {
    const { loadPyodide } =
      await import("https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs");
    pyodide = await loadPyodide();
    await pyodide.loadPackage(["micropip", "numpy", "scipy"]);
    await pyodide.runPythonAsync(`import micropip; await micropip.install("utide")`);
  }
  pyodide.globals.set(
    "ms",
    Float64Array.from(rows, (d) => +d.time),
  );
  pyodide.globals.set(
    "h",
    Float64Array.from(rows, (d) => d.level),
  );
  pyodide.globals.set("lat", lat);
  pyodide.globals.set("names", names ?? null);
  const out = await pyodide.runPythonAsync(`
import numpy as np, utide
t = np.asarray(ms.to_py(), dtype="datetime64[ms]")
c = utide.solve(t, np.asarray(h.to_py()), lat=lat, method="ols", conf_int="none", verbose=False,
                constit=names.to_py() if names else "auto")
[(str(n), float(a), float(g)) for n, a, g in zip(c.name, c.A, c.g)]
`);
  return new Map(out.toJs().map(([name, amplitude, phase]) => [name, { amplitude, phase }]));
}
