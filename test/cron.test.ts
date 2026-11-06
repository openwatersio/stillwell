import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, mock, test } from "node:test";
import { parse } from "yaml";
import worker, { DISPATCHES } from "../workers/cron/index.ts";

afterEach(() => mock.restoreAll());

test("every Worker cron dispatches a workflow on main", async () => {
  // wrangler.jsonc less its comment lines is YAML, trailing commas and all.
  const jsonc = readFileSync("workers/cron/wrangler.jsonc", "utf8");
  const config = parse(jsonc.replace(/^\s*\/\/.*$/gm, ""));
  assert.deepEqual(config.triggers.crons.toSorted(), Object.keys(DISPATCHES).toSorted());

  const calls: { url: string; body: unknown; auth: string }[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url, body: JSON.parse(init.body as string), auth: headers.Authorization });
    return new Response(null, { status: 204 });
  });
  await worker.scheduled({ cron: "35 3 9 * *" }, { GITHUB_TOKEN: "t" });
  assert.deepEqual(calls, [
    {
      url: "https://api.github.com/repos/openwatersio/water-levels/actions/workflows/monthly.yml/dispatches",
      body: { ref: "main", inputs: { refetch: "true" } },
      auth: "Bearer t",
    },
  ]);
});

test("each Worker cron runs five minutes before its workflow's backup schedule", () => {
  for (const [cron, { workflow, inputs = {} }] of Object.entries(DISPATCHES)) {
    const on = parse(readFileSync(`.github/workflows/${workflow}`, "utf8")).on;
    const declared = Object.keys(on.workflow_dispatch?.inputs ?? {});
    for (const input of Object.keys(inputs))
      assert.ok(declared.includes(input), `${cron}: ${input}`);
    const [minute, ...rest] = cron.split(" ");
    const backup = [Number(minute) + 5, ...rest].join(" ");
    assert.ok(
      on.schedule.some((s: { cron: string }) => s.cron === backup),
      `${workflow} has no schedule ${backup}`,
    );
  }
});

test("a refused dispatch fails the cron event", async () => {
  mock.method(globalThis, "fetch", async () => new Response("Bad credentials", { status: 401 }));
  await assert.rejects(
    worker.scheduled({ cron: "12 * * * *" }, { GITHUB_TOKEN: "t" }),
    /ingest-hourly\.yml: 401 Bad credentials/,
  );
});
