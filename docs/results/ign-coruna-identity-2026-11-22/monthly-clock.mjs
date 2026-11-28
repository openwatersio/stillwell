import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const repo=fileURLToPath(new URL("../../../",import.meta.url));
const [store, database, output] = process.argv.slice(2);
if (!store || !database || !output) throw new Error("Usage: node monthly-clock.mjs <store> <slackwater-database> <output.json>");
const {readObservations}=await import(repo+"/src/store/parquet.ts");
const {seriesPath}=await import(repo+"/src/store/paths.ts");
const {timeline}=await import(repo+"/src/harmonic.ts");
const ticon=JSON.parse(await readFile(resolve(database,"data/ticon/coruna-coru-esp-ieo.json"),"utf8"));
const model={constituents:ticon.harmonic_constituents,offset:0,rms:0};
function r(a,b){const ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length;let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;ab+=x*y;aa+=x*x;bb+=y*y;}return ab/Math.sqrt(aa*bb);}
const results=[];
for(let year=2000;year<=2023;year++){
 const rows=await readObservations(seriesPath(resolve(store),"levels","ign","ACOR1",year));
 if(!rows.length)throw new Error(`no ${year} rows`);
 for(let month=0;month<12;month++){
  const a=rows.filter(o=>o.time>=Date.UTC(year,month,1)&&o.time<Date.UTC(year,month+1,1));
  const days=new Set(a.map(o=>Math.floor(o.time/86400000))).size;
  const rangeDays=(Date.UTC(year,month+1,1)-Date.UTC(year,month,1))/86400000;
  const requiredDays=rangeDays<30?Math.max(1,Math.ceil(rangeDays)-1):30;
  if(a.length<100)throw new Error(`too few values ${year}-${month+1}: ${a.length}`);
  const scores=Array.from({length:37},(_,i)=>(i-18)*10).map(lag=>({lag,r:r(a.map(o=>o.level),timeline(model,a.map(o=>o.time-lag*60000)).map(o=>o.level))}));
  const best=scores.reduce((a,b)=>a.r>b.r?a:b),zero=scores.find(s=>s.lag===0);
  results.push({year,month:month+1,values:a.length,days,requiredDays,coveragePass:days>=requiredDays,bestLagMinutes:best.lag,zeroCorrelation:zero.r,bestCorrelation:best.r});
 }
 console.log(year,results.slice(-12).map(r=>r.bestLagMinutes).join(","));
}
await writeFile(resolve(output),JSON.stringify({reference:"coruna-coru-esp-ieo",input:"Actual local 24-year stored output; all numeric observations, independently of stored quality flags",results},null,2));
console.log("maximum lag",Math.max(...results.map(r=>Math.abs(r.bestLagMinutes))),"minimum r0",Math.min(...results.map(r=>r.zeroCorrelation)));
