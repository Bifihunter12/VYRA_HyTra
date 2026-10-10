-- ════════════════════════════════════════════════════════════════════════════
-- Iron Forest — Events & verification (Phase 3)
-- Run once in the Supabase SQL editor AFTER 003_community.sql. Safe to re-run.
--
--   staff                Iron Forest reviewers (add rows by hand in the Table Editor)
--   verification_requests  athletes submit a video link for a result; staff review
--   events               online or in-person competitions (Iron Forest, Wild Hunt…)
--   event_trials         each event's Trials, defined as data; SECRET until reveal_at
--   registrations        who entered which event, in which division
--   attempts.event_id    a result counts for an event only if registered and inside the window
--   event_standings()    Forest Points per Trial → Forest Score
-- ════════════════════════════════════════════════════════════════════════════

-- ── Staff & verification ─────────────────────────────────────────────────────
create table if not exists public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.staff enable row level security;   -- no policies: only the dashboard can edit

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.user_id = auth.uid());
$$;
grant execute on function public.is_staff() to authenticated;

-- Only staff may mark a result verified (replaces the Phase 1 guard).
create or replace function public.attempts_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.verification = 'verified' and (tg_op = 'INSERT' or old.verification is distinct from 'verified') and not public.is_staff() then
    new.verification := 'community';
  end if;
  -- Editing a verified result's score sends it back to community.
  if tg_op = 'UPDATE' and old.verification = 'verified' and new.score is distinct from old.score and not public.is_staff() then
    new.verification := 'community';
  end if;
  return new;
end;
$$;

create table if not exists public.verification_requests (
  user_id     uuid not null references auth.users (id) on delete cascade,
  attempt_id  text not null,
  video_url   text not null check (video_url ~ '^https://\S+$' and char_length(video_url) between 12 and 500),
  note        text check (char_length(note) <= 280),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer    uuid references auth.users (id) on delete set null,
  review_note text check (char_length(review_note) <= 280),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key (user_id, attempt_id),
  foreign key (user_id, attempt_id) references public.attempts (user_id, id) on delete cascade
);
alter table public.verification_requests enable row level security;

drop policy if exists "request verification" on public.verification_requests;
create policy "request verification" on public.verification_requests
  for insert with check (user_id = auth.uid() and status = 'pending' and reviewer is null);
drop policy if exists "see my requests" on public.verification_requests;
create policy "see my requests" on public.verification_requests
  for select using (user_id = auth.uid());
-- Re-submitting a new link resets the request to pending.
drop policy if exists "resubmit my request" on public.verification_requests;
create policy "resubmit my request" on public.verification_requests
  for update using (user_id = auth.uid()) with check (user_id = auth.uid() and status = 'pending' and reviewer is null);

