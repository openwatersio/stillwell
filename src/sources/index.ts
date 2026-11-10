import { readErrata, withErrata } from "../errata.ts";
import type { Source } from "../schema.ts";
import { source as bodc } from "./bodc/index.ts";
import { source as bsh } from "./bsh/index.ts";
import { source as cdec } from "./cdec/index.ts";
import { source as coops } from "./coops/index.ts";
import { source as dwr } from "./dwr/index.ts";
import { source as ea } from "./ea/index.ts";
import { source as gesla } from "./gesla/index.ts";
import { source as jma } from "./jma/index.ts";
import { source as kartverket } from "./kartverket/index.ts";
import { source as marineInstitute } from "./marine-institute/index.ts";
import { source as pegelonline } from "./pegelonline/index.ts";
import { source as refmar } from "./refmar/index.ts";
import { source as rws } from "./rws/index.ts";
import { source as sfwmd } from "./sfwmd/index.ts";
import { source as smhi } from "./smhi/index.ts";
import { source as uhslc } from "./uhslc/index.ts";
import { source as usace } from "./usace/index.ts";
import { source as usgs } from "./usgs/index.ts";
import bodcErrata from "./bodc/errata.json" with { type: "json" };
import dwrErrata from "./dwr/errata.json" with { type: "json" };
import geslaErrata from "./gesla/errata.json" with { type: "json" };
import jmaErrata from "./jma/errata.json" with { type: "json" };
import marineInstituteErrata from "./marine-institute/errata.json" with { type: "json" };
import pegelonlineErrata from "./pegelonline/errata.json" with { type: "json" };
import refmarErrata from "./refmar/errata.json" with { type: "json" };
import rwsErrata from "./rws/errata.json" with { type: "json" };
import smhiErrata from "./smhi/errata.json" with { type: "json" };
import uhslcErrata from "./uhslc/errata.json" with { type: "json" };
import usaceErrata from "./usace/errata.json" with { type: "json" };

const adapters: Record<string, Source> = {
  bodc,
  bsh,
  cdec,
  coops,
  dwr,
  ea,
  gesla,
  jma,
  kartverket,
  "marine-institute": marineInstitute,
  pegelonline,
  refmar,
  rws,
  sfwmd,
  smhi,
  uhslc,
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
  dwr: dwrErrata,
  gesla: geslaErrata,
  jma: jmaErrata,
  "marine-institute": marineInstituteErrata,
  pegelonline: pegelonlineErrata,
  refmar: refmarErrata,
  rws: rwsErrata,
  smhi: smhiErrata,
  uhslc: uhslcErrata,
  usace: usaceErrata,
};

/** Every source's errata, and what's wrong with any, which `publish` and the tests fail on. */
export const { errata, problems: errataProblems } = readErrata(errataFiles);

/** Every adapter, by source ID, with its errata's spans flagged. */
export const sources: Record<string, Source> = Object.fromEntries(
  Object.entries(adapters).map(([id, source]) => [id, withErrata(source, errata)]),
);

export function sourceOf(id: string): Source {
  const source = sources[id];
  if (!source)
    throw new Error(`Unknown source ${id}; expected one of ${Object.keys(sources).join(", ")}`);
  return source;
}
