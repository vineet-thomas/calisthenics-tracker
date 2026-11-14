// Proves tests/check.js catches what it should: runs it against altered copies of index.html.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, ".."), TMP = path.join(__dirname, ".tmp", "checkself");
const { reporter } = require("./lib/fake");
const { check, finish } = reporter();
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const lock = fs.readFileSync(path.join(ROOT, "ids.lock.json"), "utf8");
const manifest = fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8");

function run(name, mutate, expectPass, expectText, changedFiles=""){
  fs.rmSync(TMP, { recursive:true, force:true }); fs.mkdirSync(TMP, { recursive:true });
  const files = mutate({ html, lock, manifest });
  fs.writeFileSync(path.join(TMP, "index.html"), files.html);
  fs.writeFileSync(path.join(TMP, "ids.lock.json"), files.lock);
  fs.writeFileSync(path.join(TMP, "manifest.webmanifest"), files.manifest);
  const r = spawnSync(process.execPath, [path.join(__dirname, "check.js")], { env:{ ...process.env, CHECK_ROOT:TMP, CHECK_CHANGED_FILES:changedFiles }, encoding:"utf8" });
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
run("rules + app code in one PR fails", f=>f, false, "rules/checks and app code change together", "CLAUDE.md\nindex.html");
run("check script + vendored code in one PR fails", f=>f, false, "rules/checks and app code change together", "tests/check.js,vendor/supabase-js-2.119.0/supabase.js");
run("workflow + SQL in one PR fails", f=>f, false, "rules/checks and app code change together", ".github/workflows/guard.yml\nsql/002-x.sql");
run("rules-only PR passes", f=>f, true, "OK", "CLAUDE.md\nopencode.json\ntests/check.js\n.github/workflows/guard.yml");
run("app + other tests + docs passes", f=>f, true, "OK", "index.html\ntests/sync.test.js\ndocs/brief.md\nids.lock.json");

fs.rmSync(TMP, { recursive:true, force:true });
finish("check.js self-test");
