# calisthenics-tracker — v1.2 "Push / Legs / Pull, built around the running week"

Owner: Vineet Thomas · Prepared 3 Nov 2026

## ⚠ This supersedes the v1.1 brief issued earlier today

**Do not apply v1.1.** It restructured PUSH and PULL for a four-day strength week.
Since then the running goals (10 K races, half marathon, VO₂max) and the Thursday
water fast have been factored in, and the week is now three strength days. Apply
**v1.2 only**. If v1.1 was already applied, v1.2 fully replaces the same constants,
so applying v1.2 on top is safe.

## Why

Three things changed the design:

1. **Legs were almost untrained.** One unloaded "squats / lunges" entry, swings and
   20 bodyweight squats. Legs are roughly half of total muscle mass and the goal is
   to regain 9.6 kg (54.4 → 64.0 kg). Legs now get a dedicated day.
2. **Running is a real second goal**, not incidental: 10 K races, a half marathon
   ahead, VO₂max 40 targeting 45+. Tempo and long runs stay and are protected; the
   strength week shrinks to three days to make room.
3. **Thursday is a water fast.** No hard training that day — a depleted, zero-protein
   day is the worst possible slot for intervals or heavy lifting.

## Scope

Six replacements in `index.html`. No schema change, no SQL. Existing exercise `id`s
are preserved so chart history survives; `squats` changes from bodyweight to loaded,
which is intentional.

**Version:** `APP_VERSION` `1.0.0` → `1.2.0`, plus the service-worker cache version
if `sw.js` has one.

---

## Block 1 — replace the `PUSH` constant

```js
const PUSH = {
  work:[
    {id:"pushups",name:"Push-ups",target:"3 sets · 12–20 reps",cue:"Stop 1–2 reps before failure. Full range, elbows ~45°. When 3×20 is clean, add a weighted backpack or move to deficit / archer push-ups."},
    {id:"dips",name:"Box / triceps dips",target:"3 sets · 10–15 reps",cue:"Shoulders down, controlled descent. When 3×15 is clean, add weight in a backpack.",assist:true},
    {id:"ohpress",name:"DB/KB Overhead Press",target:"3 sets · 6–10 reps",cue:"Press straight overhead, avoid arching lower back. Add 2.5 kg when 10 reps feel clean two sessions running.",loaded:true},
    {id:"floorpress",name:"DB/KB Floor Press",target:"3 sets · 8–12 reps",cue:"Lie on floor/mat, press up, elbows stop just short of touching down.",loaded:true},
    {id:"latraise",name:"Lateral Raise",target:"3 sets · 12–20 reps",cue:"Light, slow, lead with the elbows, stop at shoulder height. Shoulder width is most of what makes a lean frame read as muscular.",loaded:true},
  ],
  stretch:[
    ["Doorway chest stretch","30s"],
    ["Overhead triceps","30s ea"],
    ["Standing quad","30s ea"],
    ["Couch stretch (hip flexors)","30s ea"],
  ],
};
```

## Block 2 — new `LEGS` constant

Insert immediately **after** `PUSH`.

```js
const LEGS = {
  work:[
    {id:"squats",name:"Goblet / DB Squat",target:"3 sets · 8–12 reps",cue:"One DB at the chest, or two at the shoulders. Full depth, knees tracking toes. Add 2.5 kg when 12 reps feel clean two sessions running.",loaded:true},
    {id:"splitsquat",name:"Bulgarian Split Squat",target:"3 sets · 8–12 per side",cue:"Rear foot on a chair, a DB in each hand. Front shin near vertical, drive through the heel. Your heaviest available leg stimulus — 2×24 kg through one leg.",loaded:true},
    {id:"rdl",name:"DB Romanian Deadlift",target:"3 sets · 8–12 reps",cue:"DBs in front of the thighs, soft knees, push the hips BACK — not down. Lower until the hamstrings stretch, then drive the hips forward. A four-second lowering makes a light load heavy.",loaded:true},
    {id:"hipthrust",name:"Hip Thrust",target:"3 sets · 10–15 reps",cue:"Shoulder blades on a sofa or bench edge, DB across the hips. Squeeze the glutes hard at the top, 1s pause, chin tucked.",loaded:true},
    {id:"calves",name:"Standing Calf Raise",target:"3 sets · 15–20 reps",cue:"DB in each hand, 1s pause at the top, full stretch at the bottom. Off a step if you have one.",loaded:true},
    {id:"kbswings",name:"Kettlebell Swings",target:"3 sets · 15 reps",cue:"Hinge at the hips, snap the glutes forward at the top — a hinge, not a squat. Conditioning finisher; skip if short of time.",loaded:true},
  ],
  stretch:[
    ["Couch stretch (hip flexors)","30s ea"],
    ["Seated hamstring","30s ea"],
    ["Figure-4 glute","30s ea"],
    ["Standing calf against wall","30s ea"],
  ],
};
```

## Block 3 — replace the `PULL` constant

