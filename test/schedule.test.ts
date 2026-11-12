import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOCKED_MS, RETRY_MS, schedule, type PassResult } from "../src/realtime/schedule.ts";
import { emptySummary } from "../src/store/recent.ts";

const MINUTE = 60_000;

/**
 * Run `schedule` on a fake clock for `minutes`, answering each pass with
 * `answer`, and return each pass's time, groups and whether it seeded.
 */
async function simulate(
  minutes: number,
  answer: (call: number, now: number) => PassResult | Error,
  refreshes: number[] = [],
): Promise<{ at: number; due: number[] | null; seeding: boolean }[]> {
  let now = 0;
  const calls: { at: number; due: number[] | null; seeding: boolean }[] = [];
  await schedule({
    clock: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    stopped: () => now >= minutes * MINUTE,
    log: () => {},
    refresh: async () => {
      refreshes.push(now / MINUTE);
      return true;
    },
    pass: async (due, seeding, at) => {
      calls.push({ at: at / MINUTE, due, seeding });
      const result = answer(calls.length, at);
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return calls;
}

const ok = (intervals: number[]): PassResult => ({
  ok: true,
  summary: emptySummary("poll test", 1),
  intervals,
  seeded: true,
});

describe("schedule", () => {
  it("fetches every station first, then each group at its own interval", async () => {
    const calls = await simulate(13, () => ok([360, 600]));
    assert.deepEqual(
      calls.map((c) => [c.at, c.due]),
      [
        [0, null],
        [6, [360]],
        [10, [600]],
        [12, [360]],
      ],
    );
    // Only the first pass after a start seeds.
    assert.deepEqual(
      calls.map((c) => c.seeding),
      [true, false, false, false],
    );
  });

  it("waits for a group's interval after a failed pass, never sooner", async () => {
    const calls = await simulate(13, (call) =>
      call === 1 ? ok([360]) : { ...ok([360]), ok: false },
    );
    assert.deepEqual(
      calls.map((c) => c.at),
      [0, 6, 12],
    );
  });

  it("tries a failed first pass again after a few minutes, and seeds until one succeeds", async () => {
    const calls = await simulate(11, (call) => (call === 1 ? new Error("down") : ok([3600])));
    assert.deepEqual(
      calls.map((c) => [c.at, c.due, c.seeding]),
      [
        [0, null, true],
        [RETRY_MS / MINUTE, null, true],
      ],
    );
  });

  it("fetches a group new to the list at once", async () => {
    const calls = await simulate(8, (call) => ok(call === 1 ? [3600] : [3600, 60]));
    // The second pass runs at the hour; the 60-second group it reports runs a minute later.
    const late = await simulate(62, (call) => ok(call === 1 ? [3600] : [3600, 60]));
    assert.deepEqual(
      calls.map((c) => c.at),
      [0],
    );
    assert.deepEqual(
      late.slice(0, 3).map((c) => [c.at, c.due]),
      [
        [0, null],
        [60, [3600]],
        [60 + 5000 / MINUTE, [60]],
      ],
    );
  });

  it("rests a blocked source", async () => {
    const blocked = { ...emptySummary("poll test", 1), blocked: true };
    const calls = await simulate(BLOCKED_MS / MINUTE + 1, (call) =>
      call === 1 ? { ...ok([360]), summary: blocked } : ok([360]),
    );
    assert.deepEqual(
      calls.map((c) => c.at),
      [0, BLOCKED_MS / MINUTE],
    );
  });

  it("reads a list with nothing to poll again hourly, not every few seconds", async () => {
    const calls = await simulate(61, () => ok([]));
    assert.deepEqual(
      calls.map((c) => c.at),
      [0, 60],
    );
  });

  it("seeds again on the next pass when a seed failed", async () => {
    const calls = await simulate(13, (call) => ({ ...ok([360]), seeded: call > 1 }));
    assert.deepEqual(
      calls.map((c) => c.seeding),
      [true, true, false],
    );
  });

  it("starts a refresh for a datum change at most once a day", async () => {
    const refreshes: number[] = [];
    const changed = { ...emptySummary("poll test", 1), datumChanged: true };
    await simulate(25 * 60, () => ({ ...ok([3600]), summary: changed }), refreshes);
    assert.deepEqual(refreshes, [0, 24 * 60]);
  });
});
