-- ════════════════════════════════════════════════════════════════════════════
-- Iron Forest — Community: follows, activity feed, reactions, comments
-- Run once in the Supabase SQL editor AFTER 002_competition.sql. Safe to re-run.
--
-- Privacy model
--   athletes.activity   off (default) | followers | public — who may see your activity
--   follows             you can only follow athletes whose profile is public
--   activity            your workouts/results; never directly readable by others
--   reactions/comments  only on activity you are allowed to see
--   Everything others see comes through the functions below, which apply the rules.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.athletes add column if not exists activity text not null default 'off';
alter table public.athletes drop constraint if exists athletes_activity_check;
alter table public.athletes add constraint athletes_activity_check check (activity in ('off', 'followers', 'public'));

-- ── Follows ──────────────────────────────────────────────────────────────────
create table if not exists public.follows (
  follower   uuid not null references auth.users (id) on delete cascade,
  followee   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
alter table public.follows enable row level security;

drop policy if exists "see my follows" on public.follows;
create policy "see my follows" on public.follows
  for select using (auth.uid() in (follower, followee));

drop policy if exists "follow public athletes" on public.follows;
create policy "follow public athletes" on public.follows
  for insert with check (
    follower = auth.uid()
    and exists (select 1 from public.athletes a where a.user_id = followee and a.visibility = 'public')
  );

drop policy if exists "unfollow" on public.follows;
create policy "unfollow" on public.follows
  for delete using (follower = auth.uid());

-- ── Activity ─────────────────────────────────────────────────────────────────
create table if not exists public.activity (
  user_id      uuid not null references auth.users (id) on delete cascade,
  id           text not null,
  kind         text not null check (kind in ('workout', 'result')),
  title        text not null check (char_length(title) <= 80),
  challenge_id text,
  variant      text,
  division     text,
  score        numeric,
  better       text check (better in ('lower', 'higher')),
  pr           boolean not null default false,
  first        boolean not null default false,
  dnf          boolean not null default false,
  duration_sec int,
  performed_at timestamptz not null,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists activity_recent on public.activity (performed_at desc);
alter table public.activity enable row level security;

drop policy if exists "own activity" on public.activity;
create policy "own activity" on public.activity
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Can the signed-in user see this athlete's activity?
create or replace function public.can_see_activity(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_owner = auth.uid()
    or exists (
      select 1 from public.athletes a
      where a.user_id = p_owner and a.visibility = 'public'
        and (a.activity = 'public'
             or (a.activity = 'followers' and exists (
                   select 1 from public.follows f where f.follower = auth.uid() and f.followee = p_owner)))
    );
$$;

-- ── Reactions & comments ─────────────────────────────────────────────────────
create table if not exists public.reactions (
  owner       uuid not null,
  activity_id text not null,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('respect', 'fire', 'strong')),
  created_at  timestamptz not null default now(),
  primary key (owner, activity_id, user_id, kind),
  foreign key (owner, activity_id) references public.activity (user_id, id) on delete cascade
);
alter table public.reactions enable row level security;

drop policy if exists "react to visible activity" on public.reactions;
create policy "react to visible activity" on public.reactions
  for insert with check (user_id = auth.uid() and public.can_see_activity(owner));
drop policy if exists "see my reactions" on public.reactions;
create policy "see my reactions" on public.reactions
  for select using (user_id = auth.uid());
drop policy if exists "remove my reactions" on public.reactions;
create policy "remove my reactions" on public.reactions
  for delete using (user_id = auth.uid());

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null,
  activity_id text not null,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 280),
  created_at  timestamptz not null default now(),
  foreign key (owner, activity_id) references public.activity (user_id, id) on delete cascade
);
create index if not exists comments_activity on public.comments (owner, activity_id, created_at);
alter table public.comments enable row level security;

drop policy if exists "comment on visible activity" on public.comments;
create policy "comment on visible activity" on public.comments
  for insert with check (user_id = auth.uid() and public.can_see_activity(owner));
drop policy if exists "see my comments" on public.comments;
create policy "see my comments" on public.comments
  for select using (user_id = auth.uid() or owner = auth.uid());
-- Authors can delete their comments; athletes can delete comments on their own activity.
drop policy if exists "delete comments" on public.comments;
create policy "delete comments" on public.comments
  for delete using (user_id = auth.uid() or owner = auth.uid());

-- ── Read functions (apply the privacy rules) ─────────────────────────────────

-- Feed: my activity plus activity of athletes I follow that I'm allowed to see.
create or replace function public.feed(p_limit int default 30, p_before timestamptz default null)
returns table (owner uuid, id text, kind text, title text, challenge_id text, variant text, division text,
  score numeric, better text, pr boolean, first boolean, dnf boolean, duration_sec int, performed_at timestamptz,
  display_name text, handle text, is_me boolean,
  respect bigint, fire bigint, strong bigint, my_reactions text[], comment_count bigint)
