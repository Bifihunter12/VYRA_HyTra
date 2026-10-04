# VYRA Competition System

**Train alone. Compete together.** TRAIN → RECORD → IMPROVE → CHALLENGE → COMPETE → RETURN

## Models (`challenges.js`)

| Model | What it is |
|---|---|
| Movement | `EXERCISES` in `workouts.js` |
| Segment | A block: timed (`cardio("row", 600)`) or to a target (`cardio("run", null, { target })`, `station([...], null)`; tap DONE) |
| Challenge | `{ id, name, scoring, better, variants, divisions, rules, inputs, build }` |
| Attempt | Stored on the workout record: `{ challengeId, variant, division, score, better, splits, verification, dnf, pr, first }` |
| Result | Best attempt for challenge + variant + division in a period (`bestAttempt`) |
| Leaderboard | Best result per athlete, ranked (`rankEntries` locally, `leaderboard()` in Supabase) |
| Division | `open`, `competitive`, `elite`: scales loads/standards, keeps intent |
| Verification | `training` (private), `community` (leaderboards), `verified` (staff only) |
| Event | Dated competition built from challenges (`EVENTS`; Iron Forest teaser) |

Scores use base units: meters, seconds, reps, kg, rounds (fractional), points.
Scoring types: time (lower or higher wins), distance, reps, load, rounds, points, completion.

## Phase 1 (shipped)

- 17 benchmarks with variants and division standards
- Attempts, automatic PR detection with improvement ("NEW PR +0.80 km")
- Timers: timed, to-target (tap DONE) and for-time totals; warm-up excluded from scores
- Challenge history and personal-record lists
- Leaderboards: you / this month / all time, filtered by division, category and age group
- Athlete profile with privacy (private by default, leaderboard opt-in)
- Monthly challenge card (rotates automatically)
- Iron Forest teaser

## Phase 2 (shipped)

- Following (public profiles only), athlete search by name or @handle
- Activity feed: "SAM COMPLETED THREE RIVERS · 14.20 km · NEW PR", reactions
  (respect, fire, strong) and comments; authors and post owners can delete comments
- Share activity setting: off (default), followers, everyone. Training results
  post without a score
- Other athletes' profiles: followers, records ("Beat it") and recent activity
- Challenge this result: loads the exact challenge, variant and division with a
  "result to beat" banner, the target in the for-time clock, and a verdict
  ("You beat Sam by 2:52" / "Sam still leads by 0:20")
- Badges: monthly challenger, regular (3 months), five benchmarks, record
  breaker (5 PRs), competitive and elite standard; monthly medals on the profile
- `supabase/003_community.sql`: follows, activity, reactions, comments and
  `feed()`, `activity_comments()`, `search_athletes()`, `athlete_profile()`

## Phase 3 (shipped)

- **Ghost racing** on for-time challenges: race your PR (its per-segment
  checkpoints), a friend's result ("Challenge this result") or a target time.
  The player shows "YOU 3:00 · TARGET 2:35 · 25 SEC BEHIND" at every split
- **Verification:** training, community and verified. Any community result can
  be sent for review with a video link; staff verify or reject from a review
  queue; the status syncs back to the athlete. Events ask the top results per
  division (`verify_top`) to verify
- **Special events** (`events.js`, `supabase/004_events.sql`): registration
  window, capacity, countdown, competition window, divisions, rules, secret
  Trials revealed at `reveal_at`, standings per division and final results.
  Event results are tagged with the event and Trial and only count when the
  athlete is registered and inside the window (enforced in the database)
- **Forest Points:** each Trial ranks the field, 1st 100 → last 10, multiplied
  by the Trial's weight; the Forest Score is the sum, so no single strength wins
- **The Iron Forest 2027:** The Hunt, Forge, Burden, Mountain, River, Stand and
  The Escape (×1.5). Messaging: THE FOREST IS COMING / OPEN / ENTER THE IRON
  FOREST / CLOSED. **The Wild Hunt** (November 2026) is the first, smaller event
- Trials are data (JSON specs built with `challengeFromSpec`), so new events need
  no app update. Badges: Event athlete, Verified

## Phase 4 (shipped)

- **Clubs, gyms and teams** (`clubs.js`, `supabase/005_clubs.sql`): open or
  invite-code clubs, owner/admin/member roles, teams of up to 6
- **Club leaderboard** for the monthly challenge and a roster
- **Gym vs gym:** each club scores the placement points of its best 10 members on
  the monthly challenge; world or your country
- **Local leaderboards:** athletes add a city and country; every benchmark board
  filters to everywhere / country / city
- **Partner gyms** (staff-flagged) and **in-person events** hosted by a club, with
  a venue and capacity

## Next

- Event admin screen (today events are added with SQL; see the seed in 004)
- Push or email reminders when an event opens
- Payments for paid events and the club plan
