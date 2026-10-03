"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Core: workout model, compiler, interval engine, equipment swaps and
   formatting. No DOM and no storage, so it runs (and is tested) in Node too.
   Depends on workouts.js.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── 1. Workout data model ─────────────────────────────────────────────────────
   Workout   { id, templateId, name, params, rounds: Round[] }
   Round     { label?, blocks: Block[] }
   Block     one of
     { type:"cardio",  id, duration, speed?, effort? }        id → EXERCISES (run, row, bike…)
     { type:"rest",    duration, label? }
     { type:"station", duration?, name?, cue?, instruction?, note?,
                       exercises: [{ id, target? }], segments?: SegmentSpec }
               duration null → open-ended rep station (counts up, athlete taps DONE)
   Exercise refs point into EXERCISES (workouts.js). Each exercise lists its
   allowed substitutions; the athlete's swaps are applied at compile time.
     target:  { reps?: number | [min,max], approx?, perSide?, label?, distance?, unit? }
   A station with >1 exercise is a multi-exercise station.
   SegmentSpec { pattern: [{ label, tone:"hard"|"easy", duration? | share? }], repeat? }
     duration = absolute seconds (Tabata 20/10); share = relative weight that
     scales to the station duration (battle ropes HARD/EASY/HARD = 1/1/1).
   ─────────────────────────────────────────────────────────────────────────── */

const templateById = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];

function defaultParams(t) {
  return Object.fromEntries(t.params.map(p => [p.key, p.default]));
}

function createWorkout(templateId, params) {
  const t = templateById(templateId);
  const p = { ...defaultParams(t), ...(params || {}) };
  return { id: uid(), templateId: t.id, name: t.name, params: p, ...t.build(p) };
}

/* Every swappable exercise a workout uses, in order of first appearance. */
function swappableIds(workout) {
  const seen = [];
  workout.rounds.forEach(r => r.blocks.forEach(b => {
    const ids = b.type === "cardio" ? [b.id] : b.type === "station" ? b.exercises.map(e => e.id) : [];
    ids.forEach(id => { if (EXERCISES[id]?.subs?.length && !seen.includes(id)) seen.push(id); });
  }));
  return seen;
}

/* ── 2. Compiler: workout + swaps → timeline ──────────────────────────────────
   Interval { type:"CARDIO"|"REST"|"WORK", state, round, rounds, part, parts,
              duration (s|null), estimate, title, icon, instruction, note,
              target, speed, effort, exercises, segments, say, roundStart }
   ─────────────────────────────────────────────────────────────────────────── */

function resolveExercise(ref, swaps) {
  const want = swaps?.[ref.id];
  const id = want && want !== ref.id && EXERCISES[ref.id]?.subs?.includes(want) ? want : ref.id;
  const def = EXERCISES[id] || { name: id, instruction: "", equipment: [] };
  return { ...def, id, baseId: ref.id, swapped: id !== ref.id, target: ref.target };
}

function exerciseIcon(e) {
  if (e.cardio) return { run: "ti-run", row: "ti-ripple", bike: "ti-bike", "incline-walk": "ti-walk", "step-ups": "ti-stairs-up" }[e.id] || "ti-heartbeat";
  if (/rope|punch|boxing|sprint/.test(e.id)) return "ti-wave-sine";
  if (/carry|march/.test(e.id)) return "ti-weight";
  if (/lunge|step/.test(e.id)) return "ti-stairs";
  return "ti-barbell";
}

function resolveSegments(spec, duration) {
  if (!spec || !spec.pattern?.length) return { segments: [], duration };
  const repeat = spec.repeat || 1;
  const list = [];
  for (let r = 0; r < repeat; r++) spec.pattern.forEach(p => list.push({ ...p, set: r + 1, sets: repeat }));
  const absolute = list.every(s => s.duration != null);
  let t = 0;
  if (absolute) {
    list.forEach(s => { s.start = t; t += s.duration; s.end = t; });
    return { segments: list, duration: duration ?? t };
  }
  const total = list.reduce((a, s) => a + (s.share || 1), 0);
  let cum = 0;
  list.forEach(s => {
    s.start = Math.round((duration * cum) / total);
    cum += s.share || 1;
    s.end = Math.round((duration * cum) / total);
  });
  return { segments: list, duration };
}

