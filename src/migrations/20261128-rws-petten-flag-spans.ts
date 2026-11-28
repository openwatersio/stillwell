import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "rws-petten-meetraai3-2012-zero",
  "rws-petten-meetraai3-2012-range",
  "rws-petten-meetraai3-2013-march-zero",
  "rws-petten-meetraai3-2013-april-zero",
];

export default {
  description: "Flag Petten meetraai 03 only where it's faulty",
  steps: [
    { ingest: "requalify rws petten.meetraai3 2012 2014" },
    { ingest: "requalify gesla petten_meetraai_03-pet-nld-rws 2012 2014" },
    { ingest: "publish" },
    {
      check: "the four Petten errata read back from the store",
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
