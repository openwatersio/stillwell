import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { readObservations } from "../../../src/store/parquet.ts";
import { compare } from "../../../src/sources/gesla/check.ts";
import { USER_AGENT } from "../../../src/http.ts";
const [store, output] = process.argv.slice(2);
if(!output)throw new Error("Usage: node copy-clock.mjs <local-ign-store> <output.json>");
const result={method:"Every admitted hourly IGN observation in the complete 2019–2023 overlap, compared with each copy's stored observations using shared compare(); only bad values excluded. This comparison does not certify UTC or identical processing; the independent controls govern per-product flags.",receipts:[],results:[]};
for(const id of ["cmems/Coruna2TG","gesla/coruna2tg-cor-esp-cmems"]){
 const [source,station]=id.split("/");
 for(const path of [`stations/${source}.parquet`,`stations/years/${source}.parquet`,`stations/bounds/${source}.parquet`,...Array.from({length:5},(_,i)=>`obs/${id}/${2019+i}.parquet`)]){
  const url=`https://stillwell.openwaters.io/${path}`;const r=await fetch(url,{headers:{"user-agent":USER_AGENT}});if(!r.ok)throw new Error(`${url}: ${r.status}`);const bytes=Buffer.from(await r.arrayBuffer());await mkdir(dirname(`${store}/${path}`),{recursive:true});await writeFile(`${store}/${path}`,bytes);result.receipts.push({url,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
 }
 for(let year=2019;year<=2023;year++){
  const ign=await readObservations(`${store}/obs/ign/ACOR1/${year}.parquet`),copy=await readObservations(`${store}/obs/${id}/${year}.parquet`);
  result.results.push({id,year,ignValues:ign.length,copyValues:copy.length,scores:[-60,-20,0,20,60].map(lag=>({lag,...compare(ign,copy,lag*60000,0.05)}))});
 }
 console.log(id);
}
await writeFile(output,JSON.stringify(result,null,2)+"\n");