function targetText(target) {
  if (!target) return "";
  if (target.reps != null) {
    const n = Array.isArray(target.reps) ? `${target.reps[0]}–${target.reps[1]}` : target.reps;
    const label = target.label || "reps";
    return `${target.approx ? "~" : ""}${n} ${label}${target.perSide ? "/side" : ""}`;
  }
  if (target.distance != null) return `${target.distance} ${target.unit || "m"}`;
  return "";
}

function spokenTarget(target) {
  if (!target) return "";
  if (target.reps != null) {
    const n = Array.isArray(target.reps) ? `${target.reps[0]} to ${target.reps[1]}` : target.reps;
    return `${target.approx ? "about " : ""}${n} ${target.label && target.label !== "total" ? target.label : "reps"}${target.perSide ? " per side" : ""}`;
  }
  if (target.distance != null) return `${target.distance} ${target.unit || "meters"}`;
  return "";
}

const OPEN_ENDED_ESTIMATE = 60;   // seconds assumed for rep-only stations when planning

function compile(workout, swaps = {}, opts = {}) {
  const timeline = [];
  const rounds = workout.rounds.length;
  const easy = (list, kind) => list.forEach(([id, sec], i) => {
    const e = EXERCISES[id];
    timeline.push({ type: "WARM", state: kind === "warm" ? "WARM-UP" : "COOL-DOWN", phase: kind, round: kind === "warm" ? 0 : rounds + 1,
      rounds, roundStart: false, duration: sec, title: e.name, cue: i === 0 ? e.cue : e.cue || e.name, icon: "ti-stretching",
      instruction: e.instruction, exercises: [], segments: [], exId: id });
  });
  if (opts.warmup) easy(WARMUP, "warm");
  workout.rounds.forEach((round, ri) => {
    round.blocks.forEach((b, bi) => {
      const base = { round: ri + 1, rounds, roundStart: bi === 0 };
      if (b.type === "cardio") {
        const e = resolveExercise({ id: b.id }, swaps);
        const speed = e.speed ? b.speed : null;
        timeline.push({ ...base, type: "CARDIO", state: e.state || "CARDIO", exId: e.id, duration: b.duration,
          title: e.name, cue: e.cue || e.name, icon: exerciseIcon(e), speed, speedUnit: "mph",
          effort: b.effort || e.effort || "", exercises: [], segments: [],
          instruction: speed ? `Treadmill at ${fmtSpeed(speed)} MPH. ${e.instruction}` : e.instruction });
      } else if (b.type === "rest") {
        timeline.push({ ...base, type: "REST", state: "REST", duration: b.duration, title: b.label || "Rest / Transition",
          icon: "ti-clock-pause", instruction: "", exercises: [], segments: [] });
      } else {
        const exs = b.exercises.map(r => resolveExercise(r, swaps));
        const single = exs.length === 1 ? exs[0] : null;
        const anySwap = exs.some(e => e.swapped);
        const title = single && (single.swapped || !b.name) ? single.name : (b.name || exs.map(e => e.name).join(" + "));
        const cue = single && (single.swapped || !b.cue) ? (single.cue || single.name) : (b.cue || title);
        const instruction = (!anySwap && b.instruction) || (single ? single.instruction : b.instruction || "");
        const { segments, duration } = resolveSegments(b.segments, b.duration ?? null);
        timeline.push({ ...base, type: "WORK", state: "WORK", duration, estimate: duration ?? OPEN_ENDED_ESTIMATE,
          title, cue, icon: exerciseIcon(single || exs[0]), instruction, note: b.note || "",
          exercises: exs, target: exs.map(e => targetText(e.target)).filter(Boolean).join(" + "),
          hasTarget: exs.some(e => e.target), openEnded: duration == null, segments });
      }
    });
  });
  if (opts.cooldown) easy(COOLDOWN, "cool");
  // Single-round workouts (mini triathlons) count parts instead of rounds.
  const parts = timeline.filter(iv => iv.type !== "REST" && iv.type !== "WARM");
  parts.forEach((iv, i) => { iv.part = i + 1; });
  timeline.forEach(iv => { iv.parts = parts.length; });

  // Spoken cues depend on neighbours, so they are written after the timeline exists.
  timeline.forEach((iv, i) => {
    const next = timeline[i + 1];
    const lead = iv.rounds > 1 && iv.roundStart ? (iv.round === 1 ? "Round 1. " : `Next round. Round ${iv.round}. `) : "";
    if (iv.type === "CARDIO") {
      const pace = iv.speed ? ` ${Number(Number(iv.speed).toFixed(1))} miles per hour.` : "";
      iv.say = `${lead}${iv.cue}.${pace}`;
    } else if (iv.type === "WARM") {
      iv.say = `${iv.cue}.`;
      if (iv.phase === "cool" && timeline[i - 1]?.type !== "WARM") iv.say = `Main workout done. ${iv.cue}.`;
    } else if (iv.type === "REST") {
      const upNext = !next ? "" : next.roundStart && next.rounds > 1 ? " Next round coming up." : ` Up next, ${next.cue || next.title}.`;
      iv.say = `${spokenDuration(iv.duration)} rest.${upNext}`;
    } else {
      const firstSeg = iv.segments[0]?.label;
      const tgt = (iv.exercises.length === 1 && spokenTarget(iv.exercises[0].target)) || "";
      iv.say = `${lead}${iv.cue}.${tgt ? ` Target ${tgt}.` : ""}${iv.openEnded ? " Tap done when finished." : ""}${firstSeg ? ` ${cap(firstSeg)}.` : ""}`;
    }
  });
  return timeline;
}

