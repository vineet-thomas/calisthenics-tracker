#!/bin/bash
# SQL behaviour + rollback tests on the local database started by setup.sh (all sql/NNN-*.sql applied).
# Each check prints PASS/FAIL; exits non-zero if any fail. Leaves the database as setup.sh made it.
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; SQL="$REPO/sql"
export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
P(){ local out rc; out=$(psql -h localhost -p 54329 -U postgres -d ct -X -q -t -A -v ON_ERROR_STOP=1 "$@" 2>&1); rc=$?
     [ -n "$out" ] && printf '%s\n' "$out" | grep -v NOTICE; return $rc; }
U=11111111-1111-1111-1111-111111111111
pass=0; fail=0
t(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1  — expected [$3], got [$2]"; fail=$((fail+1)); fi; }
trig(){ P -c "select coalesce(string_agg(tgrelid::regclass::text, ',' order by tgrelid::regclass::text),'none') from pg_trigger where tgname='ct_newest_edit_wins'"; }
UPS="on conflict (user_id,log_date,exercise_id,set_index) do update set reps=excluded.reps, weight_kg=coalesce(excluded.weight_kg, workout_log.weight_kg), updated_at=excluded.updated_at"
wl(){ P -c "insert into workout_log(user_id,log_date,day,exercise_id,set_index,reps,updated_at) values ('$U','2026-11-09','Mon','$1',0,$2,$3) $UPS"; P -c "select reps from workout_log where exercise_id='$1'"; }
echo "## sql"
P -c "truncate workout_log, day_status, settings"

# --- 001: newest edit wins on workout_log and day_status
t "001 installed on workout_log and day_status" "$(P -c "select count(*) from pg_trigger where tgname='ct_newest_edit_wins' and tgrelid in ('public.workout_log'::regclass,'public.day_status'::regclass)")" "2"
t "001 runs again cleanly (idempotent)" "$(P -f "$SQL/001-newest-edit-wins.sql" && echo ok)" "ok"
wl pushups 10 "now()-interval '1 hour'" >/dev/null
t "an older edit arriving late is skipped" "$(wl pushups 99 "now()-interval '2 hours'")" "10"
t "a newer edit applies" "$(wl pushups 12 "now()-interval '1 minute'")" "12"
P -c "insert into workout_log(user_id,log_date,day,exercise_id,set_index,weight_kg,updated_at) values ('$U','2026-11-09','Mon','pushups',0,15,now()) on conflict (user_id,log_date,exercise_id,set_index) do update set weight_kg=excluded.weight_kg, updated_at=excluded.updated_at" >/dev/null
t "an edit to one column leaves the others" "$(P -c "select reps||'|'||weight_kg from workout_log where exercise_id='pushups'")" "12|15"
wl dips 8 "now()+interval '1 day'" >/dev/null
t "a clock running a day ahead is clamped" "$(P -c "select updated_at <= now()+interval '1 second' from workout_log where exercise_id='dips'")" "t"
P -c "insert into day_status(user_id,log_date,day,completed,updated_at) values ('$U','2026-11-09','Mon',true,now())" >/dev/null
P -c "insert into day_status(user_id,log_date,day,completed,updated_at) values ('$U','2026-11-09','Mon',false,now()-interval '1 day') on conflict (user_id,log_date) do update set completed=excluded.completed, updated_at=excluded.updated_at" >/dev/null
t "day_status: an older edit is skipped" "$(P -c "select completed from day_status")" "t"
P -c "insert into workout_log(user_id,log_date,day,exercise_id,set_index,reps,updated_at) values ('$U','2026-11-09','Mon','rows',0,5,now()-interval '2 hours')" >/dev/null
P -c "delete from workout_log where user_id='$U' and log_date='2026-11-09' and (updated_at is null or updated_at <= now()-interval '30 minutes')" >/dev/null
t "Clear day pressed 30 min ago keeps the newer rows" "$(P -c "select string_agg(exercise_id, ',' order by exercise_id) from workout_log")" "dips,pushups"

# --- settings (whichever way the trigger was attached)
if [ "$(P -c "select count(*) from pg_trigger where tgname='ct_newest_edit_wins' and tgrelid='public.settings'::regclass")" = "1" ]; then
  P -c "insert into settings(user_id,deload_week,updated_at) values ('$U','2026-11-09',now()-interval '1 hour')" >/dev/null
  P -c "insert into settings(user_id,deload_week,updated_at) values ('$U',null,now()-interval '2 hours') on conflict (user_id) do update set deload_week=excluded.deload_week, updated_at=excluded.updated_at" >/dev/null
  t "settings: an older toggle arriving late is skipped" "$(P -c "select coalesce(deload_week::text,'null') from settings")" "2026-11-09"
fi

# --- rollbacks: every NNN script has a rollback; roll back newest-first, then re-apply
BEFORE="$(trig)"
FWD=(); RB=()   # globs, not ls: the repo path contains a space
for f in "$SQL"/[0-9][0-9][0-9]-*.sql; do case "$f" in *-rollback.sql) RB+=("$f");; *) FWD+=("$f");; esac; done
for f in "${FWD[@]}"; do t "$(basename "$f") has a rollback script" "$([ -f "${f%.sql}-rollback.sql" ] && echo yes)" "yes"; done
for ((i=${#RB[@]}-1; i>=0; i--)); do f="${RB[$i]}"; t "$(basename "$f") runs twice cleanly" "$(P -f "$f" && P -f "$f" && echo ok)" "ok"; done
t "after all rollbacks: no triggers or function left" "$(trig)/$(P -c "select count(*) from pg_proc where proname='ct_newest_edit_wins'")" "none/0"
wl pushups 1 "now()-interval '3 days'" >/dev/null
t "without the rule an older edit overwrites (old behaviour back)" "$(P -c "select reps from workout_log where exercise_id='pushups'")" "1"
t "001 rollback also works when the settings trigger exists" "$(P -f "$SQL/001-newest-edit-wins.sql" && P -c "create or replace trigger ct_newest_edit_wins before insert or update on public.settings for each row execute function public.ct_newest_edit_wins()" && P -f "$SQL/001-newest-edit-wins-rollback.sql" && trig)" "none"
for f in "${FWD[@]}"; do P -f "$f" >/dev/null; done
t "re-applying all scripts restores the same triggers" "$(trig)" "$BEFORE"

echo "$pass/$((pass+fail)) passed"
[ "$fail" = "0" ]
