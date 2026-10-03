"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./load")();
// Values built inside the sandbox have their own Array prototype; compare plain copies.
const plain = x => JSON.parse(JSON.stringify(x));

function rig(templateId = "vyra-8", opts) {
  let now = 0;
  const tl = V.compile(V.createWorkout(templateId, {}), {}, opts);
  const e = new V.IntervalEngine(tl, { now: () => now });
  const events = [];
  ["countdown", "go", "interval", "segment", "complete"].forEach(n => e.on(n, d => events.push([n, d.n ?? d.reason ?? d.segment?.label ?? d.early])));
  return { e, tl, events, advance: ms => { now += ms; e.tick(); } };
}

test("3-2-1 countdown, then the first interval starts", () => {
  const { e, events, advance } = rig();
  e.start();
  advance(1000); advance(1000); advance(1000);
  assert.deepEqual(events.filter(x => x[0] === "countdown").map(x => x[1]), [3, 2, 1]);
  assert.equal(e.phase, "running");
  assert.equal(e.index, 0);
});

test("pausing keeps the remaining time instead of resetting", () => {
  const { e, advance } = rig();
  e.start(); advance(3000);
  advance(25000);
  e.pause();
  advance(600000);            // ten minutes on pause
  assert.equal(Math.round(e.remainingMs() / 1000), 35);
  e.resume();
  advance(5000);
  assert.equal(Math.round(e.remainingMs() / 1000), 30);
});

test("intervals advance automatically and sub-intervals switch HARD/EASY", () => {
  const { e, events, advance } = rig();
  e.start(); advance(3000);
  advance(60000);   // run → rest
  advance(30000);   // rest → ropes
  advance(20000);   // EASY
  advance(20000);   // HARD
  assert.equal(e.index, 2);
  assert.deepEqual(plain(events.filter(x => x[0] === "segment").map(x => x[1])), ["EASY", "HARD"]);
  assert.deepEqual(plain(events.filter(x => x[0] === "interval").map(x => x[1])), ["start", "auto", "auto"]);
});

test("+10 sec, skip and previous", () => {
  const { e, advance } = rig();
  e.start(); advance(3000);
  e.extend(10);
  assert.equal(Math.round(e.remainingMs() / 1000), 70);
  e.next(); assert.equal(e.index, 1);
  e.next(); assert.equal(e.index, 2);
  e.prev(); assert.equal(e.index, 1);
  assert.equal(Math.round(e.remainingMs() / 1000), 30);
});

test("catches up through many intervals after a long throttle", () => {
  const { e, advance } = rig();
  e.start(); advance(3000);
  advance(1e9);
  assert.equal(e.phase, "complete");
  const st = e.stats();
  assert.equal(st.rounds, 8);
  assert.equal(st.stations, 8);
  assert.equal(st.runSec, 480);
  assert.equal(st.distance, 0.93);
});

test("open-ended rep stations wait for DONE", () => {
  const { e, tl, advance } = rig("strength-before-speed");
  e.start(); advance(3000);
  advance(60000); advance(30000);
  assert.ok(tl[e.index].openEnded);
  advance(600000);
  assert.equal(e.index, 2, "still waiting");
  e.done();
  assert.equal(e.index, 3);
});

test("ending early reports partial stats and does not count unfinished rounds", () => {
  const { e, advance } = rig();
  e.start(); advance(3000);
  advance(60000 + 30000 + 60000 + 30000);   // round 1 done
  advance(20000);
  e.end();
  const st = e.stats();
  assert.equal(st.rounds, 1);
  assert.equal(st.totalSec, 200);
});

test("warm-up time is tracked separately from rounds", () => {
  const { e, advance } = rig("engine-builder", { warmup: true });
  e.start(); advance(3000); advance(1e9);
  const st = e.stats();
  assert.ok(st.warmSec > 0);
  assert.equal(st.rounds, st.roundsTotal);
});
