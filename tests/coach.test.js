"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const V = require("./load")();
const plain = x => JSON.parse(JSON.stringify(x));
const ROOT = path.join(__dirname, "..");

test("every coach line has text that reads like speech", () => {
  for (const { id, text } of V.coachCatalog([])) {
    assert.ok(text && text.length < 160, id);
    assert.match(text, /[.!?]$/, `${id}: "${text}"`);
    assert.ok(!/\b(KB|DB|RDLs?|undefined|null)\b/.test(text), `${id}: "${text}"`);
  }
  assert.equal(V.coachText("t:~20 reps"), "About 20 reps.");
  assert.equal(V.coachText("t:250 m"), "250 meters.");
  assert.equal(V.coachText("t:1 km"), "1 kilometer.");
  assert.equal(V.coachText("mph:7.0"), "Treadmill at 7.");
  assert.match(V.coachText("go:kb-swing"), /^Kettlebell swings\. Hinge/);
});

test("the coach talks a round through like an instructor", () => {
  const tl = V.compile(V.createWorkout("vyra-8", {}), {}, { warmup: true, cooldown: true });
  const c = new V.CoachScript(tl);
  assert.deepEqual(plain(c.interval(0, "start")), ["warmup-start", "go:wu-march"]);
  const firstMain = tl.findIndex(iv => iv.type !== "WARM");
  assert.deepEqual(plain(c.interval(firstMain, "auto", "main")), ["warmup-done"]);
  const intro = plain(c.intro(tl[firstMain], tl[firstMain - 1]));
  assert.deepEqual(intro.slice(0, 2), ["round:1", "go:run"]);
  assert.ok(intro.includes("mph:7.0"));
  const rest = tl.findIndex((iv, i) => i > firstMain && iv.type === "REST");
  const r = plain(c.intro(tl[rest], tl[rest - 1]));
  assert.match(r[0], /^rest-\d$/);
  assert.match(r[1], /^next:/);
  const last = tl.findIndex(iv => iv.roundStart && iv.round === iv.rounds && iv.type !== "WARM");
  assert.equal(c.intro(tl[last], tl[last - 1])[0], "last-round");
  const third = tl.findIndex(iv => iv.roundStart && iv.round === iv.rounds - 3);
  assert.deepEqual(plain(c.intro(tl[third], tl[third - 1]).slice(0, 2)), [`round:${tl[third].round}`, "togo-3"]);
  assert.deepEqual(plain(c.second(tl[firstMain], 10, 60)), ["ten-work"]);
  assert.deepEqual(plain(c.second(tl[firstMain], 10, 15)), [], "no ten-second call on short intervals");
  assert.deepEqual(plain(c.finish(false, true)), ["cooldown-done"]);
  assert.deepEqual(plain(c.finish(true)), ["ended"]);
});

test("rests vary and 'tap done' is explained once", () => {
  const tl = V.compile(V.challengeWorkout(V.challengeById("the-mill"), "standard", "open"), {}, {});
  const c = new V.CoachScript(tl, { challenge: true });
  const said = tl.flatMap((iv, i) => c.intro(iv, tl[i - 1]));
  assert.equal(said.filter(x => x === "tap-done-dist").length, 1);
  assert.equal(said.filter(x => x === "tap-done").length, 1);
  assert.ok(said.includes("t:250 m"));
  assert.deepEqual(plain(c.finish(false)), ["challenge-done"]);
});

test("every built-in workout, benchmark and event Trial is fully recorded in both voices", () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "audio", "voice", "manifest.json"), "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "voice", "catalog.json"), "utf8"));
  for (const { id, text, file } of catalog) {
    assert.equal(man.lines[id]?.text, text, `re-record ${id} (run tools/voice)`);
    for (const voice of Object.keys(V.COACH_VOICES)) assert.ok(fs.existsSync(path.join(ROOT, "audio", "voice", voice, file)), `${voice}/${id}`);
  }
  // The catalog itself must be current: every line the app uses today is in it.
  const ids = new Set(catalog.map(l => l.id));
  for (const id of Object.keys(V.COACH_LINES)) assert.ok(ids.has(id), `${id} missing: run node tools/voice/catalog.mjs`);
  for (const t of V.TEMPLATES) {
    const tl = V.compile(V.createWorkout(t.id, {}), {}, { warmup: true, cooldown: true });
    V.timelineLines(tl).forEach(id => assert.ok(ids.has(id), `${t.id}: ${id}`));
  }
});
