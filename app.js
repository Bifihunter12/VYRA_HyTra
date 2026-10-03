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

const APP_VERSION = "2026.10.03.3";
const STORE_KEY = "vyra_v1";
/* Beeps, spoken cues and vibration are switched off for now. Set to true to bring them back. */
const CUES_ENABLED = false;

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
    if (!CUES_ENABLED) return;
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
    if (!CUES_ENABLED) return;
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
    if (!CUES_ENABLED) return;
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

const ALL_EQUIPMENT = Object.keys(EQUIPMENT_LABEL);
const state = loadState();
const TABS = [
  { id: "today", label: "Today", icon: "ti-home" },
  { id: "library", label: "Library", icon: "ti-books" },
  { id: "progress", label: "Progress", icon: "ti-chart-bar" },
  { id: "history", label: "History", icon: "ti-history" },
  { id: "profile", label: "Profile", icon: "ti-user" },
];
const ui = {
  screen: state.profile.onboarded ? "today" : "onboarding", tab: "today",
  templateId: state.lastTemplate || TEMPLATES[0].id, summary: null, viewingHistory: false,
  confirmEnd: false, confirm: null, go: false, calOffset: 0,
  filters: { time: "all", type: "all", level: "all" }, fitsGear: false,
  ob: { goal: 3, level: "intermediate", equipment: [...ALL_EQUIPMENT] },
};
let engine = null;
let session = null;  // { workout, timeline, swaps, startedAt }
let driver = null;

function loadState() {
  const fresh = {
    settings: { sound: true, voice: true, vibrate: true },
    profile: { onboarded: false, goal: 3, level: "intermediate", equipment: [...ALL_EQUIPMENT], warmup: true, cooldown: true },
    params: {}, swaps: {}, history: [], checkin: null, lastTemplate: null,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw);
    return { ...fresh, ...s, swaps: s.swaps || {}, settings: { ...fresh.settings, ...(s.settings || {}) },
      profile: { ...fresh.profile, ...(s.profile || {}), onboarded: s.profile?.onboarded ?? (s.history?.length > 0) } };
  } catch { return fresh; }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }

function paramsFor(templateId) {
  const t = templateById(templateId);
  return { ...defaultParams(t), ...(state.params[templateId] || {}) };
}
function swapsFor(templateId) { return state.swaps[templateId] || {}; }

/* ── Equipment: auto-swap anything the athlete doesn't own ─────────────────── */

function hasGear(e) {
  const have = state.profile.equipment;
  return (e.equipment || []).every(q => q.split("|").some(x => have.includes(x)));
}
function allExerciseIds(workout) {
  const ids = [];
  workout.rounds.forEach(r => r.blocks.forEach(b => {
    (b.type === "cardio" ? [b.id] : b.type === "station" ? b.exercises.map(e => e.id) : []).forEach(id => { if (!ids.includes(id)) ids.push(id); });
  }));
  return ids;
}
function gearPlan(templateId, workout) {
  const manual = swapsFor(templateId);
  const auto = {};
  const missing = new Set();
  const need = e => (e.equipment || []).forEach(q => { if (!q.split("|").some(x => state.profile.equipment.includes(x))) missing.add(q.split("|")[0]); });
  allExerciseIds(workout).forEach(id => {
    const base = EXERCISES[id];
    const chosen = manual[id] && (manual[id] === id || base.subs?.includes(manual[id])) ? manual[id] : null;
    if (chosen) { need(EXERCISES[chosen]); return; }
    if (hasGear(base)) return;
    const sub = (base.subs || []).find(s => hasGear(EXERCISES[s]));
    if (sub) auto[id] = sub; else need(base);
  });
  return { swaps: { ...auto, ...manual }, auto, missing: [...missing], doable: missing.size === 0 };
}

/* Planned workout for a template with the athlete's settings, gear and warm-up choice. */
function planFor(templateId) {
  const workout = createWorkout(templateId, paramsFor(templateId));
  const gear = gearPlan(templateId, workout);
  const timeline = compile(workout, gear.swaps, { warmup: state.profile.warmup, cooldown: state.profile.cooldown });
  return { workout, timeline, gear, totals: planTotals(timeline) };
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
function fmtDate(ts) { return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }).toUpperCase(); }
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
function benchResults(templateId) {
  return state.history.filter(h => h.templateId === templateId && h.bench?.totalMi > 0);
}

/* ── 5. UI ─────────────────────────────────────────────────────────────────── */

const app = document.getElementById("app");
const TAB_SCREENS = TABS.map(t => t.id);

function render() {
  document.body.dataset.screen = ui.screen;
  if (ui.screen === "player") return renderPlayer();
  const views = {
    onboarding: renderOnboarding, today: renderToday, library: renderLibrary, progress: renderProgress,
    history: renderHistory, profile: renderProfile, setup: renderSetup, summary: renderSummary,
  };
  app.innerHTML = (views[ui.screen] || renderToday)() + (TAB_SCREENS.includes(ui.screen) ? renderNav() : "");
  window.scrollTo(0, 0);
}
function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }
function go(screen) {
  if (TAB_SCREENS.includes(screen)) ui.tab = screen;
  ui.screen = screen; ui.confirm = null;
  render();
}

function renderNav() {
  return `
  <nav class="tabbar" aria-label="Main">
    ${TABS.map(t => `<button class="tab ${ui.screen === t.id ? "active" : ""}" data-go="${t.id}" ${ui.screen === t.id ? 'aria-current="page"' : ""}>
      <i class="ti ${t.icon}" aria-hidden="true"></i><span>${t.label}</span></button>`).join("")}
  </nav>`;
}

function topbar(right = "", left = "") {
  return `
  <header class="topbar">
    ${left || `<div class="brand"><span class="brand-mark">VYRA</span><span class="brand-sub">Hybrid Training</span></div>`}
    <div class="topbar-actions">${right}</div>
  </header>`;
}
const backButton = (act, label = "Back") =>
  `<button class="back-btn" data-go="${act}" aria-label="${label}"><i class="ti ti-chevron-left"></i><span>${label}</span></button>`;

function soundButton() {
  if (!CUES_ENABLED) return "";
  const on = state.settings.sound || state.settings.voice;
  return `<button class="icon-btn" data-act="toggle-audio" aria-label="${on ? "Mute audio cues" : "Turn audio cues on"}" title="Audio cues">
    <i class="ti ${on ? "ti-volume" : "ti-volume-off"}" aria-hidden="true"></i></button>`;
}
const sectionLabel = (text, right = "") => `<div class="section-label section-label--row"><span>${text}</span>${right}</div>`;
const switchRow = (attr, on, label, icon, sub = "") => `
  <button class="set-row set-toggle" ${attr} role="switch" aria-checked="${!!on}">
    <i class="ti ${icon} set-ic" aria-hidden="true"></i>
    <span class="set-label">${label}${sub ? `<span class="set-unit">${sub}</span>` : ""}</span>
    <span class="switch ${on ? "on" : ""}" aria-hidden="true"><span></span></span>
  </button>`;
const chips = (attr, options, current, multi = false) => `<div class="cl-filters">${options.map(([v, l]) => {
  const on = multi ? current.includes(v) : current === v;
  return `<button class="cl-chip ${on ? "active" : ""}" ${attr}="${v}" aria-pressed="${on}">${l}</button>`;
}).join("")}</div>`;

const EQUIP_SHORT = { treadmill: "Treadmill", rower: "Rower", bike: "Bike", kettlebell: "KB", dumbbell: "DB", "battle-ropes": "Ropes" };
const CATEGORY_ICON = { hybrid: "ti-run", "kb-db": "ti-barbell", benchmark: "ti-trophy" };

