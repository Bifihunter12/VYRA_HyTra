"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Exercise library + workout templates
   Exercises are defined once and referenced by id. Substitutions live on the
   exercise (`subs`), so one template covers every equipment variation.
   ════════════════════════════════════════════════════════════════════════════ */

/* Exercise
   { name, cue?, instruction, equipment: [], subs?: [ids],
     cardio?: true, state?: "RUN"|"ROW"|"BIKE"|"WALK"|"CARDIO", speed?: true,
     effort?: string  — shown under the timer for cardio }                     */
const EXERCISES = {
  // ── Cardio ──────────────────────────────────────────────────────────────
  "run":          { name: "Treadmill Run", cue: "Run", state: "RUN", cardio: true, speed: true, equipment: ["treadmill"],
                    subs: ["incline-walk", "bike", "row"], instruction: "Steady, controlled pace." },
  "row":          { name: "Row", cue: "Row", state: "ROW", cardio: true, equipment: ["rower"], effort: "Steady · 22–26 strokes/min",
                    subs: ["bike", "run", "incline-walk"], instruction: "Legs, then hips, then arms. Long, controlled strokes." },
  "bike":         { name: "Bike", cue: "Bike", state: "BIKE", cardio: true, equipment: ["bike"], effort: "Steady · 80–90 rpm",
                    subs: ["row", "run", "step-ups"], instruction: "Smooth cadence, light grip, breathe through the nose when you can." },
  "incline-walk": { name: "Brisk Incline Walk", cue: "Incline walk", state: "WALK", cardio: true, equipment: ["treadmill"], effort: "Brisk walk",
                    instruction: "Steep incline, brisk pace, hands off the rails." },
  "step-ups":     { name: "Step-ups", cue: "Step ups", state: "CARDIO", cardio: true, equipment: [], effort: "Steady rhythm",
                    instruction: "Box or bench. Drive through the whole foot, alternate legs." },
  "cardio-choice":{ name: "Athlete's Choice", cue: "Cardio, your choice", state: "CARDIO", cardio: true, equipment: [], effort: "Your choice",
                    subs: ["run", "row", "bike"], instruction: "Pick any machine and hold a strong, steady pace." },

  // ── Battle ropes + replacements ─────────────────────────────────────────
  "battle-ropes":  { name: "Battle Ropes", cue: "Battle ropes", equipment: ["battle-ropes"],
                     subs: ["kb-swing-fast", "db-ski-punch", "high-knee-march", "bike-sprint", "row-sprint", "shadow-boxing", "rapid-step-ups"],
                     instruction: "Fast alternating waves. Soft knees, brace your core." },
  "kb-swing-fast": { name: "Fast KB Swings", cue: "Fast kettlebell swings", equipment: ["kettlebell"], instruction: "Snap the hips, quick tempo, bell to chest height." },
  "db-ski-punch":  { name: "Ski-style DB Punches", cue: "Dumbbell ski punches", equipment: ["dumbbell"], instruction: "Light dumbbells, fast downward ski pulls into punches." },
  "high-knee-march": { name: "High-knee Power March", cue: "High knee march", equipment: [], instruction: "Drive knees to hip height, pump the arms hard." },
  "bike-sprint":   { name: "Bike Sprint", cue: "Bike sprint", equipment: ["bike"], instruction: "All-out cadence, then hold it." },
  "row-sprint":    { name: "Row Sprint", cue: "Row sprint", equipment: ["rower"], instruction: "Hard, fast strokes. Legs first." },
  "shadow-boxing": { name: "Shadow Boxing", cue: "Shadow boxing", equipment: [], instruction: "Fast combinations, stay light on your feet." },
  "rapid-step-ups":{ name: "Rapid Step-ups", cue: "Rapid step ups", equipment: [], instruction: "Low box, quick alternating steps." },

  // ── Kettlebell ──────────────────────────────────────────────────────────
  "kb-swing":      { name: "KB Swings", cue: "Kettlebell swings", equipment: ["kettlebell"], subs: ["db-swing", "kb-deadlift", "db-rdl"],
                     instruction: "Hinge, hike the bell back, snap the hips. Arms are ropes." },
  "db-swing":      { name: "DB Swings", cue: "Dumbbell swings", equipment: ["dumbbell"], instruction: "Hold one dumbbell by the head. Hinge and snap the hips." },
  "kb-deadlift":   { name: "KB Deadlifts", cue: "Kettlebell deadlifts", equipment: ["kettlebell"], instruction: "Bell between the feet, flat back, stand tall." },
  "kb-clean":      { name: "KB Cleans", cue: "Kettlebell cleans", equipment: ["kettlebell"], subs: ["db-clean", "high-pull", "deadlift-front-rack"],
                     instruction: "Keep the bell close, let it roll around the wrist into the rack. Switch sides as needed." },
  "db-clean":      { name: "DB Cleans", cue: "Dumbbell cleans", equipment: ["dumbbell"], instruction: "Pull from the hip, catch at the shoulder with soft knees." },
  "high-pull":     { name: "High Pulls", cue: "High pulls", equipment: ["kettlebell"], instruction: "Drive the hips, pull the elbow high and back." },
  "deadlift-front-rack": { name: "Deadlift to Front Rack", cue: "Deadlift to front rack", equipment: ["kettlebell"], instruction: "Deadlift, pause, then guide the bell into the rack. Slow and clean." },
  "kb-front-squat":{ name: "KB Front Squats", cue: "Front squats", equipment: ["kettlebell"], instruction: "Bell in the rack, elbow tucked, sit between the hips." },
  "kb-push-press": { name: "KB Push Press", cue: "Push press", equipment: ["kettlebell"], instruction: "Small dip, drive with the legs, lock out overhead. Switch sides as needed." },
  "kb-row":        { name: "One-arm KB Rows", cue: "One arm rows", equipment: ["kettlebell"], instruction: "Hinge, flat back, pull the bell to the hip." },
  "kb-reverse-lunge": { name: "KB Reverse Lunges", cue: "Reverse lunges", equipment: ["kettlebell"], instruction: "Bell in the rack or at your side. Step back, alternate legs." },
  "kb-suitcase-carry": { name: "KB Suitcase Carry", cue: "Suitcase carry", equipment: ["kettlebell"], subs: ["farmer-march"], instruction: "One bell at your side. Stay tall, don't lean. Switch sides halfway." },
  "clean-thruster":{ name: "Clean + Thruster", cue: "Clean and thruster", equipment: ["kettlebell"], subs: ["db-thruster", "squat-press", "goblet-squat"],
                     instruction: "Clean to the rack, front squat, drive straight into the press." },
  "db-thruster":   { name: "DB Thrusters", cue: "Dumbbell thrusters", equipment: ["dumbbell"], instruction: "Squat with the dumbbells at your shoulders, drive up into a press." },
  "squat-press":   { name: "Squat + Press", cue: "Squat and press", equipment: ["dumbbell"], instruction: "Full squat, stand, then press. Two separate movements." },

  // ── Dumbbell / either ───────────────────────────────────────────────────
  "goblet-squat":  { name: "Goblet Squats", cue: "Goblet squats", equipment: ["dumbbell"], instruction: "One heavy weight at the chest. Sit deep, chest up, drive through the heels." },
  "db-squat":      { name: "DB Squats", cue: "Dumbbell squats", equipment: ["dumbbell"], instruction: "Dumbbells at your sides or shoulders. Full depth, stand tall." },
  "db-row":        { name: "One-arm DB Rows", cue: "Dumbbell rows", equipment: ["dumbbell"], instruction: "Support on a bench or knee. Pull to the hip, control down." },
  "bent-over-row": { name: "Bent-over DB Rows", cue: "Bent over rows", equipment: ["dumbbell"], instruction: "Hinge to 45 degrees, flat back, row both dumbbells to the ribs." },
  "db-rdl":        { name: "DB RDLs", cue: "Romanian deadlifts", equipment: ["dumbbell"], instruction: "Soft knees, push the hips back, weights close to the legs." },
  "db-floor-press":{ name: "DB Floor Press", cue: "Floor press", equipment: ["dumbbell"], instruction: "Lie on the floor, elbows at 45 degrees, press to lockout." },
  "shoulder-press":{ name: "DB Shoulder Press", cue: "Shoulder press", equipment: ["dumbbell"], instruction: "Brace, ribs down, press straight overhead." },
  "push-press":    { name: "DB Push Press", cue: "Push press", equipment: ["dumbbell"], instruction: "Small dip, drive with the legs, lock out overhead." },
  "reverse-lunge": { name: "Reverse Lunges", cue: "Reverse lunges", equipment: ["dumbbell"], instruction: "Step back, lower the back knee toward the floor, alternate legs." },
  "squat-to-press":{ name: "Squat to Press", cue: "Squat to press", equipment: ["dumbbell"], subs: ["db-thruster", "goblet-squat"], instruction: "Squat with dumbbells at the shoulders, stand and press in one motion." },
  "farmer-carry":  { name: "Farmer Carry", cue: "Farmer carry", equipment: ["dumbbell"], subs: ["farmer-march"], instruction: "Heavy weights at your sides. Shoulders down, short quick steps." },
  "farmer-march":  { name: "Farmer March", cue: "Farmer march", equipment: ["dumbbell"], instruction: "Heavy weights at your sides, march in place, knees high." },
  "suitcase-carry":{ name: "Suitcase Carry", cue: "Suitcase carry", equipment: ["dumbbell"], subs: ["farmer-march"], instruction: "One heavy weight at your side. Stay tall, don't lean. Switch sides halfway." },
  "suitcase-left": { name: "Suitcase Carry · Left", cue: "Suitcase carry, left hand", equipment: ["dumbbell"], subs: ["farmer-march"], instruction: "Weight in the left hand. Stay tall, resist the lean." },
  "suitcase-right":{ name: "Suitcase Carry · Right", cue: "Suitcase carry, right hand", equipment: ["dumbbell"], subs: ["farmer-march"], instruction: "Weight in the right hand. Stay tall, resist the lean." },
  "front-rack-carry": { name: "Front-rack Carry", cue: "Front rack carry", equipment: ["dumbbell"], subs: ["farmer-carry", "farmer-march"], instruction: "Weights at the shoulders, elbows up, ribs down." },
  "overhead-carry":{ name: "Overhead Carry", cue: "Overhead carry", equipment: ["dumbbell"], subs: ["front-rack-carry", "farmer-carry"],
                     instruction: "Lock the weight overhead, biceps by the ear. Only if your shoulders are happy overhead." },
  "core-finish":   { name: "Knee Drives / Dead Bugs", cue: "Knee drives or dead bugs", equipment: [], instruction: "Standing knee drives or dead bugs on the floor. Slow and braced." },
};

