// Runs the real Supabase SQL in embedded Postgres (PGlite) and checks the Phase 4 rules.
import { supabaseLike } from "./harness.mjs";
import { fileURLToPath } from "url";
const R = fileURLToPath(new URL("../../supabase/", import.meta.url));
const files = ["schema.sql", "002_competition.sql", "003_community.sql", "004_events.sql", "005_clubs.sql"].map(f => R + f);
const db = await supabaseLike([...files, R + "005_clubs.sql"]);       // re-runnable
const ids = "abcdef".split("").map(x => `00000000-0000-0000-0000-00000000000${x}`);
const [A, B, C, D, E, F] = ids;
const S = "00000000-0000-0000-0000-000000000005";
await db.exec(`insert into auth.users values ${[...ids, S].map((u, i) => `('${u}','u${i}@x')`).join(",")}`);
await db.exec(`insert into staff values ('${S}')`);
let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(cond ? "  ✓" : "  ✗ FAIL", msg); };
const tryAs = async (uid, sql) => { try { await db.as(uid, sql); return true; } catch (e) { return false; } };
const names = { [A]: "Caro", [B]: "Sam", [C]: "Lee", [D]: "Ana", [E]: "Ben", [F]: "Kit" };
for (const u of ids) await db.as(u, `insert into athletes (user_id, display_name, handle, visibility, leaderboards, country, city) values ('${u}','${names[u]}','${names[u].toLowerCase()}','public', true, '${u === D ? "US" : "DE"}', '${u === C ? "Munich" : "Berlin"}')`);

console.log("clubs & membership");
const gym = (await db.as(A, `insert into clubs (name, kind, country, city, open, partner) values ('Iron Works', 'gym', 'DE', 'Berlin', false, true) returning id`))[0].id;
ok((await db.as(A, `select partner from clubs where id='${gym}'`))[0].partner === false, "athletes cannot make their club a partner gym");
ok((await db.as(A, `select role from club_members where club_id='${gym}'`))[0].role === "owner", "creator becomes owner");
ok(!(await tryAs(B, `select invite_code from clubs`)), "invite codes are hidden from the directory");
ok((await db.as(B, `select club_invite_code('${gym}') c`))[0].c === null, "non-members don't get the invite code");
const code = (await db.as(A, `select club_invite_code('${gym}') c`))[0].c;
ok(/^[A-F0-9]{8}$/.test(code), "owner gets the invite code");
ok(!(await tryAs(B, `insert into club_members (club_id, user_id) values ('${gym}','${B}')`)), "closed club: can't join without the code");
await db.as(B, `select join_club('${code.toLowerCase()}')`);
ok((await db.as(B, `select * from my_clubs()`)).length === 1, "join with invite code (case-insensitive)");
ok(!(await tryAs(B, `select join_club('NOPE1234')`)), "wrong code is rejected");
ok(!(await tryAs(B, `update clubs set name='Hacked' where id='${gym}'`)) || (await db.as(A, `select name from clubs where id='${gym}'`))[0].name === "Iron Works", "members can't edit the club");
ok(!(await tryAs(A, `select set_partner('${gym}', true)`)), "only staff can flag partner gyms");
await db.as(S, `select set_partner('${gym}', true)`);
ok((await db.as(null, `select partner from search_clubs('iron')`))[0].partner === true, "staff can flag a partner gym; anyone can search");
const open = (await db.as(C, `insert into clubs (name, kind, country, city) values ('Munich Runners', 'club', 'DE', 'Munich') returning id`))[0].id;
ok(await tryAs(D, `insert into club_members (club_id, user_id) values ('${open}','${D}')`), "anyone can join an open club");
ok(!(await tryAs(D, `insert into club_members (club_id, user_id, role) values ('${open}','${E}','member')`)), "can't add someone else");
ok((await db.as(E, `select * from club_members where club_id='${gym}'`)).length === 0, "non-members can't read a closed club's roster table");
ok(!(await tryAs(B, `delete from club_members where club_id='${gym}' and user_id='${A}'`)) || (await db.query(`select count(*)::int n from club_members where club_id='${gym}'`)).rows[0].n === 2, "members can't remove the owner");
const team = (await db.as(A, `insert into clubs (name, kind) values ('Team Forest', 'team') returning id`))[0].id;
for (const u of [B, C, D, E, F]) await db.as(u, `insert into club_members (club_id, user_id) values ('${team}','${u}')`);
ok(!(await tryAs(S, `insert into club_members (club_id, user_id) values ('${team}','${S}')`)), "teams hold at most 6 athletes");

console.log("local & club leaderboards");
const att = (u, id, score) => db.as(u, `insert into attempts (user_id, id, challenge_id, variant, division, score, better, performed_at) values ('${u}','${id}','iron-mile','standard','open',${score},'lower', now())`);
await att(A, "a", 900); await att(B, "b", 800); await att(C, "c", 700); await att(D, "d", 600); await att(E, "e", 1000);
const lb = (sql) => db.as(B, `select display_name, rank from leaderboard('iron-mile','standard','open', ${sql})`);
ok((await lb(`p_country => 'DE'`)).length === 4, "country leaderboard");
ok((await lb(`p_city => 'berlin'`)).map(r => r.display_name).join() === "Ana,Sam,Caro,Ben", "city leaderboard (case-insensitive)");
ok((await lb(`p_club => '${gym}'`)).map(r => r.display_name).join() === "Sam,Caro", "club leaderboard");
const battle = await db.as(B, `select name, score, athletes, mine from club_battle('iron-mile','standard','open')`);
console.log("   battle:", battle.map(r => `${r.name}=${r.score}(${r.athletes})${r.mine ? "*" : ""}`).join("  "));
ok(battle.length === 3 && battle[0].name === "Team Forest", "gym vs gym ranks clubs by their top-10 members' points");
ok(battle.find(r => r.name === "Iron Works").mine === true, "my clubs are flagged");
ok((await db.as(null, `select * from club_battle('iron-mile','standard','open', p_kind => 'gym')`)).length === 1, "battle can be filtered to gyms");

console.log("in-person events");
await db.exec(`insert into events (id, name, kind, location, capacity, host_club, registration_opens, starts_at, ends_at, final_at, reveal_at)
  values ('meetup', 'Iron Works Open', 'in_person', 'Iron Works, Berlin', 1, '${gym}', now() - interval '1 day', now() + interval '5 days', now() + interval '6 days', now() + interval '7 days', now() + interval '5 days')`);
ok(await tryAs(B, `insert into registrations (event_id, division) values ('meetup','open')`), "register for an in-person event");
ok(!(await tryAs(C, `insert into registrations (event_id, division) values ('meetup','open')`)), "in-person capacity is enforced");
ok((await db.as(null, `select kind, location from list_events() where id='meetup'`))[0].location === "Iron Works, Berlin", "venue shows in the events list");
console.log("account deletion");
await db.exec(`delete from auth.users where id='${A}'`);   // Caro created Iron Works and Team Forest
const left = await db.as(B, `select name, members, my_role from my_clubs() order by name`);
ok(left.some(r => r.name === "Iron Works"), "a club outlives its creator's account");
ok((await db.query(`select count(*)::int n from club_members where club_id='${gym}' and role='owner'`)).rows[0].n === 1, "ownership passes to the next member");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
if (fails) process.exit(1);
