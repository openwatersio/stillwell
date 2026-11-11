import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convert,
  currentEpoch,
  epochKey,
  firstEpochs,
  localDay,
  nextEpochs,
  recentWindow,
  type EpochOptions,
} from "../src/epochs.ts";
import type { Epoch } from "../src/schema.ts";

const options = (fields: Partial<EpochOptions> = {}): EpochOptions => ({
  station: "x/1",
  now: "2027-06-01T00:00:00Z",
  offsets: [0, 0],
  decisions: {},
  ...fields,
});

const epoch = (fields: Partial<Epoch> = {}): Epoch => ({
  id: 1,
  datum: "PNP",
  since: null,
  until: null,
  seen: "2027-05-01T00:00:00Z",
  reference: null,
  reference_since: null,
  datums: {},
  to_current: 0,
  state: "open",
  ...fields,
});

describe("localDay", () => {
  it("gives the instants a local day surely starts after and ends before", () => {
    // US Central and Eastern: local midnight is 04:00 to 06:00 UTC.
    assert.deepEqual(
      localDay("2015-06-29", [-6, -4]).map((t) => new Date(t).toISOString()),
      ["2015-06-29T04:00:00.000Z", "2015-06-30T06:00:00.000Z"],
    );
    assert.throws(() => localDay("June 2015", [0, 0]), /Not a date/);
  });
});

describe("firstEpochs", () => {
  it("gives a source whose history comes in today's reference a first epoch with no start", () => {
    const fetched = {
      datum: "PNP",
      datums: {},
      reference: { id: "2019-11-01", since: "2019-11-02" },
    };
    const [epoch] = firstEpochs(fetched, { ...options(), station: "x/1", archive: "current" });
    // The reference keeps its date, so a later change before it is still held.
    assert.deepEqual([epoch!.since, epoch!.reference_since], [null, "2019-11-02T00:00:00Z"]);
  });

  it("keeps the start of a zero dated ahead, even when the source's history is in today's reference", () => {
    const fetched = {
      datum: "PNP",
      datums: {},
      reference: { id: "2027-07-01", since: "2027-07-02" },
    };
    const [epoch] = firstEpochs(fetched, { ...options(), station: "x/1", archive: "current" });
    assert.equal(epoch!.since, "2027-07-02T00:00:00Z");
  });

  it("starts where the source says the reference does, with USACE's 06:00 boundary", () => {
    const [first] = firstEpochs(
      { datum: "GZ", datums: {}, reference: { id: "2015-06-29", since: "2015-06-29" } },
      options({ offsets: [-6, -4] }),
    );
    assert.equal(first!.since, "2015-06-29T06:00:00Z");
    assert.equal(first!.reference, "2015-06-29");
  });
});

