-- calisthenics-tracker 1.1.0 — newest edit wins on workout_log and day_status
--
-- The app stamps updated_at with the time an entry was made (not when it was sent),
-- so an entry that waited offline can arrive late. This rule makes sure that:
--   1. an older edit never overwrites a newer one, and
--   2. a device whose clock runs ahead can't stamp rows in the future
--      (anything more than 2 minutes ahead of the server is clamped to now()).
--
-- Safe to run more than once. Adds no tables or columns and changes no data;
-- RLS policies are untouched. Works with the current live app as well.
--
-- Step 1 (check): both rows should report updated_at as a timestamp type.
--   select table_name, data_type from information_schema.columns
--   where table_schema = 'public' and column_name = 'updated_at'
--     and table_name in ('workout_log', 'day_status');

create or replace function public.ct_newest_edit_wins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at is null or new.updated_at > now() + interval '2 minutes' then
    new.updated_at := now();
  end if;
  if tg_op = 'UPDATE' and old.updated_at is not null and new.updated_at < old.updated_at then
    return null;  -- keep the newer row; the older edit is skipped, not an error
  end if;
  return new;
end;
$$;

create or replace trigger ct_newest_edit_wins
  before insert or update on public.workout_log
  for each row execute function public.ct_newest_edit_wins();

create or replace trigger ct_newest_edit_wins
  before insert or update on public.day_status
  for each row execute function public.ct_newest_edit_wins();
