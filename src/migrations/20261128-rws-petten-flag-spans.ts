import { Flag } from "../schema.ts";
import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "rws-petten-meetraai3-2012-zero",
  "rws-petten-meetraai3-2013-march-zero",
  "rws-petten-meetraai3-2013-april-zero",
];

const STATIONS = ["rws/petten.meetraai3", "gesla/petten_meetraai_03-pet-nld-rws"];
// Between and after the errata's spans, where the old single span's flags must be gone.
const RELEASED = [
  ["2012-12-14", "2013-03-08"],
  ["2013-03-10", "2013-04-14"],
  ["2013-05-04", "2013-05-16"],
] as const;

export default {
  description: "Flag Petten meetraai 03 only where it's faulty",
  steps: [
    { ingest: "requalify rws petten.meetraai3 2012 2014" },
    { ingest: "requalify gesla petten_meetraai_03-pet-nld-rws 2012 2014" },
    { ingest: "publish" },
    {
      check: "the three Petten errata read back, and the values between them are released",
      async verify(store) {
        const reader = errataReader(() => store, store);
        for (const id of IDS) {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          await e.check(reader, e);
        }
        // QC's own rules flag a few percent here; the old span flagged every value.
        for (const station of STATIONS)
          for (const [since, until] of RELEASED) {
            const rows = await reader.levels(station, since, until);
            const suspect = rows.filter((o) => o.flag >= Flag.suspect).length;
            if (!rows.length || suspect > rows.length / 5)
              throw new Error(
                `${suspect} of ${station}'s ${rows.length} levels from ${since} to ${until} are suspect`,
              );
          }
      },
    },
  ],
} satisfies Migration;
