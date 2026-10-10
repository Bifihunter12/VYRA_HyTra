"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   Iron Forest — Challenge engine
   TRAIN ALONE. COMPETE TOGETHER.

   Nothing here is hard-coded to one workout. Every competitive thing in Iron Forest is
   a Challenge built from the same parts:

   Movement     EXERCISES (workouts.js) — run, row, carry, swing…
   Segment      a block: timed ("20 min row") or to a target ("1 km run", "30 swings")
   Challenge    { id, name, kind, scoring, better, variants, divisions, rules, inputs, build }
   Attempt      one try: { challengeId, variant, division, score, splits, verification, date }
   Result       the best attempt for a challenge/variant/division in a period
   Leaderboard  best result per athlete, ranked, filtered by period/division/category/age
   Division     open | competitive | elite — scales loads and standards, same intent
   Verification training | community | verified
   Event        a dated competition made of challenges (Phase 3: Iron Forest)

   Scores are stored in base units: meters, seconds, reps, kilograms, rounds
   (fractional: 6 rounds + 12 of 30 reps = 6.4), points, or 1 for completion.
   ════════════════════════════════════════════════════════════════════════════ */

const SCORING = {
  time:       { label: "For time",     unit: "s",      better: "lower" },
  distance:   { label: "For distance", unit: "m",      better: "higher" },
  reps:       { label: "For reps",     unit: "reps",   better: "higher" },
  load:       { label: "For load",     unit: "kg",     better: "higher" },
  rounds:     { label: "For rounds",   unit: "rounds", better: "higher" },
  points:     { label: "For points",   unit: "pts",    better: "higher" },
  completion: { label: "Completion",   unit: "",       better: "higher" },
};

const DIVISIONS = [
  { id: "open",        label: "Open",        desc: "Everyone welcome. Lighter standards." },
  { id: "competitive", label: "Competitive", desc: "Trained athletes. Standard loads." },
  { id: "elite",       label: "Elite",       desc: "Heavier loads and steeper standards." },
];
const ATHLETE_CATEGORIES = [{ id: "women", label: "Women" }, { id: "men", label: "Men" }, { id: "open", label: "Open" }];
const VERIFICATION = {
  training:  { label: "Training",  desc: "Just for you. Not on leaderboards." },
  community: { label: "Community", desc: "On leaderboards. Honour system." },
  verified:  { label: "Verified",  desc: "Video checked by Iron Forest." },
};

/* Age groups for comparison. */
function ageGroup(birthYear, now = new Date()) {
  if (!birthYear) return null;
  const age = now.getFullYear() - birthYear;
  if (age < 30) return "u30";
  if (age < 40) return "30-39";
  if (age < 50) return "40-49";
  if (age < 60) return "50-59";
  return "60+";
}
const AGE_LABEL = { u30: "Under 30", "30-39": "30–39", "40-49": "40–49", "50-59": "50–59", "60+": "60+" };

/* Division loads: [dumbbell each hand, single kettlebell] in kg. */
const LOADS = { open: { db: 12.5, kb: 16 }, competitive: { db: 17.5, kb: 24 }, elite: { db: 22.5, kb: 32 } };
const loadText = (div, kind) => `${LOADS[div][kind]} kg${kind === "db" ? " each" : ""}`;

/* ── Segment builders (wrap workouts.js builders) ───────────────────────────── */
const toDistance = (id, meters, estimate, more = {}) => cardio(id, null, {
  target: meters >= 1000 ? { distance: +(meters / 1000).toFixed(2), unit: "km" } : { distance: meters, unit: "m" },
  estimate, ...more,
});
const forReps = (id, n, estimate, more = {}) => station([ex(id, reps(n, more.target || {}))], null, { estimate, ...more });
/* Distances the way the coach says them: 500 → "500 meters", 2000 → "2 kilometers". */
const sayDist = m => m >= 1000 && m % 1000 === 0 ? (m === 1000 ? "one kilometer" : `${m / 1000} kilometers`) : `${m} meters`;
/* Story lines only on the first round of a repeated workout; later rounds use the normal coaching. */
const firstOnly = (i, more) => i === 0 ? more : { ...more, story: "" };

const ASCENT = ["Base Camp", "The Foothills", "The Treeline", "The Ridge", "The Scree", "The Ice", "Thin Air", "The Wall", "The Shoulder", "The Summit"];
const CHASE_HARD = ["They've seen you. Run!", "They're closing in. Go!", "Footsteps behind you. Push!", "Break away. Hard!", "Don't look back. Run!"];
const CHASE_EASY = ["You lost them. Easy now.", "Hide and breathe.", "Quiet. Recover.", "Catch your breath.", "Easy. They're still searching."];

