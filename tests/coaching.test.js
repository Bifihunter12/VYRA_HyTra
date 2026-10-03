"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./load")();
// Values built inside the sandbox have their own Array prototype; compare plain copies.
const plain = x => JSON.parse(JSON.stringify(x));

const ALL = ["treadmill", "rower", "bike", "kettlebell", "dumbbell", "battle-ropes"];
const DAY = V.DAY_MS;

function candidates(equipment = ALL) {
  return V.TEMPLATES.map(t => {
    const w = V.createWorkout(t.id, {});
    const gear = V.gearPlan(w, {}, equipment);
    const tl = V.compile(w, gear.swaps);
    const patterns = new Set();
    tl.forEach(iv => { if (iv.type === "CARDIO") patterns.add("cardio"); iv.exercises.forEach(e => e.pattern && patterns.add(e.pattern)); });
    return { t, doable: gear.doable, minutes: Math.round(V.planTotals(tl).main / 60), patterns };
  });
}

test("missing kit is swapped for something the athlete owns", () => {
  const w = V.createWorkout("engine-builder", {});
  const g = V.gearPlan(w, {}, ["bike", "dumbbell"]);
  assert.equal(g.auto.row, "bike");
  assert.ok(g.doable);
});

test("a manual choice of the original keeps it and reports what is missing", () => {
  const w = V.createWorkout("engine-builder", {});
  const g = V.gearPlan(w, { row: "row" }, ["bike", "dumbbell"]);
  assert.equal(g.swaps.row, "row");
  assert.deepEqual(plain(g.missing), ["rower"]);
  assert.equal(g.doable, false);
});

test("dumbbell-only workouts are not doable without weights", () => {
  const w = V.createWorkout("db-destroyer", {});
  assert.equal(V.gearPlan(w, {}, ["treadmill"]).doable, false);
});

test("kettlebell owners can do dumbbell-or-kettlebell movements", () => {
  assert.ok(V.hasGear(V.EXERCISES["goblet-squat"], ["kettlebell"]));
});

test("pain means rest, never a workout", () => {
  const r = V.recommend({ history: [], candidates: candidates(), checkin: "pain", level: "intermediate" });
  assert.ok(r.rest);
});

test("sore days get a low-impact suggestion", () => {
  const r = V.recommend({ history: [], candidates: candidates(), checkin: "sore", level: "intermediate" });
  assert.ok(V.LOW_IMPACT_IDS.includes(r.pick.t.id), r.pick.t.id);
});

test("beginners are never suggested advanced sessions", () => {
  for (const checkin of [null, "fresh", "ok"]) {
    const r = V.recommend({ history: [], candidates: candidates(), checkin, level: "beginner" });
    [r.pick, ...r.alternatives].forEach(c => assert.notEqual(c.t.level, "advanced", `${checkin}: ${c.t.id}`));
  }
});

test("week streak counts consecutive weeks on goal", () => {
  const now = V.startOfWeek(Date.UTC(2026, 9, 1)) + 3 * DAY;
  const history = [];
  for (let w = 0; w < 3; w++) for (let i = 0; i < 3; i++) history.push({ date: now - w * 7 * DAY - i * DAY / 4, stats: { totalSec: 1800 } });
  assert.equal(V.weekStreak(history, 3, now), 3);
  assert.equal(V.weekStreak(history, 4, now), 0);
});

test("feeling easy makes the next session harder, and hard makes it easier", () => {
  const t = V.TEMPLATES.find(x => x.id === "vyra-8");
  const p = { runSec: 60, speed: 7, restSec: 30, stationSec: 60 };
  assert.equal(V.progressionAdvice(t, p, "easy").value, 7.3);
  assert.equal(V.progressionAdvice(t, p, "hard").value, 6.7);
  assert.equal(V.progressionAdvice(t, p, "right"), null);
});

test("programs reference real templates and adjust real settings", () => {
  for (const prog of V.PROGRAMS) {
    assert.equal(prog.weeks.length, 4, prog.id);
    for (const s of V.programSessions(prog)) {
      const t = V.TEMPLATES.find(x => x.id === s.t);
      assert.ok(t, `${prog.id}: missing template ${s.t}`);
      for (const key of Object.keys(s.adj || {})) assert.ok(t.params.some(p => p.key === key), `${prog.id} ${s.key}: ${t.id} has no ${key}`);
    }
  }
});

test("program adjustments are deltas clamped to the setting's range", () => {
  const t = V.TEMPLATES.find(x => x.id === "engine-builder");
  assert.equal(V.programParams(t, { rounds: 6 }, { rounds: 2 }).rounds, 8);
  assert.equal(V.programParams(t, { rounds: 10 }, { rounds: 2 }).rounds, 10);
});

test("program status walks sessions in order", () => {
  const st0 = V.programStatus({ id: "hybrid-base", done: {} });
  assert.equal(st0.next.key, "1-1");
  const st1 = V.programStatus({ id: "hybrid-base", done: { "1-1": "a", "1-2": "b", "1-3": "c" } });
  assert.equal(st1.week, 2);
  assert.equal(st1.doneCount, 3);
  const all = Object.fromEntries(V.programSessions(V.programById("hybrid-base")).map(s => [s.key, "x"]));
  assert.ok(V.programStatus({ id: "hybrid-base", done: all }).complete);
});

test("benchmark totals convert row meters into miles", () => {
  const total = V.benchTotalMi({ legs: [{ unit: "m", value: 1609.344 }, { unit: "mi", value: 1.5 }, { unit: "mi", value: 0.5 }] });
  assert.equal(Math.round(total * 100) / 100, 3);
});