create or replace function public.review_queue()
returns table (user_id uuid, attempt_id text, display_name text, challenge_id text, variant text, division text,
  score numeric, video_url text, note text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.user_id, r.attempt_id, coalesce(p.display_name, 'Athlete'), a.challenge_id, a.variant, a.division, a.score, r.video_url, r.note, r.created_at
  from public.verification_requests r
  join public.attempts a on a.user_id = r.user_id and a.id = r.attempt_id
  left join public.athletes p on p.user_id = r.user_id
  where public.is_staff() and r.status = 'pending' and not a.deleted
  order by r.created_at asc
  limit 200;
$$;

create or replace function public.review_attempt(p_user uuid, p_attempt text, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.verification_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewer = auth.uid(), review_note = p_note, reviewed_at = now()
   where user_id = p_user and attempt_id = p_attempt;
  if not found then raise exception 'no such request'; end if;
  update public.attempts set verification = case when p_approve then 'verified' else 'community' end
   where user_id = p_user and id = p_attempt;
end;
$$;

revoke all on function public.review_queue() from public, anon;
revoke all on function public.review_attempt(uuid, text, boolean, text) from public, anon;
grant execute on function public.review_queue() to authenticated;
grant execute on function public.review_attempt(uuid, text, boolean, text) to authenticated;

-- ── Events ───────────────────────────────────────────────────────────────────
create table if not exists public.events (
  id                 text primary key,
  name               text not null,
  kind               text not null default 'online' check (kind in ('online', 'in_person')),
  tagline            text,
  pitch              text,
  tests              text[] not null default '{}',
  location           text,
  capacity           int,
  registration_opens timestamptz not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  final_at           timestamptz not null,
  reveal_at          timestamptz not null,
  divisions          text[] not null default '{open,competitive,elite}',
  verify_top         int not null default 3,
  published          boolean not null default true,
  check (registration_opens <= starts_at and starts_at < ends_at and ends_at <= final_at)
);
alter table public.events enable row level security;
drop policy if exists "published events" on public.events;
create policy "published events" on public.events for select using (published);

create table if not exists public.event_trials (
  event_id text not null references public.events (id) on delete cascade,
  trial_id text not null,
  position int not null,
  name     text not null,
  weight   numeric not null default 1,
  spec     jsonb not null,
  primary key (event_id, trial_id)
);
alter table public.event_trials enable row level security;
-- The Trials stay secret until competition week: rows are invisible before reveal_at.
drop policy if exists "revealed trials" on public.event_trials;
create policy "revealed trials" on public.event_trials
  for select using (exists (select 1 from public.events e where e.id = event_id and e.published and now() >= e.reveal_at));

create table if not exists public.registrations (
  event_id   text not null references public.events (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  division   text not null check (division in ('open', 'competitive', 'elite')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.registrations enable row level security;

-- Counts every registration (the caller's own view only sees their row).
create or replace function public.event_has_room(p_event text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select e.capacity is null or (select count(*) from public.registrations r where r.event_id = e.id) < e.capacity
                   from public.events e where e.id = p_event), false);
$$;
grant execute on function public.event_has_room(text) to authenticated;

drop policy if exists "register while open" on public.registrations;
create policy "register while open" on public.registrations
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.events e
                where e.id = event_id and e.published and now() >= e.registration_opens and now() < e.ends_at
                  and division = any (e.divisions))
    and public.event_has_room(event_id)
  );
drop policy if exists "see my registrations" on public.registrations;
create policy "see my registrations" on public.registrations for select using (user_id = auth.uid());
drop policy if exists "withdraw before start" on public.registrations;
create policy "withdraw before start" on public.registrations
  for delete using (user_id = auth.uid() and exists (select 1 from public.events e where e.id = event_id and now() < e.starts_at));

-- Results can be tagged with an event Trial; the tag only sticks when it's legitimate.
alter table public.attempts add column if not exists event_id text;
alter table public.attempts add column if not exists trial_id text;
create index if not exists attempts_event on public.attempts (event_id, trial_id) where event_id is not null;

create or replace function public.attempts_event_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ev public.events%rowtype; reg public.registrations%rowtype;
begin
  if new.event_id is null then new.trial_id := null; return new; end if;
  select * into ev from public.events where id = new.event_id;
  select * into reg from public.registrations where event_id = new.event_id and user_id = new.user_id;
  if ev.id is null or reg.user_id is null
     or new.performed_at < ev.starts_at or new.performed_at >= ev.ends_at
     or now() > ev.ends_at + interval '1 day'
     or not exists (select 1 from public.event_trials t where t.event_id = new.event_id and t.trial_id = new.trial_id) then
    new.event_id := null; new.trial_id := null;      -- keep the result, drop the event tag
  else
    new.division := reg.division;                     -- events score in the registered division
  end if;
  return new;
end;
$$;

drop trigger if exists attempts_event_guard on public.attempts;
create trigger attempts_event_guard before insert or update on public.attempts
  for each row execute function public.attempts_event_guard();

-- Events list with the caller's registration.
create or replace function public.list_events()
returns table (id text, name text, kind text, tagline text, pitch text, tests text[], location text, capacity int,
  registration_opens timestamptz, starts_at timestamptz, ends_at timestamptz, final_at timestamptz, reveal_at timestamptz,
  divisions text[], verify_top int, registered bigint, my_division text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name, e.kind, e.tagline, e.pitch, e.tests, e.location, e.capacity,
         e.registration_opens, e.starts_at, e.ends_at, e.final_at, e.reveal_at, e.divisions, e.verify_top,
         (select count(*) from public.registrations r where r.event_id = e.id),
         (select r.division from public.registrations r where r.event_id = e.id and r.user_id = auth.uid())
  from public.events e
  where e.published
  order by e.starts_at;
$$;

-- Standings: per Trial each athlete's best counts; placement points (1st 100 → last 10) × weight; sum = Forest Score.
create or replace function public.event_standings(p_event text, p_division text, p_category text default null)
returns table (rank bigint, total bigint, display_name text, handle text, forest_score bigint, trials jsonb, trials_done bigint, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with regs as (
    select r.user_id from public.registrations r
    join public.athletes p on p.user_id = r.user_id
    where r.event_id = p_event and r.division = p_division and (p_category is null or p.category = p_category)
  ),
  best as (
    select distinct on (a.user_id, a.trial_id) a.user_id, a.trial_id, a.score, a.better, a.verification
    from public.attempts a join regs on regs.user_id = a.user_id
    where a.event_id = p_event and not a.deleted and not a.dnf and a.verification in ('community', 'verified')
    order by a.user_id, a.trial_id,
      case when a.better = 'lower' then a.score end asc, case when a.better = 'higher' then a.score end desc
  ),
  placed as (
    select b.*, t.weight, t.name as trial_name, t.position,
      rank() over (partition by b.trial_id order by case when b.better = 'lower' then b.score end asc,
                                                    case when b.better = 'higher' then b.score end desc) as trial_rank,
      count(*) over (partition by b.trial_id) as field
    from best b join public.event_trials t on t.event_id = p_event and t.trial_id = b.trial_id
  ),
  pts as (
    select p.*, round(p.weight * case when p.field <= 1 then 100 else 100 - 90.0 * (p.trial_rank - 1) / (p.field - 1) end)::bigint as points
    from placed p
  ),
  scored as (
    select user_id, sum(points)::bigint as forest_score, count(*) as trials_done,
      jsonb_agg(jsonb_build_object('trial', trial_id, 'name', trial_name, 'rank', trial_rank, 'points', points,
        'score', score, 'verified', verification = 'verified') order by position) as trials
    from pts group by user_id
  ),
  ranked as (
    select s.*, rank() over (order by s.forest_score desc, s.trials_done desc) as rank, count(*) over () as total from scored s
  )
  select r.rank, r.total, coalesce(a.display_name, 'Athlete'), a.handle, r.forest_score, r.trials, r.trials_done, r.user_id = auth.uid()
  from ranked r left join public.athletes a on a.user_id = r.user_id
  order by r.rank
  limit 500;
$$;

revoke all on function public.list_events() from public;
revoke all on function public.event_standings(text, text, text) from public;
grant execute on function public.list_events() to anon, authenticated;
grant execute on function public.event_standings(text, text, text) to anon, authenticated;

-- ── Seed: Iron Forest and Wild Hunt ──────────────────────────────────────────
insert into public.events (id, name, kind, tagline, pitch, tests, registration_opens, starts_at, ends_at, final_at, reveal_at, verify_top)
values
  ('iron-forest-2027', 'Iron Forest', 'online', 'The flagship hybrid competition',
   'Don''t train for one memorized race. Build a body ready for whatever the Forest asks of you.',
   '{Run,Carry,Climb,Lift,Pull,Endure}', '2027-02-01T00:00:00Z', '2027-03-01T00:00:00Z', '2027-03-08T00:00:00Z', '2027-03-10T00:00:00Z', '2027-03-01T00:00:00Z', 3),
  ('wild-hunt-2026', 'Wild Hunt', 'online', 'A week of running and chasing',
   'Two trials, one week. Hunt the distance, chase the clock.',
   '{Run,Chase}', '2026-10-15T00:00:00Z', '2026-11-01T00:00:00Z', '2026-11-08T00:00:00Z', '2026-11-10T00:00:00Z', '2026-11-01T00:00:00Z', 3)
on conflict (id) do update set name = excluded.name, tagline = excluded.tagline, pitch = excluded.pitch, tests = excluded.tests,
  registration_opens = excluded.registration_opens, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
  final_at = excluded.final_at, reveal_at = excluded.reveal_at, verify_top = excluded.verify_top;

insert into public.event_trials (event_id, trial_id, position, name, weight, spec) values
  ('iron-forest-2027', 'if-hunt', 1, 'The Hunt', 1, '{"id":"if-hunt","name":"The Hunt","scoring":"time","icon":"ti-run","tagline":"3 km run for time","rules":["Treadmill ≥ 1% incline, or flat outdoor route."],"segments":[{"type":"cardio","ex":"run","meters":3000,"estimate":900}]}'),
  ('iron-forest-2027', 'if-forge', 2, 'The Forge', 1, '{"id":"if-forge","name":"The Forge","scoring":"reps","icon":"ti-barbell","tagline":"6 minutes for reps","rules":["Repeat 8 KB swings, 8 goblet squats, 8 DB push press for 6 minutes.","Open KB 16 / DB 12.5 · Competitive KB 24 / DB 17.5 · Elite KB 32 / DB 22.5."],"inputs":[{"key":"reps","label":"Total reps","unit":"reps"}],"segments":[{"type":"station","name":"The Forge","sec":360,"exercises":[{"id":"kb-swing","reps":8},{"id":"goblet-squat","reps":8},{"id":"push-press","reps":8}]}]}'),
  ('iron-forest-2027', 'if-burden', 3, 'The Burden', 1, '{"id":"if-burden","name":"The Burden","scoring":"distance","icon":"ti-weight","tagline":"4 minutes of carrying","rules":["Farmer carry: Open 2×16 kg · Competitive 2×24 kg · Elite 2×32 kg."],"inputs":[{"key":"carry","label":"Meters carried","unit":"m"}],"segments":[{"type":"station","name":"The Burden","sec":240,"exercises":[{"id":"farmer-carry"}]}]}'),
  ('iron-forest-2027', 'if-mountain', 4, 'The Mountain', 1, '{"id":"if-mountain","name":"The Mountain","scoring":"distance","icon":"ti-mountain","tagline":"10 minutes of climbing","rules":["Treadmill incline ≥ 12% (Open 8%). No handrails."],"inputs":[{"key":"run","label":"Distance","unit":"km"}],"segments":[{"type":"cardio","ex":"incline-walk","sec":600}]}'),
  ('iron-forest-2027', 'if-river', 5, 'The River', 1, '{"id":"if-river","name":"The River","scoring":"time","icon":"ti-ripple","tagline":"1,000 m row for time","rules":["Any damper."],"segments":[{"type":"cardio","ex":"row","meters":1000,"estimate":240}]}'),
  ('iron-forest-2027', 'if-stand', 6, 'The Stand', 1, '{"id":"if-stand","name":"The Stand","scoring":"reps","icon":"ti-stairs","tagline":"4 minutes of lunges","rules":["Alternating reverse lunges holding DBs: Open 2×8 · Competitive 2×12.5 · Elite 2×17.5 kg."],"inputs":[{"key":"reps","label":"Total lunges","unit":"reps"}],"segments":[{"type":"station","name":"The Stand","sec":240,"exercises":[{"id":"reverse-lunge"}]}]}'),
  ('iron-forest-2027', 'if-escape', 7, 'The Escape', 1.5, '{"id":"if-escape","name":"The Escape","scoring":"time","icon":"ti-door-exit","tagline":"The final run out of the Forest","rules":["500 m row · 30 KB swings · 1 km bike · 20 goblet squats · 400 m run · 100 m farmer carry.","Worth 1.5× Forest Points."],"segments":[{"type":"cardio","ex":"row","meters":500,"estimate":120},{"type":"station","exercises":[{"id":"kb-swing","reps":30}],"estimate":80},{"type":"cardio","ex":"bike","meters":1000,"estimate":120},{"type":"station","exercises":[{"id":"goblet-squat","reps":20}],"estimate":70},{"type":"cardio","ex":"run","meters":400,"estimate":110},{"type":"station","exercises":[{"id":"farmer-carry","meters":100}],"estimate":90}]}'),
  ('wild-hunt-2026', 'wh-hunt', 1, 'The Hunt', 1, '{"id":"wh-hunt","name":"Wild Hunt: 5 km","scoring":"time","icon":"ti-run","tagline":"5 km run for time","segments":[{"type":"cardio","ex":"run","meters":5000,"estimate":1600}]}'),
  ('wild-hunt-2026', 'wh-chase', 2, 'The Chase', 1, '{"id":"wh-chase","name":"Wild Hunt: The Chase","scoring":"distance","icon":"ti-bolt","tagline":"10 × 1:00 hard / 1:00 easy","inputs":[{"key":"run","label":"Total distance","unit":"km"}],"segments":[{"type":"cardio","ex":"run","sec":60,"effort":"Hard"},{"type":"cardio","ex":"incline-walk","sec":60,"title":"Easy"}],"rounds":10}')
on conflict (event_id, trial_id) do update set position = excluded.position, name = excluded.name, weight = excluded.weight, spec = excluded.spec;
