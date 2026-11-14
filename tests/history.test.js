// History beyond Supabase's 1,000-row cap: Progress, Body, Food and Measurements must read every row.
// The fake backend caps every response at 1,000 rows silently, like Supabase.
const { chromium } = require("playwright-core");
const { makeServer, newPage, sleep, reporter } = require("./lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const { check, finish } = reporter();

const iso = d=>d.toISOString().slice(0,10);
const days = n=>{ const out=[], start = Date.UTC(2023,0,1); for(let i=0;i<n;i++) out.push(iso(new Date(start + i*864e5))); return out; };

(async()=>{
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const errors = [];

  // 600 push-up sessions × 3 sets = 1,800 rows; 1,200 days of food, body and measurements
  const dates = days(600), long = days(1200);
  const seed = { workout_log:[], day_status:[], nutrition:[], body_comp:[], measurements:[] };
  dates.forEach((d,i)=>{ for(let s=0;s<3;s++) seed.workout_log.push({ user_id:"u1", log_date:d, day:"Mon", exercise_id:"pushups", set_index:s, reps:10+(i%5), weight_kg:null, updated_at:"2026-01-01T00:00:00Z" }); });
  long.forEach((d,i)=>{
    seed.nutrition.push({ user_id:"u1", log_date:d, calories:2000+i, protein:100+(i%60), carbs:200, fat:60 });
    seed.body_comp.push({ user_id:"u1", log_date:d, weight_kg:80+(i%10)/10, fat_pct:18, lbm_kg:65, muscle_kg:60, visceral:8 });
    seed.measurements.push({ user_id:"u1", log_date:d, waist:85, chest:100, shoulders:115, biceps:35, thigh:58, hips:98, neck:38 });
  });
  const S = makeServer(seed);
  const page = await newPage(browser, BASE, S);

  await page.click("#tabProgress"); await sleep(1500);
  const sub = await page.evaluate(()=>{ const c=[...document.querySelectorAll("#progressView .chartcard")].find(x=>x.querySelector(".nm").textContent.startsWith("Push-ups")); return c ? c.querySelector(".sub").textContent : ""; });
  const last = await page.evaluate(d=>fmtDate(d), dates[dates.length-1]);
  check("Progress: all 600 sessions from 1,800 rows (newest not dropped)", sub.startsWith("600 sessions") && sub.includes(last), `"${sub}" (expected 600 sessions, ending ${last})`);
  const pages = S.calls.filter(c=>c.table==="workout_log" && c.op==="select" && c.range).length;
  check("Progress: read in pages (2 full + 1 empty)", pages===3, `${pages} page requests`);

  const readers = await page.evaluate(async()=>{
    const [n, b, m] = [await fetchNutrition(true), await fetchBody(true), await fetchMeasure(true)];
    return { n:n.length, nLast:n[n.length-1].log_date, b:b.length, bLast:b[b.length-1].log_date, m:m.length, mLast:m[m.length-1].log_date };
  });
  const want = long[long.length-1];
  check("Food: all 1,200 days, newest included", readers.n===1200 && readers.nLast===want, `${readers.n} rows, last ${readers.nLast}`);
  check("Body: all 1,200 days, newest included", readers.b===1200 && readers.bLast===want, `${readers.b} rows, last ${readers.bLast}`);
  check("Measurements: all 1,200 days, newest included", readers.m===1200 && readers.mLast===want, `${readers.m} rows, last ${readers.mLast}`);

  // small histories still work and use a single page
  { const S2 = makeServer({ workout_log:[{ user_id:"u1", log_date:"2026-10-05", day:"Mon", exercise_id:"pushups", set_index:0, reps:12, updated_at:"2026-10-05T00:00:00Z" }], day_status:[] });
    const p2 = await newPage(browser, BASE, S2);
    await p2.click("#tabProgress"); await sleep(800);
    const sub2 = await p2.evaluate(()=>[...document.querySelectorAll("#progressView .chartcard .sub")].map(x=>x.textContent)[0] || "");
    check("small history: shown, one page + one empty", /^1 session/.test(sub2) && S2.calls.filter(c=>c.table==="workout_log" && c.range).length===2, sub2);
    errors.push(...p2.errors); await p2.ctx.close(); }

  errors.push(...page.errors); await page.ctx.close();
  await browser.close();
  finish("history paging", errors);
})();
