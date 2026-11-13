import * as Plot from "npm:@observablehq/plot";

export const FLAGS = ["good", "interpolated", "preliminary", "suspect", "bad"];
const FLAG_COLORS = ["#4e79a7", "#76b7b2", "#bab0ac", "#f28e2b", "#e15759"];

/** Values per year stacked by flag, from rows of { year, flag, n }. */
export function flagChart(rows, { width }) {
  return Plot.plot({
    width,
    height: 260,
    marginLeft: 60,
    x: { label: null, tickFormat: "d" },
    y: { label: "Values", grid: true },
    color: { legend: true, domain: FLAGS, range: FLAG_COLORS },
    marks: [
      Plot.rectY(rows, {
        x1: "year",
        x2: (d) => d.year + 1,
        y: "n",
        fill: "flag",
        order: FLAGS,
        tip: true,
      }),
      Plot.ruleY([0]),
    ],
  });
}

/** Break a series where values are further apart than `gap` milliseconds, so the line doesn't bridge missing data. */
export function breakGaps(rows, gap) {
  const out = [];
  for (const [i, d] of rows.entries()) {
    if (i && d.time - rows[i - 1].time > gap) out.push({ time: new Date(+d.time - 1), level: NaN });
    out.push(d);
  }
  return out;
}

/** Observed levels colored by whether their flag keeps them, with an optional prediction line. */
export function levelChart(levels, { width, title, datum, predictions = [] }) {
  return Plot.plot({
    title,
    width,
    height: 320,
    x: { type: "utc", label: null },
    y: { label: `Level (m, ${datum})`, grid: true },
    color: {
      legend: true,
      domain: ["observed", "suspect or bad", "predicted"],
      range: ["#4e79a7", "#e15759", "#999"],
    },
    marks: [
      Plot.lineY(predictions, {
        x: "time",
        y: "level",
        stroke: () => "predicted",
        strokeDasharray: "3,2",
      }),
      Plot.lineY(levels, { x: "time", y: "level", stroke: () => "observed" }),
      Plot.dot(
        levels.filter((d) => d.flag > 2),
        { x: "time", y: "level", r: 1.5, fill: () => "suspect or bad" },
      ),
      Plot.tip(
        levels,
        Plot.pointerX({
          x: "time",
          y: "level",
          title: (d) =>
            `${d.time.toISOString().slice(0, 16).replace("T", " ")} UTC\n${d.level?.toFixed(3)} m\nflag ${d.flag}`,
        }),
      ),
    ],
  });
}