const planSec = iv => iv.duration ?? iv.estimate ?? 0;

/* ── 3. IntervalEngine ─────────────────────────────────────────────────────────
   Generic and DOM-free. Wall-clock based, so it stays accurate when ticks are
   throttled (background tab) — it catches up through as many intervals as needed.
   Events: phase, countdown(n), go, interval({reason}), second({remaining}),
           segment({segment}), extend, pause, resume, tick, complete({early})
   ─────────────────────────────────────────────────────────────────────────── */

class IntervalEngine {
  constructor(timeline, opts = {}) {
    this.timeline = timeline;
    this.countdownSec = opts.countdown ?? 3;
    this.now = opts.now || (() => performance.now());
    this.listeners = {};
    this.phase = "idle";            // idle | countdown | running | complete
    this.paused = false;
    this.index = 0;
    this.acc = 0;                   // ms accumulated in current interval (or countdown)
    this.since = null;              // timestamp of last resume, null when paused
    this.extra = 0;                 // ms added to current interval (+10 sec)
    this.lastSecond = null;
    this.segIndex = -1;
    this.visits = [];               // { index, type, round, ms, outcome }
  }
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, data) { (this.listeners[evt] || []).forEach(fn => fn(data || {}, this)); }

  get current() { return this.timeline[this.index]; }
  elapsedMs() { return this.acc + (this.since != null ? this.now() - this.since : 0); }
  durationMs() {
    const d = this.current?.duration;
    return d == null ? null : d * 1000 + this.extra;
  }
  remainingMs() { const d = this.durationMs(); return d == null ? null : Math.max(0, d - this.elapsedMs()); }
  segmentAt(ms) {
    const segs = this.current?.segments || [];
    let idx = -1;
    for (let i = 0; i < segs.length; i++) if (ms >= segs[i].start * 1000) idx = i;
    return idx;
  }
  get segment() { return this.current?.segments?.[this.segIndex] || null; }

  start() {
    if (this.phase !== "idle") return;
    this.phase = "countdown";
    this.acc = 0; this.since = this.now(); this.lastSecond = null;
    this.emit("phase");
    this.tick();
  }
  pause() {
    if (this.paused || this.phase === "idle" || this.phase === "complete") return;
    this.acc = this.elapsedMs(); this.since = null; this.paused = true;
    this.emit("pause");
  }
  resume() {
    if (!this.paused) return;
    this.since = this.now(); this.paused = false;
    this.emit("resume");
    this.tick();
  }
  toggle() { this.paused ? this.resume() : this.pause(); }

  next(outcome = "skipped") {
    if (this.phase === "countdown") { this.emit("go"); this._enter(0, 0, "skip"); return; }
    if (this.phase !== "running") return;
    this._leave(outcome);
    if (this.index + 1 >= this.timeline.length) return this._finish(false);
    this._enter(this.index + 1, 0, outcome === "done" ? "done" : "skip");
  }
  done() { this.next("done"); }
  prev() {
    if (this.phase !== "running") return;
    this._leave("back");
    this._enter(Math.max(0, this.index - 1), 0, "prev");
  }
  extend(sec = 10) {
    if (this.phase !== "running" || this.current.duration == null) return;
    this.extra += sec * 1000;
    this.lastSecond = null;
    this.emit("extend", { sec });
    this.tick();
  }
  end() {
    if (this.phase === "complete") return;
    if (this.phase === "running") this._leave("ended");
    this._finish(true);
  }

  tick() {
    if (this.paused) return;
    if (this.phase === "countdown") {
      const cd = this.countdownSec * 1000, el = this.elapsedMs();
      if (el >= cd) { this.emit("go"); this._enter(0, el - cd, "start"); }
      else {
        const left = Math.ceil((cd - el) / 1000);
        if (left !== this.lastSecond) { this.lastSecond = left; this.emit("countdown", { n: left }); }
        this.emit("tick");
        return;
      }
    }
    if (this.phase !== "running") return;
    for (let guard = 0; guard < 10000 && this.phase === "running"; guard++) {
      const dur = this.durationMs(), el = this.elapsedMs();
      if (dur != null && el >= dur) {
        this._leave("complete", dur);
        if (this.index + 1 >= this.timeline.length) return this._finish(false);
        this._enter(this.index + 1, el - dur, "auto");
        continue;
      }
      const si = this.segmentAt(el);
      if (si !== this.segIndex) {
        this.segIndex = si;
        if (si > 0) this.emit("segment", { segment: this.segment, index: si });
      }
      if (dur != null) {
        const rem = Math.ceil((dur - el) / 1000);
        if (rem !== this.lastSecond) { this.lastSecond = rem; this.emit("second", { remaining: rem }); }
      }
      break;
    }
    this.emit("tick");
  }

  _enter(i, overMs, reason) {
    this.phase = "running";
    this.index = i;
    this.acc = overMs || 0;
    this.since = this.paused ? null : this.now();
    this.extra = 0;
    this.lastSecond = null;
    this.segIndex = this.segmentAt(this.acc);
    this.emit("interval", { reason, interval: this.current, index: i });
  }
  _leave(outcome, capMs) {
    const iv = this.current;
    const ms = capMs != null ? capMs : this.elapsedMs();
    this.visits.push({ index: this.index, type: iv.type, round: iv.round, ms, outcome });
    this.acc = 0; this.since = null;
  }
  _finish(early) {
    this.phase = "complete"; this.paused = false; this.since = null;
    this.emit("complete", { early });
  }

  /* Progress through the planned workout, 0..1 */
  progress() {
    const total = this.timeline.reduce((a, iv) => a + planSec(iv), 0) || 1;
    if (this.phase === "complete") return 1;
    if (this.phase !== "running") return 0;
    let done = 0;
    for (let i = 0; i < this.index; i++) done += planSec(this.timeline[i]);
    const d = this.current.duration;
    if (d) done += d * Math.min(1, this.elapsedMs() / this.durationMs());
    return Math.min(1, done / total);
  }

  stats() {
    const sum = f => this.visits.filter(f).reduce((a, v) => a + v.ms, 0);
    const finished = v => v.outcome === "complete" || v.outcome === "done";
    let distance = 0;
    this.visits.forEach(v => { const iv = this.timeline[v.index]; if (iv.speed) distance += (v.ms / 3600000) * iv.speed; });
    const stationIdx = new Set(this.visits.filter(v => v.type === "WORK" && finished(v)).map(v => v.index));
    // A round counts when every non-rest interval in it was finished (timer ran out or DONE).
    const rounds = this.timeline[0]?.rounds || 0;
    const unit = rounds > 1 ? "round" : "part";
    const groups = rounds > 1
      ? Array.from({ length: rounds }, (_, r) => this.timeline.map((iv, i) => ({ iv, i })).filter(({ iv }) => iv.round === r + 1 && iv.type !== "REST"))
      : this.timeline.map((iv, i) => ({ iv, i })).filter(({ iv }) => iv.type !== "REST" && iv.type !== "WARM").map(x => [x]);
    const done = groups.filter(g => g.length && g.every(({ i }) => this.visits.some(v => v.index === i && finished(v)))).length;
    return {
      totalSec: Math.round(sum(() => true) / 1000),
      cardioSec: Math.round(sum(v => v.type === "CARDIO") / 1000),
      runSec: Math.round(sum(v => !!this.timeline[v.index].speed) / 1000),
      workSec: Math.round(sum(v => v.type === "WORK") / 1000),
      restSec: Math.round(sum(v => v.type === "REST") / 1000),
      warmSec: Math.round(sum(v => v.type === "WARM") / 1000),
      intervalsDone: new Set(this.visits.filter(v => v.type !== "REST" && v.type !== "WARM" && finished(v)).map(v => v.index)).size,
      intervalsTotal: this.timeline.filter(iv => iv.type !== "REST" && iv.type !== "WARM").length,
      distance: Math.round(distance * 100) / 100,
      distanceUnit: "mi",
      stations: stationIdx.size,
      stationsTotal: this.timeline.filter(iv => iv.type === "WORK").length,
      rounds: done,
      roundsTotal: groups.length,
      unit,
    };
  }
}

