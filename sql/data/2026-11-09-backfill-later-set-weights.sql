-- DATA CHANGE — RECORD ONLY. Already applied to the live project by the owner on 9 Nov 2026. Do not re-run.
--
-- What it did: before 1.3.0 a loaded exercise had one weight field, saved on set 1's row (set_index 0);
-- sets 2 and 3 stored null. This copied set 1's weight into those null later sets. 62 rows updated;
-- updated_at was deliberately left untouched.
--
-- NO ROLLBACK IS POSSIBLE: it overwrote nulls, and nothing records which rows were null before.
--
-- Kept in sql/data/ (not as a numbered sql/NNN script) so tests/realstack/setup.sh never applies it
-- and the rollback check doesn't expect a rollback that can't exist.

with src as (
  select user_id, log_date, exercise_id, weight_kg
  from public.workout_log
  where set_index = 0 and weight_kg is not null
)
update public.workout_log w
set weight_kg = src.weight_kg
from src
where w.user_id = src.user_id
  and w.log_date = src.log_date
  and w.exercise_id = src.exercise_id
  and w.set_index > 0
  and w.weight_kg is null;