const EQUIPMENT_LABEL = {
  "treadmill": "Treadmill", "rower": "Rower", "bike": "Bike", "kettlebell": "Kettlebell",
  "dumbbell": "Dumbbell", "battle-ropes": "Battle ropes",
};
const MACHINES = ["treadmill", "rower", "bike"];
const LEVELS = ["beginner", "intermediate", "advanced"];
const FOCUS_LABEL = {
  "low-impact": "Low impact", "strength-heavy": "Strength heavy", "cardio-heavy": "Cardio heavy",
  "minimal": "Minimal equipment", "benchmark": "Benchmark",
};

/* ── Builders ──────────────────────────────────────────────────────────── */
const ex = (id, target, more) => ({ id, ...(target ? { target } : {}), ...(more || {}) });
const reps = (n, opts = {}) => ({ reps: n, ...opts });
const cardio = (id, sec, more = {}) => ({ type: "cardio", id, duration: sec, ...more });
const rest = (sec, label) => (sec > 0 ? { type: "rest", duration: sec, label } : null);
const station = (exercises, sec, more = {}) => ({
  type: "station", duration: sec,
  exercises: exercises.map(e => (typeof e === "string" ? { id: e } : e)), ...more,
});
const round = (blocks, label) => ({ label, blocks: blocks.flat().filter(Boolean) });
const HARD_EASY_HARD = { pattern: [
  { label: "HARD", tone: "hard", share: 1 }, { label: "EASY", tone: "easy", share: 1 }, { label: "HARD", tone: "hard", share: 1 },
] };

