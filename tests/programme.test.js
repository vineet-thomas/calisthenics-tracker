// Programme display + renderer regression.
//  A. Display rules, checked against whatever programme index.html contains (so a new brief needs no
//     test edits): strength days show exactly their work list; run days show warm-up → run → cool-down;
//     Fast/Rest days show walk → Kalym mobility → cool-down with no warm-up; owner's colour palette;
//     no overflow at 390 px; Progress lists every registered exercise with its history; every
//     exercise on a work list can be logged, synced and reloaded.
//  B. Regression: BASELINE serves main's display code with this branch's programme data, so only
//     display-code changes show up. Every day and the Progress view must match main exactly (page
//     HTML, every element's computed style, pixels). Set ALLOW_RENDER_CHANGE=1 when a PR changes the
//     display on purpose — differences are then listed but don't fail, and must be explained in the PR.
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");
const fs = require("fs"), path = require("path"), vm = require("vm");
const { makeServer, newPage, sleep, reporter } = require("./lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const BASELINE = process.env.BASELINE || "";
const ALLOW = process.env.ALLOW_RENDER_CHANGE === "1";
const { check, finish } = reporter();

// owner decisions: lifting groups keep their colours; runs violet; fast and rest slate
const PALETTE = { push:"#4f8ff0", pull:"#5ec27e", legs:"#e0894a", run:"#8e6fd1", rest:"#7a8691" };
const rgb = h=>{ const n=parseInt(h.slice(1),16); return `rgb(${n>>16}, ${(n>>8)&255}, ${n&255})`; };

const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
const P = vm.runInNewContext(html.slice(html.indexOf("const WARMUP"), html.indexOf("const ADVANCE_TOTAL")) + "\n;({ EX_REGISTRY, DAYS, FOCUS_KIND })", {});

// three past sessions for every registered exercise (weight on set 0 for loaded ones)
function seed(){
  const db = { workout_log:[], day_status:[] };
  ["2026-10-05","2026-10-12","2026-10-19"].forEach((d,k)=>P.EX_REGISTRY.forEach(ex=>{
    for(let s=0;s<3;s++) db.workout_log.push({ user_id:"u1", log_date:d, day:"Mon", exercise_id:ex.id, set_index:s,
      reps:8+k+s, weight_kg:(s===0 && ex.loaded) ? 10+k : null, updated_at:"2026-10-20T00:00:00Z" });
  }));
  return db;
}
const info = page=>page.evaluate(()=>{
  const c = document.getElementById("content");
  const heads = [...c.querySelectorAll(".sechead")].map(h=>h.querySelector(".num").textContent+" "+h.querySelector("h2").textContent);
  const badge = c.querySelector(".badge"), active = document.querySelector(".day.active");
  const cool = [...c.querySelectorAll(".section")].find(s=>s.querySelector("h2").textContent==="Cool-down");
  return { heads, badge:badge.textContent, badgeBg:getComputedStyle(badge).backgroundColor, tab:getComputedStyle(active).borderBottomColor,
    cards:[...c.querySelectorAll(".card[data-exid]")].map(x=>x.dataset.exid),
    circ:[...c.querySelectorAll(".circ")].map(x=>[...x.children].map(e=>e.textContent)),
    stretch: cool ? cool.querySelectorAll("li").length : 0,
    kalym:/Kalym's Complete Calisthenics/.test(c.textContent), overflow:document.documentElement.scrollWidth };
});

(async()=>{
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const errors = [];

  // ---- A. display rules ----
  { const S = makeServer(seed()); const page = await newPage(browser, BASE, S);
    for(let i=0;i<P.DAYS.length;i++){
      const day = P.DAYS[i], kind = P.FOCUS_KIND[day.focus];
      await page.tab(i); const d = await info(page);
      const label = `${day.d} ${day.focus}`;
      check(`${label}: colour ${kind} ${PALETTE[kind]||"?"} on badge and active tab`, PALETTE[kind] && d.badgeBg===rgb(PALETTE[kind]) && d.tab===rgb(PALETTE[kind]), `${d.badgeBg} / ${d.tab}`);
      if(day.data.work){
        check(`${label}: warm-up → workout → cool-down, exactly its ${day.data.work.length} exercises`,
          d.heads.join("|")==="01 Warm-up|02 Workout|03 Cool-down" && JSON.stringify(d.cards)===JSON.stringify(day.data.work.map(x=>x.id)) && d.stretch===day.data.stretch.length,
          `${d.heads.join(" | ")} · ${d.cards.join(",")}`);
      } else if(kind==="run"){
        check(`${label}: warm-up → run → cool-down, circuit as written`,
          d.heads.join("|")==="01 Warm-up|02 Run|03 Cool-down" && JSON.stringify(d.circ)===JSON.stringify(day.data.circuit) && d.stretch===day.data.stretch.length && !d.kalym,
          `${d.heads.join(" | ")} · ${d.circ.map(x=>x.join(" ")).join("; ")}`);
      } else if(kind==="rest"){
        check(`${label}: no warm-up; walk → Kalym mobility → cool-down`,
          d.heads.join("|")==="01 Walk|02 Mobility & Flexibility|03 Cool-down" && JSON.stringify(d.circ)===JSON.stringify(day.data.circuit) && d.kalym && d.stretch===day.data.stretch.length,
          `${d.heads.join(" | ")} · ${d.circ.map(x=>x.join(" ")).join("; ")}`);
      } else check(`${label}: known day type`, false, `kind=${kind}`);
      check(`${label}: no horizontal overflow at 390 px`, d.overflow<=390, `scrollWidth=${d.overflow}`);
    }

    await page.click("#tabProgress"); await sleep(800);
    const prog = await page.evaluate(()=>[...document.querySelectorAll("#progressView .chartcard")].map(c=>({
      name:c.querySelector(".nm").childNodes[0].textContent, sub:(c.querySelector(".sub")||{}).textContent||"" })));
    const groups = new Set(P.EX_REGISTRY.map(e=>e.color));
    check(`Progress lists all ${P.EX_REGISTRY.length} registered exercises in order`, JSON.stringify(prog.map(p=>p.name))===JSON.stringify(P.EX_REGISTRY.map(e=>e.name)), prog.map(p=>p.name).join(", "));
    check("Progress: exercise colours are only push / pull / legs", [...groups].every(c=>[PALETTE.push,PALETTE.pull,PALETTE.legs].includes(c)), [...groups].join(" "));
    check("Progress: every exercise's history is shown (3 seeded sessions each)", prog.every(p=>/^3 sessions/.test(p.sub)), prog.filter(p=>!/^3 sessions/.test(p.sub)).map(p=>p.name).join(", "));
    await page.click("#tabTrain"); await sleep(300);

    const toLog = [];
    P.DAYS.forEach((d,i)=>(d.data.work||[]).forEach(x=>{ if(!toLog.some(t=>t[1]===x.id)) toLog.push([i,x.id]); }));
    for(const [i,id] of toLog){ await page.tab(i); await page.fill(`.stepper input[data-ex="${id}"][data-set="0"]`, "9"); await sleep(120); }
    await sleep(1500);
    check(`all ${toLog.length} exercises on work lists: logged sets sync`, (await page.locator("#syncBadge").textContent())==="Synced");
    await page.reload2(1200);
    const back = [];
    for(const [i,id] of toLog){ await page.tab(i); back.push(id+"="+await page.inputValue(`.stepper input[data-ex="${id}"][data-set="0"]`)); }
    check("…and come back after a reload", back.every(x=>x.endsWith("=9")), back.filter(x=>!x.endsWith("=9")).join(" "));
    const restIdx = P.DAYS.findIndex(d=>P.FOCUS_KIND[d.focus]==="rest");
    if(restIdx>=0){ await page.tab(restIdx); await page.click("#complete"); await sleep(1000); await page.reload2(1000); await page.tab(restIdx);
      check("rest day: Mark day complete saves", /Day complete/.test(await page.locator("#complete").textContent())); }
    errors.push(...page.errors); await page.ctx.close(); }

  // ---- B. renderer regression against main ----
  if(BASELINE){
    const px = (x,y)=>{ const a=PNG.sync.read(x), b=PNG.sync.read(y); if(a.width!==b.width||a.height!==b.height) return `size ${a.width}x${a.height} vs ${b.width}x${b.height}`;
      let n=0; for(let k=0;k<a.data.length;k+=4) if(a.data[k]!==b.data[k]||a.data[k+1]!==b.data[k+1]||a.data[k+2]!==b.data[k+2]) n++; return n; };
    const dom = p=>p.evaluate(()=>{ const v=[...document.querySelectorAll(".wrap > div")].find(e=>e.style.display!=="none" && e.id.endsWith("View")); return v.innerHTML; });
    const css = p=>p.evaluate(()=>{ const v=[...document.querySelectorAll(".wrap > div")].find(e=>e.style.display!=="none" && e.id.endsWith("View"));
      return [...v.querySelectorAll("*")].map(e=>{ const c=getComputedStyle(e); return [c.color,c.backgroundColor,c.border,c.width,c.height,c.fontSize,c.fontWeight,c.padding,c.margin].join(";"); }).join("\n"); });
    const views = [...P.DAYS.map((d,i)=>[`${d.d} ${d.focus}`, async p=>p.tab(i)]), ["Progress view", async p=>{ await p.click("#tabProgress"); await sleep(800); }]];
    const changed = [];
    for(const [name, open] of views){
      const a = await newPage(browser, BASELINE, makeServer(seed())), b = await newPage(browser, BASE, makeServer(seed()));
      await open(a); await open(b); await a.evaluate(()=>window.scrollTo(0,0)); await b.evaluate(()=>window.scrollTo(0,0));
      const sameDom = (await dom(a))===(await dom(b)), sameCss = (await css(a))===(await css(b));
      let diff = px(await a.screenshot({ fullPage:true }), await b.screenshot({ fullPage:true }));
      if(diff!==0 && sameDom && sameCss){ await sleep(300); diff = px(await a.screenshot({ fullPage:true }), await b.screenshot({ fullPage:true })); } // rule out rendering noise
      const same = sameDom && sameCss && diff===0;
      if(!same) changed.push(name);
      const detail = `HTML ${sameDom?"same":"DIFFERENT"}, styles ${sameCss?"same":"DIFFERENT"}, pixels ${diff===0?"same":diff+" differ"}`;
      check(`regression — ${name}: identical to main's display code`, same || ALLOW, same ? detail : detail + (ALLOW ? "  [allowed: explain in the PR]" : ""));
      errors.push(...a.errors, ...b.errors); await a.ctx.close(); await b.ctx.close();
    }
    if(changed.length) console.log(`\nDisplay differs from main on: ${changed.join(", ")}${ALLOW ? " (allowed)" : " — if intended, rerun with ALLOW_RENDER_CHANGE=1 and explain in the PR"}`);
  } else check("regression against main", false, "BASELINE not set — run via tests/run.js");

  await browser.close();
  finish("programme", errors);
})();
