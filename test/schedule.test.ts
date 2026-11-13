import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOCKED_MS,
  PassError,
  RETRY_MS,
  schedule,
  slots,
  type PassResult,
} from "../src/realtime/schedule.ts";
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
    pass: async (due, seeding) => {
      const at = now;
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

  it("waits an hour to try a refresh again when it couldn't start one", async () => {
    let now = 0;
    const refreshes: number[] = [];
    const changed = { ...emptySummary("poll test", 1), datumChanged: true };
    await schedule({
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      stopped: () => now >= 150 * MINUTE,
      log: () => {},
      refresh: async () => {
        refreshes.push(now / MINUTE);
        return false;
      },
      pass: async () => ({ ...ok([360]), summary: changed }),
    });
    assert.deepEqual(refreshes, [0, 60, 120]);
  });

  it("counts intervals from when a pass began, after a wait for a slot, and rests from when it ended", async () => {
    let now = 0;
    const calls: number[] = [];
    const blocked = { ...emptySummary("poll test", 1), blocked: true };
    await schedule({
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      stopped: () => now >= 120 * MINUTE,
      log: () => {},
      refresh: async () => true,
      pass: async () => {
        // Each pass waits 20 minutes for a slot, then runs 5.
        now += 20 * MINUTE;
        calls.push(now / MINUTE);
        const started = now;
        now += 5 * MINUTE;
        return calls.length === 1
          ? { ...ok([360]), started }
          : { ...ok([360]), summary: blocked, started };
      },
    });
    // The second pass is asked for at minute 26, after the first's interval from when it began (20),
    // and runs from 46 to 51; its block rests the source an hour from then, and the next waits until 131.
    assert.deepEqual(calls, [20, 46, 131]);
  });

  it("retries a failed pass that waited for a slot after it ended", async () => {
    let now = 0;
    const calls: number[] = [];
    await schedule({
      clock: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      stopped: () => now >= 60 * MINUTE,
      log: () => {},
      refresh: async () => true,
      pass: async () => {
        // The first pass waits 30 minutes for a slot, then is stopped 10 minutes in.
        if (!calls.length) {
          now += 30 * MINUTE;
          calls.push(now / MINUTE);
          const started = now;
          now += 10 * MINUTE;
          throw new PassError("killed", started);
        }
        calls.push(now / MINUTE);
        return ok([3600]);
      },
    });
    // Tried again RETRY_MS after it ended (40), not at once, as counting from when it was asked (0) would.
    assert.deepEqual(calls, [30, 40 + RETRY_MS / MINUTE]);
  });

  it("reads the list again hourly once the source has nothing left to poll", async () => {
    const calls = await simulate(70, (call) => ok(call === 1 ? [360] : []));
    assert.deepEqual(
      calls.map((c) => [c.at, c.due]),
      [
        [0, null],
        [6, [360]],
        [66, null],
      ],
    );
  });
});

describe("slots", () => {
  it("lets at most n hold a slot, and hands each freed one to the next in line", async () => {
    const pool = slots(2);
    const order: string[] = [];
    let holding = 0;
    let most = 0;
    const hold = async (name: string, release: Promise<void>) => {
      await pool.acquire();
      holding++;
      most = Math.max(most, holding);
      order.push(name);
      await release;
      holding--;
      pool.release();
    };
    let free!: () => void;
    const first = new Promise<void>((resolve) => (free = resolve));
    const all = Promise.all([
      hold("a", first),
      hold("b", Promise.resolve()),
      hold("c", Promise.resolve()),
      hold("d", Promise.resolve()),
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    free();
    await all;
    assert.equal(most, 2);
    assert.deepEqual(order, ["a", "b", "c", "d"]);
  });
});
