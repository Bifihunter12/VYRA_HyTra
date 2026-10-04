"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const V = require("./load")();
const plain = x => JSON.parse(JSON.stringify(x));

/* Pull the JSON Trial specs out of the seed in 004_events.sql. */
function seededSpecs() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "004_events.sql"), "utf8");
  return [...sql.matchAll(/\('([a-z0-9-]+)', '([a-z0-9-]+)', (\d+), '([^']+)', ([\d.]+), '(\{.*?\})'\)/g)]
    .map(m => ({ event: m[1], trial: m[2], weight: Number(m[5]), spec: JSON.parse(m[6]) }));
}

test("every seeded event Trial (incl. the secret Iron Forest ones) builds a playable workout", () => {
  const specs = seededSpecs();
  assert.equal(specs.filter(s => s.event === "iron-forest-2027").length, 7);
  assert.equal(specs.filter(s => s.event === "wild-hunt-2026").length, 2);
  for (const { trial, spec } of specs) {
    const c = V.challengeFromSpec(spec);
    assert.equal(c.id, trial);
    const tl = V.compile(V.challengeWorkout(c, "standard", "open"), {});
    assert.ok(tl.length > 0, trial);
    tl.forEach(iv => assert.ok(iv.openEnded || iv.duration > 0, `${trial}: ${iv.title}`));
    if (c.scoring === "time") assert.ok(tl.filter(iv => iv.type !== "REST").every(iv => iv.openEnded), `${trial} must be fully to-target`);
    if (["distance", "reps"].includes(c.scoring)) assert.ok(c.inputs && c.inputs().length, `${trial} needs inputs`);
  }
});

test("Iron Forest: The Escape is mixed-modality and weighted 1.5×", () => {
  const escape = seededSpecs().find(s => s.trial === "if-escape");
  assert.equal(escape.weight, 1.5);
  const kinds = new Set(escape.spec.segments.map(s => s.type === "cardio" ? s.ex : s.exercises[0].id));
  assert.ok(kinds.size >= 5);
});

test("bad specs are rejected instead of breaking the player", () => {
  assert.throws(() => V.challengeFromSpec({ id: "x", scoring: "time", segments: [{ type: "cardio", ex: "burpee-pogo", meters: 100 }] }), /Unknown movement/);
  assert.throws(() => V.challengeFromSpec({ id: "x", scoring: "nope", segments: [] }));
  assert.throws(() => V.challengeFromSpec({ id: "x", scoring: "time", segments: [{ type: "station", exercises: [] }] }));
});

test("registered spec challenges are found by id", () => {
  V.registerChallenge(V.challengeFromSpec({ id: "spec-test", name: "Spec", scoring: "time", segments: [{ type: "cardio", ex: "row", meters: 500 }] }));
  assert.equal(V.challengeById("spec-test").name, "Spec");
});

test("Forest Points: 1st 100, last 10, weighted", () => {
  assert.equal(V.placementPoints(1, 10), 100);
  assert.equal(V.placementPoints(10, 10), 10);
  assert.equal(V.placementPoints(1, 1), 100);
  assert.equal(V.placementPoints(1, 4, 1.5), 150);
  assert.equal(V.placementPoints(null, 4), 0);
});

test("event phases and Iron Forest messaging", () => {
  const ev = { name: "Iron Forest", registration_opens: "2027-02-01T00:00:00Z", starts_at: "2027-03-01T00:00:00Z", ends_at: "2027-03-08T00:00:00Z", final_at: "2027-03-10T00:00:00Z" };
  const at = s => Date.parse(s);
  assert.equal(V.eventPhase(ev, at("2026-12-01T00:00:00Z")), "coming");
  assert.equal(V.eventLine(ev, "coming"), "THE FOREST IS COMING.");
  assert.equal(V.eventPhase(ev, at("2027-02-10T00:00:00Z")), "registration");
  assert.equal(V.eventLine(ev, "registration"), "ENTER THE IRON FOREST.");
  assert.equal(V.eventLine(ev, V.eventPhase(ev, at("2027-03-03T00:00:00Z"))), "THE FOREST IS OPEN.");
  assert.equal(V.eventLine(ev, V.eventPhase(ev, at("2027-03-09T00:00:00Z"))), "THE FOREST IS CLOSED.");
  assert.equal(V.eventPhase(ev, at("2027-03-11T00:00:00Z")), "final");
});

test("ghost from a total spreads time over segments by planned length", () => {
  const c = V.challengeById("iron-mile");
  const tl = V.compile(V.challengeWorkout(c, "standard", "open"), {});
  const g = V.ghostFromTotal(tl, 900);
  assert.equal(g.length, V.scoredSegments(tl).length);
  assert.equal(g[g.length - 1], 900);
  assert.ok(g.every((x, i) => i === 0 || x > g[i - 1]), "monotonic");
});

test("ghost status: ahead at a split, behind when overrunning the ghost's split", () => {
  const ghost = [100, 200, 300];
  assert.equal(V.ghostStatus(ghost, [90], 1, 120).delta, -10);           // 10 s ahead at split 1
  assert.equal(V.ghostText(-10), "10 SEC AHEAD");
  assert.equal(V.ghostStatus(ghost, [110], 1, 230).delta, 30);           // still running segment 2 at 230 > 200
  assert.equal(V.ghostText(75), "1:15 BEHIND");
  assert.equal(V.ghostText(0), "LEVEL");
});

test("my checkpoints come from the engine's visits, warm-up excluded", () => {
  const c = V.challengeById("the-river");
  const tl = V.compile(V.challengeWorkout(c, "2k", "open"), {}, { warmup: true });
  const rowIdx = tl.findIndex(iv => iv.type === "CARDIO");
  const visits = tl.slice(0, rowIdx).map((iv, i) => ({ index: i, type: iv.type, ms: iv.duration * 1000, outcome: "complete" }))
    .concat([{ index: rowIdx, type: "CARDIO", ms: 455000, outcome: "done" }]);
  assert.deepEqual(plain(V.checkpointsFromVisits(tl, visits)), [455]);
});