describe("nextEpochs", () => {
  it("carries the current epoch forward, and only a named datum counts as seen", () => {
    const seen = nextEpochs([epoch()], { datum: "PNP", datums: { NHN: 1 } }, options());
    assert.equal(seen.event, null);
    assert.deepEqual([seen.epochs[0]!.seen, seen.epochs[0]!.datums], [options().now, { NHN: 1 }]);
    const unsaid = nextEpochs([epoch()], { datum: null, datums: {} }, options());
    assert.equal(unsaid.epochs[0]!.seen, "2027-05-01T00:00:00Z");
  });

  it("opens an epoch when the label changes, after the old one was last seen", () => {
    const { epochs, event } = nextEpochs(
      [epoch({ datums: { NN: 5 } })],
      { datum: "NN", datums: {} },
      options(),
    );
    assert.equal(event, "opened");
    assert.deepEqual(
      epochs.map((e) => [e.id, e.datum, e.since, e.until, e.state, e.to_current]),
      [
        [1, "PNP", null, "2027-05-01T00:00:00Z", "closed", 5],
        [2, "NN", "2027-06-01T00:00:00Z", null, "open", 0],
      ],
    );
  });

  it("opens an epoch for a moved zero under the same label, leaving out the day before", () => {
    const { epochs, event } = nextEpochs(
      [epoch({ reference: "2019-11-01", datums: { NHN: 1 } })],
      { datum: "PNP", datums: { NHN: 0.8 }, reference: { id: "2026-03-10", since: "2026-03-11" } },
      options(),
    );
    assert.equal(event, "opened");
    assert.deepEqual(
      epochs.map((e) => [e.since, e.until, e.datums, e.to_current]),
      [
        // Frozen with the old offsets, and a same-label change never converts on its own.
        [null, "2026-03-10T00:00:00Z", { NHN: 1 }, null],
        ["2026-03-11T00:00:00Z", null, { NHN: 0.8 }, 0],
      ],
    );
  });

  it("records a reference the first time it sees one, rather than call it a change", () => {
    const { epochs, event } = nextEpochs(
      [epoch()],
      { datum: "PNP", datums: {}, reference: { id: "2019-11-01", since: "2019-11-02" } },
      options(),
    );
    assert.equal(event, null);
    assert.deepEqual(
      [epochs[0]!.since, epochs[0]!.reference, epochs[0]!.reference_since],
      [null, "2019-11-01", "2019-11-02T00:00:00Z"],
    );
    // An epoch with no start still holds a change dated before its reference's.
    const back = nextEpochs(
      epochs,
      { datum: "PNP", datums: {}, reference: { id: "2019-10-01", since: "2019-10-02" } },
      options(),
    );
    assert.deepEqual(
      [back.event, back.reason],
      ["held", "starts no later than the epoch before it"],
    );
  });

  it("doesn't take a reference first seen with a date ahead as epoch 1's own", () => {
    const fetched = {
      datum: "PNP",
      datums: {},
      reference: { id: "2027-07-01", since: "2027-07-02" },
    };
    const early = nextEpochs(
      [epoch({ datums: { NN: 5.2 } })],
      { ...fetched, datums: { NN: 4.9 } },
      options(),
    );
    // Nor its offsets, which may already be the new zero's.
    assert.deepEqual(
      [early.event, early.epochs[0]!.reference, early.epochs[0]!.datums],
      [null, null, { NN: 5.2 }],
    );
    // Once its day has come, it's a change held for a decision.
    const later = nextEpochs(early.epochs, fetched, options({ now: "2027-07-03T00:00:00Z" }));
    assert.equal(later.event, "held");
  });

  it("holds a reference first seen with a recent date, for a decision", () => {
    const fetched = {
      datum: "PNP",
      datums: {},
      reference: { id: "2027-03-01", since: "2027-03-02" },
    };
    const held = nextEpochs([epoch()], fetched, options());
    assert.equal(held.event, "held");
    assert.match(held.reason!, /first seen within 180 days/);
    const key = epochKey("x/1", "2027-03-02T00:00:00Z");

    const confirmed = nextEpochs(held.epochs, fetched, {
      ...options(),
      decisions: { [key]: { confirm: true, note: "moved then" } },
    });
    assert.deepEqual(
      confirmed.epochs.map((e) => [e.since, e.until, e.reference, e.state]),
      [
        [null, "2027-03-01T00:00:00Z", null, "closed"],
        ["2027-03-02T00:00:00Z", null, "2027-03-01", "open"],
      ],
    );

    // Rejected, it's epoch 1's own reference after all, and stops coming up.
    const decisions = { [key]: { reject: true, note: "it moved years ago" } };
    const rejected = nextEpochs(held.epochs, fetched, { ...options(), decisions });
    const quiet = nextEpochs(rejected.epochs, fetched, { ...options(), decisions });
    assert.deepEqual(
      [quiet.event, quiet.epochs[0]!.reference, quiet.epochs[0]!.state],
      [null, "2027-03-01", "open"],
    );
  });

  it("holds a change soon after the last one, or back to an earlier label", () => {
    const two = [
      epoch({ state: "closed", until: "2027-01-01T00:00:00Z" }),
      epoch({ id: 2, datum: "NN", since: "2027-01-02T00:00:00Z" }),
    ];
    const soon = nextEpochs(two, { datum: "MSL", datums: {} }, options());
    assert.deepEqual(
      [soon.event, soon.reason],
      ["held", "comes within 180 days of the last change"],
    );
    assert.deepEqual(
      soon.epochs.map((e) => [e.id, e.state, e.to_current]),
      [
        [1, "closed", null],
        [2, "open", 0],
        [3, "held", null],
      ],
    );
    const later = options({ now: "2028-06-01T00:00:00Z" });
    const back = nextEpochs(two, { datum: "PNP", datums: {} }, later);
    assert.deepEqual([back.event, back.reason], ["held", "returns to an earlier reference"]);
    // A held station takes no more changes until a decision, and says so each time.
    const again = nextEpochs(back.epochs, { datum: "MSL", datums: {} }, later);
    assert.deepEqual([again.epochs.length, again.event], [3, "waiting"]);
  });

  it("confirms or rejects a held epoch by decision", () => {
    const now = "2027-06-01T00:00:00Z";
    const held = nextEpochs(
      [epoch({ since: "2027-03-01T00:00:00Z" })],
      { datum: "NN", datums: {} },
      options({ now }),
    ).epochs;
    const key = epochKey("x/1", now);
    const confirmed = nextEpochs(
      held,
      { datum: "NN", datums: {} },
      options({ decisions: { [key]: { confirm: true, note: "" } } }),
    );
    assert.equal(confirmed.event, "confirmed");
    assert.deepEqual(
      confirmed.epochs.map((e) => e.state),
      ["closed", "open"],
    );
    const rejected = nextEpochs(
      held,
      { datum: "NN", datums: {} },
      options({ decisions: { [key]: { reject: true, note: "" } } }),
    );
    assert.deepEqual(
      rejected.epochs.map((e) => [e.state, e.until]),
      [
        ["open", null],
        ["rejected", null],
      ],
    );
    // The source still reporting the rejected label opens nothing more.
    const after = nextEpochs(
      rejected.epochs,
      { datum: "NN", datums: {} },
      options({ decisions: { [key]: { reject: true, note: "" } } }),
    );
    assert.deepEqual([after.event, after.epochs.length], ["ignored", 2]);
  });

  it("reads a rejected epoch's files as the one before it", () => {
    const opened = nextEpochs(
      [epoch({ datums: { NN: 5 } })],
      { datum: "NN", datums: {} },
      options(),
    ).epochs;
    const key = epochKey("x/1", opened[1]!.since);
    const undone = nextEpochs(
      opened,
      { datum: "NN", datums: {} },
      options({ decisions: { [key]: { reject: true, note: "an adapter bug" } } }),
    );
    assert.deepEqual(
      undone.epochs.map((e) => [e.id, e.state, e.until, e.to_current]),
      [
        [1, "open", null, 0],
        [2, "rejected", null, 0],
      ],
    );
    assert.equal(currentEpoch(undone.epochs).id, 1);
  });

  it("opens a second same-label reset like the first, not as a change back", () => {
    const one = nextEpochs(
      [epoch({ reference: "2015-01-01" })],
      { datum: "GZ", datums: {}, reference: { id: "2016-01-01", since: "2016-01-01" } },
      options({ now: "2016-02-01T00:00:00Z" }),
    ).epochs;
    const two = nextEpochs(
      one.map((e) => ({ ...e, datum: "GZ" })),
      { datum: "GZ", datums: {}, reference: { id: "2027-01-01", since: "2027-01-01" } },
      options(),
    );
    assert.deepEqual(
      [two.event, two.epochs.map((e) => e.state)],
      ["opened", ["closed", "closed", "open"]],
    );
  });

  it("waits for a change dated ahead until its day has come", () => {
    const ahead = {
      datum: "PNP",
      datums: {},
      reference: { id: "2027-08-01", since: "2027-08-02" },
    };
    const before = nextEpochs([epoch({ reference: "2019-11-01" })], ahead, options());
    assert.deepEqual([before.event, before.epochs.length], [null, 1]);
    const after = nextEpochs(before.epochs, ahead, options({ now: "2027-08-03T00:00:00Z" }));
    assert.equal(after.event, "opened");
  });

  it("refuses a change that starts before the current epoch", () => {
    const { event, reason } = nextEpochs(
      [epoch({ since: "2026-04-01T00:00:00Z", reference: "2026-03-31" })],
      { datum: "PNP", datums: {}, reference: { id: "2025-01-01", since: "2025-01-02" } },
      options(),
    );
    assert.deepEqual([event, reason], ["held", "starts no later than the epoch before it"]);
  });

  it("ends the old epoch earlier when a decision says when it last held", () => {
    const since = "2019-04-01";
    const key = epochKey("x/1", "2019-04-01T00:00:00Z");
    const { epochs } = nextEpochs(
      [epoch({ reference: "2000-01-01" })],
      { datum: "PNP", datums: {}, reference: { id: since, since } },
      options({
        decisions: { [key]: { until: "2019-02-28", note: "sometime during March 2019" } },
      }),
    );
    assert.equal(epochs[0]!.until, "2019-03-01T00:00:00Z");
  });

  it("gives every new epoch an id above the files already in the store", () => {
    const { epochs } = nextEpochs([epoch()], { datum: "NN", datums: {} }, options({ nextId: 5 }));
    assert.equal(epochs[1]!.id, 5);
  });
});

