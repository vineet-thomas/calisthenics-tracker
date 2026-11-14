// Shared helpers: a fake Supabase backend for browser tests.
// The page loads a stand-in supabase-js whose queries POST to /fake-db; Playwright answers those
// from an in-memory "server" that can go offline, return 5xx, refuse rows or be slow, and that
// applies the same newest-edit-wins + future-clock clamp as sql/001-newest-edit-wins.sql.
const fs = require("fs"), path = require("path");
const sleep = ms=>new Promise(r=>setTimeout(r, ms));

// Genuine CDN files (e.g. Tesseract), downloaded once into tests/.tmp/cdn and served from there, so
// Subresource Integrity is checked against the real bytes without needing the network every run.
async function cdnFile(url){
  const dir = path.join(__dirname, "..", ".tmp", "cdn"); fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, url.replace(/[^a-z0-9.@-]+/gi, "_"));
  if(!fs.existsSync(file)){ const r = await fetch(url); if(!r.ok) throw new Error(`download failed ${r.status} ${url}`); fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); }
  return fs.readFileSync(file);
}

const FAKE_SUPABASE = `
window.supabase = { createClient(){
  const user = { id:"u1", email:"test@example.com" };
  function q(table){
    const st = { table, op:null, body:null, filters:[], orders:[] };
    const b = {
      select(){ if(!st.op) st.op="select"; return b; },
      upsert(body, o){ st.op="upsert"; st.body=body; st.conf=o&&o.onConflict; return b; },
      insert(body){ st.op="insert"; st.body=body; return b; },
      delete(){ st.op="delete"; return b; },
      eq(k,v){ st.filters.push(["eq",k,v]); return b; },
      in(k,v){ st.filters.push(["in",k,v]); return b; },
      or(s){ st.filters.push(["or",s]); return b; },
      order(col, o){ st.orders.push([col, !(o && o.ascending===false)]); return b; },
      range(from, to){ st.range=[from, to]; return b; },
      maybeSingle(){ st.single=true; return b; },
      then(ok, ko){
        return fetch("/fake-db", { method:"POST", body:JSON.stringify(st) })
          .then(r=>r.json())
          .catch(e=>({ data:null, status:0, error:{ message:"TypeError: Failed to fetch", details:String(e), hint:"", code:"" } }))
          .then(ok, ko);
      }
    };
    return b;
  }
  return {
    auth:{ getSession: async()=>({ data:{ session:{ user } } }), onAuthStateChange(){}, signOut: async()=>{} },
    from:q, storage:{ from(){ return { upload: async()=>({ error:null }) }; } }
  };
}};`;

// Column rules mirrored from the live project (owner-confirmed, 13–14 Nov 2026). Keep in step with
// tests/realstack/schema.sql. Columns not listed are nullable with no default.
const SCHEMA = {
  workout_log: {
    notNull: ["user_id", "log_date", "day", "exercise_id", "set_index", "reps", "updated_at"],
    defaults: { reps: 0, updated_at: ()=>new Date().toISOString() },     // day and set_index have NO default
    integer: ["set_index", "reps", "negatives"],                          // set_index smallint, reps integer
    triggerFills: ["updated_at"],     // sql/001's BEFORE trigger sets a missing/null updated_at before NOT NULL is checked
  },
};
function violates(table, body){
  const t = SCHEMA[table], row = { ...body };
  for(const [c, d] of Object.entries(t.defaults)) if(!(c in row)) row[c] = typeof d==="function" ? d() : d;
  for(const c of t.triggerFills || []) if(row[c]==null) row[c] = new Date().toISOString();
  for(const c of t.notNull) if(row[c]==null)
    return { message:`null value in column "${c}" of relation "${table}" violates not-null constraint`, code:"23502", details:null, hint:null };
  for(const c of t.integer) if(row[c]!=null && !Number.isInteger(+row[c]))
    return { message:`invalid input syntax for type integer: "${row[c]}"`, code:"22P02", details:null, hint:null };
  return null;
}

