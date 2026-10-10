"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   Iron Forest — Exercise library + workout templates
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
                    subs: ["run-outside", "incline-walk", "bike", "row", "jog-in-place"], instruction: "Steady, controlled pace." },
  "row":          { name: "Row", cue: "Row", state: "ROW", cardio: true, equipment: ["rower"], effort: "Steady · 22–26 strokes/min",
                    subs: ["bike", "run", "incline-walk", "run-outside", "jog-in-place"], instruction: "Legs, then hips, then arms. Long, controlled strokes." },
  "bike":         { name: "Bike", cue: "Bike", state: "BIKE", cardio: true, equipment: ["bike"], effort: "Steady · 80–90 rpm",
                    subs: ["row", "run", "step-ups"], instruction: "Smooth cadence, light grip, breathe through the nose when you can." },
  "incline-walk": { name: "Brisk Incline Walk", cue: "Incline walk", state: "WALK", cardio: true, equipment: ["treadmill"], effort: "Brisk walk",
                    subs: ["walk-outside", "march-in-place"], instruction: "Steep incline, brisk pace, hands off the rails." },
  "step-ups":     { name: "Step-ups", cue: "Step ups", state: "CARDIO", cardio: true, equipment: [], effort: "Steady rhythm",
                    instruction: "Box or bench. Drive through the whole foot, alternate legs." },
  "cardio-choice":{ name: "Athlete's Choice", cue: "Cardio, your choice", state: "CARDIO", cardio: true, equipment: [], effort: "Your choice",
                    subs: ["run", "row", "bike"], instruction: "Pick any machine and hold a strong, steady pace." },
  "run-outside":  { name: "Run", cue: "Run", state: "RUN", cardio: true, equipment: ["outdoors"], effort: "Steady · you can talk in short sentences",
                    subs: ["run", "jog-in-place"], instruction: "Outside on a flat route. Run by feel: relaxed shoulders, quick light steps." },
  "walk-outside": { name: "Brisk Walk", cue: "Brisk walk", state: "WALK", cardio: true, equipment: ["outdoors"], effort: "Brisk · breathing harder, still chatty",
                    subs: ["incline-walk", "march-in-place"], instruction: "Walk with purpose, arms swinging. Find a hill if you can." },
  "jog-in-place": { name: "Jog in Place", cue: "Jog in place", state: "CARDIO", cardio: true, bodyweightCardio: true, equipment: [],
                    effort: "Steady · you can talk in short sentences", instruction: "Light, quick steps on the balls of your feet. Pump the arms." },
  "march-in-place": { name: "March in Place", cue: "March in place", state: "WALK", cardio: true, bodyweightCardio: true, equipment: [],
                    effort: "Brisk · knees up", instruction: "Lift the knees to hip height and swing the arms. No impact." },

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
  "kb-swing":      { name: "KB Swings", cue: "Kettlebell swings", equipment: ["kettlebell"], subs: ["db-swing", "kb-deadlift", "db-rdl", "hinge-jump", "glute-bridge"],
                     instruction: "Hinge, hike the bell back, snap the hips. Arms are ropes." },
  "db-swing":      { name: "DB Swings", cue: "Dumbbell swings", equipment: ["dumbbell"], instruction: "Hold one dumbbell by the head. Hinge and snap the hips." },
  "kb-deadlift":   { name: "KB Deadlifts", cue: "Kettlebell deadlifts", equipment: ["kettlebell"], instruction: "Bell between the feet, flat back, stand tall." },
  "kb-clean":      { name: "KB Cleans", cue: "Kettlebell cleans", equipment: ["kettlebell"], subs: ["db-clean", "high-pull", "deadlift-front-rack", "hinge-jump"],
                     instruction: "Keep the bell close, let it roll around the wrist into the rack. Switch sides as needed." },
  "db-clean":      { name: "DB Cleans", cue: "Dumbbell cleans", equipment: ["dumbbell"], instruction: "Pull from the hip, catch at the shoulder with soft knees." },
  "high-pull":     { name: "High Pulls", cue: "High pulls", equipment: ["kettlebell"], instruction: "Drive the hips, pull the elbow high and back." },
  "deadlift-front-rack": { name: "Deadlift to Front Rack", cue: "Deadlift to front rack", equipment: ["kettlebell"], instruction: "Deadlift, pause, then guide the bell into the rack. Slow and clean." },
  "kb-front-squat":{ name: "KB Front Squats", cue: "Front squats", equipment: ["kettlebell"], instruction: "Bell in the rack, elbow tucked, sit between the hips." },
  "kb-push-press": { name: "KB Push Press", cue: "Push press", equipment: ["kettlebell"], instruction: "Small dip, drive with the legs, lock out overhead. Switch sides as needed." },
  "kb-row":        { name: "One-arm KB Rows", cue: "One arm rows", equipment: ["kettlebell"], instruction: "Hinge, flat back, pull the bell to the hip." },
  "kb-reverse-lunge": { name: "KB Reverse Lunges", cue: "Reverse lunges", equipment: ["kettlebell"], instruction: "Bell in the rack or at your side. Step back, alternate legs." },
  "kb-suitcase-carry": { name: "KB Suitcase Carry", cue: "Suitcase carry", equipment: ["kettlebell"], subs: ["farmer-march", "side-plank"], instruction: "One bell at your side. Stay tall, don't lean. Switch sides halfway." },
  "clean-thruster":{ name: "Clean + Thruster", cue: "Clean and thruster", equipment: ["kettlebell"], subs: ["db-thruster", "squat-press", "goblet-squat", "air-squat", "burpee"],
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
  "squat-to-press":{ name: "Squat to Press", cue: "Squat to press", equipment: ["dumbbell"], subs: ["db-thruster", "goblet-squat", "air-squat", "burpee"], instruction: "Squat with dumbbells at the shoulders, stand and press in one motion." },
  "farmer-carry":  { name: "Farmer Carry", cue: "Farmer carry", equipment: ["dumbbell"], subs: ["farmer-march", "bear-crawl"], instruction: "Heavy weights at your sides. Shoulders down, short quick steps." },
  "farmer-march":  { name: "Farmer March", cue: "Farmer march", equipment: ["dumbbell"], instruction: "Heavy weights at your sides, march in place, knees high." },
  "suitcase-carry":{ name: "Suitcase Carry", cue: "Suitcase carry", equipment: ["dumbbell"], subs: ["farmer-march", "side-plank"], instruction: "One heavy weight at your side. Stay tall, don't lean. Switch sides halfway." },
  "suitcase-left": { name: "Suitcase Carry · Left", cue: "Suitcase carry, left hand", equipment: ["dumbbell"], subs: ["farmer-march", "side-plank"], instruction: "Weight in the left hand. Stay tall, resist the lean." },
  "suitcase-right":{ name: "Suitcase Carry · Right", cue: "Suitcase carry, right hand", equipment: ["dumbbell"], subs: ["farmer-march", "side-plank"], instruction: "Weight in the right hand. Stay tall, resist the lean." },
  "front-rack-carry": { name: "Front-rack Carry", cue: "Front rack carry", equipment: ["dumbbell"], subs: ["farmer-carry", "farmer-march", "bear-crawl"], instruction: "Weights at the shoulders, elbows up, ribs down." },
  "overhead-carry":{ name: "Overhead Carry", cue: "Overhead carry", equipment: ["dumbbell"], subs: ["front-rack-carry", "farmer-carry", "plank-shoulder-taps"],
                     instruction: "Lock the weight overhead, biceps by the ear. Only if your shoulders are happy overhead." },
  "core-finish":   { name: "Knee Drives / Dead Bugs", cue: "Knee drives or dead bugs", equipment: [], instruction: "Standing knee drives or dead bugs on the floor. Slow and braced." },
};

