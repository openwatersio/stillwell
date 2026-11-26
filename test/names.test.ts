import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sharesWord } from "../src/names.ts";

describe("sharesWord", () => {
  it("finds a word inside a run-together name", () => {
    assert.ok(sharesWord("KielHoltenauTG", "KIEL-HOLTENAU"));
  });

  it("matches German transliterations", () => {
    assert.ok(sharesWord("WarnemuendeTG", "WARNEMÜNDE"));
  });

  it("spells out letters that don't decompose", () => {
    assert.ok(sharesWord("Maloy", "Måløy"));
    assert.ok(sharesWord("Hornbaek", "Hornbæk"));
    assert.ok(sharesWord("Strasse", "Straße"));
  });

  it("reads aa as å, and as written", () => {
    assert.ok(sharesWord("HonningsvaagTG", "Honningsvåg"));
    assert.ok(sharesWord("Faaborg", "Fåborg Havn I"));
    assert.ok(sharesWord("Sint Andries, Waal", "Waal km 925.700 ro"));
  });

  it("matches a short name whose every word the other has", () => {
    assert.ok(sharesWord("PORT_DU_JAI", "PORT DU JAI"));
    assert.ok(sharesWord("Hov", "Hov Havn I"));
    assert.ok(sharesWord("NesTG", "Ameland, Nes"));
    assert.ok(!sharesWord("Port", "Port Ellen"));
    assert.ok(sharesWord("NESTG", "Ameland, Nes"));
    assert.ok(!sharesWord("Nes", "Nesttun"));
    assert.ok(!sharesWord("Haven 3", "Haven 3 Oost"));
    assert.ok(!sharesWord("De La", "Port de la Rochelle"));
    assert.ok(!sharesWord("Syd", "Kalundborg Syd"));
    assert.ok(!sharesWord("Dok 3", "Dok 3 Oost"));
    assert.ok(!sharesWord("Van", "Van Dyke Pier"));
  });

  it("ignores directions and harbor words", () => {
    assert.ok(!sharesWord("Rak noord", "Hollandsdiep noordwest"));
    assert.ok(!sharesWord("Oude haven", "Nieuwe haven"));
  });
});