const P = {
  rounds: (d, min = 1, max = 12) => ({ key: "rounds", label: "Rounds", icon: "ti-repeat", kind: "count", min, max, step: 1, default: d }),
  time: (key, label, d, icon = "ti-clock", step = 15, min = 0, max = 900) => ({ key, label, icon, kind: "time", min, max, step, default: d }),
  speed: (d = 7.0) => ({ key: "speed", label: "Treadmill speed", icon: "ti-gauge", kind: "speed", min: 2, max: 12, step: 0.1, default: d }),
  toggle: (key, label, d, icon) => ({ key, label, icon, kind: "bool", default: d }),
};

/* Interleave transitions: [a, b, c] → [a, t, b, t, c] */
const withGaps = (items, gap) => items.flatMap((it, i) => (i < items.length - 1 ? [it, rest(gap)] : [it]));

/* ── Templates ────────────────────────────────────────────────────────────
   { id, name, tagline, about, category, level, focus: [], equipment: [],
     roundWord?, params: [], build(p) → { rounds } }                        */
const TEMPLATES = [
  {
    id: "vyra-8", name: "VYRA 8", tagline: "Run + full-body hybrid", category: "hybrid",
    level: "intermediate", focus: [], equipment: ["treadmill", "dumbbell", "battle-ropes"],
    about: "Eight rounds of treadmill running and full-body strength. The original VYRA session.",
    params: [P.time("runSec", "Run", 60, "ti-run"), P.speed(7.0), P.time("restSec", "Rest / transition", 30, "ti-clock-pause", 5),
             P.time("stationSec", "Strength station", 60, "ti-barbell")],
    build(p) {
      const stations = [
        station([ex("battle-ropes")], p.stationSec, { segments: HARD_EASY_HARD,
          instruction: "Fast alternating waves on HARD. Slow, steady waves on EASY. Keep the ropes moving." }),
        station([ex("goblet-squat", reps(20, { approx: true }))], p.stationSec, { name: "Heavy Goblet Squats",
          note: "Stop when the reps are done, or keep going until the timer ends." }),
        station([ex("farmer-carry")], p.stationSec, { instruction: "Heavy dumbbells or kettlebells. Stand tall, short quick steps." }),
        station([ex("db-floor-press", reps(15, { label: "presses" })), ex("db-row", reps(12, { perSide: true, label: "rows" }))], p.stationSec,
          { name: "Upper Body", cue: "Upper body. Floor press and rows", note: "Or keep working for the full interval." }),
        station([ex("reverse-lunge", reps(20, { approx: true, label: "total" }))], p.stationSec),
        station([ex("db-rdl", reps(15, { label: "RDLs" })), ex("shoulder-press", reps([10, 12], { label: "presses" }))], p.stationSec,
          { name: "RDL + Shoulder Press", cue: "R D L and shoulder press", instruction: "Romanian deadlifts first, then strict shoulder presses." }),
        station([ex("suitcase-carry"), ex("core-finish")], p.stationSec,
          { name: "Suitcase Carry + Core", cue: "Suitcase carry and core", instruction: "Alternate sides on the carry, then transition into knee drives or dead bugs." }),
        station([ex("goblet-squat"), ex("db-row"), ex("push-press"), ex("battle-ropes")], p.stationSec,
          { name: "Final Full-Body Station", cue: "Final full body station", note: "Keep moving until the timer ends." }),
      ];
      return { rounds: stations.map((st, i) => round([
        cardio("run", p.runSec, { speed: p.speed }), rest(p.restSec), st, i < stations.length - 1 && rest(p.restSec),
      ])) };
    },
  },
  {
    id: "engine-builder", name: "Engine Builder", tagline: "Rower + strength", category: "hybrid",
    level: "beginner", focus: ["cardio-heavy"], equipment: ["rower", "dumbbell"],
    about: "Controlled aerobic rowing between strength sets. Hold a pace you could keep all session. Don't sprint every row.",
    params: [P.rounds(6, 2, 10), P.time("rowSec", "Row", 120, "ti-ripple"), P.time("restSec", "Rest", 30, "ti-clock-pause", 5),
             P.time("stationSec", "Strength", 60, "ti-barbell")],
    build(p) {
      const moves = ["goblet-squat", "db-row", "db-rdl", "push-press", "reverse-lunge", "farmer-carry"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        cardio("row", p.rowSec, { effort: "Controlled · 20–24 strokes/min" }), rest(p.restSec), station([moves[i % moves.length]], p.stationSec),
      ])) };
    },
  },
  {
    id: "bike-bells", name: "Bike & Bells", tagline: "Bike + kettlebell", category: "hybrid",
    level: "intermediate", focus: [], equipment: ["bike", "kettlebell"],
    about: "Two minutes on the bike, then one kettlebell station. For a beginner version, swap swings for deadlifts and cleans for deadlift-to-front-rack.",
    params: [P.rounds(6, 2, 10), P.time("bikeSec", "Bike", 120, "ti-bike"), P.time("restSec", "Transition", 30, "ti-clock-pause", 5),
             P.time("stationSec", "Kettlebell", 60, "ti-barbell")],
    build(p) {
      const moves = ["kb-swing", "goblet-squat", "kb-clean", "kb-push-press", "kb-reverse-lunge", "kb-suitcase-carry"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        cardio("bike", p.bikeSec), rest(p.restSec), station([moves[i % moves.length]], p.stationSec),
      ])) };
    },
  },
  {
    id: "the-forge", name: "The Forge", tagline: "One kettlebell, no machines", category: "kb-db",
    level: "intermediate", focus: ["minimal", "strength-heavy"], equipment: ["kettlebell"],
    about: "Seven kettlebell movements back to back. One bell is all you need.",
    params: [P.rounds(5, 1, 8), P.time("workSec", "Work", 45, "ti-bolt", 5), P.time("transSec", "Transition", 15, "ti-clock-pause", 5),
             P.time("roundRest", "Rest between rounds", 60, "ti-clock")],
    build(p) {
      const moves = ["kb-swing", "goblet-squat", "kb-clean", "kb-reverse-lunge", "kb-row", "kb-push-press", "farmer-carry"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        withGaps(moves.map(m => station([m], p.workSec)), p.transSec),
        i < p.rounds - 1 && rest(p.roundRest),
      ])) };
    },
  },
  {
    id: "kb-flow", name: "Kettlebell Flow", tagline: "Skill + conditioning", category: "kb-db",
    level: "intermediate", focus: ["minimal"], equipment: ["kettlebell"],
    about: "Thirty seconds per movement with no break inside the round. Switch sides as needed. Turn on the advanced option to add clean + thrusters.",
    params: [P.rounds(5, 4, 6), P.time("workSec", "Work", 30, "ti-bolt", 5), P.time("roundRest", "Rest between rounds", 60, "ti-clock"),
             P.toggle("advanced", "Add clean + thrusters", false, "ti-flame")],
    build(p) {
      const moves = ["kb-swing", "kb-clean", "kb-front-squat", "kb-push-press", "kb-reverse-lunge", "kb-row"];
      if (p.advanced) moves.push("clean-thruster");
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        moves.map(m => station([m], p.workSec)), i < p.rounds - 1 && rest(p.roundRest),
      ])) };
    },
  },
  {
    id: "db-destroyer", name: "Dumbbell Destroyer", tagline: "Dumbbell-only full body", category: "kb-db",
    level: "intermediate", focus: ["minimal", "strength-heavy"], equipment: ["dumbbell"],
    about: "A pair of dumbbells and nothing else. No cardio machine required.",
    params: [P.rounds(5, 1, 8), P.time("workSec", "Work", 60, "ti-bolt", 5), P.time("transSec", "Transition", 20, "ti-clock-pause", 5)],
    build(p) {
      const moves = ["db-squat", "db-floor-press", "bent-over-row", "db-rdl", "reverse-lunge", "shoulder-press", "farmer-march"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        withGaps(moves.map(m => station([m], p.workSec)), p.transSec), i < p.rounds - 1 && rest(p.transSec),
      ])) };
    },
  },
  {
    id: "ropes-iron", name: "Ropes & Iron", tagline: "Battle rope conditioning", category: "hybrid",
    level: "intermediate", focus: [], equipment: ["battle-ropes", "dumbbell"],
    about: "Thirty seconds of ropes, thirty seconds of iron, thirty seconds to breathe. No ropes? Swap in fast swings, a sprint, shadow boxing or step-ups.",
    params: [P.rounds(8, 2, 8), P.time("ropeSec", "Ropes", 30, "ti-wave-sine", 5), P.time("strengthSec", "Strength", 30, "ti-barbell", 5),
             P.time("restSec", "Rest", 30, "ti-clock-pause", 5)],
    build(p) {
      const pairs = ["goblet-squat", "db-row", "db-rdl", "reverse-lunge", "push-press", "farmer-carry", "db-floor-press", "squat-to-press"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        station(["battle-ropes"], p.ropeSec), station([pairs[i % pairs.length]], p.strengthSec), i < p.rounds - 1 && rest(p.restSec),
      ])) };
    },
  },
  {
    id: "sprint-20", name: "Hybrid Sprint 20", tagline: "Short and hard", category: "hybrid",
    level: "advanced", focus: [], equipment: ["treadmill", "dumbbell"],
    about: "Only have 20 minutes? Alternate 60 seconds of cardio and 60 seconds of strength, no breaks. Swap the treadmill for a rower, bike or incline walk.",
    params: [P.rounds(10, 5, 15), P.time("cardioSec", "Cardio", 60, "ti-run"), P.time("strengthSec", "Strength", 60, "ti-barbell"), P.speed(7.5)],
    build(p) {
      const moves = ["goblet-squat", "db-row", "db-rdl", "push-press", "reverse-lunge"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        cardio("run", p.cardioSec, { speed: p.speed }), station([moves[i % moves.length]], p.strengthSec),
      ])) };
    },
  },
  {
    id: "the-mixer", name: "The Mixer", tagline: "Run + row + bike", category: "hybrid",
    level: "advanced", focus: ["cardio-heavy"], equipment: ["treadmill", "rower", "bike", "dumbbell"],
    about: "Three machines back to back, then a strength circuit: 10 goblet squats, 10 rows per side, 10 presses, repeated until time runs out.",
    params: [P.rounds(3, 1, 5), P.time("machineSec", "Each machine", 120, "ti-run"), P.speed(7.0), P.time("restSec", "Rest", 60, "ti-clock-pause"),
             P.time("circuitSec", "Strength circuit", 120, "ti-barbell")],
    build(p) {
      return { rounds: Array.from({ length: p.rounds }, () => round([
        cardio("run", p.machineSec, { speed: p.speed }), cardio("row", p.machineSec), cardio("bike", p.machineSec), rest(p.restSec),
        station([ex("goblet-squat", reps(10)), ex("db-row", reps(10, { perSide: true })), ex("push-press", reps(10, { label: "presses" }))], p.circuitSec,
          { name: "Strength Circuit", cue: "Strength circuit", note: "Repeat the circuit until time runs out." }),
      ])) };
    },
  },
  {
    id: "tri-15", name: "Mini Triathlon 15", tagline: "Row → Bike → Run", category: "benchmark",
    level: "beginner", focus: ["cardio-heavy", "benchmark"], equipment: ["rower", "bike", "treadmill"], roundWord: "Leg",
    about: "Five minutes on each machine. Record your distances at the end and try to beat your total next month.",
    params: [P.time("legSec", "Each leg", 300, "ti-clock", 60, 60, 1800), P.time("transSec", "Transition", 0, "ti-clock-pause", 15), P.speed(7.0)],
    build(p) { return triathlon(p, 1); },
  },
  {
    id: "tri-30", name: "Mini Triathlon 30", tagline: "Longer engine test", category: "benchmark",
    level: "intermediate", focus: ["cardio-heavy", "benchmark"], equipment: ["rower", "bike", "treadmill"], roundWord: "Leg",
    about: "Ten minutes each of row, bike and run. Pace it evenly. Don't blow up in the first ten minutes.",
    params: [P.time("legSec", "Each leg", 600, "ti-clock", 60, 60, 1800), P.time("transSec", "Transition", 60, "ti-clock-pause", 15), P.speed(7.0)],
    build(p) { return triathlon(p, 1); },
  },
  {
    id: "tri-intervals", name: "Triathlon Intervals", tagline: "Row / bike / run repeats", category: "benchmark",
    level: "advanced", focus: ["cardio-heavy", "benchmark"], equipment: ["rower", "bike", "treadmill"],
    about: "Three minutes on each machine, three times through: 27 minutes of work. Advanced athletes go for four rounds.",
    params: [P.rounds(3, 2, 4), P.time("legSec", "Each leg", 180, "ti-clock", 30, 60, 600), P.time("transSec", "Transition", 30, "ti-clock-pause", 15),
             P.time("roundRest", "Rest between rounds", 60, "ti-clock"), P.speed(7.0)],
    build(p) { return triathlon(p, p.rounds); },
  },
  {
    id: "strength-before-speed", name: "Strength Before Speed", tagline: "Heavy hybrid", category: "hybrid",
    level: "intermediate", focus: ["strength-heavy"], equipment: ["treadmill", "dumbbell"],
    about: "Strength stations are done for reps, not speed. Go heavy, move well and tap DONE when the set is finished. Swap the treadmill for a rower or bike.",
    params: [P.rounds(6, 1, 6), P.time("cardioSec", "Cardio", 60, "ti-run"), P.speed(7.0), P.time("transSec", "Transition", 30, "ti-clock-pause", 5)],
    build(p) {
      const sets = [
        station([ex("goblet-squat", reps(10))], null, { name: "Heavy Goblet Squats" }),
        station([ex("db-rdl", reps(10))], null),
        station([ex("shoulder-press", reps(8, { label: "presses" }))], null),
        station([ex("db-row", reps(10, { perSide: true }))], null),
        station([ex("reverse-lunge", reps(12))], null),
        station([ex("farmer-carry")], 60),
      ];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        cardio("run", p.cardioSec, { speed: p.speed }), rest(p.transSec), sets[i % sets.length],
      ])) };
    },
  },
  {
    id: "carry-me-home", name: "Carry Me Home", tagline: "Carries + cardio", category: "hybrid",
    level: "beginner", focus: ["low-impact"], equipment: ["bike", "dumbbell"],
    about: "Low-impact cardio and loaded carries. No squats, no lunges, no jumping.",
    params: [P.rounds(6, 2, 6), P.time("cardioSec", "Cardio", 90, "ti-bike"), P.time("carrySec", "Carry", 60, "ti-weight"),
             P.time("restSec", "Rest", 30, "ti-clock-pause", 5)],
    build(p) {
      const carries = ["farmer-carry", "suitcase-left", "suitcase-right", "front-rack-carry", "overhead-carry", "farmer-march"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        cardio("bike", p.cardioSec), station([carries[i % carries.length]], p.carrySec), i < p.rounds - 1 && rest(p.restSec),
      ])) };
    },
  },
  {
    id: "gauntlet", name: "VYRA Gauntlet", tagline: "Full hybrid challenge", category: "hybrid",
    level: "advanced", focus: ["cardio-heavy"], equipment: ["treadmill", "rower", "bike", "kettlebell", "dumbbell"],
    about: "The flagship. Eight stations, each after 90 seconds of cardio that rotates run, row and bike, with 30 seconds between everything.",
    params: [P.time("cardioSec", "Cardio", 90, "ti-run"), P.time("stationSec", "Station", 60, "ti-barbell"),
             P.time("transSec", "Transition", 30, "ti-clock-pause", 5), P.speed(7.5)],
    build(p) {
      const machines = ["run", "row", "bike", "run", "row", "bike", "run", "cardio-choice"];
      const stations = ["kb-swing", "goblet-squat", "db-row", "reverse-lunge", "push-press", "farmer-carry", "db-rdl"]
        .map(m => station([m], p.stationSec));
      stations.push(station(["goblet-squat", "db-row", "push-press", "kb-swing"], Math.round(p.stationSec * 1.5),
        { name: "Full-Body Finisher", cue: "Full body finisher", note: "Keep moving until the timer ends." }));
      return { rounds: stations.map((st, i) => round([
        cardio(machines[i], p.cardioSec, machines[i] === "run" ? { speed: p.speed } : {}), rest(p.transSec), st,
        i < stations.length - 1 && rest(p.transSec),
      ])) };
    },
  },
];