const EQUIPMENT_LABEL = {
  "treadmill": "Treadmill", "rower": "Rower", "bike": "Bike", "kettlebell": "Kettlebell",
  "dumbbell": "Dumbbell", "battle-ropes": "Battle ropes", "outdoors": "Outside (run & walk)",
};
const MACHINES = ["treadmill", "rower", "bike"];
const LEVELS = ["beginner", "intermediate", "advanced"];
const FOCUS_LABEL = {
  "low-impact": "Low impact", "strength-heavy": "Strength heavy", "cardio-heavy": "Cardio heavy",
  "minimal": "Minimal equipment", "benchmark": "Benchmark", "bodyweight": "No equipment", "outdoor": "Outdoor",
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
    id: "vyra-8", name: "The 8", tagline: "Run + full-body hybrid", category: "hybrid",
    level: "intermediate", focus: [], equipment: ["treadmill", "dumbbell", "battle-ropes"],
    about: "Eight rounds of treadmill running and full-body strength. The original Iron Forest session.",
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
          { name: "Upper Body", cue: "Upper body. Floor press and rows" }),
        station([ex("reverse-lunge", reps(20, { approx: true, label: "total" }))], p.stationSec),
        station([ex("db-rdl", reps(15, { label: "RDLs" })), ex("shoulder-press", reps([10, 12], { label: "presses" }))], p.stationSec,
          { name: "RDL + Shoulder Press", cue: "R D L and shoulder press", instruction: "Romanian deadlifts first, then strict shoulder presses." }),
        station([ex("suitcase-carry"), ex("core-finish")], p.stationSec,
          { name: "Suitcase Carry + Core", cue: "Suitcase carry and core", instruction: "Alternate sides on the carry, then transition into knee drives or dead bugs." }),
        station([ex("goblet-squat"), ex("db-row"), ex("push-press"), ex("battle-ropes")], p.stationSec,
          { name: "Final Full-Body Station", cue: "Final full body station", note: "Each move gets its own timer, with a short switch in between." }),
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
          { name: "Strength Circuit", cue: "Strength circuit", note: "Repeat the circuit until time runs out.", circuit: true }),
      ])) };
    },
  },
  {
    id: "tri-15", name: "Mini Triathlon 15", tagline: "Row → Bike → Run", category: "benchmark",
    level: "beginner", focus: ["cardio-heavy", "benchmark"], equipment: ["rower", "bike", "treadmill"], machinesOnly: true, roundWord: "Leg",
    about: "Five minutes on each machine. Record your distances at the end and try to beat your total next month.",
    params: [P.time("legSec", "Each leg", 300, "ti-clock", 60, 60, 1800), P.time("transSec", "Transition", 0, "ti-clock-pause", 15), P.speed(7.0)],
    build(p) { return triathlon(p, 1); },
  },
  {
    id: "tri-30", name: "Mini Triathlon 30", tagline: "Longer engine test", category: "benchmark",
    level: "intermediate", focus: ["cardio-heavy", "benchmark"], equipment: ["rower", "bike", "treadmill"], machinesOnly: true, roundWord: "Leg",
    about: "Ten minutes each of row, bike and run. Pace it evenly. Don't blow up in the first ten minutes.",
    params: [P.time("legSec", "Each leg", 600, "ti-clock", 60, 60, 1800), P.time("transSec", "Transition", 60, "ti-clock-pause", 15), P.speed(7.0)],
    build(p) { return triathlon(p, 1); },
  },
  {
    id: "tri-intervals", name: "Triathlon Intervals", tagline: "Row / bike / run repeats", category: "benchmark",
    level: "advanced", focus: ["cardio-heavy", "benchmark"], equipment: ["rower", "bike", "treadmill"], machinesOnly: true,
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
    id: "gauntlet", name: "Forest Gauntlet", tagline: "Full hybrid challenge", category: "hybrid",
    level: "advanced", focus: ["cardio-heavy"], equipment: ["treadmill", "rower", "bike", "kettlebell", "dumbbell"],
    about: "The flagship. Eight stations, each after 90 seconds of cardio that rotates run, row and bike, with 30 seconds between everything.",
    params: [P.time("cardioSec", "Cardio", 90, "ti-run"), P.time("stationSec", "Station", 60, "ti-barbell"),
             P.time("transSec", "Transition", 30, "ti-clock-pause", 5), P.speed(7.5)],
    build(p) {
      const machines = ["run", "row", "bike", "run", "row", "bike", "run", "cardio-choice"];
      const stations = ["kb-swing", "goblet-squat", "db-row", "reverse-lunge", "push-press", "farmer-carry", "db-rdl"]
        .map(m => station([m], p.stationSec));
      stations.push(station(["goblet-squat", "db-row", "push-press", "kb-swing"], p.stationSec,
        { name: "Full-Body Finisher", cue: "Full body finisher", note: "Each move gets its own timer, with a short switch in between." }));
      return { rounds: stations.map((st, i) => round([
        cardio(machines[i], p.cardioSec, machines[i] === "run" ? { speed: p.speed } : {}), rest(p.transSec), st,
        i < stations.length - 1 && rest(p.transSec),
      ])) };
    },
  },

  // ── No equipment & outdoor ──────────────────────────────────────────────
  {
    id: "anywhere-20", name: "Anywhere 20", tagline: "No equipment, any room", category: "bodyweight",
    level: "intermediate", focus: ["bodyweight", "minimal"], equipment: [],
    about: "Six bodyweight moves, 40 seconds on and 20 off. A living room, a hotel, a park: if you can lie down, you can do it.",
    params: [P.rounds(3, 1, 6), P.time("workSec", "Work", 40, "ti-bolt", 5), P.time("restSec", "Rest", 20, "ti-clock-pause", 5),
             P.time("roundRest", "Rest between rounds", 60, "ti-clock")],
    build(p) {
      const moves = ["air-squat", "push-up", "mountain-climbers", "bw-lunge", "plank-shoulder-taps", "burpee"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        withGaps(moves.map(m => station([m], p.workSec)), p.restSec), i < p.rounds - 1 && rest(p.roundRest),
      ])) };
    },
  },
  {
    id: "park-hybrid", name: "Park Hybrid", tagline: "Outdoor run + bodyweight", category: "bodyweight",
    level: "intermediate", focus: ["bodyweight", "outdoor"], equipment: ["outdoors"],
    about: "The 8 without a gym. Run a loop, stop, do one bodyweight station, run again. Pick a flat path or a quiet corner of a park.",
    params: [P.rounds(8, 4, 10), P.time("runSec", "Run", 90, "ti-run"), P.time("restSec", "Rest / transition", 15, "ti-clock-pause", 5),
             P.time("stationSec", "Bodyweight station", 60, "ti-bolt")],
    build(p) {
      const moves = ["jump-squat", "push-up", "bw-lunge", "burpee", "mountain-climbers", "pike-push-up", "hinge-jump", "plank-shoulder-taps"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        cardio("run-outside", p.runSec, { effort: "Strong · short sentences only" }), rest(p.restSec), station([moves[i % moves.length]], p.stationSec),
        i < p.rounds - 1 && rest(p.restSec),
      ])) };
    },
  },
  {
    id: "quiet-room", name: "Quiet Room", tagline: "No jumping, no noise", category: "bodyweight",
    level: "beginner", focus: ["bodyweight", "low-impact", "minimal"], equipment: [],
    about: "Full body without a single jump. Made for apartments, hotel rooms and sore knees. The neighbours won't hear a thing.",
    params: [P.rounds(3, 1, 5), P.time("workSec", "Work", 45, "ti-bolt", 5), P.time("restSec", "Rest", 15, "ti-clock-pause", 5),
             P.time("roundRest", "Rest between rounds", 60, "ti-clock")],
    build(p) {
      const moves = ["air-squat", "push-up", "glute-bridge", "split-squat", "prone-ytw", "wall-sit", "core-finish"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        withGaps(moves.map(m => station([m], p.workSec)), p.restSec), i < p.rounds - 1 && rest(p.roundRest),
      ])) };
    },
  },
  {
    id: "first-steps", name: "First Steps", tagline: "A gentle start, no equipment", category: "bodyweight",
    level: "beginner", focus: ["bodyweight", "low-impact"], equipment: [],
    about: "For day one, or coming back after a long break. Easier versions of every move, plenty of rest, and nothing that needs the floor to be quiet.",
    params: [P.rounds(2, 1, 4), P.time("workSec", "Work", 30, "ti-bolt", 5), P.time("restSec", "Rest", 30, "ti-clock-pause", 5),
             P.time("roundRest", "Rest between rounds", 90, "ti-clock")],
    build(p) {
      const moves = ["march-in-place", "sit-to-stand", "wall-push-up", "glute-bridge", "bird-dog", "bw-lunge"];
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        withGaps(moves.map(m => (EXERCISES[m].cardio ? cardio(m, p.workSec) : station([m], p.workSec))), p.restSec),
        i < p.rounds - 1 && rest(p.roundRest),
      ])) };
    },
  },
  {
    id: "run-walk", name: "Run/Walk Builder", tagline: "Outdoor intervals for new runners", category: "bodyweight",
    level: "beginner", focus: ["outdoor", "bodyweight", "cardio-heavy", "low-impact"], equipment: ["outdoors"],
    about: "Jog a minute, walk to recover, repeat. Each week, add a round or a little more running. The fastest way to your first 5 km.",
    params: [P.rounds(8, 4, 12), P.time("runSec", "Jog", 60, "ti-run"), P.time("walkSec", "Walk", 90, "ti-walk")],
    build(p) {
      return { rounds: Array.from({ length: p.rounds }, () => round([
        cardio("run-outside", p.runSec, { effort: "Easy jog · you can still talk" }), cardio("walk-outside", p.walkSec),
      ])) };
    },
  },
  {
    id: "tabata-burner", name: "Tabata Burner", tagline: "20 on, 10 off, no equipment", category: "bodyweight",
    level: "advanced", focus: ["bodyweight", "cardio-heavy", "minimal"], equipment: [],
    about: "Four-minute Tabatas: eight rounds of 20 seconds all-out, 10 seconds rest, on one move. A minute off, then the next move.",
    params: [P.rounds(4, 2, 6), P.time("blockRest", "Rest between Tabatas", 60, "ti-clock")],
    build(p) {
      const moves = ["burpee", "jump-squat", "mountain-climbers", "push-up", "skater-jumps", "high-knees"];
      const tabata = { pattern: [{ label: "WORK", tone: "hard", duration: 20 }, { label: "REST", tone: "easy", duration: 10 }], repeat: 8 };
      return { rounds: Array.from({ length: p.rounds }, (_, i) => round([
        station([moves[i % moves.length]], null, { segments: tabata, note: "Eight rounds of 20 seconds on, 10 seconds off." }),
        i < p.rounds - 1 && rest(p.blockRest),
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
  { id: "bodyweight", label: "No equipment & outdoor" },
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

/* ── Bodyweight: no equipment, any room, any park ──────────────────────── */
Object.assign(EXERCISES, {
  "air-squat":      { name: "Air Squats", cue: "Air squats", equipment: [], pattern: "squat", instruction: "Feet shoulder width, sit back and down, chest up. Stand all the way up." },
  "jump-squat":     { name: "Jump Squats", cue: "Jump squats", equipment: [], pattern: "squat", subs: ["air-squat"], instruction: "Squat, then jump. Land soft and sink straight into the next one." },
  "sit-to-stand":   { name: "Sit to Stand", cue: "Sit to stand", equipment: [], pattern: "squat", subs: ["air-squat"], instruction: "Sit on a chair, stand up without using your hands. Slow on the way down." },
  "wall-sit":       { name: "Wall Sit", cue: "Wall sit", equipment: [], pattern: "squat", subs: ["air-squat"], instruction: "Back flat on a wall, thighs level with the floor. Breathe and hold." },
  "hinge-jump":     { name: "Hip-hinge Jumps", cue: "Hip hinge jumps", equipment: [], pattern: "hinge", subs: ["glute-bridge"], instruction: "Hinge back with a flat back, swing the arms, jump tall. Land soft." },
  "single-leg-rdl": { name: "Single-leg RDLs", cue: "Single leg R D Ls", equipment: [], pattern: "hinge", subs: ["glute-bridge"], instruction: "Reach down as one leg lifts behind you, hips square. Hold a wall if you wobble. Switch legs halfway." },
  "glute-bridge":   { name: "Glute Bridges", cue: "Glute bridges", equipment: [], pattern: "hinge", instruction: "On your back, feet flat. Drive the hips up, squeeze, lower slowly." },
  "bw-lunge":       { name: "Bodyweight Lunges", cue: "Lunges", equipment: [], pattern: "lunge", subs: ["split-squat"], instruction: "Step back, lower the back knee toward the floor, alternate legs. Hold a wall if you need to." },
  "split-squat":    { name: "Split Squats", cue: "Split squats", equipment: [], pattern: "lunge", subs: ["bw-lunge"], instruction: "One foot forward, one back. Lower straight down. Switch legs halfway." },
  "push-up":        { name: "Push-ups", cue: "Push ups", equipment: [], pattern: "push", subs: ["knee-push-up", "wall-push-up"], instruction: "Hands under the shoulders, body in one line. Drop to the knees whenever form slips." },
  "knee-push-up":   { name: "Knee Push-ups", cue: "Knee push ups", equipment: [], pattern: "push", subs: ["wall-push-up", "push-up"], instruction: "Knees down, hips in line with the shoulders. Chest to the floor, press away." },
  "wall-push-up":   { name: "Wall Push-ups", cue: "Wall push ups", equipment: [], pattern: "push", subs: ["knee-push-up"], instruction: "Hands on a wall, body straight. Bend the elbows and press away." },
  "pike-push-up":   { name: "Pike Push-ups", cue: "Pike push ups", equipment: [], pattern: "push", subs: ["push-up"], instruction: "Hips high, lower the head toward the floor between the hands, press back up." },
  "prone-ytw":      { name: "Prone Y-T-W Raises", cue: "Y T W raises", equipment: [], pattern: "pull", subs: ["backpack-row"], instruction: "Face down. Lift the arms into a Y, a T, then a W. Squeeze the shoulder blades." },
  "backpack-row":   { name: "Backpack Rows", cue: "Backpack rows", equipment: [], pattern: "pull", subs: ["prone-ytw"], instruction: "Fill a backpack or shopping bag. Hinge with a flat back and row it to the ribs." },
  "bear-crawl":     { name: "Bear Crawl", cue: "Bear crawl", equipment: [], pattern: "core", subs: ["plank-shoulder-taps"], instruction: "Hands and feet, knees just off the ground. Crawl forward and back, hips low." },
  "side-plank":     { name: "Side Plank", cue: "Side plank", equipment: [], pattern: "core", instruction: "Elbow under the shoulder, hips high. Switch sides halfway." },
  "plank-shoulder-taps": { name: "Plank Shoulder Taps", cue: "Plank shoulder taps", equipment: [], pattern: "core", instruction: "High plank, feet wide. Tap each shoulder without rocking the hips." },
  "bird-dog":       { name: "Bird Dogs", cue: "Bird dogs", equipment: [], pattern: "core", instruction: "On hands and knees, reach the opposite arm and leg long. Slow, alternate sides." },
  "burpee":         { name: "Burpees", cue: "Burpees", equipment: [], pattern: "conditioning", subs: ["squat-thrust"], instruction: "Hands down, jump or step back to a plank, back up and jump. Step it out if you need to." },
  "squat-thrust":   { name: "Step-back Burpees", cue: "Step back burpees", equipment: [], pattern: "conditioning", instruction: "Hands down, step back to a plank one foot at a time, step in, stand. No jump." },
  "mountain-climbers": { name: "Mountain Climbers", cue: "Mountain climbers", equipment: [], pattern: "conditioning", subs: ["high-knees"], instruction: "High plank, drive the knees to the chest one at a time. Hips level." },
  "skater-jumps":   { name: "Skater Jumps", cue: "Skater jumps", equipment: [], pattern: "conditioning", subs: ["high-knees"], instruction: "Leap side to side, land on one leg with a soft knee. Step instead of jump to go easier." },
  "high-knees":     { name: "High Knees", cue: "High knees", equipment: [], pattern: "conditioning", subs: ["march-in-place"], instruction: "Run in place, knees to hip height, quick arms." },
  "jumping-jacks":  { name: "Jumping Jacks", cue: "Jumping jacks", equipment: [], pattern: "conditioning", subs: ["march-in-place"], instruction: "Light and quick on the balls of the feet." },
});
EXERCISES["run-outside"].pattern = EXERCISES["walk-outside"].pattern = "cardio";
EXERCISES["jog-in-place"].pattern = EXERCISES["march-in-place"].pattern = "cardio";

/* No weights? Every loaded movement falls back to a bodyweight version (listed
   last, so owned equipment is always preferred). */
const BODYWEIGHT_SUBS = {
  squat: ["air-squat", "jump-squat"], hinge: ["single-leg-rdl", "glute-bridge"], power: ["hinge-jump", "glute-bridge"],
  lunge: ["bw-lunge", "split-squat"], press: ["pike-push-up", "push-up"], floor: ["push-up", "knee-push-up"],
  pull: ["prone-ytw", "backpack-row"], carry: ["bear-crawl"],
};
Object.entries({
  squat: ["goblet-squat", "db-squat", "kb-front-squat", "db-thruster", "squat-press"],
  hinge: ["kb-deadlift", "db-rdl"], power: ["db-swing", "db-clean", "high-pull", "deadlift-front-rack"],
  lunge: ["kb-reverse-lunge", "reverse-lunge"], press: ["kb-push-press", "push-press", "shoulder-press"], floor: ["db-floor-press"],
  pull: ["kb-row", "db-row", "bent-over-row"], carry: ["farmer-march"],
}).forEach(([kind, ids]) => ids.forEach(id => {
  EXERCISES[id].subs = [...(EXERCISES[id].subs || []), ...BODYWEIGHT_SUBS[kind]];
}));

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
const LOW_IMPACT_IDS = ["carry-me-home", "engine-builder", "tri-15", "bike-bells", "quiet-room", "first-steps", "run-walk"];

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
    id: "no-gear-base", name: "No-Gear Base", tagline: "Get fit with nothing but you", level: "beginner",
    about: "Three sessions a week, no equipment and no gym. Bodyweight strength, outdoor run/walk intervals, and a lighter week 4 to lock it in.",
    weeks: [
      [{ t: "first-steps" }, { t: "run-walk" }, { t: "quiet-room" }],
      [{ t: "quiet-room" }, { t: "run-walk", adj: { rounds: 1 } }, { t: "anywhere-20" }],
      [{ t: "anywhere-20" }, { t: "run-walk", adj: { rounds: 2, runSec: 15 } }, { t: "park-hybrid", adj: { rounds: -2 } }],
      [{ t: "quiet-room", adj: { rounds: -1 } }, { t: "run-walk", adj: { runSec: 30 } }],
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
