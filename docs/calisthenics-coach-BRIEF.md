# calisthenics-tracker — per-set weights and session coaching

Owner: Vineet Thomas · Prepared 11 Nov 2026 · **Decisions settled 13–14 Nov 2026** (this file is the record)

Supersedes `calisthenics-v1.4-weight-capture-BRIEF.md` (9 Nov), whose Item 1 rested on a wrong diagnosis:
the UI only ever had one weight field per exercise. Nothing was broken; the feature was absent.

## Status

| Item | What | Status |
|---|---|---|
| A | Per-set weight entry | **Shipped** in 1.3.0 (#12) |
| D | Cleared sets / no zero-rep rows | **Shipped** in 1.3.0 (#12), corrected in 1.3.1 (#13) |
| — | Progress past Supabase's 1,000-row cap | **Shipped** in 1.2.4 (#11) |
| B | Equipment ladders | **To build — 1.4.0** |
| C | Session coaching | **To build — 1.4.0** (same PR as B) |
| E | Rest timer | **Yes, last**, as its own PR after B + C has settled |

Read `AGENTS.md` first. It governs everything here (ids, branches, tests, SQL, NEVER block).

---

## What is already true (A + D, shipped — do not redo)

- Each set of a loaded exercise has its own weight box. Set 1's weight is **inherited by value**: when set 1
  changes from A to B, sets still holding A follow; a set changed by hand keeps its value; a set typed equal
  to set 1 follows it. A set's weight is **saved together with that set's reps** — a set never done has no row.
- `workout_log.reps` is **`integer NOT NULL DEFAULT 0`**. **`reps = 0` means cleared. Never send null** —
  Supabase refuses it (23502). A never-logged set is never written.
- `day` (text) and `set_index` (smallint) are **NOT NULL with no default**; every write must include them.
  `updated_at` is NOT NULL DEFAULT now() and set to the edit time by the client (newest-edit-wins trigger,
  `sql/001`). `weight_kg`, `negatives`, `assist` are nullable.
- **Reading rules** (in `fetchHistory`, with a comment warning against "normalising" them):
  1. Rep totals, session counts and coaching history ignore any set with `reps = 0`.
  2. A date is a session for an exercise only if at least one set has `reps > 0`.
  3. Negatives and assistance are exercise-level values on **set 1's row** and are read from it regardless
     of its reps. Set 1's row is no longer special for weight, but still is for these.
- **Working weight = set 1's weight** (the first set with reps if set 1 wasn't logged).
- History is read in pages (`fetchAllRows`), so nothing is cut off at 1,000 rows.
- 9 Nov backfill (62 rows, set 1's weight copied to null later sets) is recorded in
  `sql/data/2026-11-09-backfill-later-set-weights.sql` — record only, no rollback possible. **Do not write another.**

---

## Item B — Equipment ladders

Recommendations come from the equipment's **actual available values**, never computed increments
("add 2.5 kg" is often impossible: from 10.5 the next dumbbell is 11.5, then 13.5).

### Ladders — constants in `index.html`, next to the programme (no schema change)

Not in a settings table: the `settings` table only has `deload_week`, so that would need a schema change.
Ladders are master data, versioned in git, changed through a brief like the programme.

```
dumbbell:   2.5, 3.5, 5, 6, 7, 8, 9.5, 10.5, 11.5, 13.5, 16, 18.5, 20.5, 23, 24
kettlebell: 3.5, 5.6, 8.1, 10.8, 13.6, 16.1, 18.1
```

- Kettlebell = XRT65 adjustable, seven settings: 7.8 / 12.4 / 17.9 / 23.9 / 29.9 / 35.4 / 40 lb, converted at
  1 lb = 0.45359237 kg and rounded to one decimal (the whole ladder is kept to one decimal).
- **The kettlebell ladder has no consumer yet.** It is master data for single-arm swings (on hold, likely later).
  Build nothing on it now. **Protect it from being deleted as dead code:**
  - a comment saying what it is, that nothing uses it yet, and that this is deliberate;
  - a test asserting **both** ladders exist and are well-formed: sorted ascending, unique, all positive.
- The 17 existing `kbswings` rows record **18.14**; the nearest-rung rule resolves that to 18.1. No data change.

### Each exercise declares three fields (plus rep range)

| Field | Values | Meaning |
|---|---|---|
| `ladder` | `dumbbell` · `kettlebell` · `none` | Which ladder |
| `implements` | `1` · `2` · `1-2` | How many implements; `1-2` = either, as load demands |
| `display` | `perHand` · `total` | Wording only |
| `repMin`, `repMax` | integers | The rep range. **Never parse the `target` display string** — AGENTS.md permits rewording it |

**Achievable loads** = every rung × every allowed implement count, de-duplicated and sorted.
"Next rung" always means the **next achievable load**, never a computed increment.

- `perHand` with `implements: 2` → the dumbbell ladder itself (per hand).
- `total` with `implements: 1-2` → union of single rungs and doubled rungs. For hip thrust / goblet squat:
  `2.5, 3.5, 5, 6, 7, 8, 9.5, 10, 10.5, 11.5, 12, 13.5, 14, 16, 18.5, 19, 20.5, 21, 23, 24, 27, 32, 37, 41, 46, 48`.
  Hip thrust is currently 24 kg; the real next load is 2 × 13.5 = **27**.
  ⚠ **For the owner:** the 11 Nov example listed "… 20.5, 23, 24, 27 …" — the rule also produces **21**
  (2 × 10.5). The rule wins unless the owner says otherwise.

### Full mapping — all 17 exercises (ids unchanged)

| ladder · implements · display | Exercises | repMin–repMax |
|---|---|---|
| **dumbbell · 2 · perHand** | `ohpress` 6–10 · `floorpress` 8–12 · `dbrows` 8–12 · `latraise` 12–20 · `reardelt` 15–20 · `curl` 10–15 · `splitsquat` 8–12 · `rdl` 8–12 · `calves` 15–20 | as listed |
| **dumbbell · 1-2 · total** | `squats` 8–12 (goblet: one at the chest, or two at the shoulders) · `hipthrust` 10–15 (one across the hips now, two later) | as listed |
| **kettlebell · 1 · total** | `kbswings` — **excluded from load coaching**; no rep range needed | — |
| **none** | `pushups` 12–20 · `dips` 10–15 · `rows` 8–15 · `scapulapull` 8–10 · `core` 8–12 | as listed |

Rep ranges are taken from the v1.2 `target` strings; set them as explicit fields and leave the target and cue
text untouched (AGENTS.md rule 10).

### Display-name changes (ids do NOT change)

| id (unchanged) | Old name | New name |
|---|---|---|
| `ohpress` | DB/KB Overhead Press | **DB Overhead Press** |
| `floorpress` | DB/KB Floor Press | **DB Floor Press** |
| `dbrows` | DB/KB Rows | **DB Rows** |

Change them in **both** `EX_REGISTRY` and the programme constants. This is exactly the edit where names and ids
get conflated: `ids.lock.json` + `node tests/check.js` will fail if an id moves. Names are programme data, so the
regression baseline (which injects the branch's programme block) should not flag them — **verify** this
(the Progress view shows names; expect it to match).

All three use dumbbells: the kettlebell's 2.0–2.8 kg steps (a 23% jump at 10.8 kg on an overhead press) are
too coarse for any progression rule to suggest.

---

## Item C — Session coaching (the main feature)

On each exercise card (cards are always open): **what happened last time, and what to do today.**

- **Last session:** date, working weight, reps per set — `26 Oct · 10.5 kg · 10 / 10 / 10`.
  If set weights differ, show them per set.
- **Today's suggestion:** an achievable load, a rep target, and one line of reasoning.
- **It is a suggestion, never an entry.** It must not pre-fill the weight or reps fields.

### History used

- Sessions **before today**, per the reading rules above (sets with `reps = 0` ignored; a session needs a set
  with reps > 0). Today's own entries never count as "last session".
- Read from the paged history; **keep it on the device** so suggestions also show offline.
- Working weight = set 1's weight.
- **Never compare a loaded session with a bodyweight session.** `squats` changed meaning mid-history (39 rows,
  only 1 with a weight — bodyweight until 11 Nov). For a loaded exercise, load coaching uses only sessions with
  a working weight; earlier bodyweight sessions don't count towards "two sessions running". Handle generally —
  any exercise can make this transition.

### Load rules (ladder ≠ `none`, not `kbswings`), checked in this order

1. **No history** (no qualifying session) → no suggestion; show the range only.
2. **Any set below `repMin`** → **one rung down, never more** (from 24 that's 23).
   *"5 reps at 24 kg, below the 8–12 target. Drop to 23 kg."*
3. **All sets at or above `repMax`, two qualifying sessions running at the same working weight** →
   next achievable load, rep target **`repMin`**.
   *"10 / 10 / 10 at 10.5 kg for two sessions. Try 11.5 kg — aim for 6."*
4. **All sets at or above `repMax`, one session only** → hold, repeat.
   *"10 / 10 / 10 at 10.5 kg. Repeat to confirm, then go up."*
5. **Otherwise (mid-range)** → hold, aim for `repMax`.
   *"8 / 8 / 7 at 11.5 kg. Same weight — aim for 10."*

- **Dropped last set means hold.** If a later set's weight is below set 1's, the session does not count as
  "all sets at the top" at that weight.
- **Off-ladder weights:** up = next achievable load above, down = next below, hold = **nearest** achievable
  load. Real cases: `ohpress` and `floorpress` have rows at **10 kg** (not on the dumbbell ladder) — test
  against these. Acceptance: suggested weights only ever appear on the ladder (never 12 or 13 kg for a
  `perHand` dumbbell exercise).
- **Ceiling branch (general):** at the top of the achievable loads, "next rung" doesn't exist. Suggest
  progressing by **reps, tempo or unilateral work** — never a load that doesn't exist. `perHand` dumbbell work
  hits this at 24 kg; hip thrust reaches it at 48 kg later.
- **`kbswings`:** never a weight suggestion. If anything displays: **"18.1 kg — top of the set"**. All 17 weighted
  rows have been at the maximum since the first session; it is a fixed conditioning load.

### Bodyweight (ladder `none`) — reps-only coaching

**64% of the log** (push-ups 44, dips 42, rows 27, core 22, scapula pull-ups 14, plus 38 unloaded squat rows).
This is the main case, not a fallback. Same shape, no weight:

- no history → range only;
- all sets ≥ `repMax` two sessions running → **"Ready for the next progression"** (matches the existing
  "Ready to advance" tag);
- all sets ≥ `repMax` once → repeat to confirm;
- mid-range → aim for `repMax`;
- any set below `repMin` → *proposed wording* "Below the range — ease the variation or add assistance" (owner may adjust).

Assistance (`dips`, `rows`) and negatives (`rows`) are not part of the coaching rules in this item.

### Thin history is the normal case

`hipthrust`, `rdl` and `calves` have **one row each**; `splitsquat` 2; `latraise` 3. The **"no history"** and
**"one session only"** branches will fire constantly for the first month — test them as **primary paths**.

### Known data (owner's query, 13 Nov 2026)

- 292 rows, 26 training days, 10 Aug – 11 Nov; ~22–24 rows/week.
- `reps = 1`: 47 rows across 17 days (11 Aug – 30 Oct), **none since 9 Nov** — caused by 1.0.0 sending every
  keystroke out of order (fixed by the 1.1.0 queue). `reps = 0`: 2 rows (25 Sep, 11 Nov).
  **Leave this data alone** — a real 1-rep set is possible, and the originals are unrecoverable. Coaching only
  looks at the last two sessions, so old artefacts stop mattering quickly.

---

## New movements get new ids — never renames

- Single-arm swings → a new id (e.g. `kbswings1a`), never a change to `kbswings`. Different movement, different
  load; charting both on one line would make the history meaningless.
- Bench press, if it replaces floor press → a new id, never a rename of `floorpress`.
- New ids are added to `ids.lock.json` deliberately in the same PR (AGENTS.md rule 1).

---

## Item E — Rest timer (approved; build last)

Rest periods are running 2.5–5.5 min against a 90–120 s design (a ~50 min session became 72). On logging a set,
start a countdown to that exercise's target rest, with a sound or vibration at zero. Target rest per exercise in
its definition — 90 s for bodyweight and isolation, 120 s for presses and the heavier leg work. Its own small PR,
after B + C has settled.

---

## Acceptance (B + C)

1. An exercise with history shows last session's date, weight and reps (per set when they differ).
2. Suggested weights only ever appear among the exercise's achievable loads — never 12 kg or 13 kg on a
   `perHand` dumbbell exercise; never above the top of the ladder.
3. One rung down, never more (24 → 23).
4. Off-ladder history (10 kg on `ohpress` / `floorpress`) resolves up / down / nearest correctly.
5. Ceiling: at the top load, the suggestion progresses by reps / tempo / unilateral work.
6. `kbswings` shows "18.1 kg — top of the set" and never a suggestion.
7. Bodyweight exercises get reps-only coaching; "two sessions at the top" → "Ready for the next progression".
8. No history and one-session history behave as specified (primary paths).
9. `squats`: a loaded session is never compared with earlier bodyweight sessions.
10. The suggestion never pre-fills any field.
11. Both ladders exist and are well-formed (sorted, unique, positive) — tested.
12. Coaching shows offline from the device's saved history.
13. Display names changed; ids unchanged (`node tests/check.js` passes); Progress/regression verified.
14. Checked at 390 px; `node tests/run.js --realstack` passes; display change approved and explained in the PR.
