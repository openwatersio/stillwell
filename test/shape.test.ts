import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { drift, merge, shapeOf } from "../src/shape.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

const VALUE = "$.WaarnemingenLijst[].MetingenLijst[].Meetwaarde.Waarde_Numeriek";

describe("shapeOf", () => {
  it("gives every path in a JSON answer with the types seen there", () => {
    assert.deepEqual(shapeOf('{"data":[{"v":"1.2","f":null},{"v":"1.3","f":"0,0"}],"n":2}'), {
      $: "object",
      "$.data": "array",
      "$.data[]": "object",
      "$.data[].f": "null | string",
      "$.data[].v": "string",
      "$.n": "number",
    });
    assert.equal(shapeOf(fixture("rws-observations.json"))[VALUE], "number");
  });

  it("gives a BSH file's line codes", () => {
    const shape = shapeOf(fixture("DE__506P2026.txt"));
    assert.equal(shape["I_E"], "line");
    assert.equal(shape["VB2"], "line");
    assert.equal(shape["C05"], "line");
  });
});

describe("merge", () => {
  it("unions the paths and types of several answers", () => {
    assert.deepEqual(merge(shapeOf('{"a":1}'), shapeOf('{"a":null,"b":"x"}')), {
      $: "object",
      "$.a": "null | number",
      "$.b": "string",
    });
  });
});

describe("drift", () => {
  const recorded = shapeOf(fixture("rws-observations.json"));

  it("finds nothing in the same answer, or one that only adds a field", () => {
    assert.deepEqual(drift(recorded, recorded), []);
    const added = fixture("rws-observations.json").replace(
      '"Succesvol"',
      '"Nieuw": 1, "Succesvol"',
    );
    assert.deepEqual(drift(recorded, shapeOf(added)), []);
  });

  it("allows a null where the recording had a value", () => {
    assert.deepEqual(drift(shapeOf('{"v":1}'), shapeOf('{"v":null}')), []);
    assert.deepEqual(drift(shapeOf('{"o":{"a":1},"l":[1]}'), shapeOf('{"o":null,"l":null}')), []);
  });

  it("allows any type where the recording saw only null", () => {
    assert.deepEqual(drift(shapeOf('{"q":null}'), shapeOf('{"q":["ICE"]}')), []);
  });

  it("finds a renamed field", () => {
    const renamed = fixture("rws-observations.json").replaceAll("Waarde_Numeriek", "Waarde");
    assert.deepEqual(drift(recorded, shapeOf(renamed)), [`${VALUE} is missing (was number)`]);
  });

  it("finds a field that changed type", () => {
    const text = fixture("rws-observations.json").replace(
      /"Waarde_Numeriek": (-?[\d.]+)/g,
      '"Waarde_Numeriek": "$1"',
    );
    assert.deepEqual(drift(recorded, shapeOf(text)), [`${VALUE} is string (was number)`]);
  });

  it("finds a BSH file without its rows, or that stopped being a prediction file", () => {
    const bsh = fixture("DE__506P2026.txt");
    const rows = bsh
      .split("\n")
      .filter((l) => !l.startsWith("VB2"))
      .join("\n");
    assert.deepEqual(drift(shapeOf(bsh), shapeOf(rows)), ["VB2 is missing (was line)"]);
    assert.ok(drift(shapeOf(bsh), shapeOf("<html>Not found</html>")).length > 5);
  });
});
