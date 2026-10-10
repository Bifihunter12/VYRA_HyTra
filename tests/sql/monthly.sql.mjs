// Runs the real Supabase SQL in embedded Postgres (PGlite) and checks the monthly results.
import { supabaseLike } from "./harness.mjs";
import { fileURLToPath } from "url";
import fs from "fs";
const R = fileURLToPath(new URL("../../supabase/", import.meta.url));
const files = ["schema.sql", "002_competition.sql", "003_community.sql", "004_events.sql", "005_clubs.sql", "006_monthly.sql"].map(f => R + f);
const db = await supabaseLike([...files, R + "006_monthly.sql"]);          // re-runnable
let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(cond ? "  ✓" : "  ✗ FAIL", msg); };
const tryAs = async (uid, sql) => { try { await db.as(uid, sql); return true; } catch { return false; } };

console.log("rotation");
const js = fs.readFileSync(fileURLToPath(new URL("../../challenges.js", import.meta.url)), "utf8");
const jsRot = [...js.match(/const MONTHLY_ROTATION = \[([\s\S]*?)\];/)[1].matchAll(/\["([a-z0-9-]+)", "([a-z0-9-]+)"\]/g)].map(m => `${m[1]}/${m[2]}`);
const sqlRot = (await db.query(`select challenge_id || '/' || variant as r from monthly_rotation order by month_index`)).rows.map(r => r.r);
ok(jsRot.length === 12 && JSON.stringify(jsRot) === JSON.stringify(sqlRot), "SQL rotation matches MONTHLY_ROTATION in challenges.js");

const ids = "abcdef0".split("").map(x => `00000000-0000-0000-0000-00000000000${x}`);
const [A, B, C, D, E, F, G] = ids;
await db.exec(`insert into auth.users values ${ids.map((u, i) => `('${u}','u${i}@x')`).join(",")}`);
const names = ["Ana", "Ben", "Caro", "Dee", "Eli", "Finn", "Gus"];
for (const [i, u] of ids.entries()) await db.as(u, `insert into athletes (user_id, display_name, handle, leaderboards, visibility) values ('${u}', '${names[i]}', '${names[i].toLowerCase()}', ${u !== D}, 'public')`);

// Last month's and this month's featured challenges (UTC months).
const months = (await db.query(`select
  (date_trunc('month', now() at time zone 'utc' - interval '1 day') - interval '1 month')::date as last,   -- a month past its 1-day grace
  date_trunc('month', now() at time zone 'utc')::date as this`)).rows[0];
const rot = async m => (await db.query(`select challenge_id, variant from monthly_rotation where month_index = extract(month from $1::date)::int - 1`, [m])).rows[0];
const last = await rot(months.last), cur = await rot(months.this);
let n = 0;
const att = (u, { m = months.last, ch = last, div = "open", score, ver = "community", dnf = false, del = false, day = 10 }) => db.as(u,
  `insert into attempts (user_id, id, challenge_id, variant, division, score, better, verification, dnf, deleted, performed_at)
   values ('${u}', 'x${++n}', '${ch.challenge_id}', '${ch.variant}', '${div}', ${score}, 'lower', '${ver}', ${dnf}, ${del}, ('${m.toISOString().slice(0, 10)}'::date + ${day - 1})::timestamp at time zone 'utc')`);
await att(A, { score: 300 }); await att(A, { score: 280 });          // best counts
await att(B, { score: 310 }); await att(C, { score: 290 });
await att(E, { score: 400 }); await att(F, { score: 500 });
await att(D, { score: 100 });                                         // opted out of leaderboards
await att(G, { score: 50, ver: "training" }); await att(G, { score: 60, dnf: true }); await att(G, { score: 70, del: true });
await att(B, { score: 200, ch: { challenge_id: "not-this-month", variant: "x" } });
await att(C, { div: "competitive", score: 260 });
await att(E, { score: 150, ch: { ...last, variant: `${last.variant}~any` } });   // Anywhere (no machines): its own board
await att(A, { m: months.this, ch: cur, score: 10, day: 2 });         // this month: still running

console.log("closing");
const hall = await db.as(F, `select * from monthly_hall(12)`);
const open = hall.filter(r => r.division === "open" && r.variant === last.variant && r.month.toISOString().slice(0, 7) === months.last.toISOString().slice(0, 7));
console.log("   open podium:", open.map(r => `${r.rank}.${r.display_name}:${r.score}${r.is_me ? "(me)" : ""}`).join("  "));
ok(open.length === 4 && open.slice(0, 3).map(r => r.display_name).join() === "Ana,Caro,Ben", "podium = best per athlete, ranked; training, DNF, deleted and opted-out ignored");
ok(open[3]?.is_me && open[3].display_name === "Finn" && open[3].rank === 5, "the caller's own place is included even off the podium");
ok(Number(open[0].participants) === 5 && open[0].challenge_id === last.challenge_id, "participants and the month's challenge recorded");
const comp = hall.filter(r => r.division === "competitive" && r.variant === last.variant && r.month.toISOString().slice(0, 7) === months.last.toISOString().slice(0, 7));
ok(comp.length === 1 && comp[0].display_name === "Caro" && comp[0].rank === 1, "each division has its own ranking");
const elite = hall.filter(r => r.division === "elite" && r.variant === last.variant && r.month.toISOString().slice(0, 7) === months.last.toISOString().slice(0, 7));
ok(elite.length === 1 && elite[0].rank === null && Number(elite[0].participants) === 0, "a division nobody entered closes empty");
const anyOpen = hall.filter(r => r.division === "open" && r.variant === `${last.variant}~any` && r.month.toISOString().slice(0, 7) === months.last.toISOString().slice(0, 7));
ok(anyOpen.length === 1 && anyOpen[0].display_name === "Eli" && anyOpen[0].rank === 1 && Number(anyOpen[0].participants) === 1, "Anywhere results get their own podium");
ok(!hall.some(r => r.month.toISOString().slice(0, 7) === months.this.toISOString().slice(0, 7)), "the running month is not closed");
ok(!hall.some(r => r.month < months.last), "months before the first result are not created");

const before = (await db.query(`select count(*)::int n, max(closed_at) t from monthly_results join monthly_closings using (month, division)`)).rows[0];
await att(E, { score: 1 });                                           // a late edit after closing
await db.as(null, `select * from monthly_hall(12)`);
const after = (await db.query(`select count(*)::int n, max(closed_at) t from monthly_results join monthly_closings using (month, division)`)).rows[0];
ok(before.n === after.n && String(before.t) === String(after.t), "closing happens once; later edits don't change the result");
ok((await db.as(null, `select * from monthly_hall(12)`)).length > 0, "anyone can see the winners");

console.log("protection");
ok(!(await tryAs(A, `insert into monthly_results values ('${months.last.toISOString().slice(0, 10)}', 'open', 1, '${A}', 'Ana', null, 1, 'community')`)), "athletes can't write results");
ok(!(await tryAs(A, `update monthly_results set rank = 1`)) || (await db.query(`select rank from monthly_results where user_id = '${B}' and division = 'open'`)).rows[0].rank === 3, "athletes can't change ranks");
ok(!(await tryAs(A, `select close_month(current_date - 60)`)), "close_month is not callable from the app");
await db.exec(`delete from auth.users where id = '${C}'`);
ok((await db.query(`select count(*)::int n from monthly_results where user_id = '${C}'`)).rows[0].n === 0, "deleting an account removes its results");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
if (fails) process.exit(1);