/* ── Benchmarks: permanent, standardized, repeatable ───────────────────────── */
const BENCHMARKS = [
  {
    id: "three-rivers", name: "Three Rivers", tagline: "Row · Bike · Run", scoring: "distance", icon: "ti-ripple",
    story: "Three rivers stand between you and home. Row the first, ride along the bank of the second, run beside the last. Every meter you cover counts.",
    partWord: "River", finale: "Three rivers crossed. Write down every meter.",
    variants: [{ id: "sprint", name: "Sprint", min: 5 }, { id: "standard", name: "Standard", min: 10 }, { id: "endurance", name: "Endurance", min: 20 }],
    defaultVariant: "standard", equipment: ["rower", "bike", "treadmill"], level: "beginner",
    rules: ["Row, then bike, then run, back to back.", "Up to 60 seconds to switch machines (the clock pauses).", "Any resistance and incline ≥ 1%."],
    inputs: () => [{ key: "row", label: "Row", unit: "m" }, { key: "bike", label: "Bike", unit: "km" }, { key: "run", label: "Run", unit: "km" }],
    build: v => ({ rounds: [round([
      cardio("row", v.min * 60, { title: "The First River", story: `River one. Row across. ${v.min} minutes, every meter counts.` }), rest(60, "Switch to the bike"),
      cardio("bike", v.min * 60, { title: "The Riverbank", story: `River two. Ride the riverbank. ${v.min} minutes.` }), rest(60, "Switch to the treadmill"),
      cardio("run", v.min * 60, { title: "The Last River", story: `River three. Run it home. ${v.min} minutes, empty the tank.` })])] }),
  },
  {
    id: "the-hunt", name: "The Hunt", tagline: "Run for time", scoring: "time", icon: "ti-run",
    story: "Something is moving in the forest, and tonight you're the hunter. Settle into the chase and run it down. Treadmill at 1% or a flat route outside.",
    finale: "Caught it. The hunt is over. Clock's stopped.",
    variants: [{ id: "3k", name: "3 km", m: 3000 }, { id: "5k", name: "5 km", m: 5000 }, { id: "10k", name: "10 km", m: 10000 }],
    defaultVariant: "5k", equipment: ["treadmill|outdoors"], level: "beginner",
    rules: ["Treadmill incline ≥ 1%, or outdoors on a flat route measured by a watch or phone.", "Tap DONE when your distance reads the target."],
    build: v => ({ rounds: [round([toDistance("run", v.m, v.m * 0.33, { title: "The Hunt", story: `The hunt is on. ${sayDist(v.m)}. Settle in, then run it down.` })])] }),
  },
  {
    id: "the-river", name: "The River", tagline: "Row for time", scoring: "time", icon: "ti-ripple",
    story: "The bridge is gone. The only way across is to row. Find your rhythm and hold it all the way to the far bank.",
    finale: "You made the far bank. Clock's stopped.",
    variants: [{ id: "500", name: "500 m", m: 500 }, { id: "2k", name: "2,000 m", m: 2000 }, { id: "5k", name: "5,000 m", m: 5000 }],
    defaultVariant: "2k", equipment: ["rower"], level: "beginner",
    rules: ["Any damper setting.", "Tap DONE when the monitor reaches the target."],
    build: v => ({ rounds: [round([toDistance("row", v.m, v.m * 0.25, { title: "The Crossing", story: `Into the boat. ${sayDist(v.m)} to the far bank. Long, strong strokes.` })])] }),
  },
  {
    id: "the-mountain", name: "The Mountain", tagline: "Climb for distance", scoring: "distance", icon: "ti-mountain",
    story: "The only way out is over the mountain. Keep climbing, walk or run, and don't touch the rails. How far up can you get?",
    finale: "Time. Look how far you climbed. Write down your distance.",
    variants: [{ id: "20", name: "20 min", min: 20 }, { id: "40", name: "40 min", min: 40 }],
    defaultVariant: "20", equipment: ["treadmill"], level: "intermediate",
    divisions: { open: "Incline ≥ 8%", competitive: "Incline ≥ 12%", elite: "Incline ≥ 15%" },
    rules: ["Hold your division's incline the whole time.", "No holding the handrails."],
    inputs: () => [{ key: "run", label: "Treadmill distance", unit: "km" }],
    build: (v, d) => ({ rounds: [round([cardio("incline-walk", v.min * 60, { effort: { open: "8%+ incline", competitive: "12%+ incline", elite: "15%+ incline" }[d],
      title: "The Mountain", story: `The climb begins. ${v.min} minutes uphill. Steady legs, hands off the rails.` })])] }),
  },
  {
    id: "the-ascent", name: "The Ascent", tagline: "Incline ladder", scoring: "time", better: "higher", icon: "ti-trending-up",
    story: "From base camp to the summit, the trail gets two percent steeper every two minutes. How high can you climb before the mountain wins?",
    partWord: "Stage", finale: "You reached the summit. Nobody climbs higher than that.",
    variants: [{ id: "standard", name: "Standard" }], defaultVariant: "standard", equipment: ["treadmill"], level: "intermediate",
    divisions: { open: "5.0 km/h", competitive: "5.5 km/h", elite: "6.0 km/h" },
    rules: ["Start at 2% incline at your division's speed.", "Add 2% incline every 2 minutes.", "Tap END when you can't keep the pace without the rails. Your time is your score."],
    build: (v, d) => ({ rounds: [round(Array.from({ length: 10 }, (_, i) => cardio("incline-walk", 120, {
      title: ASCENT[i], cue: `Stage ${i + 1}. ${2 + i * 2} percent`, story: `Stage ${i + 1}. ${ASCENT[i]}. ${2 + i * 2} percent.`, effort: `${2 + i * 2}% · ${{ open: "5.0", competitive: "5.5", elite: "6.0" }[d]} km/h` })))] }),
  },
  {
    id: "the-chase", name: "The Chase", tagline: "Intervals for distance", scoring: "distance", icon: "ti-bolt",
    story: "You've been spotted. Ten times they close in, ten times you break away. Sprint the hard minutes, hide and recover on the easy ones.",
    finale: "You got away. Write down your distance.",
    variants: [{ id: "standard", name: "10 × 1:00" }], defaultVariant: "standard", equipment: ["treadmill|outdoors"], level: "intermediate",
    rules: ["1:00 hard, 1:00 easy, ten times.", "Score is the total distance after 20 minutes, from the treadmill or your watch/phone outdoors."],
    inputs: () => [{ key: "run", label: "Total distance", unit: "km" }],
    build: () => ({ rounds: Array.from({ length: 10 }, (_, i) => round([
      cardio("run", 60, { effort: "Hard", title: "Break Away", story: i === 9 ? "Last time. Lose them for good!" : CHASE_HARD[i % 5] }),
      cardio("incline-walk", 60, { title: "Hide", effort: "Easy jog or walk", story: i === 9 ? "" : CHASE_EASY[i % 5] })])) }),
  },
  {
    id: "the-long-march", name: "The Long March", tagline: "Walk for distance", scoring: "distance", icon: "ti-walk",
    story: "The road home is long and there's no shortcut. Walk it steady, loaded or not. The march rewards patience.",
    finale: "You made it home. Write down your distance.",
    variants: [{ id: "30", name: "30 min", min: 30 }, { id: "60", name: "60 min", min: 60 }],
    defaultVariant: "60", equipment: ["treadmill|outdoors"], level: "beginner",
    divisions: { open: "Walk or jog", competitive: "Incline ≥ 5%", elite: "Incline ≥ 5% + 10 kg pack" },
    rules: ["Walking only for Competitive and Elite.", "Score is total distance."],
    inputs: () => [{ key: "run", label: "Distance", unit: "km" }],
    build: v => ({ rounds: [round([cardio("incline-walk", v.min * 60, { title: "The Road Home", story: `The march begins. ${v.min} minutes on the road. Find a pace you could hold all day.` })])] }),
  },
  {
    id: "the-crossing", name: "The Crossing", tagline: "Run · Row · Bike for time", scoring: "time", icon: "ti-route",
    story: "Three terrains between you and the border: the road, the lake and the long valley. Cross them all, fast.",
    partWord: "Leg", finale: "Across the border. Clock's stopped.",
    variants: [{ id: "standard", name: "2 · 2 · 4 km" }], defaultVariant: "standard", equipment: ["treadmill", "rower", "bike"], level: "intermediate",
    rules: ["2 km run, 2 km row, 4 km bike.", "The clock runs through transitions."],
    build: () => ({ rounds: [round([
      toDistance("run", 2000, 660, { title: "The Road", story: "Leg one. The road. Run two kilometers." }),
      toDistance("row", 2000, 520, { title: "The Lake", story: "Leg two. The lake. Row two kilometers." }),
      toDistance("bike", 4000, 480, { title: "The Valley", story: "Last leg. The long valley. Ride four kilometers to the border." })])] }),
  },
  {
    id: "iron-mile", name: "Iron Mile", tagline: "The hybrid mile", scoring: "time", icon: "ti-flame",
    story: "Four laps around the old iron works, with a job waiting at every gate: ring the bell, stoke the furnace, lift the iron. Short, honest, painful.",
    finale: "That's the Iron Mile. Clock's stopped.",
    variants: [{ id: "standard", name: "Standard" }], defaultVariant: "standard", equipment: ["treadmill|outdoors", "kettlebell", "dumbbell"], level: "intermediate",
    divisions: { open: `KB ${loadText("open", "kb")} · DB ${loadText("open", "db")}`, competitive: `KB ${loadText("competitive", "kb")} · DB ${loadText("competitive", "db")}`, elite: `KB ${loadText("elite", "kb")} · DB ${loadText("elite", "db")}` },
    rules: ["400 m run · 20 KB swings · 400 m run · 20 goblet squats · 400 m run · 20 DB push press · 400 m run."],
    build: () => ({ rounds: [round([
      toDistance("run", 400, 120, { title: "Lap One", story: "Lap one. 400 meters around the iron works." }),
      forReps("kb-swing", 20, 50, { name: "Ring the Bell", cue: "Ring the bell", story: "Ring the bell. 20 kettlebell swings." }),
      toDistance("run", 400, 120, { title: "Lap Two", story: "Lap two. 400 meters." }),
      forReps("goblet-squat", 20, 60, { name: "Stoke the Furnace", cue: "Stoke the furnace", story: "Stoke the furnace. 20 goblet squats." }),
      toDistance("run", 400, 120, { title: "Lap Three", story: "Lap three. 400 meters. Stay honest." }),
      forReps("push-press", 20, 60, { name: "Lift the Iron", cue: "Lift the iron", story: "Lift the iron. 20 push presses, all the way overhead." }),
      toDistance("run", 400, 120, { title: "The Final Lap", story: "The final lap. 400 meters. Empty everything!" })])] }),
  },
  {
    id: "the-forge", name: "The Forge", tagline: "Kettlebell & dumbbell for time", scoring: "time", icon: "ti-barbell",
    story: "Five heats at the forge. Swing the hammer, work the bellows, lift the iron, haul the coal, then do it again until the blade is done. Smooth is fast.",
    finale: "The blade is forged. Clock's stopped.",
    variants: [{ id: "standard", name: "5 rounds" }], defaultVariant: "standard", equipment: ["kettlebell", "dumbbell"], level: "intermediate",
    divisions: { open: `KB ${loadText("open", "kb")} · DB ${loadText("open", "db")}`, competitive: `KB ${loadText("competitive", "kb")} · DB ${loadText("competitive", "db")}`, elite: `KB ${loadText("elite", "kb")} · DB ${loadText("elite", "db")}` },
    rules: ["5 rounds: 10 KB swings, 10 goblet squats, 10 DB push press, 10 DB rows per side."],
    build: () => ({ rounds: Array.from({ length: 5 }, (_, i) => round([
      forReps("kb-swing", 10, 25, firstOnly(i, { name: "The Hammer", cue: "The hammer", story: "First heat. The hammer. 10 kettlebell swings." })),
      forReps("goblet-squat", 10, 30, firstOnly(i, { name: "The Bellows", cue: "The bellows", story: "The bellows. 10 goblet squats." })),
      forReps("push-press", 10, 30, firstOnly(i, { name: "Lift the Iron", cue: "Lift the iron", story: "Lift the iron. 10 push presses." })),
      forReps("db-row", 10, 45, firstOnly(i, { name: "Haul the Coal", cue: "Haul the coal", target: { perSide: true }, story: "Haul the coal. 10 rows each side." }))])) }),
  },
  {
    id: "the-mill", name: "The Mill", tagline: "Ten rounds for time", scoring: "time", icon: "ti-repeat",
    story: "The old mill by the river still turns. Row the water to drive the wheel, swing the stone to grind the grain. Ten turns, then it's done. The mill grinds everyone down.",
    finale: "The grain is ground. The Mill is done. Clock's stopped.",
    variants: [{ id: "standard", name: "10 rounds" }], defaultVariant: "standard", equipment: ["rower", "kettlebell"], level: "intermediate",
    divisions: { open: `KB ${loadText("open", "kb")}`, competitive: `KB ${loadText("competitive", "kb")}`, elite: `KB ${loadText("elite", "kb")}` },
    rules: ["10 rounds: 250 m row, 10 KB swings."],
    build: () => ({ rounds: Array.from({ length: 10 }, (_, i) => round([
      toDistance("row", 250, 60, { title: "Turn the Wheel", story: i === 0 ? "First turn. Row 250 meters to drive the wheel." : i === 5 ? "Halfway. The mill keeps turning. Row 250 meters." : "" }),
      forReps("kb-swing", 10, 25, { name: "Grind the Stone", cue: "Grind the stone", story: i === 0 ? "Grind the stone. 10 kettlebell swings." : "" })])) }),
  },
  {
    id: "the-gauntlet", name: "The Gauntlet", tagline: "Every modality, for time", scoring: "time", icon: "ti-shield-check",
    story: "Six trials stand between you and the gate: the trail, the current, the pass, the load, the pit and the gate itself. Nothing to hide behind.",
    partWord: "Trial", finale: "You ran the Gauntlet. Clock's stopped.",
    variants: [{ id: "standard", name: "Standard" }], defaultVariant: "standard", equipment: ["treadmill", "rower", "bike", "kettlebell", "dumbbell"], level: "advanced",
    divisions: { open: `KB ${loadText("open", "kb")} · DB ${loadText("open", "db")}`, competitive: `KB ${loadText("competitive", "kb")} · DB ${loadText("competitive", "db")}`, elite: `KB ${loadText("elite", "kb")} · DB ${loadText("elite", "db")}` },
    rules: ["1 km run · 1 km row · 2 km bike · 100 m farmer carry · 30 goblet squats · 30 KB swings."],
    build: () => ({ rounds: [round([
      toDistance("run", 1000, 330, { title: "The Trail", story: "Trial one. The trail. Run one kilometer." }),
      toDistance("row", 1000, 260, { title: "The Current", story: "Trial two. The current. Row one kilometer." }),
      toDistance("bike", 2000, 240, { title: "The Pass", story: "Trial three. The pass. Ride two kilometers." }),
      station([ex("farmer-carry", { distance: 100, unit: "m" })], null, { estimate: 90, name: "The Load", cue: "The load", story: "Trial four. The load. Farmer carry, 100 meters." }),
      forReps("goblet-squat", 30, 90, { name: "The Pit", cue: "The pit", story: "Trial five. The pit. 30 goblet squats." }),
      forReps("kb-swing", 30, 75, { name: "The Gate", cue: "The gate", story: "Last trial. Break the gate. 30 kettlebell swings!" })])] }),
  },
  {
    id: "the-burden", name: "The Burden", tagline: "Carry for distance", scoring: "distance", icon: "ti-weight",
    story: "The camp needs water and you're the one carrying it. Heavy in each hand, five minutes on the clock. Put it down when you must, pick it up and keep going.",
    finale: "Water delivered. Write down your meters.",
    variants: [{ id: "5", name: "5 min", min: 5 }], defaultVariant: "5", equipment: ["dumbbell"], level: "beginner",
    divisions: { open: "2 × 16 kg", competitive: "2 × 24 kg", elite: "2 × 32 kg" },
    rules: ["Farmer carry your division's load.", "Measure a lane, count lengths. Score is total meters."],
    inputs: () => [{ key: "carry", label: "Meters carried", unit: "m" }],
    build: v => ({ rounds: [round([station([ex("farmer-carry")], v.min * 60, { name: "The Burden", cue: "Farmer carry", story: `Pick up the water. ${v.min} minutes of farmer carries. Count every length.` })])] }),
  },
  {
    id: "the-anvil", name: "The Anvil", tagline: "Heaviest carry", scoring: "load", icon: "ti-barbell",
    story: "The blacksmith needs the heaviest iron in the forest moved twenty metres. Build up, attempt by attempt, until you find the heaviest pair you can carry without putting it down.",
    finale: "That's your anvil. Write down the heaviest pair you carried.",
    variants: [{ id: "20m", name: "20 m carry" }], defaultVariant: "20m", equipment: ["dumbbell"], level: "intermediate",
    rules: ["Build up over ~12 minutes.", "20 m without setting the weights down.", "Score is the total of both hands."],
    inputs: () => [{ key: "load", label: "Total load (both hands)", unit: "kg" }],
    build: () => ({ rounds: [round([station([ex("farmer-carry")], 12 * 60, { name: "Build to a heavy carry", cue: "Build to your heaviest carry", note: "Rest as needed between attempts.", story: "Find your anvil. Twenty meters, no putting it down. Build up slowly, rest between attempts." })])] }),
  },
  {
    id: "the-stand", name: "The Stand", tagline: "Goblet squats for reps", scoring: "reps", icon: "ti-stairs",
    story: "They're coming through the pass and you're the one holding it. Five minutes, one weight. Every good squat holds the line.",
    finale: "The line held. Write down your squats.",
    variants: [{ id: "5", name: "5 min", min: 5 }], defaultVariant: "5", equipment: ["dumbbell"], level: "beginner",
    divisions: { open: "DB or KB 12 kg", competitive: "DB or KB 20 kg", elite: "DB or KB 28 kg" },
    rules: ["Hip crease below the knee, stand fully.", "Rest as needed, the clock keeps running."],
    inputs: () => [{ key: "reps", label: "Goblet squats", unit: "reps" }],
    build: v => ({ rounds: [round([station([ex("goblet-squat")], v.min * 60, { name: "The Stand", cue: "Goblet squats", story: `Hold the pass. ${v.min} minutes of goblet squats. Count every rep.` })])] }),
  },
  {
    id: "the-storm", name: "The Storm", tagline: "Mixed rounds", scoring: "rounds", icon: "ti-bolt",
    story: "The storm rolls in for twenty minutes. Row, squat, swing and press to keep the camp standing until it passes. Count your rounds.",
    finale: "The storm has passed. Count your rounds.",
    variants: [{ id: "20", name: "20 min", min: 20 }], defaultVariant: "20", equipment: ["rower", "kettlebell", "dumbbell"], level: "intermediate",
    divisions: { open: `KB ${loadText("open", "kb")} · DB ${loadText("open", "db")}`, competitive: `KB ${loadText("competitive", "kb")} · DB ${loadText("competitive", "db")}`, elite: `KB ${loadText("elite", "kb")} · DB ${loadText("elite", "db")}` },
    roundReps: 4, // movements per round, for the "+ reps" part of the score
    rules: ["As many rounds as possible in 20 minutes of: 200 m row, 10 goblet squats, 10 KB swings, 10 DB push press.", "Score rounds + movements done in the last round."],
    inputs: () => [{ key: "rounds", label: "Full rounds", unit: "rounds" }, { key: "extra", label: "Movements into the next round (0–3)", unit: "of 4" }],
    build: v => ({ rounds: [round([station([ex("row-sprint", { distance: 200, unit: "m" }), ex("goblet-squat", reps(10)), ex("kb-swing", reps(10)), ex("push-press", reps(10))], v.min * 60,
      { name: "The Storm", cue: "The Storm. As many rounds as possible", note: "Count your rounds.", circuit: true,
        story: `The storm hits. ${v.min} minutes. Row 200 meters, 10 squats, 10 swings, 10 presses, and round you go.` })])] }),
  },
  {
    id: "iron-hour", name: "Iron Hour", tagline: "60 minutes for distance", scoring: "distance", icon: "ti-hourglass",
    story: "The longest day in the Iron Forest. Run, row and ride twice through, ten minutes each, from dawn to dusk.",
    partWord: "Leg", finale: "The longest day is over. Write down every meter.",
    variants: [{ id: "standard", name: "60 min" }], defaultVariant: "standard", equipment: ["treadmill", "rower", "bike"], level: "advanced",
    rules: ["10 min each: run, row, bike, run, row, bike.", "Switches are on your own time.", "Score is total distance."],
    inputs: () => [{ key: "run", label: "Run (both legs)", unit: "km" }, { key: "row", label: "Row (both legs)", unit: "m" }, { key: "bike", label: "Bike (both legs)", unit: "km" }],
    build: () => ({ rounds: [round([
      ["run", "Dawn", "Leg one. Dawn. Ten minutes running."], ["row", "Morning", "Leg two. Morning on the river. Row ten minutes."],
      ["bike", "Midday", "Leg three. Midday. Ride ten minutes."], ["run", "Afternoon", "Leg four. Afternoon. Second time through. Run ten minutes."],
      ["row", "Evening", "Leg five. Evening. Row ten minutes."], ["bike", "Dusk", "Last leg. Dusk. Ride ten minutes, then the day is done."],
    ].map(([m, title, story]) => cardio(m, 600, { title, story })))] }),
  },
  // ── No equipment: anyone, anywhere can compete ─────────────────────────
  {
    id: "the-clearing", name: "The Clearing", tagline: "Run · burpees · run", scoring: "time", icon: "ti-trees",
    story: "There's a clearing in the middle of the forest. Run out to it, fight your way through it, run back home. No gym needed, just a measured kilometre and a patch of ground.",
    finale: "Home again. Clock's stopped.",
    variants: [{ id: "standard", name: "1 km · 50 · 1 km" }], defaultVariant: "standard", equipment: ["treadmill|outdoors"], level: "intermediate",
    divisions: { open: "Step-back burpees allowed", competitive: "Chest to the floor, jump at the top", elite: "Chest to the floor, jump over a line" },
    rules: ["1 km run · 50 burpees · 1 km run, for time.", "Outdoors on a measured route or treadmill ≥ 1%.", "The clock runs through transitions."],
    build: () => ({ rounds: [round([
      toDistance("run", 1000, 330, { title: "Out to the Clearing", story: "Out to the clearing. Run one kilometer." }),
      forReps("burpee", 50, 180, { name: "The Clearing", cue: "The clearing", story: "The clearing. 50 burpees. Break them up however you like." }),
      toDistance("run", 1000, 330, { title: "Back Home", story: "Now run home. One kilometer, everything you've got!" })])] }),
  },
  {
    id: "the-hundred", name: "The Hundred", tagline: "Bodyweight for time", scoring: "time", icon: "ti-stretching",
    story: "Every recruit to the forest guard passes the same test: one hundred squats, fifty push-ups, twenty-five burpees. Break them up however you like.",
    finale: "Test passed. Welcome to the forest guard. Clock's stopped.",
    variants: [{ id: "standard", name: "100 · 50 · 25" }], defaultVariant: "standard", equipment: [], level: "beginner",
    divisions: { open: "Knee push-ups and step-back burpees allowed", competitive: "Full push-ups and burpees", elite: "Hand-release push-ups, jumping burpees" },
    rules: ["100 air squats, then 50 push-ups, then 25 burpees.", "Squats: hip crease below the knee. Push-ups: chest to a fist-height target."],
    build: () => ({ rounds: [round([
      forReps("air-squat", 100, 180, { name: "The Legs", cue: "The legs", story: "The test begins. 100 squats." }),
      forReps("push-up", 50, 150, { name: "The Arms", cue: "The arms", story: "50 push-ups. Body in one straight line." }),
      forReps("burpee", 25, 100, { name: "The Heart", cue: "The heart", story: "Last part. 25 burpees. Earn your place!" })])] }),
  },
  {
    id: "the-shield", name: "The Shield", tagline: "Push-ups for reps", scoring: "reps", icon: "ti-shield",
    story: "The arrows are coming. Hold up your shield. Two minutes, as many good push-ups as you can hold together.",
    finale: "The shield held. Write down your push-ups.",
    variants: [{ id: "2", name: "2 min", min: 2 }], defaultVariant: "2", equipment: [], level: "beginner",
    divisions: { open: "Knee push-ups", competitive: "Full push-ups", elite: "Hand-release push-ups" },
    rules: ["Body in one line, chest to a fist-height target, arms locked at the top.", "Rest in the plank or on the knees; the clock keeps running."],
    inputs: () => [{ key: "reps", label: "Push-ups", unit: "reps" }],
    build: v => ({ rounds: [round([station([ex("push-up")], v.min * 60, { name: "The Shield", cue: "Push ups", story: `Shields up. ${v.min} minutes of push-ups. Every rep counts.` })])] }),
  },
  // ── Story challenges ───────────────────────────────────────────────────
  {
    id: "the-escape", name: "The Escape", tagline: "Ten stages out of the forest", scoring: "time", icon: "ti-trees", partWord: "Stage", finale: "escaped",
    story: "You're deep in the Iron Forest. Run through the trees, cross the river, haul your supplies, fight through the thicket and carry the wounded. Ten stages, one clock. Get out.",
    variants: [{ id: "standard", name: "Full Escape", s: 1 }, { id: "half", name: "Half Escape", s: 0.5 }], defaultVariant: "standard",
    equipment: ["treadmill|outdoors", "rower", "kettlebell", "dumbbell|kettlebell"], level: "intermediate",
    divisions: { open: `KB ${loadText("open", "kb")} · DB ${loadText("open", "db")}`, competitive: `KB ${loadText("competitive", "kb")} · DB ${loadText("competitive", "db")}`, elite: `KB ${loadText("elite", "kb")} · DB ${loadText("elite", "db")}` },
    rules: ["10 stages back to back, for time. The clock runs through every transition.",
      "Full: 800 m run · 500 m row · 100 m farmer carry · 20 burpees · 30 KB swings · 800 m run · 500 m row · 40 step-ups · 100 m front-rack carry · 1 km run.",
      "Half: the same stages with half the distance and reps.", "Runs outdoors on a measured route or treadmill ≥ 1%. Step-ups on a box or bench, knee height."],
    build: v => {
      const s = v.s || 1, n = x => Math.round(x * s);
      const carry = (id, m, title, story) => station([ex(id, { distance: n(m), unit: "m" })], null, { estimate: n(m) * 0.9, name: title, cue: title, story });
      return { rounds: [round([
        toDistance("run", n(800), n(800) * 0.33, { title: "Into the Trees", story: `Stage one. Into the trees. Run ${n(800)} meters, steady.` }),
        toDistance("row", n(500), n(500) * 0.26, { title: "The River", story: `Stage two. The river. Row ${n(500)} meters to the other side.` }),
        carry("farmer-carry", 100, "Haul the Supplies", `Stage three. Haul the supplies. Farmer carry, ${n(100)} meters.`),
        forReps("burpee", n(20), n(20) * 3.5, { name: "The Thicket", cue: "The Thicket", story: `Stage four. The thicket. ${n(20)} burpees, down and through.` }),
        forReps("kb-swing", n(30), n(30) * 2.2, { name: "Clear the Path", cue: "Clear the path", story: `Stage five. Clear the path. ${n(30)} kettlebell swings.` }),
        toDistance("run", n(800), n(800) * 0.34, { title: "Back into the Trees", story: `Stage six. Back into the trees. ${n(800)} meters. Halfway out.` }),
        toDistance("row", n(500), n(500) * 0.27, { title: "The Rapids", story: `Stage seven. The rapids. Row ${n(500)} meters, faster this time.` }),
        forReps("step-ups", n(40), n(40) * 1.8, { name: "The Climb", cue: "The Climb", target: { perSide: false }, story: `Stage eight. The climb. ${n(40)} step-ups, alternate legs.` }),
        carry("front-rack-carry", 100, "Carry the Wounded", `Stage nine. Carry the wounded. Front-rack carry, ${n(100)} meters.`),
        toDistance("run", n(1000), n(1000) * 0.33, { title: "The Last Sprint", story: `Stage ten. The last sprint. ${n(1000) >= 1000 ? "One kilometer" : `${n(1000)} meters`}, and you're out of the forest!` }),
      ])] };
    },
  },
];
BENCHMARKS.forEach(b => { b.kind = "benchmark"; b.better = b.better || SCORING[b.scoring].better; });

