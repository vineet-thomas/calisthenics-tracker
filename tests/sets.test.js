// Per-set weights (brief item A) and "never save 0 reps" (item D), plus the reading rules:
// sets without reps are invisible; a date is a session only if a set has reps; negatives are read
// from set 1's row regardless. Fake backend; Monday's Push (ohpress is a loaded exercise), Friday's
// Pull (rows records negatives).
const { chromium } = require("playwright-core");
const { makeServer, newPage, sleep, reporter } = require("./lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const { check, finish } = reporter();
const reps = (ex,i)=>`.stepper input[data-ex="${ex}"][data-set="${i}"]`;
const wt = (ex,i)=>`.setweight[data-ex="${ex}"][data-set="${i}"]`;
const badge = p=>p.locator("#syncBadge").textContent();
// cloud rows for an exercise: "set:reps@weight", sorted by set
const cloud = (S, ex)=>(S.db.workout_log||[]).filter(r=>r.exercise_id===ex).sort((a,b)=>a.set_index-b.set_index)
  .map(r=>`${r.set_index+1}:${r.reps==null?"-":r.reps}@${r.weight_kg==null?"-":r.weight_kg}`).join(" ");
const field = async (page, ex, i)=>({ v: await page.inputValue(wt(ex,i)), inherited: await page.locator(wt(ex,i)).evaluate(e=>e.classList.contains("inherited")) });

(async()=>{
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const errors = [];
  const done = async p=>{ errors.push(...p.errors); await p.ctx.close(); };

  // A1–A4: weight once, inheritance, hand edits, rows
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    await page.fill(wt("ohpress",0), "10.5"); await sleep(700);
    const f3 = await field(page, "ohpress", 2);
    check("A1 set 3 shows set 1's weight straight away, marked inherited", f3.v==="10.5" && f3.inherited, JSON.stringify(f3));
    check("A1 …but nothing is saved before any reps (no rows)", cloud(S,"ohpress")==="", cloud(S,"ohpress"));
    await page.fill(reps("ohpress",0), "10"); await sleep(150);
    await page.fill(reps("ohpress",1), "10"); await sleep(150);
    await page.fill(reps("ohpress",2), "9"); await sleep(1200);
    check("A2 weight entered once, three sets logged → all three rows carry weight_kg (acceptance 1)", cloud(S,"ohpress")==="1:10@10.5 2:10@10.5 3:9@10.5", cloud(S,"ohpress"));
    check("A2 …and the fields are no longer 'inherited' once saved", !(await field(page,"ohpress",2)).inherited);
    await page.fill(wt("ohpress",2), "8"); await sleep(400);
    await page.fill(wt("ohpress",0), "11.5"); await sleep(1200);
    check("A3 set 3 edited by hand, then set 1 changed → set 3 keeps its value, set 2 follows (acceptance 2)", cloud(S,"ohpress")==="1:10@11.5 2:10@11.5 3:9@8", cloud(S,"ohpress"));
    check("A3 …on screen too", (await page.inputValue(wt("ohpress",1)))==="11.5" && (await page.inputValue(wt("ohpress",2)))==="8");
    await page.fill(wt("ohpress",2), "11.5"); await sleep(300);
    await page.fill(wt("ohpress",0), "13.5"); await sleep(1200);
    check("A4 a set typed equal to set 1 follows set 1 (by value)", cloud(S,"ohpress")==="1:10@13.5 2:10@13.5 3:9@13.5", cloud(S,"ohpress"));
    await page.reload2(1200);
    const after = await Promise.all([0,1,2].map(i=>field(page,"ohpress",i)));
    check("A5 after a refresh, each set shows its own saved weight", after.map(x=>x.v).join(",")==="13.5,13.5,13.5" && after.every(x=>!x.inherited), JSON.stringify(after));
    await done(page); }

  // A6: offline — inherited values queue and sync like any other write (acceptance 6)
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    S.offline = true;
    await page.fill(wt("ohpress",0), "10.5"); await sleep(150);
    for(const i of [0,1,2]){ await page.fill(reps("ohpress",i), "10"); await sleep(150); }
    await sleep(800);
    check("A6 offline: queued, nothing in the cloud yet", /unsynced/.test(await badge(page)) && cloud(S,"ohpress")==="", await badge(page));
    S.offline = false; await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1500);
    check("A6 back online: all three rows with their weights", cloud(S,"ohpress")==="1:10@10.5 2:10@10.5 3:10@10.5" && (await badge(page))==="Synced", cloud(S,"ohpress"));
    await done(page); }

  // A7: a weight typed for a set not done yet survives a refresh, and still isn't saved
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    await page.fill(wt("ohpress",0), "9.5"); await sleep(800);
    await page.reload2(1200);
    check("A7 weight typed before any reps survives a refresh (kept on the device)", (await page.inputValue(wt("ohpress",0)))==="9.5" && (await page.inputValue(wt("ohpress",2)))==="9.5", await page.inputValue(wt("ohpress",0)));
    check("A7 …and still has no row", cloud(S,"ohpress")==="");
    await done(page); }

  // D1–D4: 0 is never saved
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    await page.click('.stepper button[data-act="dec"][data-ex="pushups"][data-set="2"]'); await sleep(900);
    check("D1 '−' on an empty set writes nothing", cloud(S,"pushups")==="" && S.writes("pushups")===0, `${S.writes("pushups")} writes`);
    await page.fill(reps("pushups",0), "12"); await sleep(900);
    await page.fill(reps("pushups",0), ""); await sleep(900);
    check("D2 clearing a logged set keeps its row with no reps — never 0 (acceptance 5)", cloud(S,"pushups")==="1:-@-", cloud(S,"pushups"));
    await page.fill(reps("pushups",1), "5"); await sleep(400);
    for(let k=0;k<5;k++){ await page.click('.stepper button[data-act="dec"][data-ex="pushups"][data-set="1"]'); await sleep(60); }
    await sleep(900);
    check("D3 stepping a set down to 0 saves no reps, not 0", cloud(S,"pushups")==="1:-@- 2:-@-", cloud(S,"pushups"));
    const zeros = S.calls.filter(c=>c.op==="upsert" && c.body.reps===0).length;
    check("D4 no request ever carried reps = 0", zeros===0, `${zeros} with reps 0`);
    await done(page); }

  // D5: an entry queued by an older version with reps 0 is sent as "no reps"
  { const S = makeServer(); S.offline = true;
    const page = await newPage(browser, BASE, S, { before: async p=>p.addInitScript(()=>{
      if(sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded","1");
      const t=new Date(), o=t.getDay()===0?-6:1-t.getDay(); t.setDate(t.getDate()+o);
      const mon = t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");
      localStorage.setItem("calisthenics-outbox-v1", JSON.stringify([{ t:"log", uid:"u1", date:mon, day:"Mon", ex:"dips", set:2, f:{ reps:0 }, ts:new Date().toISOString(), rev:1 }])); }) });
    S.offline = false; await page.evaluate(()=>window.dispatchEvent(new Event("online"))); await sleep(1500);
    const sent = S.calls.filter(c=>c.op==="upsert" && c.body.exercise_id==="dips");
    check("D5 a queued reps = 0 from an older version is sent as no reps", sent.length===1 && sent[0].body.reps===null, JSON.stringify(sent.map(c=>c.body.reps)));
    await done(page); }

  // R1–R3: reading rules in Progress
  { const S = makeServer({ day_status:[], workout_log:[
      // 5 Oct: a real session (2 sets)
      { user_id:"u1", log_date:"2026-10-05", day:"Mon", exercise_id:"rows", set_index:0, reps:8, negatives:4, updated_at:"2026-10-05T00:00:00Z" },
      { user_id:"u1", log_date:"2026-10-05", day:"Mon", exercise_id:"rows", set_index:1, reps:7, updated_at:"2026-10-05T00:00:00Z" },
      // 12 Oct: negatives recorded, no set has reps (cleared / never logged) → not a session, still on the negatives chart
      { user_id:"u1", log_date:"2026-10-12", day:"Mon", exercise_id:"rows", set_index:0, reps:null, negatives:5, updated_at:"2026-10-12T00:00:00Z" },
      // 19 Oct: legacy reps = 0 and a cleared set → invisible
      { user_id:"u1", log_date:"2026-10-19", day:"Mon", exercise_id:"rows", set_index:0, reps:0, updated_at:"2026-10-19T00:00:00Z" },
      { user_id:"u1", log_date:"2026-10-19", day:"Mon", exercise_id:"rows", set_index:1, reps:null, updated_at:"2026-10-19T00:00:00Z" },
      // ohpress: per-set weights, working weight is set 1's
      { user_id:"u1", log_date:"2026-10-05", day:"Mon", exercise_id:"ohpress", set_index:0, reps:10, weight_kg:10.5, updated_at:"2026-10-05T00:00:00Z" },
      { user_id:"u1", log_date:"2026-10-05", day:"Mon", exercise_id:"ohpress", set_index:2, reps:10, weight_kg:8, updated_at:"2026-10-05T00:00:00Z" },
    ] });
    const page = await newPage(browser, BASE, S);
    const h = await page.evaluate(async()=>{ const x = await fetchHistory(true); return { rows:x.sessions.rows, neg:x.negatives.rows, oh:x.sessions.ohpress }; });
    check("R1 sets without reps (cleared, or legacy 0) are invisible: only 5 Oct is a session", h.rows.length===1 && h.rows[0].date==="2026-10-05" && h.rows[0].total===15, JSON.stringify(h.rows));
    check("R2 negatives are read from set 1's row regardless: 5 Oct and 12 Oct both on the series", h.neg.map(n=>n.date+":"+n.negatives).join(",")==="2026-10-05:4,2026-10-12:5", JSON.stringify(h.neg));
    check("R3 working weight is set 1's (10.5), not a later set's (8)", h.oh.length===1 && h.oh[0].weight===10.5, JSON.stringify(h.oh));
    await page.click("#tabProgress"); await sleep(800);
    const card = await page.evaluate(()=>{ const c=[...document.querySelectorAll("#progressView .chartcard")].find(x=>x.querySelector(".nm").textContent.startsWith("Rows")); return { text:c.innerText, charts:c.querySelectorAll("svg").length }; });
    check("R2 the negatives chart is shown in Progress (it never rendered before 1.3.0)", /1 session/.test(card.text) && /Negatives/.test(card.text) && card.charts===2, card.text.replace(/\n+/g," | ").slice(0,140));
    await done(page); }

  // M1: an old single weight in the phone's saved copy carries over to set 1
  { const S = makeServer(); S.offline = true;
    const page = await newPage(browser, BASE, S, { before: async p=>p.addInitScript(()=>{
      if(sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded","1");
      const t=new Date(), o=t.getDay()===0?-6:1-t.getDay(); t.setDate(t.getDate()+o);
      const mon = t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");
      localStorage.setItem("calisthenics-75hard-cache-v2", JSON.stringify({ [mon]:{ ohpress:[10,0,0], ohpress_weight:"10" } })); }) });
    const f = await Promise.all([0,1,2].map(i=>field(page,"ohpress",i)));
    check("M1 pre-1.3.0 saved weight shows on set 1 and is inherited by sets 2–3", f.map(x=>x.v).join(",")==="10,10,10" && !f[0].inherited && f[1].inherited, JSON.stringify(f));
    check("M1 …and the old key is gone from the saved copy", await page.evaluate(()=>!JSON.stringify(state).includes("_weight")));
    await done(page); }

  // L1: layout
  { const S = makeServer(); const page = await newPage(browser, BASE, S);
    await page.fill(wt("ohpress",0), "10.5"); await page.fill(reps("ohpress",0), "10"); await sleep(600);
    const sw = await page.evaluate(()=>document.documentElement.scrollWidth);
    const box = await page.locator(`.card[data-exid="ohpress"]`).boundingBox();
    const fits = await page.evaluate(()=>[...document.querySelectorAll('.card[data-exid="ohpress"] .setrow')].every(r=>r.scrollWidth<=r.clientWidth+1));
    check("L1 no overflow at 390 px; each set row fits", sw<=390 && fits, `scrollWidth=${sw}`);
    await page.locator(`.card[data-exid="ohpress"]`).screenshot({ path: __dirname + "/.tmp/per-set-card.png" });
    check("L1 card rendered", !!box);
    await done(page); }

  await browser.close();
  finish("per-set weights + no zero reps", errors);
})();
