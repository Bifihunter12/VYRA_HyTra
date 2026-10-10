// Founding Embers: the first 100 accounts get a numbered star.
import { supabaseLike } from "./harness.mjs";
import { fileURLToPath } from "url";
const R = fileURLToPath(new URL("../../supabase/", import.meta.url));
const base = ["schema.sql", "002_competition.sql", "003_community.sql", "004_events.sql", "005_clubs.sql", "006_monthly.sql"].map(f => R + f);
let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(cond ? "  ✓" : "  ✗ FAIL", msg); };
const uid = i => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
const signUp = (db, i, at = "now()") => db.exec(`insert into auth.users (id, email, created_at) values ('${uid(i)}', 'u${i}@x', ${at})`);
const status = async (db, i) => (await db.as(i == null ? null : uid(i), `select founding_embers() f`))[0].f;

console.log("existing accounts");
{
  const db = await supabaseLike(base);
  await signUp(db, 2, "now() - interval '1 day'"); await signUp(db, 1, "now() - interval '2 days'");
  for (const f of [R + "007_founders.sql", R + "007_founders.sql"]) await db.exec((await import("fs")).readFileSync(f, "utf8"));
  const rows = (await db.query(`select number, user_id from founding_embers order by number`)).rows;
  ok(rows.length === 2 && rows[0].user_id === uid(1) && rows[1].user_id === uid(2), "numbered by sign-up date, oldest first; running the file twice changes nothing");
}

console.log("new sign-ups");
const db = await supabaseLike([...base, R + "007_founders.sql"]);
for (let i = 1; i <= 101; i++) await signUp(db, i);
ok((await status(db, 1)).mine === 1 && (await status(db, 100)).mine === 100, "accounts 1 to 100 get their number");
ok((await status(db, 101)).mine === null, "account 101 signs up fine but gets no star");
ok((await status(db, null)).taken === 100 && (await status(db, null)).limit === 100, "signed out, anyone can see how many spots are taken");

console.log("privacy");
await db.as(uid(5), `insert into athletes (user_id, display_name, handle, leaderboards, visibility) values ('${uid(5)}', 'Eve', 'eve', true, 'private')`);
await db.as(uid(6), `insert into athletes (user_id, display_name, handle, leaderboards, visibility) values ('${uid(6)}', 'Sam', 'sam', false, 'private')`);
await db.as(uid(101), `insert into athletes (user_id, display_name, handle, leaderboards, visibility) values ('${uid(101)}', 'Late', 'late', true, 'public')`);
const h = (await status(db, null)).handles;
ok(h.includes("eve") && !h.includes("sam") && !h.includes("late"), "only founders' handles that are already public are listed");

console.log("protection");
const tryAs = async (u, sql) => { try { await db.as(u, sql); return true; } catch { return false; } };
ok(!(await tryAs(uid(101), `select claim_founding_ember('${uid(101)}')`)), "nobody can claim a spot from the app");
ok(!(await tryAs(uid(101), `insert into founding_embers (number, user_id) values (100, '${uid(101)}')`)), "nobody can write the table directly");
ok(!(await tryAs(uid(101), `update founding_counter set last = 0`)) || (await db.query(`select last from founding_counter`)).rows[0].last === 100, "nobody can reset the counter");

console.log("deleted accounts");
await db.exec(`delete from auth.users where id = '${uid(7)}'`);
await signUp(db, 102);
ok((await status(db, 102)).mine === null && (await status(db, null)).taken === 100, "a deleted founder's spot is not handed out again");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
if (fails) process.exit(1);