language sql stable security definer set search_path = '' as $$
  select a.user_id, a.id, a.kind, a.title, a.challenge_id, a.variant, a.division,
         a.score, a.better, a.pr, a.first, a.dnf, a.duration_sec, a.performed_at,
         coalesce(p.display_name, 'Athlete'), p.handle, a.user_id = auth.uid(),
         (select count(*) from public.reactions r where r.owner = a.user_id and r.activity_id = a.id and r.kind = 'respect'),
         (select count(*) from public.reactions r where r.owner = a.user_id and r.activity_id = a.id and r.kind = 'fire'),
         (select count(*) from public.reactions r where r.owner = a.user_id and r.activity_id = a.id and r.kind = 'strong'),
         coalesce((select array_agg(r.kind) from public.reactions r where r.owner = a.user_id and r.activity_id = a.id and r.user_id = auth.uid()), '{}'),
         (select count(*) from public.comments c where c.owner = a.user_id and c.activity_id = a.id)
  from public.activity a
  left join public.athletes p on p.user_id = a.user_id
  where auth.uid() is not null
    and not a.deleted
    and (a.user_id = auth.uid()
         or (exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = a.user_id)
             and public.can_see_activity(a.user_id)))
    and (p_before is null or a.performed_at < p_before)
  order by a.performed_at desc
  limit greatest(1, least(p_limit, 100));
$$;

-- Comments on one activity, oldest first (only if the caller may see it).
create or replace function public.activity_comments(p_owner uuid, p_id text)
returns table (id uuid, body text, created_at timestamptz, display_name text, handle text, is_me boolean, can_delete boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.body, c.created_at, coalesce(p.display_name, 'Athlete'), p.handle,
         c.user_id = auth.uid(), (c.user_id = auth.uid() or c.owner = auth.uid())
  from public.comments c
  left join public.athletes p on p.user_id = c.user_id
  where c.owner = p_owner and c.activity_id = p_id and public.can_see_activity(p_owner)
  order by c.created_at asc
  limit 200;
$$;

-- Public athletes by handle or name.
create or replace function public.search_athletes(p_query text)
returns table (user_id uuid, display_name text, handle text, division text, i_follow boolean)
language sql stable security definer set search_path = '' as $$
  select a.user_id, coalesce(a.display_name, 'Athlete'), a.handle, a.division,
         exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = a.user_id)
  from public.athletes a
  where a.visibility = 'public' and a.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and char_length(btrim(p_query)) >= 2
    and (a.handle ilike btrim(p_query) || '%' or a.display_name ilike '%' || btrim(p_query) || '%')
  order by a.handle nulls last
  limit 20;
$$;

-- One athlete's profile card, records and recent activity (as far as the caller may see).
create or replace function public.athlete_profile(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when a.user_id is null or (a.visibility <> 'public' and a.user_id <> auth.uid()) then null else jsonb_build_object(
    'user_id', a.user_id, 'display_name', coalesce(a.display_name, 'Athlete'), 'handle', a.handle,
    'division', a.division, 'category', a.category, 'is_me', a.user_id = auth.uid(),
    'followers', (select count(*) from public.follows f where f.followee = a.user_id),
    'following', (select count(*) from public.follows f where f.follower = a.user_id),
    'i_follow', exists (select 1 from public.follows f where f.follower = auth.uid() and f.followee = a.user_id),
    'records', case when a.leaderboards or a.user_id = auth.uid() then coalesce((
        select jsonb_agg(r order by r.performed_at desc) from (
          select distinct on (t.challenge_id, t.variant, t.division)
                 t.challenge_id, t.variant, t.division, t.score, t.better, t.performed_at
          from public.attempts t
          where t.user_id = a.user_id and not t.deleted and not t.dnf and t.verification in ('community', 'verified')
          order by t.challenge_id, t.variant, t.division,
                   case when t.better = 'lower' then t.score end asc,
                   case when t.better = 'higher' then t.score end desc) r), '[]'::jsonb) else '[]'::jsonb end,
    'activity', case when public.can_see_activity(a.user_id) then coalesce((
        select jsonb_agg(x order by x.performed_at desc) from (
          select v.id, v.kind, v.title, v.challenge_id, v.variant, v.division, v.score, v.better, v.pr, v.first, v.dnf, v.duration_sec, v.performed_at
          from public.activity v where v.user_id = a.user_id and not v.deleted
          order by v.performed_at desc limit 10) x), '[]'::jsonb) else null end
  ) end
  from (select p_user as id) q
  left join public.athletes a on a.user_id = q.id;
$$;

revoke all on function public.feed(int, timestamptz) from public, anon;
revoke all on function public.activity_comments(uuid, text) from public, anon;
revoke all on function public.search_athletes(text) from public, anon;
revoke all on function public.athlete_profile(uuid) from public, anon;
grant execute on function public.feed(int, timestamptz) to authenticated;
grant execute on function public.activity_comments(uuid, text) to authenticated;
grant execute on function public.search_athletes(text) to authenticated;
grant execute on function public.athlete_profile(uuid) to authenticated;
grant execute on function public.can_see_activity(uuid) to authenticated;
