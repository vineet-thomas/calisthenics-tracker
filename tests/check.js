#!/usr/bin/env node
// Pre-commit check (AGENTS.md rule 4). No dependencies: run with `node tests/check.js`.
//   1. every inline <script> in index.html parses
//   2. manifest.webmanifest is valid JSON
//   3. exercise-id lock: every id in ids.lock.json is still in EX_REGISTRY (no renames or deletions),
//      every EX_REGISTRY id is in the lock (new ids are added deliberately), and every exercise on a
//      day's work list is in EX_REGISTRY (otherwise its history can't be charted)
//   4. no service worker is registered (AGENTS.md NEVER block)
//   5. no writes to gp_* tables (they belong to the goals-prayers app); reads are allowed
//   6. rules immutability: the rules/checks and app code never change in the same PR
//      (in CI, CHECK_BASE=origin/main; locally the base is origin/main, or main)
//   7. APP_VERSION is bumped above the PR's base whenever index.html changes
//   8. no service-role key, Supabase secret key or service-role env var in tracked files
//   9. no DROP COLUMN or RENAME COLUMN in sql/*.sql (columns are never destroyed)
//  10. CLAUDE.md carries a byte-identical copy of the NEVER block in AGENTS.md
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
    fail.push(`locked id "${id}" is missing from EX_REGISTRY. Ids are never renamed or deleted — retire a movement by removing it from the day's work list only (AGENTS.md rule 1).`));
  reg.filter(id=>!lock.includes(id)).forEach(id=>
    fail.push(`id "${id}" is new: add it to ids.lock.json deliberately.`));
  reg.filter((id, i)=>reg.indexOf(id) !== i).forEach(id=>fail.push(`id "${id}" appears more than once in EX_REGISTRY.`));
  lock.filter((id, i)=>lock.indexOf(id) !== i).forEach(id=>fail.push(`id "${id}" appears more than once in ids.lock.json.`));
  work.filter(id=>!reg.includes(id)).forEach(id=>
    fail.push(`exercise "${id}" is on a day's work list but not in EX_REGISTRY, so its history can't be charted.`));
}

