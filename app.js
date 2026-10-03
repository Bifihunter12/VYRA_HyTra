"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Hybrid workout player
   The workout and the timer are one experience: press START and VYRA tells the
   athlete what to do, for how long, when to rest and what is coming next.

   Layers (top to bottom):
     1. Workout data model   — templates → workouts → rounds → blocks → exercises
     2. Compiler             — workout → flat timeline of intervals (+ sub-intervals)
     3. IntervalEngine       — generic, DOM-free timer that runs any timeline
     4. Cues                 — beeps, speech, vibration driven by engine events
     5. UI                   — setup, player, summary, history screens
   ════════════════════════════════════════════════════════════════════════════ */

const APP_VERSION = "2026.10.03.1";
const STORE_KEY = "vyra_v1";

/* ── 1. Workout data model ─────────────────────────────────────────────────────
   Workout   { id, name, templateId, params, rounds: Round[] }
   Round     { label?, blocks: Block[] }
   Block     one of
     { type:"run",     duration, speed, speedUnit }
     { type:"rest",    duration, label? }
     { type:"station", duration?, name, cue?, instruction?, note?,
                       exercises: Exercise[], segments?: SegmentSpec }
               duration null/omitted + no segments → open-ended (counts up, athlete taps DONE)
   Exercise  { name, cue?, measure, target? }
     measure: "time"      timed exercise (work the whole interval)
              "reps"      rep-based exercise (no clock target)
              "distance"  distance exercise
              "time+reps" timed exercise with a rep target
     target:  { reps?: number | [min,max], approx?, perSide?, label?, distance?, unit? }
   A station with >1 exercise is a multi-exercise station.
   SegmentSpec { pattern: [{ label, tone:"hard"|"easy"|"work"|"rest", duration? | share? }], repeat? }
     duration = absolute seconds (e.g. Tabata 20/10); share = relative weight that
     scales to the station duration (e.g. battle ropes HARD/EASY/HARD = 1/1/1).
   ─────────────────────────────────────────────────────────────────────────── */

const HYBRID_STATIONS = [
  {
    name: "Battle Ropes", cue: "Battle ropes", icon: "ti-wave-sine",
    instruction: "Fast alternating waves on HARD. Slow, steady waves on EASY — keep the ropes moving.",
    exercises: [{ name: "Battle ropes", measure: "time" }],
    segments: { pattern: [
      { label: "HARD", tone: "hard", share: 1 },
      { label: "EASY", tone: "easy", share: 1 },
      { label: "HARD", tone: "hard", share: 1 },
    ] },
  },
  {
    name: "Heavy Goblet Squats", cue: "Goblet squats", icon: "ti-barbell",
    instruction: "Hold one heavy dumbbell at your chest. Sit deep, chest up, drive through your heels.",
    note: "Stop when the reps are done, or keep going until the timer ends.",
    exercises: [{ name: "Goblet squat", measure: "time+reps", target: { reps: 20, approx: true } }],
  },
  {
    name: "Farmer Carry", cue: "Farmer carry", icon: "ti-weight",
    instruction: "Heavy dumbbells or kettlebells. Stand tall, shoulders down, short quick steps.",
    exercises: [{ name: "Farmer carry", measure: "time" }],
  },
  {
    name: "Upper Body", cue: "Upper body. Floor press and rows", icon: "ti-barbell",
    instruction: "Dumbbell floor press, then one-arm dumbbell rows.",
    note: "Or keep working for the full interval.",
    exercises: [
      { name: "DB floor press", measure: "time+reps", target: { reps: 15, label: "presses" } },
      { name: "One-arm DB row", measure: "time+reps", target: { reps: 12, perSide: true, label: "rows" } },
    ],
  },
  {
    name: "Reverse Lunges", cue: "Reverse lunges", icon: "ti-stairs",
    instruction: "Step back, lower the back knee toward the floor, alternate legs.",
    exercises: [{ name: "Reverse lunge", measure: "time+reps", target: { reps: 20, approx: true, label: "total" } }],
  },
  {
    name: "RDL + Shoulder Press", cue: "R D L and shoulder press", icon: "ti-barbell",
    instruction: "Romanian deadlifts first — hinge, flat back. Then strict shoulder presses.",
    exercises: [
      { name: "Romanian deadlift", measure: "time+reps", target: { reps: 15, label: "RDLs" } },
      { name: "Shoulder press", measure: "time+reps", target: { reps: [10, 12], label: "presses" } },
    ],
  },
  {
    name: "Suitcase Carry + Core", cue: "Suitcase carry and core", icon: "ti-briefcase",
    instruction: "One heavy weight at your side, alternate sides. Then transition into standing knee drives or dead bugs.",
    exercises: [
      { name: "Suitcase carry", measure: "time" },
      { name: "Knee drives / dead bugs", measure: "time" },
    ],
  },
  {
    name: "Final Full-Body Station", cue: "Final full body station", icon: "ti-flame",
    instruction: "Goblet squats → DB rows → DB presses → battle ropes. Keep moving until the timer ends.",
    exercises: [
      { name: "Goblet squats", measure: "time" },
      { name: "DB rows", measure: "time" },
      { name: "DB presses", measure: "time" },
      { name: "Battle ropes", measure: "time" },
    ],
  },
];

