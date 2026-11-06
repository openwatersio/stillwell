# Cron Worker

GitHub's `schedule` trigger runs this repo's workflows hours late, or skips them. This Cloudflare Worker starts them instead: its Cron Triggers call GitHub's [workflow_dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) on `main`.

| Worker cron (UTC) | Workflow                                | GitHub's own schedule |
| ----------------- | --------------------------------------- | --------------------- |
| `12 * * * *`      | Ingest hourly (`ingest-hourly.yml`)     | `17 * * * *`          |
| `40 0 * * *`      | Compact daily (`compact-daily.yml`)     | `45 0 * * *`          |
| `25 1 2 * *`      | Monthly (`monthly.yml`), titled Monthly | `30 1 2 * *`          |
| `35 3 9 * *`      | Monthly with `refetch`, titled Refetch  | `40 3 9 * *`          |

Each workflow keeps its `schedule` as a backup, five minutes after the Worker's. A scheduled run checks first whether a dispatched one on `main` already started (in the last hour, 23 hours, or day, with Monthly's matching its title, Monthly or Refetch for every source) and if so runs nothing. A failed check runs the backup. Without that check, the second run would wait in each source's `lake-<source>` group and cancel any job already waiting there, since GitHub keeps one waiting job per group. When the Worker fails, the schedule still runs, late as it may be.

The Bucket check workflow stays on GitHub's schedule only: it writes nothing, and a late weekly run is fine.

The crons are in [wrangler.jsonc](wrangler.jsonc) and the workflows they start in `DISPATCHES` in [index.ts](index.ts). `test/cron.test.ts` checks the two match, that each cron is five minutes before its workflow's schedule, and that the workflow takes the inputs sent. Cloudflare's free plan allows five Cron Triggers per account, counting every Worker on it, so `wrangler deploy` fails if other Workers already use more than one.

## Setup

Deploy only once the workflows' checks for a dispatched run are on `main`. Without them, every scheduled run is a second run. These steps need a GitHub org owner for `openwatersio` and access to the Cloudflare account that holds the `water-levels` bucket.

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - **Resource owner**: `openwatersio`
   - **Expiration**: the longest the org allows. Put a reminder in a calendar a week before it expires.
   - **Repository access**: Only select repositories, `openwatersio/water-levels`
   - **Repository permissions**: Actions, Read and write. Metadata, Read-only, is added for you. Nothing else.

   GitHub can't limit a token to some workflows, so whoever holds it can start any workflow on `main`, Ingest with any arguments included, or cancel runs. Keep it only in the Worker's secret.

   If the org requires approval for fine-grained tokens, approve it under the org's Settings, Personal access tokens, Pending requests.

2. Log in to Cloudflare with Wrangler, from this directory:

   ```bash
   cd workers/cron
   ```

   ```bash
   npx wrangler@4 login
   ```

3. Deploy the Worker. It is named `water-levels-cron` and has no URL:

   ```bash
   npx wrangler@4 deploy
   ```

   If Wrangler asks which account, choose the one that holds the `water-levels` bucket.

4. Store the token as the Worker's secret, pasting it when asked:

   ```bash
   npx wrangler@4 secret put GITHUB_TOKEN
   ```

5. Check it works after the next `:12` past the hour. A run of Ingest hourly with the event `workflow_dispatch` should appear:

   ```bash
   gh run list --repo openwatersio/water-levels --workflow ingest-hourly.yml --event workflow_dispatch --limit 3
   ```

   The Worker's page in the Cloudflare dashboard lists each cron event under Settings, Triggers, and its log under Observability. A failed dispatch shows there with GitHub's response, such as `401 Bad credentials` for an expired token.

## Changing it

Redeploy with `npx wrangler@4 deploy` from this directory after changing the crons or `DISPATCHES`, keeping each Worker cron a few minutes before the workflow's own schedule. A cron that starts a workflow at the same minute as its schedule races it, and the two may both run.

## Turning it off

The workflows' schedules keep running without the Worker. Delete it from this directory, then delete the token in GitHub's settings:

```bash
npx wrangler@4 delete
```

Do this before reverting the workflows' checks for a dispatched run, or every hour runs twice.

## Replacing the token

Create a new token as in step 1, then run `npx wrangler@4 secret put GITHUB_TOKEN` again. The Worker uses it from its next cron.
