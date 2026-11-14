// Proves tests/check.js catches what it should: runs it against altered copies of the repo's fixtures.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, ".."), TMP = path.join(__dirname, ".tmp", "checkself");
const { reporter } = require("./lib/fake");
const { check, finish } = reporter();
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const lock = fs.readFileSync(path.join(ROOT, "ids.lock.json"), "utf8");
const manifest = fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8");
const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
const claude = fs.readFileSync(path.join(ROOT, "CLAUDE.md"), "utf8");

function run(name, mutate, expectPass, expectText, changedFiles=""){
  fs.rmSync(TMP, { recursive:true, force:true }); fs.mkdirSync(TMP, { recursive:true });
  const files = mutate({ html, lock, manifest, agents, claude });
  fs.writeFileSync(path.join(TMP, "index.html"), files.html);
  fs.writeFileSync(path.join(TMP, "ids.lock.json"), files.lock);
  fs.writeFileSync(path.join(TMP, "manifest.webmanifest"), files.manifest);
  fs.writeFileSync(path.join(TMP, "AGENTS.md"), files.agents ?? agents);
  fs.writeFileSync(path.join(TMP, "CLAUDE.md"), files.claude ?? claude);
  for(const [rel, content] of Object.entries(files.extra || {})){
    const p = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(p), { recursive:true });
    fs.writeFileSync(p, content);
  }
  const env = { ...process.env, CHECK_ROOT:TMP, CHECK_CHANGED_FILES:changedFiles,
                CHECK_BASE_APP_VERSION:(files.env && files.env.CHECK_BASE_APP_VERSION) || "" };
  const r = spawnSync(process.execPath, [path.join(__dirname, "check.js")], { env, encoding:"utf8" });
  const out = (r.stdout + r.stderr).trim();
  check(name, (r.status===0)===expectPass && (!expectText || out.includes(expectText)), out.split("\n").slice(0,2).join(" "));
}
const reg = s=>s.slice(s.indexOf("const EX_REGISTRY"));      // EX_REGISTRY section and after
const swapInRegistry = (s, from, to)=>s.slice(0, s.indexOf("const EX_REGISTRY")) + reg(s).replace(from, to);

