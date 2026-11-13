// Each source's stations as compact JSON, for the station table on its page.
import type { APIRoute } from "astro";
import { stations, json } from "../../../lib/store";
import { stationPath } from "../../../lib/paths";

export async function getStaticPaths() {
  return (await json("sources.json")).map((s) => ({ params: { source: s.id } }));
}

export const GET: APIRoute = async ({ params }) => {
  const list = (await stations())
    .filter((d) => d.source === params.source)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    // Rows rather than objects keep the file small: [name, path, source_id, kind, status, live, datum, first year, last year].
    .map((d) => [
      d.name,
      stationPath(d.id),
      d.source_id,
      d.kind,
      d.status,
      d.live,
      d.datum,
      d.first?.getUTCFullYear() ?? null,
      d.last?.getUTCFullYear() ?? null,
    ]);
  return new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } });
};
