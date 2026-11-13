import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { metricsText, readSaved, recordPass, startMetrics } from "../src/realtime/metrics.ts";
import { emptySummary } from "../src/store/recent.ts";

const ok = {
  ok: true,
  summary: { ...emptySummary("metrics test", 1), updated: 1 },
  intervals: [360, 0],
  seeded: true,
};

describe("pass metrics", () => {
  it("records a success, then counts failures and blocks without moving the last success", () => {
    let m = recordPass(undefined, 10_000, {
      ...ok,
      summary: {
        ...emptySummary("metrics test", 4),
        updated: 1,
        stale: ["a/1"],
        failed: ["a/2", "a/3"],
      },
    });
    assert.deepEqual(m, {
      lastEnd: 10_000,
      lastSuccess: 10_000,
      failures: 0,
      interval: 360,
      stale: 1,
      failed: 2,
    });
    m = recordPass(m, 20_000, null);
    m = recordPass(m, 30_000, {
      ...ok,
      summary: { ...emptySummary("metrics test", 1), updated: 1, blocked: true },
    });
    m = recordPass(m, 40_000, { ...ok, ok: false });
    // A pass that polled stations and stored nothing new isn't a success, however it ended.
    m = recordPass(m, 50_000, { ...ok, summary: emptySummary("metrics test", 2) });
    assert.deepEqual(m, {
      lastEnd: 50_000,
      lastSuccess: 10_000,
      failures: 4,
      interval: 360,
      stale: 1,
      failed: 2,
    });
  });

  it("counts a source with nothing to poll as succeeding, as it waits for its first list", () => {
    const m = recordPass(undefined, 7_000, {
      ...ok,
      summary: emptySummary("metrics test", 0),
      intervals: [],
    });
    assert.deepEqual([m.lastSuccess, m.failures], [7_000, 0]);
  });

  it("writes each source's series, and no last success before one", () => {
    const text = metricsText(
      new Map([
        ["usgs", recordPass(undefined, 5_000, null)],
        ["ea", recordPass(undefined, 2_000, ok)],
      ]),
    );
    assert.match(text, /^stillwell_pass_last_success_timestamp_seconds\{source="ea"\} 2$/m);
    assert.doesNotMatch(text, /last_success_timestamp_seconds\{source="usgs"\}/);
    assert.match(text, /^stillwell_pass_failures_total\{source="usgs"\} 1$/m);
    assert.match(text, /^stillwell_poll_interval_seconds\{source="usgs"\} 3600$/m);
    assert.match(text, /^# TYPE stillwell_pass_failures_total counter$/m);
  });

  it("keeps each source's last success and interval across a restart", () => {
    const text = metricsText(new Map([["ea", recordPass(undefined, 2_500, ok)]]));
    const saved = readSaved(text);
    assert.deepEqual([...saved], [["ea", { lastSuccess: 2_500, interval: 360 }]]);
    const ea = startMetrics(9_000, saved.get("ea"));
    assert.deepEqual([ea.lastSuccess, ea.interval], [2_500, 360]);
    // A source with nothing saved counts from the start, hourly.
    const usgs = startMetrics(9_000, saved.get("usgs"));
    assert.deepEqual([usgs.lastSuccess, usgs.interval], [9_000, 3600]);
  });
});
