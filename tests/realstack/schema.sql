-- Local stand-in for the Supabase schema this app uses: same roles, auth.uid(), RLS and the
-- columns the app reads and writes. Test data only — never run this against Supabase.

create role anon nologin;
create role authenticated nologin;
create role authenticator login noinherit;
grant anon, authenticated to authenticator;

create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated;

create table public.workout_log(id bigserial primary key, user_id uuid not null, log_date date not null, day text,
  exercise_id text not null, set_index int not null, reps int, assist text, weight_kg numeric, negatives int,
  updated_at timestamptz not null default now(), unique(user_id,log_date,exercise_id,set_index));
create table public.day_status(id bigserial primary key, user_id uuid not null, log_date date not null, day text,
  completed boolean, updated_at timestamptz not null default now(), unique(user_id,log_date));
create table public.settings(user_id uuid primary key, deload_week date, updated_at timestamptz not null default now());
create table public.error_log(id bigserial primary key, user_id uuid, context text, message text, code text,
  user_note text, user_agent text, app_version text, created_at timestamptz default now());

alter table public.workout_log enable row level security;
alter table public.day_status enable row level security;
alter table public.settings enable row level security;
alter table public.error_log enable row level security;
create policy own on public.workout_log for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on public.day_status  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own on public.settings    for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ins on public.error_log for insert to authenticated with check (user_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
