#!/usr/bin/env node
// Pre-commit check (CLAUDE.md rule 4). No dependencies: run with `node tests/check.js`.
//   1. every inline <script> in index.html parses
//   2. manifest.webmanifest is valid JSON
//   3. exercise-id lock: every id in ids.lock.json is still in EX_REGISTRY (no renames or deletions),
//      every EX_REGISTRY id is in the lock (new ids are added deliberately), and every exercise on a
//      day's work list is in EX_REGISTRY (otherwise its history can't be charted)
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = process.env.CHECK_ROOT || path.resolve(__dirname, "..");   // CHECK_ROOT: used by the check's own self-test
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const fail = [];

[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i)=>{
  try{ new Function(m[1]); }catch(e){ fail.push(`index.html inline script ${i+1}: ${e.message}`); }
});

try{ JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8")); }
catch(e){ fail.push(`manifest.webmanifest: ${e.message}`); }

let lock = [];
try{ lock = JSON.parse(fs.readFileSync(path.join(ROOT, "ids.lock.json"), "utf8")).ids; }
catch(e){ fail.push(`ids.lock.json: ${e.message}`); }

let data = null;
try{
  const start = html.indexOf("const WARMUP"), end = html.indexOf("const ADVANCE_TOTAL");
  if(start < 0 || end < start) throw new Error("programme block not found (expected `const WARMUP` … `const ADVANCE_TOTAL`)");
  data = vm.runInNewContext(html.slice(start, end) + "\n;({ EX_REGISTRY, DAYS })", {});
}catch(e){ fail.push(`could not read the programme from index.html: ${e.message}`); }

if(data){
  const reg = data.EX_REGISTRY.map(e=>e.id);
  const work = [...new Set(data.DAYS.flatMap(d=>(d.data.work || []).map(x=>x.id)))];
  lock.filter(id=>!reg.includes(id)).forEach(id=>
    fail.push(`locked id "${id}" is missing from EX_REGISTRY. Ids are never renamed or deleted — retire a movement by removing it from the day's work list only (CLAUDE.md rule 1).`));
  reg.filter(id=>!lock.includes(id)).forEach(id=>
    fail.push(`id "${id}" is new: add it to ids.lock.json deliberately.`));
  reg.filter((id, i)=>reg.indexOf(id) !== i).forEach(id=>fail.push(`id "${id}" appears more than once in EX_REGISTRY.`));
  lock.filter((id, i)=>lock.indexOf(id) !== i).forEach(id=>fail.push(`id "${id}" appears more than once in ids.lock.json.`));
  work.filter(id=>!reg.includes(id)).forEach(id=>
    fail.push(`exercise "${id}" is on a day's work list but not in EX_REGISTRY, so its history can't be charted.`));
}

if(fail.length){ console.error("CHECK FAILED\n - " + fail.join("\n - ")); process.exit(1); }
console.log(`OK — scripts parse, manifest valid, ${lock.length} exercise ids locked and present`);
