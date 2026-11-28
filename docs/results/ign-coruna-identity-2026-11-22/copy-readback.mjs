import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readObservations } from "../../../src/store/parquet.ts";
import { USER_AGENT } from "../../../src/http.ts";
const [store,output]=process.argv.slice(2);
if(!output)throw new Error("Usage: node copy-readback.mjs <requalified-local-store> <output.json>");
const root=await mkdtemp(join(tmpdir(),"coruna-copy-readback-")),results=[];
try {
 for(const id of ["cmems/Coruna2TG","gesla/coruna2tg-cor-esp-cmems"]){
  for(let year=2019;year<=2023;year++){
   const url=`https://stillwell.openwaters.io/obs/${id}/${year}.parquet`;
   const r=await fetch(url,{headers:{"user-agent":USER_AGENT}});if(!r.ok)throw new Error(`${url}: ${r.status}`);
   const bytes=Buffer.from(await r.arrayBuffer()),path=join(root,"before.parquet");await writeFile(path,bytes);
   const before=await readObservations(path),after=await readObservations(`${store}/obs/${id}/${year}.parquet`);
   const numeric=rows=>rows.map(o=>[o.time,o.level,o.source_flag]);
   assert.deepEqual(numeric(after),numeric(before));
   if(id.startsWith("gesla/")) assert.deepEqual(numeric(after),numeric(await readObservations(`${store}/obs/cmems/Coruna2TG/${year}.parquet`)));
   const inWindow=o=>(o.time>=Date.parse("2020-07-01")&&o.time<Date.parse("2020-09-01"))||(o.time>=Date.parse("2022-06-01")&&o.time<Date.parse("2022-10-01"));
   assert.ok(after.length && after.filter(inWindow).every(o=>o.flag>=3));
   results.push({id,year,observations:after.length,numericAndSourceFlagsUnchanged:true,identicalToNativeCopy:id.startsWith("gesla/")?true:null,clockWindowValues:after.filter(inWindow).length,allWindowValuesSuspectOrWorse:true,ordinaryQcValues:after.filter(o=>!inWindow(o)).length,url,inputSha256:createHash("sha256").update(bytes).digest("hex")});
  }
 }
 await writeFile(output,JSON.stringify({results},null,2)+"\n");console.log("PASS: every copy timestamp, level and source flag preserved; all uncertainty-window values suspect or worse");
} finally {await rm(root,{recursive:true,force:true});}