// 4. service worker
if(/serviceWorker\s*\.\s*register\s*\(/.test(html))
  fail.push("index.html registers a service worker. Never add one (AGENTS.md NEVER block).");

// 5. gp_* writes: any .from("gp_...") whose chain reaches insert/upsert/update/delete
for(const m of html.matchAll(/\.from\(\s*(['"`])(gp_[^'"`]*)\1\s*\)/g)){
  const chain = html.slice(m.index + m[0].length, m.index + m[0].length + 400).split(";")[0];
  const w = chain.match(/\.\s*(insert|upsert|update|delete)\s*\(/);
  if(w) fail.push(`index.html writes to ${m[2]} (.${w[1]}). gp_* tables belong to goals-prayers — read only (AGENTS.md NEVER block).`);
}

// 6. rules immutability
const RULES = ["AGENTS.md", "CLAUDE.md", "opencode.json", "tests/check.js", "tests/check.selftest.js", ".github/workflows/guard.yml"];
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

// 7. APP_VERSION: every release bumps it (AGENTS.md rule 3). A release ships an app asset
//    (index.html, manifest, icons, vendor); rules/docs-only and SQL-only PRs are not releases.
const versionOf = s=>{
  const m = s && s.match(/APP_VERSION\s*=\s*["'](\d+)\.(\d+)\.(\d+)["']/);
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const baseRef = ()=>{
  if(process.env.CHECK_BASE) return process.env.CHECK_BASE;
  try{ execSync("git rev-parse --verify --quiet origin/main", { cwd:ROOT, stdio:["ignore","pipe","ignore"] }); return "origin/main"; }
  catch(e){ return "main"; }
};
const baseFile = file=>{
  try{ return execSync(`git show ${baseRef()}:${file}`, { cwd:ROOT, encoding:"utf8", stdio:["ignore","pipe","ignore"] }); }
  catch(e){ return null; }
};
const RELEASE = f=>f==="index.html" || f==="manifest.webmanifest" || /^[^/]+\.png$/.test(f) || f.startsWith("vendor/");
if(changed && changed.some(RELEASE)){
  const cur = versionOf(html);
  if(!cur){
    fail.push('index.html: could not read APP_VERSION (expected e.g. `const APP_VERSION = "1.3.1";`).');
  }else{
    const raw = process.env.CHECK_BASE_APP_VERSION;
    const base = raw !== undefined ? versionOf(`APP_VERSION="${raw}"`) : versionOf(baseFile("index.html"));
    if(base){
      const newer = cur[0]>base[0] || (cur[0]===base[0] && (cur[1]>base[1] || (cur[1]===base[1] && cur[2]>base[2])));
      if(!newer) fail.push(`APP_VERSION ${cur.join(".")} must be bumped above the base ${base.join(".")} — every release increments it (AGENTS.md rule 3).`);
    }
  }
}

// 8. secrets: scan tracked text files. Tokens are assembled at runtime so this check never matches
//    its own source. The bare Supabase secret prefix only counts when it is key-shaped; the vendored
//    SDK contains the bare prefix in its key-format detection.
const trackedFiles = ()=>{
  if(!process.env.CHECK_ROOT){                                  // CHECK_ROOT: self-test temp tree
    try{ return execSync("git ls-files", { cwd:ROOT, encoding:"utf8", stdio:["ignore","pipe","ignore"] }).trim().split("\n").filter(Boolean); }
    catch(e){ /* not a git repo: fall through to a filesystem walk */ }
  }
  const out = [];
  (function walk(d){
    for(const e of fs.readdirSync(d, { withFileTypes:true })){
      if([".git","node_modules",".tmp"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if(e.isDirectory()) walk(p); else out.push(path.relative(ROOT, p));
    }
  })(ROOT);
  return out;
};
const files = trackedFiles();
const SECRETS = [
  { name:"service-role key", re:new RegExp(["service","role"].join("_"), "i") },
  { name:"Supabase secret key", re:new RegExp(["sb","secret",""].join("_") + "[A-Za-z0-9_-]{8,}") },
  { name:"Supabase service-role environment variable", re:new RegExp(["SUPABASE","SERVICE"].join("_"), "i") },
];
const BINARY = /\.(png|jpe?g|gif|webp|ico|zip|pdf|woff2?|ttf|eot|mp4|mov)$/i;
for(const f of files){
  if(BINARY.test(f)) continue;
  let text; try{ text = fs.readFileSync(path.join(ROOT, f), "utf8"); }catch(e){ continue; }
  for(const s of SECRETS) if(s.re.test(text))
    fail.push(`${f}: contains a ${s.name}. The repo is public — never commit secrets (AGENTS.md NEVER rule 7).`);
}

// 9. destructive schema changes: columns are never dropped or renamed (AGENTS.md NEVER rule 6).
for(const f of files.filter(f=>/^sql\/.*\.sql$/.test(f))){
  let sql; try{ sql = fs.readFileSync(path.join(ROOT, f), "utf8"); }catch(e){ continue; }
  if(/\bdrop\s+column\b/i.test(sql))
    fail.push(`${f}: contains DROP COLUMN. Never drop a column (AGENTS.md NEVER rule 6) — add a new column instead.`);
  if(/\brename\s+column\b/i.test(sql))
    fail.push(`${f}: contains RENAME COLUMN. Never rename a column (AGENTS.md NEVER rule 6) — add a new column instead.`);
}

// 10. CLAUDE.md must carry the same NEVER block as AGENTS.md: different tools load different files,
//     so drift between the two copies must fail CI.
const neverBlock = s=>{
  const i = s.indexOf("## NEVER");
  if(i < 0) return null;
  const rest = s.slice(i), next = rest.indexOf("\n## ", 1);
  return (next < 0 ? rest : rest.slice(0, next)).trimEnd();
};
let agentsSrc = null, claudeSrc = null;
try{ agentsSrc = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8"); }catch(e){ fail.push(`AGENTS.md: ${e.message}`); }
try{ claudeSrc = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8"); }catch(e){ fail.push(`CLAUDE.md: ${e.message}`); }
if(agentsSrc && claudeSrc){
  const a = neverBlock(agentsSrc), c = neverBlock(claudeSrc);
  if(!a) fail.push("AGENTS.md: no `## NEVER` block found.");
  else if(!c) fail.push("CLAUDE.md: no `## NEVER` block found — it must carry an exact copy of AGENTS.md's.");
  else if(a !== c) fail.push("CLAUDE.md's NEVER block differs from AGENTS.md's — keep the two byte-identical (different tools load different files).");
}

if(fail.length){ console.error("CHECK FAILED\n - " + fail.join("\n - ")); process.exit(1); }
console.log(`OK — scripts parse, manifest valid, ${lock.length} exercise ids locked and present, no service worker, no gp_* writes, rules and app code not mixed, APP_VERSION bump, no secrets, no destructive SQL, NEVER copies identical${note}`);
