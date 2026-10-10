"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./load")();
// Values built inside the sandbox have their own Array prototype; compare plain copies.
const plain = x => JSON.parse(JSON.stringify(x));

test("every exercise reference and substitution exists", () => {
  for (const [id, e] of Object.entries(V.EXERCISES)) {
    for (const s of e.subs || []) assert.ok(V.EXERCISES[s], `${id} → missing sub ${s}`);
  }
  for (const t of V.TEMPLATES) {
    for (const id of V.allExerciseIds(V.createWorkout(t.id, {}))) assert.ok(V.EXERCISES[id], `${t.id} uses missing ${id}`);
  }
});

test("all templates compile into well-formed timelines", () => {
  for (const t of V.TEMPLATES) {
    const tl = V.compile(V.createWorkout(t.id, {}), {});
    assert.ok(tl.length > 0, t.id);
    for (const iv of tl) {
      assert.ok(iv.title, `${t.id}: interval without title`);
      assert.ok(["CARDIO", "REST", "WORK", "WARM"].includes(iv.type));
      assert.ok(iv.openEnded || iv.duration > 0, `${t.id}: ${iv.title} has no duration`);
      assert.ok(iv.say, `${t.id}: ${iv.title} has no spoken cue`);
    }
  }
});

test("The 9 matches its spec", () => {
  const tl = V.compile(V.createWorkout("vyra-8", {}), {});
  assert.equal(tl.length, 35);                       // 9 × 4 minus the final rest
  assert.equal(V.planTotals(tl).total, 2010);         // 33:30: multi-move stations give each move its own minute
  assert.equal(tl[0].type, "CARDIO");
  assert.equal(tl[0].speed, 7);
  assert.equal(tl.at(-1).type, "WORK");
  const ropes = tl[2];
  assert.deepEqual(plain(ropes.segments.map(s => [s.label, s.start, s.end])), [["HARD", 0, 20], ["EASY", 20, 40], ["HARD", 40, 60]]);
  assert.equal(tl.filter(iv => iv.type === "WORK").at(-2).title, "Devil Press");   // the ninth station, right before the finisher
});

test("a timed station with several moves gives each move its own timer and a switch", () => {
  const tl = V.compile(V.createWorkout("vyra-8", {}), {});
  const fin = tl.at(-1);
  assert.equal(fin.duration, 4 * 60 + 3 * 10);
  assert.deepEqual(plain(fin.segments.map(s => [s.switch ? "SWITCH" : s.exId, s.end - s.start])),
    [["goblet-squat", 60], ["SWITCH", 10], ["db-row", 60], ["SWITCH", 10], ["push-press", 60], ["SWITCH", 10], ["battle-ropes", 60]]);
  const upper = tl.find(iv => iv.title === "Upper Body");
  assert.deepEqual(plain(upper.segments.filter(s => !s.switch).map(s => s.target)), ["15 presses", "12 rows/side"]);
  // Circuits keep one timer for the whole block.
  const mixer = V.compile(V.createWorkout("the-mixer", {}), {}).find(iv => iv.title === "Strength Circuit");
  assert.equal(mixer.segments.length, 0);
  assert.equal(mixer.duration, 120);
  const storm = V.compile(V.challengeWorkout(V.challengeById("the-storm"), "20", "open"), {})[0];
  assert.equal(storm.segments.length, 0);
});

test("segments scale by share and support Tabata-style repeats", () => {
  const share = V.resolveSegments({ pattern: [{ label: "A", share: 1 }, { label: "B", share: 2 }] }, 90);
  assert.deepEqual(plain(share.segments.map(s => [s.start, s.end])), [[0, 30], [30, 90]]);
  const tabata = V.resolveSegments({ repeat: 8, pattern: [{ label: "WORK", duration: 20 }, { label: "REST", duration: 10 }] }, null);
  assert.equal(tabata.duration, 240);
  assert.equal(tabata.segments.length, 16);
});

test("warm-up and cool-down wrap the workout without counting as rounds", () => {
  const tl = V.compile(V.createWorkout("engine-builder", {}), {}, { warmup: true, cooldown: true });
  assert.equal(tl[0].type, "WARM");
  assert.equal(tl.at(-1).type, "WARM");
  assert.equal(tl.filter(iv => iv.type === "WARM").length, V.WARMUP.length + V.COOLDOWN.length);
});

test("swaps replace the exercise and its spoken cue", () => {
  const tl = V.compile(V.createWorkout("engine-builder", {}), { row: "bike" });
  assert.equal(tl[0].exId, "bike");
  assert.equal(tl[0].state, "BIKE");
  assert.match(tl[0].say, /Bike/);
});

test("rep-only stations are open-ended with a planning estimate", () => {
  const tl = V.compile(V.createWorkout("strength-before-speed", {}), {});
  const reps = tl.filter(iv => iv.openEnded);
  assert.ok(reps.length >= 5);
  reps.forEach(iv => { assert.equal(iv.duration, null); assert.ok(iv.estimate > 0); });
});