run("unchanged repo passes", f=>f, true, "OK");
run("renaming an id fails", f=>({ ...f, html:f.html.split('id:"squats"').join('id:"gobletsquat"').split('id:"squats",').join('id:"gobletsquat",') }), false, 'locked id "squats" is missing');
run("deleting an id from EX_REGISTRY fails", f=>({ ...f, html:swapInRegistry(f.html, /\n\s*\{ id:"curl",[^\n]*/, "") }), false, 'locked id "curl" is missing');
run("retiring a movement (off the work list, kept in EX_REGISTRY) passes", f=>({ ...f, html:f.html.replace(/\n\s*\{id:"curl",[^\n]*/, "") }), true, "OK");
run("a new id not in the lock fails", f=>({ ...f, html:swapInRegistry(f.html, '{ id:"core",', '{ id:"pikepush", name:"Pike push-up", color:"#4f8ff0" },\n  { id:"core",') }), false, 'id "pikepush" is new');
run("…and passes once added to the lock deliberately", f=>({ ...f,
  html:swapInRegistry(f.html, '{ id:"core",', '{ id:"pikepush", name:"Pike push-up", color:"#4f8ff0" },\n  { id:"core",'),
  lock:JSON.stringify({ ids:[...JSON.parse(f.lock).ids, "pikepush"] }) }), true, "OK");
run("a work-list exercise missing from EX_REGISTRY fails", f=>({ ...f, html:f.html.replace('{id:"curl",', '{id:"hammercurl",name:"Hammer curl",target:"",cue:""},\n    {id:"curl",') }), false, 'exercise "hammercurl" is on a day');
run("a script syntax error fails", f=>({ ...f, html:f.html.replace("function render(){", "function render(){ (") }), false, "inline script");
run("an invalid manifest fails", f=>({ ...f, manifest:f.manifest.replace("{", "{,") }), false, "manifest.webmanifest");

// service worker
run("registering a service worker fails", f=>({ ...f, html:f.html.replace("initAuth();", 'navigator.serviceWorker.register("sw.js");\ninitAuth();') }), false, "service worker");
// gp_* tables: reads allowed, writes refused
const inject = (h, code)=>h.replace("initAuth();", code + "\ninitAuth();");
run("reading a gp_* table passes", f=>({ ...f, html:inject(f.html, 'async function gpRead(){ return sb.from("gp_goals").select("id").eq("user_id", user.id); }') }), true, "OK");
run("inserting into a gp_* table fails", f=>({ ...f, html:inject(f.html, 'async function gpW(){ return sb.from("gp_goals").insert({ title:"x" }); }') }), false, "writes to gp_goals (.insert)");
run("upserting a gp_* table across lines fails", f=>({ ...f, html:inject(f.html, "async function gpW(){ return sb.from('gp_prayers')\n    .upsert({ id:1 }, { onConflict:'id' }); }") }), false, "writes to gp_prayers (.upsert)");
run("updating a gp_* table fails", f=>({ ...f, html:inject(f.html, 'async function gpW(){ return sb.from(`gp_goals`).update({ done:true }).eq("id",1); }') }), false, "(.update)");
run("deleting from a gp_* table fails", f=>({ ...f, html:inject(f.html, 'async function gpW(){ return sb.from("gp_goals").delete().eq("id",1); }') }), false, "(.delete)");
// rules immutability
run("rules + app code in one PR fails", f=>f, false, "rules/checks and app code change together", "AGENTS.md\nindex.html");
run("the CLAUDE.md pointer + app code in one PR fails", f=>f, false, "rules/checks and app code change together", "CLAUDE.md\nindex.html");
run("check script + vendored code in one PR fails", f=>f, false, "rules/checks and app code change together", "tests/check.js,vendor/supabase-js-2.119.0/supabase.js");
run("workflow + SQL in one PR fails", f=>f, false, "rules/checks and app code change together", ".github/workflows/guard.yml\nsql/002-x.sql");
run("rules-only PR passes", f=>f, true, "OK", "AGENTS.md\nCLAUDE.md\nopencode.json\ntests/check.js\n.github/workflows/guard.yml");
run("app + other tests + docs passes", f=>f, true, "OK", "index.html\ntests/sync.test.js\ndocs/brief.md\nids.lock.json");

// APP_VERSION
const current = html.match(/APP_VERSION\s*=\s*["'](\d+)\.(\d+)\.(\d+)["']/).slice(1).map(Number);
const baseVersion = current.join(".");
const bumped = `${current[0]}.${current[1]}.${current[2] + 1}`;
run("changing index.html without an APP_VERSION bump fails", f=>({ ...f, env:{ CHECK_BASE_APP_VERSION:baseVersion } }), false, "must be bumped above the base", "index.html");
run("changing index.html with an APP_VERSION bump passes", f=>({ ...f,
  html:f.html.replace(/APP_VERSION\s*=\s*["'][\d.]+["']/, `APP_VERSION = "${bumped}"`),
  env:{ CHECK_BASE_APP_VERSION:baseVersion } }), true, "OK", "index.html");
run("a rules-only PR needs no APP_VERSION bump", f=>({ ...f, env:{ CHECK_BASE_APP_VERSION:baseVersion } }), true, "OK", "AGENTS.md");
run("a SQL-only PR needs no APP_VERSION bump", f=>({ ...f, env:{ CHECK_BASE_APP_VERSION:baseVersion } }), true, "OK", "sql/002-x.sql");
run("a manifest-only release without an APP_VERSION bump fails", f=>({ ...f, env:{ CHECK_BASE_APP_VERSION:baseVersion } }), false, "must be bumped above the base", "manifest.webmanifest");

// secrets
const fakeRole = ["service","role"].join("_");
const fakeSecret = ["sb","secret",""].join("_") + "AbCdEf1234567890";
const fakeEnv = ["SUPABASE","SERVICE"].join("_");
run("a service-role key in a tracked file fails", f=>({ ...f, extra:{ "docs/leak.txt":`k = "${fakeRole}"` } }), false, "service-role key");
run("a key-shaped Supabase secret key fails", f=>({ ...f, extra:{ "docs/leak.txt":`k = "${fakeSecret}"` } }), false, "Supabase secret key");
run("a Supabase service-role env var fails", f=>({ ...f, extra:{ "docs/leak.txt":`${fakeEnv}_KEY=x` } }), false, "service-role environment variable");
run("the vendored SDK's bare secret prefix does not fail", f=>({ ...f, extra:{ "vendor/x.js":["sb","secret",""].join("_") } }), true, "OK");

// destructive SQL
run("a SQL file that drops a column fails", f=>({ ...f, extra:{ "sql/999-test.sql":"alter table t drop column c;" } }), false, "DROP COLUMN");
run("a SQL file that renames a column fails", f=>({ ...f, extra:{ "sql/999-test.sql":"alter table t rename column a to b;" } }), false, "RENAME COLUMN");
run("a normal SQL migration passes", f=>({ ...f, extra:{ "sql/999-test.sql":"alter table t add column if not exists c int;" } }), true, "OK");

// NEVER block duplication
run("CLAUDE.md NEVER block drifting from AGENTS.md fails", f=>({ ...f,
  claude:f.claude.replace("Never drop or rename a column.", "Never drop a column.") }), false, "NEVER block differs");
run("a CLAUDE.md without the NEVER block fails", f=>({ ...f, claude:"pointer only\n" }), false, "no `## NEVER` block");

fs.rmSync(TMP, { recursive:true, force:true });
finish("check.js self-test");
