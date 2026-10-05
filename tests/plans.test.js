"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./load")();
const plain = x => JSON.parse(JSON.stringify(x));
const ALL = ["treadmill", "rower", "bike", "kettlebell", "dumbbell", "battle-ropes", "outdoors"];
const backToBack = (a, b) => (b - a + 7) % 7 === 1;
const hard = id => { const t = V.templateById(id); return !t.focus.includes("low-impact") && (t.level === "advanced" || t.focus.includes("strength-heavy") || t.focus.includes("cardio-heavy")); };

test("a plan has one session per chosen day, Monday first", () => {
  const p = V.makePlan({ goal: "fit", days: [5, 1, 3], minutes: 30, level: "intermediate", equipment: ALL });
  assert.deepEqual(plain(p.slots.map(s => s.day)), [1, 3, 5]);
  assert.equal(new Set(p.slots.map(s => s.t)).size, 3, "no repeats while there's choice");
  assert.ok(p.custom && p.id.startsWith("my-"));
});

test("every goal, level and kit gives a doable plan without benchmarks or two-levels-up sessions", () => {
  const rank = { beginner: 0, intermediate: 1, advanced: 2 };
  for (const goal of V.PLAN_GOALS.map(g => g.id)) for (const level of Object.keys(rank)) for (const equipment of [ALL, ["outdoors"], [], ["dumbbell"]]) {
    const p = V.makePlan({ goal, days: [1, 2, 4, 6], minutes: 30, level, equipment });
    assert.ok(p.slots.length > 0, `${goal}/${level}/${equipment}`);
    for (const s of p.slots) {
      const t = V.templateById(s.t);
      assert.notEqual(t.category, "benchmark");
      assert.ok(rank[t.level] - rank[level] < 2, `${goal}/${level}: ${t.id}`);
      assert.ok(V.gearPlan(V.createWorkout(t.id, s.set), {}, equipment).doable, `${t.id} doable with ${equipment}`);
      if (goal === "nogear") assert.ok(t.equipment.every(e => e === "outdoors"), t.id);
    }
  }
});

test("no hard sessions on back-to-back days", () => {
  for (const goal of ["fit", "engine", "strength"]) {
    const p = V.makePlan({ goal, days: [1, 2, 3, 4, 5, 6], minutes: 45, level: "advanced", equipment: ALL });
    const s = p.slots;
    for (let i = 1; i < s.length; i++) if (backToBack(s[i - 1].day, s[i].day)) assert.ok(!(hard(s[i - 1].t) && hard(s[i].t)), `${goal}: ${s[i - 1].t} → ${s[i].t}`);
  }
});

test("sessions are sized to the chosen time", () => {
  for (const minutes of [20, 45]) {
    const p = V.makePlan({ goal: "nogear", days: [1, 3, 5], minutes, level: "intermediate", equipment: ["outdoors"] });
    for (const s of p.slots) {
      if (!s.set.rounds) continue;
      const w = V.createWorkout(s.t, s.set);
      const main = V.planTotals(V.compile(w, V.gearPlan(w, {}, ["outdoors"]).swaps, {})).main / 60;
      const t = V.templateById(s.t), rp = t.params.find(x => x.key === "rounds");
      if (s.set.rounds > rp.min && s.set.rounds < rp.max) assert.ok(Math.abs(main - minutes) < 8, `${s.t}: ${main.toFixed(1)} min for ${minutes}`);
    }
  }
});

test("goals change the plan: strength picks strength work, run picks running", () => {
  const share = (id, set, key) => { const w = V.createWorkout(id, set); const t = V.planTotals(V.compile(w, V.gearPlan(w, {}, ALL).swaps, {})); return t[key] / t.main; };
  const str = V.makePlan({ goal: "strength", days: [1, 3, 5], minutes: 30, level: "intermediate", equipment: ALL });
  const eng = V.makePlan({ goal: "engine", days: [1, 3, 5], minutes: 30, level: "intermediate", equipment: ALL });
  const avg = (p, key) => p.slots.reduce((a, s) => a + share(s.t, s.set, key), 0) / p.slots.length;
  assert.ok(avg(str, "work") > avg(eng, "work"));
  assert.ok(avg(eng, "cardio") > avg(str, "cardio"));
  const run = V.makePlan({ goal: "run", days: [2, 4, 6], minutes: 30, level: "beginner", equipment: ["outdoors"] });
  assert.ok(run.slots.some(s => s.t === "run-walk"));
});

