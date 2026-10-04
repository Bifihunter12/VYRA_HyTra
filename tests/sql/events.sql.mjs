// Runs the real Supabase SQL in embedded Postgres (PGlite) and checks the Phase 3 rules.
import { supabaseLike } from "./harness.mjs";
import { fileURLToPath } from "url";
const R = fileURLToPath(new URL("../../supabase/", import.meta.url));
const files = ["schema.sql", "002_competition.sql", "003_community.sql", "004_events.sql"].map(f => R + f);
const db = await supabaseLike([...files, R + "004_events.sql"]);       // second run: re-runnable
const [A, B, C, S] = ["a", "b", "c", "5"].map(x => `00000000-0000-0000-0000-00000000000${x}`);
await db.exec(`insert into auth.users values ('${A}','a@x'),('${B}','b@x'),('${C}','c@x'),('${S}','staff@x')`);
let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(cond ? "  ✓" : "  ✗ FAIL", msg); };
const tryAs = async (uid, sql) => { try { await db.as(uid, sql); return true; } catch (e) { return false; } };
for (const [u, n] of [[A, "Caro"], [B, "Sam"], [C, "Lee"]])
  await db.as(u, `insert into athletes (user_id, display_name, handle, visibility, leaderboards, category) values ('${u}','${n}','${n.toLowerCase()}','public', true, 'open')`);
await db.exec(`insert into staff values ('${S}')`);

// A live test event: registration open, window running, Trials revealed. And a future secret one.
await db.exec(`insert into events (id, name, registration_opens, starts_at, ends_at, final_at, reveal_at, capacity) values
  ('live', 'Live Test', now() - interval '10 days', now() - interval '1 day', now() + interval '6 days', now() + interval '8 days', now() - interval '1 day', 2),
  ('secret', 'Secret Forest', now() + interval '10 days', now() + interval '20 days', now() + interval '27 days', now() + interval '29 days', now() + interval '20 days', null)`);
await db.exec(`insert into event_trials (event_id, trial_id, position, name, weight, spec) values
  ('live','t-time',1,'Run',1,'{"id":"t-time","scoring":"time","segments":[{"type":"cardio","ex":"run","meters":1000}]}'),
  ('live','t-dist',2,'Row',1.5,'{"id":"t-dist","scoring":"distance","segments":[{"type":"cardio","ex":"row","sec":600}]}'),
  ('secret','s1',1,'Hidden',1,'{"id":"s1","scoring":"time","segments":[{"type":"cardio","ex":"run","meters":400}]}')`);

console.log("events & secrecy");
ok((await db.as(null, `select * from list_events()`)).length >= 4, "anyone can list published events (incl. seeded Iron Forest & Wild Hunt)");
ok((await db.as(A, `select * from event_trials where event_id = 'live'`)).length === 2, "revealed Trials are visible");
ok((await db.as(A, `select * from event_trials where event_id = 'secret'`)).length === 0, "Trials stay secret before reveal_at");
ok((await db.as(A, `select * from event_trials where event_id = 'iron-forest-2027'`)).length === 0, "Iron Forest Trials are secret until competition week");
ok((await db.query(`select count(*)::int n from event_trials where event_id = 'iron-forest-2027'`)).rows[0].n === 7, "Iron Forest has 6 Trials + The Escape");

console.log("registration");
ok(await tryAs(A, `insert into registrations (event_id, division) values ('live','open')`), "A registers while open");
ok(!(await tryAs(A, `insert into registrations (event_id, division) values ('secret','open')`)), "cannot register before registration opens");
ok(!(await tryAs(B, `insert into registrations (event_id, user_id, division) values ('live','${C}','open')`)), "cannot register someone else");
ok(!(await tryAs(B, `insert into registrations (event_id, division) values ('live','pro')`)), "division must be one of the event's");
await db.as(B, `insert into registrations (event_id, division) values ('live','open')`);
ok(!(await tryAs(C, `insert into registrations (event_id, division) values ('live','open')`)), "capacity is enforced");
ok(!(await tryAs(A, `delete from registrations where event_id='live'`)) || (await db.as(A, `select * from registrations where event_id='live'`)).length === 1, "cannot withdraw after the start");

