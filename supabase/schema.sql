-- ════════════════════════════════════════════════════════════════════════════
-- Iron Forest — cloud sync schema (Supabase / Postgres)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The app is local-first: every device keeps its own copy and syncs changes.
--   profiles  one row per user: weekly goal, level, equipment, settings, plan progress
--   workouts  one row per finished workout; deletions are kept as tombstones
--             (deleted = true) so other devices learn about them
-- Row-level security limits every row to its owner (auth.uid()).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.workouts (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  data       jsonb,
  performed_at timestamptz,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists workouts_user_updated on public.workouts (user_id, updated_at);

alter table public.profiles enable row level security;
alter table public.workouts enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own workouts" on public.workouts;
create policy "own workouts" on public.workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Lets a signed-in user delete their own account. Profiles and workouts go
-- with it through "on delete cascade".
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Devices pull changes by server time, so a phone with a wrong clock can't
-- hide its edits from other devices. (updated_at is the device's edit time,
-- used only to decide which edit wins.)
alter table public.workouts add column if not exists server_updated_at timestamptz not null default now();
create index if not exists workouts_user_server_updated on public.workouts (user_id, server_updated_at);

create or replace function public.touch_server_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists workouts_touch on public.workouts;
create trigger workouts_touch before insert or update on public.workouts
  for each row execute function public.touch_server_updated_at();
