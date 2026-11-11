// Starts the scheduled workflows through GitHub's workflow_dispatch API, since
// GitHub's own schedule runs them hours late or not at all. Each cron here is
// five minutes before the workflow's own schedule, which stays as a backup and
// skips itself when a dispatched run has already started.

export interface Env {
  GITHUB_TOKEN: string;
}

const REPO = "openwatersio/stillwell";

// Keys match the crons in wrangler.jsonc.
export const DISPATCHES: Record<string, { workflow: string; inputs?: Record<string, string> }> = {
  "12 * * * *": { workflow: "ingest-hourly.yml" },
  "40 0 * * *": { workflow: "compact-daily.yml", inputs: { days: "6" } },
  "25 1 2 * *": { workflow: "monthly.yml" },
  "35 3 9 * *": { workflow: "monthly.yml", inputs: { refetch: "true" } },
  // Named, since Cloudflare numbers weekdays from Sunday = 1 and GitHub from Sunday = 0.
  "0 7 * * MON": { workflow: "canary.yml" },
};

export default {
  async scheduled(controller: { cron: string }, env: Env): Promise<void> {
    const dispatch = DISPATCHES[controller.cron];
    if (!dispatch) throw new Error(`No workflow for cron "${controller.cron}"`);
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${dispatch.workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "water-levels-cron",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main", inputs: dispatch.inputs ?? {} }),
      },
    );
    // Thrown, the failure shows in the Worker's cron events and logs.
    if (!response.ok) {
      throw new Error(
        `Dispatching ${dispatch.workflow}: ${response.status} ${await response.text()}`,
      );
    }
    console.log(`Dispatched ${dispatch.workflow}`);
  },
};
