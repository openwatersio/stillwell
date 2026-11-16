import type { ParseArgsOptionsConfig } from "node:util";

/** scripts/ingest.ts's options, which the job queue parses arguments with too (src/jobs/commands.ts). */
export const INGEST_OPTIONS = {
  hours: { type: "string", default: "24" },
  "keep-days": { type: "string", default: "7" },
  days: { type: "string", default: "1" },
  concurrency: { type: "string", default: "4" },
  "accept-epochs": { type: "boolean", default: false },
  "accept-withheld": { type: "boolean", default: false },
  "accept-matches": { type: "boolean", default: false },
  "no-publish": { type: "boolean", default: false },
  first: { type: "string" },
  shard: { type: "string" },
  refetch: { type: "boolean", default: false },
  "skip-written": { type: "boolean", default: false },
  "with-inactive": { type: "boolean", default: false },
  "skip-unscreened": { type: "boolean", default: false },
  "rebuild-bounds": { type: "boolean", default: false },
  "rebuild-years": { type: "boolean", default: false },
  all: { type: "boolean", default: false },
  requalify: { type: "boolean", default: false },
  budget: { type: "string" },
  "dry-run": { type: "boolean", default: false },
} as const satisfies ParseArgsOptionsConfig;
