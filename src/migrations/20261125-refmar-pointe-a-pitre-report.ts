import type { Migration } from "../jobs/migrations.ts";

export default {
  description: "Publish the Pointe-à-Pitre erratum with its report fields cleared",
  steps: [{ ingest: "publish" }],
} satisfies Migration;