function templateMeta(t) {
  const plan = planFor(t.id);
  return { t, ...plan, bucket: timeBucket(plan.totals.main), minutes: Math.round(plan.totals.main / 60),
    machine: plan.timeline.some(iv => iv.type === "CARDIO" && machineWord(iv)), patterns: timelinePatterns(plan.timeline),
    doable: plan.gear.doable };
}

/* ── Onboarding ───────────────────────────────────────────────────────────── */
function renderOnboarding() {
  const o = ui.ob;
  const noWeights = !o.equipment.includes("dumbbell") && !o.equipment.includes("kettlebell");
  return `
  ${topbar()}
  <section class="ob">
    <h1 class="ob-title">Workouts that run themselves.</h1>
    <p class="about">Press start and VYRA tells you what to do, when to rest and what's next. Three quick questions so we can pick the right sessions for you.</p>
    <div class="ob-q">
      <div class="ob-label"><span>01</span> Workouts per week</div>
      ${chips("data-ob-goal", [2, 3, 4, 5].map(n => [n, `${n} × week`]), o.goal)}
      <p class="hint">Three is a great start. Rest days are when you get fitter.</p>
    </div>
    <div class="ob-q">
      <div class="ob-label"><span>02</span> Your level</div>
      ${chips("data-ob-level", LEVELS.map(l => [l, cap(l)]), o.level)}
    </div>
    <div class="ob-q">
      <div class="ob-label"><span>03</span> Equipment you have</div>
      ${chips("data-ob-equip", ALL_EQUIPMENT.map(e => [e, EQUIPMENT_LABEL[e]]), o.equipment, true)}
      <p class="hint ${noWeights ? "hint--warn" : ""}">${noWeights ? "Most workouts need at least one dumbbell or kettlebell." : "Missing something? VYRA swaps in an alternative automatically."}</p>
    </div>
  </section>
  <div class="start-dock"><button class="btn-primary btn-start" data-act="ob-done">Start training <i class="ti ti-arrow-right"></i></button></div>`;
}

/* ── Today ────────────────────────────────────────────────────────────────── */
function renderToday() {
  const now = Date.now();
  const goal = state.profile.goal;
  const h = state.history;
  const week = sessionsInRange(h, startOfWeek(now), startOfWeek(now) + 7 * DAY_MS);
  const streak = weekStreak(h, goal, now);
  const weekMin = Math.round(week.reduce((a, x) => a + x.stats.totalSec, 0) / 60);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const checkin = state.checkin?.day === dayKey(now) ? state.checkin.value : null;
  const metas = TEMPLATES.map(templateMeta);
  const rec = recommend({ history: h, candidates: metas, checkin, level: state.profile.level, now });
  const trainedDays = new Set(week.map(x => (new Date(x.date).getDay() + 6) % 7));
  const dots = ["M", "T", "W", "T", "F", "S", "S"].map((d, i) => {
    const isToday = i === (new Date(now).getDay() + 6) % 7;
    return `<span class="day ${trainedDays.has(i) ? "on" : ""} ${isToday ? "today" : ""}" title="${d}">${d}</span>`;
  }).join("");
  const badges = badgeStatus(h, goal);
  const nextBadge = badges.filter(b => !b.earned).sort((a, b) => b.pct - a.pct)[0];
  const last = h[0];

  const pickCard = !rec ? `<p class="empty">No workout fits your equipment yet. Add equipment in your profile.</p>`
    : rec.rest ? `
      <div class="pick pick--rest">
        <div class="pick-eyebrow"><i class="ti ti-first-aid-kit"></i> Today's advice</div>
        <div class="pick-name">${rec.title}</div>
        <p class="pick-reason">${rec.reason}</p>
        <button class="btn-secondary" data-act="start-recovery"><i class="ti ti-stretching"></i> 8-min gentle mobility</button>
      </div>`
    : `
      <div class="pick">
        <div class="pick-eyebrow"><i class="ti ti-sparkles"></i> Suggestion</div>
        <button class="pick-main" data-template="${rec.pick.t.id}">
          <span class="pick-name">${esc(rec.pick.t.name)}</span>
          <span class="pick-meta">${rec.pick.minutes} min · ${cap(rec.pick.t.level)} · ${esc(rec.pick.t.tagline)}</span>
          <span class="pick-reason"><i class="ti ti-arrow-right"></i> ${esc(rec.pick.reason)}</span>
        </button>
        ${rec.note ? `<p class="hint">${esc(rec.note)}</p>` : ""}
        <button class="btn-primary" data-act="quick-start" data-id="${rec.pick.t.id}"><i class="ti ti-player-play"></i> Start ${esc(rec.pick.t.name)}</button>
        <button class="btn-secondary" data-go="library"><i class="ti ti-books"></i> Choose from library</button>
        ${rec.alternatives.length ? `<div class="alt">Or try ${rec.alternatives.map(a => `<button class="alt-link" data-template="${a.t.id}">${esc(a.t.name)}</button>`).join(" · ")}</div>` : ""}
      </div>`;

  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">${fmtDay(now)}</div>
    <div class="hero-titlebar"><h1 class="hero-name">${greet}.</h1></div>
  </section>

  <section class="week-card" aria-label="This week">
    <div class="ring-wrap">
      ${ringSVG(week.length / goal, { size: 120, stroke: 9, label: `${week.length} of ${goal} workouts this week` })}
      <div class="ring-center"><b>${week.length}<small>/${goal}</small></b><span>this week</span></div>
    </div>
    <div class="week-side">
      <div class="streak ${streak ? "on" : ""}"><i class="ti ti-flame"></i> ${streak ? `${streak}-week streak` : "Start a streak"}</div>
      <div class="week-meta">${weekMin} min trained${week.length >= goal ? " · goal hit" : ` · ${goal - week.length} to go`}</div>
      <div class="days">${dots}</div>
    </div>
  </section>

  ${sectionLabel("How's your body today?")}
  <div class="checkin">${CHECKINS.map(c => `
    <button class="check ${checkin === c.id ? "active" : ""}" data-checkin="${c.id}" aria-pressed="${checkin === c.id}"><i class="ti ${c.icon}"></i><span>${c.label}</span></button>`).join("")}
  </div>
  ${checkin === "sore" ? `<p class="hint">Got it. The suggestion avoids heavy legs and impact.</p>` : ""}

  ${pickCard}

  ${sectionLabel("Short on time?")}
  <div class="time-pick">${["20", "30", "45"].map(b => `<button class="time-btn" data-time="${b}"><b>${b === "45" ? "45+" : b}</b><span>min</span></button>`).join("")}</div>

  ${nextBadge ? `${sectionLabel("Next badge")}
  <button class="badge-next" data-go="progress">
    <i class="ti ${nextBadge.icon}"></i>
    <span class="badge-next-main"><span class="cl-name">${nextBadge.name}</span><span class="cl-meta">${nextBadge.desc}</span>
      <span class="mini-track"><span style="width:${Math.round(nextBadge.pct * 100)}%"></span></span></span>
    <span class="badge-next-val">${Math.min(nextBadge.current, nextBadge.goal)}/${nextBadge.goal}</span>
  </button>` : ""}

  ${last ? `${sectionLabel("Last workout")}<div class="cl-list">${historyRow(last)}</div>` : ""}`;
}

/* ── Library ──────────────────────────────────────────────────────────────── */
const TYPE_FILTERS = [
  ["all", "Any"], ["low-impact", "Low impact"], ["strength-heavy", "Strength"], ["cardio-heavy", "Cardio"],
  ["minimal", "Minimal kit"], ["no-machines", "No machines"], ["benchmark", "Benchmark"],
];
function filterHits(m) {
  const f = ui.filters;
  const checks = [];
  if (f.time !== "all") checks.push(m.bucket === f.time);
  if (f.level !== "all") checks.push(m.t.level === f.level);
  if (f.type === "no-machines") checks.push(!m.machine);
  else if (f.type !== "all") checks.push(m.t.focus.includes(f.type));
  return { exact: checks.every(Boolean), score: checks.filter(Boolean).length };
}

function renderLibrary() {
  const metas = TEMPLATES.map(templateMeta).filter(m => !ui.fitsGear || m.doable);
  const hits = metas.map(m => ({ m, ...filterHits(m) }));
  const exact = hits.filter(x => x.exact).map(x => x.m);
  const closest = exact.length ? [] : hits.filter(x => x.score > 0 || true).sort((a, b) => b.score - a.score).slice(0, 4).map(x => x.m);
  const anyFilter = Object.values(ui.filters).some(v => v !== "all");
  const hidden = TEMPLATES.length - metas.length;

  const groups = CATEGORIES.map(c => {
    const items = exact.filter(m => m.t.category === c.id);
    if (!items.length) return "";
    return `<div class="cl-cat"><span class="cl-cat-name">${c.label}</span><span class="cl-cat-count">${items.length}</span></div>
      <div class="cl-list">${items.map(libraryRow).join("")}</div>`;
  }).join("");

  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">${metas.length} of ${TEMPLATES.length} workouts fit your equipment</div>
    <div class="hero-titlebar"><h1 class="hero-name">Library</h1></div>
  </section>
  <section class="filters" aria-label="Filters">
    <div class="filter-group"><span class="filter-label">Time</span>${chips("data-f-time", [["all", "Any"], ["20", "20 min"], ["30", "30 min"], ["45", "45+ min"]], ui.filters.time)}</div>
    <div class="filter-group"><span class="filter-label">Type</span>${chips("data-f-type", TYPE_FILTERS, ui.filters.type)}</div>
    <div class="filter-group"><span class="filter-label">Level</span>${chips("data-f-level", [["all", "Any"], ...LEVELS.map(l => [l, cap(l)])], ui.filters.level)}</div>
  </section>
  <div class="set-list set-list--tight">
    ${switchRow('data-act="fits-gear"', ui.fitsGear, "Only show what fits my equipment", "ti-adjustments",
      hidden ? `${hidden} hidden · edit equipment in Profile` : "Anything missing is swapped automatically")}
  </div>
  ${anyFilter ? `<button class="text-btn" data-act="clear-filters"><i class="ti ti-x"></i> Clear filters</button>` : ""}
  ${exact.length ? groups : `
    <div class="no-match"><i class="ti ti-adjustments"></i> Nothing matches all of those. Here are the closest options.</div>
    <div class="cl-list">${closest.map(libraryRow).join("")}</div>`}`;
}

