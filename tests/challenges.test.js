"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./load")();

test("there are 15–20 benchmarks, each with a valid scoring type and unique id", () => {
  assert.ok(V.BENCHMARKS.length >= 15 && V.BENCHMARKS.length <= 24, `${V.BENCHMARKS.length}`);
  assert.equal(new Set(V.BENCHMARKS.map(b => b.id)).size, V.BENCHMARKS.length);
  V.BENCHMARKS.forEach(b => assert.ok(V.SCORING[b.scoring], b.id));
});

test("every benchmark variant and division compiles into a playable timeline", () => {
  for (const c of V.BENCHMARKS) for (const v of c.variants) for (const d of V.DIVISIONS) {
    const w = V.challengeWorkout(c, v.id, d.id);
    const tl = V.compile(w, {});
    assert.ok(tl.length > 0, `${c.id}/${v.id}`);
    tl.forEach(iv => assert.ok(iv.openEnded || iv.duration > 0, `${c.id}/${v.id}: ${iv.title}`));
    // for-time challenges must be fully open-ended targets (except rests); others need typed inputs
    if (c.scoring === "time" && c.better === "lower") assert.ok(tl.filter(iv => iv.type !== "REST").every(iv => iv.openEnded), c.id);
    if (["distance", "reps", "load", "rounds"].includes(c.scoring)) assert.ok(c.inputs && c.inputs().length, `${c.id} needs inputs`);
    for (const id of tl.flatMap(iv => iv.exercises.map(e => e.id).concat(iv.exId ? [iv.exId] : []))) assert.ok(V.compile, id);
  }
});

test("Three Rivers scores total distance across machines", () => {
  const c = V.challengeById("three-rivers");
  assert.equal(V.scoreFromInputs(c, { row: 2400, bike: 6.1, run: 5.7 }), 14200);
  assert.equal(V.formatScore(c, 14200), "14.20 km");
});

test("for-time uses the engine's elapsed time", () => {
  const c = V.challengeById("iron-mile");
  assert.equal(V.scoreFromInputs(c, {}, 872.4), 872);
  assert.equal(V.formatScore(c, 872), "14:32");
});

test("rounds score includes partial rounds", () => {
  const c = V.challengeById("the-storm");
  const s = V.scoreFromInputs(c, { rounds: 6, extra: 2 });
  assert.equal(s, 6.5);
  assert.equal(V.formatScore(c, s), "6 + 2");
});

test("a new best is a PR with its improvement; a worse attempt is not", () => {
  const c = V.challengeById("three-rivers");
  const base = { challengeId: "three-rivers", variant: "standard", division: "open" };
  const attempts = [{ ...base, id: "a", score: 13400, date: 1 }];
  const next = { ...base, id: "b", score: 14200, date: 2 };
  const pr = V.prCheck([...attempts, next], next);
  assert.equal(pr.pr, true);
  assert.equal(V.formatDelta(c, pr.delta), "+800 m");
  const worse = { ...base, id: "c", score: 13000, date: 3 };
  assert.equal(V.prCheck([...attempts, next, worse], worse).pr, false);
  assert.equal(V.prCheck([], { ...base, id: "z", score: 1, date: 1 }).first, true);
});

test("for time, lower is better and the improvement reads as time saved", () => {
  const c = V.challengeById("iron-mile");
  const base = { challengeId: "iron-mile", variant: "standard", division: "open" };
  const a = [{ ...base, id: "a", score: 914, date: 1 }];
  const b = { ...base, id: "b", score: 872, date: 2 };
  const pr = V.prCheck([...a, b], b);
  assert.ok(pr.pr);
  assert.equal(V.formatDelta(c, pr.delta), "−0:42");
});

test("PRs only compare the same variant and division", () => {
  const base = { challengeId: "the-hunt", division: "open" };
  const attempts = [{ ...base, id: "a", variant: "5k", score: 1500, date: 1 }];
  const tenK = { ...base, id: "b", variant: "10k", score: 3300, date: 2 };
  assert.equal(V.prCheck([...attempts, tenK], tenK).first, true);
});

test("ranking sorts by the challenge's direction and shares ties", () => {
  const time = V.challengeById("the-hunt");
  assert.deepEqual(JSON.parse(JSON.stringify(V.rankEntries(time, [{ n: "a", score: 1600 }, { n: "b", score: 1500 }, { n: "c", score: 1500 }]).map(e => [e.n, e.rank]))), [["b", 1], ["c", 1], ["a", 3]]);
  const dist = V.challengeById("three-rivers");
  assert.equal(V.rankEntries(dist, [{ score: 1 }, { score: 9 }])[0].score, 9);
});

test("the monthly challenge rotates each month and spans the whole month", () => {
  const oct = V.monthlyChallenge(new Date(2026, 9, 15));
  const nov = V.monthlyChallenge(new Date(2026, 10, 2));
  assert.notEqual(oct.challengeId, nov.challengeId);
  assert.equal(new Date(oct.start).getDate(), 1);
  assert.ok(V.challengeById(oct.challengeId));
});

test("age groups", () => {
  assert.equal(V.ageGroup(1990, new Date(2026, 0, 1)), "30-39");
  assert.equal(V.ageGroup(2000, new Date(2026, 0, 1)), "u30");
  assert.equal(V.ageGroup(null), null);
});

