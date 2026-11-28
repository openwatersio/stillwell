// Each report's CSV, one row per record, where this build wrote it.
import type { APIRoute } from "astro";
import { REPORTS, reportCsv } from "../../lib/reports";

export function getStaticPaths() {
  return Object.keys(REPORTS)
    .filter((name) => reportCsv(name) !== undefined)
    .map((name) => ({ params: { name } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(reportCsv(params.name!), { headers: { "Content-Type": "text/csv; charset=utf-8" } });