/* Monthly challenges rotate through benchmarks people can do almost anywhere. */
const MONTHLY_ROTATION = [
  ["three-rivers", "standard"], ["the-storm", "20"], ["iron-mile", "standard"], ["the-burden", "5"], ["the-hunt", "5k"],
  ["the-forge", "standard"], ["the-river", "2k"], ["the-chase", "standard"], ["the-stand", "5"], ["the-mill", "standard"],
  ["the-hundred", "standard"], ["the-clearing", "standard"],
];
/* Months run in UTC, the same window everywhere in the world (and in supabase/006_monthly.sql). */
function monthlyChallenge(now = new Date()) {
  const y = now.getUTCFullYear(), mo = now.getUTCMonth();
  const [id, variant] = MONTHLY_ROTATION[mo % MONTHLY_ROTATION.length];
  const start = Date.UTC(y, mo, 1);
  const end = Date.UTC(y, mo + 1, 1);
  const name = new Date(start).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });
  return { challengeId: id, variant, start, end, monthName: name, key: `${y}-${mo + 1}` };
}

const MONTHLY_FINAL_DAYS = 5;
/* Where the month stands: days left, whether it's the final stretch, and what comes next. */
function monthlyStatus(now = Date.now()) {
  const m = monthlyChallenge(new Date(now));
  const next = monthlyChallenge(new Date(m.end));
  const daysLeft = Math.max(0, Math.ceil((m.end - now) / DAY_MS));
  return { ...m, daysLeft, final: daysLeft <= MONTHLY_FINAL_DAYS, next };
}

