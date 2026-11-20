/** What the errata checks read from the store, for PEGELONLINE's gauges and their neighbors. */
import { dayAfter, type Erratum, type StoreReader } from "../../errata.ts";
import { Flag } from "../../schema.ts";
import { median } from "../../stats.ts";

const MINUTE_MS = 60_000;

const id = (station: string) => (station.includes("/") ? station : `pegelonline/${station}`);
const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;

/** A station's stored levels, a PEGELONLINE gauge's by its number, throwing when there are none. */
export async function levels(
  store: StoreReader,
  station: string,
  since: string,
  until = dayAfter(since, 1),
) {
  const rows = await store.levels(id(station), since, until);
  if (!rows.length)
    throw new Error(`the store holds no ${id(station)} levels from ${since} to ${until}`);
  return rows;
}

/** Throws when every value of a day outside a span is flagged suspect or worse, as the span would leave it. */
export async function unflagged(store: StoreReader, station: string, day: string) {
  const rows = await levels(store, station, day);
  if (rows.every((o) => o.flag >= Flag.suspect))
    throw new Error(`every ${id(station)} value on ${day}, outside the span, is flagged suspect`);
}

/** `a` minus `b` at each time both hold. */
export async function differences(
  store: StoreReader,
  a: string,
  b: string,
  since: string,
  until: string,
): Promise<number[]> {
  const other = new Map((await levels(store, b, since, until)).map((o) => [o.time, o.level]));
  const d = (await levels(store, a, since, until)).flatMap((o) => {
    const v = other.get(o.time);
    return v === undefined ? [] : [o.level - v];
  });
  if (!d.length) throw new Error(`${id(a)} and ${id(b)} share no times from ${since} to ${until}`);
  return d;
}

/** The median of `a` minus `b` from `since` to before `until`. */
export const offset = async (
  store: StoreReader,
  a: string,
  b: string,
  since: string,
  until: string,
) => median(await differences(store, a, b, since, until));

/** Throws unless `a` minus `b` moves from the `before` window to the `after` one by more than `by` meters, in its sign. */
export async function step(
  store: StoreReader,
  a: string,
  b: string,
  before: [string, string],
  after: [string, string],
  by: number,
) {
  const moved = (await offset(store, a, b, ...after)) - (await offset(store, a, b, ...before));
  if (by > 0 ? moved <= by : moved >= by)
    throw new Error(
      `${id(a)} minus ${id(b)} moves ${cm(moved)} from ${before.join(" to ")} to ${after.join(" to ")}, not past ${cm(by)}`,
    );
}

/** The shift in minutes, within an hour, that best lines `a` up with `b` over the day: positive when `a` runs late. */
export async function lagMinutes(
  store: StoreReader,
  a: string,
  b: string,
  day: string,
): Promise<number> {
  const other = new Map((await levels(store, b, day)).map((o) => [o.time, o.level]));
  const values = await levels(store, a, day);
  let best = { lag: 0, spread: Infinity };
  for (let lag = -60; lag <= 60; lag++) {
    const d = values.flatMap((o) => {
      const v = other.get(o.time - lag * MINUTE_MS);
      return v === undefined ? [] : [o.level - v];
    });
    if (d.length < 60) continue;
    const mean = d.reduce((x, y) => x + y, 0) / d.length;
    const spread = d.reduce((x, y) => x + (y - mean) ** 2, 0) / d.length;
    if (spread < best.spread) best = { lag, spread };
  }
  if (best.spread === Infinity)
    throw new Error(`${id(a)} and ${id(b)} share too few minutes on ${day}`);
  return best.lag;
}

/** Throws unless more than `count` of the day's values read `level` meters. */
export async function held(
  store: StoreReader,
  station: string,
  day: string,
  level: number,
  count: number,
) {
  const n = (await levels(store, station, day)).filter(
    (o) => Math.abs(o.level - level) < 0.005,
  ).length;
  if (n <= count)
    throw new Error(`${n} ${id(station)} values on ${day} read ${level} m, not more than ${count}`);
}

/** Throws unless QC flags every value reading `level` meters in the years of the entry's span, outside the span. */
export async function qcFlags(
  store: StoreReader,
  e: Pick<Erratum, "stations" | "since" | "until">,
  level: number,
) {
  const station = e.stations![0]!;
  const [since, until] = [e.since!, e.until!];
  const [from, to] = [Date.parse(since), Date.parse(until)];
  const years = `${since.slice(0, 4)}-01-01`;
  const yearsEnd = `${Number(dayAfter(until, -1).slice(0, 4)) + 1}-01-01`;
  const not = (await levels(store, station, years, yearsEnd)).filter(
    (o) =>
      (o.time < from || o.time >= to) && Math.abs(o.level - level) < 0.005 && o.flag < Flag.suspect,
  );
  if (not.length)
    throw new Error(
      `${not.length} ${id(station)} values of ${level} m from ${years} to ${yearsEnd} outside the span aren't flagged suspect`,
    );
}

/** Throws unless the store holds `level` meters at `time` with the flag PEGELONLINE served, which QC left alone. */
export function kept(
  values: { time: number; level: number; flag: number; source_flag?: number }[],
  station: string,
  time: string,
  level: number,
) {
  const o = values.find((v) => v.time === Date.parse(time));
  if (!o) throw new Error(`the store holds no ${id(station)} value at ${time}`);
  if (Math.abs(o.level - level) >= 0.005)
    throw new Error(`${id(station)} holds ${o.level} m at ${time}, not ${level} m`);
  if (o.source_flag == null || o.flag !== o.source_flag)
    throw new Error(
      `${id(station)}'s ${level} m at ${time} is flagged ${o.flag}, not the ${o.source_flag} PEGELONLINE served`,
    );
}

/** Throws unless the store holds `level` meters at `time` with QC's `suspect` over the flag PEGELONLINE served. */
export function flaggedByQc(
  values: { time: number; level: number; flag: number; source_flag?: number }[],
  station: string,
  time: string,
  level: number,
) {
  const o = values.find((v) => v.time === Date.parse(time));
  if (!o) throw new Error(`the store holds no ${id(station)} value at ${time}`);
  if (Math.abs(o.level - level) >= 0.005)
    throw new Error(`${id(station)} holds ${o.level} m at ${time}, not ${level} m`);
  if (o.flag < Flag.suspect || (o.source_flag ?? 0) >= Flag.suspect)
    throw new Error(
      `${id(station)}'s ${level} m at ${time} is flagged ${o.flag} from a source flag of ${o.source_flag}, not suspect from QC`,
    );
}
