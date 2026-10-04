-- ════════════════════════════════════════════════════════════════════════════
-- VYRA — Clubs, gyms, teams, local leaderboards (Phase 4)
-- Run once in the Supabase SQL editor AFTER 004_events.sql. Safe to re-run.
--
--   clubs          kind club | gym | team; open (anyone joins) or closed (invite code)
--                  partner gyms are flagged by VYRA staff only
--   club_members   owner | admin | member; teams hold at most 6 athletes
--   athletes.country / city   optional, for local leaderboards
--   leaderboard()  now also filters by country, city or club
--   club_battle()  gym vs gym: each club's top 10 members score placement points
--   events.host_club  in-person events can be hosted by a club or partner gym
-- ════════════════════════════════════════════════════════════════════════════

alter table public.athletes add column if not exists country text;
alter table public.athletes add column if not exists city text;
alter table public.athletes drop constraint if exists athletes_country_check;
alter table public.athletes add constraint athletes_country_check check (country is null or country ~ '^[A-Z]{2}$');
alter table public.athletes drop constraint if exists athletes_city_check;
alter table public.athletes add constraint athletes_city_check check (city is null or char_length(city) between 1 and 60);

-- ── Clubs ────────────────────────────────────────────────────────────────────
create table if not exists public.clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  kind        text not null default 'club' check (kind in ('club', 'gym', 'team')),
  country     text check (country is null or country ~ '^[A-Z]{2}$'),
  city        text check (city is null or char_length(city) between 1 and 60),
  description text check (char_length(description) <= 280),
  open        boolean not null default true,
  partner     boolean not null default false,
  invite_code text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null, -- a club outlives its creator's account
  created_at  timestamptz not null default now()
);
alter table public.clubs enable row level security;

-- Directory is public, but the invite code is not: column-level privileges hide it.
revoke select on public.clubs from anon, authenticated;
grant select (id, name, kind, country, city, description, open, partner, created_by, created_at) on public.clubs to anon, authenticated;
grant insert (name, kind, country, city, description, open) on public.clubs to authenticated;
grant update (name, country, city, description, open) on public.clubs to authenticated;
grant delete on public.clubs to authenticated;