function triathlon(p, rounds) {
  return { rounds: Array.from({ length: rounds }, (_, i) => round([
    cardio("row", p.legSec), rest(p.transSec, "Transition"),
    cardio("bike", p.legSec), rest(p.transSec, "Transition"),
    cardio("run", p.legSec, { speed: p.speed }),
    i < rounds - 1 && rest(p.roundRest || 0),
  ])) };
}

const CATEGORIES = [
  { id: "hybrid", label: "Hybrid" },
  { id: "kb-db", label: "Kettlebell & dumbbell" },
  { id: "benchmark", label: "Benchmarks" },
];

/* ── Movement patterns (progress balance) ──────────────────────────────── */
const PATTERNS = [
  { id: "squat", label: "Squat" }, { id: "hinge", label: "Hinge" }, { id: "lunge", label: "Lunge" },
  { id: "push", label: "Push" }, { id: "pull", label: "Pull" }, { id: "carry", label: "Carry" },
  { id: "core", label: "Core" }, { id: "cardio", label: "Cardio" }, { id: "conditioning", label: "Conditioning" },
];
const PATTERN_OF = {
  cardio: ["run", "row", "bike", "incline-walk", "step-ups", "cardio-choice"],
  conditioning: ["battle-ropes", "db-ski-punch", "high-knee-march", "bike-sprint", "row-sprint", "shadow-boxing", "rapid-step-ups"],
  hinge: ["kb-swing", "kb-swing-fast", "db-swing", "kb-deadlift", "db-rdl", "kb-clean", "db-clean", "deadlift-front-rack"],
  squat: ["kb-front-squat", "goblet-squat", "db-squat", "clean-thruster", "db-thruster", "squat-press", "squat-to-press"],
  push: ["kb-push-press", "push-press", "db-floor-press", "shoulder-press"],
  pull: ["kb-row", "db-row", "bent-over-row", "high-pull"],
  lunge: ["kb-reverse-lunge", "reverse-lunge"],
  carry: ["kb-suitcase-carry", "farmer-carry", "farmer-march", "suitcase-carry", "suitcase-left", "suitcase-right", "front-rack-carry", "overhead-carry"],
  core: ["core-finish"],
};
Object.entries(PATTERN_OF).forEach(([p, ids]) => ids.forEach(id => { EXERCISES[id].pattern = p; }));

