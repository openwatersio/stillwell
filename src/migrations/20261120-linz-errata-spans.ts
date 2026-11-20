import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

// The errata whose spans changed or are new in src/sources/linz/errata.ts; a requalify applies them to stored levels.
// The check runs them as they stand when the step runs.
export const IDS = [
  "linz-owenga-sensor-41-spikes",
  "linz-boat-cove-sensor-fault-2014",
  "linz-fishing-rock-sensor-fault",
];

// End years are exclusive: Boat Cove's span runs into 2015.
export default {
  description: "Flag the LINZ sensor faults at Owenga, Boat Cove and Fishing Rock",
  steps: [
    { ingest: "requalify linz CHIT 2010 2011" },
    { ingest: "requalify linz RBCT 2014 2016" },
    { ingest: "requalify linz RFRT 2017 2018" },
    {
      check: "each erratum's span holds its levels flagged suspect",
      async verify(store) {
        const reader = errataReader(() => store, store);
        for (const id of IDS) {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          await e.check(reader, e);
        }
      },
    },
  ],
} satisfies Migration;