/* Special events (Phase 3). Details stay secret until competition week. */
const EVENTS = [
  {
    id: "iron-forest", name: "Iron Forest", status: "coming", opensAt: Date.UTC(2027, 2, 1),
    line: "The forest is coming.",
    pitch: "Don't train for one memorized race. Build a body ready for whatever the Forest asks of you.",
    tests: ["Run", "Carry", "Climb", "Lift", "Pull", "Endure"],
  },
];

/* Challenges defined as data (event Trials, future content) are registered here. */
const EXTRA_CHALLENGES = new Map();
const challengeById = id => BENCHMARKS.find(c => c.id === id) || EXTRA_CHALLENGES.get(id) || null;
function registerChallenge(c) { EXTRA_CHALLENGES.set(c.id, c); return c; }
const variantOf = (c, id) => c.variants.find(v => v.id === id) || c.variants.find(v => v.id === c.defaultVariant) || c.variants[0];

function challengeWorkout(c, variantId, division = "open") {
  const v = variantOf(c, variantId);
  return { id: uid(), templateId: `challenge:${c.id}`, name: `${c.name}${c.variants.length > 1 ? ` · ${v.name}` : ""}`, params: {}, challenge: { id: c.id, variant: v.id, division }, ...c.build(v, division) };
}

/* Benchmarks keep their movements, but a run or walk may happen outdoors instead of on a treadmill. */
function outdoorSwaps(equipment) {
  return !equipment.includes("treadmill") && equipment.includes("outdoors") ? { run: "run-outside", "incline-walk": "walk-outside" } : {};
}
const gearMissing = (c, equipment) => (c.equipment || []).filter(q => !q.split("|").some(x => equipment.includes(x)));

