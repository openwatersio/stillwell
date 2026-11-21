# Migrations

Each file here is the work a merged change needs done to the public store, which the [Migrations workflow](../../.github/workflows/migrations.yml) runs once, one step at a time, after the merge ([Operations](../../docs/contributing/operations.md#migrations)).

Name a file `YYYYMMDD-what-it-does.ts`, with the date it's written. A migration runs once after it merges, whatever its name, and migrations waiting at once run in name order. The record knows a migration by its name, so never rename or reuse the name of one that has started: a new name runs again, and a failed or unfinished migration whose file is gone stops every migration until it's restored or skipped. It exports a `Migration` from [`src/jobs/migrations.ts`](../jobs/migrations.ts):

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

A step is `ingest` arguments, which run as `node scripts/ingest.ts <arguments>` in the step's source's `store-<source>` concurrency group (`matches` and `links` in the group of that name, as Monthly's jobs do, and a command without a source in `store`), waiting in its queue behind whatever runs there, `drop`, `withhold`, `misplaced` and `delete-years` included, or a `check`, which reads back what the steps before it wrote and throws when the store is wrong. A `timeout` is in minutes: 180 by default for an `ingest` step, 30 for a check, at most 360. A migration's first step is not a check.

- A `withhold` or `drop` step is followed by a `matches --prune` and a `links --prune` step, which take the stations' rows out of `stations/matches.parquet` and `stations/links.parquet`, as the Ingest workflow's prune jobs do after either.
- A step passes no `--accept-*` flag or `--dry-run`, since those accept whatever the source reports when the step runs, long after the review. A requalify with a `--budget`, as `analyze --requalify` always has, takes one of at least its timeout, so it never stops early and succeeds. `npm test` parses each step as `scripts/ingest.ts` would and checks the words its command takes.
- The workflow runs each migration the record doesn't have as done, once, whenever it merges, and records its steps in `migrations.json` in the store. A migration partway through its steps finishes before another starts, so no other migration's steps run between its own; of several waiting, it takes them by name.
- The workflow reads each migration's steps when a step starts, and the record keeps only a step's number, so edit a migration only before it starts.
- A failed step opens an issue titled "Migration <id> failed" and stops every migration not yet done, whatever its name. Run the Migrations workflow with `retry` and the migration's name to run the step again, or with `skip` to mark the migration done without its remaining steps, a decision to make once they can't or needn't run.
- `baseline` begins the record with the last migration already done, which marks it and every migration named before it done: dispatch the Migrations workflow with `baseline` and that migration, or `none`, or run `node scripts/migrations.ts baseline <id|none>` with the store's credentials. Until a record exists no migration runs, so a store that never had one doesn't run them all, and each run opens a "Migrations are stopped" issue saying so.
- `node scripts/migrations.ts list` prints the record.
