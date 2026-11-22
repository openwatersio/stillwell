import {mkdir,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {readObservations} from "../../../src/store/parquet.ts";
import {compare} from "../../../src/sources/gesla/check.ts";
import {USER_AGENT} from "../../../src/http.ts";
const [store,cache,output]=process.argv.slice(2);if(!output)throw Error("Usage: node independent-clock.mjs <ign-store> <cache> <output.json>");await mkdir(cache,{recursive:true});
const receipts=[],results=[];
for(const id of ["uhslc/830","cmems/CorunaTG"])for(let year=2000;year<=2023;year++){
 const url=`https://stillwell.openwaters.io/obs/${id}/${year}.parquet`,r=await fetch(url,{headers:{"user-agent":USER_AGENT}});
 if(r.status===404){results.push({id,year,status:"missing file"});continue;}if(!r.ok)throw Error(`${url}: ${r.status}`);
 const bytes=Buffer.from(await r.arrayBuffer()),path=`${cache}/${id.replace("/","-")}-${year}.parquet`;await writeFile(path,bytes);receipts.push({url,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
 const reference=await readObservations(path),ign=await readObservations(`${store}/obs/ign/ACOR1/${year}.parquet`);
 for(let month=0;month<12;month++){
  const a=ign.filter(o=>o.time>=Date.UTC(year,month,1)&&o.time<Date.UTC(year,month+1,1));
  const scores=[-720,-60,-20,-10,0,10,20,60,720].map(lag=>{const r=compare(a,reference,lag*60000,0.05);return [lag,r.n,Number.isFinite(r.spread)?r.spread:null,Number.isFinite(r.offset)?r.offset:null]});
  results.push({id,year,month:month+1,ignValues:a.length,scores});
 }
 console.log(id,year);
}
await writeFile(output,JSON.stringify({method:"All admitted years against both additional independent instrument records; compare() excludes bad values only. Scores columns: lag minutes, paired values, residual RMS meters, median offset meters; null means insufficient pairs. Missing files are not passes.",receipts,results})+"\n");