test("a stored plan becomes a 4-week program: build in weeks 2–3, lighter week 4", () => {
  const prog = V.planProgram(V.makePlan({ goal: "fit", days: [1, 3, 5], minutes: 30, level: "intermediate", equipment: ALL }));
  assert.equal(prog.weeks.length, 4);
  prog.weeks.forEach(w => assert.equal(w.length, 3));
  const s = prog.weeks.map(w => w[0]);
  const t = V.templateById(s[0].t);
  const params = s.map(x => V.sessionParams(t, V.createWorkout(t.id).params, x));
  if (t.params.some(p => p.key === "rounds")) {
    assert.ok(params[3].rounds <= params[0].rounds, "week 4 lighter");
    assert.ok(params[2].rounds >= params[0].rounds, "week 3 builds");
  }
  assert.match(prog.about, /Mon, Wed, Fri/);
});

test("own plans run through the program engine", () => {
  const prog = V.planProgram(V.makePlan({ goal: "nogear", days: [2, 4], minutes: 20, level: "beginner", equipment: [] }));
  V.USER_PROGRAMS.push(prog);
  const st = V.programStatus({ id: prog.id, startedAt: 0, done: { "1-1": "h1" } });
  assert.equal(st.total, 8);
  assert.equal(st.doneCount, 1);
  assert.equal(st.next.key, "1-2");
  assert.equal(st.next.day, 4);
  V.USER_PROGRAMS.length = 0;
});

test("reminders start on the next plan day at the chosen time", () => {
  const monday9am = new Date(2026, 9, 5, 9, 0).getTime();
  const r = V.reminderStarts([{ day: 1 }, { day: 3 }, { day: 0 }], "17:30", monday9am);
  assert.deepEqual(r.map(x => [x.start.getDay(), x.start.getDate(), x.start.getHours(), x.start.getMinutes()]).map(plain), [[1, 5, 17, 30], [3, 7, 17, 30], [0, 11, 17, 30]]);
});

test("calendar file: one weekly event per plan day for four weeks, each with an alert", () => {
  const plan = { id: "my-x", name: "Caro, Engine; plan" };
  const items = V.reminderStarts([{ day: 1, name: "Quiet Room", minutes: 38 }, { day: 3, name: "Run/Walk Builder", minutes: 30 }], "07:00", new Date(2026, 9, 5).getTime());
  const ics = V.planIcs(plan, items, { url: "https://example.app/", now: Date.UTC(2026, 9, 5) });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal((ics.match(/RRULE:FREQ=WEEKLY;COUNT=4/g) || []).length, 2);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(ics, /DTSTART:20261005T070000\r\n/);
  assert.match(ics, /DURATION:PT38M/);
  assert.ok(ics.includes("Caro\\, Engine\\; plan"), "commas and semicolons escaped");
  assert.ok(ics.split("\r\n").every(l => l.length <= 75), "lines folded");
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("Google Calendar link repeats weekly for the plan", () => {
  const [it] = V.reminderStarts([{ day: 1, name: "Quiet Room", minutes: 38 }], "17:30", new Date(2026, 9, 5).getTime());
  const u = new URL(V.googleCalendarUrl({ name: "Plan" }, it, { url: "https://example.app/", timeZone: "Europe/Berlin" }));
  assert.equal(u.searchParams.get("dates"), "20261005T173000/20261005T180800");
  assert.equal(u.searchParams.get("recur"), "RRULE:FREQ=WEEKLY;COUNT=4");
  assert.equal(u.searchParams.get("ctz"), "Europe/Berlin");
  assert.match(u.searchParams.get("text"), /Quiet Room/);
});
