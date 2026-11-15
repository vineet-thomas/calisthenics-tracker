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
    return { text:c.text, why:c.why, weight:c.weight, ready:c.ready };
  }, [exId, sessions, deload]);
  const g = (...a)=>coach(...a);

  let c = await g("ohpress", []);
  check("C1 no history → no suggestion, the range only", c.weight===null && /No weighted session yet — 6–10 reps/.test(c.text), c.text);
  c = await g("ohpress", [S(weekAgo(1), [10,10,10], 10.5)]);
  check("C2 all sets at the top, one session → hold, repeat to confirm", /^Repeat 10\.5 kg to confirm/.test(c.text) && c.weight===10.5, c.text);
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], 10.5), S(weekAgo(1), [10,10,10], 10.5)]);
  check("C3 all sets at the top, two sessions running → next achievable load, aim for repMin",
    c.text==="Try 11.5 kg — aim for 6" && c.weight===11.5 &&
    c.why==="You did 10 / 10 / 10 at 10.5 kg twice running.", `${c.text} · ${c.why}`);
  c = await g("ohpress", [S(weekAgo(2), [8,8,7], 11.5), S(weekAgo(1), [8,8,7], 11.5)]);
  check("C4 mid-range → hold, aim for repMax", /^Same weight — aim for 10/.test(c.text) && c.weight===11.5, c.text);
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], 24), S(weekAgo(1), [5,10,10], 24)]);
  check("C5 any set below repMin → one rung down, never more (24 → 23, not 20.5)", /^Drop to 23 kg/.test(c.text) && c.weight===23, c.text);
  check("C5 …and it says which set was short, not that all of them were",
    c.why==="Set 1 did 5 at 24 kg — the target is 6–10.", c.why);
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
    c.text==="Ready for the next progression" && /twice running/.test(c.why) && c.ready===true, `${c.text} · ${c.why}`);
  c = await g("pushups", [S(weekAgo(1), [20,20,20], null)]);
  check("C10 bodyweight, one session at repMax → repeat to confirm", /^At the top — repeat to confirm/.test(c.text) && c.ready===false, c.text);
  c = await g("pushups", [S(weekAgo(1), [15,15,15], null)]);
  check("C10 bodyweight, mid-range → aim for repMax", c.text==="Aim for 20 on every set", c.text);
  c = await g("pushups", [S(weekAgo(1), [13,10,10], null)]);
  check("C10 bodyweight, a set below repMin → ease the variation or add assistance", /^Below the range/.test(c.text), c.text);
  check("C10 …naming only the sets that missed the range (13 / 10 / 10 is not \"under 12\")",
    c.why==="Sets 2 and 3 did 10 — the target is 12–20.", c.why);
  c = await g("dips", []);
  check("C10 bodyweight with no history → the range only", /No session yet — work in the 6–12 rep range/.test(c.text) && c.weight===null, c.text);

  // squats: bodyweight rows from before 11 Nov must never be compared with loaded work
  c = await g("squats", [S(weekAgo(2), [12,12,12], null), S(weekAgo(1), [12,12,12], null)]);
  check("C11 squats: bodyweight history only → no weighted session, nothing suggested", /No weighted session yet/.test(c.text) && c.weight===null, c.text);
  c = await g("squats", [S(weekAgo(2), [12,12,12], null), S(weekAgo(1), [12,12,12], 24)]);
  check("C11 squats: the bodyweight session doesn't count as the second at the top → hold", /^Repeat 24 kg to confirm/.test(c.text), c.text);

  // deload week: never told to add weight in a week designed to be lighter
  c = await g("ohpress", [S(weekAgo(2), [10,10,10], 10.5), S(weekAgo(1), [10,10,10], 10.5)], true);
  check("C12 deload week suppresses the up-suggestion", /^Deload week — hold 10\.5 kg/.test(c.text) && c.weight===10.5, c.text);
  c = await g("pushups", [S(weekAgo(2), [20,20,20], null), S(weekAgo(1), [20,20,20], null)], true);
  check("C12 …for bodyweight work too", /^Deload week/.test(c.text) && !/Ready for the next/.test(c.text) && c.ready===false, c.text);

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

  // ---- cues must not quote an increment the ladder can't deliver ----
  const cues = await page0.evaluate(()=>{
    const by = {};
    DAYS.forEach(d=>(((d.data||{}).work)||[]).forEach(x=>{ if(x.id) by[x.id]=x.cue||""; }));
    return EX_REGISTRY.map(e=>({ id:e.id, cue:by[e.id]||"" }));
  });
  const withKg = cues.filter(c=>/(add|increase)\s+\d+(\.\d+)?\s*kg/i.test(c.cue));
  check("C22 no cue tells you to add a weight (2.5 kg is not a rung: from 10.5 the next dumbbell is 11.5)",
    withKg.length===0, withKg.map(c=>c.id).join(", "));
  check("C22 …the two that did now defer to the suggestion (\"go up a rung … twice running\")",
    /go up a rung when all 3 sets hit the top of the range twice running/i.test(cues.find(c=>c.id==="ohpress").cue) &&
    /go up a rung when all 3 sets hit the top of the range twice running/i.test(cues.find(c=>c.id==="squats").cue),
    [cues.find(c=>c.id==="ohpress").cue, cues.find(c=>c.id==="squats").cue].join(" | "));

  const pu = await page0.evaluate(()=>{ let w=null; DAYS.forEach(d=>((d.data||{}).work||[]).forEach(x=>{ if(x.id==="pushups") w=x; }));
    const r = EX_REGISTRY.find(e=>e.id==="pushups"); return { cue:w.cue, target:w.target, name:w.name, min:r.repMin, max:r.repMax }; });
  check("C22 push-ups cue gains the even-sets sentence, the rest of the cue and the 12–20 range are untouched",
    pu.cue.startsWith("Stop 1–2 reps before failure. Full range, elbows ~45°. When 3×20 is clean, add a weighted backpack or move to deficit / archer push-ups.")
    && pu.cue.endsWith(" Even sets — pick a number you can repeat for all three, roughly 80% of your single-set max. Don't empty the tank on set 1.")
    && pu.target==="3 sets · 12–20 reps" && pu.name==="Push-ups" && pu.min===12 && pu.max===20, pu.cue);

  // ---- the advance line is per exercise, not one flat 45 ----
  const th = await page0.evaluate(()=>({
    vals:["pushups","dips","scapulapull","ohpress","squats"].map(id=>[id, ADVANCE_TOTAL(EX_REGISTRY.find(e=>e.id===id))]),
    kb:ADVANCE_TOTAL(EX_REGISTRY.find(e=>e.id==="kbswings")),
  }));
  check("C23 the advance line is 3 × that exercise's repMax (push-ups 60, dips 36, scapula pull-ups 30)",
    JSON.stringify(th.vals)===JSON.stringify([["pushups",60],["dips",36],["scapulapull",30],["ohpress",30],["squats",36]]),
    JSON.stringify(th.vals));
  check("C23 …so a range that tops out below 15 reps is not permanently 'not ready' (overhead press 30)",
    th.vals.find(v=>v[0]==="ohpress")[1]===30 && th.kb===0, JSON.stringify(th));
  await done(page0);

  // ---- the card: last session, today's suggestion, the tag, the wording ----
  const seed = { workout_log:[
      ...rows(weekAgo(2), "ohpress", [10,10,10], 10.5),
      ...rows(weekAgo(1), "ohpress", [10,10,10], 10.5),
      ...rows(weekAgo(2), "pushups", [20,20,20], null),
      ...rows(weekAgo(1), "pushups", [20,20,20], null),
      ...rows(weekAgo(2), "dips", [9,9,9], null),
      ...rows(weekAgo(1), "dips", [9,9,9], null),
      ...rows(weekAgo(2), "scapulapull", [10,10,10], null, "Fri"),
      ...rows(weekAgo(1), "scapulapull", [10,10,10], null, "Fri"),
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
    check("C14 …and today's suggestion with its reasoning", mon.ohToday.startsWith("Try 11.5 kg — aim for 6") && /You did 10 \/ 10 \/ 10 at 10\.5 kg twice running\./.test(mon.ohToday), mon.ohToday);
    check("C14 bodyweight card: ready for the next progression", mon.pushToday.startsWith("Ready for the next progression"), mon.pushToday);
    check("C14 the reason is a sentence on its own line, not a fragment glued to the suggestion", await page.evaluate(()=>{
      const v = document.querySelector('[data-today="ohpress"]'), w = v.querySelector(".cwhy");
      return !!w && getComputedStyle(w).display==="block" && v.firstElementChild.tagName==="B"
             && /^You did |^Set |^Fixed /.test(w.textContent);
    }));
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

    // the tag is the coaching state, so it cannot disagree with the sentence above it
    const tagOn = id=>page.locator(`[data-adv="${id}"]`).evaluate(e=>e.classList.contains("show"));
    check("C18 'Ready to advance' shows at load for a confirmed exercise, next to the sentence that says why",
      await tagOn("pushups") && /^Ready for the next progression/.test(mon.pushToday), mon.pushToday);
    check("C18 …and not for one whose sets are short of the top (dips 9, repMax 12)",
      !(await tagOn("dips")) && /^Aim for 12/.test(await page.locator('[data-today="dips"]').textContent()));
    await page.tab(4);
    check("C18 …the threshold is the exercise's own range: scapula pull-ups confirm at 10 (a flat 15 never could)",
      await tagOn("scapulapull"));
    await page.tab(0);
    // a state, not a counter of today's sets: it is earned by two sessions and is not revoked by a lighter one
    await page.fill(reps("pushups",0), "15"); await page.fill(reps("pushups",1), "15"); await page.fill(reps("pushups",2), "15");
    await sleep(300);
    check("C18 …and it still matches the sentence after a lighter set today",
      (await tagOn("pushups")) === /^Ready for the next progression/.test(await page.locator('[data-today="pushups"]').textContent()));
    await page.fill(reps("pushups",1), "20"); await page.fill(reps("pushups",2), "20"); await page.fill(reps("pushups",0), "20");
    await sleep(300);

    // every card on the three training days: tag ⇔ "Ready for the next progression"
    const disagree = [];
    for(const i of [0,2,4]){
      await page.tab(i);
      const rowsOut = await page.evaluate(()=>[...document.querySelectorAll(".card[data-exid]")].map(c=>{
        const id=c.dataset.exid;
        return { id, tag:c.querySelector(`[data-adv="${id}"]`).classList.contains("show"),
                 text:c.querySelector(`[data-today="${id}"]`).textContent };
      }));
      rowsOut.filter(x=>x.tag !== /^Ready for the next progression/.test(x.text)).forEach(x=>disagree.push(x.id));
    }
    await page.tab(0);
    check("C18 the tag and the coaching sentence agree on every card (Mon, Wed, Fri)", disagree.length===0, disagree.join(", "));

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

  // ---- a correction made in Supabase must reach the card ----
  // (the card kept showing "1 / 1 / 10" for a date the cloud had already been corrected to "10 / 10 / 10":
  //  this device's cached copy of that day was overriding the freshly fetched history)
  { const CACHE = "calisthenics-75hard-cache-v2";
    const S4 = makeServer({ workout_log:[
        ...rows(weekAgo(2), "ohpress", [10,10,10], 10.5),
        ...rows(weekAgo(1), "ohpress", [10,10,10], 10.5) ], day_status:[] });
    const stale = {}; stale[weekAgo(1)] = { ohpress:[1,1,10], ohpress_w:[10.5,10.5,10.5] };
    const page = await newPage(browser, BASE, S4, { before: p=>p.addInitScript(([k,v])=>{
      const st = JSON.parse(localStorage.getItem(k)||"{}");
      Object.assign(st, v);                       // what this device cached for that day, before the correction
      localStorage.setItem(k, JSON.stringify(st));
    }, [CACHE, stale]) });
    await sleep(800);
    const last = await page.locator('[data-last="ohpress"]').textContent();
    const today = await page.locator('[data-today="ohpress"]').textContent();
    check("C24 a Supabase correction reaches the card — the device's cached copy of that day can't mask it",
      /10 \/ 10 \/ 10/.test(last) && /^Try 11\.5 kg/.test(today), `${last} · ${today}`);
    // …but a set edited *here* still wins straight away: the edit drops the cached copy of that day
    const edit = await page.evaluate(date=>{
      const later = "2099-01-01";
      const read = ()=>coachSessions(later).ohpress.find(s=>s.date===date).sets.map(s=>s.reps).join("/");
      state[date] = Object.assign(state[date]||{}, { ohpress:[12,12,12], ohpress_w:[10.5,10.5,10.5] });
      const cloudWins = read();                       // before the edit: the cloud copy is the one shown
      pushSet(date, "Mon", "ohpress", 0, { reps: 12 });// exactly what the stepper does
      return { cloudWins, afterEdit:read() };
    }, weekAgo(1));
    check("C24 …while a set edited on this device still shows at once (the edit drops the cached copy of that day)",
      edit.cloudWins==="10/10/10" && edit.afterEdit==="12/12/12", `${edit.cloudWins} → ${edit.afterEdit}`);
    await done(page); }

  // ---- assisted-first dips and pull-ups (ids unchanged): the programme, and negatives on a second exercise ----
  { const old = rows(weekAgo(1), "dips", [7,7,7], null); old[0].negatives = 3;       // an old eccentric-only session
    const S6 = makeServer({ workout_log:old, day_status:[] }); const page = await newPage(browser, BASE, S6);
    await sleep(500);
    const prog = await page.evaluate(()=>{
      const reg = id=>EX_REGISTRY.find(e=>e.id===id);
      const work = id=>{ let w=null; DAYS.forEach(d=>((d.data||{}).work||[]).forEach(x=>{ if(x.id===id) w=x; })); return w; };
      return { dips:{ reg:reg("dips"), work:work("dips") }, rows:{ reg:reg("rows"), work:work("rows") } };
    });
    const D = prog.dips, R = prog.rows;
    check("D1 dips: 'Triceps dips', 3 sets · 6–12 reps, repMin 6 / repMax 12, negatives on, same id",
      D.work.id==="dips" && D.work.name==="Triceps dips" && D.work.target==="3 sets · 6–12 reps" && D.work.negatives===true
      && D.reg.name==="Triceps dips" && D.reg.repMin===6 && D.reg.repMax===12, JSON.stringify([D.work.name, D.work.target, D.reg.repMin, D.reg.repMax]));
    check("D1 …and the cue is the new one: band, negatives last, reduce the band at 3×12",
      /^Band looped across the dip handles/.test(D.work.cue) && /Negatives last, after the working sets\./.test(D.work.cue) && /Reduce the band when 3×12 is clean\.$/.test(D.work.cue), D.work.cue);
    check("D2 pull-ups: 'Pull-ups (assisted)', 3 sets · 6–12 reps, repMin 6 / repMax 12, same id, still has negatives",
      R.work.id==="rows" && R.work.name==="Pull-ups (assisted)" && R.work.target==="3 sets · 6–12 reps" && R.work.negatives===true
      && R.reg.name==="Pull-ups (assisted)" && R.reg.repMin===6 && R.reg.repMax===12, JSON.stringify([R.work.name, R.work.target, R.reg.repMin, R.reg.repMax]));
    check("D2 …and the cue is the new one: even sets, negatives last and unassisted, drop a band at 3×12",
      /^Bands on\./.test(R.work.cue) && /Negatives last, unassisted, after these\./.test(R.work.cue) && /Drop a band when 3×12 is clean\.$/.test(R.work.cue), R.work.cue);

    // the known one-off: 7 / 7 / 7 were negatives, but are read as assisted reps — kept on purpose, no data change
    const dipsToday = await page.locator('[data-today="dips"]').textContent();
    check("D3 the old dips history is read as assisted reps for one session (7 / 7 / 7 → aim for 12)",
      /^Aim for 12 on every set/.test(dipsToday) && /You did 7 \/ 7 \/ 7 last time\./.test(dipsToday), dipsToday);

    // negatives on dips: the input exists, saves to set 1's row, and plots on the negatives chart
    const hasInput = await page.locator('.neginput[data-ex="dips"]').count();
    await page.fill('.neginput[data-ex="dips"]', "4"); await sleep(1500);
    const saved = S6.db.workout_log.filter(r=>r.exercise_id==="dips" && r.log_date===MON);
    check("D4 dips gets its own negatives input, and the value is saved on set 1's row (set_index 0)",
      hasInput===1 && saved.length===1 && saved[0].set_index===0 && saved[0].negatives===4 && (await page.locator("#syncBadge").textContent())==="Synced",
      JSON.stringify(saved.map(r=>[r.set_index, r.reps, r.negatives])));
    const h = await page.evaluate(async()=>{ const x = await fetchHistory(true); return { neg:x.negatives.dips, sess:x.sessions.dips }; });
    check("D4 …it is read back on the negatives series (3 on the old date, 4 today) without becoming a session",
      h.neg.map(n=>n.negatives).join(",")==="3,4" && h.sess.length===1 && h.sess[0].total===21, JSON.stringify(h));
    await page.click("#tabProgress"); await sleep(900);
    const card = await page.evaluate(()=>{ const c=[...document.querySelectorAll("#progressView .chartcard")].find(x=>x.querySelector(".nm").textContent.startsWith("Triceps dips"));
      return { text:c.innerText.replace(/\n+/g," | "), charts:c.querySelectorAll("svg").length }; });
    check("D4 …and the negatives chart now draws for a second exercise: Triceps dips shows two charts (reps + negatives)",
      /Negatives/.test(card.text) && card.charts===2 && /advance \(36\)/.test(await page.evaluate(()=>[...document.querySelectorAll("#progressView .chartcard")].find(x=>x.querySelector(".nm").textContent.startsWith("Triceps dips")).innerHTML)), card.text.slice(0,160));

    // the negatives block used to say "Do these FIRST … full dead hang" for every exercise
    await page.click("#tabTrain"); await sleep(300);
    const dipsHint = await page.evaluate(()=>document.querySelector('.card[data-exid="dips"] .neginput').closest(".assistrow").innerText);
    await page.tab(4);
    const rowsHint = await page.evaluate(()=>document.querySelector('.card[data-exid="rows"] .neginput').closest(".assistrow").innerText);
    check("D5 the negatives text matches 'negatives last' and is right for each movement (no 'FIRST', no dead hang on dips)",
      !/FIRST|dead hang/i.test(dipsHint) && /After the working sets/.test(dipsHint) && !/FIRST/.test(rowsHint) && /After the working sets, unassisted from a full dead hang/.test(rowsHint),
      dipsHint.replace(/\n+/g," | ") + " // " + rowsHint.replace(/\n+/g," | "));
    await done(page); }

  // ---- Progress: the ready badge follows the same repMax rule ----
  { const S3 = makeServer(seed); const page = await newPage(browser, BASE, S3);
    await page.click("#tabProgress"); await sleep(900);
    const pg = await page.evaluate(()=>{
      const cards = [...document.querySelectorAll("#progressView .chartcard")];
      const byId = id=>cards.find(x=>x.dataset.exid===id) || cards.find(x=>x.querySelector(".nm").childNodes[0].textContent===EX_REGISTRY.find(e=>e.id===id).name);
      const ready = id=>{ const c=byId(id); return c ? /Ready to advance/.test(c.textContent) : null; };
      const label = id=>{ const c=byId(id); return c ? [...c.querySelectorAll("text")].map(t=>t.textContent).find(t=>/^advance \(/.test(t)) : null; };
      return { pushups:ready("pushups"), dips:ready("dips"), scap:ready("scapulapull"),
               charts:document.querySelectorAll("#progressView svg").length,
               labelPush:label("pushups"), labelScap:label("scapulapull"),
               head:document.querySelector("#progressView .pg-head p").textContent };
    });
    check("C21 Progress marks push-ups ready (20 reps twice) but not dips (9 reps, under 12)", pg.pushups===true && pg.dips===false && pg.charts>0, JSON.stringify(pg));
    check("C21 …scapula pull-ups are ready at their own top (10), and the line says so", pg.scap===true && pg.labelScap==="advance (30)", `${pg.scap} · ${pg.labelScap}`);
    check("C21 the dashed line is per exercise (push-ups 60), and the heading no longer claims a flat 45",
      pg.labelPush==="advance (60)" && /3 × its top rep count/.test(pg.head) && !/45/.test(pg.head), `${pg.labelPush} · ${pg.head}`);
    errors.push(...page.errors); await page.ctx.close(); }

  await browser.close();
  finish("equipment ladders + session coaching", errors);
})();
