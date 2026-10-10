"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   Iron Forest — Hybrid workout player
   The workout and the timer are one experience: press START and Iron Forest tells the
   athlete what to do, for how long, when to rest and what is coming next.

   Layers (top to bottom):
     workouts.js   — exercise library (with swaps) + workout templates + programs
     core.js       — data model, compiler, IntervalEngine, equipment swaps, formatting
     progress.js   — streaks, balance, badges, recommendations, SVG visuals
     app.js (this) — cues, state, and the UI: tabs, setup, player, summary
   ════════════════════════════════════════════════════════════════════════════ */

const APP_VERSION = "2026.10.10.8";
const STORE_KEY = "vyra_v1";
/* Beeps, the voice coach and vibration. */
const CUES_ENABLED = true;

/* ── 4. Cues: sound, speech, vibration ──────────────────────────────────────── */

/* Volume: 0–1.5 (above 100% is a boost for loud gyms; a limiter keeps it clean). */
const volume = () => (state.settings.muted ? 0 : state.settings.volume ?? 1);

const Cues = {
  ctx: null, master: null,
  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const limiter = this.ctx.createDynamicsCompressor();
        limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
        this.master = this.ctx.createGain();
        this.master.gain.value = volume();
        this.master.connect(limiter).connect(this.ctx.destination);
      }
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
      osc.connect(g).connect(this.master || this.ctx.destination);
      osc.start(t); osc.stop(t + dur + 0.05);
    } catch { /* ignore */ }
  },
  beep()      { this.tone(880, 0.14); },                                        // before an interval begins
  go()        { this.tone(1320, 0.3, { gain: 0.32 }); },
  end()       { this.tone(660, 0.22, { type: "square", gain: 0.2 });            // stronger: interval ends
                this.tone(990, 0.42, { type: "square", gain: 0.22, delay: 0.22 }); },
  segment()   { this.tone(1046, 0.12, { type: "triangle" }); this.tone(1046, 0.12, { type: "triangle", delay: 0.16 }); },
  complete()  { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, { type: "triangle", gain: 0.25, delay: i * 0.16 })); },
  say(text) { Voice.play([], { fallback: text }); },
  hush() { Voice.stop(); },
  setVolume(v) {
    state.settings.volume = Math.max(0, Math.min(1.5, v));
    if (this.master) this.master.gain.setTargetAtTime(volume(), this.ctx.currentTime, 0.03);
  },
  setMuted(m) {
    state.settings.muted = m;
    if (m) Voice.stop();
    if (this.master) this.master.gain.setTargetAtTime(volume(), this.ctx.currentTime, 0.03);
  },
  buzz(pattern) {
    if (!CUES_ENABLED) return;
    if (state.settings.vibrate && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
  },
};

/* ── Voice coach: plays the recorded lines (audio/voice), device voice as a fallback ── */
const coachVoice = () => (state.settings.voice === false ? "off" : state.settings.coach || "female");
const Voice = {
  manifest: null, buffers: new Map(), token: 0, source: null,
  async loadManifest() {
    if (this.manifest) return this.manifest;
    try { this.manifest = await (await fetch(`audio/voice/manifest.json?v=${APP_VERSION}`)).json(); } catch { this.manifest = { lines: {} }; }
    return this.manifest;
  },
  async buffer(id, voice = coachVoice()) {
    const key = `${voice}|${id}`;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const m = await this.loadManifest();
    const line = m.lines?.[id];
    if (!line || !Cues.ctx) return null;
    const p = fetch(`audio/voice/${voice}/${line.file}`).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then(b => Cues.ctx.decodeAudioData(b)).catch(() => null);
    this.buffers.set(key, p);
    return p;
  },
  /* Fetch and decode a workout's lines up front so they play instantly (and offline). */
  prepare(ids) { if (coachVoice() !== "off") [...ids].forEach(id => this.buffer(id)); },
  stop() {
    this.token++;
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = null;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  },
  /* Say these lines one after another, cutting off whatever was being said. */
  async play(ids, { fallback = "", interrupt = true } = {}) {
    if (!CUES_ENABLED || coachVoice() === "off" || state.settings.muted) return;
    if (interrupt) this.stop();
    const token = this.token;
    const items = await Promise.all(ids.filter(Boolean).map(async id => ({ id, buf: await this.buffer(id) })));
    if (fallback) items.push({ id: null, buf: null, text: fallback });
    for (const it of items) {
      if (token !== this.token) return;
      if (it.buf) await this.playBuffer(it.buf);
      else await this.speak(it.text || this.manifest?.lines?.[it.id]?.text || coachText(it.id));
    }
  },
  playBuffer(buf) {
    return new Promise(resolve => {
      try {
        const src = Cues.ctx.createBufferSource();
        src.buffer = buf; src.connect(Cues.master || Cues.ctx.destination);
        src.onended = () => resolve(); this.source = src; src.start();
      } catch { resolve(); }
    });
  },
  speak(text) {
    return new Promise(resolve => {
      if (!text || !("speechSynthesis" in window)) return resolve();
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US"; u.rate = 1.02; u.volume = Math.min(1, volume());
        const want = coachVoice() === "male" ? /male|daniel|alex|fred|guy|david|mark|james/i : /female|samantha|karen|victoria|zira|aria|jenny/i;
        const v = speechSynthesis.getVoices().filter(x => /^en/i.test(x.lang));
        u.voice = v.find(x => want.test(x.name) && /natural|neural|enhanced|premium|google/i.test(x.name)) || v.find(x => want.test(x.name)) || null;
        u.onend = u.onerror = () => resolve();
        speechSynthesis.speak(u);
        setTimeout(resolve, 8000);
      } catch { resolve(); }
    });
  },
};
const COACH_COMMON = ["warmup-start", "warmup-done", "cooldown", "cooldown-done", "workout-done", "challenge-done", "ended", "paused", "resume",
  "rest-1", "rest-2", "rest-3", "rest-4", "ten-work", "ten-rest", "halfway", "enc-1", "enc-2", "enc-3", "enc-4", "enc-5", "enc-6",
  "last-round", "togo-1", "togo-2", "togo-3", "tap-done", "tap-done-dist", "seg-hard", "seg-easy", "seg-work", "seg-rest"];

function wireCues(engine) {
  const coach = new CoachScript(engine.timeline, { challenge: session?.workout?.challenge?.id || false,
    finale: challengeById(session?.workout?.challenge?.id)?.finale || "", timeSec: () => (engine ? mainSecSoFar() : 0) });
  Voice.prepare([...timelineLines(engine.timeline), ...COACH_COMMON]);
  engine
    .on("countdown", ({ n }) => { Cues.beep(); Cues.buzz(60); Voice.play(coach.countdown(n)); })
    .on("go", () => { Cues.go(); Cues.buzz(200); })
    .on("interval", ({ reason, index }) => {
      if (reason === "auto") { Cues.end(); Cues.buzz([280, 120, 280]); }
      const gate = gateFor(engine.timeline, index, reason);
      const lines = coach.interval(index, reason, gate);
      Voice.play(reason === "start" ? ["go", ...lines] : lines);
    })
    .on("second", ({ remaining, elapsed }, e) => {
      if (elapsed != null) { const lines = coach.elapsed(e.current, elapsed); if (lines.length) Voice.play(lines, { interrupt: false }); return; }
      const d = e.durationMs() / 1000;
      if (remaining <= 3 && remaining >= 1 && d > 4) { Cues.beep(); Cues.buzz(50); }
      const lines = coach.second(e.current, remaining, d);
      if (lines.length) Voice.play(lines);
    })
    .on("segment", ({ segment }) => { Cues.segment(); Cues.buzz([120, 80, 120]); Voice.play(coach.segment(segment)); })
    .on("pause", () => { if (!ui.gate) Voice.play(["paused"]); })
    .on("resume", () => {
      if (ui.gateResume) { ui.gateResume = false; Voice.play(coach.intro(engine.current, engine.timeline[engine.index - 1])); }
      else Voice.play(["resume"]);
    })
    .on("complete", ({ early }) => {
      Cues.complete(); Cues.buzz([400, 150, 400, 150, 600]);
      Voice.play(coach.finish(early, ui.cooledDown));
      ui.cooledDown = false;
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

/* ── Phone-free: headphone buttons, lock-screen controls, screen-off audio ─────
   A quiet keep-alive track (a 25 Hz hum far below what earbuds play) keeps the
   workout running and talking with the screen off, and gives the headphones
   something to control: one press = pause / play (and Start at the warm-up
   and cool-down screens), double press = Done / next, triple press = back. */
const HandsFree = {
  el: null, url: null,
  keepAlive() {
    if (this.url) return this.url;
    const rate = 8000, n = rate * 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 25 * i / rate) * 40), true);
    return (this.url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
  },
  start() {
    try { this.el ||= Object.assign(new Audio(this.keepAlive()), { loop: true }); this.el.play().catch(() => {}); } catch { /* no audio element */ }
    const ms = navigator.mediaSession;
    if (!ms) return;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* not supported here */ } };
    set("play", () => this.press()); set("pause", () => this.press());
    set("nexttrack", () => this.next()); set("previoustrack", () => { this.keep(); engine?.prev(); });
    this.update();
  },
  keep() { if (this.el?.paused && engine) this.el.play().catch(() => {}); },
  /* One press: start at a transition screen, otherwise pause / resume. */
  press() {
    this.keep();
    if (!engine || ui.gateCount != null || ui.go) return;
    if (ui.gate) return gateGo();
    if (engine.phase === "running") engine.toggle();
  },
  /* Double press: Done (or on to the next block). */
  next() {
    this.keep();
    if (!engine || ui.gate || engine.phase !== "running" || engine.paused) return;
    if (engine.current.fixed) return Voice.play(["fixed-block"]);
    engine.done();
  },
  update() {
    const ms = navigator.mediaSession;
    if (!ms || !engine || !session) return;
    const iv = engine.current;
    try {
      ms.metadata = new MediaMetadata({ title: iv ? `${iv.title}${iv.target ? ` · ${iv.target}` : ""}` : session.workout.name,
        artist: "Iron Forest", album: session.workout.name, artwork: [{ src: "icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" }] });
      ms.playbackState = engine.paused || ui.gate ? "paused" : "playing";
    } catch { /* ignore */ }
  },
  stop() {
    try { this.el?.pause(); } catch { /* ignore */ }
    const ms = navigator.mediaSession;
    if (!ms) return;
    ["play", "pause", "nexttrack", "previoustrack"].forEach(a => { try { ms.setActionHandler(a, null); } catch { /* ignore */ } });
    try { ms.metadata = null; ms.playbackState = "none"; } catch { /* ignore */ }
  },
};