/* ── Equipment: auto-swap anything the athlete doesn't own ─────────────────── */

/* An exercise is doable when every piece of kit it needs is owned. "dumbbell|kettlebell" means either. */
function hasGear(e, equipment) {
  return (e.equipment || []).every(q => q.split("|").some(x => equipment.includes(x)));
}
function allExerciseIds(workout) {
  const ids = [];
  workout.rounds.forEach(r => r.blocks.forEach(b => {
    (b.type === "cardio" ? [b.id] : b.type === "station" ? b.exercises.map(e => e.id) : []).forEach(id => { if (!ids.includes(id)) ids.push(id); });
  }));
  return ids;
}
/* Manual swaps win; otherwise anything the athlete can't do is swapped for the first doable substitute. */
function gearPlan(workout, manual, equipment) {
  const auto = {};
  const missing = new Set();
  const need = e => (e.equipment || []).forEach(q => { if (!q.split("|").some(x => equipment.includes(x))) missing.add(q.split("|")[0]); });
  allExerciseIds(workout).forEach(id => {
    const base = EXERCISES[id];
    const chosen = manual[id] && (manual[id] === id || base.subs?.includes(manual[id])) ? manual[id] : null;
    if (chosen) { need(EXERCISES[chosen]); return; }
    if (hasGear(base, equipment)) return;
    const sub = (base.subs || []).find(sid => hasGear(EXERCISES[sid], equipment));
    if (sub) auto[id] = sub; else need(base);
  });
  return { swaps: { ...auto, ...manual }, auto, missing: [...missing], doable: missing.size === 0 };
}

