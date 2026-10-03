"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Hybrid workout player
   The workout and the timer are one experience: press START and VYRA tells the
   athlete what to do, for how long, when to rest and what is coming next.

   Layers (top to bottom):
     0. workouts.js          — exercise library (with swaps) + workout templates
     1. Workout data model   — templates → workouts → rounds → blocks → exercises
     2. Compiler             — workout + swaps → flat timeline of intervals
     3. IntervalEngine       — generic, DOM-free timer that runs any timeline
     4. Cues                 — beeps, speech, vibration driven by engine events
     5. UI                   — library, setup, player, summary, history screens
   ════════════════════════════════════════════════════════════════════════════ */

const APP_VERSION = "2026.10.03.2";
const STORE_KEY = "vyra_v1";

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
  const id = want && EXERCISES[ref.id]?.subs?.includes(want) ? want : ref.id;
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

function compile(workout, swaps = {}) {
  const timeline = [];
  const rounds = workout.rounds.length;
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
  // Single-round workouts (mini triathlons) count parts instead of rounds.
  const parts = timeline.filter(iv => iv.type !== "REST");
  parts.forEach((iv, i) => { iv.part = i + 1; });
  timeline.forEach(iv => { iv.parts = parts.length; });

  // Spoken cues depend on neighbours, so they are written after the timeline exists.
  timeline.forEach((iv, i) => {
    const next = timeline[i + 1];
    const lead = iv.rounds > 1 && iv.roundStart ? (iv.round === 1 ? "Round 1. " : `Next round. Round ${iv.round}. `) : "";
    if (iv.type === "CARDIO") {
      const pace = iv.speed ? ` ${Number(Number(iv.speed).toFixed(1))} miles per hour.` : "";
      iv.say = `${lead}${iv.cue}.${pace}`;
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
      : this.timeline.map((iv, i) => ({ iv, i })).filter(({ iv }) => iv.type !== "REST").map(x => [x]);
    const done = groups.filter(g => g.length && g.every(({ i }) => this.visits.some(v => v.index === i && finished(v)))).length;
    return {
      totalSec: Math.round(sum(() => true) / 1000),
      cardioSec: Math.round(sum(v => v.type === "CARDIO") / 1000),
      runSec: Math.round(sum(v => !!this.timeline[v.index].speed) / 1000),
      workSec: Math.round(sum(v => v.type === "WORK") / 1000),
      restSec: Math.round(sum(v => v.type === "REST") / 1000),
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

/* ── 4. Cues: sound, speech, vibration ──────────────────────────────────────── */

const Cues = {
  ctx: null,
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch { /* audio unavailable */ }
    // iOS only allows speech after a user gesture: prime it with a silent utterance.
    try {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      }
    } catch { /* speech unavailable */ }
  },
  tone(freq, dur, { type = "sine", gain = 0.28, delay = 0 } = {}) {
    if (!state.settings.sound || !this.ctx) return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.05);
    } catch { /* ignore */ }
  },
  beep()      { this.tone(880, 0.14); },                                        // before an interval begins
  go()        { this.tone(1320, 0.3, { gain: 0.32 }); },
  end()       { this.tone(660, 0.22, { type: "square", gain: 0.2 });            // stronger: interval ends
                this.tone(990, 0.42, { type: "square", gain: 0.22, delay: 0.22 }); },
  segment()   { this.tone(1046, 0.12, { type: "triangle" }); this.tone(1046, 0.12, { type: "triangle", delay: 0.16 }); },
  complete()  { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, { type: "triangle", gain: 0.25, delay: i * 0.16 })); },
  say(text, { interrupt = true } = {}) {
    if (!state.settings.voice || !text || !("speechSynthesis" in window)) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US"; u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  },
  hush() { try { speechSynthesis.cancel(); } catch { /* ignore */ } },
  buzz(pattern) {
    if (state.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
  },
};

function wireCues(engine) {
  engine
    .on("countdown", ({ n }) => { Cues.beep(); Cues.buzz(60); Cues.say(String(n)); })
    .on("go", () => { Cues.go(); Cues.buzz(200); })
    .on("interval", ({ reason, interval }) => {
      if (reason === "auto") { Cues.end(); Cues.buzz([280, 120, 280]); }
      Cues.say(reason === "start" ? `Go. ${interval.say}` : interval.say);
    })
    .on("second", ({ remaining }, e) => {
      const d = e.durationMs() / 1000;
      if (remaining === 10 && d >= 20) Cues.say("10 seconds");
      if (remaining <= 3 && remaining >= 1 && d > 4) { Cues.beep(); Cues.buzz(50); Cues.say(String(remaining)); }
    })
    .on("segment", ({ segment }) => { Cues.segment(); Cues.buzz([120, 80, 120]); Cues.say(cap(segment.label)); })
    .on("pause", () => { Cues.hush(); Cues.say("Paused"); })
    .on("resume", () => Cues.say("Resume"))
    .on("complete", ({ early }) => {
      Cues.complete(); Cues.buzz([400, 150, 400, 150, 600]);
      Cues.say(early ? "Workout ended" : "Workout complete");
    });
}

/* ── Wake lock: keep the screen on during a workout ─────────────────────────── */

const WakeLock = {
  lock: null,
  async request() {
    try { if ("wakeLock" in navigator && !this.lock) { this.lock = await navigator.wakeLock.request("screen"); this.lock.addEventListener("release", () => { this.lock = null; }); } }
    catch { this.lock = null; }
  },
  release() { try { this.lock?.release(); } catch { /* ignore */ } this.lock = null; },
};

/* ── State & persistence ───────────────────────────────────────────────────── */

const state = loadState();
const ui = {
  screen: "library", templateId: state.lastTemplate || TEMPLATES[0].id, summary: null, viewingHistory: false,
  confirmEnd: false, go: false, filters: { time: "all", level: "all", focus: "all", equip: "all" },
};
let engine = null;
let session = null;  // { workout, timeline, swaps, startedAt }
let driver = null;

function loadState() {
  const fresh = { settings: { sound: true, voice: true, vibrate: true }, params: {}, swaps: {}, history: [], lastTemplate: null };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw);
    return { ...fresh, ...s, swaps: s.swaps || {}, settings: { ...fresh.settings, ...(s.settings || {}) } };
  } catch { return fresh; }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }

function paramsFor(templateId) {
  const t = templateById(templateId);
  return { ...defaultParams(t), ...(state.params[templateId] || {}) };
}
function swapsFor(templateId) { return state.swaps[templateId] || {}; }

/* Planned workout for a template with the athlete's current settings. */
function planFor(templateId) {
  const workout = createWorkout(templateId, paramsFor(templateId));
  const timeline = compile(workout, swapsFor(templateId));
  return { workout, timeline, totals: planTotals(timeline) };
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
function fmtShort(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${pad(s)}`;
}
function fmtSpeed(v) { return Number(v).toFixed(1); }
function fmtMi(v) { return `${Number(v).toFixed(2)} mi`; }
function spokenDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  if (!m) return `${s} seconds`;
  return `${m} minute${m > 1 ? "s" : ""}${s ? ` ${s}` : ""}`;
}
function fmtParam(p, v) {
  if (p.kind === "time") return fmtShort(v);
  if (p.kind === "speed") return fmtSpeed(v);
  return String(v);
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}
function planTotals(timeline) {
  const sum = f => timeline.filter(f).reduce((a, iv) => a + planSec(iv), 0);
  const dist = timeline.filter(iv => iv.speed).reduce((a, iv) => a + (iv.duration / 3600) * iv.speed, 0);
  return {
    total: sum(() => true), cardio: sum(iv => iv.type === "CARDIO"), run: sum(iv => !!iv.speed), work: sum(iv => iv.type === "WORK"),
    dist, openEnded: timeline.some(iv => iv.openEnded),
  };
}
function timeBucket(sec) {
  const min = sec / 60;
  return min <= 25 ? "20" : min <= 40 ? "30" : "45";
}
const BUCKET_LABEL = { 20: "20 min", 30: "30 min", 45: "45+ min" };

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
function benchResults(templateId) {
  return state.history.filter(h => h.templateId === templateId && h.bench?.totalMi > 0);
}

/* ── 5. UI ─────────────────────────────────────────────────────────────────── */

const app = document.getElementById("app");

function render() {
  document.body.dataset.screen = ui.screen;
  if (ui.screen === "player") return renderPlayer();
  if (ui.screen === "summary") app.innerHTML = renderSummary();
  else if (ui.screen === "history") app.innerHTML = renderHistory();
  else if (ui.screen === "setup") app.innerHTML = renderSetup();
  else app.innerHTML = renderLibrary();
  window.scrollTo(0, 0);
}

function topbar(right = "", left = "") {
  return `
  <header class="topbar">
    ${left || `<div class="brand"><span class="brand-mark">VYRA</span><span class="brand-sub">Hybrid Training</span></div>`}
    <div class="topbar-actions">${right}</div>
  </header>`;
}
const backButton = (act, label = "Back") =>
  `<button class="back-btn" data-act="${act}" aria-label="${label}"><i class="ti ti-chevron-left"></i><span>${label}</span></button>`;

function soundButton() {
  const on = state.settings.sound || state.settings.voice;
  return `<button class="icon-btn" data-act="toggle-audio" aria-label="${on ? "Mute audio cues" : "Turn audio cues on"}" title="Audio cues">
    <i class="ti ${on ? "ti-volume" : "ti-volume-off"}" aria-hidden="true"></i></button>`;
}

const EQUIP_SHORT = { treadmill: "Treadmill", rower: "Rower", bike: "Bike", kettlebell: "KB", dumbbell: "DB", "battle-ropes": "Ropes" };
const CATEGORY_ICON = { hybrid: "ti-run", "kb-db": "ti-barbell", benchmark: "ti-trophy" };

/* Library */
function templateMeta(t) {
  const { totals } = planFor(t.id);
  const bucket = timeBucket(totals.total);
  const machine = t.equipment.some(e => MACHINES.includes(e));
  return { t, totals, bucket, machine, minutes: Math.round(totals.total / 60) };
}

function passesFilters(m) {
  const f = ui.filters;
  if (f.time !== "all" && m.bucket !== f.time) return false;
  if (f.level !== "all" && m.t.level !== f.level) return false;
  if (f.focus !== "all" && !m.t.focus.includes(f.focus)) return false;
  if (f.equip === "no-machines" && m.machine) return false;
  if (f.equip === "machine" && !m.machine) return false;
  if (!["all", "no-machines", "machine"].includes(f.equip) && !m.t.equipment.includes(f.equip)) return false;
  return true;
}

function renderLibrary() {
  const metas = TEMPLATES.map(templateMeta);
  const shown = metas.filter(passesFilters);
  const chipGroup = (key, label, options) => `
    <div class="filter-group">
      <span class="filter-label">${label}</span>
      <div class="cl-filters">${options.map(([v, l]) => `
        <button class="cl-chip ${ui.filters[key] === v ? "active" : ""}" data-filter="${key}" data-value="${v}" aria-pressed="${ui.filters[key] === v}">${l}</button>`).join("")}
      </div>
    </div>`;
  const anyFilter = Object.values(ui.filters).some(v => v !== "all");

  const row = m => {
    const best = m.t.focus.includes("benchmark") ? benchResults(m.t.id).reduce((a, h) => Math.max(a, h.bench.totalMi), 0) : 0;
    const equip = m.t.equipment.map(e => EQUIP_SHORT[e]).join(" · ");
    return `
    <button class="cl-row" data-template="${m.t.id}">
      <i class="ti ${CATEGORY_ICON[m.t.category]} cl-ic" aria-hidden="true"></i>
      <span class="cl-main">
        <span class="cl-name">${esc(m.t.name)}</span>
        <span class="cl-sub">${esc(m.t.tagline)}</span>
        <span class="cl-meta">${m.minutes} min · ${cap(m.t.level)} · ${esc(equip)}${best ? ` · <b>Best ${fmtMi(best)}</b>` : ""}</span>
      </span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`;
  };

  const groups = CATEGORIES.map(c => {
    const items = shown.filter(m => m.t.category === c.id);
    if (!items.length) return "";
    return `
      <div class="cl-cat"><span class="cl-cat-name">${c.label}</span><span class="cl-cat-count">${items.length}</span></div>
      <div class="cl-list">${items.map(row).join("")}</div>`;
  }).join("");

  return `
  ${topbar(`<button class="icon-btn" data-act="history" aria-label="History"><i class="ti ti-history"></i></button>`)}
  <section class="hero">
    <div class="hero-daycount">${TEMPLATES.length} workouts · ${Object.keys(EXERCISES).length} movements</div>
    <div class="hero-titlebar"><h1 class="hero-name">Workout library</h1></div>
  </section>
  <section class="filters" aria-label="Filters">
    ${chipGroup("time", "Time", [["all", "All"], ["20", "20 min"], ["30", "30 min"], ["45", "45+ min"]])}
    ${chipGroup("level", "Level", [["all", "All"], ...LEVELS.map(l => [l, cap(l)])])}
    ${chipGroup("focus", "Focus", [["all", "All"], ...Object.entries(FOCUS_LABEL)])}
    ${chipGroup("equip", "Equipment", [["all", "All"], ["no-machines", "No machines"], ["machine", "Machine"], ...Object.entries(EQUIPMENT_LABEL)])}
    ${anyFilter ? `<button class="text-btn" data-act="clear-filters"><i class="ti ti-x"></i> Clear filters</button>` : ""}
  </section>
  ${groups || `<p class="empty">No workouts match these filters.</p>`}`;
}

/* Setup */
function renderSetup() {
  const t = templateById(ui.templateId);
  const params = paramsFor(t.id);
  const swaps = swapsFor(t.id);
  const { workout, timeline, totals } = planFor(t.id);
  const isBench = t.focus.includes("benchmark");

  const cardioKeys = { rowSec: "row", bikeSec: "bike", runSec: "run" };
  const paramLabel = p => {
    const base = cardioKeys[p.key];
    const to = base && swaps[base] && EXERCISES[base].subs.includes(swaps[base]) ? EXERCISES[swaps[base]] : null;
    return to ? to.name.replace("Treadmill ", "") : p.label;
  };
  const paramRow = p => p.kind === "bool" ? `
    <button class="set-row set-toggle" data-param-toggle="${p.key}" role="switch" aria-checked="${!!params[p.key]}">
      <i class="ti ${p.icon} set-ic" aria-hidden="true"></i>
      <span class="set-label">${esc(p.label)}</span>
      <span class="switch ${params[p.key] ? "on" : ""}" aria-hidden="true"><span></span></span>
    </button>` : `
    <div class="set-row">
      <i class="ti ${p.icon} set-ic" aria-hidden="true"></i>
      <label class="set-label" for="param-${p.key}">${esc(paramLabel(p))}
        <span class="set-unit">${p.kind === "time" ? "min:sec" : p.kind === "speed" ? "mph" : "count"}</span></label>
      <div class="stepper">
        <button class="step-btn" data-step="${p.key}" data-dir="-1" aria-label="Decrease ${esc(p.label)}"><i class="ti ti-minus"></i></button>
        <output class="step-val" id="param-${p.key}">${fmtParam(p, params[p.key])}</output>
        <button class="step-btn" data-step="${p.key}" data-dir="1" aria-label="Increase ${esc(p.label)}"><i class="ti ti-plus"></i></button>
      </div>
    </div>`;

  const toggle = (key, label, icon) => `
    <button class="set-row set-toggle" data-setting="${key}" role="switch" aria-checked="${state.settings[key]}">
      <i class="ti ${icon} set-ic" aria-hidden="true"></i>
      <span class="set-label">${label}</span>
      <span class="switch ${state.settings[key] ? "on" : ""}" aria-hidden="true"><span></span></span>
    </button>`;

  // Swaps: one row per swappable movement, choices as chips.
  const swapRows = swappableIds(workout).map(id => {
    const base = EXERCISES[id];
    const current = swaps[id] && base.subs.includes(swaps[id]) ? swaps[id] : id;
    const opts = [id, ...base.subs];
    return `
      <div class="swap-row">
        <div class="swap-head">
          <i class="ti ${exerciseIcon({ ...base, id })} set-ic" aria-hidden="true"></i>
          <span class="swap-name">${esc(base.name)}</span>
          ${current !== id ? `<span class="swap-now"><i class="ti ti-arrows-exchange"></i> ${esc(EXERCISES[current].name)}</span>` : ""}
        </div>
        <div class="cl-filters">${opts.map(o => `
          <button class="cl-chip ${o === current ? "active" : ""}" data-swap="${id}" data-to="${o}" aria-pressed="${o === current}">${o === id ? "Original" : esc(EXERCISES[o].name)}</button>`).join("")}
        </div>
      </div>`;
  }).join("");

  // Rounds, summarised from the compiled timeline.
  const roundRows = workout.rounds.map((_, i) => {
    const ivs = timeline.filter(iv => iv.round === i + 1);
    const moves = ivs.filter(iv => iv.type !== "REST");
    const total = ivs.reduce((a, iv) => a + planSec(iv), 0);
    const title = moves.length <= 3 ? moves.map(iv => iv.title).join(" → ") : `${moves.length} stations`;
    const detail = moves.length <= 3
      ? ivs.map(iv => `${iv.type === "REST" ? "Rest" : iv.type === "CARDIO" ? iv.state === "CARDIO" ? "Cardio" : cap(iv.state) : "Work"} ${iv.openEnded ? "reps" : fmtShort(iv.duration)}`).join(" · ")
      : moves.map(iv => iv.title).join(" · ");
    const targets = moves.map(iv => iv.target).filter(Boolean).join(" · ");
    return `
      <li class="round-row">
        <span class="round-no">${pad(i + 1)}</span>
        <div class="round-main">
          <div class="round-name">${esc(title)}</div>
          <div class="round-meta">${esc(detail)}${targets ? ` · ${esc(targets)}` : ""}</div>
        </div>
        <span class="round-time">${fmtShort(total)}</span>
      </li>`;
  }).join("");

  const bench = isBench ? benchResults(t.id) : [];
  const best = bench.reduce((a, h) => (h.bench.totalMi > (a?.bench.totalMi || 0) ? h : a), null);
  const benchBlock = isBench ? `
    <div class="section-label">Benchmark</div>
    ${bench.length ? `
      <div class="bench-best">
        <div><div class="stat-label"><i class="ti ti-trophy"></i> Best total</div><div class="stat-value">${best.bench.totalMi.toFixed(2)}<small> mi</small></div></div>
        <div><div class="stat-label">Last</div><div class="stat-value stat-value--dim">${bench[0].bench.totalMi.toFixed(2)}<small> mi</small></div></div>
        <div><div class="stat-label">Attempts</div><div class="stat-value stat-value--dim">${bench.length}</div></div>
      </div>
      <div class="cl-list">${bench.slice(0, 5).map(h => `
        <div class="bench-row"><span class="cl-meta">${fmtDate(h.date)}</span>
          <span class="bench-legs">${h.bench.legs.map(l => `${esc(l.name.replace("Treadmill ", ""))} ${l.value || "—"}${l.value ? ` ${l.unit}` : ""}`).join(" · ")}</span>
          <span class="bench-total ${h === best ? "is-best" : ""}">${h.bench.totalMi.toFixed(2)} mi</span></div>`).join("")}
      </div>` : `<p class="empty">Finish this workout and log your distances. Your best total shows here so you can beat it next time.</p>`}` : "";

  const focus = [cap(t.level), BUCKET_LABEL[timeBucket(totals.total)], ...t.focus.map(f => FOCUS_LABEL[f]),
    t.equipment.some(e => MACHINES.includes(e)) ? "Machine required" : null].filter(Boolean);

  return `
  ${topbar(`<button class="icon-btn" data-act="history" aria-label="History"><i class="ti ti-history"></i></button>`, backButton("library", "Library"))}
  <section class="hero">
    <div class="hero-daycount">${esc(t.tagline)}</div>
    <div class="hero-titlebar"><i class="ti ${CATEGORY_ICON[t.category]} hero-ic" aria-hidden="true"></i><h1 class="hero-name">${esc(t.name)}</h1></div>
    <div class="journey-track"><div class="journey-fill" style="width:100%"></div></div>
    <div class="hero-stats">
      <span><i class="ti ti-clock"></i> ${fmtClock(totals.total)}${totals.openEnded ? "+" : ""} total</span>
      ${totals.cardio ? `<span class="hero-stat-dot">·</span><span><i class="ti ti-heartbeat"></i> ${fmtClock(totals.cardio)} cardio</span>` : ""}
      ${totals.dist ? `<span class="hero-stat-dot">·</span><span>~${totals.dist.toFixed(2)} mi run</span>` : ""}
      ${totals.work ? `<span class="hero-stat-dot">·</span><span><i class="ti ti-barbell"></i> ${fmtClock(totals.work)} work</span>` : ""}
    </div>
    <p class="about">${esc(t.about)}</p>
    <div class="tag-row">${focus.map(f => `<span class="tag">${esc(f)}</span>`).join("")}
      ${t.equipment.map(e => `<span class="tag tag--equip">${esc(EQUIPMENT_LABEL[e])}</span>`).join("")}</div>
  </section>

  ${benchBlock}

  <div class="section-label">Setup</div>
  <div class="set-list">${t.params.map(paramRow).join("")}</div>
  ${Object.keys(state.params[t.id] || {}).length ? `<button class="text-btn" data-act="reset-params"><i class="ti ti-restore"></i> Reset to defaults</button>` : ""}

  ${swapRows ? `<div class="section-label section-label--row"><span>Swaps</span>${Object.keys(swaps).length ? `<button class="text-btn" data-act="reset-swaps">Reset</button>` : ""}</div>
  <div class="swap-list">${swapRows}</div>` : ""}

  <div class="section-label">Cues</div>
  <div class="set-list">
    ${toggle("sound", "Beeps", "ti-bell-ringing")}
    ${toggle("voice", "Spoken cues", "ti-microphone-2")}
    ${toggle("vibrate", "Vibration", "ti-device-mobile-vibration")}
  </div>

  <div class="section-label section-label--row"><span>Session</span><span class="cl-cat-count">${timeline.length} intervals</span></div>
  <ol class="round-list">${roundRows}</ol>

  <div class="start-dock">
    <button class="btn-primary btn-start" data-act="start"><i class="ti ti-player-play"></i> Start workout</button>
  </div>`;
}

function historyRow(h) {
  return `
    <button class="cl-row" data-history="${h.id}">
      <i class="ti ${h.bench ? "ti-trophy" : h.stats.rounds === h.stats.roundsTotal ? "ti-check" : "ti-flag"} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(h.name)}</span>
        <span class="cl-meta">${fmtDate(h.date)} · ${fmtClock(h.stats.totalSec)} · ${h.bench ? `${h.bench.totalMi.toFixed(2)} mi total` : `${h.stats.rounds}/${h.stats.roundsTotal} rounds${h.stats.distance ? ` · ${h.stats.distance.toFixed(2)} mi` : ""}`}</span></span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`;
}

function renderHistory() {
  const rows = state.history.map(historyRow).join("");
  return `
  ${topbar("", backButton("library", "Library"))}
  <section class="hero">
    <div class="hero-daycount">${state.history.length} saved</div>
    <div class="hero-titlebar"><i class="ti ti-history hero-ic"></i><h1 class="hero-name">History</h1></div>
  </section>
  ${rows ? `<div class="cl-list">${rows}</div>` : `<p class="empty">No saved workouts yet. Finish a session and tap Save Workout.</p>`}`;
}

/* Player */
function startWorkout() {
  Cues.unlock();
  const swaps = { ...swapsFor(ui.templateId) };
  const workout = createWorkout(ui.templateId, paramsFor(ui.templateId));
  const timeline = compile(workout, swaps);
  session = { workout, timeline, swaps, startedAt: Date.now() };
  engine = new IntervalEngine(timeline, { countdown: 3 });
  wireCues(engine);
  engine
    .on("countdown", () => updatePlayer())
    .on("go", () => { ui.go = true; setTimeout(() => { ui.go = false; if (ui.screen === "player") renderPlayer(); }, 700); })
    .on("interval", () => renderPlayer())
    .on("segment", () => renderPlayer())
    .on("extend", () => renderPlayer())
    .on("pause", () => renderPlayer())
    .on("resume", () => renderPlayer())
    .on("tick", () => updatePlayer())
    .on("complete", ({ early }) => finishWorkout(early));
  ui.screen = "player";
  ui.confirmEnd = false;
  render();
  WakeLock.request();
  clearInterval(driver);
  driver = setInterval(() => engine && engine.tick(), 100);
  engine.start();
}

function finishWorkout(early) {
  clearInterval(driver); driver = null;
  WakeLock.release();
  const stats = engine.stats();
  const t = templateById(session.workout.templateId);
  ui.summary = {
    id: uid(), date: session.startedAt, name: session.workout.name, templateId: t.id,
    params: session.workout.params, swaps: session.swaps, stats, early, saved: false,
    bench: t.focus.includes("benchmark") ? {
      legs: benchmarkLegs(session.timeline).map(l => ({ id: l.id, name: l.name, unit: l.unit,
        value: l.estimate && !early ? (l.unit === "m" ? Math.round(l.estimate * METERS_PER_MILE) : Number(l.estimate.toFixed(2))) : "" })),
      bikeCal: "", totalMi: 0,
    } : null,
  };
  if (ui.summary.bench) ui.summary.bench.totalMi = benchTotalMi(ui.summary.bench);
  ui.screen = "summary";
  ui.viewingHistory = false;
  ui.confirmEnd = false;
  render();
}

function toneFor(iv, seg) {
  if (iv.type === "CARDIO") return "run";
  if (iv.type === "REST") return "rest";
  if (seg && (seg.tone === "easy" || seg.tone === "rest")) return "easy";
  return "work";
}

function counterText(iv) {
  if (iv.rounds > 1) return `Round ${iv.round} of ${iv.rounds}`;
  const word = templateById(session.workout.templateId).roundWord || "Part";
  const part = iv.part || (engine.timeline.slice(engine.index).find(x => x.part)?.part ?? iv.parts);
  return `${word} ${part} of ${iv.parts}`;
}

function machineWord(iv) {
  return { run: "treadmill", "incline-walk": "treadmill", row: "rower", bike: "bike" }[iv.exId] || "";
}

function exList(exs) {
  return `<ol class="ex-list">${exs.map(x => `<li><span>${esc(x.name)}</span>${x.target ? `<em>${esc(targetText(x.target))}</em>` : ""}</li>`).join("")}</ol>`;
}

function renderPlayer() {
  if (!engine) return;
  const e = engine;
  const tl = e.timeline;

  if (e.phase === "countdown" || ui.go) {
    const first = tl[0];
    app.innerHTML = `
    <div class="player tone-${toneFor(first)} is-countdown">
      <div class="pl-top">
        <span class="pl-round">Get ready</span>
        ${soundButton()}
      </div>
      <div class="cd-wrap">
        <div class="cd-num ${ui.go ? "cd-go" : ""}" data-bind="cd">${ui.go ? "GO" : (e.lastSecond || e.countdownSec)}</div>
        <div class="cd-next">First up · <strong>${esc(first.title)}</strong>${first.speed ? ` @ ${fmtSpeed(first.speed)} MPH` : ""}</div>
      </div>
      <div class="pl-controls">
        <button class="ctl ctl-wide" data-act="skip"><i class="ti ti-player-skip-forward"></i><span>Skip countdown</span></button>
        <button class="ctl ctl-wide ctl-ghost" data-act="end"><i class="ti ti-x"></i><span>Cancel</span></button>
      </div>
    </div>`;
    return;
  }

  const iv = e.current;
  const seg = e.segment;
  const next = tl[e.index + 1];
  const tone = toneFor(iv, seg);
  const upcoming = iv.type === "REST" ? next : null;

  // Big metric line under the timer
  let metric = "";
  if (iv.type === "CARDIO") metric = iv.speed ? `${fmtSpeed(iv.speed)} ${iv.speedUnit.toUpperCase()}` : iv.effort;
  else if (iv.type === "WORK" && iv.target) metric = `Target ${iv.target}`;
  else if (iv.type === "REST" && upcoming) metric = `Next · ${upcoming.title}`;

  // Sub-interval strip (HARD / EASY, Tabata WORK / REST)
  const segStrip = iv.segments.length ? `
    <div class="seg">
      <div class="seg-label tone-${tone}" data-bind="seg-label">${esc(seg?.label || "")}</div>
      <div class="seg-meta" data-bind="seg-meta">${segMeta(iv, e.segIndex)}</div>
      <div class="seg-pips">${iv.segments.map((s, i) => `<span class="pip pip-${s.tone} ${i < e.segIndex ? "done" : i === e.segIndex ? "now" : ""}" style="flex:${s.end - s.start}"></span>`).join("")}</div>
    </div>` : "";

  const nowBlock = iv.type === "REST"
    ? `<div class="pl-row">
        <span class="pl-k">Now</span>
        <div class="pl-v"><div class="pl-name">${esc(iv.title)}</div>
          <div class="pl-instr">${!upcoming ? "Recover." : upcoming.type === "WORK" ? "Get to the station and set up."
            : machineWord(upcoming) ? `Get on the ${machineWord(upcoming)}.` : "Get ready."}</div></div>
      </div>`
    : `<div class="pl-row">
        <span class="pl-k">Now</span>
        <div class="pl-v"><div class="pl-name">${esc(iv.title)}</div>
          ${iv.instruction ? `<div class="pl-instr">${esc(iv.instruction)}</div>` : ""}
          ${iv.exercises.length > 1 ? exList(iv.exercises) : ""}
          ${iv.openEnded ? `<div class="pl-note">For reps, not speed. Tap DONE when the set is finished.</div>` : ""}
          ${iv.note ? `<div class="pl-note">${esc(iv.note)}</div>` : ""}</div>
      </div>`;

  // During rest the upcoming interval gets the spotlight.
  const nextBlock = upcoming ? `
      <div class="pl-row pl-row--up">
        <span class="pl-k">Up next</span>
        <div class="pl-v">
          <div class="pl-name pl-name--up"><i class="ti ${upcoming.icon}"></i> ${esc(upcoming.title)}</div>
          <div class="pl-instr">${esc(upcoming.instruction)}</div>
          ${upcoming.exercises.length > 1 ? exList(upcoming.exercises) : ""}
          <div class="pl-tags">${upcoming.openEnded ? "For reps" : fmtShort(upcoming.duration || 0)}${upcoming.target ? ` · Target ${esc(upcoming.target)}` : ""}${upcoming.speed ? ` · ${fmtSpeed(upcoming.speed)} MPH` : ""}${upcoming.segments.length ? ` · ${esc(upcoming.segments.map(s => s.label).slice(0, 3).join(" / "))}${upcoming.segments.length > 3 ? "…" : ""}` : ""}</div>
        </div>
      </div>`
    : `<div class="pl-row">
        <span class="pl-k">Next</span>
        <div class="pl-v"><div class="pl-name pl-name--dim">${next ? esc(nextLabel(next)) : "Finish"}</div></div>
      </div>`;

  const showDone = iv.type === "WORK" && (iv.hasTarget || iv.openEnded);
  const total = tl.reduce((a, x) => a + planSec(x), 0) || 1;
  const tickPos = i => (tl.slice(0, i).reduce((a, x) => a + planSec(x), 0) / total) * 100;
  const ticks = tl.map((x, i) => (i > 0 && (x.rounds > 1 ? x.roundStart : x.type !== "REST") ? i : null)).filter(i => i != null);

  app.innerHTML = `
  <div class="player tone-${tone} ${e.paused ? "is-paused" : ""}">
    <div class="pl-top">
      <span class="pl-round">${counterText(iv)}</span>
      <span class="pl-clock" data-bind="clock"></span>
      ${soundButton()}
    </div>
    <div class="pl-progress" aria-label="Workout progress">
      <div class="pl-progress-fill" data-bind="progress"></div>
      ${ticks.map(i => `<span class="pl-tick" style="left:${tickPos(i)}%"></span>`).join("")}
    </div>

    <div class="pl-state"><span>${e.paused ? "PAUSED" : iv.state}</span><i class="ti ${iv.icon}"></i></div>
    ${segStrip}
    <div class="pl-timer" data-bind="timer">${timerText()}</div>
    ${metric ? `<div class="pl-metric">${esc(metric)}</div>` : ""}

    <div class="pl-info">${nowBlock}${nextBlock}</div>

    <div class="pl-controls">
      <button class="ctl" data-act="prev" aria-label="Previous interval"><i class="ti ti-player-skip-back"></i><span>Prev</span></button>
      <button class="ctl ctl-main" data-act="pause" aria-label="${e.paused ? "Resume" : "Pause"}"><i class="ti ${e.paused ? "ti-player-play" : "ti-player-pause"}"></i><span>${e.paused ? "Resume" : "Pause"}</span></button>
      <button class="ctl" data-act="skip" aria-label="Skip interval"><i class="ti ti-player-skip-forward"></i><span>Skip</span></button>
    </div>
    <div class="pl-controls pl-controls--sub">
      ${iv.duration != null ? `<button class="ctl ctl-wide ${iv.type === "REST" ? "ctl-hot" : ""}" data-act="extend"><i class="ti ti-clock-plus"></i><span>+10 sec</span></button>` : ""}
      ${showDone ? `<button class="ctl ctl-wide ${iv.openEnded ? "ctl-hot" : ""}" data-act="done"><i class="ti ti-check"></i><span>${iv.openEnded ? "Done" : "Reps done"}</span></button>` : ""}
      <button class="ctl ctl-wide ctl-ghost" data-act="end"><i class="ti ti-square"></i><span>End</span></button>
    </div>
    ${ui.confirmEnd ? `
    <div class="sheet-backdrop" data-act="end-cancel"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="End workout">
      <div class="sheet-title">End workout?</div>
      <div class="sheet-text">Your progress so far will be shown on the summary.</div>
      <button class="btn-primary" data-act="end-confirm">End workout</button>
      <button class="btn-secondary" data-act="end-cancel">Keep going</button>
    </div>` : ""}
  </div>`;
  updatePlayer();
}

function nextLabel(n) {
  if (n.type === "CARDIO") return `${n.title} · ${fmtShort(n.duration)}${n.speed ? ` @ ${fmtSpeed(n.speed)} MPH` : ""}${n.roundStart && n.rounds > 1 ? ` · Round ${n.round}` : ""}`;
  if (n.type === "REST") return `${n.title === "Rest / Transition" ? "Rest" : n.title} · ${fmtShort(n.duration)}`;
  return `${n.title}${n.duration ? ` · ${fmtShort(n.duration)}` : " · for reps"}`;
}

function segMeta(iv, si) {
  const s = iv.segments[si];
  if (!s) return "";
  const sameTone = iv.segments.filter(x => x.label === s.label);
  const n = sameTone.indexOf(s) + 1;
  const nxt = iv.segments[si + 1];
  const pos = s.sets > 1 ? `Set ${s.set}/${s.sets}` : `${si + 1}/${iv.segments.length}`;
  return `${pos}${sameTone.length > 1 && s.sets === 1 ? ` · ${s.label} ${n}` : ""}${nxt ? ` · then ${nxt.label}` : " · last"}`;
}

function timerText() {
  const e = engine;
  if (e.current.duration == null) return fmtClock(e.elapsedMs() / 1000);
  // Sub-interval stations count down the current HARD/EASY (or WORK/REST) segment.
  const seg = e.segment;
  if (seg && e.segIndex < e.current.segments.length - 1) return fmtClock(Math.ceil((seg.end * 1000 - e.elapsedMs()) / 1000));
  return fmtClock(Math.ceil(e.remainingMs() / 1000));
}

function updatePlayer() {
  if (!engine || ui.screen !== "player") return;
  const e = engine;
  if (e.phase === "countdown") {
    const el = app.querySelector('[data-bind="cd"]');
    if (el && e.lastSecond != null) el.textContent = String(e.lastSecond);
    return;
  }
  if (e.phase !== "running") return;
  const timer = app.querySelector('[data-bind="timer"]');
  if (timer) {
    timer.textContent = timerText();
    const rem = e.remainingMs();
    timer.classList.toggle("is-final", rem != null && rem <= 3000 && !e.paused);
  }
  const segMetaEl = app.querySelector('[data-bind="seg-meta"]');
  if (segMetaEl) segMetaEl.textContent = `${segMeta(e.current, e.segIndex)} · ${fmtClock(Math.ceil(e.remainingMs() / 1000))} left`;
  const prog = app.querySelector('[data-bind="progress"]');
  if (prog) prog.style.width = `${(e.progress() * 100).toFixed(2)}%`;
  const clock = app.querySelector('[data-bind="clock"]');
  if (clock) {
    const doneSec = e.visits.reduce((a, v) => a + v.ms, 0) / 1000 + e.elapsedMs() / 1000;
    const total = e.timeline.reduce((a, x) => a + planSec(x), 0);
    const left = Math.max(0, total - total * e.progress());
    clock.textContent = `${fmtClock(doneSec)} · ${fmtClock(left)} left`;
  }
}

/* Summary */
function renderSummary() {
  const s = ui.summary;
  const st = s.stats;
  const cell = (label, value, icon) => `
    <div class="stat"><div class="stat-label"><i class="ti ${icon}"></i> ${label}</div><div class="stat-value">${value}</div></div>`;
  const fromHistory = ui.viewingHistory;
  const onlyRun = st.cardioSec > 0 && st.cardioSec === st.runSec;

  let benchBlock = "";
  if (s.bench) {
    const prev = benchResults(s.templateId).filter(h => h.id !== s.id);
    const best = prev.reduce((a, h) => Math.max(a, h.bench.totalMi), 0);
    const total = s.bench.totalMi;
    const delta = best && total ? total - best : 0;
    benchBlock = `
    <div class="section-label section-label--row"><span>Distances</span>${total ? `<span class="cl-cat-count">${best ? (delta > 0 ? `New best · +${delta.toFixed(2)} mi` : `Best ${best.toFixed(2)} mi`) : "First attempt"}</span>` : ""}</div>
    <div class="set-list">
      ${s.bench.legs.map((l, i) => `
        <div class="set-row">
          <i class="ti ${exerciseIcon({ id: l.id, cardio: true })} set-ic" aria-hidden="true"></i>
          <label class="set-label" for="bench-${i}">${esc(l.name)}<span class="set-unit">${l.unit === "m" ? "meters" : "miles"}</span></label>
          <input class="num-input" id="bench-${i}" data-bench="${i}" type="number" inputmode="decimal" min="0" step="${l.unit === "m" ? 10 : 0.01}"
            value="${esc(l.value)}" placeholder="0" ${fromHistory ? "disabled" : ""}>
        </div>`).join("")}
      ${s.bench.legs.some(l => l.id === "bike") ? `
        <div class="set-row">
          <i class="ti ti-flame set-ic" aria-hidden="true"></i>
          <label class="set-label" for="bench-cal">Bike calories<span class="set-unit">optional · not in total</span></label>
          <input class="num-input" id="bench-cal" data-bench-cal type="number" inputmode="numeric" min="0" step="1" value="${esc(s.bench.bikeCal)}" placeholder="0" ${fromHistory ? "disabled" : ""}>
        </div>` : ""}
      <div class="set-row bench-total-row"><span class="set-label">Total distance</span><span class="bench-sum" data-bind="bench-total">${total.toFixed(2)} mi</span></div>
    </div>`;
  }

  return `
  ${topbar(fromHistory ? backButton("history", "History") : "")}
  <section class="done-hero">
    <div class="hero-daycount">${esc(s.name)} · ${fmtDate(s.date)}</div>
    <h1 class="done-title">${s.early ? "Workout<br>ended" : "Workout<br>complete"}</h1>
    <div class="journey-track"><div class="journey-fill" style="width:${Math.round((st.rounds / (st.roundsTotal || 1)) * 100)}%"></div></div>
  </section>
  <div class="stat-grid">
    ${cell("Total time", fmtClock(st.totalSec), "ti-clock")}
    ${st.cardioSec ? cell(onlyRun ? "Run time" : "Cardio time", fmtClock(st.cardioSec), onlyRun ? "ti-run" : "ti-heartbeat") : ""}
    ${st.runSec ? cell("Est. run distance", `${st.distance.toFixed(2)}<small> mi</small>`, "ti-route") : ""}
    ${st.workSec || !st.cardioSec ? cell("Work time", fmtClock(st.workSec), "ti-barbell") : ""}
    ${st.stationsTotal ? cell("Stations", `${st.stations}<small> / ${st.stationsTotal}</small>`, "ti-target") : ""}
    ${cell(st.unit === "round" ? "Rounds" : `${templateById(s.templateId).roundWord || "Part"}s`, `${st.rounds}<small> / ${st.roundsTotal}</small>`, "ti-repeat")}
  </div>
  ${benchBlock}
  <div class="summary-actions">
    ${fromHistory
      ? `<button class="btn-primary" data-act="repeat"><i class="ti ti-repeat"></i> Repeat workout</button>
         <button class="btn-secondary" data-act="delete-history"><i class="ti ti-trash"></i> Delete</button>`
      : `<button class="btn-primary ${s.saved ? "is-saved" : ""}" data-act="save" ${s.saved ? "disabled" : ""}><i class="ti ${s.saved ? "ti-check" : "ti-device-floppy"}"></i> ${s.saved ? "Saved" : "Save workout"}</button>
         <button class="btn-secondary" data-act="repeat"><i class="ti ti-repeat"></i> Repeat workout</button>
         <button class="text-btn text-btn--center" data-act="setup">Done</button>`}
  </div>`;
}

/* ── Events ────────────────────────────────────────────────────────────────── */

app.addEventListener("input", ev => {
  const s = ui.summary;
  if (!s?.bench || s.saved) return;
  const el = ev.target;
  if (el.dataset.bench != null) s.bench.legs[Number(el.dataset.bench)].value = el.value === "" ? "" : Number(el.value);
  else if (el.dataset.benchCal != null) s.bench.bikeCal = el.value === "" ? "" : Number(el.value);
  else return;
  s.bench.totalMi = benchTotalMi(s.bench);
  const out = app.querySelector('[data-bind="bench-total"]');
  if (out) out.textContent = `${s.bench.totalMi.toFixed(2)} mi`;
});

app.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act],[data-step],[data-setting],[data-template],[data-history],[data-filter],[data-swap],[data-param-toggle]");
  if (!el) return;

  if (el.dataset.step) return stepParam(el.dataset.step, Number(el.dataset.dir));
  if (el.dataset.paramToggle) {
    const k = el.dataset.paramToggle;
    state.params[ui.templateId] = { ...(state.params[ui.templateId] || {}), [k]: !paramsFor(ui.templateId)[k] };
    save(); return render();
  }
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    state.settings[k] = !state.settings[k]; save();
    if (k === "sound" && state.settings.sound) { Cues.unlock(); Cues.beep(); }
    if (k === "voice" && state.settings.voice) { Cues.unlock(); Cues.say("Spoken cues on"); }
    if (k === "vibrate" && state.settings.vibrate) Cues.buzz(80);
    return keepScroll(render);
  }
  if (el.dataset.filter) { ui.filters[el.dataset.filter] = el.dataset.value; return keepScroll(render); }
  if (el.dataset.swap) {
    const sw = { ...swapsFor(ui.templateId) };
    if (el.dataset.to === el.dataset.swap) delete sw[el.dataset.swap]; else sw[el.dataset.swap] = el.dataset.to;
    state.swaps[ui.templateId] = sw; save();
    return keepScroll(render);
  }
  if (el.dataset.template) {
    ui.templateId = el.dataset.template; state.lastTemplate = ui.templateId; save();
    ui.screen = "setup"; return render();
  }
  if (el.dataset.history) {
    const h = state.history.find(x => x.id === el.dataset.history);
    if (h) { ui.summary = h; ui.viewingHistory = true; ui.screen = "summary"; render(); }
    return;
  }

  switch (el.dataset.act) {
    case "start": return startWorkout();
    case "pause": return engine?.toggle();
    case "skip": return engine?.next();
    case "prev": return engine?.prev();
    case "extend": return engine?.extend(10);
    case "done": return engine?.done();
    case "end":
      if (engine?.phase === "countdown") { engine.end(); return; }
      ui.confirmEnd = true; return renderPlayer();
    case "end-cancel": ui.confirmEnd = false; return renderPlayer();
    case "end-confirm": ui.confirmEnd = false; return engine?.end();
    case "toggle-audio": {
      const on = !(state.settings.sound || state.settings.voice);
      state.settings.sound = on; state.settings.voice = on; save();
      if (on) { Cues.unlock(); Cues.beep(); } else Cues.hush();
      return ui.screen === "player" ? renderPlayer() : keepScroll(render);
    }
    case "save":
      if (!ui.summary.saved) {
        ui.summary.saved = true;
        state.history.unshift({ ...ui.summary });
        state.history = state.history.slice(0, 300);
        save(); toast(ui.summary.bench?.totalMi ? `Saved · ${ui.summary.bench.totalMi.toFixed(2)} mi` : "Workout saved");
        keepScroll(render);
      }
      return;
    case "repeat":
      ui.templateId = ui.summary.templateId;
      state.params[ui.templateId] = { ...ui.summary.params };
      state.swaps[ui.templateId] = { ...(ui.summary.swaps || {}) };
      save();
      return startWorkout();
    case "delete-history":
      state.history = state.history.filter(h => h.id !== ui.summary.id); save();
      ui.screen = "history"; return render();
    case "reset-params": delete state.params[ui.templateId]; save(); return keepScroll(render);
    case "reset-swaps": delete state.swaps[ui.templateId]; save(); return keepScroll(render);
    case "clear-filters": ui.filters = { time: "all", level: "all", focus: "all", equip: "all" }; return keepScroll(render);
    case "history": ui.screen = "history"; return render();
    case "setup": engine = null; session = null; ui.screen = "setup"; return render();
    case "library": engine = null; session = null; ui.screen = "library"; return render();
  }
});

/* Re-render without jumping back to the top (toggles, chips, steppers). */
function keepScroll(fn) {
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
}

function stepParam(key, dir) {
  const t = templateById(ui.templateId);
  const p = t.params.find(x => x.key === key);
  const cur = paramsFor(t.id)[key];
  let v = Math.round((cur + dir * p.step) * 10) / 10;
  v = Math.min(p.max, Math.max(p.min, v));
  state.params[t.id] = { ...(state.params[t.id] || {}), [key]: v };
  save();
  keepScroll(render);
}

document.addEventListener("keydown", ev => {
  if (ui.screen !== "player" || !engine || ev.target.closest("input,textarea")) return;
  if (ev.code === "Space") { ev.preventDefault(); engine.toggle(); }
  else if (ev.key === "ArrowRight") engine.next();
  else if (ev.key === "ArrowLeft") engine.prev();
  else if (ev.key === "+" || ev.key === "=") engine.extend(10);
  else if (ev.key === "Escape" && ui.confirmEnd) { ui.confirmEnd = false; renderPlayer(); }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && engine && engine.phase !== "complete" && ui.screen === "player") {
    WakeLock.request();
    engine.tick();
  }
});

window.addEventListener("beforeunload", ev => {
  if (engine && (engine.phase === "running" || engine.phase === "countdown")) { ev.preventDefault(); ev.returnValue = ""; }
});

function toast(msg) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  stack.appendChild(t);
  setTimeout(() => t.classList.add("out"), 1800);
  setTimeout(() => t.remove(), 2200);
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// Exposed for testing and future workouts.
window.VYRA = { TEMPLATES, EXERCISES, IntervalEngine, compile, createWorkout, resolveSegments, swappableIds, planTotals, version: APP_VERSION };

render();