const TEMPLATES = [
  {
    id: "hybrid-8",
    name: "Hybrid Engine",
    meta: "Run · Strength · 8 rounds",
    icon: "ti-run",
    params: [
      { key: "runSec",     label: "Run",              icon: "ti-run",       kind: "time",  min: 15, max: 600, step: 15, default: 60 },
      { key: "speed",      label: "Treadmill speed",  icon: "ti-gauge",     kind: "speed", min: 2,  max: 15,  step: 0.1, default: 7.0 },
      { key: "restSec",    label: "Rest / transition",icon: "ti-clock-pause", kind: "time", min: 0, max: 180, step: 5,  default: 30 },
      { key: "stationSec", label: "Strength station", icon: "ti-barbell",   kind: "time",  min: 15, max: 300, step: 15, default: 60 },
    ],
    build(p) {
      return {
        name: this.name,
        rounds: HYBRID_STATIONS.map((st, i) => {
          const last = i === HYBRID_STATIONS.length - 1;
          return {
            label: st.name,
            icon: st.icon,
            blocks: [
              { type: "run", duration: p.runSec, speed: p.speed, speedUnit: "mph" },
              p.restSec > 0 && { type: "rest", duration: p.restSec },
              { type: "station", duration: p.stationSec, ...st },
              !last && p.restSec > 0 && { type: "rest", duration: p.restSec },
            ].filter(Boolean),
          };
        }),
      };
    },
  },
  {
    id: "tabata",
    name: "Tabata",
    meta: "20 / 10 intervals",
    icon: "ti-bolt",
    params: [
      { key: "workSec",   label: "Work",              icon: "ti-bolt",        kind: "time",  min: 5,  max: 120, step: 5,  default: 20 },
      { key: "restSec",   label: "Rest",              icon: "ti-clock-pause", kind: "time",  min: 5,  max: 120, step: 5,  default: 10 },
      { key: "sets",      label: "Sets per block",    icon: "ti-repeat",      kind: "count", min: 1,  max: 20,  step: 1,  default: 8 },
      { key: "blocks",    label: "Blocks",            icon: "ti-stack-2",     kind: "count", min: 1,  max: 10,  step: 1,  default: 4 },
      { key: "blockRest", label: "Rest between blocks", icon: "ti-clock",     kind: "time",  min: 0,  max: 300, step: 15, default: 60 },
    ],
    build(p) {
      const moves = [
        { name: "Burpees", cue: "Burpees", instruction: "Chest to floor, jump and clap overhead." },
        { name: "Squat Jumps", cue: "Squat jumps", instruction: "Sit back, explode up, land soft." },
        { name: "Mountain Climbers", cue: "Mountain climbers", instruction: "Hips level, drive knees fast." },
        { name: "Push-ups", cue: "Push-ups", instruction: "Body in one line. Drop to knees on REST if needed." },
      ];
      return {
        name: this.name,
        rounds: Array.from({ length: p.blocks }, (_, i) => {
          const m = moves[i % moves.length];
          return {
            label: m.name,
            icon: "ti-bolt",
            blocks: [
              { type: "station", name: m.name, cue: m.cue, instruction: m.instruction,
                exercises: [{ name: m.name, measure: "time" }],
                segments: { repeat: p.sets, pattern: [
                  { label: "WORK", tone: "hard", duration: p.workSec },
                  { label: "REST", tone: "easy", duration: p.restSec },
                ] } },
              i < p.blocks - 1 && p.blockRest > 0 && { type: "rest", duration: p.blockRest },
            ].filter(Boolean),
          };
        }),
      };
    },
  },
];