/* ── State & persistence ───────────────────────────────────────────────────── */

const ALL_EQUIPMENT = Object.keys(EQUIPMENT_LABEL);
const state = loadState();
const TABS = [
  { id: "today", label: "Today", icon: "ti-home" },
  { id: "library", label: "Train", icon: "ti-books" },
  { id: "compete", label: "Compete", icon: "ti-trophy" },
  { id: "progress", label: "Progress", icon: "ti-chart-bar" },
  { id: "profile", label: "Profile", icon: "ti-user" },
];
const ui = {
  screen: state.profile.onboarded ? "today" : "onboarding", tab: "today",
  templateId: state.lastTemplate || TEMPLATES[0].id, summary: null, viewingHistory: false,
  confirmEnd: false, confirm: null, go: false, calOffset: 0,
  filters: { time: "all", type: "all", level: "all" }, fitsGear: false,
  auth: { email: "", code: "", sent: false, busy: false, msg: "", error: false },
  ob: { goal: 3, level: "intermediate", equipment: [...ALL_EQUIPMENT] },
};
let engine = null;
let session = null;  // { workout, timeline, swaps, startedAt }
let driver = null;

function loadState() {
  const fresh = {
    settings: { sound: true, voice: true, vibrate: true },
    profile: { onboarded: false, goal: 3, level: "intermediate", equipment: [...ALL_EQUIPMENT], warmup: true, cooldown: true },
    params: {}, swaps: {}, history: [], checkin: null, lastTemplate: null, program: null, customPlans: [], myWorkouts: [],
    deleted: {}, sync: defaultSyncState(), profileUpdatedAt: 0, profileSig: null, athlete: null,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fresh;
    const s = JSON.parse(raw);
    s.history = (s.history || []).filter(h => !h.demo);   // sample workouts from older versions
    return { ...fresh, ...s, swaps: s.swaps || {}, settings: { ...fresh.settings, ...(s.settings || {}) },
      profile: { ...fresh.profile, ...(s.profile || {}), onboarded: s.profile?.onboarded ?? (s.history?.length > 0) } };
  } catch { return fresh; }
}
/* Persist locally. Unless silent (the sync engine's own writes), stamp what changed and queue a cloud sync. */
function save({ silent = false } = {}) {
  if (!silent) {
    let changed = stampChanges(state.history);
    const sig = JSON.stringify(profileBlob(state));
    if (sig !== state.profileSig) { state.profileSig = sig; state.profileUpdatedAt = Date.now(); changed++; }
    // New deletions also need to reach the cloud.
    const deletions = Object.keys(state.deleted || {}).length;
    if (deletions !== state.deletedCount) { state.deletedCount = deletions; changed++; }
    if (changed) Sync.schedule();
  }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

/* Settings and swaps of a workout: the open "My workout" if there is one, otherwise the template's own. */
function paramsFor(templateId) {
  const t = templateById(templateId);
  const m = activeMine(templateId);
  return { ...defaultParams(t), ...(m ? m.params : state.params[templateId] || {}) };
}
function swapsFor(templateId) { const m = activeMine(templateId); return m ? m.swaps || {} : state.swaps[templateId] || {}; }
function writeParams(templateId, patch) {
  const m = activeMine(templateId);
  if (m) m.params = { ...m.params, ...patch };
  else state.params[templateId] = { ...(state.params[templateId] || {}), ...patch };
}
function writeSwaps(templateId, swaps) {
  const m = activeMine(templateId);
  if (m) m.swaps = swaps; else state.swaps[templateId] = swaps;
}

/* ── Equipment (athlete's profile) ─────────────────────────────────────────── */

const ownsGear = e => hasGear(e, state.profile.equipment);
const gearPlanFor = (templateId, workout) => gearPlan(workout, swapsFor(templateId), state.profile.equipment);

/* Planned workout for a template with the athlete's settings, gear and warm-up choice. */
function planFor(templateId, params = paramsFor(templateId)) {
  const workout = createWorkout(templateId, params);
  const gear = gearPlanFor(templateId, workout);
  const timeline = compile(workout, gear.swaps, { warmup: state.profile.warmup, cooldown: state.profile.cooldown });
  return { workout, timeline, gear, totals: planTotals(timeline) };
}

/* ── Active program ─────────────────────────────────────────────────────────── */

const activeProgram = () => programStatus(state.program);
/* The plan session behind a key, with its adjusted settings — only if it belongs to the active program. */
function programSession(key) {
  const st = activeProgram();
  const s = st && key ? st.sessions.find(x => x.key === key) : null;
  if (!s) return null;
  const t = templateById(s.t);
  return { ...s, template: t, params: sessionParams(t, paramsFor(t.id), s), status: st };
}
function adjText(adj) {
  const words = { rounds: "round", speed: " mph", workSec: "s work", carrySec: "s carry", cardioSec: "s cardio", stationSec: "s per station",
    strengthSec: "s strength", runSec: "s run", walkSec: "s walk", rowSec: "s row", bikeSec: "s bike", legSec: "s per leg" };
  return Object.entries(adj || {}).map(([k, v]) => k === "rounds" ? `${v > 0 ? "+" : ""}${v} round${Math.abs(v) === 1 ? "" : "s"}`
    : `${v > 0 ? "+" : ""}${v}${words[k] || ` ${k}`}`).join(", ");
}

function benchResults(templateId) {
  return state.history.filter(h => h.templateId === templateId && h.bench?.totalMi > 0);
}

/* ── 5. UI ─────────────────────────────────────────────────────────────────── */

const app = document.getElementById("app");
const TAB_SCREENS = TABS.map(t => t.id);

function render() {
  refreshUserPrograms();
  document.body.dataset.screen = ui.screen;
  if (ui.screen === "player") return renderPlayer();
  const views = {
    program: renderProgram, hall: renderHall, "plan-make": renderPlanMake, "plan-edit": renderPlanEdit, "plan-pick": renderPlanPick, compete: renderCompete, activity: renderActivity, "athlete-view": renderAthleteView,
    event: renderEvent, verify: renderVerify, review: renderReview, club: renderClub, "club-new": renderClubNew, challenge: renderChallenge, athlete: renderAthlete, "athlete-edit": renderAthleteEdit,
    onboarding: renderOnboarding, today: renderToday, library: renderLibrary, progress: renderProgress,
    history: renderHistory, profile: renderProfile, setup: renderSetup, summary: renderSummary,
  };
  app.innerHTML = (views[ui.screen] || renderToday)() + (TAB_SCREENS.includes(ui.screen) ? renderNav() : "");
  // Animate only real navigation, not in-place updates (toggles, chips, steppers).
  app.classList.remove("enter");
  if (!ui.quiet) { void app.offsetWidth; app.classList.add("enter"); }
  window.scrollTo(0, 0);
}
function rerender() { const y = window.scrollY; ui.quiet = true; render(); ui.quiet = false; window.scrollTo(0, y); }
function go(screen) {
  if (TAB_SCREENS.includes(screen)) ui.tab = screen;
  ui.screen = screen; ui.confirm = null;
  if (screen !== "setup") ui.mineId = null;
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
    ${left || `<div class="brand"><span class="brand-mark">Iron Forest</span><span class="brand-sub">Hybrid Training</span></div>`}
    <div class="topbar-actions">${right}</div>
  </header>`;
}
const backButton = (act, label = "Back") =>
  `<button class="back-btn" data-go="${act}" aria-label="${label}"><i class="ti ti-chevron-left"></i><span>${label}</span></button>`;

const volIcon = () => (volume() === 0 ? "ti-volume-off" : volume() < 0.5 ? "ti-volume-2" : "ti-volume");
/* The speaker button opens a volume panel (slider, quick steps, mute). */
function soundButton() {
  if (!CUES_ENABLED) return "";
  return `<button class="icon-btn ${ui.volOpen ? "on" : ""}" data-act="volume-open" aria-label="Volume" aria-expanded="${!!ui.volOpen}" title="Volume">
    <i class="ti ${volIcon()}" aria-hidden="true"></i></button>
    ${ui.volOpen ? `<div class="vol-panel" role="dialog" aria-label="Volume">${volumeControl("vol-slider")}
      <button class="text-btn vol-close" data-act="volume-open">Done</button></div>` : ""}`;
}
function volumeControl(id) {
  const pct = Math.round((state.settings.volume ?? 1) * 100);
  const muted = !!state.settings.muted;
  return `
  <div class="vol">
    <button class="icon-btn" data-act="toggle-audio" aria-label="${muted ? "Unmute" : "Mute"}"><i class="ti ${muted ? "ti-volume-off" : "ti-volume"}"></i></button>
    <button class="icon-btn icon-btn--sm" data-act="volume-step" data-dir="-1" aria-label="Quieter"><i class="ti ti-minus"></i></button>
    <input class="vol-slider" id="${id}" type="range" min="0" max="150" step="5" value="${pct}" aria-label="Volume" ${muted ? "disabled" : ""}>
    <button class="icon-btn icon-btn--sm" data-act="volume-step" data-dir="1" aria-label="Louder"><i class="ti ti-plus"></i></button>
    <span class="vol-pct" data-bind="vol-pct">${muted ? "Muted" : `${pct}%`}</span>
  </div>`;
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
const CATEGORY_ICON = { hybrid: "ti-run", "kb-db": "ti-barbell", bodyweight: "ti-trees", benchmark: "ti-trophy" };

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
  const nothing = !o.equipment.some(e => e !== "outdoors");
  return `
  ${topbar()}
  <section class="ob">
    <h1 class="ob-title">Your guided hybrid workout player.</h1>
    <p class="about">Gym, home or outside: treadmill, rower, bike, weights or just your body, in one guided timer. No whiteboard, no stopwatch juggling, no wondering what's next. Three quick questions so we can pick the right sessions for you.</p>
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
      <button class="text-btn" data-act="ob-no-equipment"><i class="ti ti-stretching"></i> I have no equipment</button>
      <p class="hint">${nothing ? "No problem. Every workout switches to bodyweight moves, and there's a full set of no-equipment sessions."
        : noWeights ? "No weights? Iron Forest swaps in bodyweight versions of every loaded move." : "Missing something? Iron Forest swaps in an alternative automatically."}</p>
    </div>
    <div class="ob-q">
      <div class="ob-label"><span>04</span> Before you start</div>
      <button class="ack ${o.ack ? "on" : ""}" data-act="ob-ack" role="checkbox" aria-checked="${!!o.ack}">
        <span class="ack-box">${o.ack ? '<i class="ti ti-check"></i>' : ""}</span>
        <span>${HEALTH_NOTE}</span>
      </button>
    </div>
  </section>
  <div class="start-dock"><button class="btn-primary btn-start" data-act="ob-done" ${o.ack ? "" : "disabled"}>Start training <i class="ti ti-arrow-right"></i></button></div>`;
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
  // With a plan running, the suggestion is an off-plan alternative, never the plan's own next session.
  const plan = activeProgram();
  const onPlan = plan && !plan.complete;
  const metas = TEMPLATES.map(templateMeta).filter(m => !onPlan || m.t.id !== plan.next.t);
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
        <div class="pick-eyebrow"><i class="ti ti-sparkles"></i> ${onPlan ? "Off-plan option" : "Suggestion"}</div>
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

  ${state.profile.healthAck ? "" : `<div class="pick plan"><div class="pick-eyebrow"><i class="ti ti-shield-check"></i> Before you train</div>
    <p class="pick-reason">${HEALTH_NOTE}</p><button class="btn-secondary" data-act="health-ack"><i class="ti ti-check"></i> I understand</button></div>`}
  ${programCard() || (state.history.length ? `<div class="cl-list cl-list--nudge">${makePlanCard()}</div>` : "")}
  ${monthlyCard()}
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

/* ── Health & safety ──────────────────────────────────────────────────────── */
const HEALTH_NOTE = "Iron Forest is a workout guide, not medical advice or physical therapy. I'm healthy enough to exercise, or a doctor has cleared me, and I'll scale or stop anything that doesn't feel right.";
const FAST_SPEED_MPH = 9;

/* Warnings shown on a workout before it starts. */
function safetyNotes(t, params) {
  const notes = [];
  const levels = { beginner: 0, intermediate: 1, advanced: 2 };
  if (levels[t.level] > levels[state.profile.level]) {
    notes.push(`This is an ${t.level} session and your profile says ${state.profile.level}. Try fewer rounds or a slower speed the first time.`);
  }
  if (params.speed >= FAST_SPEED_MPH) {
    notes.push(`${fmtSpeed(params.speed)} mph is a fast pace. Only use it if you regularly run at this speed; otherwise lower it.`);
  }
  return notes.map(n => `<div class="gear-note gear-note--warn"><i class="ti ti-alert-triangle"></i> ${esc(n)}</div>`).join("");
}

/* ── Programs ─────────────────────────────────────────────────────────────── */
function programCard() {
  const st = activeProgram();
  if (!st) return "";
  if (st.complete) return `
    <div class="pick plan">
      <div class="pick-eyebrow"><i class="ti ti-trophy"></i> Plan complete</div>
      <div class="pick-name">${esc(st.prog.name)}</div>
      <p class="pick-reason">All ${st.total} sessions done. Pick your next plan or keep going with single workouts.</p>
      <button class="btn-secondary" data-program="${st.prog.id}"><i class="ti ti-calendar-event"></i> View plan</button>
    </div>`;
  const n = st.next;
  const t = templateById(n.t);
  const ps = programSession(n.key);
  const minutes = Math.round(planFor(t.id, ps.params).totals.main / 60);
  return `
    <div class="pick plan">
      <div class="pick-eyebrow"><i class="ti ti-calendar-event"></i> ${esc(st.prog.name)} · week ${n.week} of ${st.prog.weeks.length}</div>
      <button class="pick-main" data-session="${n.key}">
        <span class="pick-name">${esc(n.name || t.name)}</span>
        <span class="pick-meta">${n.day != null ? `${n.day === new Date().getDay() ? "Planned for today" : `Planned for ${WEEKDAYS[n.day]}`} · ` : ""}Session ${n.index} of ${n.perWeek} this week · ${minutes} min${n.adj ? ` · ${esc(adjText(n.adj))}` : ""}</span>
      </button>
      <div class="plan-track" aria-label="${st.doneCount} of ${st.total} sessions done">
        ${st.sessions.map(s => `<span class="${st.done[s.key] ? "done" : s.key === n.key ? "now" : ""} ${s.index === 1 && s.week > 1 ? "wk" : ""}"></span>`).join("")}
      </div>
      <div class="cl-meta">${st.doneCount} of ${st.total} sessions done</div>
      <button class="btn-primary" data-act="plan-start" data-id="${t.id}" data-key="${n.key}"><i class="ti ti-player-play"></i> Start ${esc(n.name || t.name)}</button>
    </div>`;
}

function programRow(p) {
  const st = activeProgram();
  const active = st && st.prog.id === p.id;
  const total = p.weeks.reduce((a, w) => a + w.length, 0);
  return `
    <button class="cl-row" data-program="${p.id}">
      <i class="ti ti-calendar-event cl-ic" aria-hidden="true"></i>
      <span class="cl-main">
        <span class="cl-name">${esc(p.name)}${p.custom ? ` <span class="tag">Yours</span>` : ""}${active ? ` <span class="tag tag--live">${st.complete ? "Done" : "Active"}</span>` : ""}</span>
        <span class="cl-sub">${esc(p.tagline)}</span>
        <span class="cl-meta">${p.weeks.length} weeks · ${total} sessions · ${cap(p.level)}${active && !st.complete ? ` · <b>${st.doneCount}/${st.total} done</b>` : ""}</span>
      </span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`;
}

function renderProgram() {
  const p = programById(ui.programId) || PROGRAMS[0];
  const st = activeProgram();
  const active = st && st.prog.id === p.id ? st : null;
  const sessions = programSessions(p);
  const totalMin = sessions.reduce((a, s) => a + planFor(s.t, sessionParams(templateById(s.t), paramsFor(s.t), s)).totals.main, 0) / 60;
  const kit = [...new Set(sessions.flatMap(s => templateById(s.t).equipment))];
  const weeks = p.weeks.map((week, wi) => `
    <div class="cl-cat"><span class="cl-cat-name">Week ${wi + 1}${wi === p.weeks.length - 1 ? " · lighter" : ""}</span>
      <span class="cl-cat-count">${week.length} sessions</span></div>
    <div class="cl-list">${week.map((s, si) => {
      const key = `${wi + 1}-${si + 1}`;
      const t = templateById(s.t);
      const done = active?.done[key];
      const isNext = active?.next?.key === key;
      const icon = done ? "ti-circle-check" : isNext ? "ti-player-play" : "ti-circle";
      const inner = `
        <i class="ti ${icon} cl-ic ${done ? "is-done" : isNext ? "is-next" : ""}" aria-hidden="true"></i>
        <span class="cl-main"><span class="cl-name">${s.day != null ? `<span class="day-tag">${WEEKDAYS[s.day]}</span>` : ""}${esc(s.name || t.name)}</span>
          <span class="cl-meta">${esc(t.tagline)}${s.adj ? ` · ${esc(adjText(s.adj))}` : ""}${done ? " · done" : isNext ? " · up next" : ""}</span></span>`;
      return active ? `<button class="cl-row" data-session="${key}">${inner}<i class="ti ti-chevron-right cl-go" aria-hidden="true"></i></button>`
        : `<button class="cl-row" data-template="${t.id}">${inner}<i class="ti ti-chevron-right cl-go" aria-hidden="true"></i></button>`;
    }).join("")}</div>`).join("");

  const switching = st && !st.complete && !active;
  return `
  ${topbar("", backButton(ui.tab === "today" ? "today" : "library", ui.tab === "today" ? "Today" : "Library"))}
  <section class="hero">
    <div class="hero-daycount">${p.weeks.length}-week ${p.custom ? "plan · made by you" : `program · ${cap(p.level)}`}</div>
    <div class="hero-titlebar"><i class="ti ti-calendar-event hero-ic" aria-hidden="true"></i><h1 class="hero-name">${esc(p.name)}</h1></div>
    <p class="about">${esc(p.about)}</p>
    <div class="tag-row"><span class="tag">${sessions.length} sessions</span><span class="tag">~${Math.round(totalMin / sessions.length)} min each</span>
      ${kit.map(e => `<span class="tag tag--equip">${esc(EQUIPMENT_LABEL[e])}</span>`).join("")}</div>
  </section>
  ${active ? `
    <div class="plan-summary">
      <div class="ring-wrap ring-wrap--sm">
        ${ringSVG(active.doneCount / active.total, { size: 84, stroke: 7, label: `${active.doneCount} of ${active.total} sessions` })}
        <div class="ring-center"><b>${active.doneCount}<small>/${active.total}</small></b></div>
      </div>
      <div><div class="cl-name">${active.complete ? "Plan complete" : `Week ${active.week} of ${p.weeks.length}`}</div>
        <div class="cl-meta">Self-paced: train when it suits you. Sessions count once at least half is done.</div></div>
    </div>
    ${active.next ? `<button class="btn-primary btn-inline-start" data-act="plan-start" data-id="${active.next.t}" data-key="${active.next.key}"><i class="ti ti-player-play"></i> Start next: ${esc(templateById(active.next.t).name)}</button>` : ""}`
    : `<button class="btn-primary btn-inline-start" data-act="program-join" data-id="${p.id}"><i class="ti ti-calendar-plus"></i> ${switching && ui.confirm === "switch" ? `Tap again to replace ${esc(st.prog.name)}` : switching ? "Switch to this plan" : "Start this plan"}</button>`}
  ${customPlanTools(p)}
  ${weeks}
  ${active ? `<button class="text-btn text-btn--center" data-act="program-leave">${ui.confirm === "leave" ? "Tap again to end this plan" : "End this plan"}</button>` : ""}`;
}

/* ── Library ──────────────────────────────────────────────────────────────── */
const TYPE_FILTERS = [
  ["all", "Any"], ["low-impact", "Low impact"], ["strength-heavy", "Strength"], ["cardio-heavy", "Cardio"],
  ["minimal", "Minimal kit"], ["no-machines", "No machines"], ["bodyweight", "No equipment"], ["outdoor", "Outdoor"], ["benchmark", "Benchmark"],
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
  ${myWorkouts().length ? `${sectionLabel("My workouts", `<span class="cl-cat-count">${myWorkouts().length}</span>`)}
  <div class="cl-list">${myWorkouts().map(mineRow).join("")}</div>` : ""}
  ${sectionLabel("4-week programs", `<span class="cl-cat-count">${USER_PROGRAMS.length + PROGRAMS.length} plans</span>`)}
  <div class="cl-list">${makePlanCard()}${[...USER_PROGRAMS, ...PROGRAMS].map(programRow).join("")}</div>
  ${sectionLabel("Single workouts")}
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
  const ps = programSession(ui.programKey);
  const inPlan = ps && ps.t === t.id ? ps : null;
  const params = inPlan ? inPlan.params : paramsFor(t.id);
  const manual = swapsFor(t.id);
  const { workout, timeline, totals, gear } = planFor(t.id, params);
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
          <button class="cl-chip ${o === current ? "active" : ""} ${ownsGear(EXERCISES[o]) ? "" : "cl-chip--off"}" data-swap="${id}" data-to="${o}" aria-pressed="${o === current}">${o === id ? "Original" : esc(EXERCISES[o].name)}</button>`).join("")}
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
    <div class="hero-daycount">${activeMine(t.id) && !inPlan ? `My workout · based on ${esc(t.name)}` : esc(t.tagline)}</div>
    <div class="hero-titlebar"><i class="ti ${activeMine(t.id) && !inPlan ? "ti-bookmark" : CATEGORY_ICON[t.category]} hero-ic" aria-hidden="true"></i><h1 class="hero-name">${esc(activeMine(t.id) && !inPlan ? activeMine(t.id).name : inPlan?.name || t.name)}</h1></div>
    <div class="journey-track"><div class="journey-fill" style="width:100%"></div></div>
    <div class="hero-stats">
      <span><i class="ti ti-clock"></i> ${fmtClock(totals.total)}${totals.openEnded ? "+" : ""}</span>
      ${totals.cardio ? `<span class="hero-stat-dot">·</span><span><i class="ti ti-heartbeat"></i> ${fmtClock(totals.cardio)} cardio</span>` : ""}
      ${totals.work ? `<span class="hero-stat-dot">·</span><span><i class="ti ti-barbell"></i> ${fmtClock(totals.work)} work</span>` : ""}
      ${totals.dist ? `<span class="hero-stat-dot">·</span><span>~${totals.dist.toFixed(2)} mi run</span>` : ""}
    </div>
    <p class="about">${esc(t.about)}</p>
    <div class="tag-row">${tags.map(f => `<span class="tag">${esc(f)}</span>`).join("")}</div>
    ${inPlan ? `<div class="gear-note"><i class="ti ti-calendar-event"></i> ${esc(inPlan.status.prog.name)} · week ${inPlan.week}, session ${inPlan.index} of ${inPlan.perWeek}${inPlan.adj ? ` · ${esc(adjText(inPlan.adj))} vs your usual settings` : ""}</div>` : ""}
    ${safetyNotes(t, params)}
    ${!gear.doable ? `<div class="gear-note gear-note--warn"><i class="ti ti-alert-triangle"></i> Needs ${gear.missing.map(e => EQUIPMENT_LABEL[e] || e).join(", ")}. Pick a swap below, add it in Profile, or start anyway.</div>`
      : autoList.length ? `<div class="gear-note"><i class="ti ti-adjustments"></i> Adjusted for your equipment: ${autoList.map(([a, b]) => `${esc(EXERCISES[a].name)} → ${esc(EXERCISES[b].name)}`).join(", ")}</div>` : ""}
  </section>

  <button class="btn-primary btn-inline-start" data-act="start" ${inPlan ? `data-key="${inPlan.key}"` : ""}><i class="ti ti-player-play"></i> ${gear.doable ? "Start workout" : "Start anyway"}</button>

  ${benchBlock}

  ${sectionLabel("Setup")}
  <div class="set-list">${t.params.filter(p => p.kind !== "speed" || timeline.some(iv => iv.speed)).map(paramRow).join("")}</div>
  ${!activeMine(t.id) && Object.keys(state.params[t.id] || {}).length ? `<button class="text-btn" data-act="reset-params"><i class="ti ti-restore"></i> Reset to defaults</button>` : ""}
  ${inPlan ? "" : mineTools(t)}

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
    <button class="btn-primary btn-start" data-act="start" ${inPlan ? `data-key="${inPlan.key}"` : ""}><i class="ti ti-player-play"></i> ${gear.doable ? "Start workout" : "Start anyway"}</button>
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
    <div class="hero-daycount">Since ${fmtDate(h[h.length - 1].date)}</div>
    <div class="hero-titlebar"><h1 class="hero-name">Progress</h1></div>
  </section>
  <button class="text-btn" data-go="history"><i class="ti ti-history"></i> All workouts</button>

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
  const c = h.attempt && challengeById(h.attempt.challengeId);
  return `
    <button class="cl-row" data-history="${h.id}">
      <i class="ti ${c ? c.icon : h.bench ? "ti-trophy" : h.early ? "ti-flag" : "ti-check"} cl-ic ${h.attempt?.pr ? "is-done" : ""}" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(h.name)}${h.attempt?.pr ? ` <span class="tag tag--live">PR</span>` : ""}</span>
        <span class="cl-meta">${fmtDay(h.date)} · ${c ? (h.attempt.dnf ? "DNF" : esc(formatScore(c, h.attempt.score))) : fmtClock(h.stats.totalSec)}${!c && h.bench ? ` · ${h.bench.totalMi.toFixed(2)} mi` : !c && h.stats.distance ? ` · ${h.stats.distance.toFixed(2)} mi` : ""}</span>
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
  ${topbar("", backButton(ui.tab === "profile" ? "profile" : "progress", ui.tab === "profile" ? "Profile" : "Progress"))}
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
  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">${cap(p.level)} · ${p.goal} workouts a week</div>
    <div class="hero-titlebar"><h1 class="hero-name">Profile</h1></div>
  </section>

  <button class="athlete-card" data-go="athlete">
    <span class="avatar avatar--sm">${esc(initials(athlete().displayName))}</span>
    <span class="cl-main"><span class="cl-name">${esc(athlete().displayName || "Set up your athlete profile")}</span>
      <span class="cl-meta">${athlete().displayName ? `${esc(DIVISIONS.find(d => d.id === athlete().division).label)} · ${personalRecords().length} records · ${athlete().visibility === "public" ? "public" : "private"}` : "Records, benchmarks, leaderboards and privacy"}</span></span>
    <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
  </button>
  <button class="text-btn" data-go="history"><i class="ti ti-history"></i> All workouts</button>

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
    <p class="hint">Workouts swap in alternatives for anything you don't have, down to bodyweight. "Outside" lets runs and walks happen outdoors.</p></div>

  ${sectionLabel("Safety")}
  <div class="set-list">
    ${switchRow('data-profile-toggle="warmup"', p.warmup, "Warm-up before every workout", "ti-stretching", "4:30 of mobility")}
    ${switchRow('data-profile-toggle="cooldown"', p.cooldown, "Cool-down after every workout", "ti-yoga", "3:00 walk and stretch")}
  </div>

  ${CUES_ENABLED ? `${sectionLabel("Cues")}
  <div class="set-list">
    <div class="set-row set-row--stack"><i class="ti ti-microphone-2 set-ic"></i>
      <span class="set-label">Coach voice<span class="set-unit">Talks you through every interval, like a coach in the room</span></span></div>
    <div class="pad-y coach-pick">${chips("data-coach", [["female", "Female"], ["male", "Male"], ["off", "Off"]], coachVoice())}
      ${coachVoice() !== "off" ? `<button class="text-btn" data-act="voice-preview"><i class="ti ti-player-play"></i> Hear ${esc(COACH_VOICES[coachVoice()].name)}</button>` : ""}</div>
    <p class="hint"><i class="ti ti-headphones"></i> Phone-free: the coach says every move, target and time. With headphones, press once to pause or start, twice for Done, three times to go back. It keeps going with the screen off; tap <b>Lock</b> in the player before it goes in your pocket.</p>
    <div class="set-row set-row--stack"><i class="ti ti-volume set-ic"></i><span class="set-label">Volume<span class="set-unit">Above 100% boosts the coach for loud gyms</span></span></div>
    <div class="pad-y">${volumeControl("vol-slider-profile")}</div>
    ${switchRow('data-setting="sound"', state.settings.sound, "Beeps", "ti-bell-ringing")}
    ${switchRow('data-setting="vibrate"', state.settings.vibrate, "Vibration", "ti-device-mobile-vibration")}
  </div>` : ""}

  ${sectionLabel("Data")}
  <div class="set-list">
    <button class="set-row set-row--danger" data-act="erase">
      <i class="ti ti-trash set-ic"></i><span class="set-label">${ui.confirm === "erase" ? "Tap again to erase everything" : "Erase all data"}
      <span class="set-unit">history, settings and benchmarks on this device${Sync.user ? " · you'll be signed out; your cloud copy stays" : ""}</span></span></button>
  </div>
  ${renderAccount()}

  ${ui.isStaff ? `${sectionLabel("Iron Forest staff")}<div class="set-list"><button class="set-row" data-go="review"><i class="ti ti-video set-ic"></i><span class="set-label">Review queue<span class="set-unit">Approve or reject video verifications</span></span></button></div>` : ""}

  ${sectionLabel("Health & safety")}
  <p class="hint hint--block">${HEALTH_NOTE} Stop if you feel chest pain, dizziness, or sharp or worsening pain.</p>
  <p class="hint"><a href="privacy.html">Privacy & safety</a> · ${Sync.user ? "Synced to your account" : "Everything stays on this device"}. Iron Forest ${APP_VERSION}</p>`;
}

