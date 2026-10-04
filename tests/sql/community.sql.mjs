// Runs the real Supabase SQL in embedded Postgres (PGlite) and checks the privacy rules.
import { supabaseLike } from "./harness.mjs";
import { fileURLToPath } from "url";
const R = fileURLToPath(new URL("../../supabase/", import.meta.url));
const db = await supabaseLike([R + "schema.sql", R + "002_competition.sql", R + "003_community.sql", R + "003_community.sql"]);  // run twice: must be re-runnable
const [A, B, C, D] = ["a", "b", "c", "d"].map(x => `00000000-0000-0000-0000-00000000000${x}`);
await db.exec(`insert into auth.users values ('${A}','a@x'),('${B}','b@x'),('${C}','c@x'),('${D}','d@x')`);
let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(cond ? "  ✓" : "  ✗ FAIL", msg); };
const tryAs = async (uid, sql) => { try { await db.as(uid, sql); return true; } catch (e) { return false; } };

// A: public, activity followers-only. B: public, activity public. C: private. D: public, activity off.
for (const [u, n, vis, act] of [[A, "Caro", "public", "followers"], [B, "Sam", "public", "public"], [C, "Priv", "private", "public"], [D, "Quiet", "public", "off"]])
  await db.as(u, `insert into athletes (user_id, display_name, handle, visibility, activity, leaderboards) values ('${u}','${n}','${n.toLowerCase()}','${vis}','${act}', true)`);
const post = (u, id, title, extra = "") => db.as(u, `insert into activity (user_id, id, kind, title, performed_at${extra ? ", challenge_id, variant, division, score, better, pr" : ""}) values ('${u}','${id}','${extra ? "result" : "workout"}','${title}', now()${extra})`);
await post(A, "a1", "Caro trained", ""); await post(A, "a2", "Three Rivers", ", 'three-rivers','standard','open',14200,'higher',true");
await post(B, "b1", "Sam trained"); await post(C, "c1", "Private trained"); await post(D, "d1", "Quiet trained");

console.log("follows");
ok(await tryAs(B, `insert into follows (follower, followee) values ('${B}','${A}')`), "B can follow public A");
ok(!(await tryAs(B, `insert into follows (follower, followee) values ('${B}','${C}')`)), "B cannot follow private C");
ok(!(await tryAs(B, `insert into follows (follower, followee) values ('${A}','${D}')`)), "B cannot create follows for A");
ok(!(await tryAs(B, `insert into follows (follower, followee) values ('${B}','${B}')`)), "no self-follow");
await db.as(B, `insert into follows (follower, followee) values ('${B}','${D}')`);
await db.as(C, `insert into follows (follower, followee) values ('${C}','${B}')`);

console.log("activity visibility");
ok((await db.as(B, `select * from activity where user_id <> '${B}'`)).length === 0, "nobody reads others' activity table directly");
const feedB = await db.as(B, `select * from feed()`);
console.log("   B feed:", feedB.map(r => `${r.display_name}:${r.title}`).join(" | "));
ok(feedB.some(r => r.title === "Three Rivers") && feedB.some(r => r.title === "Sam trained"), "B sees own + followed A (followers-only)");
ok(!feedB.some(r => r.title === "Quiet trained"), "D's activity is off: hidden even from followers");
ok(!feedB.some(r => r.title === "Private trained"), "unfollowed private athlete hidden");
const feedC = await db.as(C, `select * from feed()`);
ok(feedC.some(r => r.title === "Sam trained") && !feedC.some(r => r.owner === A), "C (follows B only) sees B, not A");
ok((await tryAs(null, `select * from feed()`)) === false, "anonymous cannot read the feed");

console.log("reactions & comments");
ok(await tryAs(B, `insert into reactions (owner, activity_id, kind) values ('${A}','a2','fire')`), "follower can react");
ok(!(await tryAs(C, `insert into reactions (owner, activity_id, kind) values ('${A}','a2','fire')`)), "non-follower cannot react to followers-only activity");
ok(!(await tryAs(B, `insert into reactions (owner, activity_id, user_id, kind) values ('${A}','a2','${C}','respect')`)), "cannot react as someone else");
ok(await tryAs(B, `insert into comments (owner, activity_id, body) values ('${A}','a2','Huge PR!')`), "follower can comment");
ok(!(await tryAs(B, `insert into comments (owner, activity_id, body) values ('${A}','a2','   ')`)), "empty comments rejected");
ok(!(await tryAs(C, `insert into comments (owner, activity_id, body) values ('${A}','a2','hi')`)), "non-follower cannot comment");
const fb = (await db.as(B, `select * from feed()`)).find(r => r.id === "a2");
ok(Number(fb.fire) === 1 && fb.my_reactions.includes("fire") && Number(fb.comment_count) === 1, "feed counts reactions/comments and my reactions");
const cm = await db.as(A, `select * from activity_comments('${A}','a2')`);
ok(cm.length === 1 && cm[0].display_name === "Sam" && cm[0].can_delete, "owner sees comments and can delete them");
ok((await db.as(C, `select * from activity_comments('${A}','a2')`)).length === 0, "non-follower cannot read comments");
await db.as(A, `delete from comments where owner='${A}'`);
ok((await db.as(A, `select * from activity_comments('${A}','a2')`)).length === 0, "owner deleted a comment on their activity");

console.log("search & profiles");
const s = await db.as(C, `select * from search_athletes('ca')`);
ok(s.length === 1 && s[0].handle === "caro", "search finds public athletes by handle");
ok((await db.as(A, `select * from search_athletes('pr')`)).length === 0, "private athletes not searchable");
await db.as(A, `insert into attempts (user_id, id, challenge_id, variant, division, score, better, performed_at) values ('${A}','a2','three-rivers','standard','open',14200,'higher',now()), ('${A}','a3','three-rivers','standard','open',13400,'higher',now())`);
const pa = (await db.as(B, `select athlete_profile('${A}') p`))[0].p;
ok(pa && pa.records.length === 1 && Number(pa.records[0].score) === 14200 && pa.i_follow && pa.followers === 1, "profile: best record per benchmark, follow state, counts");
ok(Array.isArray(pa.activity) && pa.activity.length === 2, "follower sees followers-only activity on profile");
const pac = (await db.as(C, `select athlete_profile('${A}') p`))[0].p;
ok(pac && pac.activity === null && pac.records.length === 1, "non-follower sees records but not followers-only activity");
ok((await db.as(B, `select athlete_profile('${C}') p`))[0].p === null, "private profile returns nothing");

console.log("cleanup");
await db.as(A, `select delete_my_account()`);
ok((await db.query(`select count(*)::int n from follows where followee='${A}'`)).rows[0].n === 0 && (await db.query(`select count(*)::int n from reactions where owner='${A}'`)).rows[0].n === 0, "account deletion removes follows and reactions");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
if (fails) process.exit(1);
