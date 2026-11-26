import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConstants, ttMinusUtc } from "../src/sources/kartverket/constants.ts";

const answer = (
  constituents: string,
  head = 'unit="cm" utcoffset="+01:00"',
  observations = true,
) => `<tide>
<constituents ${head}>
<location name="Stavanger" code="SVG" longitude="5.730121" latitude="58.974339"/>
${observations ? '<observations start="2006-01-01T00:00:00+01:00" end="2020-12-31T23:00:00+01:00"/>' : ""}
${constituents}
</constituents>
</tide>`;
const SA =
  '<constituent name="SA" amplitude="10.15" phaseangle="309.11" speed="0.04106668" doodson="ZZAZZYZ"/>';
const M2 =
  '<constituent name="M2" amplitude="14.00" phaseangle="270.00" speed="28.98410422" doodson="BZZZZZZ"/>';
const H1 =
  '<constituent name="H1" amplitude="0.20" phaseangle="10.00" speed="28.94303756" doodson="BZYZZAA"/>';

describe("ttMinusUtc", () => {
  it("is 32.184 s and the leap seconds in force, averaged over the period", () => {
    assert.equal(ttMinusUtc(Date.UTC(2007, 0, 1), Date.UTC(2008, 0, 1)), 32.184 + 33);
    assert.equal(ttMinusUtc(Date.UTC(2018, 0, 1), Date.UTC(2020, 0, 1)), 32.184 + 37);
    // Half a year at 34 s and half at 35 s.
    const mixed = ttMinusUtc(Date.UTC(2012, 0, 1), Date.UTC(2013, 0, 1));
    assert.ok(mixed > 32.184 + 34.4 && mixed < 32.184 + 34.6, `${mixed}`);
    const kartverket = ttMinusUtc(Date.UTC(2005, 11, 31, 23), Date.UTC(2020, 11, 31, 23));
    assert.ok(Math.abs(kartverket - 67.18) < 0.01, `${kartverket}`);
  });

  it("refuses a period the table doesn't cover", () => {
    assert.throws(() => ttMinusUtc(Date.UTC(1990, 0, 1), Date.UTC(2000, 0, 1)), /leap seconds/);
    assert.throws(() => ttMinusUtc(Date.UTC(2010, 0, 1), Date.UTC(2010, 0, 1)), /leap seconds/);
  });
});

describe("parseConstants", () => {
  it("reads amplitudes in meters, phases in UTC and the period analyzed", () => {
    const { period, latitude, constants } = parseConstants("SVG", answer(SA + M2 + H1));
    assert.equal(period.start, Date.UTC(2005, 11, 31, 23));
    // The end names the period's last hour.
    assert.equal(period.end, Date.UTC(2020, 11, 31, 23));
    assert.equal(latitude, 58.974339);
    assert.deepEqual(
      constants.map((c) => [c.published, c.name]),
      [
        ["SA", "SA_KV"],
        ["M2", "M2"],
        ["H1", "alpha2"],
      ],
    );
    const m2 = constants[1]!;
    assert.ok(Math.abs(m2.amplitude - 0.14) < 1e-12);
    // One hour and about 67 s of M2's 28.984° an hour.
    const hours = 1 + ttMinusUtc(period.start, period.end) / 3600;
    assert.ok(Math.abs(m2.phase - (270 - 28.98410422 * hours)) < 1e-9, `${m2.phase}`);
    assert.ok(m2.phase > 240.4 && m2.phase < 240.5);
  });

  it("keeps a phase from 0 to 360", () => {
    const low =
      '<constituent name="M2" amplitude="14.00" phaseangle="5.00" speed="28.98410422" doodson="BZZZZZZ"/>';
    const { constants } = parseConstants("SVG", answer(low));
    assert.ok(constants[0]!.phase > 335 && constants[0]!.phase < 336, `${constants[0]!.phase}`);
  });

  it("refuses an answer it can't compare", () => {
    assert.throws(() => parseConstants("SVG", "<tide><error>no</error></tide>"), /<constituents>/);
    assert.throws(
      () => parseConstants("SVG", answer(M2, 'unit="m" utcoffset="+01:00"')),
      /centimeters/,
    );
    assert.throws(
      () => parseConstants("SVG", answer(M2, 'unit="cm" utcoffset="+00:00"')),
      /UTC\+1/,
    );
    assert.throws(() => parseConstants("SVG", answer(M2, undefined, false)), /period/);
    assert.throws(() => parseConstants("SVG", answer("")), /empty/);
    assert.throws(() => parseConstants("SVG", answer(M2 + M2)), /twice/);
    const unknown =
      '<constituent name="XYZ9" amplitude="1.00" phaseangle="5.00" speed="33.3" doodson="B"/>';
    assert.throws(() => parseConstants("SVG", answer(unknown)), /XYZ9/);
    // A known name at another line's speed isn't that constituent.
    const moved =
      '<constituent name="M2" amplitude="14.00" phaseangle="5.00" speed="30.0" doodson="B"/>';
    assert.throws(() => parseConstants("SVG", answer(moved)), /catalog doesn't have/);
    const broken =
      '<constituent name="M2" amplitude="x" phaseangle="5.00" speed="28.98410422" doodson="B"/>';
    assert.throws(() => parseConstants("SVG", answer(broken)), /isn't a number/);
  });
});
