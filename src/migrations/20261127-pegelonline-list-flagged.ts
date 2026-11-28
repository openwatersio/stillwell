import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

// The errata flag List auf Sylt from 21 August 2024 on, in PEGELONLINE's record, CMEMS's and GESLA's copy of each;
// a requalify of each flags the stored years.
export default {
  description: "Flag List auf Sylt's low levels since 21 August 2024",
  steps: [
    { ingest: "requalify pegelonline 9570070 2024 2027" },
    { ingest: "requalify cmems ListTG 2024 2027" },
    { ingest: "requalify gesla listaufsylt-9570070-deu-wsv,listtg-lis-deu-cmems 2024 2027" },
    { ingest: "publish" },
    {
      check: "the errata for List auf Sylt's levels read back from the store",
      async verify(store) {
        const reader = errataReader(() => store, store);
        for (const id of ["pegelonline-list-2024-level", "cmems-list-2024-level"]) {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          try {
            await e.check(reader, e);
          } catch (error) {
            throw new Error(`${id}: ${(error as Error).message}`);
          }
        }
      },
    },
  ],
} satisfies Migration;