describe("nextEpochs, with decisions", () => {
  const now = "2027-06-01T00:00:00Z";
  const recent = () => [epoch({ since: "2027-03-01T00:00:00Z" })];

  it("leaves the open epoch's end alone while a change is held, and sets it on confirming", () => {
    const held = nextEpochs(recent(), { datum: "NN", datums: {} }, options({ now })).epochs;
    assert.deepEqual(
      held.map((e) => [e.state, e.until]),
      [
        ["open", null],
        ["held", "2027-05-01T00:00:00Z"],
      ],
    );
    const key = epochKey("x/1", now);
    const confirmed = nextEpochs(
      held,
      { datum: "NN", datums: {} },
      options({ decisions: { [key]: { confirm: true, note: "" } } }),
    ).epochs;
    assert.deepEqual(
      confirmed.map((e) => [e.state, e.until]),
      [
        ["closed", "2027-05-01T00:00:00Z"],
        ["open", null],
      ],
    );
  });

  it("ends the epoch before earlier when a decision says so after the change", () => {
    const opened = nextEpochs([epoch()], { datum: "NN", datums: {} }, options({ now })).epochs;
    const key = epochKey("x/1", now);
    const { epochs } = nextEpochs(
      opened,
      { datum: "NN", datums: {} },
      options({ decisions: { [key]: { until: "2027-04-15", note: "last good survey" } } }),
    );
    assert.equal(epochs[0]!.until, "2027-04-16T00:00:00Z");
  });

  it("takes a fixed adapter and the rejection of its wrong epoch in one refresh", () => {
    const wrong = nextEpochs([epoch()], { datum: "NN", datums: {} }, options({ now })).epochs;
    const key = epochKey("x/1", now);
    const { epochs, event } = nextEpochs(
      wrong,
      { datum: "PNP", datums: {} },
      options({ now: "2027-07-01T00:00:00Z", decisions: { [key]: { reject: true, note: "" } } }),
    );
    assert.equal(event, "rejected");
    assert.deepEqual(
      epochs.map((e) => [e.datum, e.state]),
      [
        ["PNP", "open"],
        ["NN", "rejected"],
      ],
    );
  });

  it("can't reject the first epoch, which has nothing to fall back on", () => {
    const { epochs } = nextEpochs(
      [epoch()],
      { datum: "PNP", datums: {} },
      options({ decisions: { [epochKey("x/1", null)]: { reject: true, note: "" } } }),
    );
    assert.equal(epochs[0]!.state, "open");
  });
});

