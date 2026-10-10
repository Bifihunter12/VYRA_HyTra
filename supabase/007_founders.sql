-- ════════════════════════════════════════════════════════════════════════════
-- Iron Forest — Founding Embers: the first 100 accounts get a little star
--
-- Every new account claims the next number until 100 are taken. Numbers are
-- never reused: if a Founding Ember deletes their account, their spot is gone.
-- Accounts that already exist when this file runs are numbered by sign-up date.
-- Claiming can never block a sign-up. Run after 006_monthly.sql. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.founding_embers (
  number     int  primary key check (number between 1 and 100),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now()
);
-- The highest number ever handed out, so deleted spots are not handed out again.
create table if not exists public.founding_counter (
  id   boolean primary key default true check (id),
  last int not null default 0
);
insert into public.founding_counter (id, last) values (true, 0) on conflict (id) do nothing;

alter table public.founding_embers  enable row level security;
alter table public.founding_counter enable row level security;   -- no policies: only the functions below touch them

-- Give an account the next number, if any are left.
create or replace function public.claim_founding_ember(p_user uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select f.number into n from public.founding_embers f where f.user_id = p_user;
  if n is not null then return n; end if;
  update public.founding_counter c set last = c.last + 1 where c.id and c.last < 100 returning c.last into n;
  if n is null then return null; end if;
  insert into public.founding_embers (number, user_id) values (n, p_user);
  return n;
end;
$$;
revoke execute on function public.claim_founding_ember(uuid) from public, anon, authenticated;

create or replace function public.founding_on_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.claim_founding_ember(new.id);
  exception when others then
    null;                                            -- a star is never worth a failed sign-up
  end;
  return new;
end;
$$;
drop trigger if exists founding_on_signup on auth.users;
create trigger founding_on_signup after insert on auth.users
  for each row execute function public.founding_on_signup();

-- Accounts that existed before this file: oldest first.
do $$
declare u record;
begin
  for u in select a.id from auth.users a
           where not exists (select 1 from public.founding_embers f where f.user_id = a.id)
           order by a.created_at, a.id loop
    exit when public.claim_founding_ember(u.id) is null;
  end loop;
end $$;

-- What the app needs: spots taken, the caller's own number, and the handles to star.
-- Only handles that are already public (public profile or on the leaderboards) are listed.
create or replace function public.founding_embers()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'limit', 100,
    'taken', (select c.last from public.founding_counter c where c.id),
    'mine', (select f.number from public.founding_embers f where f.user_id = auth.uid()),
    'handles', coalesce((select jsonb_agg(a.handle order by f.number)
                         from public.founding_embers f join public.athletes a on a.user_id = f.user_id
                         where a.handle is not null and (a.visibility = 'public' or a.leaderboards)), '[]'::jsonb));
$$;
grant execute on function public.founding_embers() to anon, authenticated;