const templateById = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];

function defaultParams(t) {
  return Object.fromEntries(t.params.map(p => [p.key, p.default]));
}

function createWorkout(templateId, params) {
  const t = templateById(templateId);
  const p = { ...defaultParams(t), ...(params || {}) };
  return { id: uid(), templateId: t.id, params: p, ...t.build(p) };
}

/* ── 2. Compiler: workout → timeline ──────────────────────────────────────────
   Interval { type:"RUN"|"REST"|"WORK", round, rounds, duration (s|null), title,
              icon, instruction, note, target, speed, speedUnit, exercises,
              segments:[{label,tone,start,end,set,sets}], say, roundStart }
   ─────────────────────────────────────────────────────────────────────────── */

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

function stationTarget(block) {
  const parts = (block.exercises || []).map(e => targetText(e.target)).filter(Boolean);
  return parts.join(" + ");
}

function compile(workout) {
  const timeline = [];
  const rounds = workout.rounds.length;
  workout.rounds.forEach((round, ri) => {
    round.blocks.forEach((b, bi) => {
      const base = { round: ri + 1, rounds, roundStart: bi === 0, roundLabel: round.label };
      if (b.type === "run") {
        timeline.push({ ...base, type: "RUN", duration: b.duration, title: "Run", icon: "ti-run",
          speed: b.speed, speedUnit: b.speedUnit || "mph",
          instruction: `Treadmill at ${fmtSpeed(b.speed)} ${(b.speedUnit || "mph").toUpperCase()}. Steady, controlled pace.`,
          segments: [] });
      } else if (b.type === "rest") {
        timeline.push({ ...base, type: "REST", duration: b.duration, title: b.label || "Rest / Transition",
          icon: "ti-clock-pause", instruction: "", segments: [] });
      } else {
        const { segments, duration } = resolveSegments(b.segments, b.duration ?? null);
        const reps = (b.exercises || []).find(e => e.target)?.target;
        timeline.push({ ...base, type: "WORK", duration, title: b.name, icon: b.icon || round.icon || "ti-barbell",
          cue: b.cue || b.name, instruction: b.instruction || "", note: b.note || "",
          exercises: b.exercises || [], target: stationTarget(b), hasTarget: !!reps,
          openEnded: duration == null, segments });
      }
    });
  });
  // Spoken cues depend on neighbours, so they are written after the timeline exists.
  timeline.forEach((iv, i) => {
    const next = timeline[i + 1];
    if (iv.type === "RUN") {
      const pace = `${Number(Number(iv.speed).toFixed(1))} ${iv.speedUnit === "mph" ? "miles per hour" : iv.speedUnit}`;
      iv.say = iv.round === 1 && iv.roundStart ? `Round 1. Run. ${pace}.`
        : iv.roundStart ? `Next round. Round ${iv.round}. Run.` : `Run. ${pace}.`;
    } else if (iv.type === "REST") {
      const upNext = !next ? "" : next.type === "WORK" ? ` Up next, ${next.cue}.`
        : next.roundStart ? " Next round coming up." : ` Up next, ${next.title}.`;
      iv.say = `${spokenDuration(iv.duration)} rest.${upNext}`;
    } else {
      const firstSeg = iv.segments[0]?.label;
      const tgt = (iv.exercises.length === 1 && spokenTarget(iv.exercises[0].target)) || "";
      iv.say = `${iv.roundStart && iv.round > 1 ? "Next round. " : ""}${iv.cue}.${tgt ? ` Target ${tgt}.` : ""}${firstSeg ? ` ${cap(firstSeg)}.` : ""}`;
    }
  });
  return timeline;
}

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
    const total = this.timeline.reduce((a, iv) => a + (iv.duration || 0), 0) || 1;
    if (this.phase === "complete") return 1;
    if (this.phase !== "running") return 0;
    let done = 0;
    for (let i = 0; i < this.index; i++) done += this.timeline[i].duration || 0;
    const d = this.current.duration;
    if (d) done += d * Math.min(1, this.elapsedMs() / this.durationMs());
    return Math.min(1, done / total);
  }

  stats() {
    const sum = type => this.visits.filter(v => !type || v.type === type).reduce((a, v) => a + v.ms, 0);
    const finished = v => v.outcome === "complete" || v.outcome === "done";
    const runMs = sum("RUN");
    let distance = 0;
    this.visits.filter(v => v.type === "RUN").forEach(v => {
      distance += (v.ms / 3600000) * (this.timeline[v.index].speed || 0);
    });
    const stationIdx = new Set(this.visits.filter(v => v.type === "WORK" && finished(v)).map(v => v.index));
    const rounds = this.timeline[0]?.rounds || 0;
    let roundsDone = 0;
    for (let r = 1; r <= rounds; r++) {
      const needed = this.timeline.map((iv, i) => ({ iv, i })).filter(({ iv }) => iv.round === r && iv.type !== "REST");
      if (needed.length && needed.every(({ i }) => this.visits.some(v => v.index === i && finished(v)))) roundsDone++;
    }
    return {
      totalSec: Math.round(sum() / 1000),
      runSec: Math.round(runMs / 1000),
      workSec: Math.round(sum("WORK") / 1000),
      restSec: Math.round(sum("REST") / 1000),
      distance: Math.round(distance * 100) / 100,
      distanceUnit: "mi",
      stations: stationIdx.size,
      stationsTotal: this.timeline.filter(iv => iv.type === "WORK").length,
      rounds: roundsDone,
      roundsTotal: rounds,
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
const ui = { screen: "home", templateId: state.lastTemplate || TEMPLATES[0].id, summary: null, confirmEnd: false, go: false };
let engine = null;
let session = null;  // { workout, timeline, startedAt }
let driver = null;

function loadState() {
  const fresh = { settings: { sound: true, voice: true, vibrate: true }, params: {}, history: [], lastTemplate: null };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw);
    return { ...fresh, ...s, settings: { ...fresh.settings, ...(s.settings || {}) } };
  } catch { return fresh; }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }

