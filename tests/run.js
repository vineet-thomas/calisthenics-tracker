#!/usr/bin/env node
// Runs the test suites (AGENTS.md: before every PR).
//   node tests/run.js               check + check self-test + sync + programme (incl. regression vs main)
//   node tests/run.js --realstack   also the real Postgres + PostgREST suites (needs Homebrew postgresql@16)
// Env: ALLOW_RENDER_CHANGE=1 when the PR changes the display on purpose (see programme.test.js).
const fs = require("fs"), path = require("path"), { spawn, execSync } = require("child_process");
const { serve } = require("./lib/serve");
const ROOT = path.resolve(__dirname, ".."), TMP = path.join(__dirname, ".tmp");
const REALSTACK = process.argv.includes("--realstack");
const APP_PORT = 8123, BASELINE_PORT = 8124;

const git = args=>execSync(`git ${args}`, { cwd:ROOT, encoding:"buffer", stdio:["ignore","pipe","ignore"] });
const hasRef = r=>{ try{ git(`rev-parse --verify --quiet ${r}`); return true; }catch(e){ return false; } };

// main's display code + this branch's programme data and version, so the regression measures display changes only
function buildBaseline(){
  const ref = hasRef("origin/main") ? "origin/main" : "main";
  const dir = path.join(TMP, "baseline"); fs.rmSync(dir, { recursive:true, force:true }); fs.mkdirSync(dir, { recursive:true });
  const mainHtml = git(`show ${ref}:index.html`).toString();
  const here = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const cut = s=>[s.indexOf("const WARMUP"), s.indexOf("const ADVANCE_TOTAL")];
  const [a1,a2] = cut(mainHtml), [b1,b2] = cut(here);
  // the version number is release data too (it's shown in the footer), so the baseline carries this branch's.
  // Consequence: the regression can't catch the footer itself breaking — ocr-version.test.js (6a/6b) checks
  // the footer reads exactly "v" + APP_VERSION on every tab.
  const version = (here.match(/const APP_VERSION = "[^"]*";/) || [""])[0];
  const merged = mainHtml.slice(0,a1) + here.slice(b1,b2) + mainHtml.slice(a2);
  fs.writeFileSync(path.join(dir, "index.html"), version ? merged.replace(/const APP_VERSION = "[^"]*";/, version) : merged);
  for(const f of ["manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png"]) fs.writeFileSync(path.join(dir, f), git(`show ${ref}:${f}`));
  return { dir, ref };
}

// suites run as child processes without blocking, so the test web servers in this process keep answering
const step = (title, cmd, args, env={})=>new Promise(resolve=>{
  console.log(`\n=== ${title}`);
  spawn(cmd, args, { cwd:__dirname, stdio:"inherit", env:{ ...process.env, ...env } }).on("close", code=>resolve(code===0));
});

(async()=>{
  const results = [];
  results.push(["check (rule 4)", await step("check (rule 4)", process.execPath, ["check.js"])]);
  results.push(["check self-test", await step("check self-test", process.execPath, ["check.selftest.js"])]);
  const app = await serve(ROOT, APP_PORT);
  const { dir, ref } = buildBaseline(); const base = await serve(dir, BASELINE_PORT);
  console.log(`\nbaseline for the regression: ${ref} display code + this branch's programme`);
  const env = { BASE:`http://localhost:${APP_PORT}/`, BASELINE:`http://localhost:${BASELINE_PORT}/` };
  results.push(["sync", await step("sync", process.execPath, ["sync.test.js"], env)]);
  results.push(["programme + regression", await step("programme + regression", process.execPath, ["programme.test.js"], env)]);
  results.push(["ocr + version", await step("ocr + version", process.execPath, ["ocr-version.test.js"], env)]);
  results.push(["history paging", await step("history paging", process.execPath, ["history.test.js"], env)]);
  results.push(["per-set weights", await step("per-set weights", process.execPath, ["sets.test.js"], env)]);
  if(REALSTACK){
    const up = await step("realstack: start", "bash", ["realstack/setup.sh", "start"]);
    if(up){
      results.push(["realstack SQL", await step("realstack: SQL", "bash", ["realstack/sql.test.sh"])]);
      results.push(["realstack app", await step("realstack: app", process.execPath, ["realstack/e2e.test.js"], env)]);
      results.push(["realstack history", await step("realstack: history", process.execPath, ["realstack/history.test.js"], env)]);
      results.push(["fake ↔ real parity", await step("realstack: fake ↔ real parity", process.execPath, ["realstack/parity.test.js"], env)]);
    } else results.push(["realstack start", false]);
    await step("realstack: stop", "bash", ["realstack/setup.sh", "stop"]);
  }
  app.close(); base.close();
  console.log("\n=== summary\n" + results.map(([n,ok])=>`${ok?"PASS":"FAIL"}  ${n}`).join("\n"));
  process.exit(results.every(([,ok])=>ok) ? 0 : 1);
})();