/* Movements that work with either a dumbbell or a kettlebell. */
["goblet-squat", "reverse-lunge", "farmer-carry", "farmer-march", "suitcase-carry", "suitcase-left", "suitcase-right",
 "front-rack-carry", "overhead-carry", "db-rdl", "push-press", "shoulder-press", "squat-to-press"]
  .forEach(id => { EXERCISES[id].equipment = ["dumbbell|kettlebell"]; });

/* ── Warm-up and cool-down (bodyweight, no equipment) ──────────────────── */
Object.assign(EXERCISES, {
  "wu-march":      { name: "Easy March or Light Jog", cue: "Warm up. Easy march", equipment: [], pattern: "mobility", instruction: "Get the blood moving. Easy pace, relaxed shoulders." },
  "wu-arm-circles":{ name: "Arm Circles", cue: "Arm circles", equipment: [], pattern: "mobility", instruction: "Big slow circles forward, then backward." },
  "wu-hinge":      { name: "Hip Hinge Drill", cue: "Hip hinges", equipment: [], pattern: "mobility", instruction: "Hands on hips, push the hips back with a flat back. Wakes up the hamstrings for swings and RDLs." },
  "wu-squat":      { name: "Bodyweight Squats", cue: "Bodyweight squats", equipment: [], pattern: "mobility", instruction: "Slow and deep. Knees track over the toes." },
  "wu-lunge-reach":{ name: "Reverse Lunge + Reach", cue: "Lunge and reach", equipment: [], pattern: "mobility", instruction: "Step back, reach both arms overhead, alternate legs." },
  "wu-inchworm":   { name: "Inchworms", cue: "Inchworms", equipment: [], pattern: "mobility", instruction: "Walk the hands out to a plank, walk them back. Bend the knees if you need to." },
  "cd-walk":       { name: "Easy Walk", cue: "Cool down. Easy walk", equipment: [], pattern: "mobility", instruction: "Bring the heart rate down. Breathe slowly through the nose." },
  "cd-hip-flexor": { name: "Hip Flexor Stretch", cue: "Hip flexor stretch", equipment: [], pattern: "mobility", instruction: "Half kneeling, squeeze the glute, lean forward gently. Switch sides halfway." },
  "cd-hamstring":  { name: "Hamstring Fold", cue: "Hamstring fold", equipment: [], pattern: "mobility", instruction: "Soft knees, hang forward, let the head relax." },
  "cd-chest":      { name: "Chest + Shoulder Opener", cue: "Chest opener", equipment: [], pattern: "mobility", instruction: "Hands clasped behind you, lift the chest, shoulders down." },
});
const WARMUP = [["wu-march", 60], ["wu-arm-circles", 30], ["wu-hinge", 45], ["wu-squat", 45], ["wu-lunge-reach", 45], ["wu-inchworm", 45]];
const COOLDOWN = [["cd-walk", 60], ["cd-hip-flexor", 60], ["cd-hamstring", 30], ["cd-chest", 30]];

