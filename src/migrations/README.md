# Migrations

Each file here is the work a merged change needs done to the public store, which the job service on the Stillwell server runs once, one step at a time, after the merge ([docs/plans/jobs.md](../../docs/plans/jobs.md#migrations), [CONTRIBUTING.md](../../CONTRIBUTING.md#migrations)).

Name a file `YYYYMMDD-what-it-does.ts`, with the date it's written. Files run in name order, and one that sorts before a migration already started isn't run, so rename it to sort after if another merged first. It exports a `Migration` from [`src/jobs/migrations.ts`](../jobs/migrations.ts):

```ts
import type { Migration } from "../jobs/migrations.ts";

export default {
  description: "Drop impossible water levels from USACE",
  steps: [
    { ingest: "requalify usace 01234,05678 1982 2027", timeout: 240 },
    { ingest: "compact usace --rebuild-bounds" },
    {
      check: "no USACE year file holds a level under -100 m",
      async verify(store) {
        // read back what the steps wrote, and throw when it's wrong
      },
    },
  ],
} satisfies Migration;
```
