"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./load")();

const row = data => ({ id: data.id, data, performed_at: new Date(data.date).toISOString(), updated_at: new Date(data.date).toISOString() });
const result = (verification, extra = {}) => ({ id: "r1", date: Date.UTC(2026, 9, 10), name: "Three Rivers", stats: { totalSec: 1900 },
  attempt: { challengeId: "three-rivers", variant: "standard", division: "open", score: 14200, better: "higher", verification, pr: true, ...extra } });

test("a community result becomes a feed item with its score and PR", () => {
  const a = V.activityRow("u1", row(result("community")));
  assert.equal(a.kind, "result");
  assert.equal(a.title, "Three Rivers · Standard");
  assert.equal(a.score, 14200);
  assert.equal(a.pr, true);
});

test("a training result is private: posted as a plain workout without score", () => {
  const a = V.activityRow("u1", row(result("training")));
  assert.equal(a.kind, "workout");
  assert.equal(a.score, null);
  assert.equal(a.pr, false);
  assert.equal(a.challenge_id, null);
});

test("a normal workout posts its name and duration", () => {
  const a = V.activityRow("u1", row({ id: "w", date: 1, name: "VYRA 8", stats: { totalSec: 1410 } }));
  assert.deepEqual([a.kind, a.title, a.duration_sec], ["workout", "VYRA 8", 1410]);
});

test("monthly challenge, division and PR badges count from attempts", () => {
  const oct = V.monthlyChallenge(new Date(2026, 9, 12));
  const h = (id, date, attempt) => ({ id, date, stats: { totalSec: 600 }, attempt: { dnf: false, pr: false, division: "open", ...attempt } });
  const ctx = V.competitionContext([
    h("a", new Date(2026, 9, 12).getTime(), { challengeId: oct.challengeId, variant: oct.variant, pr: true }),
    h("b", new Date(2026, 9, 13).getTime(), { challengeId: "the-hunt", variant: "5k", division: "elite" }),
    h("c", new Date(2026, 9, 14).getTime(), { challengeId: "the-hunt", variant: "5k", dnf: true, division: "competitive" }),
  ]);
  assert.equal(ctx.months, 1);
  assert.equal(ctx.benchDone, 2);
  assert.equal(ctx.prCount, 1);
  assert.equal(ctx.elite, 1);
  assert.equal(ctx.competitive, 0, "a DNF doesn't earn a division badge");
});
