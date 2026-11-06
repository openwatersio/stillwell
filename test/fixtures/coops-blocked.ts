// Preloaded into scripts/ingest.ts by test/backfill.test.ts: the CO-OPS data
// API refuses every request, holds last a millisecond, and each data URL is
// logged as it goes out. Station details answer with no dates.
import { pacing } from "../../src/sources/coops/index.ts";

pacing.metadataMs = 0;
pacing.dataMs = 0;
pacing.blockedMs = 1;
globalThis.fetch = (async (url: string | URL | Request) => {
  if (String(url).includes("/mdapi/")) return new Response("{}");
  console.error(`fetch ${String(url)}`);
  return new Response("Forbidden", { status: 403 });
}) as typeof fetch;