/* ── Scores ─────────────────────────────────────────────────────────────────── */

/* Turn the athlete's typed results (and the engine's time) into one score. */
function scoreFromInputs(c, values, elapsedSec) {
  switch (c.scoring) {
    case "time": return Math.round(elapsedSec);
    case "distance":
      return Math.round((c.inputs ? c.inputs() : []).reduce((a, f) => {
        const v = Number(values[f.key]) || 0;
        return a + (f.unit === "km" ? v * 1000 : v);
      }, 0));
    case "reps": return Math.round(Number(values.reps) || 0);
    case "load": return Number(values.load) || 0;
    case "rounds": return (Number(values.rounds) || 0) + Math.min(c.roundReps - 1, Number(values.extra) || 0) / (c.roundReps || 1);
    case "completion": return 1;
    default: return Number(values.points) || 0;
  }
}

function formatScore(c, score) {
  if (score == null || Number.isNaN(score)) return "—";
  switch (c.scoring) {
    case "time": { const s = Math.round(score); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
      return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`; }
    case "distance": return score >= 1000 ? `${(score / 1000).toFixed(2)} km` : `${Math.round(score)} m`;
    case "reps": return `${score} reps`;
    case "load": return `${score} kg`;
    case "rounds": { const full = Math.floor(score + 1e-9); const extra = Math.round((score - full) * (c.roundReps || 1)); return extra ? `${full} + ${extra}` : `${full} rounds`; }
    case "completion": return "Completed";
    default: return `${score} pts`;
  }
}

/* Signed change vs. the previous best: "+0.80 km" further, "−0:42" faster, "+3 reps". */
function formatDelta(c, delta) {
  const sign = delta < 0 ? "−" : "+";
  const mag = Math.abs(delta);
  if (c.scoring === "time") return `${sign}${formatScore(c, mag)}`;
  if (c.scoring === "distance") return `${sign}${mag >= 1000 ? `${(mag / 1000).toFixed(2)} km` : `${Math.round(mag)} m`}`;
  if (c.scoring === "rounds") return `${sign}${Math.round(mag * (c.roundReps || 1))} movements`;
  return `${sign}${Math.round(mag * 10) / 10} ${SCORING[c.scoring].unit}`;
}

const isBetter = (c, a, b) => (b == null ? true : c.better === "lower" ? a < b : a > b);

/* Attempts that count for comparisons: same challenge, variant and division, finished, not training-only DNFs. */
function comparable(attempts, c, variant, division) {
  return attempts.filter(a => a.challengeId === c.id && a.variant === variant && (!division || a.division === division) && !a.dnf);
}

function bestAttempt(attempts, c, variant, division, { since = 0, until = Infinity } = {}) {
  return comparable(attempts, c, variant, division).filter(a => a.date >= since && a.date < until)
    .reduce((best, a) => (isBetter(c, a.score, best?.score) ? a : best), null);
}

/* PR check for a new attempt against everything before it. */
function prCheck(attempts, attempt) {
  const c = challengeById(attempt.challengeId);
  if (!c || attempt.dnf) return { pr: false, first: false, delta: 0 };
  const before = comparable(attempts, c, attempt.variant, attempt.division).filter(a => a.id !== attempt.id && a.date < attempt.date);
  const prev = before.reduce((best, a) => (isBetter(c, a.score, best?.score) ? a : best), null);
  if (!prev) return { pr: true, first: true, delta: 0 };
  return { pr: isBetter(c, attempt.score, prev.score), first: false, delta: attempt.score - prev.score, previous: prev.score };
}

/* Rank a list of { score } entries for a challenge (ties share a rank). */
function rankEntries(c, entries) {
  const sorted = [...entries].sort((a, b) => (c.better === "lower" ? a.score - b.score : b.score - a.score));
  let rank = 0, last = null;
  return sorted.map((e, i) => { if (e.score !== last) { rank = i + 1; last = e.score; } return { ...e, rank }; });
}


/* ════════════════════════════════════════════════════════════════════════════
   Phase 3 — data-driven challenges, ghost racing, events and Forest Points
   ════════════════════════════════════════════════════════════════════════════ */

/* A challenge described as JSON (stored in the database for events):
   { id, name, scoring, better?, tagline?, story?, rules?, rounds?, inputs?, roundReps?, divisions?,
     segments: [ { type: "cardio", ex, sec | meters, estimate?, effort?, title? }
               | { type: "station", exercises: [{ id, reps?, meters? }], sec?, name?, estimate?, note? }
               | { type: "rest", sec, label? } ] }
   Unknown movements are rejected so a bad spec can't break the player. */
function challengeFromSpec(spec) {
  if (!spec || !spec.id || !SCORING[spec.scoring] || !Array.isArray(spec.segments) || !spec.segments.length) throw new Error("Invalid challenge spec");
  spec.segments.forEach(sg => {
    const ids = sg.type === "cardio" ? [sg.ex] : sg.type === "station" ? (sg.exercises || []).map(e => e.id) : [];
    ids.forEach(id => { if (!EXERCISES[id]) throw new Error(`Unknown movement: ${id}`); });
    if (sg.type === "station" && !(sg.exercises || []).length) throw new Error("Station without movements");
  });
  const seg = sg => {
    if (sg.type === "rest") return rest(sg.sec, sg.label);
    if (sg.type === "cardio") return sg.meters ? toDistance(sg.ex, sg.meters, sg.estimate || sg.meters * 0.3, { title: sg.title, effort: sg.effort })
      : cardio(sg.ex, sg.sec, { title: sg.title, effort: sg.effort });
    const exs = sg.exercises.map(e => ex(e.id, e.reps ? reps(e.reps) : e.meters ? { distance: e.meters, unit: "m" } : undefined));
    return station(exs, sg.sec ?? null, { name: sg.name, estimate: sg.estimate, note: sg.note, circuit: true });
  };
  return {
    kind: spec.kind || "event", icon: spec.icon || "ti-trophy", level: spec.level || "intermediate",
    tagline: spec.tagline || SCORING[spec.scoring].label, story: spec.story || "", rules: spec.rules || [],
    equipment: spec.equipment || [], variants: [{ id: "standard", name: "Standard" }], defaultVariant: "standard",
    ...spec,
    better: spec.better || SCORING[spec.scoring].better,
    inputs: spec.inputs ? () => spec.inputs : undefined,
    build: () => ({ rounds: Array.from({ length: spec.rounds || 1 }, () => round(spec.segments.map(seg))) }),
  };
}

/* ── Ghost racing (for-time challenges) ─────────────────────────────────────
   Checkpoints are cumulative seconds at the end of each scored segment
   (warm-up excluded, rests counted because the clock keeps running).        */

/* Scored segments of a timeline: indices of every interval that isn't warm-up/cool-down or rest. */
function scoredSegments(timeline) {
  return timeline.map((iv, i) => (iv.type !== "WARM" && iv.type !== "REST" ? i : -1)).filter(i => i >= 0);
}

/* My checkpoints from the engine's visit log. */
function checkpointsFromVisits(timeline, visits) {
  let t = 0;
  const cps = [];
  visits.forEach(v => {
    const iv = timeline[v.index];
    if (!iv || iv.type === "WARM") return;
    t += v.ms / 1000;
    if (iv.type !== "REST" && (v.outcome === "complete" || v.outcome === "done")) cps.push(Math.round(t * 10) / 10);
  });
  return cps;
}

/* A ghost for a known total only (friend, leaderboard athlete, target time):
   spread the total over the segments in proportion to their planned length. */
function ghostFromTotal(timeline, totalSec) {
  const idx = scoredSegments(timeline);
  const plan = timeline.filter(iv => iv.type !== "WARM");
  const weights = [];
  let acc = 0;
  plan.forEach(iv => { acc += planSec(iv); if (iv.type !== "REST") weights.push(acc); });
  const sum = acc || 1;
  return idx.map((_, k) => Math.round((weights[k] / sum) * totalSec * 10) / 10);
}

/* Where am I against the ghost? done = scored segments completed, elapsed = my seconds (warm-up excluded). */
function ghostStatus(ghost, mine, done, elapsed) {
  if (!ghost || !ghost.length) return null;
  const next = ghost[Math.min(done, ghost.length - 1)];
  const lastDelta = done > 0 && mine[done - 1] != null ? mine[done - 1] - ghost[done - 1] : 0;
  // Still running this segment past the ghost's split: we're at least that far behind.
  const delta = elapsed > next && done < ghost.length ? Math.max(lastDelta, elapsed - next) : lastDelta;
  return { delta: Math.round(delta), ghostSplit: next, ghostTotal: ghost[ghost.length - 1] };
}

function ghostText(delta) {
  if (Math.abs(delta) < 1) return "LEVEL";
  return `${Math.abs(delta) >= 60 ? fmtShort(Math.abs(delta)) : `${Math.abs(delta)} SEC`} ${delta < 0 ? "AHEAD" : "BEHIND"}`;
}

/* ── Events ─────────────────────────────────────────────────────────────── */

/* Placement points: 1st = 100, last = 10, linear between; scaled by the trial's weight. */
function placementPoints(rank, field, weight = 1) {
  if (!rank || !field) return 0;
  return Math.round(weight * (field <= 1 ? 100 : 100 - (90 * (rank - 1)) / (field - 1)));
}

/* coming → registration → open → closed → final */
function eventPhase(ev, now = Date.now()) {
  const t = k => (ev[k] ? Date.parse(ev[k]) : null);
  if (t("final_at") && now >= t("final_at")) return "final";
  if (t("ends_at") && now >= t("ends_at")) return "closed";
  if (t("starts_at") && now >= t("starts_at")) return "open";
  if (t("registration_opens") && now >= t("registration_opens")) return "registration";
  return "coming";
}

/* Messaging per phase. Iron Forest uses its own voice. */
function eventLine(ev, phase) {
  const forest = /forest/i.test(ev.name);
  return {
    coming: forest ? "THE FOREST IS COMING." : "COMING SOON.",
    registration: forest ? "ENTER THE IRON FOREST." : "REGISTRATION IS OPEN.",
    open: forest ? "THE FOREST IS OPEN." : "THE EVENT IS LIVE.",
    closed: forest ? "THE FOREST IS CLOSED." : "THE EVENT HAS CLOSED.",
    final: "FINAL RESULTS.",
  }[phase];
}
