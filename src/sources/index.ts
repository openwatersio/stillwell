import { readErrata, withErrata } from "../errata.ts";
import type { Observation, Source } from "../schema.ts";
import { possible } from "../span.ts";
import { source as bodc } from "./bodc/index.ts";
import { source as bom } from "./bom/index.ts";
import { source as bsh } from "./bsh/index.ts";
import { source as cco } from "./cco/index.ts";
import { source as cdec } from "./cdec/index.ts";
import { source as cmems } from "./cmems/index.ts";
import { source as coops } from "./coops/index.ts";
import { source as crms } from "./crms/index.ts";
import { source as dmi } from "./dmi/index.ts";
import { source as dwr } from "./dwr/index.ts";
import { source as ea } from "./ea/index.ts";
import { source as gesla } from "./gesla/index.ts";
import { source as jma } from "./jma/index.ts";
import { source as jodc } from "./jodc/index.ts";
import { source as kartverket } from "./kartverket/index.ts";
import { source as linz } from "./linz/index.ts";
import { source as marineInstitute } from "./marine-institute/index.ts";
import { source as pegelonline } from "./pegelonline/index.ts";
import { source as refmar } from "./refmar/index.ts";
import { source as rws } from "./rws/index.ts";
import { source as sfwmd } from "./sfwmd/index.ts";
import { source as smhi } from "./smhi/index.ts";
import { source as uhslc } from "./uhslc/index.ts";
import { source as unam } from "./unam/index.ts";
import { source as usace } from "./usace/index.ts";
import { source as usgs } from "./usgs/index.ts";
import bodcErrata from "./bodc/errata.json" with { type: "json" };
import bomErrata from "./bom/errata.json" with { type: "json" };
import cdecErrata from "./cdec/errata.json" with { type: "json" };
import cmemsErrata from "./cmems/errata.json" with { type: "json" };
import coopsErrata from "./coops/errata.json" with { type: "json" };
import crmsErrata from "./crms/errata.json" with { type: "json" };
import dmiErrata from "./dmi/errata.json" with { type: "json" };
import dwrErrata from "./dwr/errata.json" with { type: "json" };
import eaErrata from "./ea/errata.json" with { type: "json" };
import geslaErrata from "./gesla/errata.json" with { type: "json" };
import jmaErrata from "./jma/errata.json" with { type: "json" };
import jodcErrata from "./jodc/errata.json" with { type: "json" };
import linzErrata from "./linz/errata.json" with { type: "json" };
import marineInstituteErrata from "./marine-institute/errata.json" with { type: "json" };
import pegelonlineErrata from "./pegelonline/errata.json" with { type: "json" };
import refmarErrata from "./refmar/errata.json" with { type: "json" };
import rwsErrata from "./rws/errata.json" with { type: "json" };
import sfwmdErrata from "./sfwmd/errata.json" with { type: "json" };
import smhiErrata from "./smhi/errata.json" with { type: "json" };
import uhslcErrata from "./uhslc/errata.json" with { type: "json" };
import usaceErrata from "./usace/errata.json" with { type: "json" };
import usgsErrata from "./usgs/errata.json" with { type: "json" };

const adapters: Record<string, Source> = {
  bodc,
  bom,
  bsh,
  cco,
  cdec,
  cmems,
  coops,
  crms,
  dmi,
  dwr,
  ea,
  gesla,
  jma,
  jodc,
  kartverket,
  linz,
  "marine-institute": marineInstitute,
  pegelonline,
  refmar,
  rws,
  sfwmd,
  smhi,
  uhslc,
  unam,
  usace,
  usgs,
};

/**
 * Each source's `errata.json`, imported rather than read so the registry needs
 * no file system. A source that starts one adds it here; a test checks that
 * every file is.
 */
export const errataFiles: Record<string, unknown> = {
  bodc: bodcErrata,
  bom: bomErrata,
  cdec: cdecErrata,
  cmems: cmemsErrata,
  coops: coopsErrata,
  crms: crmsErrata,
  dmi: dmiErrata,
  dwr: dwrErrata,
  ea: eaErrata,
  gesla: geslaErrata,
  jma: jmaErrata,
  jodc: jodcErrata,
  linz: linzErrata,
  "marine-institute": marineInstituteErrata,
  pegelonline: pegelonlineErrata,
  refmar: refmarErrata,
  rws: rwsErrata,
  sfwmd: sfwmdErrata,
  smhi: smhiErrata,
  uhslc: uhslcErrata,
  usace: usaceErrata,
  usgs: usgsErrata,
};

/** Every source's errata, and what's wrong with any, which `publish` and the tests fail on. */
export const { errata, problems: errataProblems } = readErrata(errataFiles);

/**
 * `source` with every observed level it fetches outside `SPAN_M` left out, since no
 * gauge reads one: it's a fill value or junk, missing rather than a bad value
 * (errata `usace-fill-values`, `cdec-fill-values`, `usgs-fill-values` and
 * `pegelonline-fill-values`, and GESLA's and CMEMS's, whose adapters drop them too).
 */
export function withinSpan(source: Source): Source {
  const keep = (rows: Observation[]) => rows.filter((r) => possible(r.level));
  const { observations, recent } = source;
  return {
    ...source,
    ...(observations && {
      observations: async (station, start, end) => keep(await observations(station, start, end)),
    }),
    ...(recent && {
      recent: async (stations, start, end) =>
        new Map(
          [...(await recent(stations, start, end))].map(([id, rows]) => [
            id,
            rows instanceof Error ? rows : keep(rows),
          ]),
        ),
    }),
  };
}

/** Every adapter, by source ID, with its errata's spans flagged and levels outside `SPAN_M` left out. */
export const sources: Record<string, Source> = Object.fromEntries(
  Object.entries(adapters).map(([id, source]) => [id, withinSpan(withErrata(source, errata))]),
);

export function sourceOf(id: string): Source {
  const source = sources[id];
  if (!source)
    throw new Error(`Unknown source ${id}; expected one of ${Object.keys(sources).join(", ")}`);
  return source;
}
