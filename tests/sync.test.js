"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./load")();
const plain = x => JSON.parse(JSON.stringify(x));

const iso = ms => new Date(ms).toISOString();
const workout = (id, date, extra = {}) => ({ id, date, name: "VYRA 8", stats: { totalSec: 1400 }, rating: 0, ...extra });

test("stamping marks only changed workouts", () => {
  const h = [workout("a", 1), workout("b", 2)];
  assert.equal(V.stampChanges(h, 1000), 2);
  assert.equal(V.stampChanges(h, 2000), 0);
  h[0].rating = 4;
  assert.equal(V.stampChanges(h, 3000), 1);
  assert.equal(h[0].updatedAt, 3000);
  assert.equal(h[1].updatedAt, 1000);
});

test("pending rows include edits after the last push, deletions, and never sample data", () => {
  const h = [workout("a", 1, { updatedAt: 500 }), workout("b", 2, { updatedAt: 1500 }), workout("demo", 3, { updatedAt: 1500, demo: true })];
  const rows = plain(V.pendingWorkoutRows(h, { gone: 1600, old: 100 }, 1000));
  assert.deepEqual(rows.map(r => [r.id, r.deleted]), [["b", false], ["gone", true]]);
  assert.equal(rows[0].data._sig, undefined, "internal fields stay local");
  assert.equal(rows[0].updated_at, iso(1500));
});

test("remote edits merge in when newer, and are ignored when older", () => {
  const local = [workout("a", 1, { rating: 2, updatedAt: 2000 })];
  const newer = V.mergeRemoteWorkouts(local, {}, [{ id: "a", data: workout("a", 1, { rating: 5 }), deleted: false, updated_at: iso(3000) }]);
  assert.equal(newer.history[0].rating, 5);
  assert.ok(newer.changed);
  const older = V.mergeRemoteWorkouts(local, {}, [{ id: "a", data: workout("a", 1, { rating: 1 }), deleted: false, updated_at: iso(1000) }]);
  assert.equal(older.history[0].rating, 2);
  assert.equal(older.changed, false);
});

test("new remote workouts are added in date order and not pushed back", () => {
  const local = [workout("a", 100)];
  V.stampChanges(local, 100);
  const m = V.mergeRemoteWorkouts(local, {}, [{ id: "b", data: workout("b", 200), deleted: false, updated_at: iso(5000) }]);
  assert.deepEqual(plain(m.history.map(x => x.id)), ["b", "a"]);
  assert.equal(V.stampChanges(m.history, 9000), 0, "merged records keep their remote timestamp");
});

test("remote deletions remove local copies and leave a tombstone", () => {
  const local = [workout("a", 1, { updatedAt: 1000 })];
  const m = V.mergeRemoteWorkouts(local, {}, [{ id: "a", data: null, deleted: true, updated_at: iso(2000) }]);
  assert.equal(m.history.length, 0);
  assert.equal(m.tombstones.a, 2000);
});

test("a local deletion beats an older remote copy", () => {
  const m = V.mergeRemoteWorkouts([], { a: 5000 }, [{ id: "a", data: workout("a", 1), deleted: false, updated_at: iso(4000) }]);
  assert.equal(m.history.length, 0);
});

test("profile blob holds only synced settings", () => {
  const blob = plain(V.profileBlob({ profile: { goal: 3 }, settings: {}, params: {}, swaps: {}, program: null, lastTemplate: "vyra-8", history: [1], checkin: {} }));
  assert.deepEqual(Object.keys(blob).sort(), ["lastTemplate", "params", "profile", "program", "settings", "swaps"]);
});

test("downloaded workouts are not uploaded again until edited on this device", () => {
  const m = V.mergeRemoteWorkouts([], {}, [{ id: "r", data: workout("r", 1), deleted: false, updated_at: iso(5000) }]);
  assert.equal(V.pendingWorkoutRows(m.history, {}, 0).length, 0);
  m.history[0].rating = 3;
  V.stampChanges(m.history, 6000);
  assert.equal(V.pendingWorkoutRows(m.history, {}, 0).length, 1);
});

test("a deletion wins over the version it deleted, even with a slow clock", () => {
  const rec = workout("a", 1, { updatedAt: 9000 });
  const ts = V.deletionStamp(rec, 1000);            // this device's clock is far behind
  const m = V.mergeRemoteWorkouts([], { a: ts }, [{ id: "a", data: workout("a", 1), deleted: false, updated_at: iso(9000) }]);
  assert.equal(m.history.length, 0);
});
