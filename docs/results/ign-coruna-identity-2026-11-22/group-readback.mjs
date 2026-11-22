import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_AGENT } from "../../../src/http.ts";
import { CORUNA_GAUGES, linkGauges } from "../../../src/same-as.ts";
import { publishStations } from "../../../src/refresh.ts";
import { errata, sourceOf } from "../../../src/sources/index.ts";
import { readStationBounds, readStationList, writeRows } from "../../../src/store/parquet.ts";
import { readAnalysis } from "../../../src/store/analysis.ts";
import { usableShares } from "../../../src/store/years.ts";
import { readMatches } from "../../../src/matches.ts";
import migration from "../../../src/migrations/20261121-ign-coruna-hourly.ts";

const root = resolve(process.argv[2]);
const local = resolve(process.argv[3]);
const receipts = [];
for (const path of ["stations.parquet", "stations/matches.parquet", "stations/links.parquet", ...["cmems", "gesla", "uhslc"].flatMap(s=>[`stations/${s}.parquet`, ...["bounds", "analysis", "years"].map(k=>`stations/${k}/${s}.parquet`)])]) {
  const url = `https://stillwell.openwaters.io/${path}`;
  const response = await fetch(url,{headers:{"user-agent":USER_AGENT}});
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(`${root}/${path}`),{recursive:true});
  await writeFile(`${root}/${path}`,bytes);
  receipts.push({url,path,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
}
for (const path of ["stations/ign.parquet", "stations/bounds/ign.parquet", "stations/years/ign.parquet"]) {
  const bytes = await readFile(`${local}/${path}`);
  receipts.push({kind:"local IGN validation store",path,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
}
for (const source of ["cmems","gesla"]) {
 const path=`stations/years/${source}.parquet`;
 const bytes=await readFile(`${local}/${path}`);
 await copyFile(`${local}/${path}`,`${root}/${path}`);
 receipts.push({kind:"local copy requalification",path,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
}
const wanted = new Set(CORUNA_GAUGES.flat());
const publicRows = await readStationList(`${root}/stations.parquet`);
const nearby = publicRows.filter(s=>s.lat>43.34&&s.lat<43.39&&s.lon> -8.42&&s.lon< -8.37);
assert.ok(nearby.length >= 8);
assert.ok(nearby.every(s=>wanted.has(s.id)));
const listed = [];
const usable = new Map();
for (const source of ["cmems", "gesla", "uhslc"]) {
  const bounds = await readStationBounds(`${root}/stations/bounds/${source}.parquet`);
  const analysis = await readAnalysis(root,source);
  for (const [id,share] of await usableShares(root,source))usable.set(id,share);
  for (const station of await readStationList(`${root}/stations/${source}.parquet`))
    if(wanted.has(station.id))listed.push({...station,...bounds.get(station.id),tidal:analysis.get(station.id)?.tidal??null,tide_m:analysis.get(station.id)?.tide_m??null});
}
const ign = {...(await sourceOf("ign").stations())[0],...(await readStationBounds(`${local}/stations/bounds/ign.parquet`)).get("ign/ACOR1")};
for (const [id,share] of await usableShares(local,"ign"))usable.set(id,share);
const matches = await readMatches(root);
const result = {baseRevision:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),executionCodeSha256:createHash("sha256").update(execFileSync("git",["diff","HEAD","--binary"])).update(await readFile(new URL("../../../src/coruna-gauges.ts",import.meta.url))).update(await readFile(new URL("../../../src/sources/ign/check.ts",import.meta.url))).update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),method:"Source-owned identity metadata, current bounds/analysis/year shares and actual measured matches. Published same_as is not used as adapter input.",receipts,nearbyIds:nearby.map(s=>s.id),usable:[...usable].filter(([id])=>wanted.has(id)),ign,withoutIgn:null,withIgn:null};
for(const [label,rows] of [["withoutIgn",listed],["withIgn",[...listed,ign]]]) {
  const linked = linkGauges(rows,new Date(),usable,matches);
  const held = new Set(rows.map(s=>s.id));
  for(const s of linked.stations){
    const group=CORUNA_GAUGES.find(g=>g.includes(s.id)).filter(id=>held.has(id));
    assert.ok(group.includes(s.preferred));
    assert.deepEqual([...s.same_as].sort(),group.filter(id=>id!==s.id).sort());
  }
  result[label]={stations:linked.stations.map(s=>({id:s.id,lat:s.lat,lon:s.lon,contributor:s.contributor,originator:s.originator,same_as:s.same_as,preferred:s.preferred})),skipped:linked.report.skipped};
  if(label==="withIgn") {
    const path=`${root}/published/stations.parquet`;
    await mkdir(dirname(path),{recursive:true});
    await writeRows(path,linked.stations.map(s=>({id:s.id,preferred:s.preferred,same_as:s.same_as})),{id:"VARCHAR",preferred:"VARCHAR",same_as:"VARCHAR[]"},"id");
    const step=migration.steps.find(s=>"check" in s&&s.check.startsWith("Coruña's IGN"));
    await step.verify(`${root}/published`);
  }
}
await copyFile(`${root}/stations.parquet`,`${root}/public-before.parquet`);
for (const path of ["stations/ign.parquet","stations/bounds/ign.parquet","stations/years/ign.parquet"]) {
  await mkdir(dirname(`${root}/${path}`),{recursive:true});
  await copyFile(`${local}/${path}`,`${root}/${path}`);
}
await publishStations(root,["cmems","gesla","uhslc","ign"].map(sourceOf),["cmems","gesla","uhslc","ign"],errata);
const published = (await readStationList(`${root}/stations.parquet`)).filter(s=>wanted.has(s.id));
result.publication={before:publicRows.filter(s=>wanted.has(s.id)),after:published};
for(const station of published) {
  const group=CORUNA_GAUGES.find(g=>g.includes(station.id));
  const predicted = station.tide_station?.startsWith("ticon/") ? `gesla/${station.tide_station.slice(6)}` : "";
  assert.ok(!wanted.has(predicted)||group.includes(predicted));
}
await migration.steps.find(s=>s.check?.startsWith("Coruña's IGN")).verify(root);
const audit=publicRows.filter(s=>s.id.startsWith("gesla/")&&s.id.endsWith("-esp-ieo")).map(s=>({id:s.id,same_as:s.same_as,preferred:s.preferred}));
await writeFile(`${root}/spanish-ieo-group-audit.json`,JSON.stringify(audit,null,2)+"\n");
await writeFile(`${root}/group-readback.json`,JSON.stringify(result,null,2)+"\n");
console.log("PASS: all eight public Coruña records, with and without IGN; production matches and ranking inputs; migration readback");