function paramsFor(templateId) {
  const t = templateById(templateId);
  return { ...defaultParams(t), ...(state.params[templateId] || {}) };
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
  const sum = t => timeline.filter(iv => !t || iv.type === t).reduce((a, iv) => a + (iv.duration || 0), 0);
  const dist = timeline.filter(iv => iv.type === "RUN").reduce((a, iv) => a + (iv.duration / 3600) * iv.speed, 0);
  return { total: sum(), run: sum("RUN"), work: sum("WORK"), dist };
}

/* ── 5. UI ─────────────────────────────────────────────────────────────────── */

const app = document.getElementById("app");

function render() {
  document.body.dataset.screen = ui.screen;
  if (ui.screen === "player") return renderPlayer();
  if (ui.screen === "summary") app.innerHTML = renderSummary();
  else if (ui.screen === "history") app.innerHTML = renderHistory();
  else app.innerHTML = renderHome();
  window.scrollTo(0, 0);
}

function topbar(right = "") {
  return `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">VYRA</span><span class="brand-sub">Hybrid Training</span></div>
    <div class="topbar-actions">${right}</div>
  </header>`;
}

function soundButton() {
  const on = state.settings.sound || state.settings.voice;
  return `<button class="icon-btn" data-act="toggle-audio" aria-label="${on ? "Mute audio cues" : "Turn audio cues on"}" title="Audio cues">
    <i class="ti ${on ? "ti-volume" : "ti-volume-off"}" aria-hidden="true"></i></button>`;
}