/* Workouts that are kind to sore legs and joints. */
const LOW_IMPACT_IDS = ["carry-me-home", "engine-builder", "tri-15", "bike-bells"];

/* ── Programs: 4-week plans built from the templates ───────────────────────
   Each session names a template and optional adjustments, applied as deltas
   to the athlete's own settings (clamped to each setting's range). Week 4 is
   always lighter so the body can absorb the work.                           */
const PROGRAMS = [
  {
    id: "hybrid-base", name: "Hybrid Base", tagline: "Build an engine for run + strength", level: "beginner",
    about: "Three sessions a week mixing cardio machines and full-body strength. Volume rises for three weeks, then a lighter week with a benchmark so you can see how far you've come.",
    weeks: [
      [{ t: "engine-builder" }, { t: "vyra-8" }, { t: "carry-me-home" }],
      [{ t: "engine-builder", adj: { rounds: 1 } }, { t: "vyra-8", adj: { speed: 0.2 } }, { t: "bike-bells" }],
      [{ t: "engine-builder", adj: { rounds: 2 } }, { t: "vyra-8", adj: { speed: 0.4 } }, { t: "bike-bells", adj: { rounds: 1 } }],
      [{ t: "carry-me-home", adj: { rounds: -1 } }, { t: "tri-15" }, { t: "vyra-8" }],
    ],
  },
  {
    id: "low-impact-base", name: "Low-Impact Base", tagline: "Fitness without pounding the joints", level: "beginner",
    about: "Bike, rower and loaded carries. No running and no jumping. A good place to start, or to come back after time off.",
    weeks: [
      [{ t: "carry-me-home" }, { t: "engine-builder" }, { t: "carry-me-home" }],
      [{ t: "carry-me-home", adj: { carrySec: 15 } }, { t: "engine-builder", adj: { rounds: 1 } }, { t: "bike-bells" }],
      [{ t: "carry-me-home", adj: { carrySec: 15, cardioSec: 15 } }, { t: "engine-builder", adj: { rounds: 2 } }, { t: "bike-bells", adj: { rounds: 1 } }],
      [{ t: "carry-me-home", adj: { rounds: -1 } }, { t: "engine-builder", adj: { rounds: -1 } }],
    ],
  },
  {
    id: "benchmark-builder", name: "Benchmark Builder", tagline: "Beat your Row → Bike → Run total", level: "intermediate",
    about: "Test your Mini Triathlon 15 in week 1, train with intervals and hybrids, then retest in week 4.",
    weeks: [
      [{ t: "tri-15" }, { t: "engine-builder" }, { t: "bike-bells" }],
      [{ t: "tri-intervals" }, { t: "sprint-20" }, { t: "carry-me-home" }],
      [{ t: "tri-intervals", adj: { rounds: 1 } }, { t: "the-mixer" }, { t: "engine-builder", adj: { rounds: 1 } }],
      [{ t: "carry-me-home" }, { t: "tri-15" }],
    ],
  },
  {
    id: "strength-block", name: "Strength Block", tagline: "Kettlebells and dumbbells, no machines needed", level: "intermediate",
    about: "Strength-first sessions with short conditioning. Work gets a little longer each week, then backs off in week 4.",
    weeks: [
      [{ t: "the-forge" }, { t: "db-destroyer" }, { t: "kb-flow" }],
      [{ t: "the-forge", adj: { workSec: 5 } }, { t: "db-destroyer", adj: { rounds: 1 } }, { t: "kb-flow", adj: { rounds: 1 } }],
      [{ t: "the-forge", adj: { workSec: 10 } }, { t: "db-destroyer", adj: { rounds: 1, workSec: 5 } }, { t: "kb-flow", adj: { rounds: 1 } }],
      [{ t: "the-forge", adj: { rounds: -1 } }, { t: "db-destroyer", adj: { rounds: -1 } }],
    ],
  },
];