```js
const PULL = {
  work:[
    {id:"rows",name:"Rows / chin-ups",target:"3 sets · 8–15 reps",cue:"Full dead hang at the bottom every rep, lead with elbows. Negatives first while fresh, then this as assisted volume. When 3×15 is clean, reduce the assistance.",assist:true,negatives:true},
    {id:"scapulapull",name:"Scapula pull-ups",target:"3 sets · 8–10 reps",cue:"Dead hang, scapulae elevated to ears, pull scapulae down WITHOUT bending elbows. Builds the initiation strength most people miss on their first real pull-up."},
    {id:"dbrows",name:"DB/KB Rows",target:"3 sets · 8–12 per side",cue:"Flat back, pull elbow past hip, squeeze at top.",loaded:true},
    {id:"reardelt",name:"Rear Delt Fly",target:"3 sets · 15–20 reps",cue:"Hinged at the hips, light DBs, lead with the elbows. Balances all the pressing and keeps the shoulders healthy.",loaded:true},
    {id:"curl",name:"DB Curl",target:"3 sets · 10–15 reps",cue:"No swinging. Slow on the way down.",loaded:true},
    {id:"core",name:"Hanging leg raises / plank",target:"3 sets · 8–12 reps",cue:"Brace hard, no swinging. Add ankle weight once 12+ reps feel clean."},
  ],
  stretch:[
    ["Dead hang","2×20–30s"],
    ["Lat stretch (kneeling)","30s ea"],
    ["Biceps/forearm wall stretch","30s ea"],
    ["Child's pose","30s"],
  ],
};
```

## Block 4 — new `RUNDAY` and `REST` constants

Insert **after** the `RECOVERY` constant. `RECOVERY` itself is left in place but is
no longer referenced by `DAYS` — leave it rather than delete it, in case you want the
circuit back.

```js
const RUNDAY = {
  circuit:[
    ["Run — see Garmin","per plan"],
  ],
  stretch:[
    ["Standing quad","30s ea"],
    ["Seated hamstring","30s ea"],
    ["Couch stretch (hip flexors)","30s ea"],
    ["Standing calf against wall","30s ea"],
    ["Figure-4 glute","30s ea"],
  ],
};

const REST = {
  circuit:[
    ["Easy walk, outdoors","30–45 min"],
  ],
  stretch:[
    ["Dead hang","20–30s"],
    ["Doorway chest","30s"],
    ["Overhead triceps + lat","30s ea"],
    ["Quad / couch stretch","30s ea"],
    ["Seated hamstring","30s"],
    ["Child's pose","30s"],
    ["Figure-4 glute","30s ea"],
  ],
};
```

## Block 5 — replace the `DAYS` constant

```js
const DAYS = [
  {d:"Mon",focus:"Push",   data:PUSH},
  {d:"Tue",focus:"Tempo",  data:RUNDAY},
  {d:"Wed",focus:"Legs",   data:LEGS},
  {d:"Thu",focus:"Fast",   data:REST},
  {d:"Fri",focus:"Pull",   data:PULL},
  {d:"Sat",focus:"Long run",data:RUNDAY},
  {d:"Sun",focus:"Rest",   data:REST},
];
```

## Block 6 — replace the `EX_REGISTRY` constant

Six new ids. Legs use a third colour so the Progress charts separate push, pull and
legs at a glance.

```js
const EX_REGISTRY = [
  { id:"pushups",    name:"Push-ups",              color:"#4f8ff0" },
  { id:"dips",       name:"Box / triceps dips",    color:"#4f8ff0" },
  { id:"ohpress",    name:"DB/KB Overhead Press",  color:"#4f8ff0", loaded:true },
  { id:"floorpress", name:"DB/KB Floor Press",     color:"#4f8ff0", loaded:true },
  { id:"latraise",   name:"Lateral Raise",         color:"#4f8ff0", loaded:true },
  { id:"rows",       name:"Rows / chin-ups",       color:"#5ec27e" },
  { id:"scapulapull",name:"Scapula pull-ups",      color:"#5ec27e" },
  { id:"dbrows",     name:"DB/KB Rows",            color:"#5ec27e", loaded:true },
  { id:"reardelt",   name:"Rear Delt Fly",         color:"#5ec27e", loaded:true },
  { id:"curl",       name:"DB Curl",               color:"#5ec27e", loaded:true },
  { id:"core",       name:"Hanging leg raises",    color:"#5ec27e" },
  { id:"squats",     name:"Goblet / DB Squat",     color:"#e0894a", loaded:true },
  { id:"splitsquat", name:"Bulgarian Split Squat", color:"#e0894a", loaded:true },
  { id:"rdl",        name:"DB Romanian Deadlift",  color:"#e0894a", loaded:true },
  { id:"hipthrust",  name:"Hip Thrust",            color:"#e0894a", loaded:true },
  { id:"calves",     name:"Standing Calf Raise",   color:"#e0894a", loaded:true },
  { id:"kbswings",   name:"Kettlebell Swings",     color:"#e0894a", loaded:true },
];
```

---

## Acceptance checks

1. App loads with no console errors.
2. Mon shows five Push exercises, Wed six Legs, Fri six Pull.
3. Tue and Sat show the Run day (a one-line circuit pointing at Garmin, plus the
   running stretch set). Thu and Sun show the Rest day.
4. Progress charts list all seventeen exercises in three colour groups, and existing
   history for `pushups`, `dips`, `squats`, `ohpress`, `floorpress`, `rows`,
   `scapulapull`, `dbrows`, `kbswings` and `core` is intact.
5. Logging a set against each new id (`splitsquat`, `rdl`, `hipthrust`, `latraise`,
   `calves`, `reardelt`, `curl`) saves and syncs.
6. Confirm a one-item `circuit` array renders without breaking the day view — this is
   the only structural risk in the change.
7. Checked at 390 px width for overflow.

## The week this encodes

- **Mon** — Push (strength) · PM easy walk
- **Tue** — Tempo 4×3 (Garmin) · PM easy walk
- **Wed** — Legs (strength) · PM easy walk
- **Thu** — Water fast · walk and mobility only, nothing hard
- **Fri** — Pull (strength) · PM easy walk
- **Sat** — Long run, 60 min growing toward 90+ (Garmin)
- **Sun** — Full rest, or one easy walk

Hard training drops from roughly 10.5 hours a week to about 6, with one genuine rest
day. The twice-daily slot habit survives — the second slot is now a walk.
