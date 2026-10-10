// Lists every line the voice coach can say → tools/voice/catalog.json.
// node tools/voice/catalog.mjs   (then: python tools/voice/generate.py, see README.md)
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = ["workouts.js", "core.js", "challenges.js", "progress.js", "coach.js"].map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n");
const V = vm.runInContext(`${src}\n;({ TEMPLATES, BENCHMARKS, DIVISIONS, createWorkout, compile, gearPlan, challengeWorkout, challengeFromSpec, outdoorSwaps, ANYWHERE_MOVES, coachCatalog, coachFile })`,
  vm.createContext({ console, performance, Math, Date, JSON, URLSearchParams }));

const kits = [["treadmill", "rower", "bike", "kettlebell", "dumbbell", "battle-ropes", "outdoors"], [], ["outdoors"], ["dumbbell"], ["kettlebell"], ["dumbbell", "outdoors"]];
const timelines = [];
for (const t of V.TEMPLATES) for (const kit of kits) {
  const w = V.createWorkout(t.id, {});
  timelines.push(V.compile(w, V.gearPlan(w, {}, kit).swaps, { warmup: true, cooldown: true }));
}
for (const c of V.BENCHMARKS) for (const v of c.variants) for (const d of V.DIVISIONS)
  for (const kit of [["treadmill"], ["outdoors"]]) timelines.push(V.compile(V.challengeWorkout(c, v.id, d.id), V.outdoorSwaps(kit), { warmup: true, cooldown: true }));
// Anywhere (no machines): every move that can replace a machine.
for (const c of V.BENCHMARKS.filter(c => c.anywhere)) for (const m of V.ANYWHERE_MOVES)
  timelines.push(V.compile(V.challengeWorkout(c, `${c.defaultVariant}~any`, "open", { run: m.id, row: m.id, bike: m.id }), {}, {}));
// Event Trials seeded in the database.
const sql = fs.readFileSync(path.join(root, "supabase", "004_events.sql"), "utf8");
for (const m of sql.matchAll(/\('([a-z0-9-]+)', '([a-z0-9-]+)', (\d+), '([^']+)', ([\d.]+), '(\{.*?\})'\)/g)) {
  const c = V.challengeFromSpec(JSON.parse(m[6]));
  timelines.push(V.compile(V.challengeWorkout(c, "standard", "open"), {}, { warmup: true, cooldown: true }));
}
const lines = V.coachCatalog(timelines).map(l => ({ ...l, file: V.coachFile(l.id) }));
const files = new Set(lines.map(l => l.file));
if (files.size !== lines.length) throw new Error("file name collision");
fs.writeFileSync(path.join(root, "tools", "voice", "catalog.json"), JSON.stringify(lines, null, 1) + "\n");
console.log(`${lines.length} lines`);