/* Home / setup */
function renderHome() {
  const t = templateById(ui.templateId);
  const params = paramsFor(t.id);
  const workout = createWorkout(t.id, params);
  const timeline = compile(workout);
  const plan = planTotals(timeline);
  const hasRun = plan.run > 0;

  const paramRow = p => `
    <div class="set-row">
      <i class="ti ${p.icon} set-ic" aria-hidden="true"></i>
      <label class="set-label" for="param-${p.key}">${esc(p.label)}
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

  const roundRows = workout.rounds.map((r, i) => {
    const parts = r.blocks.map(b => b.type === "run" ? `Run ${fmtShort(b.duration)}`
      : b.type === "rest" ? `Rest ${fmtShort(b.duration)}`
      : `Work ${fmtShort(b.duration ?? resolveSegments(b.segments, null).duration ?? 0)}`).join(" · ");
    const station = r.blocks.find(b => b.type === "station");
    const tgt = station ? stationTarget(station) : "";
    return `
      <li class="round-row">
        <span class="round-no">${pad(i + 1)}</span>
        <div class="round-main">
          <div class="round-name">${esc(r.label)}</div>
          <div class="round-meta">${esc(parts)}${tgt ? ` · ${esc(tgt)}` : ""}</div>
        </div>
        <i class="ti ${r.icon || "ti-barbell"} round-ic" aria-hidden="true"></i>
      </li>`;
  }).join("");

  const others = TEMPLATES.filter(x => x.id !== t.id).map(x => `
    <button class="cl-row" data-template="${x.id}">
      <i class="ti ${x.icon} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(x.name)}</span><span class="cl-meta">${esc(x.meta)}</span></span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`).join("");

  const recent = state.history.slice(0, 3).map(historyRow).join("");

  return `
  ${topbar(`<button class="icon-btn" data-act="history" aria-label="History"><i class="ti ti-history"></i></button>`)}
  <section class="hero">
    <div class="hero-daycount">${workout.rounds.length} rounds · ${timeline.length} intervals</div>
    <div class="hero-titlebar"><i class="ti ${t.icon} hero-ic" aria-hidden="true"></i><h1 class="hero-name">${esc(t.name)}</h1></div>
    <div class="journey-track"><div class="journey-fill" style="width:100%"></div></div>
    <div class="hero-stats">
      <span><i class="ti ti-clock"></i> ${fmtClock(plan.total)} total</span>
      ${hasRun ? `<span class="hero-stat-dot">·</span><span><i class="ti ti-run"></i> ${fmtClock(plan.run)} run</span>
      <span class="hero-stat-dot">·</span><span>~${plan.dist.toFixed(2)} mi</span>` : ""}
      <span class="hero-stat-dot">·</span><span><i class="ti ti-barbell"></i> ${fmtClock(plan.work)} work</span>
    </div>
  </section>

  <div class="section-label">Setup</div>
  <div class="set-list">${t.params.map(paramRow).join("")}</div>
  ${Object.keys(state.params[t.id] || {}).length ? `<button class="text-btn" data-act="reset-params"><i class="ti ti-restore"></i> Reset to defaults</button>` : ""}

  <div class="section-label">Cues</div>
  <div class="set-list">
    ${toggle("sound", "Beeps", "ti-bell-ringing")}
    ${toggle("voice", "Spoken cues", "ti-microphone-2")}
    ${toggle("vibrate", "Vibration", "ti-device-mobile-vibration")}
  </div>

  <div class="section-label">Session</div>
  <ol class="round-list">${roundRows}</ol>

  ${others ? `<div class="section-label">Other workouts</div><div class="cl-list">${others}</div>` : ""}
  ${recent ? `<div class="section-label section-label--row"><span>Recent</span><button class="text-btn" data-act="history">All <i class="ti ti-chevron-right"></i></button></div><div class="cl-list">${recent}</div>` : ""}

  <div class="start-dock">
    <button class="btn-primary btn-start" data-act="start"><i class="ti ti-player-play"></i> Start workout</button>
  </div>`;
}

