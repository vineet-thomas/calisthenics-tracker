#!/usr/bin/env node
// Pre-commit check (CLAUDE.md rule 4). No dependencies: run with `node tests/check.js`.
//   1. every inline <script> in index.html parses
//   2. manifest.webmanifest is valid JSON
//   3. exercise-id lock: every id in ids.lock.json is still in EX_REGISTRY (no renames or deletions),
//      every EX_REGISTRY id is in the lock (new ids are added deliberately), and every exercise on a
//      day's work list is in EX_REGISTRY (otherwise its history can't be charted)
//   4. no service worker is registered (CLAUDE.md NEVER block)
//   5. no writes to gp_* tables (they belong to the goals-prayers app); reads are allowed
//   6. rules immutability: the rules/checks and app code never change in the same PR
//      (in CI, CHECK_BASE=origin/main; locally the base is origin/main, or main)
const fs = require("fs"), path = require("path"), vm = require("vm"), { execSync } = require("child_process");
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

// 4. service worker
if(/serviceWorker\s*\.\s*register\s*\(/.test(html))
  fail.push("index.html registers a service worker. Never add one (CLAUDE.md NEVER block).");

// 5. gp_* writes: any .from("gp_...") whose chain reaches insert/upsert/update/delete
for(const m of html.matchAll(/\.from\(\s*(['"`])(gp_[^'"`]*)\1\s*\)/g)){
  const chain = html.slice(m.index + m[0].length, m.index + m[0].length + 400).split(";")[0];
  const w = chain.match(/\.\s*(insert|upsert|update|delete)\s*\(/);
  if(w) fail.push(`index.html writes to ${m[2]} (.${w[1]}). gp_* tables belong to goals-prayers — read only (CLAUDE.md NEVER block).`);
}

// 6. rules immutability
const RULES = ["CLAUDE.md", "opencode.json", "tests/check.js", "tests/check.selftest.js", ".github/workflows/guard.yml"];
const isApp = f=>f==="index.html" || f==="manifest.webmanifest" || /^[^/]+\.png$/.test(f) || f.startsWith("vendor/") || f.startsWith("sql/");
let changed = null, note = "";
if(process.env.CHECK_CHANGED_FILES !== undefined){            // self-test hook
  changed = process.env.CHECK_CHANGED_FILES.split(/[\n,]/).map(x=>x.trim()).filter(Boolean);
} else {
  try{
    const git = c=>execSync(`git ${c}`, { cwd:ROOT, encoding:"utf8", stdio:["ignore","pipe","ignore"] }).trim();
    const base = process.env.CHECK_BASE || (git("rev-parse --verify --quiet origin/main") ? "origin/main" : "main");
    const mb = git(`merge-base ${base} HEAD`);
    const list = [git(`diff --name-only ${mb} HEAD`)];
    if(!process.env.CHECK_BASE) list.push(git("diff --name-only HEAD"));     // locally, uncommitted changes count too
    changed = [...new Set(list.join("\n").split("\n").filter(Boolean))];
  }catch(e){ note = " (rules-immutability skipped: no git base found)"; }
}
if(changed){
  const r = changed.filter(f=>RULES.includes(f)), a = changed.filter(isApp);
  if(r.length && a.length) fail.push(`rules/checks and app code change together — split them into separate PRs. Rules: ${r.join(", ")} · App: ${a.join(", ")}`);
}

if(fail.length){ console.error("CHECK FAILED\n - " + fail.join("\n - ")); process.exit(1); }
console.log(`OK — scripts parse, manifest valid, ${lock.length} exercise ids locked and present, no service worker, no gp_* writes, rules and app code not mixed${note}`);
