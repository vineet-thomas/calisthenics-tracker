// OCR loaded on demand (the app opens even if the CDN hangs), OCR failures reported as OCR failures,
// and the version + last-sync display. Runs against BASE with the fake backend; the OCR library is
// the genuine pinned file (so its integrity hash is really checked), with recognize() stubbed.
const { chromium } = require("playwright-core");
const { PNG } = require("pngjs");
const { makeServer, newPage, sleep, reporter } = require("./lib/fake");
const BASE = process.env.BASE || "http://localhost:8123/";
const { check, finish } = reporter();
const badge = p=>p.locator("#syncBadge").textContent();
const png = (()=>{ const p = new PNG({ width:4, height:4 }); p.data.fill(255); return PNG.sync.write(p); })();
const SCREEN = { name:"healthifyme.png", mimeType:"image/png", buffer:png };

// When the real library assigns window.Tesseract, swap recognize() for a stub so no 10 MB of OCR data is
// downloaded. window.__ocr = "ok" (default) returns a typical HealthifyMe summary; "throw" fails.
const stubRecognize = page=>page.addInitScript(()=>{
  let T; Object.defineProperty(window, "Tesseract", { configurable:true, get(){ return T; }, set(v){
    T = v; if(v) v.recognize = async()=>{ if(window.__ocr==="throw") throw new Error("recognize failed");
      return { data:{ text:"Calories 2100 kcal\nProtein 150 g\nCarbs 230 g\nFat 60 g" } }; }; } });
});
// count, fail or stall requests for the OCR library
const ocrRoute = (page, state)=>page.route("**/tesseract.min.js", async r=>{
  state.requests = (state.requests||0) + 1;
  if(state.mode==="hang") return;                                   // never answers
  if(state.mode==="fail") return r.abort("connectionfailed");
  return r.fallback();                                              // genuine file from lib/fake.js
});
const openFood = async page=>{ await page.click("#tabNutrition"); await sleep(600); };
const pick = async page=>{ await page.setInputFiles("#nutShot", SCREEN); };
const ocrStatus = page=>page.locator("#ocrStatus").textContent();
const syncMessage = async page=>(await page.locator("#userErr.show").count())===1;

