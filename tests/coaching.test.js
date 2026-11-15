// Items B + C: equipment ladders and session coaching (brief: docs/calisthenics-coach-BRIEF.md).
// Rules are exercised directly (coachFor is a pure function of the exercise and its past sessions) and the
// wiring through the card, the "Ready to advance" tag, Progress and the offline copy is checked in the DOM.
const { chromium } = require("playwright-core");
const { makeServer, newPage, sleep, reporter } = require("./lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const { check, finish } = reporter();
const iso = d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
// the Monday of this week minus n weeks — always before the day on screen
function weekAgo(n){ const t=new Date(), o=t.getDay()===0?-6:1-t.getDay(); t.setDate(t.getDate()+o-7*n); return iso(t); }
const MON = weekAgo(0);
// workout_log rows for one session: reps [10,10,9], weight 10.5 or per set [10.5,10.5,8]
const rows = (date, ex, reps, weight, day="Mon")=>reps.map((r,i)=>({ user_id:"u1", log_date:date, day,
  exercise_id:ex, set_index:i, reps:r,
  weight_kg:(Array.isArray(weight) ? weight[i] : weight)==null ? null : (Array.isArray(weight) ? weight[i] : weight),
  updated_at:date+"T00:00:00Z" }));
// a session as coachFor takes it
const S = (date, reps, weight)=>({ date, total:reps.reduce((a,b)=>a+b,0),
  weight: Array.isArray(weight) ? weight.find(w=>w!=null) ?? null : weight,
  sets: reps.map((r,i)=>({ reps:r, weight: Array.isArray(weight) ? (weight[i]==null?null:weight[i]) : weight })) });
const wt = (ex,i)=>`.setweight[data-ex="${ex}"][data-set="${i}"]`;
const reps = (ex,i)=>`.stepper input[data-ex="${ex}"][data-set="${i}"]`;

(async()=>{
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const errors = [];
  const done = async p=>{ errors.push(...p.errors); await p.ctx.close(); };
  const page0 = await newPage(browser, BASE, makeServer());

  // ---- B: ladders and the exercise fields the rules read ----
  const L = await page0.evaluate(()=>({
    ladders:Object.keys(LADDERS), db:LADDERS.dumbbell, kb:LADDERS.kettlebell,
    oh:achievableLoads(EX_REGISTRY.find(e=>e.id==="ohpress")),
    hip:achievableLoads(EX_REGISTRY.find(e=>e.id==="hipthrust")),
    sq:achievableLoads(EX_REGISTRY.find(e=>e.id==="squats")),
    bad:EX_REGISTRY.filter(e=>!e.ladder || (e.ladder!=="none" && !(e.implements && e.display && LADDERS[e.ladder]))
      || (e.id!=="kbswings" && !(Number.isInteger(e.repMin) && Number.isInteger(e.repMax)))
      || (!!e.loaded)!==(e.ladder!=="none")).map(e=>e.id),
  }));
  const wellFormed = a=>Array.isArray(a) && a.length>1 && a.every((v,i)=>typeof v==="number" && v>0 && (i===0 || v>a[i-1]));
  check("B1 both ladders exist and are well-formed: ascending, unique, positive",
    L.ladders.length===2 && wellFormed(L.db) && wellFormed(L.kb), `${L.db.length} dumbbell, ${L.kb.length} kettlebell rungs`);
  check("B1 …the kettlebell ladder is kept for later (kbswings is a fixed load, single-arm swings get a new id)", L.kb.join(",")==="3.5,5.6,8.1,10.8,13.6,16.1,18.1", L.kb.join(","));
  check("B2 every exercise declares ladder, implements, display and the rep range (kbswings has no range)",
    L.bad.length===0, L.bad.join(", "));
  check("B3 hip thrust / squat loads are the union of single and doubled rungs (…, 21, 23, 24, 27, …)",
    JSON.stringify(L.hip)===JSON.stringify([2.5,3.5,5,6,7,8,9.5,10,10.5,11.5,12,13.5,14,16,18.5,19,20.5,21,23,24,27,32,37,41,46,48]) && JSON.stringify(L.sq)===JSON.stringify(L.hip),
    L.hip.join(","));
  check("B3 a per-hand dumbbell exercise never offers 12, 13, 21 or a doubled rung",
    !L.oh.includes(12) && !L.oh.includes(13) && !L.oh.includes(21) && L.oh.every(v=>L.db.includes(v)), L.oh.join(","));

  // ---- C: the load rules, one by one ----
  const coach = (exId, sessions, deload=false)=>page0.evaluate(([exId,sessions,deload])=>{
    const c = coachFor(EX_REGISTRY.find(e=>e.id===exId), sessions, deload);
    return { text:c.text, why:c.why, weight:c.weight };
  }, [exId, sessions, deload]);
  const g = (...a)=>coach(...a);

  let c = await g("ohpress", []);
  check("C1 no history → no suggestion, the range only", c.weight===null && /No weighted session yet — 6–10 reps/.test(c.text), c.text);
  c = await g("ohpress", [S(weekAgo(1), [10,10,10], 10.5)]);
  check("C2 all sets at the top, one session → hold, repeat to confirm", /^Repeat 10\.5 kg to confirm/.test(c.text) && c.weight===10.5, c.text);
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], 10.5), S(weekAgo(1), [10,10,10], 10.5)]);
  check("C3 all sets at the top, two sessions running → next achievable load, aim for repMin",
    c.text==="Try 11.5 kg — aim for 6" && c.weight===11.5 && /two sessions running/.test(c.why), `${c.text} · ${c.why}`);
  c = await g("ohpress", [S(weekAgo(2), [8,8,7], 11.5), S(weekAgo(1), [8,8,7], 11.5)]);
  check("C4 mid-range → hold, aim for repMax", /^Same weight — aim for 10/.test(c.text) && c.weight===11.5, c.text);
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], 24), S(weekAgo(1), [5,10,10], 24)]);
  check("C5 any set below repMin → one rung down, never more (24 → 23, not 20.5)", /^Drop to 23 kg/.test(c.text) && c.weight===23, c.text);
  check("C5 …and it wins over the two-sessions-at-the-top rule",
    !/Try/.test(c.text), c.text);

  // off-ladder history: ohpress has real rows at 10 kg, which is not a dumbbell rung
  c = await g("ohpress", [S(weekAgo(1), [5,10,10], 10)]);
  check("C6 off-ladder 10 kg, below range → next rung below (9.5)", /^Drop to 9\.5 kg/.test(c.text) && c.weight===9.5, c.text);
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], 10), S(weekAgo(1), [10,10,10], 10)]);
  check("C6 off-ladder 10 kg at the top twice → next rung above (10.5)", /^Try 10\.5 kg/.test(c.text) && c.weight===10.5, c.text);
  c = await g("ohpress", [S(weekAgo(1), [8,8,8], 10)]);
  check("C6 off-ladder 10 kg held → nearest rung, ties to the lower one (9.5)",
    /^Hold 9\.5 kg/.test(c.text) && c.weight===9.5 && /nearest rung/.test(c.why), `${c.text} · ${c.why}`);

  // ceiling: per-hand dumbbells top out at 24 kg
  c = await g("splitsquat", [S(weekAgo(2), [12,12,12], 24), S(weekAgo(1), [12,12,12], 24)]);
  check("C7 at the top of the ladder: progress by reps / tempo / unilateral work, never a load",
    c.weight===null && /^Top of the loads available/.test(c.text) && /single-arm/.test(c.text), c.text);
  c = await g("hipthrust", [S(weekAgo(2), [15,15,15], 24), S(weekAgo(1), [15,15,15], 24)]);
  check("C7 hip thrust from 24 kg: the real next load is 2 × 13.5 = 27", /^Try 27 kg/.test(c.text) && c.weight===27, c.text);

  // dropped last set: a later set lighter than set 1 means the session is not "all at the top"
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], [10.5,10.5,8]), S(weekAgo(1), [10,10,10], [10.5,10.5,8])]);
  check("C8 a dropped last set means hold, even with every set at repMax", !/^Try/.test(c.text) && c.weight===10.5, c.text);

  c = await g("kbswings", [S(weekAgo(1), [15,15,15], 18)]);
  check("C9 kbswings: the fixed load, and never a suggestion", c.text==="18.1 kg — top of the set" && c.weight===null, c.text);

  // bodyweight: reps-only coaching
  c = await g("pushups", [S(weekAgo(2), [20,20,20], null), S(weekAgo(1), [20,20,20], null)]);
  check("C10 bodyweight, two sessions at repMax → ready for the next progression",
    c.text==="Ready for the next progression" && /twice running/.test(c.why), `${c.text} · ${c.why}`);
  c = await g("pushups", [S(weekAgo(1), [20,20,20], null)]);
  check("C10 bodyweight, one session at repMax → repeat to confirm", /^At the top — repeat to confirm/.test(c.text), c.text);
  c = await g("pushups", [S(weekAgo(1), [15,15,15], null)]);
  check("C10 bodyweight, mid-range → aim for repMax", c.text==="Aim for 20 on every set", c.text);
  c = await g("pushups", [S(weekAgo(1), [11,20,20], null)]);
  check("C10 bodyweight, a set below repMin → ease the variation or add assistance", /^Below the range/.test(c.text), c.text);
  c = await g("dips", []);
  check("C10 bodyweight with no history → the range only", /No session yet — work in the 10–15 rep range/.test(c.text) && c.weight===null, c.text);

  // squats: bodyweight rows from before 11 Nov must never be compared with loaded work
  c = await g("squats", [S(weekAgo(2), [12,12,12], null), S(weekAgo(1), [12,12,12], null)]);
  check("C11 squats: bodyweight history only → no weighted session, nothing suggested", /No weighted session yet/.test(c.text) && c.weight===null, c.text);
  c = await g("squats", [S(weekAgo(2), [12,12,12], null), S(weekAgo(1), [12,12,12], 24)]);
  check("C11 squats: the bodyweight session doesn't count as the second at the top → hold", /^Repeat 24 kg to confirm/.test(c.text), c.text);

  // deload week: never told to add weight in a week designed to be lighter
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], 10.5), S(weekAgo(1), [10,10,10], 10.5)], true);
  check("C12 deload week suppresses the up-suggestion", /^Deload week — hold 10\.5 kg/.test(c.text) && c.weight===10.5, c.text);
  c = await g("pushups", [S(weekAgo(2), [20,20,20], null), S(weekAgo(1), [20,20,20], null)], true);
  check("C12 …for bodyweight work too", /^Deload week/.test(c.text) && !/Ready for the next/.test(c.text), c.text);

  // acceptance 2: across every loaded exercise and a spread of histories, no invented load
  const sweep = await page0.evaluate(([dates])=>{
    const out = [];
    const S = (date, reps, weight)=>({ date, total:reps.reduce((a,b)=>a+b,0), weight,
      sets: reps.map(r=>({ reps:r, weight })) });
    EX_REGISTRY.filter(e=>e.loaded).forEach(ex=>{
      const L = achievableLoads(ex);
      [[2.5,2.5,2.5],[5,5,5],[10,10,10],[10.5,10.5,10.5],[11.5,11.5,8],[24,24,24],[48,48,48],[3,3,3]].forEach(reps=>{
        [[dates[1]],[dates[2],dates[1]],[dates[3],dates[2],dates[1]]].forEach(seq=>{
          const sessions = seq.map(d=>S(d, reps, reps[0]));
          const c = coachFor(ex, sessions, false);
          out.push({ id:ex.id, reps:reps[0], text:c.text, weight:c.weight, ladder:L, working:reps[0] });
        });
      });
    });
    return out;
  }, [MON, weekAgo(1), weekAgo(2), weekAgo(3)]);
  const offLadder = sweep.filter(x=>x.weight!=null && x.weight!==x.working && !x.ladder.includes(x.weight));
  check("C13 acceptance 2: no suggestion outside the exercise's achievable loads (never 12/13 kg on dumbbells)",
    offLadder.length===0, offLadder.slice(0,4).map(x=>`${x.id} ${x.reps}→${x.weight}`).join(", "));
  // a "hold" repeats the weight already used, so only a *new* load has to be on the ladder
  const aboveCeiling = sweep.filter(x=>x.weight!=null && x.weight!==x.working && x.weight>Math.max(...x.ladder));
  check("C13 …and never above the top of the ladder", aboveCeiling.length===0, aboveCeiling.map(x=>`${x.id} ${x.weight}`).join(", "));
  await done(page0);

  // ---- the card: last session, today's suggestion, the tag, the wording ----
  const seed = { workout_log:[
      ...rows(weekAgo(2), "ohpress", [10,10,10], 10.5),
      ...rows(weekAgo(1), "ohpress", [10,10,10], 10.5),
      ...rows(weekAgo(2), "pushups", [20,20,20], null),
      ...rows(weekAgo(1), "pushups", [20,20,20], null),
      ...rows(weekAgo(2), "dips", [12,12,12], null),
      ...rows(weekAgo(1), "dips", [12,12,12], null),
      ...rows(weekAgo(1), "splitsquat", [10,10,10], [10.5,8,8]),
      ...rows(weekAgo(1), "kbswings", [15,15,15], 18.14),
    ], day_status:[] };
  { const S1 = makeServer(seed); const page = await newPage(browser, BASE, S1);
    await sleep(400);
    const mon = await page.evaluate(()=>{
      const c = id=>document.querySelector(`.card[data-exid="${id}"]`);
      const today = id=>c(id).querySelector(`[data-today="${id}"]`).textContent;
      return { ohLast:c("ohpress").querySelector('[data-last="ohpress"]').textContent, ohToday:today("ohpress"),
               pushToday:today("pushups"),
               ohHead:c("ohpress").querySelector(".setshead").textContent.trim(),
               names:[...document.querySelectorAll(".card .ex-name")].map(e=>e.textContent),
               overflow:Math.max(...[...document.querySelectorAll(".card")].map(x=>x.scrollWidth)) };
    });
    await page.tab(2);
    const wed = await page.evaluate(()=>{
      const c = id=>document.querySelector(`.card[data-exid="${id}"]`);
      return { splitLast:c("splitsquat").querySelector('[data-last="splitsquat"]').textContent,
               kbToday:c("kbswings").querySelector('[data-today="kbswings"]').textContent,
               kbLast:c("kbswings").querySelector('[data-last="kbswings"]').textContent,
               squatHead:c("squats").querySelector(".setshead").textContent.trim(),
               overflow:Math.max(...[...document.querySelectorAll(".card")].map(x=>x.scrollWidth)) };
    });
    await page.tab(0);
    const d1 = await page.evaluate(d=>fmtDate(d), weekAgo(1));
    check("C14 the card shows last session's date, working weight and reps per set",
      mon.ohLast===`${d1} · 10.5 kg · 10 / 10 / 10`, mon.ohLast);
    check("C14 …per set when the set weights differ", wed.splitLast===`${d1} · 10.5 / 8 kg · 10 / 10 / 10`, wed.splitLast);
    check("C14 …and today's suggestion with its reasoning", mon.ohToday.startsWith("Try 11.5 kg — aim for 6") && /two sessions running/.test(mon.ohToday), mon.ohToday);
    check("C14 bodyweight card: ready for the next progression", mon.pushToday.startsWith("Ready for the next progression"), mon.pushToday);
    check("C14 kbswings: the fixed load, no suggestion", wed.kbToday.startsWith("18.1 kg — top of the set") && /18\.1 kg · 15 \/ 15 \/ 15/.test(wed.kbLast), `${wed.kbToday} · ${wed.kbLast}`);
    check("C15 acceptance 10: the suggestion never pre-fills a field", await page.evaluate(()=>{
      const w=[...document.querySelectorAll('.setweight[data-ex="ohpress"]')].map(e=>e.value);
      const r=[...document.querySelectorAll('.stepper input[data-ex="ohpress"]')].map(e=>e.value);
      return w.every(v=>v==="") && r.every(v=>v==="");
    }));
    check("C16 sets head says per hand/side for per-hand work and total for total work",
      /per hand\/side/.test(mon.ohHead) && wed.squatHead==="kg · total", `${mon.ohHead} / ${wed.squatHead}`);
    check("C17 the three display names changed: DB Overhead Press, DB Floor Press, DB Rows",
      mon.names.includes("DB Overhead Press") && mon.names.includes("DB Floor Press"), mon.names.join(", "));
    await page.tab(4);
    const pull = await page.evaluate(()=>({ names:[...document.querySelectorAll(".card .ex-name")].map(e=>e.textContent),
                                            overflow:Math.max(...[...document.querySelectorAll(".card")].map(x=>x.scrollWidth)) }));
    await page.tab(0);
    check("C17 …and DB Rows on the pull day (the ids are unchanged — ids.lock.json is untouched)",
      pull.names.includes("DB Rows"), pull.names.join(", "));
    check("C19 coached cards fit 390 px on the push, legs and pull days",
      mon.overflow<=390 && wed.overflow<=390 && pull.overflow<=390, `${mon.overflow} / ${wed.overflow} / ${pull.overflow} px`);

    // the tag now follows repMax, not a flat 15
    await page.fill(reps("pushups",0), "15"); await page.fill(reps("pushups",1), "15"); await page.fill(reps("pushups",2), "15");
    await sleep(300);
    const at15 = await page.locator('[data-adv="pushups"]').evaluate(e=>e.classList.contains("show"));
    await page.fill(reps("pushups",1), "20"); await page.fill(reps("pushups",2), "20"); await page.fill(reps("pushups",0), "20");
    await sleep(300);
    const at20 = await page.locator('[data-adv="pushups"]').evaluate(e=>e.classList.contains("show"));
    check("C18 the 'Ready to advance' tag follows repMax (push-ups 20, not a flat 15)", !at15 && at20, `15s: ${at15}, 20s: ${at20}`);
    await page.tab(4); await page.fill(reps("scapulapull",0), "10"); await page.fill(reps("scapulapull",1), "10"); await page.fill(reps("scapulapull",2), "10");
    await sleep(300);
    check("C18 …and a lower range reaches it sooner (scapula pull-ups, 10)", await page.locator('[data-adv="scapulapull"]').evaluate(e=>e.classList.contains("show")));
    await page.tab(0);

    await page.locator('.card[data-exid="ohpress"]').screenshot({ path:__dirname+"/.tmp/coach-card.png" });
    errors.push(...page.errors); await page.ctx.close(); }

  { const S2 = makeServer(seed); const page = await newPage(browser, BASE, S2);
    await sleep(400);
    const online = await page.locator('[data-today="ohpress"]').textContent();
    S2.offline = true;
    await page.reload2(1400); await sleep(600);
    const offline = await page.locator('[data-today="ohpress"]').textContent();
    check("C20 acceptance 12: the same suggestion shows offline, from the copy kept on the device",
      offline===online && offline.startsWith("Try 11.5 kg"), `${online} → ${offline}`);
    await done(page); }

  // ---- Progress: the ready badge follows the same repMax rule ----
  { const S3 = makeServer(seed); const page = await newPage(browser, BASE, S3);
    await page.click("#tabProgress"); await sleep(900);
    const pg = await page.evaluate(()=>{
      const cards = [...document.querySelectorAll("#progressView .chartcard")];
      const ready = id=>{ const c = cards.find(x=>x.dataset.exid===id) || cards.find(x=>x.querySelector(".nm").childNodes[0].textContent===EX_REGISTRY.find(e=>e.id===id).name); return c ? /Ready to advance/.test(c.textContent) : null; };
      return { pushups:ready("pushups"), dips:ready("dips"), charts:document.querySelectorAll("#progressView svg").length };
    });
    check("C21 Progress marks push-ups ready (20 reps twice) but not dips (12 reps, under 15)", pg.pushups===true && pg.dips===false && pg.charts>0, JSON.stringify(pg));
    errors.push(...page.errors); await page.ctx.close(); }

  await browser.close();
  finish("equipment ladders + session coaching", errors);
})();
