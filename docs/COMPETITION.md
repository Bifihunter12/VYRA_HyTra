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

## Next

**Phase 2:** follow athletes, activity feed with reactions and comments,
"Challenge this result", monthly challenge badges, division badges.
Needs: `follows`, `activity`, `reactions` tables with RLS.

**Phase 3:** ghost racing (pace against a previous attempt's splits, which are already
stored per segment), video verification queue, special events with registration,
countdown, divisions and Forest Points. Iron Forest: secret Trials (Hunt,
Forge, Burden, Mountain, River, Stand) scored to Forest Points so no single
strength wins, plus The Escape.

**Phase 4:** clubs, teams, gym-vs-gym and local leaderboards, physical events.
