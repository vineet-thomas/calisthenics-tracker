-- Rollback for 001-newest-edit-wins.sql
--
-- Removes the triggers and their function; workout_log and day_status go back to
-- "last write to arrive wins". Safe to run more than once. Changes no data: any
-- updated_at values the rule clamped while it was active stay as they are (harmless).
-- Triggers are dropped before the function because they depend on it. This also removes the
-- settings trigger (attached by the owner with this same function), so it works either way.
--
-- The 1.1.0 app keeps working without the rule; it just loses the newest-edit protection.

drop trigger if exists ct_newest_edit_wins on public.settings;     -- attached to settings by the owner, if present
drop trigger if exists ct_newest_edit_wins on public.workout_log;
drop trigger if exists ct_newest_edit_wins on public.day_status;
drop function if exists public.ct_newest_edit_wins();