test("no-equipment athletes can enter bodyweight and outdoor benchmarks", () => {
  const open = V.BENCHMARKS.filter(b => !V.gearMissing(b, ["outdoors"]).length).map(b => b.id);
  for (const id of ["the-hundred", "the-shield", "the-clearing", "the-hunt"]) assert.ok(open.includes(id), id);
  assert.deepEqual([...V.gearMissing(V.challengeById("the-hunt"), ["treadmill"])], []);
  assert.deepEqual([...V.gearMissing(V.challengeById("the-river"), ["outdoors"])], ["rower"]);
});

test("benchmark runs move outdoors only when there's no treadmill", () => {
  assert.deepEqual({ ...V.outdoorSwaps(["outdoors"]) }, { run: "run-outside", "incline-walk": "walk-outside" });
  assert.deepEqual({ ...V.outdoorSwaps(["outdoors", "treadmill"]) }, {});
  const w = V.challengeWorkout(V.challengeById("the-clearing"), "standard", "open");
  const tl = V.compile(w, V.outdoorSwaps(["outdoors"]), {});
  assert.deepEqual([...tl.map(iv => iv.exId || iv.exercises[0].id)], ["run-outside", "burpee", "run-outside"]);
  assert.ok(tl.every(iv => iv.openEnded));
});

test("months run in UTC; the final five days are flagged with next month's challenge", () => {
  const mid = V.monthlyStatus(Date.UTC(2026, 9, 15, 12));
  assert.equal(mid.start, Date.UTC(2026, 9, 1));
  assert.equal(mid.end, Date.UTC(2026, 10, 1));
  assert.equal(mid.final, false);
  const late = V.monthlyStatus(Date.UTC(2026, 9, 27, 18));
  assert.equal(late.daysLeft, 5);
  assert.equal(late.final, true);
  assert.equal(late.challengeId, "the-mill");
  assert.equal(late.next.challengeId, "the-hundred");
  assert.equal(V.monthlyStatus(Date.UTC(2026, 9, 31, 23, 59)).daysLeft, 1);
  assert.equal(V.monthlyStatus(Date.UTC(2026, 10, 1, 0, 1)).challengeId, "the-hundred");
});

test("monthly reminders: '5 days left' on the 27th/26th and 'live' on the 1st, for 12 months", () => {
  const evs = V.monthlyReminderEvents("18:00", { from: Date.UTC(2026, 9, 5, 9) });
  const fin = evs.filter(e => e.kind === "final"), live = evs.filter(e => e.kind === "live");
  assert.equal(fin.length, 12);
  assert.equal(live.length, 11, "October is already live");
  assert.equal(fin[0].start.getDate(), 27); assert.equal(fin[0].start.getMonth(), 9); assert.equal(fin[0].start.getHours(), 18);
  assert.match(fin[0].title, /5 days left: The Mill/);
  assert.match(fin[0].desc, /Next up on the 1st: The Hundred/);
  assert.equal(live[0].start.getDate(), 1); assert.equal(live[0].start.getMonth(), 10);
  assert.match(live[0].title, /November challenge is live: The Hundred/);
  assert.equal(fin[1].start.getDate(), 26, "November has 30 days");
  const ics = V.icsCalendar(evs, { url: "https://example.app/" });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 23);
  assert.equal(new Set(evs.map(e => e.uid)).size, 23, "stable, unique ids");
});

test("monthly Google Calendar links repeat every month", () => {
  const g = V.monthlyGoogleUrls("08:00", { from: Date.UTC(2026, 9, 5, 9), timeZone: "Europe/Berlin" });
  const fin = new URL(g.final), live = new URL(g.live);
  assert.equal(fin.searchParams.get("recur"), "RRULE:FREQ=MONTHLY;BYMONTHDAY=-5;COUNT=12");
  assert.equal(fin.searchParams.get("dates").slice(0, 15), "20261027T080000");
  assert.equal(live.searchParams.get("recur"), "RRULE:FREQ=MONTHLY;BYMONTHDAY=1;COUNT=12");
  assert.equal(live.searchParams.get("dates").slice(0, 15), "20261101T080000");
});

test("The Escape: ten story stages, for time, with a half version", () => {
  const c = V.challengeById("the-escape");
  const full = V.compile(V.challengeWorkout(c, "standard", "open"), V.outdoorSwaps(["outdoors"]), {});
  assert.equal(full.length, 10);
  assert.ok(full.every(iv => iv.openEnded && iv.story.startsWith("Stage")));
  assert.deepEqual([...full.map(iv => iv.title)], ["Into the Trees", "The River", "Haul the Supplies", "The Thicket", "Clear the Path",
    "Back into the Trees", "The Rapids", "The Climb", "Carry the Wounded", "The Last Sprint"]);
  assert.equal(full[0].exId, "run-outside");
  assert.equal(full[9].target, "1 km");
  const half = V.compile(V.challengeWorkout(c, "half", "open"), {}, {});
  assert.equal(half[0].target, "400 m");
  assert.match(half[3].story, /10 burpees/);
  const coach = new V.CoachScript(full, { challenge: "the-escape" });
  assert.deepEqual([...coach.intro(full[1], full[0])], [`cue:${full[1].story}`]);
  assert.deepEqual([...coach.finish(false)], ["escaped"]);
});
