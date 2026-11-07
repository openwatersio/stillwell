import type { Source } from "../schema.ts";
import { source as bsh } from "./bsh/index.ts";
import { source as coops } from "./coops/index.ts";
import { source as ea } from "./ea/index.ts";
import { source as pegelonline } from "./pegelonline/index.ts";
import { source as rws } from "./rws/index.ts";
import { source as uhslc } from "./uhslc/index.ts";
import { source as usace } from "./usace/index.ts";
import { source as usgs } from "./usgs/index.ts";

/** Every adapter, by source ID. */
export const sources: Record<string, Source> = {
  bsh,
  coops,
  ea,
  pegelonline,
  rws,
  uhslc,
  usace,
  usgs,
};

export function sourceOf(id: string): Source {
  const source = sources[id];
  if (!source)
    throw new Error(`Unknown source ${id}; expected one of ${Object.keys(sources).join(", ")}`);
  return source;
}
