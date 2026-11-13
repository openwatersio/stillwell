// Compares the spike rule's neighbor reference in src/qc.ts with five
// alternatives, on a synthetic steep tide with a gap and on exported
// station-years run with each station's qcFor options, counting the values QC
// raises over the source's flag and the values the spike rule judges at all.
// Each variant is src/qc.ts with only the residual changed, written to a
// temporary directory and imported from there. Needs `npm install`.
//
//   node docs/qc/scripts/spike-variants.ts jer2025.json:2025 kil2025.json:2025 ...
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../../src/", import.meta.url));
const source = readFileSync(join(SRC, "qc.ts"), "utf8").replace(
  /from "\.\/(\w+\.ts)"/g,
  (_, file: string) => `from ${JSON.stringify(pathToFileURL(join(SRC, file)).href)}`,
);
const current = `    const before: number[] = [];
    const after: number[] = [];
    for (let k = i - 1; k >= 0 && r.time - all[k]!.time <= 3 * spacing; k--)
      before.push(all[k]!.level);
    for (let k = i + 1; k < all.length && all[k]!.time - r.time <= 3 * spacing; k++)
      after.push(all[k]!.level);
    return before.length && after.length ? r.level - median([...before, ...after])! : undefined;`;
if (!source.includes(current))
  throw new Error("src/qc.ts's spike residual has changed; update this script");
const neighbors = `    const before: { t: number; l: number }[] = [];
    const after: { t: number; l: number }[] = [];
    for (let k = i - 1; k >= 0 && r.time - all[k]!.time <= 3 * spacing; k--)
      before.push({ t: all[k]!.time, l: all[k]!.level });
    for (let k = i + 1; k < all.length && all[k]!.time - r.time <= 3 * spacing; k++)
      after.push({ t: all[k]!.time, l: all[k]!.level });
    if (!before.length || !after.length) return undefined;
`;
const variants: Record<string, string> = {
  // The same number of neighbors on each side.
  count: `${neighbors}    const k = Math.min(before.length, after.length);
    return r.level - median([...before.slice(0, k), ...after.slice(0, k)].map((x) => x.l))!;`,
  // Only neighbors whose mirror offset on the other side also holds a value, within half an interval.
  mirror: `${neighbors}    const near = (side: { t: number }[], off: number) =>
      side.some((x) => Math.abs(Math.abs(x.t - r.time) - off) <= spacing / 2);
    const b = before.filter((x) => near(after, r.time - x.t));
    const a = after.filter((x) => near(before, x.t - r.time));
    if (!b.length || !a.length) return undefined;
    return r.level - median([...b, ...a].map((x) => x.l))!;`,
  // Mirrored neighbors where there are any, otherwise today's median of every neighbor.
  fallback: `${neighbors}    const near = (side: { t: number }[], off: number) =>
      side.some((x) => Math.abs(Math.abs(x.t - r.time) - off) <= spacing / 2);
    const b = before.filter((x) => near(after, r.time - x.t));
    const a = after.filter((x) => near(before, x.t - r.time));
    const use = b.length && a.length ? [...b, ...a] : [...before, ...after];
    return r.level - median(use.map((x) => x.l))!;`,
  // The straight line through the nearest neighbor on each side.
  interp: `${neighbors}    const p = before[0]!, n = after[0]!;
    return r.level - (p.l + ((n.l - p.l) * (r.time - p.t)) / (n.t - p.t));`,
  // The median of the straight lines through every pair of a neighbor before and one after.
  pairs: `${neighbors}    const lines: number[] = [];
    for (const p of before) for (const n of after) lines.push(p.l + ((n.l - p.l) * (r.time - p.t)) / (n.t - p.t));
    return r.level - median(lines)!;`,
};
if (!source.includes("  const threshold = Math.max("))
  throw new Error("src/qc.ts's spike threshold has changed; update this script");
// Each variant counts the window's own values the spike rule judges, in globalThis.__judged.
const COUNT =
  "  (globalThis as any).__judged = residuals.filter((d, i) => d !== undefined && own.has(all[i]!)).length;\n  const threshold = Math.max(";
const dir = mkdtempSync(join(tmpdir(), "qc-variants-"));
type Qc = (rows: any[], opts?: any, context?: any[]) => any[];
const V: Record<string, Qc> = {};
for (const [name, body] of Object.entries({ now: current, ...variants })) {
  const file = join(dir, `qc_${name}.ts`);
  writeFileSync(
    file,
    source.replace(current, body).replace("  const threshold = Math.max(", COUNT),
  );
  V[name] = (await import(pathToFileURL(file).href)).qc;
}
const { load, raised } = await import("./store.ts");

const t0 = Date.UTC(2025, 0, 1);
const synth: Record<string, number> = {};
for (const [n, q] of Object.entries(V)) {
  let fp = 0;
  for (let phase = 0; phase < 12; phase++)
    for (const gap of [1, 2, 3]) {
      const s = Array.from({ length: 288 }, (_, i) => ({
        time: t0 + i * 900_000,
        level: Math.round(1e4 * 4.5 * Math.cos((2 * Math.PI * (i * 0.25 + phase)) / 12.42)) / 1e4,
        flag: 0,
      }));
      s.splice(151, gap);
      fp += q(s, {}).filter((r) => r.flag >= 3).length;
    }
  synth[n] = fp;
}
console.log(
  "synthetic 9 m tide, 15 min, one gap of 1 to 3 values, 36 cases, false flags:",
  JSON.stringify(synth),
);

for (const arg of process.argv.slice(2)) {
  const [file, yearText] = arg.split(":");
  const y = Number(yearText);
  const { station, start, context, options } = load(file!, y);
  const out = Object.entries(V).map(([n, q]) => {
    const raisedCount = q(start, options, context).filter(raised).length;
    return `${n} ${raisedCount} raised, ${(globalThis as any).__judged} judged`;
  });
  console.log(
    `${station.id} ${y} of ${start.length} values, options ${JSON.stringify(options)}:\n  ${out.join("\n  ")}`,
  );
}
