// Runs the real Supabase SQL in embedded Postgres (PGlite) and checks the privacy rules.
import { supabaseLike } from "./harness.mjs";
import { fileURLToPath } from "url";
const R = fileURLToPath(new URL("../../supabase/", import.meta.url));
const db = await supabaseLike([R + "schema.sql", R + "002_competition.sql"]);
const A = "00000000-0000-0000-0000-00000000000a", B = "00000000-0000-0000-0000-00000000000b", C = "00000000-0000-0000-0000-00000000000c";
await db.exec(`insert into auth.users values ('${A}','a@x'),('${B}','b@x'),('${C}','c@x')`);
let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(cond ? "  ✓" : "  ✗ FAIL", msg); };
const tryAs = async (uid, sql) => { try { await db.as(uid, sql); return true; } catch (e) { return e.message; } };

// workouts: each user sees only their own
await db.as(A, `insert into workouts (user_id, id, data, updated_at) values ('${A}', 'w1', '{"x":1}', now())`);
ok((await db.as(B, `select * from workouts`)).length === 0, "B cannot read A's workouts");
ok((await tryAs(B, `insert into workouts (user_id, id) values ('${A}', 'evil')`)) !== true, "B cannot write rows for A");
ok((await db.as(null, `select * from workouts`)).length === 0, "anonymous sees no workouts");

// athletes + attempts + leaderboard
for (const [u, name, lb, vis] of [[A, "Caro", true, "public"], [B, "Sam", true, "private"], [C, "Hidden", false, "private"]])
  await db.as(u, `insert into athletes (user_id, display_name, handle, leaderboards, visibility, category, birth_year) values ('${u}', '${name}', '${name.toLowerCase()}', ${lb}, '${vis}', 'open', 1990)`);
const att = (u, id, score, verification = "community", dnf = false) => db.as(u, `insert into attempts (user_id, id, challenge_id, variant, division, score, better, verification, dnf, performed_at) values ('${u}', '${id}', 'iron-mile', 'standard', 'open', ${score}, 'lower', '${verification}', ${dnf}, now())`);
await att(A, "a1", 900); await att(A, "a2", 850); await att(B, "b1", 870); await att(C, "c1", 600); await att(B, "b2", 500, "training");
ok((await db.as(B, `select * from attempts where user_id = '${A}'`)).length === 0, "B cannot read A's attempts directly");
const lb = await db.as(B, `select * from leaderboard('iron-mile','standard','open')`);
console.log("   board:", lb.map(r => `${r.rank}.${r.display_name}:${r.score}${r.is_me ? "(me)" : ""}`).join("  "));
ok(lb.length === 2 && lb[0].display_name === "Caro" && Number(lb[0].score) === 850, "best per athlete, ranked, opted-out athlete hidden");
ok(!lb.some(r => Number(r.score) === 500), "training results never ranked");
ok(lb.find(r => r.display_name === "Sam").is_me === true, "caller's own row flagged");
const anonLb = await db.as(null, `select * from leaderboard('iron-mile','standard','open')`);
ok(anonLb.length === 2, "anonymous can view the leaderboard");
await db.as(A, `insert into attempts (user_id, id, challenge_id, variant, division, score, better, verification, performed_at) values ('${A}','a3','iron-mile','standard','open',100,'lower','verified',now())`);
ok((await db.as(A, `select verification from attempts where id='a3'`))[0].verification === "community", "athletes cannot self-verify");
ok((await db.as(B, `select display_name from athletes`)).map(r => r.display_name).sort().join() === "Caro,Sam", "B sees public athletes + self only");

// account deletion
await db.as(A, `select delete_my_account()`);
ok((await db.query(`select count(*)::int n from attempts where user_id='${A}'`)).rows[0].n === 0, "delete_my_account cascades attempts");
ok((await tryAs(null, `select delete_my_account()`)) !== true, "anonymous cannot call delete_my_account");

console.log(fails ? `${fails} FAILED` : "ALL PASSED");
if (fails) process.exit(1);
