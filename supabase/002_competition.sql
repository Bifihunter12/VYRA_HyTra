-- ════════════════════════════════════════════════════════════════════════════
-- VYRA — Competition: athlete profiles, attempts, leaderboards
-- Run once in the Supabase SQL editor AFTER schema.sql. Safe to re-run.
--
-- Privacy model
--   athletes   public profile card; readable by others only when visibility = 'public'
--   attempts   benchmark results; NEVER directly readable by other users
--   leaderboard() returns only opted-in athletes, and only name + best score
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.athletes (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  handle       text unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) between 1 and 40),
  birth_year   int check (birth_year between 1900 and 2100),
  category     text not null default 'open' check (category in ('women', 'men', 'open')),
  division     text not null default 'open' check (division in ('open', 'competitive', 'elite')),
  visibility   text not null default 'private' check (visibility in ('private', 'public')),
  leaderboards boolean not null default false,
  updated_at   timestamptz not null default now()
);

alter table public.athletes enable row level security;

drop policy if exists "own athlete" on public.athletes;
create policy "own athlete" on public.athletes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "public athletes are visible" on public.athletes;
create policy "public athletes are visible" on public.athletes
  for select using (visibility = 'public');

create table if not exists public.attempts (
  user_id       uuid not null references auth.users (id) on delete cascade,
  id            text not null,
  challenge_id  text not null,
  variant       text not null,
  division      text not null check (division in ('open', 'competitive', 'elite')),
  score         numeric not null,
  better        text not null check (better in ('lower', 'higher')),
  verification  text not null default 'community' check (verification in ('training', 'community', 'verified')),
  dnf           boolean not null default false,
  performed_at  timestamptz not null,
  deleted       boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists attempts_board on public.attempts (challenge_id, variant, division, performed_at);

alter table public.attempts enable row level security;

drop policy if exists "own attempts" on public.attempts;
create policy "own attempts" on public.attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Athletes can't mark their own results as verified; only VYRA staff (service role) can.
create or replace function public.attempts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.verification = 'verified' and (tg_op = 'INSERT' or old.verification is distinct from 'verified') then
    new.verification := 'community';
  end if;
  return new;
end;
$$;

drop trigger if exists attempts_guard on public.attempts;
create trigger attempts_guard before insert or update on public.attempts
  for each row execute function public.attempts_guard();

-- Leaderboard: each athlete's best community/verified result, ranked.
-- Returns the top p_limit plus the caller's own row (wherever it ranks).
create or replace function public.leaderboard(
  p_challenge text, p_variant text, p_division text,
  p_since timestamptz default null, p_until timestamptz default null,
  p_category text default null, p_min_birth int default null, p_max_birth int default null,
  p_limit int default 50
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
  ),
  best as (
    select distinct on (user_id) user_id, score, performed_at, verification, better
    from eligible
    order by user_id,
      case when better = 'lower' then score end asc,
      case when better = 'higher' then score end desc,
      performed_at asc
  ),
  ranked as (
    select b.*,
      rank() over (order by case when b.better = 'lower' then b.score end asc,
                            case when b.better = 'higher' then b.score end desc) as rank,
      count(*) over () as total
    from best b
  )
  select r.rank, r.total, coalesce(p.display_name, 'Athlete'), p.handle, r.score, r.performed_at, r.verification,
         r.user_id = auth.uid() as is_me
  from ranked r join public.athletes p on p.user_id = r.user_id
  where r.rank <= greatest(1, least(p_limit, 200)) or r.user_id = auth.uid()
  order by r.rank;
$$;

revoke all on function public.leaderboard(text, text, text, timestamptz, timestamptz, text, int, int, int) from public;
grant execute on function public.leaderboard(text, text, text, timestamptz, timestamptz, text, int, int, int) to anon, authenticated;