/* ── Account & cloud sync ─────────────────────────────────────────────────── */
function syncStatusText() {
  const ago = ts => {
    if (!ts) return "not yet";
    const min = Math.round((Date.now() - ts) / 60000);
    return min < 1 ? "just now" : min < 60 ? `${min} min ago` : fmtDay(ts);
  };
  return {
    syncing: "Syncing…",
    idle: `Synced ${ago(state.sync.lastSyncedAt)}`,
    offline: "Offline. Changes sync when you're back online.",
    error: `Couldn't sync: ${Sync.error}`,
  }[Sync.status] || "";
}

function renderAccount() {
  if (!Sync.configured()) return "";
  const a = ui.auth;
  if (Sync.user) {
    return `
    ${sectionLabel("Account & sync")}
    <div class="set-list">
      <div class="set-row">
        <i class="ti ${Sync.status === "error" ? "ti-cloud-off" : "ti-cloud-check"} set-ic" aria-hidden="true"></i>
        <span class="set-label">${esc(Sync.user.email || "Signed in")}<span class="set-unit" data-bind="sync-status">${esc(syncStatusText())}</span></span>
      </div>
      ${myEmber() ? `<div class="set-row"><span class="ember-star set-ic">★</span><span class="set-label">Founding Ember #${myEmber()}<span class="set-unit">One of the first ${founding().limit} athletes in Iron Forest</span></span></div>` : ""}
      <button class="set-row" data-act="sync-now" ${Sync.status === "syncing" ? "disabled" : ""}><i class="ti ti-refresh set-ic"></i><span class="set-label">Sync now</span></button>
      <button class="set-row" data-act="sync-signout"><i class="ti ti-logout set-ic"></i><span class="set-label">Sign out<span class="set-unit">Workouts stay on this device</span></span></button>
      <button class="set-row set-row--danger" data-act="sync-delete"><i class="ti ti-user-x set-ic"></i>
        <span class="set-label">${ui.confirm === "account" ? "Tap again to delete your account" : "Delete account"}<span class="set-unit">Removes your cloud copy for good. This device keeps its workouts.</span></span></button>
    </div>`;
  }
  return `
  ${sectionLabel("Account & sync")}
  <div class="account">
    <p class="account-lead"><i class="ti ti-cloud"></i> Optional. Back up your workouts and use Iron Forest on more than one device. Without an account, everything stays on this device.</p>
    ${foundingNudge()}
    <button class="btn-secondary" data-act="sync-google" ${a.busy ? "disabled" : ""}><i class="ti ti-brand-google"></i> Continue with Google</button>
    <div class="or"><span>or</span></div>
    ${a.sent ? `
      <p class="account-lead">We sent a sign-in email to <b>${esc(a.email)}</b>. Tap the link in it, or type the 6-digit code here:</p>
      <div class="field-row">
        <input class="text-input" id="sync-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" value="${esc(a.code)}" aria-label="6-digit code">
        <button class="btn-primary btn-sm" data-act="sync-verify" ${a.busy ? "disabled" : ""}>Sign in</button>
      </div>
      <button class="text-btn" data-act="sync-reset">Use a different email</button>`
    : `
      <div class="field-row">
        <input class="text-input" id="sync-email" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(a.email)}" aria-label="Email address">
        <button class="btn-primary btn-sm" data-act="sync-email" ${a.busy ? "disabled" : ""}><i class="ti ti-mail"></i> Send link</button>
      </div>`}
    ${a.msg ? `<p class="hint ${a.error ? "hint--warn" : ""}">${esc(a.msg)}</p>` : ""}
  </div>`;
}

async function authAction(fn, okMsg = "") {
  ui.auth.busy = true; ui.auth.msg = ""; ui.auth.error = false; rerender();
  try { await fn(); ui.auth.msg = okMsg; }
  catch (e) { ui.auth.msg = e?.message || "Something went wrong. Try again."; ui.auth.error = true; }
  ui.auth.busy = false; rerender();
}

/* ── Player ───────────────────────────────────────────────────────────────── */
function startWorkout(templateId = ui.templateId, custom = null, programKey = null) {
  Cues.unlock();
  ui.templateId = templateId;
  const ps = programSession(programKey);
  const inPlan = ps && ps.t === templateId ? ps : null;
  let workout, timeline, swaps;
  if (custom) ({ workout, timeline, swaps } = custom);
  else {
    const plan = planFor(templateId, inPlan ? inPlan.params : paramsFor(templateId));
    ({ workout, timeline } = plan); swaps = plan.gear.swaps;
  }
  const mine = !custom && !inPlan ? activeMine(templateId) : null;
  if (mine) workout.name = mine.name;
  else if (inPlan?.name) workout.name = inPlan.name;
  ui.returnTo = ui.screen === "summary" ? ui.tab : ui.screen;
  ui.gate = null; ui.gateCount = null; ui.volOpen = false;
  session = { workout, timeline, swaps, startedAt: Date.now(), programKey: inPlan ? inPlan.key : null, ghost: custom?.ghost || null, mineId: mine?.id || null };
  engine = new IntervalEngine(timeline, { countdown: 3 });
  wireCues(engine);
  HandsFree.start();
  engine
    .on("interval", () => HandsFree.update()).on("pause", () => HandsFree.update()).on("resume", () => HandsFree.update())
    .on("countdown", () => updatePlayer())
    .on("go", () => { ui.go = true; setTimeout(() => { ui.go = false; if (ui.screen === "player") renderPlayer(); }, 700); })
    .on("interval", ({ reason, index }) => { gateCheck(index, reason); renderPlayer(); })
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
  WakeLock.release(); HandsFree.stop(); ui.pocketLock = false;
  const stats = engine.stats();
  // Cancelled before anything happened: go back to where the athlete started.
  if (early && stats.totalSec < 5) { engine = null; session = null; return go(ui.returnTo || "library"); }
  const t = TEMPLATES.find(x => x.id === session.workout.templateId);
  const before = new Set(badgeStatus(state.history, state.profile.goal).filter(b => b.earned).map(b => b.id));
  const rec = {
    id: uid(), date: session.startedAt, name: session.workout.name, templateId: session.workout.templateId, ...(session.mineId ? { mineId: session.mineId } : {}),
    params: session.workout.params, swaps: session.swaps, stats, early, challenge: session.workout.challenge || null,
    checkpoints: session.workout.challenge ? checkpointsFromVisits(session.timeline, engine.visits) : undefined,
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
  // A plan session counts once at least half of it is done.
  if (rec.saved && session.programKey && state.program && stats.intervalsTotal && stats.intervalsDone / stats.intervalsTotal >= 0.5) {
    state.program.done = { ...(state.program.done || {}), [session.programKey]: rec.id };
    rec.programKey = session.programKey;
    rec.programName = programById(state.program.id)?.name;
    if (activeProgram()?.complete && !state.program.completedAt) { state.program.completedAt = Date.now(); rec.programDone = true; }
  }
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
  const word = partWord();
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
/* ── Transitions: warm-up → workout → cool-down ────────────────────────────
   The player stops between the parts. The workout (and a challenge's clock)
   starts only when the athlete taps Start; warm-up time never counts. */
function gateFor(tl, index, reason) {
  const cur = tl[index], prev = tl[index - 1];
  if (!prev || reason === "prev") return null;
  if (prev.type === "WARM" && prev.phase === "warm" && cur.type !== "WARM") return "main";
  if (cur.type === "WARM" && cur.phase === "cool" && prev.type !== "WARM") return "cool";
  return null;
}
function gateCheck(index, reason) {
  const gate = gateFor(engine.timeline, index, reason);
  if (!gate) return;
  ui.gate = gate;
  engine.pause();
}
const isChallengeSession = () => !!session?.workout?.challenge;
const mainSecSoFar = () => engine.visits.filter(v => v.type !== "WARM").reduce((a, v) => a + v.ms, 0) / 1000;

function gateGo() {
  Cues.unlock();
  if (ui.gate === "cool") { ui.gate = null; ui.cooledDown = true; ui.gateResume = true; engine.resume(); return; }
  ui.gate = null; ui.gateCount = 3; renderPlayer(); Cues.beep(); Voice.play(["c3"]);
  const step = () => {
    if (!engine || ui.gateCount == null) return;
    ui.gateCount -= 1;
    if (ui.gateCount > 0) { renderPlayer(); Cues.beep(); Voice.play([`c${ui.gateCount}`]); setTimeout(step, 1000); return; }
    ui.gateCount = null; ui.go = true; renderPlayer(); Cues.go(); Cues.buzz(200);
    setTimeout(() => { ui.go = false; ui.gateResume = true; if (engine) engine.resume(); }, 700);   // resume re-renders the player and says the first interval
  };
  setTimeout(step, 1000);
}
function skipCooldown() {
  ui.gate = null; ui.cooledDown = true;
  engine.resume();
  while (engine && engine.phase === "running" && engine.current.type === "WARM") engine.next("skipped");
}

function renderGate() {
  const e = engine, iv = e.current;
  const ch = isChallengeSession() ? challengeById(session.workout.challenge.id) : null;
  const name = ch ? ch.name : session.workout.name;
  if (ui.gateCount != null || ui.go) {
    app.innerHTML = `
    <div class="player tone-${toneFor(iv)} is-countdown">
      <div class="pl-top"><span class="pl-round">${ch ? "Challenge" : "Workout"} starts</span>${soundButton()}</div>
      <div class="cd-wrap"><div class="cd-num ${ui.go ? "cd-go" : ""}">${ui.go ? "GO" : ui.gateCount}</div>
        <div class="cd-next">First up · <strong>${esc(iv.title)}</strong>${iv.target ? ` · ${esc(iv.target)}` : ""}</div></div>
    </div>`;
    return;
  }
  const main = ui.gate === "main";
  const rounds = iv.rounds > 1 ? `${iv.rounds} rounds` : `${iv.parts} part${iv.parts === 1 ? "" : "s"}`;
  app.innerHTML = `
  <div class="player tone-work is-gate">
    <div class="pl-top"><span class="pl-round">${main ? "Warm-up done" : ch ? "Challenge complete" : "Workout complete"}</span>${soundButton()}</div>
    <div class="gate">
      <i class="ti ${main ? "ti-flag-3" : "ti-trophy"} gate-ic" aria-hidden="true"></i>
      <h1 class="gate-title">${main ? `Ready for ${esc(name)}?` : ch ? `${esc(name)} done` : "Nice work"}</h1>
      ${main
        ? `<p class="gate-text">${ch ? "The challenge clock starts when you tap Start. Your warm-up time doesn't count." : `${rounds}. Take a breath, set up your first station.`}</p>
           <div class="gate-first">First up · <b>${esc(iv.title)}</b>${iv.target ? ` · ${esc(iv.target)}` : iv.duration ? ` · ${fmtShort(iv.duration)}` : ""}</div>`
        : `${ch && ch.scoring === "time" ? `<div class="gate-time"><span>Your time</span><b>${fmtClock(mainSecSoFar())}</b></div>` : ""}
           <p class="gate-text">Cool down for a few minutes: easy walking and stretching bring your heart rate down and help you recover.</p>`}
    </div>
    <div class="gate-actions">
      <button class="btn-primary gate-go" data-act="gate-go"><i class="ti ${main ? "ti-player-play" : "ti-stretching"}"></i> ${main ? (ch ? "Start challenge" : "Start workout") : "Start cool-down"}</button>
      ${main ? `<button class="btn-secondary" data-act="end"><i class="ti ti-x"></i> End</button>`
        : `<button class="btn-secondary" data-act="gate-skip-cool"><i class="ti ti-flag-check"></i> Skip cool-down and finish</button>`}
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
}

const partWord = () => (session?.workout?.challenge && challengeById(session.workout.challenge.id)?.partWord)
  || templateById(session.workout.templateId).roundWord || "Part";
/* "2 more rounds after this" / "Last round" */
function toGoText(iv) {
  if (iv.type === "WARM") return "";
  const tl = engine.timeline;
  if (iv.rounds > 1) {
    const left = iv.rounds - iv.round;
    return left === 0 ? "Last round" : `${left} more round${left === 1 ? "" : "s"} after this`;
  }
  const part = iv.part || tl.slice(engine.index).find(x => x.part)?.part;
  if (!part || iv.parts < 2) return "";
  const left = iv.parts - part, w = partWord().toLowerCase();
  return left === 0 ? `Last ${w}` : `${left} more ${w}${left === 1 ? "" : "s"} after this`;
}

/* Pocket lock: covers the player so nothing gets tapped by accident. Hold for a second to unlock. */
function pocketLockHtml() {
  return `<div class="pocket-lock" data-pocket-lock role="dialog" aria-label="Screen locked. Press and hold to unlock.">
    <i class="ti ti-lock pocket-ic" aria-hidden="true"></i>
    <div class="pocket-title">Locked</div>
    <div class="pocket-text">Headphones: press once to pause or start · twice for Done · three times to go back</div>
    <div class="pocket-hold"><span class="pocket-fill"></span>Press and hold to unlock</div>
  </div>`;
}
let pocketTimer = null;
document.addEventListener("pointerdown", ev => {
  const lock = ev.target.closest?.("[data-pocket-lock]");
  if (!lock) return;
  ev.preventDefault();
  lock.classList.add("is-holding");
  clearTimeout(pocketTimer);
  pocketTimer = setTimeout(() => { ui.pocketLock = false; Cues.beep(); renderPlayer(); }, 1000);
});
["pointerup", "pointercancel", "pointerleave"].forEach(t => document.addEventListener(t, () => {
  clearTimeout(pocketTimer); document.querySelector(".pocket-lock")?.classList.remove("is-holding");
}));

function renderPlayer() {
  if (!engine) return;
  const e = engine;
  const tl = e.timeline;
  if (ui.gate || ui.gateCount != null || (ui.go && e.phase === "running" && e.paused)) {
    renderGate();
    if (ui.pocketLock) app.insertAdjacentHTML("beforeend", pocketLockHtml());
    return;
  }

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
  else if (iv.split && seg) metric = seg.switch ? `Next · ${EXERCISES[seg.exId]?.name || ""}` : seg.target ? `Target ${seg.target}` : "";
  else if (iv.type === "WORK" && iv.target) metric = `Target ${iv.target}`;
  else if (iv.type === "REST" && upcoming) metric = `Next · ${upcoming.title}`;
  // To-target intervals: the target is the headline, the clock just counts up.
  const goal = iv.openEnded && iv.target ? `<div class="pl-goal"><span>${iv.type === "CARDIO" ? `${esc(iv.cue || iv.title)} to` : "Do"}</span><b>${esc(iv.target)}</b></div>` : "";
  const togo = toGoText(iv);

  // Sub-interval strip (HARD / EASY, Tabata WORK / REST)
  const segStrip = iv.segments.length ? `
    <div class="seg">
      <div class="seg-label tone-${tone} ${(seg?.label || "").length > 9 ? "seg-label--long" : ""}" data-bind="seg-label">${esc(seg?.label || "")}</div>
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
    : iv.split && seg ? (() => {
        const ex = EXERCISES[seg.exId] || {};
        return `<div class="pl-row">
        <span class="pl-k">${seg.switch ? "Switch to" : "Now"}</span>
        <div class="pl-v"><div class="pl-name">${esc(ex.name || "")}${seg.target ? ` · ${esc(seg.target)}` : ""}</div>
          <div class="pl-instr">${esc(seg.switch ? "Move to the next station and set up." : ex.instruction || "")}</div>
          <div class="pl-note">${esc(iv.title)} · move ${iv.segments.filter(s => !s.switch).indexOf(iv.segments.find(s => !s.switch && s.exId === seg.exId)) + 1} of ${iv.segments.filter(s => !s.switch).length}</div></div>
      </div>`; })()
    : `<div class="pl-row">
        <span class="pl-k">Now</span>
        <div class="pl-v"><div class="pl-name">${esc(iv.title)}</div>
          ${iv.instruction ? `<div class="pl-instr">${esc(iv.instruction)}</div>` : ""}
          ${iv.exercises.length > 1 ? exList(iv.exercises) : ""}
          ${iv.openEnded && iv.type === "WORK" ? `<div class="pl-note">For reps, not speed.</div>` : ""}
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
          <div class="pl-tags">${upcoming.openEnded ? (upcoming.type === "CARDIO" ? "To target" : "For reps") : fmtShort(upcoming.duration || 0)}${upcoming.target ? ` · Target ${esc(upcoming.target)}` : ""}${upcoming.speed ? ` · ${fmtSpeed(upcoming.speed)} MPH` : ""}${upcoming.segments.length ? ` · ${esc(upcoming.segments.map(s => s.label).slice(0, 3).join(" / "))}${upcoming.segments.length > 3 ? "…" : ""}` : ""}</div>
        </div>
      </div>`
    : `<div class="pl-row">
        <span class="pl-k">Next</span>
        <div class="pl-v"><div class="pl-name pl-name--dim">${(() => {
          const nm = iv.split ? iv.segments.slice(e.segIndex + 1).find(s => !s.switch) : null;
          return nm ? `${esc(EXERCISES[nm.exId]?.name || "")} · ${fmtShort(nm.end - nm.start)}` : next ? esc(nextLabel(next)) : "Finish";
        })()}</div></div>
      </div>`;

  const showDone = (iv.type === "WORK" && (iv.hasTarget || iv.openEnded)) || (iv.type === "CARDIO" && iv.openEnded);
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
    ${session?.ghost ? `<div class="ghost-line" data-bind="ghost" aria-live="polite">Ghost ready · ${esc(session.ghost.name)}</div>` : ""}
    <div class="pl-progress" aria-label="Workout progress">
      <div class="pl-progress-fill" data-bind="progress"></div>
      ${ticks.map(i => `<span class="pl-tick" style="left:${tickPos(i)}%"></span>`).join("")}
    </div>

    ${togo ? `<div class="pl-togo ${/^Last|^1 more/.test(togo) ? "is-close" : ""}">${togo}</div>` : ""}
    <div class="pl-state"><span>${e.paused ? "PAUSED" : iv.state}</span><i class="ti ${iv.icon}"></i></div>
    ${goal}
    ${segStrip}
    <div class="pl-timer ${goal ? "pl-timer--up" : ""}" data-bind="timer">${timerText()}</div>
    ${metric ? `<div class="pl-metric">${esc(metric)}</div>` : ""}

    <div class="pl-info">${nowBlock}${nextBlock}</div>

    ${iv.openEnded && !e.paused ? `
    <button class="done-big" data-act="done"><i class="ti ti-check"></i><span>Done</span><small>${iv.type === "CARDIO" ? `Tap when you reach ${esc(iv.target || "the target")}` : "Tap when the set is finished"}</small></button>` : ""}
    <div class="pl-controls">
      <button class="ctl" data-act="prev" aria-label="Previous interval"><i class="ti ti-player-skip-back"></i><span>Prev</span></button>
      <button class="ctl ${iv.openEnded && !e.paused ? "" : "ctl-main"}" data-act="pause" aria-label="${e.paused ? "Resume" : "Pause"}"><i class="ti ${e.paused ? "ti-player-play" : "ti-player-pause"}"></i><span>${e.paused ? "Resume" : "Pause"}</span></button>
      <button class="ctl" data-act="skip" aria-label="Skip interval" ${iv.fixed ? "disabled" : ""}><i class="ti ti-player-skip-forward"></i><span>Skip</span></button>
    </div>
    <div class="pl-controls pl-controls--sub">
      ${iv.duration != null && !iv.fixed ? `<button class="ctl ctl-wide ${iv.type === "REST" ? "ctl-hot" : ""}" data-act="extend"><i class="ti ti-clock-plus"></i><span>+10 sec</span></button>` : ""}
      ${showDone && !iv.openEnded && !iv.fixed ? `<button class="ctl ctl-wide" data-act="done"><i class="ti ti-check"></i><span>Reps done</span></button>` : ""}
      <button class="ctl ctl-wide ctl-ghost" data-act="pocket-lock" aria-label="Lock the screen for your pocket"><i class="ti ti-lock"></i><span>Lock</span></button>
      <button class="ctl ctl-wide ctl-ghost" data-act="end"><i class="ti ti-square"></i><span>End</span></button>
    </div>
    ${ui.pocketLock ? pocketLockHtml() : ""}
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
  if (n.type === "CARDIO") return `${n.title} · ${n.duration ? fmtShort(n.duration) : n.target || "to target"}${n.speed ? ` @ ${fmtSpeed(n.speed)} MPH` : ""}${n.roundStart && n.rounds > 1 ? ` · Round ${n.round}` : ""}`;
  if (n.type === "REST") return `${n.title === "Rest / Transition" ? "Rest" : n.title} · ${fmtShort(n.duration)}`;
  return `${n.title}${n.duration ? ` · ${fmtShort(n.duration)}` : " · for reps"}`;
}

function segMeta(iv, si) {
  const s = iv.segments[si];
  if (!s) return "";
  if (iv.split) {
    const moves = iv.segments.filter(x => !x.switch);
    const n = moves.findIndex(x => x.exId === s.exId) + 1;
    return s.switch ? `Next · move ${n} of ${moves.length}` : `Move ${n} of ${moves.length}${n < moves.length ? " · then switch" : " · last move"}`;
  }
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
  if (!engine || ui.screen !== "player" || ui.gate || ui.gateCount != null) return;
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
    const ch = session?.workout?.challenge && challengeById(session.workout.challenge.id);
    if (ch && ch.scoring === "time") {
      const warm = e.visits.filter(v => v.type === "WARM").reduce((a, v) => a + v.ms, 0) / 1000 + (e.current.type === "WARM" ? e.elapsedMs() / 1000 : 0);
      const tgt = session.workout.challenge.target;
      clock.textContent = `Total ${fmtClock(doneSec - warm)}${tgt && ch.better === "lower" && !session.ghost ? ` · ${tgt.name} ${formatScore(ch, tgt.score)}` : ""}`;
      const gl = app.querySelector('[data-bind="ghost"]');
      if (gl && session.ghost && e.current.type !== "WARM") {
        const line = ghostLine(e, doneSec - warm);
        gl.textContent = line;
        gl.classList.toggle("ahead", /AHEAD/.test(line));
        gl.classList.toggle("behind", /BEHIND/.test(line));
      }
    } else clock.textContent = `${fmtClock(doneSec)} · ${fmtClock(left)} left`;
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
    <div class="hero-daycount">${esc(s.name)} · ${fmtDate(s.date)}</div>
    <div class="done-top">
      <h1 class="done-title">${s.early ? "Workout<br>ended" : "Workout<br>complete"}</h1>
      <div class="ring-wrap ring-wrap--sm">
        ${ringSVG(pct, { size: 96, stroke: 8, label: `${Math.round(pct * 100)}% completed` })}
        <div class="ring-center"><b>${Math.round(pct * 100)}<small>%</small></b><span>done</span></div>
      </div>
    </div>
    ${!s.saved && !fromHistory ? `<p class="hint">Less than a minute, so this one wasn't saved.</p>` : ""}
  </section>

  ${s.programKey && !fromHistory ? (() => { const st = activeProgram(); return st ? `<div class="gear-note"><i class="ti ti-calendar-event"></i> ${s.programDone ? `${esc(st.prog.name)} complete. Well done.` : `${esc(st.prog.name)} · ${st.doneCount} of ${st.total} sessions done`}</div>` : ""; })() : ""}
  ${s.challenge && challengeById(s.challenge.id) ? challengeResultBlock(s) : ""}
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

/* ── Events ────────────────────────────────────────────────────────────────── */

app.addEventListener("change", ev => {
  if (ev.target.classList?.contains("vol-slider")) { save(); volumeSample(); return; }
  handlePlansChange(ev);
});
/* A short sound at the new level, so the athlete hears what they picked (mid-workout: just a beep). */
function volumeSample() {
  if (ui.screen === "player" || coachVoice() === "off") Cues.beep(); else Voice.play(["halfway"]);
}

app.addEventListener("input", ev => {
  if (ev.target.classList?.contains("vol-slider")) {
    Cues.unlock(); Cues.setVolume(Number(ev.target.value) / 100);
    const out = app.querySelector('[data-bind="vol-pct"]'); if (out) out.textContent = `${ev.target.value}%`;
    return;
  }
  if (handlePlansInput(ev)) return;
  if (ev.target.id === "athlete-search") { searchAthletes(ev.target.value.trim()); return; }
  if (ev.target.id === "club-search") { searchClubs(ev.target.value.trim()); return; }
  if (ev.target.id === "ghost-target") { ui.ghost = { ...(ui.ghost || {}), target: ev.target.value }; return; }
  if (ui.clubDraft && ["club-name", "club-city", "club-country", "club-desc"].includes(ev.target.id)) {
    ui.clubDraft[{ "club-name": "name", "club-city": "city", "club-country": "country", "club-desc": "description" }[ev.target.id]] = ev.target.value; return;
  }
  if (ev.target.id === "comment-input" && ui.activity) { ui.activity.draft = ev.target.value; return; }
  if (ui.athleteDraft && ["ath-name", "ath-handle", "ath-birth", "ath-city", "ath-country"].includes(ev.target.id)) {
    const key = { "ath-name": "displayName", "ath-handle": "handle", "ath-birth": "birthYear", "ath-city": "city", "ath-country": "country" }[ev.target.id];
    ui.athleteDraft[key] = ev.target.value;
    return;
  }
  if (ev.target.dataset.result && ui.summary?.resultDraft) { ui.summary.resultDraft.values[ev.target.dataset.result] = ev.target.value; return; }
  if (ev.target.id === "sync-email") { ui.auth.email = ev.target.value.trim(); return; }
  if (ev.target.id === "sync-code") { ui.auth.code = ev.target.value.replace(/\D/g, ""); return; }
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

app.addEventListener("click", async ev => {
  const el = ev.target.closest("[data-act],[data-go],[data-step],[data-setting],[data-template],[data-history],[data-swap],[data-param-toggle],[data-profile-toggle],[data-checkin],[data-time],[data-feel],[data-goal],[data-p-level],[data-p-equip],[data-ob-goal],[data-ob-level],[data-ob-equip],[data-f-time],[data-f-type],[data-f-level],[data-program],[data-session],[data-challenge],[data-cvariant],[data-cboard],[data-any-move],[data-cdivision],[data-bench-filter],[data-board-scope],[data-board-cat],[data-board-age],[data-res-division],[data-res-verify],[data-ath-category],[data-ath-division],[data-ath-visibility],[data-ath-activity],[data-compete-view],[data-athlete],[data-comments],[data-react],[data-follow],[data-del-comment],[data-event],[data-event-division],[data-standings-division],[data-ghost],[data-review],[data-club],[data-club-join],[data-club-kind],[data-club-open],[data-battle-scope],[data-board-where],[data-pd-day],[data-pd-goal],[data-pd-min],[data-slot-change],[data-slot-remove],[data-pick],[data-pick-mine],[data-mine],[data-remind-at],[data-remind-day],[data-hall-division],[data-month-time],[data-month-remind],[data-coach]");
  if (!el) return;
  const d = el.dataset;
  if (!["erase", "delete-history", "program-join", "program-leave", "sync-delete", "plan-delete", "mine-delete"].includes(d.act)) ui.confirm = null;

  if (d.go) return go(d.go);
  if (handlePlansClick(d)) return;
  if (handleMonthlyClick(d)) return;
  if (handleCompeteClick(d)) return;
  if (await handleCommunityClick(d)) return;
  if (await handleEventsClick(d)) return;
  if (await handleClubsClick(d)) return;
  if (d.step) return stepParam(d.step, Number(d.dir));
  if (d.paramToggle) {
    writeParams(ui.templateId, { [d.paramToggle]: !paramsFor(ui.templateId)[d.paramToggle] });
    save(); return rerender();
  }
  if (d.profileToggle) { state.profile[d.profileToggle] = !state.profile[d.profileToggle]; save(); return rerender(); }
  if (d.coach) {
    state.settings.coach = d.coach === "off" ? state.settings.coach : d.coach;
    state.settings.voice = d.coach !== "off"; save();
    if (d.coach !== "off") { Cues.unlock(); Voice.play(["preview"]); } else Voice.stop();
    return rerender();
  }
  if (d.setting) {
    const k = d.setting;
    state.settings[k] = !state.settings[k]; save();
    if (k === "sound" && state.settings.sound) { Cues.unlock(); Cues.beep(); }
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
    writeSwaps(ui.templateId, { ...swapsFor(ui.templateId), [d.swap]: d.to }); save();
    return rerender();
  }
  if (d.program) { ui.programId = d.program; ui.screen = "program"; return render(); }
  if (d.session) {
    ui.mineId = null;
    const ps = programSession(d.session);
    if (ps) { ui.templateId = ps.t; ui.programKey = ps.key; ui.screen = "setup"; render(); }
    return;
  }
  if (d.template) {
    ui.programKey = null; ui.mineId = null;
    ui.templateId = d.template; state.lastTemplate = ui.templateId; save();
    ui.screen = "setup"; return render();
  }
  if (d.history) {
    const h = state.history.find(x => x.id === d.history);
    if (h) { ui.summary = h; ui.viewingHistory = true; ui.screen = "summary"; render(); }
    return;
  }

  switch (d.act) {
    case "start": return startWorkout(ui.templateId, null, d.key || null);
    case "plan-start": ui.mineId = null; return startWorkout(d.id, null, d.key);
    case "program-join":
      if (state.program && state.program.id !== d.id && !state.program.completedAt && ui.confirm !== "switch") { ui.confirm = "switch"; return rerender(); }
      state.program = { id: d.id, startedAt: Date.now(), done: {} }; ui.confirm = null; save();
      toast(`${programById(d.id).name} started`); return rerender();
    case "program-leave":
      if (ui.confirm !== "leave") { ui.confirm = "leave"; return rerender(); }
      state.program = null; ui.confirm = null; save(); toast("Plan ended"); return rerender();
    case "ob-ack": ui.ob.ack = !ui.ob.ack; return rerender();
    case "ob-no-equipment": ui.ob.equipment = ui.ob.equipment.includes("outdoors") ? ["outdoors"] : []; return rerender();
    case "sync-email":
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ui.auth.email)) { ui.auth.msg = "Enter a valid email address."; ui.auth.error = true; return rerender(); }
      return authAction(async () => { await Sync.sendEmail(ui.auth.email); ui.auth.sent = true; });
    case "sync-verify":
      if (ui.auth.code.length !== 6) { ui.auth.msg = "Enter the 6-digit code from the email."; ui.auth.error = true; return rerender(); }
      return authAction(async () => { await Sync.verifyCode(ui.auth.email, ui.auth.code); ui.auth = { email: "", code: "", sent: false, busy: false, msg: "", error: false }; });
    case "sync-reset": ui.auth = { email: ui.auth.email, code: "", sent: false, busy: false, msg: "", error: false }; return rerender();
    case "sync-google": return authAction(() => Sync.google());
    case "sync-now": Sync.run(); return rerender();
    case "sync-signout": await Sync.signOut(); toast("Signed out"); return rerender();
    case "sync-delete":
      if (ui.confirm !== "account") { ui.confirm = "account"; return rerender(); }
      ui.confirm = null;
      try { await Sync.deleteAccount(); toast("Account deleted"); } catch (e) { toast(`Couldn't delete: ${e.message}`); }
      return rerender();
    case "health-ack": state.profile.healthAck = Date.now(); save(); return rerender();
    case "quick-start": ui.mineId = null; return startWorkout(d.id);
    case "start-recovery": return startWorkout("recovery", recoveryWorkout());
    case "pause": return engine?.toggle();
    case "skip": return engine?.current?.fixed ? toast("This block is the same length for everyone. Keep moving!") : engine?.next();
    case "prev": return engine?.prev();
    case "extend": return engine?.extend(10);
    case "done": return engine?.done();
    case "gate-go": return gateGo();
    case "pocket-lock": ui.pocketLock = true; renderPlayer(); return Voice.play(["locked"]);
    case "gate-skip-cool": return skipCooldown();
    case "end":
      if (engine?.phase === "countdown") { engine.end(); return; }
      ui.confirmEnd = true; return renderPlayer();
    case "end-cancel": ui.confirmEnd = false; return renderPlayer();
    case "end-confirm": ui.confirmEnd = false; return engine?.end();
    case "voice-preview": Cues.unlock(); Voice.play(["preview"]); return;
    case "toggle-audio": {
      Cues.unlock();
      Cues.setMuted(!state.settings.muted); save();
      if (!state.settings.muted) Cues.beep();
      return ui.screen === "player" ? renderPlayer() : rerender();
    }
    case "volume-open": ui.volOpen = !ui.volOpen; return ui.screen === "player" ? renderPlayer() : rerender();
    case "volume-step": {
      Cues.unlock();
      if (state.settings.muted) Cues.setMuted(false);
      Cues.setVolume(Math.round(((state.settings.volume ?? 1) + Number(d.dir) * 0.1) * 10) / 10); save();
      volumeSample();
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
      if (s.challenge) return startChallenge(s.challenge.id, s.challenge.variant, s.attempt?.division || s.challenge.division);
      if (s.mineId && mineById(s.mineId)) { ui.mineId = s.mineId; return startWorkout(s.templateId); }
      state.params[s.templateId] = { ...(state.params[s.templateId] || {}), ...s.params };
      if (s.swaps) state.swaps[s.templateId] = { ...s.swaps };
      save();
      return startWorkout(s.templateId);
    }
    case "delete-history":
      if (ui.confirm !== "delete") { ui.confirm = "delete"; return rerender(); }
      state.history = state.history.filter(h => h.id !== ui.summary.id);
      state.deleted = { ...state.deleted, [ui.summary.id]: deletionStamp(ui.summary) };
      save();
      ui.confirm = null;
      return go(ui.viewingHistory ? "history" : "today");
    case "erase":
      if (ui.confirm !== "erase") { ui.confirm = "erase"; return rerender(); }
      // Erases this device only; the cloud copy stays and returns on the next sign-in.
      if (Sync.user) await Sync.signOut().catch(() => {});
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      Object.assign(state, loadState());
      ui.confirm = null; ui.ob = { goal: 3, level: "intermediate", equipment: [...ALL_EQUIPMENT] };
      return go("onboarding");
    case "ob-done":
      if (!ui.ob.ack) return;
      Object.assign(state.profile, { goal: ui.ob.goal, level: ui.ob.level, equipment: [...ui.ob.equipment], onboarded: true, healthAck: Date.now() });
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
  writeParams(t.id, { [key]: v });
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
window.__IRONFOREST__ = { TEMPLATES, EXERCISES, IntervalEngine, compile, createWorkout, resolveSegments, swappableIds, planTotals, planFor, recommend, version: APP_VERSION };

restoreEventChallenges();
render();
Sync.init(changed => {
  loadFounding();
  if (ui.screen === "player" || document.activeElement?.matches?.("input")) return;
  if (Sync.user && ui.isStaff === undefined) { ui.isStaff = false; Sync.isStaff().then(v => { ui.isStaff = v; if (v && ui.screen === "profile") rerender(); }); }
  if (changed || ui.screen === "profile") rerender();
});