describe("nextEpochs, with splits", () => {
  const split = (...days: string[]) => ({
    "x/1": days.map((since) => ({ since, note: "the zero moved" })),
  });

  it("splits the epoch spanning the day, and converts the earlier one by a decision", () => {
    const decisions = { [epochKey("x/1", null)]: { to_current: 1.35, note: "measured" } };
    const { epochs, event, reason } = nextEpochs(
      [epoch()],
      { datum: "PNP", datums: {} },
      options({ splits: split("2020-03-06"), decisions }),
    );
    assert.equal(event, "opened");
    assert.match(reason!, /2020-03-06/);
    assert.deepEqual(
      epochs.map((e) => [e.id, e.since, e.until, e.state, e.to_current]),
      [
        [1, null, "2020-03-06T00:00:00Z", "closed", 1.35],
        [2, "2020-03-06T00:00:00Z", null, "open", 0],
      ],
    );
    // A second refresh finds the split made and changes nothing.
    const again = nextEpochs(
      epochs,
      { datum: "PNP", datums: {} },
      options({ splits: split("2020-03-06"), decisions }),
    );
    assert.equal(again.event, null);
    assert.equal(again.epochs.length, 2);
  });

  it("splits at several days in one refresh, leaving the middle unconverted without a decision", () => {
    const { epochs } = nextEpochs(
      [epoch()],
      { datum: "PNP", datums: {} },
      options({ splits: split("2006-01-09", "1997-02-28", "2023-03-10") }),
    );
    assert.deepEqual(
      epochs.map((e) => [
        e.id,
        e.since?.slice(0, 10) ?? null,
        e.until?.slice(0, 10) ?? null,
        e.state,
        e.to_current,
      ]),
      [
        [1, null, "1997-02-28", "closed", null],
        [2, "1997-02-28", "2006-01-09", "closed", null],
        [3, "2006-01-09", "2023-03-10", "closed", null],
        [4, "2023-03-10", null, "open", 0],
      ],
    );
    assert.equal(currentEpoch(epochs).id, 4);
  });

  it("keeps the source's reference, so its next refresh sees no change", () => {
    const first = nextEpochs(
      [epoch({ reference: "B" })],
      { datum: "PNP", datums: {}, reference: { id: "B", since: null } },
      options({ splits: split("2020-03-06") }),
    );
    assert.equal(first.epochs.at(-1)!.reference, "B");
    const next = nextEpochs(
      first.epochs,
      { datum: "PNP", datums: {}, reference: { id: "B", since: null } },
      options({ splits: split("2020-03-06") }),
    );
    assert.equal(next.event, null);
    assert.equal(next.epochs.length, 2);
  });

  it("never splits before an epoch's start, so ids stay in time order", () => {
    const first = nextEpochs(
      [epoch()],
      { datum: "PNP", datums: {} },
      options({ splits: split("2020-03-06") }),
    );
    const later = nextEpochs(
      first.epochs,
      { datum: "PNP", datums: {} },
      options({ splits: split("2020-03-06", "2015-01-01") }),
    );
    assert.equal(later.event, null);
    assert.deepEqual(
      later.epochs.map((e) => e.id),
      [1, 2],
    );
  });

  it("waits while the station is held", () => {
    const fetched = { datum: "PNP", datums: {}, reference: { id: "R", since: "2027-03-02" } };
    const held = nextEpochs([epoch()], fetched, options());
    assert.equal(held.event, "held");
    const split_ = nextEpochs(held.epochs, fetched, options({ splits: split("2027-04-01") }));
    assert.equal(split_.epochs.length, held.epochs.length);
    assert.equal(split_.event, "waiting");
  });

  it("waits for a day ahead", () => {
    const { epochs, event } = nextEpochs(
      [epoch()],
      { datum: "PNP", datums: {} },
      options({ splits: split("2028-01-01") }),
    );
    assert.equal(event, null);
    assert.equal(epochs.length, 1);
  });
});

