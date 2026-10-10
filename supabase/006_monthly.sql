-- ════════════════════════════════════════════════════════════════════════════
-- Iron Forest — Monthly challenge results: who won each month
--
-- Every month has one featured challenge from a fixed 12-month rotation (the
-- same list as MONTHLY_ROTATION in challenges.js; a test keeps them in sync).
-- Months run in UTC. A month's results are frozen one day after it ends (time
-- for offline phones to sync): the first time anyone opens the results after
-- that, close_month() stores the final ranking of every division. No scheduled
-- job is needed. Run after 005_clubs.sql. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.monthly_rotation (
  month_index  int primary key check (month_index between 0 and 11),   -- 0 = January
  challenge_id text not null,
  variant      text not null
);
insert into public.monthly_rotation (month_index, challenge_id, variant) values
  (0, 'the-hundred', 'standard'), (1, 'the-storm', '20'), (2, 'iron-mile', 'standard'), (3, 'the-burden', '5'),
  (4, 'the-hunt', '5k'), (5, 'the-forge', 'standard'), (6, 'the-river', '2k'), (7, 'the-chase', 'standard'),
  (8, 'the-stand', '5'), (9, 'the-mill', 'standard'), (10, 'the-escape', 'standard'), (11, 'the-clearing', 'standard')
on conflict (month_index) do update set challenge_id = excluded.challenge_id, variant = excluded.variant;

-- One row per closed month, division and board. Each month has two boards: the
-- original (variant, e.g. 'standard') and Anywhere, without machines ('standard~any').
create table if not exists public.monthly_closings (
  month        date not null,
  division     text not null,
  challenge_id text not null,
  variant      text not null,
  better       text,
  participants int  not null default 0,
  closed_at    timestamptz not null default now(),
  primary key (month, division, variant)
);

-- The final ranking of every athlete who took part.
create table if not exists public.monthly_results (
  month        date not null,
  division     text not null,
  rank         int  not null,
  variant      text,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  handle       text,
  score        numeric not null,
  verification text not null,
  primary key (month, division, variant, user_id)
);
-- Upgrade from the first version of this file (one board per month).
alter table public.monthly_results add column if not exists variant text;
update public.monthly_results r set variant = c.variant from public.monthly_closings c
  where r.variant is null and c.month = r.month and c.division = r.division;
delete from public.monthly_results where variant is null;
alter table public.monthly_results alter column variant set not null;
alter table public.monthly_results drop constraint if exists monthly_results_pkey;
alter table public.monthly_results add primary key (month, division, variant, user_id);
alter table public.monthly_closings drop constraint if exists monthly_closings_pkey;
alter table public.monthly_closings add primary key (month, division, variant);
drop index if exists public.monthly_results_rank;
create index if not exists monthly_results_rank on public.monthly_results (month, division, variant, rank);

-- Everyone may read the results (they only hold what leaderboards already show); nobody writes directly.
alter table public.monthly_rotation  enable row level security;
alter table public.monthly_closings  enable row level security;
alter table public.monthly_results   enable row level security;
drop policy if exists "rotation is public" on public.monthly_rotation;
create policy "rotation is public" on public.monthly_rotation for select using (true);
drop policy if exists "closings are public" on public.monthly_closings;
create policy "closings are public" on public.monthly_closings for select using (true);
drop policy if exists "results are public" on public.monthly_results;
create policy "results are public" on public.monthly_results for select using (true);

-- Freeze one month (any day inside it). Does nothing while the month or its one-day grace is running,
-- or when the month is already closed.
create or replace function public.close_month(p_month date)
returns void language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  m   date := date_trunc('month', p_month)::date;
  s   timestamptz := (m::timestamp) at time zone 'utc';
  e   timestamptz := ((m + interval '1 month')::timestamp) at time zone 'utc';
  ch  text; va text; d text; b text;
begin
  if now() < e + interval '1 day' then return; end if;
  if exists (select 1 from public.monthly_closings c where c.month = m) then return; end if;
  select r.challenge_id, r.variant into ch, va from public.monthly_rotation r where r.month_index = extract(month from m)::int - 1;
  if ch is null then return; end if;

  foreach d in array array['open', 'competitive', 'elite'] loop
  foreach b in array array[va, va || '~any'] loop
    insert into public.monthly_results (month, division, variant, rank, user_id, display_name, handle, score, verification)
    select m, d, b, ranked.rank, ranked.user_id, coalesce(p.display_name, 'Athlete'), p.handle, ranked.score, ranked.verification
    from (
      select b.*, rank() over (order by case when b.better = 'lower' then b.score end asc,
                                        case when b.better = 'higher' then b.score end desc)::int as rank
      from (
        select distinct on (a.user_id) a.user_id, a.score, a.better, a.verification
        from public.attempts a
        join public.athletes p on p.user_id = a.user_id
        where a.challenge_id = ch and a.variant = b and a.division = d
          and not a.deleted and not a.dnf and a.verification in ('community', 'verified')
          and p.leaderboards
          and a.performed_at >= s and a.performed_at < e
        order by a.user_id, case when a.better = 'lower' then a.score end asc,
                 case when a.better = 'higher' then a.score end desc, a.performed_at asc
      ) b
    ) ranked
    join public.athletes p on p.user_id = ranked.user_id
    on conflict do nothing;

    insert into public.monthly_closings (month, division, challenge_id, variant, better, participants)
    values (m, d, ch, b,
            (select a.better from public.attempts a where a.challenge_id = ch limit 1),
            (select count(*) from public.monthly_results r where r.month = m and r.division = d and r.variant = b))
    on conflict do nothing;
  end loop;
  end loop;
end;
$$;
revoke execute on function public.close_month(date) from public, anon, authenticated;

-- Past months, newest first: the podium (top 3) of each division, plus the caller's own place.
-- Closes any finished months on the way, starting from the first month anyone logged a result.
create or replace function public.monthly_hall(p_months int default 12)
returns table (month date, division text, challenge_id text, variant text, better text, participants int,
               rank int, display_name text, handle text, score numeric, verification text, is_me boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  n      int  := least(greatest(coalesce(p_months, 12), 1), 36);
  this   date := date_trunc('month', now() at time zone 'utc')::date;
  first  date := (select date_trunc('month', min(a.performed_at) at time zone 'utc')::date from public.attempts a where not a.deleted);
  i      int;
begin
  if first is not null then
    for i in 1..n loop
      exit when (this - make_interval(months => i))::date < first;
      perform public.close_month((this - make_interval(months => i))::date);
    end loop;
  end if;
  return query
    select c.month, c.division, c.challenge_id, c.variant, c.better, c.participants,
           r.rank, r.display_name, r.handle, r.score, r.verification, coalesce(r.user_id = auth.uid(), false)
    from public.monthly_closings c
    left join public.monthly_results r
      on r.month = c.month and r.division = c.division and r.variant = c.variant and (r.rank <= 3 or r.user_id = auth.uid())
    where c.month >= (this - make_interval(months => n))::date
    order by c.month desc, c.division, c.variant, r.rank nulls last;
end;
$$;
grant execute on function public.monthly_hall(int) to anon, authenticated;
