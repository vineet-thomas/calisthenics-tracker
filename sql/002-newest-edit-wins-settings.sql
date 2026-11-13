-- Applied out-of-band to the live project on 13 Nov 2026 by the owner.
-- Present here as the record of what is live and for rebuilding from scratch.
-- Idempotent and safe to re-run, but nothing is pending.
--
-- calisthenics-tracker 1.2.1 — newest edit wins on settings
--
-- From 1.2.1 the deload toggle goes through the app's on-device queue like every other
-- write, so it can now arrive late (e.g. after a spell offline). This attaches the rule
-- from 001 to settings: an older toggle never overwrites a newer one, and a clock running
-- ahead is clamped to server time.
--
-- Requires 001-newest-edit-wins.sql (it reuses public.ct_newest_edit_wins()).
-- Safe to run more than once. Adds no tables or columns, changes no data, leaves RLS alone.
-- Rollback: 002-newest-edit-wins-settings-rollback.sql

create or replace trigger ct_newest_edit_wins
  before insert or update on public.settings
  for each row execute function public.ct_newest_edit_wins();
