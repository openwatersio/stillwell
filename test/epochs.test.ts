import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convert,
  currentEpoch,
  epochKey,
  firstEpochs,
  localDay,
  nextEpochs,
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
  it("starts where the source says the reference does, with USACE's 06:00 boundary", () => {
    const [first] = firstEpochs(
      { datum: "GZ", datums: {}, reference: { id: "2015-06-29", since: "2015-06-29" } },
      options({ offsets: [-6, -4] }),
    );
    assert.equal(first!.since, "2015-06-29T04:00:00Z");
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
    assert.equal(epochs[0]!.reference, "2019-11-01");
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
    // A held station takes no more changes until a person decides.
    const again = nextEpochs(back.epochs, { datum: "MSL", datums: {} }, later);
    assert.equal(again.epochs.length, 3);
  });

  it("confirms or rejects a held epoch as a person decides", () => {
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
    assert.deepEqual([after.event, after.epochs.length], ["suppressed", 2]);
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

  it("refuses a change that starts before the current epoch", () => {
    const { event, reason } = nextEpochs(
      [epoch({ since: "2026-04-01T00:00:00Z", reference: "2026-03-31" })],
      { datum: "PNP", datums: {}, reference: { id: "2025-01-01", since: "2025-01-02" } },
      options(),
    );
    assert.deepEqual([event, reason], ["held", "starts no later than the epoch before it"]);
  });

  it("ends the old epoch earlier when a person says when it last held", () => {
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

  it("gives every new epoch an id above the files already in the lake", () => {
    const { epochs } = nextEpochs([epoch()], { datum: "NN", datums: {} }, options({ nextId: 5 }));
    assert.equal(epochs[1]!.id, 5);
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