/* ── Formatting helpers ────────────────────────────────────────────────────── */

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function cap(s) { s = String(s || "").toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
function pad(n) { return String(n).padStart(2, "0"); }
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtShort(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${pad(s)}`; }
function fmtHours(sec) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}h ${pad(m)}m` : `${m} min`; }
function fmtSpeed(v) { return Number(v).toFixed(1); }
function fmtMi(v) { return `${Number(v).toFixed(2)} mi`; }
function spokenDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  if (!m) return `${s} seconds`;
  return `${m} minute${m > 1 ? "s" : ""}${s ? ` ${s}` : ""}`;
}
function fmtParam(p, v) { return p.kind === "time" ? fmtShort(v) : p.kind === "speed" ? fmtSpeed(v) : String(v); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
function fmtDay(ts) { return new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
function planTotals(timeline) {
  const sum = f => timeline.filter(f).reduce((a, iv) => a + planSec(iv), 0);
  const dist = timeline.filter(iv => iv.speed).reduce((a, iv) => a + (iv.duration / 3600) * iv.speed, 0);
  return {
    total: sum(() => true), main: sum(iv => iv.type !== "WARM"), warm: sum(iv => iv.type === "WARM"),
    cardio: sum(iv => iv.type === "CARDIO"), run: sum(iv => !!iv.speed), work: sum(iv => iv.type === "WORK"),
    dist, openEnded: timeline.some(iv => iv.openEnded),
  };
}
function timeBucket(sec) { const min = sec / 60; return min <= 25 ? "20" : min <= 40 ? "30" : "45"; }
const BUCKET_LABEL = { 20: "20 min", 30: "30 min", 45: "45+ min" };
function timelinePatterns(timeline) {
  const set = new Set();
  timeline.forEach(iv => {
    if (iv.type === "CARDIO") set.add("cardio");
    iv.exercises.forEach(e => e.pattern && set.add(e.pattern));
  });
  return set;
}
/* Seconds per movement pattern actually trained (from engine visits). */
function visitPatterns(timeline, visits) {
  const out = {};
  visits.forEach(v => {
    const iv = timeline[v.index];
    const sec = v.ms / 1000;
    if (iv.type === "CARDIO") out.cardio = (out.cardio || 0) + sec;
    else if (iv.type === "WORK" && iv.exercises.length) {
      iv.exercises.forEach(e => { if (e.pattern) out[e.pattern] = (out[e.pattern] || 0) + sec / iv.exercises.length; });
    }
  });
  Object.keys(out).forEach(k => { out[k] = Math.round(out[k]); });
  return out;
}

/* ── Benchmarks (Row → Bike → Run) ─────────────────────────────────────────── */

const METERS_PER_MILE = 1609.344;
const legUnit = exId => (exId === "row" ? "m" : "mi");

function benchmarkLegs(timeline) {
  const legs = [];
  timeline.filter(iv => iv.type === "CARDIO").forEach(iv => {
    let leg = legs.find(l => l.id === iv.exId);
    if (!leg) legs.push(leg = { id: iv.exId, name: iv.title, unit: legUnit(iv.exId), sec: 0, estimate: 0 });
    leg.sec += iv.duration;
    if (iv.speed) leg.estimate += (iv.duration / 3600) * iv.speed;
  });
  return legs;
}
function benchTotalMi(bench) {
  return bench.legs.reduce((a, l) => a + (Number(l.value) || 0) / (l.unit === "m" ? METERS_PER_MILE : 1), 0);
}

/* ── Programs ───────────────────────────────────────────────────────────────── */

const programById = id => PROGRAMS.find(p => p.id === id) || null;

/* Flat, ordered list of a program's sessions. key = "week-session" (1-based). */
function programSessions(prog) {
  return prog.weeks.flatMap((week, wi) => week.map((s, si) => ({ ...s, week: wi + 1, index: si + 1, perWeek: week.length, key: `${wi + 1}-${si + 1}` })));
}

/* Apply a session's adjustments as deltas to the athlete's own settings, clamped to each setting's range. */
function programParams(template, base, adj = {}) {
  const out = { ...base };
  Object.entries(adj).forEach(([key, delta]) => {
    const p = template.params.find(x => x.key === key);
    if (!p || typeof out[key] !== "number") return;
    out[key] = Math.min(p.max, Math.max(p.min, Math.round((out[key] + delta) * 10) / 10));
  });
  return out;
}

/* active: { id, startedAt, done: { [key]: historyId }, completedAt? } */
function programStatus(active) {
  const prog = active && programById(active.id);
  if (!prog) return null;
  const sessions = programSessions(prog);
  const done = active.done || {};
  const next = sessions.find(s => !done[s.key]) || null;
  const doneCount = sessions.filter(s => done[s.key]).length;
  return { prog, sessions, done, next, doneCount, total: sessions.length, week: next ? next.week : prog.weeks.length, complete: !next };
}
