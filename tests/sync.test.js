// Sync queue: offline entries, refresh survival, failure handling, back-off, conflicts, storage.
// Runs against the app at BASE (default http://localhost:8123/) with a fake Supabase backend.
// Uses Monday's tab, whose Push exercises include pushups, dips, ohpress and floorpress.
const { chromium } = require("playwright-core");
const { makeServer, newPage, sleep, reporter } = require("./lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const { check, finish } = reporter();
const set = (ex,i)=>`.stepper input[data-ex="${ex}"][data-set="${i}"]`;
const badge = p=>p.locator("#syncBadge").textContent();

(async()=>{
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const errors = [];
  const done = async p=>{ errors.push(...p.errors); await p.ctx.close(); };

  // 1. offline entries, refresh survival, in-flight refresh, reconnect
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    await page.fill(set("pushups",0), "10"); await sleep(1200);
    check("1a online entry reaches cloud", S.rows().includes("pushups[0] reps=10 w=undefined"), await badge(page));
    S.offline = true;
    await page.fill(set("pushups",1), "12"); await sleep(600);
    await page.fill('.weightinput[data-ex="ohpress"]', "15"); await sleep(1000);
    check("1b offline: badge counts unsynced", /unsynced/.test(await badge(page)), await badge(page));
    S.offline = false; await page.reload2(1500);
    check("1c offline entries survive refresh and sync", await page.inputValue(set("pushups",1))==="12" && S.rows().includes("pushups[1] reps=12 w=undefined") && S.rows().some(x=>x.startsWith("ohpress[0]")&&x.endsWith("w=15")));
    S.delay = 2500; await page.fill(set("pushups",2), "9"); await sleep(700); S.delay = 0;
    await page.reload2(3500);
    check("1d entry in flight during refresh survives", await page.inputValue(set("pushups",2))==="9" && S.rows().includes("pushups[2] reps=9 w=undefined"));
    S.offline = true; await page.click("#complete"); await sleep(400);
    S.offline = false; await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1200);
    check("1e auto-sync on reconnect", (S.db.day_status||[]).some(r=>r.completed) && (await badge(page))==="Synced", await badge(page));
    await done(page); }

  // 2. refused entry: set aside, visible, doesn't block the queue; retry and discard
  { const S = makeServer(); S.reject.add("dips"); const page = await newPage(browser, BASE, S);
    await page.fill(set("dips",0), "7"); await sleep(150);
    await page.fill(set("pushups",0), "10"); await sleep(1500);
    check("2a entries behind a refused one still sync", S.rows().includes("pushups[0] reps=10 w=undefined"), JSON.stringify(S.rows()));
    check("2b red '⚠ 1 failed' badge", (await badge(page))==="⚠ 1 failed" && (await page.getAttribute("#syncBadge","class")).includes("failed"), await badge(page));
    check("2c no misleading 'will upload' message for a refusal", !(await page.locator("#userErr.show").count()));
    await page.reload2(1200);
    check("2d failed badge persists across refresh", (await badge(page))==="⚠ 1 failed");
    await page.click("#syncBadge"); await sleep(300);
    const panel = await page.locator("#syncBody").innerText();
    check("2e panel shows the entry and the reason", /Box \/ triceps dips/.test(panel) && /set 1: 7 reps/.test(panel) && /42501/.test(panel) && /HTTP 403/.test(panel), panel.replace(/\n+/g," | ").slice(0,200));
    S.reject.clear();
    await page.click("#syncRetry"); await sleep(1500);
    check("2f retry succeeds once fixed", S.rows().includes("dips[0] reps=7 w=undefined") && (await badge(page))==="Synced", await badge(page));
    await page.click("#syncClose");
    S.reject.add("dips"); await page.fill(set("dips",1), "5"); await sleep(1200);
    await page.click("#syncBadge"); await sleep(200);
    await page.click(".syncfail button"); await sleep(1500);
    check("2g discard clears it and the screen matches the cloud", (await badge(page))==="Synced" && await page.inputValue(set("dips",1))==="", await badge(page));
    await done(page); }

  // 3. server errors: exponential back-off, set aside after 8 attempts and >= 30 min
  { const S = makeServer(); const page = await newPage(browser, BASE, S, { clock:true });
    S.down = true;
    const attempts = ()=>S.writes("pushups");
    const run = async ms=>{ await page.clock.runFor(ms); await sleep(250); };
    await page.fill(set("pushups",0), "10"); await run(1000);
    const a1 = attempts();
    check("3a server error shows unsynced, not failed", (await badge(page))==="1 unsynced", await badge(page));
    await run(25000); const a2 = attempts();
    await run(10000); const a3 = attempts();
    check("3b first retry waits ~30 s", a1===1 && a2===1 && a3===2, `attempts ${a1}/${a2}/${a3}`);
    let elapsed = 36; const timeline = [];
    for(let i=0;i<60 && attempts()<8;i++){ await run(60000); elapsed += 60; timeline.push(`${Math.round(elapsed/60)}m:${attempts()}`); }
    check("3c attempts spread out (8th not before ~40 min)", elapsed >= 40*60, timeline.filter((x,i,a)=>i===0||x.split(":")[1]!==a[i-1].split(":")[1]).join(" "));
    await run(2000);
    check("3d set aside after the 8th failure", (await badge(page))==="⚠ 1 failed" && attempts()===8, `${await badge(page)}, attempts ${attempts()}`);
    S.down = false;
    await page.click("#syncBadge"); await sleep(200);
    check("3e panel reason shows HTTP 503", /HTTP 503/.test(await page.locator("#syncBody").innerText()));
    await page.click("#syncRetry"); await run(1500);
    check("3f retry after the outage syncs", S.rows().includes("pushups[0] reps=10 w=undefined") && (await badge(page))==="Synced");
    await done(page); }

  // 4. no connection never sets entries aside
  { const S = makeServer(); const page = await newPage(browser, BASE, S, { clock:true });
    S.offline = true;
    await page.fill(set("pushups",0), "4");
    for(let i=0;i<120;i++){ await page.clock.runFor(60000); await sleep(20); }
    check("4a 2 h offline: still queued, never set aside", (await badge(page))==="1 unsynced", await badge(page));
    S.offline = false; await page.clock.runFor(61000); await sleep(400);
    check("4b syncs on the next retry once back", S.rows().includes("pushups[0] reps=4 w=undefined"));
    await done(page); }

  // 5. conflicts: newest edit wins; Clear day spares newer rows
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    const day = await page.evaluate(()=>dateForTab(current));
    S.offline = true;
    await page.fill(set("pushups",0), "10"); await sleep(650);                        // phone edit at T (offline)
    S.db.workout_log = [{ user_id:"u1", log_date:day, day:"Mon", exercise_id:"pushups", set_index:0, reps:20, updated_at:new Date().toISOString() }];
    S.offline = false; await page.reload2(1500);
    check("5a older phone edit doesn't overwrite a newer one", S.rows().join()==="pushups[0] reps=20 w=undefined" && await page.inputValue(set("pushups",0))==="20", S.rows().join());
    const st = await page.evaluate(()=>({ pending:myOutbox().length, failed:myFailed().length }));
    check("5b the losing edit ends Synced, not failed or retrying", (await badge(page))==="Synced" && st.pending===0 && st.failed===0 && S.writes("pushups")===1, `${await badge(page)} ${JSON.stringify(st)} sends=${S.writes("pushups")}`);
    S.db.workout_log.push({ user_id:"u1", log_date:day, day:"Mon", exercise_id:"dips", set_index:0, reps:3, updated_at:new Date(Date.now()-3600e3).toISOString() });
    S.offline = true; await page.click("#reset"); await sleep(350);                  // Clear day at T2 (offline)
    S.db.workout_log.push({ user_id:"u1", log_date:day, day:"Mon", exercise_id:"floorpress", set_index:1, reps:11, updated_at:new Date().toISOString() });
    S.offline = false; await page.reload2(1500);
    check("5c Clear day removes only rows it could have seen", S.rows().join()==="floorpress[1] reps=11 w=undefined" && await page.inputValue(set("floorpress",1))==="11", S.rows().join());
    await done(page); }

  // 6. edit stamps never go backwards on the device
  { const S = makeServer(); const page = await newPage(browser, BASE, S, { clock:true });
    S.offline = true;
    await page.fill(set("pushups",0), "1"); await page.clock.runFor(500);
    const t1 = await page.evaluate(()=>outbox[0].ts);
    await page.clock.setSystemTime(Date.parse(t1) - 5*60*1000);
    await page.fill(set("pushups",1), "2"); await page.clock.runFor(500);
    const t2 = await page.evaluate(()=>outbox[1].ts);
    check("6a stamp stays ahead when the clock goes back", Date.parse(t2) > Date.parse(t1), `${t1} -> ${t2}`);
    await done(page); }

  // 7. typing is merged, not one request per keystroke
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    await page.click('.weightinput[data-ex="ohpress"]');
    await page.keyboard.type("12.5", { delay:80 }); await sleep(1500);
    check("7a '12.5' typed → one request, final value saved", S.writes("ohpress")===1 && S.rows().some(x=>x.startsWith("ohpress[0]")&&x.endsWith("w=12.5")), `requests=${S.writes("ohpress")}`);
    await done(page); }

  // 8. storage persistence notice
  { const S = makeServer(); const page = await newPage(browser, BASE, S, { persist:"granted" });
    check("8a granted: no warning", !(await page.locator("#storageWarn.show").count()));
    await page.click("#syncBadge"); await sleep(200);
    check("8b granted: panel says protected", /Protected/.test(await page.locator("#syncBody").innerText()));
    await done(page); }
  { const S = makeServer(); const page = await newPage(browser, BASE, S, { persist:"denied" });
    check("8c refused: warning shown", await page.locator("#storageWarn.show").count()===1);
    await page.click("#storageWarn button"); await sleep(200);
    check("8d dismissed: hidden", !(await page.locator("#storageWarn.show").count()));
    S.offline = true; await page.fill(set("pushups",0), "3"); await sleep(800);
    check("8e reappears while entries are unsynced", await page.locator("#storageWarn.show").count()===1);
    S.offline = false; await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1200);
    check("8f hides again once synced", !(await page.locator("#storageWarn.show").count()));
    const sw = await page.evaluate(()=>document.documentElement.scrollWidth);
    check("8g no overflow at 390 px", sw<=390, `scrollWidth=${sw}`);
    await done(page); }

  // 9. "Couldn't sync" message clears once the queue has uploaded
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    S.offline = true;
    await page.fill(set("pushups",0), "6"); await sleep(400);
    await page.fill(set("pushups",1), "6"); await sleep(1200);
    check("9a offline: message shown with unsynced badge", await page.locator("#userErr.show").count()===1 && /unsynced/.test(await badge(page)), await badge(page));
    await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1500);
    check("9b still offline: message stays", await page.locator("#userErr.show").count()===1);
    S.offline = false;
    await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1500);
    check("9c back online without reload: Synced and message gone", (await badge(page))==="Synced" && !(await page.locator("#userErr.show").count()), await badge(page));
    await done(page); }

  // 10. deload toggle goes through the queue (1.2.1)
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    const deloadOn = async()=>/Deload week/.test(await page.locator("#deloadBar").innerText());
    const db = ()=>{ const r=(S.db.settings||[])[0]; return r ? String(r.deload_week) : "no row"; };
    await page.click("#deloadBar button"); await sleep(1200);
    const monday = await page.evaluate(()=>currentWeekMonday());
    check("10a online toggle saves, Synced", db()===monday && (await badge(page))==="Synced" && await deloadOn(), `db=${db()}`);
    S.offline = true; await page.click("#deloadBar button"); await sleep(800);
    check("10b offline toggle is queued, not falsely 'saved'", (await badge(page))==="1 unsynced" && !(await deloadOn()) && db()===monday, `${await badge(page)} db=${db()}`);
    await page.click("#syncBadge"); await sleep(200);
    check("10c sync panel names the waiting toggle", /waiting for a connection/.test(await page.locator("#syncBody").innerText()));
    await page.click("#syncClose");
    S.offline = false; await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1500);
    check("10d back online without reload: uploads, Synced", db()==="null" && (await badge(page))==="Synced", `${await badge(page)} db=${db()}`);
    S.offline = true; await page.click("#deloadBar button"); await sleep(600);
    S.offline = false; await page.reload2(1500);
    check("10e a toggle made offline survives a refresh and syncs", db()===monday && await deloadOn() && (await badge(page))==="Synced", `db=${db()}`);
    S.offline = true; await page.click("#deloadBar button"); await sleep(600);           // OFF at T (offline)
    S.db.settings[0].deload_week = monday; S.db.settings[0].updated_at = new Date(Date.now()+1000).toISOString();  // other device: ON, newer
    S.offline = false; await page.reload2(1500);
    const st = await page.evaluate(()=>({ pending:myOutbox().length, failed:myFailed().length }));
    check("10f an older toggle loses to a newer one: Synced, not failed", db()===monday && await deloadOn() && (await badge(page))==="Synced" && st.pending===0 && st.failed===0, `db=${db()} ${JSON.stringify(st)}`);
    await done(page); }

  await browser.close();
  finish("sync", errors);
})();
