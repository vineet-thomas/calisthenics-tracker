// Shared helpers: a fake Supabase backend for browser tests.
// The page loads a stand-in supabase-js whose queries POST to /fake-db; Playwright answers those
// from an in-memory "server" that can go offline, return 5xx, refuse rows or be slow, and that
// applies the same newest-edit-wins + future-clock clamp as sql/001-newest-edit-wins.sql.
const sleep = ms=>new Promise(r=>setTimeout(r, ms));

const FAKE_SUPABASE = `
window.supabase = { createClient(){
  const user = { id:"u1", email:"test@example.com" };
  function q(table){
    const st = { table, op:null, body:null, filters:[] };
    const b = {
      select(){ if(!st.op) st.op="select"; return b; },
      upsert(body, o){ st.op="upsert"; st.body=body; st.conf=o&&o.onConflict; return b; },
      insert(body){ st.op="insert"; st.body=body; return b; },
      delete(){ st.op="delete"; return b; },
      eq(k,v){ st.filters.push(["eq",k,v]); return b; },
      in(k,v){ st.filters.push(["in",k,v]); return b; },
      or(s){ st.filters.push(["or",s]); return b; },
      order(){ return b; }, maybeSingle(){ st.single=true; return b; },
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

function makeServer(seed){
  const S = { db: seed || {}, offline:false, down:false, delay:0, reject:new Set(), calls:[] };
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
    const out = rows.filter(r=>match(r, st.filters));
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
  await page.route("**/@supabase/supabase-js@2", r=>r.fulfill({ contentType:"application/javascript", body:FAKE_SUPABASE }));
  await page.route("**/tesseract.min.js", r=>r.fulfill({ contentType:"application/javascript", body:"" }));
  await page.route("**/fake-db", async r=>{
    if(S.offline) return r.abort("internetdisconnected");
    const st = JSON.parse(r.request().postData());
    if(S.delay) await sleep(S.delay);
    const res = S.handle(st);                       // applied server-side even if the page has gone
    try{ await r.fulfill({ contentType:"application/json", body:JSON.stringify(res) }); }catch(_){}
  });
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

module.exports = { FAKE_SUPABASE, makeServer, newPage, sleep, reporter };
