-- Rollback for 002-newest-edit-wins-settings.sql
--
-- Removes the trigger from settings only. The function belongs to 001 and stays, because
-- workout_log and day_status still use it (roll back 001 separately if needed — after this).
-- Safe to run more than once. Changes no data. The 1.2.1 app keeps working without it.

drop trigger if exists ct_newest_edit_wins on public.settings;