function libraryRow(m) {
  const best = m.t.focus.includes("benchmark") ? benchResults(m.t.id).reduce((a, h) => Math.max(a, h.bench.totalMi), 0) : 0;
  const swapped = Object.keys(m.gear.auto).length;
  return `
    <div class="lib-row ${m.doable ? "" : "is-locked"}">
    <button class="cl-row" data-template="${m.t.id}" aria-label="${esc(m.t.name)} details">
      <i class="ti ${CATEGORY_ICON[m.t.category]} cl-ic" aria-hidden="true"></i>
      <span class="cl-main">
        <span class="cl-name">${esc(m.t.name)}</span>
        <span class="cl-sub">${esc(m.t.tagline)}</span>
        <span class="cl-meta">${m.minutes} min · ${cap(m.t.level)}${best ? ` · <b>Best ${fmtMi(best)}</b>` : ""}${!m.doable ? ` · <b>Needs ${m.gear.missing.map(e => EQUIPMENT_LABEL[e] || e).join(", ")}</b>` : swapped ? " · Adjusted for your kit" : ""}</span>
      </span>
    </button>
    <button class="row-start" data-act="quick-start" data-id="${m.t.id}" aria-label="Start ${esc(m.t.name)}"><i class="ti ti-player-play"></i><span>Start</span></button>
    </div>`;
}

