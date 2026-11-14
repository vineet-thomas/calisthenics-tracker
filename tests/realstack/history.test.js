// Progress history past the 1,000-row cap, through the real supabase-js and PostgREST (db-max-rows = 1000,
// as on Supabase). 600 sessions × 3 sets = 1,800 rows for the test user.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const crypto = require("crypto");
const { sleep, reporter } = require("../lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const SUPA = "https://aqbufgwvlrtegoflqrwl.supabase.co", LOCAL = "http://localhost:3300";
const UID = "11111111-1111-1111-1111-111111111111";
const SECRET = "local-test-secret-local-test-secret-0123456789";
const PSQL = `${execSync("brew --prefix postgresql@16").toString().trim()}/bin/psql`;
const sql = q=>execSync(`"${PSQL}" -h localhost -p 54329 -U postgres -d ct -X -q -t -A -c ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();
const { check, finish } = reporter();
function token(){
  const b = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg:"HS256", typ:"JWT" }), p = b({ sub:UID, role:"authenticated", aud:"authenticated", exp:Math.floor(Date.now()/1000)+3600 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(h+"."+p).digest("base64url")}`;
}

(async()=>{
  sql("truncate workout_log, day_status, settings, error_log");
  sql(`insert into workout_log(user_id,log_date,day,exercise_id,set_index,reps,updated_at)
       select '${UID}', date '2023-01-01' + d, 'Mon', 'pushups', s, 10 + (d % 5), now() - interval '1 day'
       from generate_series(0,599) d, generate_series(0,2) s`);
  const rows = sql("select count(*) from workout_log"), last = sql("select max(log_date) from workout_log");
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const ctx = await browser.newContext({ serviceWorkers:"block", viewport:{ width:390, height:844 } });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", e=>errors.push(e.message));
  let pages = 0;
  await page.addInitScript(([tok, uid])=>{ localStorage.setItem("sb-aqbufgwvlrtegoflqrwl-auth-token", JSON.stringify({ access_token:tok, refresh_token:"local", token_type:"bearer",
    expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{ id:uid, aud:"authenticated", role:"authenticated", email:"test@example.com" } })); }, [token(), UID]);
  await page.route(SUPA+"/auth/v1/**", r=>r.fulfill({ status:200, contentType:"application/json", headers:{ "access-control-allow-origin":"*" }, body:"{}" }));
  await page.route(SUPA+"/rest/v1/**", async r=>{
    const req = r.request(); if(/workout_log/.test(req.url()) && /offset=|limit=/.test(req.url())) pages++;
    const resp = await r.fetch({ url:req.url().replace(SUPA+"/rest/v1", LOCAL) });
    await r.fulfill({ status:resp.status(), headers:{ ...resp.headers(), "access-control-allow-origin":"*" }, body:await resp.text() });
  });
  await page.route(/^https:\/\/(?!cdn\.jsdelivr\.net|localhost)/, r=>r.request().url().startsWith(SUPA) ? r.fallback() : r.abort());
  await page.goto(BASE); await sleep(2500);
  const capped = await page.evaluate(async()=>(await sb.from("workout_log").select("log_date")).data.length);
  check("PostgREST caps an unpaged read at 1,000 rows (like Supabase)", capped===1000, `${capped} of ${rows} rows`);
  await page.click("#tabProgress"); await sleep(2500);
  const sub = await page.evaluate(()=>{ const c=[...document.querySelectorAll("#progressView .chartcard")].find(x=>x.querySelector(".nm").textContent.startsWith("Push-ups")); return c ? c.querySelector(".sub").textContent : ""; });
  const lastLabel = await page.evaluate(d=>fmtDate(d), last);
  check("Progress shows all 600 sessions from 1,800 rows, newest included", sub.startsWith("600 sessions") && sub.includes(lastLabel), `"${sub}"`);
  check("…read in pages", pages>=2, `${pages} paged requests`);
  await browser.close();
  sql("truncate workout_log");
  finish("realstack history", errors);
})();
