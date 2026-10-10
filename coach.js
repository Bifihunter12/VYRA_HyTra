"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   Iron Forest — Voice coach: what the coach says, and when.
   Every line has a stable id. The lines are recorded once with a natural
   neural voice (tools/voice, female and male) and shipped as audio/voice/*;
   the player plays the recording, or falls back to the device voice for a
   line that has no recording yet. No DOM here, so it runs in Node too.
   ════════════════════════════════════════════════════════════════════════════ */

const COACH_VOICES = {
  female: { model: "af_heart",   label: "Female", name: "Heart" },
  male:   { model: "am_fenrir+am_onyx", label: "Male", name: "Fenrir" },
};

/* Fixed lines. Short, warm, like a coach standing next to you. */
const COACH_LINES = {
  "c3": "Three.", "c2": "Two.", "c1": "One.", "go": "Go!",
  "warmup-start": "Alright, let's warm up. Nice and easy, get the blood moving.",
  "warmup-done": "Warm up done. Nice. Take a breath, get set up, and tap start when you're ready.",
  "cooldown": "Let's cool down. Slow it right down and breathe.",
  "workout-done": "That's it, workout complete. Great job today.",
  "challenge-done": "Done! Clock's stopped. That was a big effort.",
  "escaped": "You made it out. You escaped the Iron Forest! Clock's stopped.",
  "ended": "Workout ended. Good work today.",
  "cooldown-done": "Nicely done. Drink some water, and I'll see you next time.",
  "paused": "Paused.", "resume": "And we're back.",
  "rest-1": "Rest.", "rest-2": "Nice work. Take a breather.", "rest-3": "Good. Shake it out.", "rest-4": "Breathe. You earned that.",
  "ten-work": "Ten seconds. Finish strong!", "ten-rest": "Ten seconds. Get ready.",
  "halfway": "Halfway there.",
  "enc-1": "You're doing great. Stay smooth.", "enc-2": "Strong. Keep breathing.", "enc-3": "Good form beats fast reps.",
  "enc-4": "Stay with it.", "enc-5": "Relax the shoulders. Keep moving.", "enc-6": "That's it. Keep it steady.",
  "last-round": "Last round. Make it count!",
  "togo-1": "One more after this.", "togo-2": "Two more rounds after this.", "togo-3": "Three more rounds after this.",
  "tap-done": "Tap done when the set is finished.", "tap-done-dist": "Tap done when you hit the distance.",
  "seg-switch": "Switch. Move to the next one.",
  "seg-hard": "Hard! Push the pace.", "seg-easy": "Easy. Recover.", "seg-work": "Work!", "seg-rest": "Rest.",
  "preview": "Hey, I'm your Iron Forest coach. Round three. Kettlebell swings, let's go. Snap those hips!",
};
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

const firstSentence = s => (String(s || "").match(/^.*?[.!?](\s|$)/) || [String(s || "")])[0].trim();
const sentence = s => { s = String(s || "").trim(); return s ? s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".") : ""; };

/* Targets as a coach would say them: "~20 reps" → "About 20 reps." */
function speakTarget(t) {
  return sentence(String(t).replace(/~/g, "about ").replace(/\s*\+\s*/g, ", then ").replace(/\/side/g, " each side")
    .replace(/(\d)\s*[–-]\s*(\d)/g, "$1 to $2").replace(/\bRDLs\b/g, "R D Ls").replace(/(\d) total\b/g, "$1 in total")
    .replace(/\b1\s?km\b/g, "1 kilometer").replace(/(\d)\s?km\b/g, "$1 kilometers").replace(/(\d)\s?m\b/g, "$1 meters").replace(/(\d)\s?mi\b/g, "$1 miles"));
}

/* The text behind any line id. */
function coachText(id) {
  if (COACH_LINES[id]) return COACH_LINES[id];
  const [kind, ...rest] = id.split(":");
  const arg = rest.join(":");
  const e = typeof EXERCISES !== "undefined" ? EXERCISES[arg] : null;
  if (kind === "go" && e) return `${sentence(e.cue || e.name)} ${firstSentence(e.instruction)}`.trim();
  if (kind === "next" && e) return `Up next, ${String(e.cue || e.name).replace(/^(Warm up|Cool down)\.\s*/i, "").toLowerCase()}.`;
  if (kind === "cue") return sentence(arg);
  if (kind === "t") return speakTarget(arg);
  if (kind === "mph") return `Treadmill at ${Number(arg)}.`;
  if (kind === "round") return Number(arg) === 1 ? "Round one. Here we go." : `Round ${NUMBER_WORDS[arg] || arg}.`;
  return "";
}

const MPH_STEPS = Array.from({ length: 101 }, (_, i) => (2 + i / 10).toFixed(1));
const speedKey = v => `mph:${Number(v).toFixed(1)}`;

/* The line that opens an interval: one exercise → its own line, several → the station's cue. */
function introKey(iv) {
  if (iv.exId) return `go:${iv.exId}`;
  if (iv.exercises?.length === 1) return `go:${iv.exercises[0].id}`;
  return `cue:${iv.cue || iv.title}`;
}
function nextKey(iv) {
  if (!iv) return null;
  const id = iv.exId || (iv.exercises?.length === 1 ? iv.exercises[0].id : null);
  return id ? `next:${id}` : `cue:Up next, ${String(iv.cue || iv.title).toLowerCase()}`;
}