describe("convert", () => {
  it("converts through a fixed reference, the epoch's own datum included", () => {
    assert.equal(convert(epoch({ datums: { NN: 5.2 } }), epoch({ datum: "NN" })), 5.2);
    assert.equal(
      convert(
        epoch({ datum: "MSL", datums: { NAP: 0.1 } }),
        epoch({ datum: "LAT", datums: { NAP: 1.2 } }),
      ),
      -1.1,
    );
  });

  it("never converts through a tidal datum, NAVD88 without its realization, or the same label", () => {
    assert.equal(
      convert(epoch({ datums: { MSL: 1 } }), epoch({ datum: "NN", datums: { MSL: 2 } })),
      null,
    );
    assert.equal(
      convert(epoch({ datums: { NAVD88: 1 } }), epoch({ datum: "NN", datums: { NAVD88: 2 } })),
      null,
    );
    assert.equal(
      convert(
        epoch({ datums: { "NAVD88(2009.55)": 1 } }),
        epoch({ datum: "STND", datums: { "NAVD88(2009.55)": 3 } }),
      ),
      -2,
    );
    assert.equal(convert(epoch({ datums: { NHN: 1 } }), epoch({ datums: { NHN: 2 } })), null);
    // NN and NHN are different height systems.
    assert.equal(convert(epoch({ datums: { NHN: 5 } }), epoch({ datum: "NN" })), null);
  });
});

