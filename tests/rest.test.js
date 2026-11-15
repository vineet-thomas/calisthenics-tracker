// Item E: the rest timer (brief: docs/calisthenics-coach-BRIEF.md).
// Runs under Playwright's fake clock pinned to Monday 9 Nov 2026, so "today" is a push day and a two-minute
// countdown costs no real time. Vibration, the screen wake lock and Web Audio are stubbed and counted.
const { chromium } = require("playwright-core");
const { makeServer, newPage, sleep, reporter } = require("./lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const { check, finish } = reporter();
const set = (ex,i)=>`.stepper input[data-ex="${ex}"][data-set="${i}"]`;
const MON = new Date("2026-11-09T09:00:00"), WED = new Date("2026-11-11T09:00:00");

// wake: "ok" grants the lock, "refuse" rejects it. Counts live in window.__wl, beeps in __beeps, vibrations in __vib.
const stubs = (p, wake)=>p.addInitScript(w=>{
  window.__vib = []; window.__beeps = 0; window.__wl = { req:0, rel:0, live:0 };
  navigator.vibrate = pat=>{ window.__vib.push(pat); return true; };
  Object.defineProperty(navigator, "wakeLock", { configurable:true, value:{ request: async()=>{
    window.__wl.req++;
    if(w==="refuse") throw new Error("NotAllowedError");
    window.__wl.live++; const l = [];
    return { addEventListener:(e,f)=>l.push(f), release(){ window.__wl.rel++; window.__wl.live--; } };
  } } });
  window.AudioContext = class { constructor(){ this.currentTime = 0; this.destination = {}; }
    resume(){ return Promise.resolve(); }
    createOscillator(){ window.__beeps++; return { frequency:{ value:0 }, connect(){}, start(){}, stop(){} }; }
    createGain(){ return { gain:{ value:0 }, connect(){} }; } };
}, wake);
const open = (browser, when, wake="ok", extra)=>newPage(browser, BASE, makeServer(), { clock:true, clockTime:when,
  before: async p=>{ await stubs(p, wake); if(extra) await extra(p); } });
const bar = p=>p.evaluate(()=>{ const b = document.getElementById("restBar");
  return { show:b.classList.contains("show"), over:b.classList.contains("over"), name:b.querySelector(".rname").textContent,
           time:b.querySelector(".rtime").textContent, skip:b.querySelector("#restSkip").textContent,
           mute:b.querySelector("#restMute").textContent, width:Math.round(b.getBoundingClientRect().width) }; });
const probe = p=>p.evaluate(()=>({ vib:window.__vib, beeps:window.__beeps, wl:window.__wl }));
const tick = (p, ms)=>p.clock.runFor(ms);

(async()=>{
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const errors = [];
  const done = async p=>{ errors.push(...p.errors); await p.ctx.close(); };

  // ---- the programme: rest per exercise ----
  { const page = await open(browser, MON);
    const want = { pushups:90, dips:120, rows:120, scapulapull:90, ohpress:120, floorpress:120, latraise:90, dbrows:90,
                   reardelt:90, curl:90, core:90, squats:120, splitsquat:120, rdl:120, hipthrust:120, calves:90, kbswings:60 };
    const got = await page.evaluate(()=>Object.fromEntries(EX_REGISTRY.map(e=>[e.id, e.rest])));
    check("E1 every exercise has its target rest: 120 s presses / pulls / heavy legs / dips / pull-ups, 90 s the rest, 60 s swings",
      JSON.stringify(got)===JSON.stringify(Object.fromEntries(Object.keys(got).map(k=>[k, want[k]]))) && Object.keys(got).length===17,
      JSON.stringify(got));

    // ---- what does not start it ----
    check("E2 nothing is running when the day opens", !(await bar(page)).show);
    await page.fill('.setweight[data-ex="ohpress"][data-set="0"]', "10.5"); await sleep(100);
    await page.fill('.neginput[data-ex="dips"]', "4"); await sleep(100);
    check("E2 a weight edit and a negatives entry do not start it", !(await bar(page)).show);

    // ---- start, restart, wake lock ----
    await page.fill(set("pushups",0), "12"); await sleep(100);
    let b = await bar(page), pr = await probe(page);
    check("E3 reps going up starts the countdown for that exercise: push-ups, 1:30", b.show && b.name==="Rest · Push-ups" && b.time==="1:30", JSON.stringify(b));
    check("E3 …and takes the screen wake lock once", pr.wl.req===1 && pr.wl.live===1, JSON.stringify(pr.wl));
    await tick(page, 30000);
    check("E3 it counts down on the clock (30 s later: 1:00)", (await bar(page)).time==="1:00", (await bar(page)).time);
    await page.fill(set("pushups",1), "12"); await sleep(100);
    pr = await probe(page);
    check("E4 the next set restarts it rather than stacking a second one (back to 1:30), keeping the same lock",
      (await bar(page)).time==="1:30" && pr.wl.req===1 && pr.wl.live===1, `${(await bar(page)).time} ${JSON.stringify(pr.wl)}`);
    await page.fill(set("dips",0), "9"); await sleep(100);
    b = await bar(page);
    check("E4 another exercise takes over with its own value: Triceps dips, 2:00", b.name==="Rest · Triceps dips" && b.time==="2:00", JSON.stringify(b));

    // ---- corrections and clears do not restart it ----
    await tick(page, 10000);
    await page.click('.stepper button[data-act="dec"][data-ex="dips"][data-set="0"]'); await sleep(100);
    const afterDec = (await bar(page)).time;
    await page.fill(set("dips",0), ""); await sleep(100);
    const afterClear = (await bar(page)).time;
    check("E5 a tap down (a correction) and a clear do not restart it", /^1:(4|5)\d$/.test(afterDec) && /^1:(4|5)\d$/.test(afterClear), `${afterDec} / ${afterClear}`);

    // ---- after set 3 it still runs, to zero, once ----
    await page.fill(set("dips",2), "9"); await sleep(100);
    check("E6 set 3 starts it too: the gap before the next exercise is rest", (await bar(page)).time==="2:00" && (await bar(page)).name==="Rest · Triceps dips");
    await tick(page, 119000);
    check("E6 one second left", (await bar(page)).time==="0:01", (await bar(page)).time);
    pr = await probe(page);
    check("E6 nothing has sounded before zero", pr.vib.length===0 && pr.beeps===0, JSON.stringify(pr));
    await tick(page, 1500);
    b = await bar(page); pr = await probe(page);
    check("E7 at zero: the bar says it is over, one vibration, two beeps", b.over && b.name==="Rest over · Triceps dips" && b.time==="0:00" && b.skip==="OK"
      && pr.vib.length===1 && JSON.stringify(pr.vib[0])==="[250,120,250]" && pr.beeps===2, JSON.stringify({ b, vib:pr.vib, beeps:pr.beeps }));
    check("E7 …and the wake lock is let go at once", pr.wl.live===0 && pr.wl.rel>=1, JSON.stringify(pr.wl));
    await tick(page, 3000);
    check("E7 it stops there: nothing new starts for the next exercise", (await bar(page)).over && (await probe(page)).vib.length===1);
    await tick(page, 4000);
    check("E7 the finished bar clears itself", !(await bar(page)).show);

    // ---- skip ----
    await page.fill(set("pushups",2), "12"); await sleep(100);
    const live = (await probe(page)).wl.live;
    await page.click("#restSkip"); await sleep(100);
    check("E8 Skip hides it and releases the lock at once", live===1 && !(await bar(page)).show && (await probe(page)).wl.live===0);

    // ---- mute ----
    await page.fill(set("floorpress",0), "10"); await sleep(100);
    const mutedBefore = await probe(page);
    await page.click("#restMute"); await sleep(100);
    check("E9 the mute button switches to the muted icon and is kept on the device",
      (await bar(page)).mute==="🔕" && await page.evaluate(()=>localStorage.getItem("calisthenics-rest-mute-v1"))==="1", (await bar(page)).mute);
    await tick(page, 121000);
    pr = await probe(page);
    check("E9 muted: the countdown still runs to zero, but no vibration and no beep",
      (await bar(page)).over && pr.vib.length===mutedBefore.vib.length && pr.beeps===mutedBefore.beeps, JSON.stringify({ vib:pr.vib.length, beeps:pr.beeps }));
    check("E10 the bar fits 390 px", b.width<=390, b.width+" px");
    await done(page); }

  // ---- when it must not start ----
  { const page = await open(browser, MON);
    await page.click("#complete"); await sleep(300);
    await page.fill(set("pushups",0), "12"); await sleep(100);
    check("E11 a completed day never starts it", !(await bar(page)).show);
    await done(page); }
  { const page = await open(browser, WED);          // Monday is now a past day
    await page.fill(set("pushups",0), "12"); await sleep(100);
    check("E11 a past day never starts it", !(await bar(page)).show);
    await done(page); }

  // ---- the stored end time ----
  { const page = await open(browser, MON, "ok", p=>p.addInitScript(()=>{
      localStorage.setItem("calisthenics-rest-v1", JSON.stringify({ ex:"pushups", end:Date.now()+60000, secs:90, date:"2026-11-09" })); }));
    const b = await bar(page);
    check("E12 a countdown still running when the app comes back resumes with the right time left", b.show && b.name==="Rest · Push-ups" && /^(0:5\d|1:00)$/.test(b.time), JSON.stringify(b));
    await tick(page, 61000);
    check("E12 …and finishes on schedule", (await bar(page)).over);
    await done(page); }
  { const page = await open(browser, MON, "ok", p=>p.addInitScript(()=>{
      localStorage.setItem("calisthenics-rest-v1", JSON.stringify({ ex:"pushups", end:Date.now()-5000, secs:90, date:"2026-11-09" })); }));
    check("E12 one that ran out while the app was away does not come back", !(await bar(page)).show);
    await done(page); }

  // ---- wake lock refused ----
  { const page = await open(browser, MON, "refuse");
    await page.fill(set("pushups",0), "12"); await sleep(100);
    const b0 = await bar(page);
    await tick(page, 60000);
    const mid = (await bar(page)).time;
    await tick(page, 31000);
    const pr = await probe(page);
    check("E13 if the wake lock is refused the countdown still runs, stays right and alerts at zero",
      b0.show && b0.time==="1:30" && mid==="0:30" && (await bar(page)).over && pr.vib.length===1 && pr.wl.req===1 && pr.wl.live===0, JSON.stringify({ b0:b0.time, mid, wl:pr.wl }));
    await done(page); }

  await browser.close();
  finish("rest timer", errors);
})();