/* ── Setup ────────────────────────────────────────────────────────────────── */
function renderSetup() {
  const t = templateById(ui.templateId);
  const params = paramsFor(t.id);
  const manual = swapsFor(t.id);
  const { workout, timeline, totals, gear } = planFor(t.id);
  const isBench = t.focus.includes("benchmark");

  const cardioKeys = { rowSec: "row", bikeSec: "bike", runSec: "run" };
  const paramLabel = p => {
    const base = cardioKeys[p.key];
    const to = base && gear.swaps[base] && gear.swaps[base] !== base ? EXERCISES[gear.swaps[base]] : null;
    return to ? to.name.replace("Treadmill ", "") : p.label;
  };
  const paramRow = p => p.kind === "bool" ? switchRow(`data-param-toggle="${p.key}"`, params[p.key], esc(p.label), p.icon) : `
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

  const swapRows = swappableIds(workout).map(id => {
    const base = EXERCISES[id];
    const current = gear.swaps[id] && (gear.swaps[id] === id || base.subs.includes(gear.swaps[id])) ? gear.swaps[id] : id;
    const isAuto = gear.auto[id] && !manual[id];
    return `
      <div class="swap-row">
        <div class="swap-head">
          <i class="ti ${exerciseIcon({ ...base, id })} set-ic" aria-hidden="true"></i>
          <span class="swap-name">${esc(base.name)}</span>
          ${current !== id ? `<span class="swap-now"><i class="ti ti-arrows-exchange"></i> ${esc(EXERCISES[current].name)}${isAuto ? " · auto" : ""}</span>` : ""}
        </div>
        <div class="cl-filters">${[id, ...base.subs].map(o => `
          <button class="cl-chip ${o === current ? "active" : ""} ${hasGear(EXERCISES[o]) ? "" : "cl-chip--off"}" data-swap="${id}" data-to="${o}" aria-pressed="${o === current}">${o === id ? "Original" : esc(EXERCISES[o].name)}</button>`).join("")}
        </div>
      </div>`;
  }).join("");

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
        <div class="round-main"><div class="round-name">${esc(title)}</div>
          <div class="round-meta">${esc(detail)}${targets ? ` · ${esc(targets)}` : ""}</div></div>
        <span class="round-time">${fmtShort(total)}</span>
      </li>`;
  }).join("");
  const warmRow = (phase, label) => {
    const ivs = timeline.filter(iv => iv.phase === phase);
    return ivs.length ? `<li class="round-row round-row--warm"><span class="round-no"><i class="ti ti-stretching"></i></span>
      <div class="round-main"><div class="round-name">${label}</div><div class="round-meta">${esc(ivs.map(iv => iv.title).join(" · "))}</div></div>
      <span class="round-time">${fmtShort(ivs.reduce((a, iv) => a + iv.duration, 0))}</span></li>` : "";
  };

  const bench = isBench ? benchResults(t.id) : [];
  const best = bench.reduce((a, h) => (h.bench.totalMi > (a?.bench.totalMi || 0) ? h : a), null);
  const benchBlock = isBench ? `
    ${sectionLabel("Benchmark")}
    ${bench.length ? `
      <div class="bench-best">
        <div><div class="stat-label"><i class="ti ti-trophy"></i> Best</div><div class="stat-value">${best.bench.totalMi.toFixed(2)}<small> mi</small></div></div>
        <div><div class="stat-label">Last</div><div class="stat-value stat-value--dim">${bench[0].bench.totalMi.toFixed(2)}<small> mi</small></div></div>
        <div><div class="stat-label">Attempts</div><div class="stat-value stat-value--dim">${bench.length}</div></div>
      </div>
      ${bench.length > 1 ? `<div class="spark-wrap">${sparklineSVG(bench.map(x => x.bench.totalMi).reverse())}</div>` : ""}`
      : `<p class="empty">Finish this workout and log your distances. Your best total shows here so you can beat it next time.</p>`}` : "";

  const tags = [cap(t.level), BUCKET_LABEL[timeBucket(totals.main)], ...t.focus.map(f => FOCUS_LABEL[f])];
  const autoList = Object.entries(gear.auto).filter(([id]) => !manual[id]);

  return `
  ${topbar("", backButton(ui.tab, cap(ui.tab)))}
  <section class="hero">
    <div class="hero-daycount">${esc(t.tagline)}</div>
    <div class="hero-titlebar"><i class="ti ${CATEGORY_ICON[t.category]} hero-ic" aria-hidden="true"></i><h1 class="hero-name">${esc(t.name)}</h1></div>
    <div class="journey-track"><div class="journey-fill" style="width:100%"></div></div>
    <div class="hero-stats">
      <span><i class="ti ti-clock"></i> ${fmtClock(totals.total)}${totals.openEnded ? "+" : ""}</span>
      ${totals.cardio ? `<span class="hero-stat-dot">·</span><span><i class="ti ti-heartbeat"></i> ${fmtClock(totals.cardio)} cardio</span>` : ""}
      ${totals.work ? `<span class="hero-stat-dot">·</span><span><i class="ti ti-barbell"></i> ${fmtClock(totals.work)} work</span>` : ""}
      ${totals.dist ? `<span class="hero-stat-dot">·</span><span>~${totals.dist.toFixed(2)} mi run</span>` : ""}
    </div>
    <p class="about">${esc(t.about)}</p>
    <div class="tag-row">${tags.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>
    ${!gear.doable ? `<div class="gear-note gear-note--warn"><i class="ti ti-alert-triangle"></i> Needs ${gear.missing.map(e => EQUIPMENT_LABEL[e] || e).join(", ")}. Pick a swap below, add it in Profile, or start anyway.</div>`
      : autoList.length ? `<div class="gear-note"><i class="ti ti-adjustments"></i> Adjusted for your equipment: ${autoList.map(([a, b]) => `${esc(EXERCISES[a].name)} → ${esc(EXERCISES[b].name)}`).join(", ")}</div>` : ""}
  </section>

  <button class="btn-primary btn-inline-start" data-act="start"><i class="ti ti-player-play"></i> ${gear.doable ? "Start workout" : "Start anyway"}</button>

  ${benchBlock}

  ${sectionLabel("Setup")}
  <div class="set-list">${t.params.map(paramRow).join("")}</div>
  ${Object.keys(state.params[t.id] || {}).length ? `<button class="text-btn" data-act="reset-params"><i class="ti ti-restore"></i> Reset to defaults</button>` : ""}

  ${sectionLabel("Warm-up & safety")}
  <div class="set-list">
    ${switchRow('data-profile-toggle="warmup"', state.profile.warmup, "Warm-up", "ti-stretching", "4:30 · mobility before you load up")}
    ${switchRow('data-profile-toggle="cooldown"', state.profile.cooldown, "Cool-down", "ti-yoga", "3:00 · walk and stretch")}
  </div>

  ${swapRows ? `${sectionLabel("Swaps", Object.keys(manual).length ? `<button class="text-btn" data-act="reset-swaps">Reset</button>` : "")}
  <div class="swap-list">${swapRows}</div>` : ""}

  ${sectionLabel("Session", `<span class="cl-cat-count">${timeline.length} intervals</span>`)}
  <ol class="round-list">${warmRow("warm", "Warm-up")}${roundRows}${warmRow("cool", "Cool-down")}</ol>

  <div class="start-dock">
    <button class="btn-primary btn-start" data-act="start"><i class="ti ti-player-play"></i> ${gear.doable ? "Start workout" : "Start anyway"}</button>
  </div>`;
}

