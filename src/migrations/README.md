# Migrations

Each file here is the work a merged change needs done to the public store, which the [Migrations workflow](../../.github/workflows/migrations.yml) runs once, one step at a time, after the merge ([docs/plans/cloudflare.md](../../docs/plans/cloudflare.md#migrations), [Operations](../../docs/contributing/operations.md#migrations)).

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

A step is `ingest` arguments, which run as `node scripts/ingest.ts <arguments>` in the step's source's `store-<source>` concurrency group, `drop`, `withhold` and `misplaced` included, or a `check`, which reads back what the steps before it wrote and throws when the store is wrong. A `timeout` is in minutes: 180 by default for an `ingest` step, 30 for a check, at most 360. A migration's first step is not a check.

- A step passes no `--accept-*` flag or `--dry-run`, since those accept whatever the source reports when the step runs, long after the review. A requalify with a `--budget`, as `analyze --requalify` always has, takes one of at least its timeout, so it never stops early and succeeds. `npm test` parses each step as `scripts/ingest.ts` would and checks the words its command takes.
- The workflow runs the steps of all migrations in file-name order and records each in `migrations.json` in the store. A migration that sorts before one already recorded isn't run, and holds every migration after it until it's renamed to sort after.
- The workflow reads each migration's steps when a step starts, and the record keeps only a step's number, so edit a migration only before it starts.
- A failed step opens an issue titled "Migration <id> failed" and stops every migration after it. Run the Migrations workflow with `retry` and the migration's name to run the step again, or with `skip` to mark the migration done without its remaining steps, a decision to make once they can't or needn't run.
- `baseline` begins the record with the last migration already done, which marks it and every earlier one done: dispatch the Migrations workflow with `baseline` and that migration, or `none`, or run `node scripts/migrations.ts baseline <id|none>` with the store's credentials. Until a record exists no migration runs, so a store that never had one doesn't run them all, and each run opens a "Migrations are stopped" issue saying so.
- `node scripts/migrations.ts list` prints the record.