describe("recentWindow", () => {
  it("splits rows by the current epoch's start, and never reaches before it", () => {
    const epochs = [
      epoch({ state: "closed", until: "2027-05-30T00:00:00Z" }),
      epoch({ id: 2, since: "2027-05-31T00:00:00Z" }),
    ];
    const at = (iso: string, e: number) => ({ time: Date.parse(iso), epoch: e });
    const rows = [
      at("2027-05-20T00:00:00Z", 1), // older than the window keeps
      at("2027-05-29T00:00:00Z", 1),
      at("2027-05-30T12:00:00Z", 2), // tagged epoch 2, but before it began
      at("2027-05-31T06:00:00Z", 2),
      at("2027-05-31T07:00:00Z", 1), // fetched before epoch 2 opened, back to its start
    ];
    const window = recentWindow(
      epochs,
      rows,
      Date.parse("2027-05-25T00:00:00Z"),
      Date.parse("2027-05-30T00:00:00Z"),
    );
    assert.deepEqual(window, {
      epoch: 2,
      from: Date.parse("2027-05-31T00:00:00Z"),
      other: [rows[1], rows[2]],
      current: [rows[3], { ...rows[4]!, epoch: 2 }],
    });
    // With no known start, fetching starts where the run asks.
    assert.equal(recentWindow([epoch()], [], 0, 5).from, 5);
  });
});

describe("an archive in the reference of its time", () => {
  const nap = { datum: "NAP", datums: {}, reference: { id: "NAP 2005", since: "2005-01-01" } };
  const opts = options({ station: "rws/a", archive: "previous" });

  it("splits a station's only epoch where the reference starts, once", () => {
    const first = nextEpochs([epoch({ datum: "NAP" })], nap, opts);
    assert.equal(first.event, "opened");
    assert.deepEqual(
      first.epochs.map((e) => [e.id, e.since, e.until, e.state, e.reference, e.to_current]),
      [
        // The old NAP converts to today's only by a decision.
        [1, null, "2005-01-01T00:00:00Z", "closed", null, null],
        [2, "2005-01-01T00:00:00Z", null, "open", "NAP 2005", 0],
      ],
    );
    const again = nextEpochs(first.epochs, nap, opts);
    assert.equal(again.event, null);
    assert.equal(again.epochs.length, 2);
  });

  it("only records the reference for a source whose archive is in today's reference", () => {
    const { epochs, event } = nextEpochs([epoch({ datum: "NAP" })], nap, options());
    assert.equal(event, null);
    assert.deepEqual(
      epochs.map((e) => [e.since, e.reference]),
      [[null, "NAP 2005"]],
    );
  });

  it("gives a new station both epochs", () => {
    const epochs = firstEpochs(nap, { ...opts, nextId: 3 });
    assert.deepEqual(
      epochs.map((e) => [e.id, e.since, e.until, e.state, e.to_current]),
      [
        [3, null, "2005-01-01T00:00:00Z", "closed", null],
        [4, "2005-01-01T00:00:00Z", null, "open", 0],
      ],
    );
  });
});