/* Every line a timeline can use (for recording and for preloading). */
function timelineLines(timeline) {
  const ids = new Set(["c3", "c2", "c1", "go"]);
  timeline.forEach((iv, i) => {
    if (iv.type === "REST") { const n = timeline.slice(i + 1).find(x => x.type !== "REST"); if (n) ids.add(nextKey(n)); return; }
    ids.add(introKey(iv));
    if (iv.story) ids.add(`cue:${iv.story}`);
    if (iv.target) ids.add(`t:${iv.target}`);
    (iv.segments || []).forEach(sg => {
      if (sg.switch) { ids.add("seg-switch"); ids.add(`next:${sg.exId}`); }
      else if (sg.exId) { ids.add(`go:${sg.exId}`); if (sg.target) ids.add(`t:${sg.target}`); }
    });
    if (iv.speed) ids.add(speedKey(iv.speed));
    if (iv.rounds > 1 && iv.roundStart) ids.add(iv.round === iv.rounds ? "last-round" : `round:${iv.round}`);
  });
  return ids;
}

/* What to say as the workout moves along. Keeps a little memory so it doesn't repeat itself. */
class CoachScript {
  constructor(timeline, { challenge = false } = {}) {
    this.tl = timeline; this.challenge = challenge;
    this.restN = 0; this.encN = 0; this.toldDone = new Set();
  }
  countdown(n) { return [`c${n}`]; }
  start() { return ["go"]; }
  /* Entering interval `index`. `gate` = "main" | "cool" when the player stops for a transition. */
  interval(index, reason, gate = null) {
    const iv = this.tl[index], prev = this.tl[index - 1];
    if (gate === "main") return ["warmup-done"];
    if (gate === "cool") return [this.doneLine()];
    return this.intro(iv, prev, reason);
  }
  intro(iv, prev) {
    if (!iv) return [];
    if (iv.type === "WARM") {
      const first = !prev || prev.type !== "WARM";
      return [first ? (iv.phase === "warm" ? "warmup-start" : "cooldown") : null, `go:${iv.exId}`].filter(Boolean);
    }
    if (iv.type === "REST") {
      const next = this.tl.slice(this.tl.indexOf(iv) + 1).find(x => x.type !== "REST");
      const rest = `rest-${(this.restN++ % 4) + 1}`;
      return [rest, next && !(next.roundStart && next.rounds > 1) ? nextKey(next) : null].filter(Boolean);
    }
    const out = [];
    if (iv.rounds > 1 && iv.roundStart) {
      const left = iv.rounds - iv.round;
      if (left === 0) out.push("last-round");
      else { out.push(`round:${iv.round}`); if (left <= 3 && iv.round > 1) out.push(`togo-${left}`); }
    }
    if (iv.story) out.push(`cue:${iv.story}`);                  // story challenges: the stage line says it all
    else if (iv.split && iv.segments[0]) out.push(...this.segment(iv.segments[0]));
    else { out.push(introKey(iv)); if (iv.target) out.push(`t:${iv.target}`); }
    if (iv.speed) out.push(speedKey(iv.speed));
    if (iv.openEnded && !iv.story) {
      const key = iv.type === "CARDIO" ? "tap-done-dist" : "tap-done";
      if (!this.toldDone.has(key)) { this.toldDone.add(key); out.push(key); }
    }
    return out;
  }
  /* Seconds left in a timed interval. */
  second(iv, remaining, durationSec) {
    if (!iv || iv.type === "WARM") return [];
    if (remaining === 10 && durationSec >= 30) return [iv.type === "REST" ? "ten-rest" : "ten-work"];
    if (iv.type !== "REST" && durationSec >= 90 && remaining === Math.round(durationSec / 2)) return [this.encN++ % 2 ? `enc-${(this.encN % 6) + 1}` : "halfway"];
    return [];
  }
  segment(seg) {
    if (seg?.switch) return ["seg-switch", `next:${seg.exId}`];
    if (seg?.exId) return [`go:${seg.exId}`, seg.target ? `t:${seg.target}` : null].filter(Boolean);
    const k = `seg-${String(seg?.label || "").toLowerCase()}`; return COACH_LINES[k] ? [k] : [];
  }
  /* `afterGate`: the finish was already announced on the cool-down screen. */
  finish(early, afterGate = false) { return [early ? "ended" : afterGate ? "cooldown-done" : this.doneLine()]; }
  doneLine() { return this.challenge === "the-escape" ? "escaped" : this.challenge ? "challenge-done" : "workout-done"; }
}

/* All lines for the recording: fixed lines, every exercise, speeds, rounds, plus whatever the given timelines use. */
function coachCatalog(timelines = []) {
  const ids = new Set(Object.keys(COACH_LINES));
  Object.keys(EXERCISES).forEach(id => { ids.add(`go:${id}`); ids.add(`next:${id}`); });
  MPH_STEPS.forEach(v => ids.add(`mph:${v}`));
  for (let r = 1; r <= 20; r++) ids.add(`round:${r}`);
  timelines.forEach(tl => timelineLines(tl).forEach(id => ids.add(id)));
  return [...ids].sort().map(id => ({ id, text: coachText(id) })).filter(x => x.text);
}

/* A short, stable file name for a line (ids can contain spaces and symbols). */
function coachFile(id) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < id.length; i++) { const c = id.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
  return `${h1.toString(36)}${h2.toString(36)}.mp3`;
}