(async()=>{
  const browser = await chromium.launch({ channel:"chrome", headless:true });
  const errors = [];
  const done = async p=>{ errors.push(...p.errors.filter(e=>!/OCR|connectionfailed|ERR_CONNECTION_FAILED|tesseract/i.test(e))); await p.ctx.close(); };

  // 1. the app opens while the OCR CDN hangs, and doesn't even ask for it
  { const S = makeServer(), ocr = { mode:"hang" }; let t0;
    const page = await newPage(browser, BASE, S, { before: async p=>{ await stubRecognize(p); await ocrRoute(p, ocr); t0 = Date.now(); } });
    const ms = Date.now() - t0;
    check("1a app opens with the OCR CDN hanging", await page.locator("#content .banner").count()===1 && ms < 5000, `${ms} ms incl. test settle time`);
    check("1b the OCR library isn't requested at startup", !ocr.requests, `${ocr.requests||0} request(s)`);
    await done(page); }

  // 2. OCR works on first use; the library downloads once and its integrity hash is accepted
  { const S = makeServer(), ocr = {};
    const page = await newPage(browser, BASE, S, { before: async p=>{ await stubRecognize(p); await ocrRoute(p, ocr); } });
    await openFood(page); await pick(page); await sleep(1500);
    const vals = await page.evaluate(()=>["nutCal","nutPro","nutCarb","nutFat"].map(id=>document.getElementById(id).value).join(","));
    check("2a first screenshot: library loads on demand and fills the numbers", /Read 4 value/.test(await ocrStatus(page)) && vals==="2100,150,230,60", `${await ocrStatus(page)} [${vals}]`);
    check("2b integrity hash accepted (library present after load)", await page.evaluate(()=>typeof TESSERACT_SRI==="string" && !!document.querySelector(`script[src="${TESSERACT_SRC}"][integrity="${TESSERACT_SRI}"][crossorigin="anonymous"]`)));
    await pick(page); await sleep(800);
    check("2c second screenshot reuses it (one download)", ocr.requests===1, `${ocr.requests} request(s)`);
    await done(page); }

  // 3. CDN down: an OCR message, not a sync message; logged; next try works once it's back
  { const S = makeServer(), ocr = { mode:"fail" };
    const page = await newPage(browser, BASE, S, { before: async p=>{ await stubRecognize(p); await ocrRoute(p, ocr); } });
    await openFood(page); await pick(page); await sleep(1200);
    check("3a CDN down: says the screenshot reader couldn't load", /Couldn't load the screenshot reader/.test(await ocrStatus(page)), await ocrStatus(page));
    check("3b …without the 'Couldn't sync just now' message", !(await syncMessage(page)));
    check("3c …and the sync badge is unaffected", (await badge(page))==="Synced", await badge(page));
    check("3d the failure is logged to error_log as OCR_LOAD", (S.db.error_log||[]).some(r=>r.context==="OCR_LOAD"));
    ocr.mode = "ok"; await pick(page); await sleep(1500);
    check("3e once the CDN is back, the next screenshot works", /Read 4 value/.test(await ocrStatus(page)), await ocrStatus(page));
    await done(page); }

  // 4. CDN hangs during OCR: gives up after 20 s with the same message
  { const S = makeServer(), ocr = { mode:"hang" };
    const page = await newPage(browser, BASE, S, { clock:true, before: async p=>{ await stubRecognize(p); await ocrRoute(p, ocr); } });
    await page.click("#tabNutrition"); await page.clock.runFor(800); await sleep(300);
    await pick(page); await page.clock.runFor(19000); await sleep(200);
    const waiting = await ocrStatus(page);
    await page.clock.runFor(2000); await sleep(300);
    check("4a CDN hanging: still trying at 19 s, gives up by 21 s with the OCR message", /Reading screenshot/.test(waiting) && /Couldn't load the screenshot reader/.test(await ocrStatus(page)), `${waiting} → ${await ocrStatus(page)}`);
    check("4b …without the sync message", !(await syncMessage(page)));
    await done(page); }

  // 5. reading fails: OCR message, no sync message
  { const S = makeServer(), ocr = {};
    const page = await newPage(browser, BASE, S, { before: async p=>{ await stubRecognize(p); await ocrRoute(p, ocr); } });
    await page.evaluate(()=>{ window.__ocr = "throw"; });
    await openFood(page); await pick(page); await sleep(1500);
    check("5a reading fails: 'OCR failed — enter numbers manually'", /OCR failed/.test(await ocrStatus(page)), await ocrStatus(page));
    check("5b …without the sync message, and logged as OCR", !(await syncMessage(page)) && (S.db.error_log||[]).some(r=>r.context==="OCR"));
    await done(page); }

  // 6. version + last sync
  { const S = makeServer(); S.offline = true;                        // first ever open, no connection
    const page = await newPage(browser, BASE, S);
    const v = await page.evaluate(()=>APP_VERSION);
    check("6a version shown in the footer", (await page.locator("#appVer").textContent())==="v"+v && await page.locator("#appVer").isVisible(), await page.locator("#appVer").textContent());
    await page.click("#tabProgress"); await sleep(300);
    check("6b …on every tab", await page.locator("#appVer").isVisible());
    await page.click("#tabTrain");
    await page.click("#syncBadge"); await sleep(200);
    check("6c panel: version and 'not yet' before any sync", (await page.locator("#syncBody").innerText()).includes(`v${v} · not yet on this device`), (await page.locator("#syncBody").innerText()).split("\n").slice(1,3).join(" | "));
    await page.click("#syncClose");
    S.offline = false; await page.reload2(1200);
    await page.click("#syncBadge"); await sleep(200);
    const row = await page.locator("#syncBody").innerText();
    check("6d after syncing: 'today HH:MM'", new RegExp(`v${v.replace(/\./g,"\\.")} · today \\d{1,2}:\\d{2}`).test(row), row.split("\n").slice(1,3).join(" | "));
    await page.click("#syncClose");
    S.offline = true; await page.reload2(1200);
    await page.click("#syncBadge"); await sleep(200);
    check("6e still shows the last sync time when opened offline", /· today \d{1,2}:\d{2}/.test(await page.locator("#syncBody").innerText()));
    const sw = await page.evaluate(()=>document.documentElement.scrollWidth);
    check("6f no overflow at 390 px", sw<=390, `scrollWidth=${sw}`);
    await page.screenshot({ path: __dirname + "/.tmp/sync-panel-version.png" });
    await page.click("#syncClose");
    const toast = ()=>page.evaluate(()=>{ const c=getComputedStyle(document.getElementById("saved")); return { pos:c.position, op:+c.opacity }; });
    const idle = await toast();
    check("6g 'Saved ✓' toast is hidden when idle (not stray text at the page bottom)", idle.pos==="fixed" && idle.op===0, JSON.stringify(idle));
    S.offline = false; await page.fill('.stepper input[data-ex="pushups"][data-set="0"]', "5"); await sleep(900);
    const shown = await toast();
    check("6h …and shows after a save", shown.pos==="fixed" && shown.op===1, JSON.stringify(shown));
    await done(page); }

  await browser.close();
  finish("ocr + version", errors);
})();