create table if not exists public.club_members (
  club_id   uuid not null references public.clubs (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index if not exists club_members_user on public.club_members (user_id);
alter table public.club_members enable row level security;

create or replace function public.club_role(p_club uuid)
returns text language sql stable security definer set search_path = '' as $$
  select role from public.club_members where club_id = p_club and user_id = auth.uid();
$$;
grant execute on function public.club_role(uuid) to authenticated;

drop policy if exists "club directory" on public.clubs;
create policy "club directory" on public.clubs for select using (true);
drop policy if exists "create club" on public.clubs;
create policy "create club" on public.clubs for insert with check (created_by = auth.uid());
drop policy if exists "admins edit club" on public.clubs;
create policy "admins edit club" on public.clubs for update using (public.club_role(id) in ('owner', 'admin'));
drop policy if exists "owner deletes club" on public.clubs;
create policy "owner deletes club" on public.clubs for delete using (public.club_role(id) = 'owner');

-- The creator becomes the owner; partner status is staff-only.
create or replace function public.clubs_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.club_members (club_id, user_id, role) values (new.id, new.created_by, 'owner') on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists clubs_after_insert on public.clubs;
create trigger clubs_after_insert after insert on public.clubs for each row execute function public.clubs_after_insert();

create or replace function public.clubs_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    if tg_op = 'INSERT' then new.partner := false;
    elsif new.partner is distinct from old.partner then new.partner := old.partner;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists clubs_guard on public.clubs;
create trigger clubs_guard before insert or update on public.clubs for each row execute function public.clubs_guard();

-- Members: see the roster of clubs you belong to; join open clubs yourself; leave; admins remove members.
drop policy if exists "see club rosters" on public.club_members;
create policy "see club rosters" on public.club_members for select using (public.club_role(club_id) is not null);
drop policy if exists "join open clubs" on public.club_members;
create policy "join open clubs" on public.club_members for insert with check (
  user_id = auth.uid() and role = 'member'
  and exists (select 1 from public.clubs c where c.id = club_id and c.open));
drop policy if exists "leave or remove" on public.club_members;
create policy "leave or remove" on public.club_members for delete using (
  (user_id = auth.uid() and role <> 'owner') or (public.club_role(club_id) in ('owner', 'admin') and role = 'member'));
drop policy if exists "owner promotes" on public.club_members;
create policy "owner promotes" on public.club_members for update using (public.club_role(club_id) = 'owner') with check (role <> 'owner');
revoke update on public.club_members from authenticated;
grant update (role) on public.club_members to authenticated;

-- Teams hold at most 6 athletes.
create or replace function public.club_members_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select kind from public.clubs where id = new.club_id) = 'team'
     and (select count(*) from public.club_members where club_id = new.club_id) >= 6 then
    raise exception 'Teams have at most 6 athletes';
  end if;
  return new;
end;
$$;
drop trigger if exists club_members_guard on public.club_members;
create trigger club_members_guard before insert on public.club_members for each row execute function public.club_members_guard();

-- When the owner leaves VYRA (account deleted), hand the club to its longest-standing
-- admin, else its longest-standing member, so a gym doesn't vanish for everyone.
create or replace function public.club_owner_handover()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and not exists (select 1 from public.club_members where club_id = old.club_id and role = 'owner') then
    update public.club_members set role = 'owner'
    where club_id = old.club_id and user_id = (
      select user_id from public.club_members where club_id = old.club_id
      order by (role = 'admin') desc, joined_at asc limit 1);
  end if;
  return null;
end;
$$;
drop trigger if exists club_owner_handover on public.club_members;
create trigger club_owner_handover after delete on public.club_members for each row execute function public.club_owner_handover();

-- Join a closed club with its invite code (open clubs work too).
create or replace function public.join_club(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into cid from public.clubs where invite_code = upper(btrim(p_code));
  if cid is null then raise exception 'No club with that code'; end if;
  insert into public.club_members (club_id, user_id, role) values (cid, auth.uid(), 'member') on conflict do nothing;
  return cid;
end;
$$;

-- Invite code for admins.
create or replace function public.club_invite_code(p_club uuid)
returns text language sql stable security definer set search_path = '' as $$
  select invite_code from public.clubs where id = p_club and public.club_role(p_club) in ('owner', 'admin');
$$;

-- Directory search and my clubs.
create or replace function public.search_clubs(p_query text default '', p_country text default null)
returns table (id uuid, name text, kind text, country text, city text, open boolean, partner boolean, members bigint, my_role text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.kind, c.country, c.city, c.open, c.partner,
         (select count(*) from public.club_members m where m.club_id = c.id),
         (select m.role from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())
  from public.clubs c
  where (coalesce(btrim(p_query), '') = '' or c.name ilike '%' || btrim(p_query) || '%' or c.city ilike btrim(p_query) || '%')
    and (p_country is null or c.country = p_country)
  order by c.partner desc, (select count(*) from public.club_members m where m.club_id = c.id) desc, c.name
  limit 50;
$$;

create or replace function public.my_clubs()
returns table (id uuid, name text, kind text, country text, city text, open boolean, partner boolean, members bigint, my_role text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.kind, c.country, c.city, c.open, c.partner,
         (select count(*) from public.club_members m where m.club_id = c.id), me.role
  from public.club_members me join public.clubs c on c.id = me.club_id
  where me.user_id = auth.uid()
  order by c.name;
$$;

-- Club page: details, roster (names only) and whether I'm in.
create or replace function public.club_detail(p_club uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'kind', c.kind, 'country', c.country, 'city', c.city, 'description', c.description,
    'open', c.open, 'partner', c.partner, 'my_role', public.club_role(c.id),
    'members', (select count(*) from public.club_members m where m.club_id = c.id),
    'roster', case when public.club_role(c.id) is not null or c.open then coalesce((
       select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', coalesce(a.display_name, 'Athlete'), 'handle', a.handle, 'role', m.role,
                                           'public', a.visibility = 'public') order by m.role, a.display_name)
       from public.club_members m left join public.athletes a on a.user_id = m.user_id where m.club_id = c.id), '[]'::jsonb) else '[]'::jsonb end
  ) from public.clubs c where c.id = p_club;
$$;

revoke all on function public.join_club(text) from public, anon;
revoke all on function public.club_invite_code(uuid) from public, anon;
revoke all on function public.my_clubs() from public, anon;
grant execute on function public.join_club(text) to authenticated;
grant execute on function public.club_invite_code(uuid) to authenticated;
grant execute on function public.my_clubs() to authenticated;
grant execute on function public.search_clubs(text, text) to anon, authenticated;
grant execute on function public.club_detail(uuid) to anon, authenticated;

-- ── Leaderboards with local and club scope (replaces the Phase 1 signature) ──
drop function if exists public.leaderboard(text, text, text, timestamptz, timestamptz, text, int, int, int);
create or replace function public.leaderboard(
  p_challenge text, p_variant text, p_division text,
  p_since timestamptz default null, p_until timestamptz default null,
  p_category text default null, p_min_birth int default null, p_max_birth int default null,
  p_limit int default 50, p_country text default null, p_city text default null, p_club uuid default null
)
returns table (rank bigint, total bigint, display_name text, handle text, score numeric, performed_at timestamptz, verification text, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with eligible as (
    select a.user_id, a.score, a.better, a.performed_at, a.verification
    from public.attempts a
    join public.athletes p on p.user_id = a.user_id
    where a.challenge_id = p_challenge and a.variant = p_variant and a.division = p_division
      and not a.deleted and not a.dnf and a.verification in ('community', 'verified')
      and p.leaderboards
      and (p_since is null or a.performed_at >= p_since)
      and (p_until is null or a.performed_at < p_until)
      and (p_category is null or p.category = p_category)
      and (p_min_birth is null or p.birth_year >= p_min_birth)
      and (p_max_birth is null or p.birth_year <= p_max_birth)
      and (p_country is null or p.country = p_country)
      and (p_city is null or lower(p.city) = lower(p_city))
      and (p_club is null or exists (select 1 from public.club_members m where m.club_id = p_club and m.user_id = a.user_id))
  ),
  best as (
    select distinct on (user_id) user_id, score, performed_at, verification, better
    from eligible
    order by user_id, case when better = 'lower' then score end asc, case when better = 'higher' then score end desc, performed_at asc
  ),
  ranked as (
    select b.*, rank() over (order by case when b.better = 'lower' then b.score end asc, case when b.better = 'higher' then b.score end desc) as rank,
           count(*) over () as total
    from best b
  )
  select r.rank, r.total, coalesce(p.display_name, 'Athlete'), p.handle, r.score, r.performed_at, r.verification, r.user_id = auth.uid()
  from ranked r join public.athletes p on p.user_id = r.user_id
  where r.rank <= greatest(1, least(p_limit, 200)) or r.user_id = auth.uid()
  order by r.rank;
$$;
grant execute on function public.leaderboard(text, text, text, timestamptz, timestamptz, text, int, int, int, text, text, uuid) to anon, authenticated;

-- ── Gym vs gym ───────────────────────────────────────────────────────────────
-- Every opted-in athlete gets placement points on the overall board (1st 100 → last 10);
-- a club's score is the sum of its top 10 members, so both depth and speed count.
create or replace function public.club_battle(
  p_challenge text, p_variant text, p_division text,
  p_since timestamptz default null, p_until timestamptz default null, p_country text default null, p_kind text default null
)
returns table (rank bigint, club_id uuid, name text, kind text, city text, country text, partner boolean, score bigint, athletes bigint, mine boolean)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (a.user_id) a.user_id, a.score, a.better
    from public.attempts a join public.athletes p on p.user_id = a.user_id
    where a.challenge_id = p_challenge and a.variant = p_variant and a.division = p_division
      and not a.deleted and not a.dnf and a.verification in ('community', 'verified') and p.leaderboards
      and (p_since is null or a.performed_at >= p_since) and (p_until is null or a.performed_at < p_until)
    order by a.user_id, case when a.better = 'lower' then a.score end asc, case when a.better = 'higher' then a.score end desc
  ),
  placed as (
    select b.user_id,
           rank() over (order by case when b.better = 'lower' then b.score end asc, case when b.better = 'higher' then b.score end desc) as r,
           count(*) over () as n
    from best b
  ),
  pts as (
    select user_id, round(case when n <= 1 then 100 else 100 - 90.0 * (r - 1) / (n - 1) end)::bigint as points from placed
  ),
  per_club as (
    select m.club_id, p.points, row_number() over (partition by m.club_id order by p.points desc) as k
    from pts p join public.club_members m on m.user_id = p.user_id
  ),
  totals as (
    select club_id, sum(points) filter (where k <= 10)::bigint as score, count(*) as athletes from per_club group by club_id
  )
  select rank() over (order by t.score desc, t.athletes desc), c.id, c.name, c.kind, c.city, c.country, c.partner, t.score, t.athletes,
         exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid())
  from totals t join public.clubs c on c.id = t.club_id
  where (p_country is null or c.country = p_country) and (p_kind is null or c.kind = p_kind)
  order by 1
  limit 100;
$$;
grant execute on function public.club_battle(text, text, text, timestamptz, timestamptz, text, text) to anon, authenticated;

-- ── In-person events hosted by a club or partner gym ─────────────────────────
alter table public.events add column if not exists host_club uuid references public.clubs (id) on delete set null;

-- Staff flag partner gyms (staff aren't club admins, so this goes through a function).
create or replace function public.set_partner(p_club uuid, p_partner boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.clubs set partner = p_partner where id = p_club;
end;
$$;
revoke all on function public.set_partner(uuid, boolean) from public, anon;
grant execute on function public.set_partner(uuid, boolean) to authenticated;