/* ── Progress ─────────────────────────────────────────────────────────────── */
function renderProgress() {
  const h = state.history;
  const goal = state.profile.goal;
  if (!h.length) {
    return `
    ${topbar()}
    <section class="hero"><div class="hero-daycount">Nothing tracked yet</div><div class="hero-titlebar"><h1 class="hero-name">Progress</h1></div></section>
    <div class="empty-card">
      ${ringSVG(0, { size: 96, stroke: 8, label: "No workouts yet" })}
      <p>Every workout you finish is saved here automatically: your weekly goal, streak, training calendar, movement balance, benchmark trends and badges.</p>
      <button class="btn-primary" data-go="today"><i class="ti ti-player-play"></i> Pick today's workout</button>
      <button class="text-btn text-btn--center" data-act="sample-on">Preview with sample data</button>
    </div>`;
  }
  const now = Date.now();
  const t = totals(h);
  const weeks = weeklySeries(h, 12, now);
  const thisWeek = weeks[weeks.length - 1];
  const streak = weekStreak(h, goal, now);
  const best = bestWeekStreak(h, goal, now);
  const balance = patternBalance(h, 30, now);
  const maxBal = Math.max(...Object.values(balance), 1);
  const strength = ["squat", "hinge", "lunge", "push", "pull", "carry", "core"];
  const weakest = strength.filter(p => p !== "core").reduce((a, p) => (balance[p] < balance[a] ? p : a), "squat");
  const weakFix = TEMPLATES.find(tp => timelinePatterns(planFor(tp.id).timeline).has(weakest) && planFor(tp.id).gear.doable);
  const rated = t.rated;
  const avg = rated.length ? rated.reduce((a, x) => a + x.rating, 0) / rated.length : 0;
  const feel = { easy: 0, right: 0, hard: 0 };
  h.slice(0, 20).forEach(x => { if (x.feel in feel) feel[x.feel]++; });
  const feelTotal = feel.easy + feel.right + feel.hard;
  const badges = badgeStatus(h, goal);

  // Calendar for the selected month
  const ref = new Date(now); ref.setDate(1); ref.setMonth(ref.getMonth() + ui.calOffset);
  const year = ref.getFullYear(), month = ref.getMonth();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const byDay = {};
  h.forEach(x => { const d = new Date(x.date); if (d.getFullYear() === year && d.getMonth() === month) byDay[d.getDate()] = (byDay[d.getDate()] || 0) + x.stats.totalSec; });
  const monthCount = h.filter(x => { const d = new Date(x.date); return d.getFullYear() === year && d.getMonth() === month; }).length;
  const todayKey = dayKey(now);
  const cells = [...Array(lead).fill(""), ...Array.from({ length: daysIn }, (_, i) => i + 1)].map(d => {
    if (!d) return `<span class="cal-cell cal-cell--blank"></span>`;
    const sec = byDay[d] || 0;
    const lvl = !sec ? 0 : sec < 1500 ? 1 : sec < 2700 ? 2 : 3;
    const isToday = dayKey(new Date(year, month, d).getTime()) === todayKey;
    return `<span class="cal-cell lvl-${lvl} ${isToday ? "is-today" : ""}" title="${d} ${ref.toLocaleDateString(undefined, { month: "short" })}${sec ? ` · ${Math.round(sec / 60)} min` : ""}">${d}</span>`;
  }).join("");

  const benchBlocks = TEMPLATES.filter(tp => tp.focus.includes("benchmark")).map(tp => {
    const res = benchResults(tp.id);
    if (!res.length) return "";
    const vals = res.map(x => x.bench.totalMi).reverse();
    const bestV = Math.max(...vals);
    const delta = vals.length > 1 ? vals[vals.length - 1] - vals[0] : 0;
    return `
      <div class="bench-card">
        <div class="bench-head"><span class="cl-name">${esc(tp.name)}</span>
          <span class="cl-meta">Best <b>${bestV.toFixed(2)} mi</b>${vals.length > 1 ? ` · ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} mi since first` : ""}</span></div>
        ${sparklineSVG(vals)}
      </div>`;
  }).join("");

  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">Since ${fmtDate(h[h.length - 1].date)}${h.some(x => x.demo) ? " · includes sample data" : ""}</div>
    <div class="hero-titlebar"><h1 class="hero-name">Progress</h1></div>
  </section>

  <div class="tiles">
    <div class="tile"><span class="stat-label">Workouts</span><b>${t.sessions}</b></div>
    <div class="tile"><span class="stat-label">Time</span><b>${fmtHours(t.seconds)}</b></div>
    <div class="tile"><span class="stat-label">Run</span><b>${t.runMi.toFixed(1)}<small> mi</small></b></div>
  </div>

  ${sectionLabel("Weekly goal", `<span class="cl-cat-count">${goal} per week</span>`)}
  <div class="goal-row">
    <div class="ring-wrap ring-wrap--sm">
      ${ringSVG(thisWeek.count / goal, { size: 92, stroke: 8, label: `${thisWeek.count} of ${goal} this week` })}
      <div class="ring-center"><b>${thisWeek.count}<small>/${goal}</small></b></div>
    </div>
    <div class="goal-facts">
      <div><i class="ti ti-flame"></i> <b>${streak}</b> week streak</div>
      <div class="cl-meta">Best streak ${best} weeks · ${weeks.filter(w => w.count >= goal).length} of last 12 weeks on goal</div>
    </div>
  </div>
  <div class="chart-wrap">${weeklyBarsSVG(weeks, goal)}</div>

  ${sectionLabel("Calendar", `<span class="cal-nav"><button class="icon-btn icon-btn--sm" data-act="cal-prev" aria-label="Previous month"><i class="ti ti-chevron-left"></i></button>
    <button class="icon-btn icon-btn--sm" data-act="cal-next" aria-label="Next month" ${ui.calOffset >= 0 ? "disabled" : ""}><i class="ti ti-chevron-right"></i></button></span>`)}
  <div class="cal-title">${ref.toLocaleDateString(undefined, { month: "long", year: "numeric" })} · ${monthCount} workout${monthCount === 1 ? "" : "s"}</div>
  <div class="cal">${["M", "T", "W", "T", "F", "S", "S"].map(d => `<span class="cal-dow">${d}</span>`).join("")}${cells}</div>
  <div class="cal-legend"><span>Less</span><i class="cal-cell lvl-1"></i><i class="cal-cell lvl-2"></i><i class="cal-cell lvl-3"></i><span>More</span></div>

  ${sectionLabel("Movement balance", `<span class="cl-cat-count">Last 30 days</span>`)}
  <div class="balance">${PATTERNS.map(p => `
    <div class="bal-row ${p.id === weakest ? "is-weak" : ""}" title="${p.label}: ${Math.round(balance[p.id] / 60)} min">
      <span class="bal-label">${p.label}</span>
      <span class="bal-track"><span style="width:${(balance[p.id] / maxBal) * 100}%"></span></span>
      <span class="bal-val">${Math.round(balance[p.id] / 60)}<small> min</small></span>
    </div>`).join("")}
  </div>
  <p class="hint"><i class="ti ti-shield-check"></i> Balanced training protects your joints. Least trained lately: <b>${PATTERNS.find(p => p.id === weakest).label.toLowerCase()}</b>.${weakFix ? ` <button class="alt-link" data-template="${weakFix.id}">Try ${esc(weakFix.name)}</button>` : ""}</p>

  ${benchBlocks ? `${sectionLabel("Benchmarks")}${benchBlocks}` : ""}

  ${sectionLabel("How it felt", `<span class="cl-cat-count">${rated.length} rated</span>`)}
  <div class="felt">
    <div class="felt-avg"><b>${avg ? avg.toFixed(1) : "–"}</b>${starsSVG(Math.round(avg), { size: 16 })}<span class="cl-meta">Average rating</span></div>
    <div class="felt-split">${feelTotal ? `
      <div class="split-bar">${["easy", "right", "hard"].map(k => feel[k] ? `<span class="split-${k}" style="flex:${feel[k]}" title="${FEEL_LABEL[k]}: ${feel[k]}"></span>` : "").join("")}</div>
      <div class="split-legend">${["easy", "right", "hard"].map(k => `<span><i class="sw sw-${k}"></i>${FEEL_LABEL[k]} ${feel[k]}</span>`).join("")}</div>
      <p class="cl-meta">${feel.hard > feel.right ? "Lots of hard sessions. Add a low-impact day." : feel.easy > feel.right ? "Feeling easy? Use “make it harder” after your next session." : "Mostly just right. Good balance."}</p>`
      : `<p class="cl-meta">Rate how sessions felt to see your trend.</p>`}
    </div>
  </div>

  ${sectionLabel("Badges", `<span class="cl-cat-count">${badges.filter(b => b.earned).length} / ${badges.length}</span>`)}
  <div class="badges">${badges.map(b => `
    <div class="badge ${b.earned ? "earned" : ""}" title="${esc(b.desc)}">
      <i class="ti ${b.earned ? b.icon : "ti-lock"}"></i>
      <span class="badge-name">${b.name}</span>
      <span class="badge-desc">${b.desc}</span>
      ${b.earned ? "" : `<span class="mini-track"><span style="width:${Math.round(b.pct * 100)}%"></span></span>`}
    </div>`).join("")}
  </div>`;
}

/* ── History ──────────────────────────────────────────────────────────────── */
function historyRow(h) {
  return `
    <button class="cl-row" data-history="${h.id}">
      <i class="ti ${h.bench ? "ti-trophy" : h.early ? "ti-flag" : "ti-check"} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(h.name)}${h.demo ? ` <span class="tag tag--sample">Sample</span>` : ""}</span>
        <span class="cl-meta">${fmtDay(h.date)} · ${fmtClock(h.stats.totalSec)}${h.bench ? ` · ${h.bench.totalMi.toFixed(2)} mi` : h.stats.distance ? ` · ${h.stats.distance.toFixed(2)} mi` : ""}</span>
        ${h.rating ? starsSVG(h.rating, { size: 13 }) : ""}</span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`;
}

function renderHistory() {
  const months = [];
  state.history.forEach(h => {
    const d = new Date(h.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let m = months.find(x => x.key === key);
    if (!m) months.push(m = { key, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), items: [] });
    m.items.push(h);
  });
  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">${state.history.length} workouts saved</div>
    <div class="hero-titlebar"><h1 class="hero-name">History</h1></div>
  </section>
  ${months.length ? months.map(m => `
    <div class="cl-cat"><span class="cl-cat-name">${m.label}</span>
      <span class="cl-cat-count">${m.items.length} · ${fmtHours(m.items.reduce((a, x) => a + x.stats.totalSec, 0))}</span></div>
    <div class="cl-list">${m.items.map(historyRow).join("")}</div>`).join("")
    : `<p class="empty">Finished workouts are saved here automatically, with your rating and how it felt.</p>`}`;
}

