/**
 * Fetch water levels into data/ as Parquet, in the lake's layout:
 *
 *   data/stations/<source>.json
 *   data/obs/<source>/<station>/<year>.parquet
 *   data/predictions/<source>/<station>/<year>.parquet          (curves)
 *   data/predictions/<source>/<station>/<year>-extremes.parquet (high and low waters)
 *
 * Usage:
 *   node scripts/fetch.ts stations
 *   node scripts/fetch.ts rws <location> <start-year> [end-year]
 *   node scripts/fetch.ts bsh <bshnr> [year...]
 *   node scripts/fetch.ts pegelonline <uuid>
 *
 * `rws` writes observed levels, plus RWS's astronomical tide and both sets of
 * extremes as predictions. `bsh` writes BSH's predictions and, when the gauge is
 * on PEGELONLINE, its last 31 days of observations.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { writeParquet } from "../src/parquet.ts";
import * as bsh from "../src/sources/bsh.ts";
import * as pegelonline from "../src/sources/pegelonline.ts";
import * as rws from "../src/sources/rws.ts";
import type { Sample } from "../src/types.ts";

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "stations": {
    await mkdir("data/stations", { recursive: true });
    const bshGauges = await Promise.all((await bsh.gauges()).map((g) => bsh.gauge(g.bshnr)));
    const lists = {
      rws: await rws.stations(),
      bsh: bshGauges,
      pegelonline: await pegelonline.stations(),
    };
    for (const [source, list] of Object.entries(lists)) {
      await writeFile(`data/stations/${source}.json`, JSON.stringify(list, null, 2) + "\n");
      console.log(`${source}: ${list.length} stations`);
    }
    break;
  }

  case "rws": {
    const [location, from, to = from] = args;
    if (!location || !from) usage();
    for (let year = Number(from); year <= Number(to!); year++) {
      const start = new Date(Date.UTC(year, 0, 1));
      const end = new Date(Date.UTC(year + 1, 0, 1));
      const fresh = end.getTime() > Date.now();
      const dir = `rws/${location}`;
      await write(
        `data/obs/${dir}/${year}.parquet`,
        await rws.levels(location, start, end, { fresh }),
      );
      await write(
        `data/obs/${dir}/${year}-extremes.parquet`,
        await rws.extremes(location, start, end, { fresh }),
      );
      const astronomical = { process: "astronomisch" as const, fresh };
      await write(
        `data/predictions/${dir}/${year}.parquet`,
        await rws.levels(location, start, end, astronomical),
      );
      await write(
        `data/predictions/${dir}/${year}-extremes.parquet`,
        await rws.extremes(location, start, end, astronomical),
      );
    }
    break;
  }

  case "bsh": {
    const [bshnr, ...years] = args;
    if (!bshnr) usage();
    const gauge = await bsh.gauge(bshnr);
    for (const year of years.length ? years.map(Number) : gauge.years) {
      await write(`data/predictions/bsh/${bshnr}/${year}.parquet`, await bsh.curve(bshnr, year));
      await write(
        `data/predictions/bsh/${bshnr}/${year}-extremes.parquet`,
        await bsh.extremes(bshnr, year),
      );
    }
    if (gauge.pegelonline_uuid) await fetchPegelonline(gauge.pegelonline_uuid);
    break;
  }

  case "pegelonline": {
    const [uuid] = args;
    if (!uuid) usage();
    await fetchPegelonline(uuid);
    break;
  }

  default:
    usage();
}

/**
 * PEGELONLINE only keeps 31 days, so each fetch writes its own file and a
 * scheduled compaction is left to fold them into years.
 */
async function fetchPegelonline(uuid: string): Promise<void> {
  const samples = await pegelonline.levels(uuid);
  if (!samples.length) return;
  const first = new Date(samples[0]!.time).toISOString().slice(0, 10);
  const last = new Date(samples.at(-1)!.time).toISOString().slice(0, 10);
  await write(`data/obs/pegelonline/${uuid}/${first}_${last}.parquet`, samples);
}

async function write(path: string, rows: Sample[]): Promise<void> {
  if (!rows.length) {
    console.log(`${path}: no data`);
    return;
  }
  await writeParquet(path, rows);
  console.log(`${path}: ${rows.length} rows`);
}

function usage(): never {
  console.error(
    "usage: fetch.ts stations | rws <location> <start-year> [end-year] | bsh <bshnr> [year...] | pegelonline <uuid>",
  );
  process.exit(1);
}
