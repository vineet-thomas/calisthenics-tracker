// The real app with the real supabase-js (from the CDN) against local PostgREST + Postgres with RLS
// and the repo's SQL. Supabase REST calls are redirected to localhost; nothing reaches the real project.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const crypto = require("crypto");
const { sleep, reporter } = require("../lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const SUPA = "https://aqbufgwvlrtegoflqrwl.supabase.co", LOCAL = "http://localhost:3300";
const UID = "11111111-1111-1111-1111-111111111111";                 // test user, local database only
const SECRET = "local-test-secret-local-test-secret-0123456789";    // must match setup.sh (test-only)
const PSQL = `${execSync("brew --prefix postgresql@16").toString().trim()}/bin/psql`;
const sql = q=>execSync(`"${PSQL}" -h localhost -p 54329 -U postgres -d ct -X -q -t -A -c ${JSON.stringify(q)}`).toString().trim();
const { check, finish } = reporter();

function token(){   // a local JWT for the test user, signed with the local test secret
  const b = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg:"HS256", typ:"JWT" }), p = b({ sub:UID, role:"authenticated", aud:"authenticated", exp:Math.floor(Date.now()/1000)+3600 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(h+"."+p).digest("base64url")}`;
}

(async()=>{
  sql("truncate workout_log, day_status, settings, error_log");
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const ctx = await browser.newContext({ serviceWorkers:"block", viewport:{ width:390, height:844 } });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e=>errors.push(e.message)); page.on("dialog", d=>d.accept());
  const log = []; let offline = false;
  await page.addInitScript(([tok, uid])=>{
    localStorage.setItem("sb-aqbufgwvlrtegoflqrwl-auth-token", JSON.stringify({ access_token:tok, refresh_token:"local", token_type:"bearer",
      expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{ id:uid, aud:"authenticated", role:"authenticated", email:"test@example.com" } }));
  }, [token(), UID]);
  await page.route(SUPA+"/auth/v1/**", r=>r.fulfill({ status:200, contentType:"application/json", headers:{ "access-control-allow-origin":"*" }, body:"{}" }));
  await page.route(SUPA+"/rest/v1/**", async r=>{
    if(offline) return r.abort("internetdisconnected");
    const req = r.request(); const resp = await r.fetch({ url:req.url().replace(SUPA+"/rest/v1", LOCAL) }); const body = await resp.text();
    log.push({ method:req.method(), path:new URL(req.url()).pathname.replace("/rest/v1/",""), prefer:req.headers()["prefer"]||"", status:resp.status(), body });
    await r.fulfill({ status:resp.status(), headers:{ ...resp.headers(), "access-control-allow-origin":"*" }, body });
  });
  await page.route(/^https:\/\/(?!cdn\.jsdelivr\.net|localhost)/, r=>r.request().url().startsWith(SUPA) ? r.fallback() : r.abort());  // nothing else leaves the machine
  const set = (ex,i)=>`.stepper input[data-ex="${ex}"][data-set="${i}"]`;
  const badge = ()=>page.locator("#syncBadge").textContent();
  const mon = async()=>{ await page.click('.day[data-i="0"]'); await sleep(200); };
  const open = async ms=>{ await page.goto(BASE); await sleep(ms||2500); await mon(); };
  const reload = async ms=>{ await page.reload(); await sleep(ms||2500); await mon(); };

  await open();
  const day = await page.evaluate(()=>dateForTab(current)), dow = await page.evaluate(()=>DAYS[current].d);

  await page.fill(set("pushups",0), "10"); await sleep(1500);
  const w1 = log.filter(l=>l.method==="POST" && l.path==="workout_log").pop();
  check("R1 a set saves to Postgres through PostgREST + RLS", sql("select reps from workout_log where exercise_id='pushups' and set_index=0")==="10" && (await badge())==="Synced");
  check("R1 client sends no return= preference (PostgREST default: minimal)", w1 && !/return=/.test(w1.prefer), `Prefer "${w1&&w1.prefer}", HTTP ${w1&&w1.status}`);

  offline = true; await page.fill(set("pushups",1), "12"); await sleep(800);
  check("R2 edit queued while offline", (await badge())==="1 unsynced", await badge());
  await sleep(100);
  sql(`insert into workout_log(user_id,log_date,day,exercise_id,set_index,reps,updated_at) values ('${UID}','${day}','${dow}','pushups',1,30,now())`);
  offline = false; log.length = 0; await reload(3000);
  const w2 = log.filter(l=>l.method==="POST" && l.path==="workout_log");
  const st = await page.evaluate(()=>({ pending:myOutbox().length, failed:myFailed().length }));
  check("R2 an older offline edit that loses gets HTTP 200 with no error", w2.length===1 && w2[0].status===200, w2.map(x=>`HTTP ${x.status} "${x.body}"`).join(", "));
  check("R2 …and ends Synced, not failed or retrying", (await badge())==="Synced" && st.pending===0 && st.failed===0, `${await badge()} ${JSON.stringify(st)}`);
  check("R2 …and the newer value stays in the database and on screen", sql("select reps from workout_log where exercise_id='pushups' and set_index=1")==="30" && await page.inputValue(set("pushups",1))==="30");

  sql(`insert into workout_log(user_id,log_date,day,exercise_id,set_index,reps,updated_at) values ('${UID}','${day}','${dow}','dips',0,3,now()-interval '1 hour')`);
  offline = true; await page.click("#reset"); await sleep(400); await sleep(100);
  sql(`insert into workout_log(user_id,log_date,day,exercise_id,set_index,reps,updated_at) values ('${UID}','${day}','${dow}','floorpress',1,11,now())`);
  offline = false; await reload(3000);
  const left = sql("select string_agg(exercise_id||':'||reps, ',') from workout_log");
  check("R3 Clear day deletes only rows it could have seen", left==="floorpress:11" && (await badge())==="Synced", left);

  sql("revoke insert, update on public.workout_log from authenticated");
  await page.fill(set("pushups",2), "9"); await sleep(1500);
  const w4 = log.filter(l=>l.method==="POST" && l.path==="workout_log").pop();
  check("R4 a real permission refusal is set aside with the red badge", (await badge())==="⚠ 1 failed", `${await badge()}, HTTP ${w4&&w4.status}`);
  sql("grant insert, update on public.workout_log to authenticated");
  await page.click("#syncBadge"); await sleep(200); await page.click("#syncRetry"); await sleep(1500);
  check("R4 …and Retry succeeds once permission is restored", (await badge())==="Synced" && sql("select reps from workout_log where exercise_id='pushups' and set_index=2")==="9");
  await page.click("#syncClose");

  await page.click("#deloadBar button"); await sleep(1500);
  check("R5 deload toggle saves to settings", sql("select count(*) from settings where deload_week is not null")==="1");

  // deload toggle through the queue (1.2.1); settings has the newest-edit-wins trigger
  const db = ()=>sql("select coalesce(deload_week::text,'null') from settings") || "no row";
  const deloadOn = async()=>/Deload week/.test(await page.locator("#deloadBar").innerText());
  const monday = await page.evaluate(()=>currentWeekMonday());
  offline = true; await page.click("#deloadBar button"); await sleep(800);
  check("R6 offline deload toggle is queued", (await badge())==="1 unsynced" && db()===monday && !(await deloadOn()), `${await badge()} db=${db()}`);
  offline = false; await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1500);
  check("R6 …and uploads when back online", db()==="null" && (await badge())==="Synced", `${await badge()} db=${db()}`);
  offline = true; await page.click("#deloadBar button"); await sleep(600); await sleep(100);   // ON at T (offline)
  sql("update settings set deload_week=null, updated_at=now()");                               // other device: OFF, newer
  offline = false; log.length = 0; await reload(3000);
  const w7 = log.filter(l=>l.method==="POST" && l.path.startsWith("settings"));
  const st7 = await page.evaluate(()=>({ pending:myOutbox().length, failed:myFailed().length }));
  check("R7 an older offline toggle loses to a newer one (HTTP 200) and ends Synced", db()==="null" && !(await deloadOn()) && (await badge())==="Synced" && st7.pending===0 && st7.failed===0 && w7.length===1 && w7[0].status===200,
    `db=${db()} ${JSON.stringify(st7)} ${w7.map(x=>"HTTP "+x.status).join(",")}`);

  // per-set weights and "never save 0" (1.3.0) through PostgREST, RLS and the newest-edit trigger
  const rowsOf = ex=>sql(`select string_agg((set_index+1)||':'||coalesce(reps::text,'-')||'@'||coalesce(weight_kg::text,'-'), ' ' order by set_index) from workout_log where exercise_id='${ex}' and log_date='${day}'`);
  await page.fill('.setweight[data-ex="ohpress"][data-set="0"]', "10.5"); await sleep(200);
  for(const i of [0,1,2]){ await page.fill(set("ohpress",i), "10"); await sleep(200); }
  await sleep(1500);
  check("P1 weight once, three sets → three rows each with weight_kg", rowsOf("ohpress")==="1:10@10.5 2:10@10.5 3:10@10.5", rowsOf("ohpress"));
  await page.fill('.setweight[data-ex="ohpress"][data-set="2"]', "8"); await sleep(300);
  await page.fill('.setweight[data-ex="ohpress"][data-set="0"]', "11.5"); await sleep(1500);
  check("P2 hand-edited set 3 keeps its weight when set 1 changes", rowsOf("ohpress")==="1:10@11.5 2:10@11.5 3:10@8", rowsOf("ohpress"));
  await page.fill(set("ohpress",2), ""); await sleep(1500);
  check("P3 clearing a set stores reps = 0 (cleared) — accepted by the NOT NULL column, Synced", rowsOf("ohpress")==="1:10@11.5 2:10@11.5 3:0@8" && (await badge())==="Synced", `${rowsOf("ohpress")} ${await badge()}`);
  await reload(3000);
  check("P4 after a refresh the cleared set is empty and the weights are per set", await page.inputValue(set("ohpress",2))==="" && await page.inputValue('.setweight[data-ex="ohpress"][data-set="2"]')==="8");

  // entries left in the queue by older versions, against reps integer NOT NULL
  const stamp = ()=>new Date().toISOString();
  await page.evaluate(([d, ts])=>{ outbox.push(
      { t:"log", uid:user.id, date:d, day:"Mon", ex:"dips", set:0, f:{ reps:0 }, ts, rev:1 },         // pre-1.3.0 queued 0
      { t:"log", uid:user.id, date:d, day:"Mon", ex:"dips", set:1, f:{ reps:null }, ts, rev:1 });     // 1.3.0 queued null
    saveOutbox(); return flushOutbox(); }, [day, stamp()]);
  await sleep(1500);
  const q = await page.evaluate(()=>({ pending:myOutbox().length, failed:myFailed().length }));
  check("Q1 an old queued reps = 0 goes through to the NOT NULL column", sql("select reps from workout_log where exercise_id='dips' and set_index=0")==="0");
  check("Q2 a reps = null queued by 1.3.0 is sent as 0 and accepted", sql("select reps from workout_log where exercise_id='dips' and set_index=1")==="0" && q.pending===0 && q.failed===0 && (await badge())==="Synced", `${JSON.stringify(q)} ${await badge()}`);
  await page.evaluate(([d, ts])=>{ failed.push({ op:{ t:"log", uid:user.id, date:d, day:"Mon", ex:"dips", set:2, f:{ reps:null }, ts, rev:1 },
      status:400, code:"23502", message:"null value in column \"reps\" violates not-null constraint", at:ts }); saveFailed(); updateSyncBadge(); }, [day, stamp()]);
  check("Q3 an entry 1.3.0 set aside shows as failed", (await badge())==="⚠ 1 failed", await badge());
  await page.click("#syncBadge"); await sleep(200); await page.click("#syncRetry"); await sleep(1500); await page.click("#syncClose");
  check("Q3 …and Retry now succeeds (sent as 0)", sql("select reps from workout_log where exercise_id='dips' and set_index=2")==="0" && (await badge())==="Synced", await badge());
  // negatives typed before any reps: creates set 1's row without a reps value
  await page.click('.day[data-i="4"]'); await sleep(300);
  await page.fill('.neginput[data-ex="rows"]', "4"); await sleep(1500);
  const negRow = sql("select coalesce(reps::text,'null')||'|'||coalesce(negatives::text,'null') from workout_log where exercise_id='rows' and set_index=0");
  check("Q4 negatives entered before any reps save (set 1's row created without reps)", negRow.endsWith("|4") && (await badge())==="Synced", `row ${negRow || "none"}, ${await badge()}`);
  await page.click('.day[data-i="0"]'); await sleep(200);

  await browser.close();
  finish("realstack app", errors);
})();
