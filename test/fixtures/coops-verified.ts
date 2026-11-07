// Preloaded into scripts/ingest.ts by test/backfill.test.ts: the CO-OPS data
// API answers each request with one verified value at its begin date, and
// each data URL is logged as it goes out. Station details answer with no dates.
// With EXIT_AFTER set, the process dies at that many data requests, as when a
// job hits its time limit.
import { pacing } from "../../src/sources/coops/index.ts";

pacing.metadataMs = 0;
pacing.dataMs = 0;
let requests = 0;
globalThis.fetch = (async (url: string | URL | Request) => {
  if (String(url).includes("/mdapi/")) return new Response("{}");
  console.error(`fetch ${String(url)}`);
  if (++requests === Number(process.env.EXIT_AFTER)) process.exit(9);
  const begin = new URL(String(url)).searchParams.get("begin_date")!;
  const t = `${begin.slice(0, 4)}-${begin.slice(4, 6)}-${begin.slice(6, 8)} ${begin.slice(9)}`;
  return new Response(JSON.stringify({ data: [{ t, v: "1.000", f: "0,0,0,0", q: "v" }] }));
}) as typeof fetch;