function makeServer(seed){
  const S = { db: seed || {}, offline:false, down:false, delay:0, reject:new Set(), calls:[], MAX_ROWS:1000 };
  const ts = v=>v ? Date.parse(v) : null;
  const match = (row, filters)=>filters.every(f=>{
    if(f[0]==="eq") return row[f[1]]===f[2];
    if(f[0]==="in") return f[2].includes(row[f[1]]);
    if(f[0]==="or"){ const m = f[1].match(/updated_at\.lte\."([^"]+)"/); return row.updated_at==null || ts(row.updated_at) <= ts(m[1]); }
    return true;
  });
  S.handle = st=>{
    S.calls.push(st);
    if(S.down && st.table!=="error_log") return { status:503, data:null, error:{ message:"Service Unavailable", code:"" } };
    // Supabase's workout_log constraints, enforced like Postgres: on insert/upsert the row that WOULD be inserted
    // (body + column defaults) is checked before any conflict is resolved, so omitting a no-default NOT NULL
    // column (day, set_index) is refused even when the row already exists.
    if((st.op==="upsert" || st.op==="insert") && SCHEMA[st.table]){
      const bad = violates(st.table, st.body);
      if(bad) return { status:400, data:null, error:bad };
    }
    if(st.op==="upsert" && S.reject.has(st.body.exercise_id))
      return { status:403, data:null, error:{ message:'new row violates row-level security policy for table "workout_log"', code:"42501" } };
    const rows = S.db[st.table] = S.db[st.table] || [];
    if(st.op==="upsert"){
      const body = { ...st.body }, now = Date.now();
      if(!body.updated_at || ts(body.updated_at) > now + 120000) body.updated_at = new Date(now).toISOString();
      const keys = st.conf.split(",");
      const hit = rows.find(r=>keys.every(k=>r[k]===body[k]));
      if(hit){ if(hit.updated_at && ts(body.updated_at) < ts(hit.updated_at)) return { status:200, data:null, error:null }; Object.assign(hit, body); }
      else rows.push(body);
      return { status:201, data:null, error:null };
    }
    if(st.op==="insert"){ rows.push({ ...st.body }); return { status:201, data:null, error:null }; }
    if(st.op==="delete"){ S.db[st.table] = rows.filter(r=>!match(r, st.filters)); return { status:204, data:null, error:null }; }
    // like Supabase: sorted as asked, then the requested range, never more than MAX_ROWS (silently)
    let out = rows.filter(r=>match(r, st.filters));
    if(st.orders && st.orders.length) out = out.slice().sort((x,y)=>{ for(const [c,asc] of st.orders){ if(x[c]<y[c]) return asc?-1:1; if(x[c]>y[c]) return asc?1:-1; } return 0; });
    if(st.range) out = out.slice(st.range[0], st.range[1]+1);
    out = out.slice(0, S.MAX_ROWS);
    return { status:200, data: st.single ? (out[0]||null) : out, error:null };
  };
  S.rows = ()=>(S.db.workout_log||[]).map(r=>`${r.exercise_id}[${r.set_index}] reps=${r.reps} w=${r.weight_kg}`).sort();
  S.writes = ex=>S.calls.filter(c=>c.op==="upsert" && c.body.exercise_id===ex).length;
  return S;
}

// A fresh browser context (own storage) wired to server S. Service workers are blocked so the
// stand-in supabase-js is always the one the page runs.
async function newPage(browser, base, S, opts={}){
  const ctx = await browser.newContext({ serviceWorkers:"block", viewport:{ width:390, height:844 }, deviceScaleFactor:1 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", m=>{ if(m.type()==="error") page.errors.push(m.text()); });
  page.on("pageerror", e=>page.errors.push("PAGEERROR "+e.message));
  page.on("dialog", d=>d.accept());
  await page.addInitScript(p=>{
    if(!navigator.storage) return;
    navigator.storage.persisted = async()=>false;
    navigator.storage.persist = async()=>p==="granted";
  }, opts.persist || "granted");
  if(opts.clock) await page.clock.install();
  // stand-in Supabase client, whether the page loads the vendored copy or (main's baseline) the CDN tag
  for(const pat of ["**/vendor/supabase-js-*/supabase.js", "**/@supabase/supabase-js@2"])
    await page.route(pat, r=>r.fulfill({ contentType:"application/javascript", body:FAKE_SUPABASE }));
  await page.route("**/tesseract.min.js", async r=>r.fulfill({ contentType:"application/javascript",
    headers:{ "access-control-allow-origin":"*" }, body:await cdnFile(r.request().url()) }));
  await page.route("**/fake-db", async r=>{
    if(S.offline) return r.abort("internetdisconnected");
    const st = JSON.parse(r.request().postData());
    if(S.delay) await sleep(S.delay);
    const res = S.handle(st);                       // applied server-side even if the page has gone
    try{ await r.fulfill({ contentType:"application/json", body:JSON.stringify(res) }); }catch(_){}
  });
  if(opts.before) await opts.before(page);          // extra routes / init scripts, registered before the first load
  page.ctx = ctx;
  page.go = async()=>{ await page.goto(base); await settle(page, opts.clock); await page.tab(0); };
  page.reload2 = async(ms)=>{ await page.reload(); await settle(page, opts.clock, ms); await page.tab(0); };
  page.tab = async i=>{ await page.click(`.day[data-i="${i}"]`); if(!opts.clock) await sleep(150); };
  await page.go();
  return page;
}
async function settle(page, clock, ms){
  if(clock){ for(let i=0;i<8;i++){ await page.clock.runFor(100); await sleep(100); } }
  else await sleep(ms || 900);
}

// Expected-noise filter for console errors produced on purpose by offline / failure scenarios
const EXPECTED_NOISE = /Failed to fetch|internetdisconnected|ERR_INTERNET_DISCONNECTED|\[SYNC|\[PULL\]|\[SETTINGS_FETCH\]/;

function reporter(){
  const results = [];
  const check = (name, cond, extra="")=>results.push({ ok:!!cond, line:`${cond?"PASS":"FAIL"}  ${name}${extra?"  — "+extra:""}` });
  const finish = (title, errors=[])=>{
    const unexpected = errors.filter(e=>!EXPECTED_NOISE.test(e));
    check("no unexpected console or page errors", unexpected.length===0, unexpected.join(" | "));
    console.log(`\n## ${title}\n` + results.map(r=>r.line).join("\n"));
    const passed = results.filter(r=>r.ok).length;
    console.log(`${passed}/${results.length} passed`);
    process.exitCode = passed===results.length ? 0 : 1;
  };
  return { check, finish };
}

module.exports = { FAKE_SUPABASE, makeServer, newPage, sleep, reporter, SCHEMA, violates };
