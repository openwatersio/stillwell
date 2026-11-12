import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Flag } from "../src/schema.ts";
import { clickhouse, migrate, observationStore } from "../src/realtime/clickhouse.ts";

const HOUR = 3_600_000;
// Recent enough for the table's 8-day TTL.
const NOW = Math.floor(Date.now() / HOUR) * HOUR;

// Runs against a real ClickHouse only when CLICKHOUSE_URL names one, as CI's service does.
describe("ObservationStore on ClickHouse", { skip: !process.env.CLICKHOUSE_URL }, () => {
  it("reads back what it wrote, the latest version of each value", async () => {
    const ch = clickhouse(`stillwell_test_${process.pid}`);
    await migrate(ch);
    try {
      const store = observationStore(ch);
      const a = "test/a,b'c"; // characters a parameter must carry intact
      await store.write(
        [
          {
            station: a,
            epoch: 1,
            time: NOW - 2 * HOUR,
            level: 1.234,
            flag: Flag.preliminary,
            received: NOW,
          },
          { station: a, epoch: 1, time: NOW - HOUR, level: 2, flag: Flag.preliminary },
          {
            station: "test/b",
            epoch: 2,
            time: NOW - HOUR,
            level: 3,
            flag: Flag.good,
            source_flag: Flag.good,
          },
        ],
        1,
      );
      await store.write(
        [{ station: a, epoch: 1, time: NOW - HOUR, level: 2.5, flag: Flag.suspect, received: NOW }],
        2,
      );
      assert.deepEqual(await store.read([a, "test/b"], NOW - 3 * HOUR), [
        {
          station: a,
          epoch: 1,
          time: NOW - 2 * HOUR,
          level: 1.234, // ClickHouse prints a Float32 as its shortest decimal
          flag: Flag.preliminary,
          received: NOW,
        },
        { station: a, epoch: 1, time: NOW - HOUR, level: 2.5, flag: Flag.suspect, received: NOW },
        {
          station: "test/b",
          epoch: 2,
          time: NOW - HOUR,
          level: 3,
          flag: Flag.good,
          source_flag: Flag.good,
        },
      ]);
      assert.deepEqual((await store.stations("test")).sort(), [a, "test/b"].sort());
      assert.deepEqual(await store.stations("tes"), []);
      assert.deepEqual(await store.read([a], NOW - 90 * 60_000), [
        { station: a, epoch: 1, time: NOW - HOUR, level: 2.5, flag: Flag.suspect, received: NOW },
      ]);

      // A backslash and a tab in a single parameter, as `remove` and `stations` send them.
      const odd = "test/x\\y\tz";
      await store.write(
        [{ station: odd, epoch: 1, time: NOW - HOUR, level: 1, flag: Flag.good }],
        1,
      );
      assert.ok((await store.stations("test")).includes(odd));
      // And in a list parameter, as `read` and `removeStations` send them.
      assert.equal((await store.read([odd], 0)).length, 1);
      await store.remove([{ station: odd, time: NOW - HOUR }]);
      assert.deepEqual(await store.read([odd], 0), []);

      await store.remove([{ station: a, time: NOW - 2 * HOUR }]);
      await store.removeStations(["test/b"]);
      assert.deepEqual(
        (await store.read([a, "test/b"], 0)).map((r) => [r.station, r.time]),
        [[a, NOW - HOUR]],
      );
    } finally {
      await ch.exec(`DROP DATABASE IF EXISTS ${ch.database}`);
    }
  });
});
