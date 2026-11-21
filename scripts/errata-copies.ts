/**
 * For each `flagged` erratum with a span, compares every record `same_as`
 * links to its stations, and every other source's copy it lists, marked
 * `(listed)`, with the erratum's own
 * record inside the span, against 7 days either side, and says whether each
 * is a copy that carries the error (src/errata-copies.ts). A span longer than
 * 150 days is read over 5 pieces of 30 days spread over it, an open end taken
 * at the original record's own, and every piece must agree. Each row says how
 * many of the span's days it compared. A copy belongs in the erratum's `stations`; a record with values
 * of its own doesn't. Reads only the store, STILLWELL_STORE, prints a Markdown
 * table, and exits 1 when any pair couldn't be read.
 *
 *   npm run errata:copies                          every flagged erratum
 *   npm run errata:copies -- pegelonline uhslc-x    sources or erratum IDs
 */
import { covers, utcDay, type Erratum } from "../src/errata.ts";
import { compare } from "../src/errata-copies.ts";
import { errata } from "../src/sources/index.ts";
import { errataReader } from "../src/store/errata-reader.ts";

const PIECE_DAYS = 30;
const PIECES = 5;
const MARGIN_DAYS = 7;
const DAY_MS = 86_400_000;
const store = errataReader();
const args = process.argv.slice(2);
const unknown = args.filter((a) => !errata.some((e) => e.id === a || covers(e, a)));
if (unknown.length) throw new Error(`no source or erratum ${unknown.join(", ")}`);
const chosen = errata.filter(
  (e) =>
    e.handling === "flagged" &&
    e.stations?.length &&
    (e.since || e.until) &&
    (!args.length || args.some((a) => e.id === a || covers(e, a))),
);
if (!chosen.length) throw new Error(`no flagged erratum with stations and a span for ${args}`);

const rows = await store.rows("stations.parquet");
const links = new Map(
  rows.map((r) => [
    r.id as string,
    // DuckDB reads a list column as `{ items }`.
    (Array.isArray(r.same_as)
      ? r.same_as
      : ((r.same_as as { items?: string[] } | null)?.items ?? [])) as string[],
  ]),
);
if (!links.size) throw new Error("the store lists no stations in stations.parquet");
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const bounds = new Map(rows.map((r) => [r.id as string, [ms(r.first), ms(r.last)] as const]));

/**
 * The parts of `e`'s span read at `original`, `[from, to)` in ms: the span
 * where it's short, or `PIECES` of `PIECE_DAYS` spread evenly over it, an open
 * end taken at the record's own; and the reads, which add `MARGIN_DAYS` outside
 * each closed end to line the datums up.
 */
function windows(e: Erratum, original: string) {
  const [first, last] = bounds.get(original) ?? [NaN, NaN];
  const lo = e.since ? utcDay(e.since) : Math.floor(first / DAY_MS) * DAY_MS;
  const hi = e.until ? utcDay(e.until) : Math.ceil((last + 1) / DAY_MS) * DAY_MS;
  if (!(lo < hi)) throw new Error(`${original} has no values in the span`);
  const days = (hi - lo) / DAY_MS;
  const n = days <= PIECES * PIECE_DAYS ? 1 : PIECES;
  const pieces: [number, number][] =
    n < 2
      ? [[lo, hi]]
      : Array.from({ length: n }, (_, k) => {
          const start = lo + Math.round((k * (days - PIECE_DAYS)) / (n - 1)) * DAY_MS;
          return [start, start + PIECE_DAYS * DAY_MS];
        });
  const reads = pieces.map(([a, b], k): [number, number] => [
    k === 0 && e.since ? a - MARGIN_DAYS * DAY_MS : a,
    k === pieces.length - 1 && e.until ? b + MARGIN_DAYS * DAY_MS : b,
  ]);
  const compared = pieces.reduce((s, [a, b]) => s + (b - a) / DAY_MS, 0);
  return {
    lo,
    hi,
    pieces,
    reads,
    label: `${compared} of ${days}${e.since && e.until ? "" : " (open end at the record's)"}`,
  };
}

/** Other flagged errata that list `id` over part of `e`'s span: a record with one has its own handling already. */
const ownErrata = (e: Erratum, id: string) =>
  errata
    .filter(
      (x) =>
        x !== e &&
        x.stations?.includes(id) &&
        (x.since !== null || x.until !== null) &&
        (!x.until || !e.since || x.until > e.since) &&
        (!x.since || !e.until || x.since < e.until),
    )
    .map((x) => x.id)
    .join(", ");

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const read = async (id: string, reads: [number, number][]) =>
  (await Promise.all(reads.map(([a, b]) => store.levels(id, day(a), day(b))))).flat();
const cm = (m: number) => (Number.isFinite(m) ? (m * 100).toFixed(1) : "");

let failed = 0;
console.log(
  "| Erratum | Original | Record | Span days compared | Inside | Unmatched | Outside | Offset cm | Shift cm | RMS cm | Verdict | Record's own errata |",
);
console.log("| --- | --- | --- | --- | --: | --: | --: | --: | --: | --: | --- | --- |");
for (const e of chosen) {
  for (const original of e.stations!.filter((s) => s.startsWith(`${e.source}/`))) {
    // Listed copies too, so one that stops matching shows.
    const listed = e.stations!.filter((id) => !id.startsWith(`${e.source}/`));
    const others = [
      ...listed,
      ...(links.get(original) ?? []).filter((id) => !e.stations!.includes(id)),
    ];
    if (!others.length) continue;
    let base, w;
    try {
      w = windows(e, original);
      base = await read(original, w.reads);
    } catch (error) {
      failed++;
      console.log(`| ${e.id} | ${original} | | | | | | | | | ${(error as Error).message} | |`);
      continue;
    }
    for (const other of others) {
      let row: string;
      try {
        const c = compare(base, await read(other, w.reads), w.lo, w.hi, w.pieces);
        row = `${c.inside} | ${c.unmatched} | ${c.outside} | ${cm(c.offset_m)} | ${cm(c.shift_m)} | ${cm(c.rms_m)} | ${c.verdict}`;
      } catch (error) {
        failed++;
        row = ` | | | | | | ${(error as Error).message}`;
      }
      console.log(
        `| ${e.id} | ${original} | ${other}${listed.includes(other) ? " (listed)" : ""} | ${w.label} | ${row} | ${ownErrata(e, other)} |`,
      );
    }
  }
}
if (failed) {
  console.error(`${failed} pairs couldn't be read`);
  process.exitCode = 1;
}
