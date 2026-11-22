import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readObservations } from "../../../src/store/parquet.ts";
import { compare } from "../../../src/sources/gesla/check.ts";
import { USER_AGENT } from "../../../src/http.ts";
const [store, cache, output] = process.argv.slice(2);
if (!output) throw new Error("Usage: node observed-clock.mjs <ign store> <local cache> <output.json>");
await mkdir(cache,{recursive:true});
const results=[],receipts=[];
for(let year=2000;year<=2016;year++) {
 const url=`https://stillwell.openwaters.io/obs/gesla/coruna-coru-esp-ieo/${year}.parquet`;
 const response=await fetch(url,{headers:{"user-agent":USER_AGENT}});
 if(!response.ok)throw new Error(`${url}: ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 const path=`${cache}/${year}.parquet`;
 await writeFile(path,bytes);
 receipts.push({url,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
 const ieo=await readObservations(path),ign=await readObservations(`${store}/obs/ign/ACOR1/${year}.parquet`);
 for(let month=0;month<12;month++) {
  const since=Date.UTC(year,month,1),until=Date.UTC(year,month+1,1);
  const a=ign.filter(o=>o.time>=since&&o.time<until);
  const days=new Set(a.map(o=>Math.floor(o.time/86400000))).size;
  const requiredDays=(until-since)/86400000<30?Math.ceil((until-since)/86400000)-1:30;
  const scores=[-720,-20,-10,0,10,20,720].map(lag=>({lag,...compare(a,ieo,lag*60000,0.05)}));
  results.push({year,month:month+1,values:a.length,days,requiredDays,coveragePass:days>=requiredDays,scores});
 }
 console.log(year);
}
await writeFile(output,JSON.stringify({method:"Independent IEO observations; shared compare() interpolates gaps no longer than one hour, subtracts each lag's median difference and reports residual RMS. No timestamp shifts applied. All numeric IGN values, excluding only Flag.bad in compare().",receipts,results},null,2)+"\n");
