// Fake ↔ real parity: the same workout_log upserts go to the fake backend (tests/lib/fake.js) and to real
// PostgREST + Postgres (tests/realstack/schema.sql). Both must accept or refuse, with the same error code.
// If the fake drifts from the database, browser tests can go green while main breaks — this catches it.
const { execSync } = require("child_process");
const crypto = require("crypto");
const { makeServer, reporter } = require("../lib/fake");
const LOCAL = "http://localhost:3300";
const UID = "11111111-1111-1111-1111-111111111111";
const SECRET = "local-test-secret-local-test-secret-0123456789";
const PSQL = `${execSync("brew --prefix postgresql@16").toString().trim()}/bin/psql`;
const sql = q=>execSync(`"${PSQL}" -h localhost -p 54329 -U postgres -d ct -X -q -t -A -c ${JSON.stringify(q)}`).toString().trim();
const { check, finish } = reporter();
const token = (()=>{ const b = o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg:"HS256", typ:"JWT" }), p = b({ sub:UID, role:"authenticated", aud:"authenticated", exp:Math.floor(Date.now()/1000)+3600 });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(h+"."+p).digest("base64url")}`; })();

const base = { user_id:UID, log_date:"2026-11-09", day:"Mon", exercise_id:"pushups", set_index:0 };
const omit = (o, k)=>{ const c = { ...o }; delete c[k]; return c; };
const cases = [
  ["full row", { ...base, reps:10, weight_kg:10.5, updated_at:new Date().toISOString() }],
  ["reps omitted on a new row (default 0)", { ...base, exercise_id:"dips", negatives:4 }],
  ["reps omitted on an existing row (weight-only update)", { ...base, weight_kg:12 }],
  ["reps = 0 (cleared)", { ...base, reps:0 }],
  ["reps = null", { ...base, reps:null }],
  ["reps not an integer", { ...base, reps:12.5 }],
  ["day omitted, row exists", omit({ ...base, reps:11 }, "day")],
  ["day = null", { ...base, day:null, reps:11 }],
  ["set_index omitted", omit({ ...base, exercise_id:"rows", reps:8 }, "set_index")],
  ["exercise_id omitted", omit({ ...base, reps:8 }, "exercise_id")],
  ["updated_at = null (trigger fills it)", { ...base, reps:9, updated_at:null }],
  ["negatives not an integer", { ...base, negatives:2.5 }],
];

(async()=>{
  sql("truncate workout_log");
  const fake = makeServer({ workout_log:[] });
  for(const [name, body] of cases){
    const f = fake.handle({ table:"workout_log", op:"upsert", body:{ ...body }, conf:"user_id,log_date,exercise_id,set_index", filters:[], orders:[] });
    const r = await fetch(`${LOCAL}/workout_log?on_conflict=user_id,log_date,exercise_id,set_index`, { method:"POST",
      headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates" }, body:JSON.stringify(body) });
    const real = r.ok ? null : (await r.json()).code;
    const fakeCode = f.error ? f.error.code : null;
    check(`${name}: fake and Postgres agree`, fakeCode===real, `real ${real||"accepted"} · fake ${fakeCode||"accepted"}`);
  }
  sql("truncate workout_log");
  finish("fake ↔ real parity");
})();
