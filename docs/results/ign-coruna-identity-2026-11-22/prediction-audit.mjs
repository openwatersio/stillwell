import { readFile, writeFile } from "node:fs/promises";
import { readStationList } from "../../../src/store/parquet.ts";
import { withDatums, tideStations, ticonOriginators } from "../../../src/datums.ts";
import { UNLINKS } from "../../../src/same-as.ts";
const [snapshot, readback, output] = process.argv.slice(2);
if (!output) throw new Error("Usage: node prediction-audit.mjs <public stations.parquet> <group-readback.json> <output.json>");
const all = await readStationList(snapshot);
const coruna = JSON.parse(await readFile(readback, "utf8")).publication.after;
const additions = new Map(coruna.map(s => [s.id, s]));
const rows = all.map(s => {
  const proposed = additions.get(s.id);
  additions.delete(s.id);
  return {...s, ...(proposed ? {same_as: proposed.same_as} : {}), tide_station: null};
});
rows.push(...[...additions.values()].map(s => ({...s,tide_station:null})));
const tide = await tideStations(), originators = await ticonOriginators();
const decisions = UNLINKS.splice(0);
let before;
try { before = withDatums(rows,tide,originators).stations; }
finally { UNLINKS.push(...decisions); }
const after = withDatums(rows,tide,originators).stations;
const previous = new Map(before.map(s => [s.id,s.tide_station]));
const changes = after.filter(s => s.tide_station !== previous.get(s.id)).map(s => ({id:s.id,before:previous.get(s.id),after:s.tide_station}));
const result = {method:"Replay only the prediction-alias guard over every published station plus IGN, using proposed Coruña groups; clear preexisting tide_station so publication can compute it. Other publication fields and grouping are held fixed. Before disables explicit separation decisions for this guard only.",stations:rows.length,changes};
await writeFile(output,JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