function historyRow(h) {
  return `
    <button class="cl-row" data-history="${h.id}">
      <i class="ti ${h.stats.rounds === h.stats.roundsTotal ? "ti-check" : "ti-flag"} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(h.name)}</span>
        <span class="cl-meta">${fmtDate(h.date)} · ${fmtClock(h.stats.totalSec)} · ${h.stats.rounds}/${h.stats.roundsTotal} rounds${h.stats.distance ? ` · ${h.stats.distance.toFixed(2)} mi` : ""}</span></span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`;
}

function renderHistory() {
  const rows = state.history.map(historyRow).join("");
  return `
  ${topbar(`<button class="icon-btn" data-act="home" aria-label="Back"><i class="ti ti-x"></i></button>`)}
  <section class="hero">
    <div class="hero-daycount">${state.history.length} saved</div>
    <div class="hero-titlebar"><i class="ti ti-history hero-ic"></i><h1 class="hero-name">History</h1></div>
  </section>
  ${rows ? `<div class="cl-list">${rows}</div>` : `<p class="empty">No saved workouts yet. Finish a session and tap Save Workout.</p>`}`;
}

/* Player */
function startWorkout() {
  Cues.unlock();
  const params = paramsFor(ui.templateId);
  const workout = createWorkout(ui.templateId, params);
  const timeline = compile(workout);
  session = { workout, timeline, startedAt: Date.now(), saved: false };
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
  ui.summary = {
    id: uid(), date: session.startedAt, name: session.workout.name, templateId: session.workout.templateId,
    params: session.workout.params, stats, early, saved: false,
  };
  ui.screen = "summary";
  ui.viewingHistory = false;
  ui.confirmEnd = false;
  render();
}

function stateWord(iv) {
  return iv.type === "WORK" ? "WORK" : iv.type;
}

