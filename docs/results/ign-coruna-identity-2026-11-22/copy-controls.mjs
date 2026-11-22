import{mkdir,writeFile}from"node:fs/promises";import{createHash}from"node:crypto";import{readObservations}from"../../../src/store/parquet.ts";import{compare}from"../../../src/sources/gesla/check.ts";import{USER_AGENT}from"../../../src/http.ts";
const[store,cache,output]=process.argv.slice(2);if(!output)throw Error("Usage: node copy-controls.mjs <local-store> <reference-cache> <output.json>");await mkdir(cache,{recursive:true});const receipts=[],results=[];
for(const id of ["cmems/Coruna2TG","gesla/coruna2tg-cor-esp-cmems"])for(let year=2019;year<=2024;year++){
 let subject;
 if(year<2024)subject=await readObservations(`${store}/obs/${id}/${year}.parquet`);
 else{const url=`https://stillwell.openwaters.io/obs/${id}/${year}.parquet`,r=await fetch(url,{headers:{"user-agent":USER_AGENT}});if(!r.ok)throw Error(`${url}: ${r.status}`);const bytes=Buffer.from(await r.arrayBuffer()),path=`${cache}/${id.replace("/","-")}-2024.parquet`;await writeFile(path,bytes);receipts.push({url,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});subject=await readObservations(path);}
 for(const referenceId of["uhslc/830","cmems/CorunaTG"]){
  const path=`${cache}/${referenceId.replace("/","-")}-${year}.parquet`;
  if(year===2024){const url=`https://stillwell.openwaters.io/obs/${referenceId}/${year}.parquet`,r=await fetch(url,{headers:{"user-agent":USER_AGENT}});if(!r.ok)throw Error(`${url}: ${r.status}`);const bytes=Buffer.from(await r.arrayBuffer());await writeFile(path,bytes);receipts.push({url,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});}
  const reference=await readObservations(path);
  for(let month=0;month<12;month++){const a=subject.filter(o=>o.time>=Date.UTC(year,month,1)&&o.time<Date.UTC(year,month+1,1));const scores=[-720,-60,-20,-10,0,10,20,60,720].map(lag=>{const r=compare(a,reference,lag*60000,0.05);return[lag,r.n,Number.isFinite(r.spread)?r.spread:null,Number.isFinite(r.offset)?r.offset:null]});results.push({id,referenceId,year,month:month+1,values:a.length,scores});}
 }
 console.log(id,year);
}
await writeFile(output,JSON.stringify({method:"Complete stored copy histories 2019–2024 against independent UHSLC/IEO and REDMAR observations; no bad values used, no time correction. Score columns: lag minutes, paired hours, residual RMS meters, median offset meters. Empty/short months are not passes. 2019–2023 input receipts are in copy-clock.json and independent-clock.json.",receipts,results})+"\n");