/* ── Profile ──────────────────────────────────────────────────────────────── */
function renderProfile() {
  const p = state.profile;
  const hasSample = state.history.some(h => h.demo);
  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">${cap(p.level)} · ${p.goal} workouts a week</div>
    <div class="hero-titlebar"><h1 class="hero-name">Profile</h1></div>
  </section>

  ${sectionLabel("Weekly goal")}
  <div class="set-list"><div class="set-row">
    <i class="ti ti-target set-ic" aria-hidden="true"></i>
    <span class="set-label">Workouts per week<span class="set-unit">drives your ring and streak</span></span>
    <div class="stepper">
      <button class="step-btn" data-goal="-1" aria-label="Fewer workouts per week"><i class="ti ti-minus"></i></button>
      <output class="step-val">${p.goal}</output>
      <button class="step-btn" data-goal="1" aria-label="More workouts per week"><i class="ti ti-plus"></i></button>
    </div>
  </div></div>

  ${sectionLabel("Level")}
  <div class="pad-y">${chips("data-p-level", LEVELS.map(l => [l, cap(l)]), p.level)}</div>

  ${sectionLabel("My equipment")}
  <div class="pad-y">${chips("data-p-equip", ALL_EQUIPMENT.map(e => [e, EQUIPMENT_LABEL[e]]), p.equipment, true)}
    <p class="hint">Workouts swap in alternatives for anything you don't have.</p></div>

  ${sectionLabel("Safety")}
  <div class="set-list">
    ${switchRow('data-profile-toggle="warmup"', p.warmup, "Warm-up before every workout", "ti-stretching", "4:30 of mobility")}
    ${switchRow('data-profile-toggle="cooldown"', p.cooldown, "Cool-down after every workout", "ti-yoga", "3:00 walk and stretch")}
  </div>

  ${CUES_ENABLED ? `${sectionLabel("Cues")}
  <div class="set-list">
    ${switchRow('data-setting="sound"', state.settings.sound, "Beeps", "ti-bell-ringing")}
    ${switchRow('data-setting="voice"', state.settings.voice, "Spoken cues", "ti-microphone-2")}
    ${switchRow('data-setting="vibrate"', state.settings.vibrate, "Vibration", "ti-device-mobile-vibration")}
  </div>` : ""}

  ${sectionLabel("Data")}
  <div class="set-list">
    <button class="set-row" data-act="${hasSample ? "sample-off" : "sample-on"}">
      <i class="ti ti-sparkles set-ic"></i><span class="set-label">${hasSample ? "Remove sample data" : "Load sample data"}
      <span class="set-unit">${hasSample ? "keeps your real workouts" : "6 weeks of example workouts to preview Progress"}</span></span></button>
    <button class="set-row set-row--danger" data-act="erase">
      <i class="ti ti-trash set-ic"></i><span class="set-label">${ui.confirm === "erase" ? "Tap again to erase everything" : "Erase all data"}
      <span class="set-unit">history, settings and benchmarks on this device</span></span></button>
  </div>
  <p class="hint"><a href="privacy.html">Privacy</a> · Everything stays on this device. VYRA ${APP_VERSION}</p>`;
}

/* ── Player ───────────────────────────────────────────────────────────────── */
function startWorkout(templateId = ui.templateId, custom = null) {
  Cues.unlock();
  ui.templateId = templateId;
  let workout, timeline, swaps;
  if (custom) ({ workout, timeline, swaps } = custom);
  else {
    const plan = planFor(templateId);
    ({ workout, timeline } = plan); swaps = plan.gear.swaps;
  }
  ui.returnTo = ui.screen === "summary" ? ui.tab : ui.screen;
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

function recoveryWorkout() {
  const workout = { id: uid(), templateId: "recovery", name: "Gentle Mobility", params: {}, rounds: [] };
  const timeline = compile(workout, {}, { warmup: true, cooldown: true });
  timeline.forEach(iv => { iv.state = "MOBILITY"; iv.say = iv.cue + "."; });
  return { workout, timeline, swaps: {} };
}

function finishWorkout(early) {
  clearInterval(driver); driver = null;
  WakeLock.release();
  const stats = engine.stats();
  // Cancelled before anything happened: go back to where the athlete started.
  if (early && stats.totalSec < 5) { engine = null; session = null; return go(ui.returnTo || "library"); }
  const t = TEMPLATES.find(x => x.id === session.workout.templateId);
  const before = new Set(badgeStatus(state.history, state.profile.goal).filter(b => b.earned).map(b => b.id));
  const rec = {
    id: uid(), date: session.startedAt, name: session.workout.name, templateId: session.workout.templateId,
    params: session.workout.params, swaps: session.swaps, stats, early,
    patterns: visitPatterns(session.timeline, engine.visits), rating: 0, feel: null,
    bench: t?.focus.includes("benchmark") ? {
      legs: benchmarkLegs(session.timeline).map(l => ({ id: l.id, name: l.name, unit: l.unit,
        value: l.estimate && !early ? Number(l.estimate.toFixed(2)) : "" })),
      bikeCal: "", totalMi: 0,
    } : null,
  };
  if (rec.bench) rec.bench.totalMi = benchTotalMi(rec.bench);
  // Anything shorter than a minute is a mis-tap, not a workout.
  rec.saved = stats.totalSec >= 60;
  if (rec.saved) { state.history.unshift(rec); state.history = state.history.slice(0, 500); save(); }
  rec.newBadges = rec.saved ? badgeStatus(state.history, state.profile.goal).filter(b => b.earned && !before.has(b.id)).map(b => b.id) : [];
  ui.summary = rec;
  ui.screen = "summary";
  ui.viewingHistory = false;
  ui.confirmEnd = false; ui.confirm = null;
  render();
}

function toneFor(iv, seg) {
  if (iv.type === "CARDIO") return "run";
  if (iv.type === "REST") return "rest";
  if (iv.type === "WARM") return "warm";
  if (seg && (seg.tone === "easy" || seg.tone === "rest")) return "easy";
  return "work";
}

function counterText(iv) {
  if (iv.type === "WARM") return iv.phase === "warm" ? "Warm-up" : "Cool-down";
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

/* Player screen */
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

/* ── Summary ──────────────────────────────────────────────────────────────── */
const FEEL_LABEL = { easy: "Too easy", right: "Just right", hard: "Too hard" };

function renderSummary() {
  const s = ui.summary;
  const st = s.stats;
  const cell = (label, value, icon) => `
    <div class="stat"><div class="stat-label"><i class="ti ${icon}"></i> ${label}</div><div class="stat-value">${value}</div></div>`;
  const fromHistory = ui.viewingHistory;
  const onlyRun = st.cardioSec > 0 && st.cardioSec === st.runSec;
  const t = TEMPLATES.find(x => x.id === s.templateId);
  const pct = st.intervalsTotal ? st.intervalsDone / st.intervalsTotal : s.early ? 0.5 : 1;
  const advice = t && !fromHistory ? progressionAdvice(t, paramsFor(t.id), s.feel) : null;

  let benchBlock = "";
  if (s.bench) {
    const prev = benchResults(s.templateId).filter(h => h.id !== s.id);
    const best = prev.reduce((a, h) => Math.max(a, h.bench.totalMi), 0);
    const total = s.bench.totalMi;
    const delta = best && total ? total - best : 0;
    benchBlock = `
    ${sectionLabel("Distances", total ? `<span class="cl-cat-count" data-bind="bench-status">${best ? (delta > 0 ? `New best · +${delta.toFixed(2)} mi` : `Best ${best.toFixed(2)} mi`) : "First attempt"}</span>` : "")}
    <div class="set-list">
      ${s.bench.legs.map((l, i) => `
        <div class="set-row">
          <i class="ti ${exerciseIcon({ id: l.id, cardio: true })} set-ic" aria-hidden="true"></i>
          <label class="set-label" for="bench-${i}">${esc(l.name)}<span class="set-unit">${l.unit === "m" ? "meters" : "miles"}</span></label>
          <input class="num-input" id="bench-${i}" data-bench="${i}" type="number" inputmode="decimal" min="0" step="${l.unit === "m" ? 10 : 0.01}" value="${esc(l.value)}" placeholder="0">
        </div>`).join("")}
      ${s.bench.legs.some(l => l.id === "bike") ? `
        <div class="set-row">
          <i class="ti ti-flame set-ic" aria-hidden="true"></i>
          <label class="set-label" for="bench-cal">Bike calories<span class="set-unit">optional · not in total</span></label>
          <input class="num-input" id="bench-cal" data-bench-cal type="number" inputmode="numeric" min="0" step="1" value="${esc(s.bench.bikeCal)}" placeholder="0">
        </div>` : ""}
      <div class="set-row bench-total-row"><span class="set-label">Total distance</span><span class="bench-sum" data-bind="bench-total">${total.toFixed(2)} mi</span></div>
    </div>`;
  }

  const newBadges = (s.newBadges || []).map(id => BADGES.find(b => b.id === id)).filter(Boolean);

  return `
  ${topbar("", fromHistory ? backButton("history", "History") : "")}
  <section class="done-hero">
    <div class="hero-daycount">${esc(s.name)} · ${fmtDate(s.date)}${s.demo ? " · sample" : ""}</div>
    <div class="done-top">
      <h1 class="done-title">${s.early ? "Workout<br>ended" : "Workout<br>complete"}</h1>
      <div class="ring-wrap ring-wrap--sm">
        ${ringSVG(pct, { size: 96, stroke: 8, label: `${Math.round(pct * 100)}% completed` })}
        <div class="ring-center"><b>${Math.round(pct * 100)}<small>%</small></b><span>done</span></div>
      </div>
    </div>
    ${!s.saved && !fromHistory ? `<p class="hint">Less than a minute, so this one wasn't saved.</p>` : ""}
  </section>

  ${newBadges.length ? `<div class="new-badges">${newBadges.map(b => `
    <div class="new-badge"><i class="ti ${b.icon}"></i><span><b>Badge unlocked · ${b.name}</b><span class="cl-meta">${b.desc}</span></span></div>`).join("")}</div>` : ""}

  <div class="stat-grid">
    ${cell("Total time", fmtClock(st.totalSec), "ti-clock")}
    ${st.cardioSec ? cell(onlyRun ? "Run time" : "Cardio time", fmtClock(st.cardioSec), onlyRun ? "ti-run" : "ti-heartbeat") : ""}
    ${st.runSec ? cell("Est. run distance", `${st.distance.toFixed(2)}<small> mi</small>`, "ti-route") : ""}
    ${st.workSec || !st.cardioSec ? cell("Work time", fmtClock(st.workSec), "ti-barbell") : ""}
    ${st.stationsTotal ? cell("Stations", `${st.stations}<small> / ${st.stationsTotal}</small>`, "ti-target") : ""}
    ${st.roundsTotal ? cell(st.unit === "round" ? "Rounds" : `${(t && t.roundWord) || "Part"}s`, `${st.rounds}<small> / ${st.roundsTotal}</small>`, "ti-repeat") : ""}
  </div>

  ${s.saved ? `
  ${sectionLabel("Rate this workout")}
  <div class="rate">${starsSVG(s.rating || 0, { size: 34, act: "rate" })}<span class="cl-meta">${["Tap to rate", "Not for me", "Meh", "Good", "Great", "Loved it"][s.rating || 0]}</span></div>

  ${sectionLabel("How did it feel?")}
  <div class="feel">${Object.entries(FEEL_LABEL).map(([k, l]) => `
    <button class="check ${s.feel === k ? "active" : ""}" data-feel="${k}" aria-pressed="${s.feel === k}"><span>${l}</span></button>`).join("")}</div>
  ${advice ? `
    <div class="advice">
      <div><b>${advice.title}</b><span class="cl-meta">${esc(advice.text)}</span></div>
      <button class="btn-secondary btn-sm ${s.applied ? "is-done" : ""}" data-act="apply-advice" ${s.applied ? "disabled" : ""}>${s.applied ? '<i class="ti ti-check"></i> Applied' : "Apply"}</button>
    </div>` : s.feel === "hard" ? `<p class="hint"><i class="ti ti-shield-check"></i> Hard is fine now and then. Keep tomorrow easy and sleep well.</p>` : ""}` : ""}

  ${benchBlock}

  <div class="summary-actions">
    ${fromHistory
      ? `<button class="btn-primary" data-act="repeat"><i class="ti ti-repeat"></i> Repeat workout</button>
         <button class="btn-secondary" data-act="delete-history"><i class="ti ti-trash"></i> ${ui.confirm === "delete" ? "Tap again to delete" : "Delete"}</button>`
      : `<button class="btn-primary" data-go="today"><i class="ti ti-check"></i> ${s.saved ? "Saved · Done" : "Done"}</button>
         <button class="btn-secondary" data-act="repeat"><i class="ti ti-repeat"></i> Repeat workout</button>
         ${s.saved ? `<button class="text-btn text-btn--center" data-act="delete-history">${ui.confirm === "delete" ? "Tap again to discard" : "Discard this workout"}</button>` : ""}`}
  </div>`;
}

/* ── Sample data (clearly marked, removable) ──────────────────────────────── */
function sampleHistory() {
  const ids = ["vyra-8", "engine-builder", "the-forge", "tri-15", "carry-me-home", "db-destroyer", "sprint-20", "tri-15", "bike-bells", "gauntlet"];
  const out = [];
  const now = Date.now();
  let triMi = 2.6;
  for (let d = 41; d >= 1; d--) {
    const dow = new Date(now - d * DAY_MS).getDay();
    if (![1, 3, 5, 6].includes(dow) || (d % 9 === 0)) continue;
    const id = ids[out.length % ids.length];
    const workout = createWorkout(id, {});
    const timeline = compile(workout, {}, { warmup: true, cooldown: false });
    const visits = timeline.map((iv, i) => ({ index: i, type: iv.type, round: iv.round, ms: planSec(iv) * 1000, outcome: "complete" }));
    const e = new IntervalEngine(timeline); e.visits = visits;
    const stats = e.stats();
    const date = startOfDay(now - d * DAY_MS) + 18 * 3600000;
    const rec = { id: uid(), demo: true, date, name: workout.name, templateId: id, params: workout.params, swaps: {}, stats, early: false,
      patterns: visitPatterns(timeline, visits), rating: 3 + (out.length % 3), feel: ["right", "right", "hard", "easy"][out.length % 4], saved: true, bench: null };
    if (id === "tri-15") {
      triMi += 0.12;
      rec.bench = { legs: [{ id: "row", name: "Row", unit: "m", value: Math.round(1150 + triMi * 20) }, { id: "bike", name: "Bike", unit: "mi", value: 1.45 + (triMi - 2.6) / 2 },
        { id: "run", name: "Treadmill Run", unit: "mi", value: 0.58 }], bikeCal: "", totalMi: 0 };
      rec.bench.totalMi = benchTotalMi(rec.bench);
    }
    out.unshift(rec);
  }
  return out;
}

/* ── Events ────────────────────────────────────────────────────────────────── */

app.addEventListener("input", ev => {
  const s = ui.summary;
  if (!s?.bench) return;
  const el = ev.target;
  if (el.dataset.bench != null) s.bench.legs[Number(el.dataset.bench)].value = el.value === "" ? "" : Number(el.value);
  else if (el.dataset.benchCal != null) s.bench.bikeCal = el.value === "" ? "" : Number(el.value);
  else return;
  s.bench.totalMi = benchTotalMi(s.bench);
  save();
  const out = app.querySelector('[data-bind="bench-total"]');
  if (out) out.textContent = `${s.bench.totalMi.toFixed(2)} mi`;
});

app.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act],[data-go],[data-step],[data-setting],[data-template],[data-history],[data-swap],[data-param-toggle],[data-profile-toggle],[data-checkin],[data-time],[data-feel],[data-goal],[data-p-level],[data-p-equip],[data-ob-goal],[data-ob-level],[data-ob-equip],[data-f-time],[data-f-type],[data-f-level]");
  if (!el) return;
  const d = el.dataset;
  if (d.act !== "erase" && d.act !== "delete-history") ui.confirm = null;

  if (d.go) return go(d.go);
  if (d.step) return stepParam(d.step, Number(d.dir));
  if (d.paramToggle) {
    state.params[ui.templateId] = { ...(state.params[ui.templateId] || {}), [d.paramToggle]: !paramsFor(ui.templateId)[d.paramToggle] };
    save(); return rerender();
  }
  if (d.profileToggle) { state.profile[d.profileToggle] = !state.profile[d.profileToggle]; save(); return rerender(); }
  if (d.setting) {
    const k = d.setting;
    state.settings[k] = !state.settings[k]; save();
    if (k === "sound" && state.settings.sound) { Cues.unlock(); Cues.beep(); }
    if (k === "voice" && state.settings.voice) { Cues.unlock(); Cues.say("Spoken cues on"); }
    if (k === "vibrate" && state.settings.vibrate) Cues.buzz(80);
    return rerender();
  }
  if (d.fTime) { ui.filters.time = d.fTime; return rerender(); }
  if (d.fType) { ui.filters.type = d.fType; return rerender(); }
  if (d.fLevel) { ui.filters.level = d.fLevel; return rerender(); }
  if (d.time) { ui.filters = { time: d.time, type: "all", level: "all" }; return go("library"); }
  if (d.checkin) { state.checkin = { day: dayKey(Date.now()), value: d.checkin }; save(); return rerender(); }
  if (d.obGoal) { ui.ob.goal = Number(d.obGoal); return rerender(); }
  if (d.obLevel) { ui.ob.level = d.obLevel; return rerender(); }
  if (d.obEquip) { toggleIn(ui.ob.equipment, d.obEquip); return rerender(); }
  if (d.pLevel) { state.profile.level = d.pLevel; save(); return rerender(); }
  if (d.pEquip) { toggleIn(state.profile.equipment, d.pEquip); save(); return rerender(); }
  if (d.goal) { state.profile.goal = Math.min(7, Math.max(1, state.profile.goal + Number(d.goal))); save(); return rerender(); }
  if (d.feel) {
    ui.summary.feel = ui.summary.feel === d.feel ? null : d.feel; ui.summary.applied = false;
    save(); return rerender();
  }
  if (d.swap) {
    const sw = { ...swapsFor(ui.templateId), [d.swap]: d.to };
    state.swaps[ui.templateId] = sw; save();
    return rerender();
  }
  if (d.template) {
    ui.templateId = d.template; state.lastTemplate = ui.templateId; save();
    ui.screen = "setup"; return render();
  }
  if (d.history) {
    const h = state.history.find(x => x.id === d.history);
    if (h) { ui.summary = h; ui.viewingHistory = true; ui.screen = "summary"; render(); }
    return;
  }

  switch (d.act) {
    case "start": return startWorkout();
    case "quick-start": return startWorkout(d.id);
    case "start-recovery": return startWorkout("recovery", recoveryWorkout());
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
      return ui.screen === "player" ? renderPlayer() : rerender();
    }
    case "rate": {
      const v = Number(d.value);
      ui.summary.rating = ui.summary.rating === v ? 0 : v; save();
      return rerender();
    }
    case "apply-advice": {
      const t = templateById(ui.summary.templateId);
      const a = progressionAdvice(t, paramsFor(t.id), ui.summary.feel);
      if (a) { state.params[t.id] = { ...(state.params[t.id] || {}), [a.key]: a.value }; ui.summary.applied = true; save(); toast("Saved for next time"); }
      return rerender();
    }
    case "repeat": {
      const s = ui.summary;
      if (s.templateId === "recovery") return startWorkout("recovery", recoveryWorkout());
      state.params[s.templateId] = { ...(state.params[s.templateId] || {}), ...s.params };
      if (s.swaps) state.swaps[s.templateId] = { ...s.swaps };
      save();
      return startWorkout(s.templateId);
    }
    case "delete-history":
      if (ui.confirm !== "delete") { ui.confirm = "delete"; return rerender(); }
      state.history = state.history.filter(h => h.id !== ui.summary.id); save();
      ui.confirm = null;
      return go(ui.viewingHistory ? "history" : "today");
    case "erase":
      if (ui.confirm !== "erase") { ui.confirm = "erase"; return rerender(); }
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      Object.assign(state, loadState());
      ui.confirm = null; ui.ob = { goal: 3, level: "intermediate", equipment: [...ALL_EQUIPMENT] };
      return go("onboarding");
    case "sample-on":
      state.history = [...state.history.filter(h => !h.demo), ...sampleHistory()].sort((a, b) => b.date - a.date);
      save(); toast("Sample data loaded"); return go("progress");
    case "sample-off":
      state.history = state.history.filter(h => !h.demo); save(); toast("Sample data removed"); return rerender();
    case "ob-done":
      Object.assign(state.profile, { goal: ui.ob.goal, level: ui.ob.level, equipment: [...ui.ob.equipment], onboarded: true });
      save(); return go("today");
    case "fits-gear": ui.fitsGear = !ui.fitsGear; return rerender();
    case "reset-params": delete state.params[ui.templateId]; save(); return rerender();
    case "reset-swaps": delete state.swaps[ui.templateId]; save(); return rerender();
    case "clear-filters": ui.filters = { time: "all", type: "all", level: "all" }; return rerender();
    case "cal-prev": ui.calOffset--; return rerender();
    case "cal-next": ui.calOffset = Math.min(0, ui.calOffset + 1); return rerender();
  }
});

function toggleIn(list, v) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v); }

function stepParam(key, dir) {
  const t = templateById(ui.templateId);
  const p = t.params.find(x => x.key === key);
  const cur = paramsFor(t.id)[key];
  let v = Math.round((cur + dir * p.step) * 10) / 10;
  v = Math.min(p.max, Math.max(p.min, v));
  state.params[t.id] = { ...(state.params[t.id] || {}), [key]: v };
  save();
  rerender();
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
window.VYRA = { TEMPLATES, EXERCISES, IntervalEngine, compile, createWorkout, resolveSegments, swappableIds, planTotals, planFor, recommend, version: APP_VERSION };

render();