function toneFor(iv, seg) {
  if (iv.type === "RUN") return "run";
  if (iv.type === "REST") return "rest";
  if (seg && (seg.tone === "easy" || seg.tone === "rest")) return "easy";
  return "work";
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
  if (iv.type === "RUN") metric = `${fmtSpeed(iv.speed)} ${iv.speedUnit.toUpperCase()}`;
  else if (iv.type === "WORK" && iv.target) metric = `Target ${iv.target}`;
  else if (iv.type === "REST" && upcoming) metric = `Next · ${upcoming.type === "RUN" ? "Run" : upcoming.title}`;

  // Sub-interval strip (HARD / EASY, Tabata WORK / REST)
  const segStrip = iv.segments.length ? `
    <div class="seg">
      <div class="seg-label tone-${tone}" data-bind="seg-label">${esc(seg?.label || "")}</div>
      <div class="seg-meta" data-bind="seg-meta">${segMeta(iv, e.segIndex)}</div>
      <div class="seg-pips">${iv.segments.map((s, i) => `<span class="pip pip-${s.tone} ${i < e.segIndex ? "done" : i === e.segIndex ? "now" : ""}" style="flex:${s.end - s.start}"></span>`).join("")}</div>
    </div>` : "";

  const exerciseList = iv.type === "WORK" && iv.exercises.length > 1 ? `
    <ol class="ex-list">${iv.exercises.map(x => `<li><span>${esc(x.name)}</span>${x.target ? `<em>${esc(targetText(x.target))}</em>` : ""}</li>`).join("")}</ol>` : "";

  const nowBlock = iv.type === "REST"
    ? `<div class="pl-row">
        <span class="pl-k">Now</span>
        <div class="pl-v"><div class="pl-name">Rest / Transition</div>
          <div class="pl-instr">${upcoming ? (upcoming.type === "WORK" ? "Get to the station and set up." : "Get back on the treadmill.") : "Recover."}</div></div>
      </div>`
    : `<div class="pl-row">
        <span class="pl-k">Now</span>
        <div class="pl-v"><div class="pl-name">${esc(iv.title)}</div>
          ${iv.instruction ? `<div class="pl-instr">${esc(iv.instruction)}</div>` : ""}
          ${exerciseList}
          ${iv.note ? `<div class="pl-note">${esc(iv.note)}</div>` : ""}</div>
      </div>`;

  // During rest the upcoming interval gets the spotlight.
  const nextBlock = upcoming ? `
      <div class="pl-row pl-row--up">
        <span class="pl-k">Up next</span>
        <div class="pl-v">
          <div class="pl-name pl-name--up"><i class="ti ${upcoming.icon}"></i> ${esc(upcoming.type === "RUN" ? `Run · Round ${upcoming.round}` : upcoming.title)}</div>
          <div class="pl-instr">${esc(upcoming.instruction)}</div>
          ${upcoming.type === "WORK" && upcoming.exercises.length > 1 ? `<ol class="ex-list">${upcoming.exercises.map(x => `<li><span>${esc(x.name)}</span>${x.target ? `<em>${esc(targetText(x.target))}</em>` : ""}</li>`).join("")}</ol>` : ""}
          <div class="pl-tags">${fmtShort(upcoming.duration || 0)}${upcoming.target ? ` · Target ${esc(upcoming.target)}` : ""}${upcoming.speed ? ` · ${fmtSpeed(upcoming.speed)} MPH` : ""}${upcoming.segments.length ? ` · ${esc(upcoming.segments.map(s => s.label).slice(0, 3).join(" / "))}${upcoming.segments.length > 3 ? "…" : ""}` : ""}</div>
        </div>
      </div>`
    : `<div class="pl-row">
        <span class="pl-k">Next</span>
        <div class="pl-v"><div class="pl-name pl-name--dim">${next ? esc(nextLabel(next)) : "Finish"}</div></div>
      </div>`;

  const showDone = iv.type === "WORK" && (iv.hasTarget || iv.openEnded);
  const roundTicks = tl.map((x, i) => (x.roundStart && i > 0 ? i : null)).filter(i => i != null);
  const total = tl.reduce((a, x) => a + (x.duration || 0), 0) || 1;
  const tickPos = i => (tl.slice(0, i).reduce((a, x) => a + (x.duration || 0), 0) / total) * 100;

  app.innerHTML = `
  <div class="player tone-${tone} ${e.paused ? "is-paused" : ""}">
    <div class="pl-top">
      <span class="pl-round">Round ${iv.round} of ${iv.rounds}</span>
      <span class="pl-clock" data-bind="clock"></span>
      ${soundButton()}
    </div>
    <div class="pl-progress" aria-label="Workout progress">
      <div class="pl-progress-fill" data-bind="progress"></div>
      ${roundTicks.map(i => `<span class="pl-tick" style="left:${tickPos(i)}%"></span>`).join("")}
    </div>

    <div class="pl-state"><span>${e.paused ? "PAUSED" : stateWord(iv)}</span>${iv.type === "WORK" ? `<i class="ti ${iv.icon}"></i>` : iv.type === "RUN" ? `<i class="ti ti-run"></i>` : `<i class="ti ti-clock-pause"></i>`}</div>
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
      ${showDone ? `<button class="ctl ctl-wide" data-act="done"><i class="ti ti-check"></i><span>${iv.openEnded ? "Done" : "Reps done"}</span></button>` : ""}
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
  if (n.type === "RUN") return `Run · ${fmtShort(n.duration)} @ ${fmtSpeed(n.speed)} MPH${n.roundStart ? ` · Round ${n.round}` : ""}`;
  if (n.type === "REST") return `Rest · ${fmtShort(n.duration)}`;
  return `${n.title}${n.duration ? ` · ${fmtShort(n.duration)}` : ""}`;
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
    const total = e.timeline.reduce((a, x) => a + (x.duration || 0), 0);
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
  return `
  ${topbar(fromHistory ? `<button class="icon-btn" data-act="history" aria-label="Back"><i class="ti ti-x"></i></button>` : "")}
  <section class="done-hero">
    <div class="hero-daycount">${esc(s.name)} · ${fmtDate(s.date)}</div>
    <h1 class="done-title">${s.early ? "Workout<br>ended" : "Workout<br>complete"}</h1>
    <div class="journey-track"><div class="journey-fill" style="width:${Math.round((st.rounds / (st.roundsTotal || 1)) * 100)}%"></div></div>
  </section>
  <div class="stat-grid">
    ${cell("Total time", fmtClock(st.totalSec), "ti-clock")}
    ${st.runSec || st.distance ? cell("Run time", fmtClock(st.runSec), "ti-run") : ""}
    ${st.runSec || st.distance ? cell("Est. distance", `${st.distance.toFixed(2)}<small> mi</small>`, "ti-route") : ""}
    ${cell("Work time", fmtClock(st.workSec), "ti-barbell")}
    ${cell("Stations", `${st.stations}<small> / ${st.stationsTotal}</small>`, "ti-target")}
    ${cell("Rounds", `${st.rounds}<small> / ${st.roundsTotal}</small>`, "ti-repeat")}
  </div>
  <div class="summary-actions">
    ${fromHistory
      ? `<button class="btn-primary" data-act="repeat"><i class="ti ti-repeat"></i> Repeat workout</button>
         <button class="btn-secondary" data-act="delete-history"><i class="ti ti-trash"></i> Delete</button>`
      : `<button class="btn-primary ${s.saved ? "is-saved" : ""}" data-act="save" ${s.saved ? "disabled" : ""}><i class="ti ${s.saved ? "ti-check" : "ti-device-floppy"}"></i> ${s.saved ? "Saved" : "Save workout"}</button>
         <button class="btn-secondary" data-act="repeat"><i class="ti ti-repeat"></i> Repeat workout</button>
         <button class="text-btn text-btn--center" data-act="home">Done</button>`}
  </div>`;
}

/* ── Events ────────────────────────────────────────────────────────────────── */

app.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act],[data-step],[data-setting],[data-template],[data-history]");
  if (!el) return;

  if (el.dataset.step) return stepParam(el.dataset.step, Number(el.dataset.dir));
  if (el.dataset.setting) {
    const k = el.dataset.setting;
    state.settings[k] = !state.settings[k]; save();
    if (k === "sound" && state.settings.sound) { Cues.unlock(); Cues.beep(); }
    if (k === "voice" && state.settings.voice) { Cues.unlock(); Cues.say("Spoken cues on"); }
    if (k === "vibrate" && state.settings.vibrate) Cues.buzz(80);
    return render();
  }
  if (el.dataset.template) { ui.templateId = el.dataset.template; state.lastTemplate = ui.templateId; save(); return render(); }
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
      return ui.screen === "player" ? renderPlayer() : render();
    }
    case "save":
      if (!ui.summary.saved) {
        ui.summary.saved = true;
        state.history.unshift({ ...ui.summary });
        state.history = state.history.slice(0, 200);
        save(); toast("Workout saved");
        render();
      }
      return;
    case "repeat":
      ui.templateId = ui.summary.templateId;
      state.params[ui.templateId] = { ...ui.summary.params }; save();
      return startWorkout();
    case "delete-history":
      state.history = state.history.filter(h => h.id !== ui.summary.id); save();
      ui.screen = "history"; return render();
    case "reset-params": delete state.params[ui.templateId]; save(); return render();
    case "history": ui.screen = "history"; return render();
    case "home": engine = null; session = null; ui.screen = "home"; return render();
  }
});

function stepParam(key, dir) {
  const t = templateById(ui.templateId);
  const p = t.params.find(x => x.key === key);
  const cur = paramsFor(t.id)[key];
  let v = Math.round((cur + dir * p.step) * 10) / 10;
  v = Math.min(p.max, Math.max(p.min, v));
  state.params[t.id] = { ...(state.params[t.id] || {}), [key]: v };
  save();
  render();
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
window.VYRA = { TEMPLATES, IntervalEngine, compile, createWorkout, resolveSegments, version: APP_VERSION };

render();