console.log("event results");
const att = (u, id, trial, score, better, extra = "") => db.as(u, `insert into attempts (user_id, id, challenge_id, variant, division, score, better, performed_at, event_id, trial_id) values ('${u}','${id}','${trial}','standard','elite',${score},'${better}', now()${extra}, 'live', '${trial}')`);
await att(A, "a-t", "t-time", 300, "lower"); await att(A, "a-d", "t-dist", 2400, "higher");
await att(B, "b-t", "t-time", 280, "lower"); await att(B, "b-d", "t-dist", 2300, "higher");
await db.as(C, `insert into attempts (user_id, id, challenge_id, variant, division, score, better, performed_at, event_id, trial_id) values ('${C}','c-t','t-time','standard','open',100,'lower', now(), 'live','t-time')`);
ok((await db.as(C, `select event_id from attempts where id='c-t'`))[0].event_id === null, "unregistered athlete's result loses the event tag");
ok((await db.as(A, `select division from attempts where id='a-t'`))[0].division === "open", "event results score in the registered division");
await db.as(A, `insert into attempts (user_id, id, challenge_id, variant, division, score, better, performed_at, event_id, trial_id) values ('${A}','a-old','t-time','standard','open',10,'lower', now() - interval '3 days', 'live','t-time')`);
ok((await db.as(A, `select event_id from attempts where id='a-old'`))[0].event_id === null, "results from before the window don't count");
const st = await db.as(A, `select * from event_standings('live','open')`);
console.log("   standings:", st.map(r => `${r.rank}.${r.display_name}=${r.forest_score} ${JSON.stringify(r.trials.map(t => t.points))}`).join("  "));
// Run: Sam 1st (100), Caro 2nd (10). Row (×1.5): Caro 1st (150), Sam 2nd (15). Caro 160, Sam 115.
ok(st.length === 2 && st[0].display_name === "Caro" && Number(st[0].forest_score) === 160 && Number(st[1].forest_score) === 115, "Forest Points: per-trial placement × weight, best runner doesn't automatically win");
ok(st.find(r => r.display_name === "Caro").is_me === true, "caller flagged in standings");

console.log("verification");
ok(!(await tryAs(A, `insert into verification_requests (user_id, attempt_id, video_url) values ('${A}','a-t','http://insecure')`)), "video link must be https");
ok(await tryAs(A, `insert into verification_requests (user_id, attempt_id, video_url) values ('${A}','a-t','https://youtu.be/abc123')`), "athlete submits a video link");
ok(!(await tryAs(A, `insert into verification_requests (user_id, attempt_id, video_url, status) values ('${A}','a-d','https://x.y/z','approved')`)), "athlete cannot self-approve");
ok(!(await tryAs(B, `insert into verification_requests (user_id, attempt_id, video_url) values ('${A}','a-d','https://x.y/z')`)), "cannot submit for someone else");
ok((await db.as(A, `select * from review_queue()`)).length === 0, "non-staff see an empty review queue");
ok(!(await tryAs(A, `select review_attempt('${A}','a-t', true)`)), "non-staff cannot review");
ok((await db.as(S, `select * from review_queue()`)).length === 1, "staff see pending requests");
await db.as(S, `select review_attempt('${A}','a-t', true, 'Clean reps')`);
ok((await db.as(A, `select verification from attempts where id='a-t'`))[0].verification === "verified", "staff approval verifies the result");
ok((await db.as(A, `select status from verification_requests where attempt_id='a-t'`))[0].status === "approved", "athlete sees the approval");
await db.as(A, `update attempts set score = 250 where id='a-t'`);
ok((await db.as(A, `select verification from attempts where id='a-t'`))[0].verification === "community", "changing a verified score removes verification");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
if (fails) process.exit(1);
