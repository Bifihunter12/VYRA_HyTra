"use strict";

const APP_VERSION = "2026.06.25.7";
// Public URL shown on shared cards/text. UPDATE to your real domain before launch.
const SHARE_URL = "merry-selkie-4ae2f1.netlify.app";
const STORAGE_KEY = "endur_v1";
const OLD_KEY     = "cruise_mode_v1";
const RING_CIRC   = 2 * Math.PI * 90;
const UPDATE_CHECK_MS = 30 * 60 * 1000;

// ── XP Level System ──────────────────────────────────────────────────────────
const XP_LEVELS = [
  { level: 1,  xp: 0     },
  { level: 2,  xp: 10    },
  { level: 3,  xp: 30    },
  { level: 4,  xp: 60    },
  { level: 5,  xp: 100   },
  { level: 6,  xp: 150   },
  { level: 7,  xp: 210   },
  { level: 8,  xp: 280   },
  { level: 9,  xp: 360   },
  { level: 10, xp: 450   },
  { level: 11, xp: 550   },
  { level: 12, xp: 660   },
  { level: 13, xp: 780   },
  { level: 14, xp: 910   },
  { level: 15, xp: 1050  },
  { level: 16, xp: 1200  },
  { level: 17, xp: 1360  },
  { level: 18, xp: 1530  },
  { level: 19, xp: 1710  },
  { level: 20, xp: 1900  },
  { level: 21, xp: 2100  },
  { level: 22, xp: 2310  },
  { level: 23, xp: 2530  },
  { level: 24, xp: 2760  },
  { level: 25, xp: 3000  },
];

// One-time XP bonus when a challenge first completes (keyed by duration in days)
const COMPLETION_BONUS = {
  21: 50, 30: 75, 42: 100, 50: 100, 56: 100,
  60: 125, 75: 200, 84: 150, 90: 150, 120: 250, 365: 1000,
};

// Level chapter milestones shown once as an overlay
const CHAPTER_LEVELS = {
  5:  { title:"Building",  msg:"You're no longer a beginner." },
  10: { title:"Proving",   msg:"You've shown up more than most people ever will." },
  15: { title:"Elite",     msg:"You're in the top 10% of anyone who keeps going." },
  20: { title:"Legend",    msg:"This is who you are now." },
  25: { title:"Conqueror", msg:"You made it." },
};

// Per-category completion headline copy (deterministic pick via date seed)
const COMPLETE_COPY = {
  transformation: ["Locked in.",       "Built different.",    "Identity shift."],
  movement:       ["Work done.",        "Body moved.",         "Showed up."],
  endurance:      ["Miles banked.",     "Distance covered.",   "Body of evidence."],
  lifestyle:      ["Day designed.",     "System held.",        "Deliberate."],
  health:         ["Data logged.",      "Body tracked.",       "Consistent."],
  expedition:     ["Terrain covered.",  "Moving.",             "Closer."],
  mindset:        ["Clear.",            "Mind worked.",        "Presence: logged."],
};

// ── Journey Themes ─────────────────────────────────────────────────────────
const JOURNEY_THEMES = {
  endur: {
    label: "Endur", emoji: "\u{1F525}", tagline: "Outlast Everything",
    featureIcons: ["\u{1F3D4}\uFE0F", "\u{23F1}\uFE0F", "\u{1F525}", "\u{1F512}"],
    levels: [
      "Starting Line", "Warmed Up", "In Motion", "Consistent", "Conditioned",
      "Base Builder", "Fit", "Durable", "Strong", "Athletic",
      "Engine", "Workhorse", "Race Ready", "Competitor", "Advanced",
      "High Output", "Endurance Built", "Powerhouse", "Hybrid Athlete", "Elite",
      "Peak Condition", "Podium", "Pro Standard", "World Class", "Endur Athlete",
    ],
  },
};

function getThemedLevelName(levelNum) {
  return JOURNEY_THEMES.endur.levels[levelNum - 1] || "";
}

function getLevelInfo(xp) {
  let current = XP_LEVELS[0];
  for (const lvl of XP_LEVELS) {
    if (xp >= lvl.xp) current = lvl;
    else break;
  }
  const nextIdx   = XP_LEVELS.indexOf(current) + 1;
  const next      = XP_LEVELS[nextIdx] || null;
  const xpInLevel = next ? xp - current.xp : 0;
  const xpNeeded  = next ? next.xp - current.xp : 1;
  const pct       = next ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;
  const name      = getThemedLevelName(current.level);
  const nextName  = next ? getThemedLevelName(next.level) : null;
  return { ...current, name, next: next ? { ...next, name: nextName } : null, xpInLevel, xpNeeded, pct };
}

function getStreakMultiplier(challenge) {
  const yesterday = addDays(todayKey(), -1);
  let count = 0;
  let cursor = yesterday;
  while (cursor >= challenge.startDate) {
    const d = challenge.days[cursor];
    if (d?.mode === "rest") { cursor = addDays(cursor, -1); continue; }
    if (!d || !dayLogged(d)) break;
    count++;
    cursor = addDays(cursor, -1);
  }
  return count >= 75 ? 1.40 : count >= 30 ? 1.25 : count >= 14 ? 1.15 : count >= 7 ? 1.10 : 1.0;
}

function recalcXP() {
  let total = 0;
  for (const challenge of Object.values(state.challenges)) {
    for (const day of Object.values(challenge.days)) {
      total += completionInfo(challenge, day).points || 0;
    }
  }
  return total;
}

function avgDailyXP() {
  const today = todayKey();
  let total = 0, active = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(parseDate(today)); d.setDate(d.getDate() - i);
    const dk = toKey(d);
    let dayXP = 0;
    for (const ch of Object.values(state.challenges)) {
      const day = ch.days[dk];
      if (day) dayXP += completionInfo(ch, day).points || 0;
    }
    if (dayXP > 0) active++;
    total += dayXP;
  }
  return active >= 3 ? total / 14 : null;
}

// ── WoW-style Rarity Tiers ────────────────────────────────────────────────
const TIERS = {
  common:    { label:"Starter",   color:"#86efac", border:"#86efac" }, // soft green
  uncommon:  { label:"Common",    color:"#1eff00", border:"#1eff00" }, // WoW classic green
  rare:      { label:"Rare",      color:"#4da6ff", border:"#4da6ff" }, // WoW blue
  epic:      { label:"Epic",      color:"#c070ff", border:"#c070ff" }, // WoW purple
  legendary: { label:"Legendary", color:"#ff8c00", border:"#ff8c00" }, // WoW orange/gold
};

// Field: rarity rendered as a monochrome line icon (ember when earned), not color
const TIER_ICON = { common:"ti-award", uncommon:"ti-award", rare:"ti-medal", epic:"ti-medal-2", legendary:"ti-trophy" };
const stripBadgeEmoji = s => /^[\p{L}\p{N}]/u.test((s||"").trim()) ? s : (s||"").replace(/^\s*\S+\s+/u, "");

// Plain-English descriptions of each tier for the builder
const TIER_DESC = {
  common:    "Beginner-friendly",
  uncommon:  "Everyday challenge",
  rare:      "Demanding",
  epic:      "Elite-level",
  legendary: "Extreme athletes only",
};

// Reference ranges for health measurement units
const UNIT_RANGES = {
  "mmHg":   "Normal: <120/80 mmHg",
  "mg/dL":  "Fasting normal: 70–99 mg/dL",
  "hrs":    "Recommended: 7–9 hrs",
  "/10":    "Log from 1 (awful) to 10 (perfect)",
  "%":      null,
};

// Returns an inline tag for epic/legendary challenges, empty string otherwise
function tierTag(templateId) {
  const tier = templateId ? TEMPLATE_TIERS[templateId] : null;
  if (tier !== "epic" && tier !== "legendary") return "";
  const td = TIERS[tier];
  return `<span class="tier-tag" style="color:${td.color}">${td.label}</span>`;
}

// Challenge difficulty (independent of WoW rarity tier)
const TEMPLATE_DIFFICULTY = {
  // Beginner — no fitness baseline required
  "dog-walk":"beginner","walking":"beginner","reading":"beginner",
  "journaling":"beginner","meditation":"beginner","sleep-reset":"beginner",
  "morning-routine":"beginner","hydration":"beginner","meal-prep":"beginner",
  "no-spend":"beginner","dry-month":"beginner","creative":"beginner",
  "sleep-tracker":"beginner","no-sugar":"beginner","digital-detox":"beginner",
  "blood-pressure":"beginner","c25k":"beginner","pilates":"beginner","swim-foundation":"beginner",
  // Intermediate — consistent effort or existing fitness base needed
  "running":"intermediate","cycling":"intermediate","yoga-flexibility":"intermediate",
  "core-abs":"intermediate","strength":"intermediate","30-pushups":"intermediate",
  "30-squats":"intermediate","30-plank":"intermediate","spin":"intermediate",
  "12-3-30":"intermediate","5k-prep":"intermediate","protein-challenge":"intermediate",
  "weight-loss-30":"intermediate","body-composition":"intermediate",
  "glucose-control":"intermediate","swim-1k":"intermediate",
  "everest-bc":"intermediate","west-highland-way":"intermediate","everest-stairmaster":"intermediate","kilimanjaro-stairmaster":"intermediate","montblanc-stairmaster":"intermediate","thames-row":"intermediate",
  // Advanced — high consistency demands or health-sensitive protocols
  "75-soft":"advanced","10k-prep":"advanced","run-streak":"advanced",
  "cold-exposure":"advanced","half-marathon-prep":"advanced",
  "cruise-control":"advanced","intermittent-fasting":"advanced","open-water-prep":"advanced",
  "monk-mode":"advanced","project-50":"advanced",
  "camino":"advanced","tour-du-mont-blanc":"advanced","john-muir-trail":"advanced",
  "route66":"advanced","raid-pyrenees":"advanced",
  "danube-row":"advanced","comrades-ultra":"advanced","appalachian":"advanced",
  "tour-de-france":"advanced",
  // Extreme — elite output, multi-month commitment, or medical risk
  "75-hard":"extreme","marathon-training":"extreme",
  // HYROX — advanced functional racing
  "hyrox":"advanced",
  "ironman-703":"extreme","ironman-full":"extreme",
  "tough-mudder":"extreme","spartan-race":"extreme",
  "utmb":"extreme","run-5-marathons":"extreme","run-jogle":"extreme",
  "run-trans-america":"extreme","trans-am-bike":"extreme","pct":"extreme",
  "amazon-river":"extreme",
  // New challenges
  "steps-10k":"beginner","zone2":"intermediate","recovery-reset":"beginner",
  "fiber-challenge":"beginner","declutter":"beginner",
  // Strength single-movement progressions
  "pull-up-challenge":"intermediate","burpee-challenge":"intermediate","dip-challenge":"intermediate",
  "kettlebell":"intermediate","calisthenics":"advanced",
  // New challenges
  "self-care-30":"beginner","gratitude-reset":"beginner","mental-health-30":"beginner",
  "morning-power-hour":"intermediate","posture-fix":"beginner",
  // New challenge templates
  "beginner-strength":"beginner","pushup-challenge":"beginner","pullup-progression":"intermediate",
  "language-learning":"intermediate","budget-reset":"beginner","mindful-eating":"beginner",
  "nature-reset":"beginner",
};
const DIFF_LABEL = { beginner:"Beginner", intermediate:"Intermediate", advanced:"Advanced", extreme:"Extreme" };
const DIFF_COLOR = { beginner:"#4caf50", intermediate:"#ff9800", advanced:"#f44336", extreme:"#9c27b0" };

// Safety warnings for high-risk or health-sensitive challenges
const TEMPLATE_SAFETY = {
  "everest-bc": "A long cumulative trek. Build distance up gradually and rest freely; the total is what matters, not daily maximums. Never make up missed distance in one effort. On real outings, mind weather and terrain.",
  "everest-stairmaster": "A huge cumulative climb. Log stairs or elevation progressively; do not try to bank it all at once. Warm up, hydrate, and stop if you feel dizzy or breathless. Build it up over the weeks.",
  "kilimanjaro-stairmaster": "A huge cumulative climb. Log stairs or elevation progressively; do not try to bank it all at once. Warm up, hydrate, and stop if you feel dizzy or breathless. Build it up over the weeks.",
  "montblanc-stairmaster": "A huge cumulative climb. Log stairs or elevation progressively; do not try to bank it all at once. Warm up, hydrate, and stop if you feel dizzy or breathless. Build it up over the weeks.",
  "utmb": "A large cumulative distance. Build up gradually and rest freely; never try to make up missed distance in a single effort. The total is what matters, not daily maximums. If you log real outdoor activity, mind weather, traffic, and your own limits.",
  "comrades-ultra": "A large cumulative distance. Build up gradually and rest freely; never try to make up missed distance in a single effort. The total is what matters, not daily maximums. If you log real outdoor activity, mind weather, traffic, and your own limits.",
  "run-5-marathons": "A large cumulative distance. Build up gradually and rest freely; never try to make up missed distance in a single effort. The total is what matters, not daily maximums. If you log real outdoor activity, mind weather, traffic, and your own limits.",
  "run-jogle": "A large cumulative distance. Build up gradually and rest freely; never try to make up missed distance in a single effort. The total is what matters, not daily maximums. If you log real outdoor activity, mind weather, traffic, and your own limits.",
  "run-trans-america": "A large cumulative distance. Build up gradually and rest freely; never try to make up missed distance in a single effort. The total is what matters, not daily maximums. If you log real outdoor activity, mind weather, traffic, and your own limits.",
  "appalachian": "A large cumulative distance. Build up gradually and rest freely; never try to make up missed distance in a single effort. The total is what matters, not daily maximums. If you log real outdoor activity, mind weather, traffic, and your own limits.",
  "pct": "A large cumulative distance. Build up gradually and rest freely; never try to make up missed distance in a single effort. The total is what matters, not daily maximums. If you log real outdoor activity, mind weather, traffic, and your own limits.",
  "trans-am-bike": "A very long cumulative ride. Build up gradually and rest freely; never cram missed distance into one session. On the road, mind traffic, weather, and visibility.",
  "tour-de-france": "A very long cumulative ride. Build up gradually and rest freely; never cram missed distance into one session. On the road, mind traffic, weather, and visibility.",
  "raid-pyrenees": "A very long cumulative ride. Build up gradually and rest freely; never cram missed distance into one session. On the road, mind traffic, weather, and visibility.",
  "amazon-river": "A very long cumulative distance. Build up gradually and rest freely. On real water, always wear a buoyancy aid, check conditions, and do not row alone in unfamiliar water.",
  "danube-row": "A very long cumulative distance. Build up gradually and rest freely. On real water, always wear a buoyancy aid, check conditions, and do not row alone in unfamiliar water.",
};

// Challenge template → tier
const TEMPLATE_TIERS = {
  // ── Common: 30-day-or-less lifestyle, beginner-friendly
  "dry-month":"common","reading":"common","creative":"common",
  "meditation":"common","sleep-reset":"common","yoga-flexibility":"common",
  "digital-detox":"common","walking":"common","journaling":"common",
  // ── Uncommon: 30-day fitness / requires real consistency
  "30-pushups":"uncommon","dog-walk":"uncommon","cycling":"uncommon",
  "running":"uncommon","strength":"uncommon","swim-foundation":"uncommon","no-sugar":"uncommon",
  "morning-routine":"uncommon","core-abs":"uncommon",
  // ── Rare: mentally demanding, 75-day, or short expedition
  "cold-exposure":"rare","intermittent-fasting":"rare",
  "75-soft":"rare","everest-bc":"rare","monk-mode":"rare","montblanc-stairmaster":"rare",
  // ── Epic: strict 75-day, 86-day transformation, long expeditions
  "75-hard":"epic","cruise-control":"epic","camino":"epic","tour-de-france":"epic","tour-du-mont-blanc":"epic","john-muir-trail":"epic","kilimanjaro-stairmaster":"epic",
  // ── Legendary: year-long or extreme challenges
  "appalachian":"legendary","route66":"legendary",
  "amazon-river":"legendary","everest-stairmaster":"legendary","pct":"legendary",
  "run-trans-america":"legendary","trans-am-bike":"legendary",
  // ── Epic: demanding multi-month expeditions
  "run-jogle":"epic","danube-row":"epic",
  // ── Rare: shorter expedition routes
  "west-highland-way":"rare","run-5-marathons":"rare","raid-pyrenees":"rare","thames-row":"rare",
  "comrades-ultra":"rare",
  // ── New movement challenges
  "c25k":"uncommon","5k-prep":"uncommon","10k-prep":"rare",
  "run-streak":"uncommon","30-squats":"uncommon","30-plank":"uncommon",
  "pilates":"common","12-3-30":"uncommon","spin":"uncommon",
  // ── New nutrition / health habits
  "protein-challenge":"common","meal-prep":"common","hydration":"common",
  // ── New lifestyle / transformation
  "project-50":"rare","no-spend":"common",
  // ── Health tracking
  "weight-loss-30":"common","sleep-tracker":"common",
  "blood-pressure":"uncommon","glucose-control":"uncommon",
  "body-composition":"rare",
  // ── Endurance sport training
  "half-marathon-prep":"uncommon","swim-1k":"uncommon","open-water-prep":"rare","marathon-training":"rare",
  "tough-mudder":"rare","spartan-race":"epic",
  "ironman-703":"epic","ironman-full":"legendary","hyrox":"epic",
  // ── Epic expedition
  "utmb":"epic",
  // New challenges
  "steps-10k":"common","zone2":"uncommon","recovery-reset":"common",
  "fiber-challenge":"common","declutter":"common",
  // Strength single-movement progressions
  "pull-up-challenge":"uncommon","burpee-challenge":"uncommon","dip-challenge":"uncommon",
  "kettlebell":"uncommon","calisthenics":"rare",
  // New challenges
  "self-care-30":"common","gratitude-reset":"common","mental-health-30":"common",
  "morning-power-hour":"uncommon","posture-fix":"common",
  // New challenge templates
  "beginner-strength":"common","pushup-challenge":"common","pullup-progression":"uncommon",
  "language-learning":"uncommon","budget-reset":"common","mindful-eating":"common",
  "nature-reset":"common",
};

// Universal / Lifetime badge → tier (template badges inherit their template's tier)
const BADGE_TIERS = {
  // Universal — streaks
  "u-3d":"common","u-7d":"common","u-14d":"uncommon","u-21d":"uncommon",
  "u-30d":"rare","u-60d":"epic","u-75d":"legendary",
  // Universal — points
  "u-p10":"common","u-p100":"uncommon","u-p500":"rare","u-p1k":"epic",
  // Universal — body
  "u-scale":"common","u-1lb":"common","u-5lb":"uncommon","u-10lb":"rare","u-wgoal":"epic",
  // Universal — modes & behavior
  "u-cmback":"common",
  // Universal — challenge milestones
  "u-first":"common","u-done1":"uncommon","u-done3":"rare","u-multi":"uncommon",
  // Lifetime
  "lt-100h":"uncommon","lt-500h":"rare","lt-5c":"epic","lt-cats":"rare",
  "lt-wk10":"uncommon","lt-perf":"legendary","lt-freeze":"uncommon",
};

// ── Built-in Templates ─────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: "dog-walk", name: "The Great Dog Walk", emoji: "🐕", category: "movement",
    description: "Rack up 100 km on foot with your dog — one walk at a time. Log every kilometre and watch it add up.",
    duration: 60, weeklyGoal: 5, defaultMode: "soft", routeKm: 100,
    milestones: [
      { km: 25,  name: "25 km" },
      { km: 50,  name: "Halfway — 50 km" },
      { km: 75,  name: "75 km" },
      { km: 100, name: "100 km — done" },
    ],
    habits: [
      { id:"dist", title:"Log distance", emoji:"🐕", quip:"Every kilometre counts.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "cycling", name: "Ride 200", emoji: "🚴", category: "movement",
    description: "Cover 200 km in the saddle. Every ride moves you closer to the finish.",
    duration: 45, weeklyGoal: 5, defaultMode: "soft", routeKm: 200,
    milestones: [
      { km: 50,  name: "50 km" },
      { km: 100, name: "Halfway — 100 km" },
      { km: 150, name: "150 km" },
      { km: 200, name: "200 km — done" },
    ],
    habits: [
      { id:"dist", title:"Log distance", emoji:"🚴", quip:"Clip in. Every km counts.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "walking", name: "Walk 100", emoji: "🚶", category: "movement",
    description: "Walk 100 km, one outing at a time. The simplest mission with the biggest payoff.",
    duration: 60, weeklyGoal: 5, defaultMode: "soft", routeKm: 100,
    milestones: [
      { km: 25,  name: "25 km" },
      { km: 50,  name: "Halfway — 50 km" },
      { km: 75,  name: "75 km" },
      { km: 100, name: "100 km — done" },
    ],
    habits: [
      { id:"dist", title:"Log distance", emoji:"🚶", quip:"Every step counts.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "running", name: "Run 50", emoji: "🏃", category: "movement",
    description: "Bank 50 km of running across the weeks. Rest days welcome — the total is what matters.",
    duration: 45, weeklyGoal: 5, defaultMode: "soft", routeKm: 50,
    milestones: [
      { km: 10, name: "10 km" },
      { km: 25, name: "Halfway — 25 km" },
      { km: 40, name: "40 km" },
      { km: 50, name: "50 km — done" },
    ],
    habits: [
      { id:"dist", title:"Log distance", emoji:"🏃", quip:"Shoes on. Every km counts.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "zone2", name: "Zone 2: 10 Hours", emoji: "💚", category: "endurance",
    description: "Bank 10 hours of easy, conversational-pace cardio — the aerobic base that makes everything else easier.",
    duration: 45, weeklyGoal: 5, defaultMode: "soft", routeKm: 10,
    milestones: [
      { km: 2.5, name: "2.5 hrs" },
      { km: 5,   name: "Halfway — 5 hrs" },
      { km: 7.5, name: "7.5 hrs" },
      { km: 10,  name: "10 hrs — done" },
    ],
    habits: [
      { id:"time", title:"Log time", emoji:"⏱️", quip:"Every session counts.", type:"distance", points:1, unit:"hours" },
    ],
  },

  // ── Expedition Routes ────────────────────────────────────────────────────
  {
    id: "everest-bc", name: "Everest Base Camp", emoji: "🏔️", category: "expedition",
    description: "Trek 130 km through the Himalayas to the foot of the world's highest peak.",
    duration: 45, weeklyGoal: 5, defaultMode: "soft", routeKm: 130,
    routeGeo: [[0.428,1.0],[0.404,0.827],[0.406,0.629],[0.472,0.528],[0.557,0.072],[0.596,0.0]],
    milestones: [
      { km: 10, name: "Phakding", blurb: "The trail leaves Lukla and drops to the Dudh Kosi's roaring river." },
      { km: 40, name: "Namche Bazaar", blurb: "The Sherpa capital, clinging to the mountainside -- acclimatise here." },
      { km: 65, name: "Tengboche", blurb: "Its monastery sits beneath Ama Dablam, prayer flags in the wind." },
      { km: 100, name: "Gorak Shep", blurb: "The last flat ground before base camp, thin air and glacial moraine." },
      { km: 130, name: "Everest Base Camp", blurb: "The foot of the world's highest peak. You made it to 5,364 m." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🏃", quip:"Walk, run, cycle, swim or row — it all counts.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "west-highland-way", name: "West Highland Way", emoji: "🌄", category: "expedition",
    description: "Walk 154 km through the Scottish Highlands from Milngavie to Fort William — lochs, glens, and mountain passes.",
    duration: 30, weeklyGoal: 5, defaultMode: "soft", routeKm: 154,
    routeGeo: [[0.617,1.0],[0.542,0.84],[0.498,0.588],[0.5,0.433],[0.425,0.117],[0.383,0.0]],
    milestones: [
      { km: 20, name: "Balmaha", blurb: "The path meets Loch Lomond's wooded eastern shore." },
      { km: 50, name: "Inverarnan", blurb: "The loch behind you, the glens and moors open ahead." },
      { km: 80, name: "Tyndrum", blurb: "A former mining village on the old drovers' road north." },
      { km: 120, name: "Kinlochleven", blurb: "Down off the Devil's Staircase to the head of the loch." },
      { km: 154, name: "Fort William", blurb: "Journey's end beneath Ben Nevis, Britain's highest peak." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🥾", quip:"Every loch and glen earned one step at a time.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "tour-du-mont-blanc", name: "Tour du Mont Blanc", emoji: "🗻", category: "expedition",
    description: "Circle the Mont Blanc massif across France, Italy and Switzerland — 170 km of alpine trail through 3 countries.",
    duration: 60, weeklyGoal: 5, defaultMode: "soft", routeKm: 170,
    routeGeo: [[0.335,0.581],[0.232,0.873],[0.566,1.0],[0.75,0.411],[0.768,0.0],[0.428,0.445]],
    milestones: [
      { km: 30, name: "Les Contamines", blurb: "The first valley, the massif's white summits rising ahead." },
      { km: 60, name: "Courmayeur", blurb: "Over the border into Italy, in Mont Blanc's southern shadow." },
      { km: 90, name: "La Fouly", blurb: "Into Switzerland's Val Ferret, glaciers hanging above." },
      { km: 130, name: "Champex-Lac", blurb: "A quiet alpine lake before the final passes." },
      { km: 170, name: "Chamonix", blurb: "Full circle to the mountaineering capital where you began." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🥾", quip:"Three countries. One mountain. Endless views.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "john-muir-trail", name: "John Muir Trail", emoji: "🦅", category: "expedition",
    description: "Hike 340 km through California's Sierra Nevada — from Yosemite Valley to the summit of Mount Whitney.",
    duration: 90, weeklyGoal: 5, defaultMode: "soft", routeKm: 340,
    routeGeo: [[0.316,0.108],[0.376,0.0],[0.57,0.542],[0.513,0.49],[0.649,0.728],[0.684,1.0]],
    milestones: [
      { km: 50, name: "Tuolumne Meadows", blurb: "Yosemite's high meadows, granite domes on every side." },
      { km: 120, name: "Evolution Valley", blurb: "A cathedral of peaks named for the great naturalists." },
      { km: 180, name: "Muir Trail Ranch", blurb: "The last resupply before the high passes begin in earnest." },
      { km: 250, name: "Pinchot Pass", blurb: "Over 12,000 feet, crossing the Sierra crest." },
      { km: 340, name: "Mount Whitney", blurb: "The highest point in the lower 48 -- 4,421 m, the finish." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🥾", quip:"The Range of Light. Worth every step.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "camino", name: "Camino de Santiago", emoji: "⛪", category: "expedition",
    description: "Walk 790 km across Spain on the ancient pilgrimage route to Santiago de Compostela.",
    duration: 90, weeklyGoal: 5, defaultMode: "soft", routeKm: 790,
    routeGeo: [[1.0,0.338],[0.944,0.477],[0.663,0.662],[0.408,0.561],[0.266,0.582],[0.0,0.449]],
    milestones: [
      { km: 75, name: "Pamplona", blurb: "The first city on the way -- your opening stretch is behind you." },
      { km: 250, name: "Burgos", blurb: "Its Gothic cathedral marks the edge of the meseta, the high plains ahead." },
      { km: 400, name: "León", blurb: "Halfway and then some. The westward push begins in earnest." },
      { km: 590, name: "Ponferrada", blurb: "A Templar castle guards the road as the green hills of Galicia rise." },
      { km: 790, name: "Santiago de Compostela", blurb: "The cathedral square. The pilgrim's arrival -- you walked the whole way." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚶", quip:"Every step brings you closer to Santiago.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "appalachian", name: "Appalachian Trail", emoji: "🌲", category: "expedition",
    description: "Hike the full 3,540 km from Georgia to Maine — one of the world's great long trails.",
    duration: 365, weeklyGoal: 5, defaultMode: "soft", routeKm: 3540,
    routeGeo: [[0.26,1.0],[0.442,0.656],[0.486,0.461],[0.621,0.249],[0.665,0.145],[0.74,0.0]],
    milestones: [
      { km: 300, name: "Shenandoah Valley", blurb: "Blue Ridge country, black bears and long green tunnels of trees." },
      { km: 900, name: "Pennsylvania", blurb: "The infamous rocks that test every thru-hiker's feet." },
      { km: 1800, name: "New England", blurb: "The trail turns wilder as the northern forests close in." },
      { km: 2600, name: "White Mountains, NH", blurb: "Above the treeline into some of the range's hardest miles." },
      { km: 3540, name: "Mount Katahdin, Maine", blurb: "The northern terminus. The sign at the summit -- you finished." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🥾", quip:"Miles in the legs. Wilderness in the soul.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "tour-de-france", name: "Grand Tour of France", emoji: "🚴", category: "expedition",
    description: "Ride the full 3,490 km route of the world's most iconic cycling race.",
    duration: 120, weeklyGoal: 5, defaultMode: "soft", routeKm: 3490,
    routeGeo: [[0.205,0.075],[0.205,0.075],[0.607,0.637],[0.473,1.0],[0.795,0.554],[0.573,0.0]],
    milestones: [
      { km: 400, name: "Brittany Coast", blurb: "Flat, fast kilometres along the windswept Atlantic edge." },
      { km: 900, name: "Massif Central", blurb: "Rolling volcanic uplands in the heart of France." },
      { km: 1600, name: "The Pyrenees", blurb: "The first great mountains, cols stacked one after another." },
      { km: 2400, name: "The Alps", blurb: "The decisive high passes -- where the race is won." },
      { km: 3490, name: "Paris — Champs-Élysées", blurb: "The final sprint down the great avenue. Arrival." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚴", quip:"Clip in. Every km is a stage.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "route66", name: "Route 66", emoji: "🚗", category: "expedition",
    description: "Travel the 3,940 km Mother Road from Chicago, Illinois to Santa Monica, California.",
    duration: 180, weeklyGoal: 5, defaultMode: "soft", routeKm: 3940,
    routeGeo: [[1.0,0.162],[0.935,0.341],[0.68,0.713],[0.54,0.734],[0.384,0.746],[0.0,0.838]],
    milestones: [
      { km: 500, name: "Springfield, IL", blurb: "Out of Chicago onto the Mother Road heading west." },
      { km: 1100, name: "Oklahoma City", blurb: "Across the plains, diners and neon of the old highway." },
      { km: 1900, name: "Amarillo, TX", blurb: "Deep in the Texas panhandle, big sky in every direction." },
      { km: 2700, name: "Albuquerque, NM", blurb: "High desert and the mesas of New Mexico." },
      { km: 3940, name: "Santa Monica Pier", blurb: "The road's end at the Pacific. Sea air and the finish." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚗", quip:"Get your kicks. Road is open.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "amazon-river", name: "Amazon River", emoji: "🌿", category: "expedition",
    description: "Navigate 6,437 km down the world's greatest river from the Andes to the Atlantic.",
    duration: 365, weeklyGoal: 5, defaultMode: "soft", routeKm: 6437,
    routeGeo: [[0.0,0.642],[0.139,0.684],[0.557,0.586],[0.781,0.525],[0.975,0.37],[1.0,0.316]],
    milestones: [
      { km: 500, name: "Iquitos, Peru", blurb: "Deep in the rainforest, reachable only by river or air." },
      { km: 1500, name: "Leticia", blurb: "The three-borders town where Peru, Colombia and Brazil meet." },
      { km: 3000, name: "Manaus", blurb: "The great river port in the heart of the Amazon." },
      { km: 5000, name: "Santarém", blurb: "Where a broad clearwater tributary joins the brown Amazon." },
      { km: 6437, name: "Atlantic Ocean", blurb: "The river mouth, wide as a sea. You reached the ocean." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚣", quip:"The river never stops. Neither do you.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "pct", name: "Pacific Crest Trail", emoji: "🌲", category: "expedition",
    description: "Walk 4,286 km from the Mexican border to the Canadian border — through the Sierra Nevada and Cascades. 5 months. No shortcuts.",
    duration: 150, weeklyGoal: 5, defaultMode: "soft", routeKm: 4286,
    routeGeo: [[0.562,1.0],[0.561,0.982],[0.539,0.896],[0.523,0.848],[0.521,0.744],[0.449,0.518],[0.438,0.335],[0.461,0.091],[0.465,0.0]],
    milestones: [
      { km: 160, name: "San Diego foothills", blurb: "Chaparral hills climbing out of the border country." },
      { km: 700, name: "Los Angeles area", blurb: "The dry ranges east of the city sprawl." },
      { km: 1300, name: "Mojave Desert", blurb: "Wind farms and heat across the high desert." },
      { km: 2000, name: "Sierra Nevada", blurb: "Snowbound passes, the range of light." },
      { km: 2600, name: "Northern California", blurb: "Volcanic country and deep evergreen forest." },
      { km: 3100, name: "Oregon", blurb: "Cascade peaks and cool river canyons." },
      { km: 3800, name: "Washington", blurb: "The final green miles toward the north." },
      { km: 4286, name: "Canadian Border", blurb: "The monument at the Canadian line. 4,286 km, walked." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🥾", quip:"Every step north is progress.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "everest-stairmaster", name: "Everest StairMaster", emoji: "🏋️", category: "expedition",
    description: "Climb 2,903 floors — the StairMaster equivalent of summiting Mount Everest from sea level. No oxygen tank. No shortcuts.",
    duration: 112, weeklyGoal: 5, defaultMode: "soft", routeKm: 2903.2,
    routeGeo: [[0.5,0.92],[0.45,0.75],[0.55,0.6],[0.47,0.45],[0.55,0.3],[0.5,0.1]],
    milestones: [
      { km: 100, name: "Foothills", blurb: "The climb begins -- every floor is altitude gained." },
      { km: 500, name: "Camp I", blurb: "Onto the Western Cwm, the valley of silence." },
      { km: 1000, name: "Camp II", blurb: "Advanced base, the Lhotse Face looming above." },
      { km: 1500, name: "Camp III", blurb: "Fixed to the ice wall, thin air biting hard." },
      { km: 2000, name: "Death Zone", blurb: "Above 8,000 m, where the body slowly fails." },
      { km: 2903, name: "Summit — 8,849 m", blurb: "The top of the world. Nothing higher on Earth." },
    ],
    habits: [
      { id:"floors",    title:"Floors climbed today", emoji:"🏢", quip:"One floor at a time. 2,903 to go.", type:"distance", points:1, unit:"floors" },
    ],
  },
  {
    id: "kilimanjaro-stairmaster", name: "Kilimanjaro StairMaster", emoji: "🌋", category: "expedition",
    description: "Climb 1,934 floors — the StairMaster equivalent of Africa's highest peak, Uhuru at 5,895 m. Less oxygen, less mercy than Everest, but still Africa's crown.",
    duration: 240, weeklyGoal: 5, defaultMode: "strict", routeKm: 1934,
    routeGeo: [[0.5,0.9],[0.44,0.74],[0.54,0.58],[0.46,0.42],[0.54,0.26],[0.5,0.1]],
    milestones: [
      { km: 100, name: "Foothills", blurb: "The climb starts through farmland and forest." },
      { km: 600, name: "Marangu Gate", blurb: "The trailhead into the rainforest belt." },
      { km: 900, name: "Mandara Hut (2,720 m)", blurb: "First camp among giant heather and mist." },
      { km: 1200, name: "Horombo Hut (3,720 m)", blurb: "Into the alpine desert, the summit now in view." },
      { km: 1548, name: "Kibo Hut (4,720 m)", blurb: "The last camp before the midnight summit push." },
      { km: 1934, name: "Uhuru Peak — 5,895 m", blurb: "The roof of Africa. The highest point on the continent." },
    ],
    habits: [
      { id:"floors",    title:"Floors climbed today", emoji:"🏢", quip:"One floor at a time. 1,934 to go.", type:"distance", points:1, unit:"floors" },
    ],
  },
  {
    id: "montblanc-stairmaster", name: "Mont Blanc StairMaster", emoji: "⛰️", category: "expedition",
    description: "Climb 1,577 floors — the StairMaster equivalent of Mont Blanc, the highest peak in the Alps at 4,808 m. A serious mountain, but friendlier than the giants above.",
    duration: 180, weeklyGoal: 5, defaultMode: "strict", routeKm: 1577,
    routeGeo: [[0.5,0.9],[0.46,0.72],[0.54,0.54],[0.46,0.36],[0.5,0.12]],
    milestones: [
      { km: 100, name: "Chamonix Valley", blurb: "At the foot of the massif, the climb ahead." },
      { km: 400, name: "Les Houches (1,220 m)", blurb: "Leaving the valley floor for the mountain." },
      { km: 780, name: "Nid d'Aigle (2,380 m)", blurb: "Where the rack railway ends and the real ascent begins." },
      { km: 1252, name: "Refuge du Goûter (3,817 m)", blurb: "The high refuge clinging to the ridge." },
      { km: 1577, name: "Summit — 4,808 m", blurb: "The roof of the Alps, western Europe's highest." },
    ],
    habits: [
      { id:"floors",    title:"Floors climbed today", emoji:"🏢", quip:"One floor at a time. 1,577 to go.", type:"distance", points:1, unit:"floors" },
    ],
  },

  // ── Running Expeditions ──────────────────────────────────────────────────
  {
    id: "comrades-ultra", name: "The 90 km Ultra", emoji: "🏃", category: "expedition",
    description: "Run the legendary 89 km Comrades Marathon from Pietermaritzburg to Durban, South Africa.",
    duration: 21, weeklyGoal: 5, defaultMode: "soft", routeKm: 89,
    routeGeo: [[0.0,0.008],[0.39,0.654],[0.58,0.585],[0.764,0.893],[0.935,0.958],[1.0,0.992]],
    milestones: [
      { km: 17, name: "Drummond", blurb: "Halfway, at the top of the great climbs." },
      { km: 36, name: "Botha's Hill", blurb: "The crowds thick along the ridgeline." },
      { km: 55, name: "Fields Hill", blurb: "A brutal descent that punishes tired legs." },
      { km: 82, name: "Tollgate", blurb: "The last rise before the city -- nearly home." },
      { km: 89, name: "Durban!", blurb: "Into the city on the coast. The ultimate human race, done." },
    ],
    habits: [
      { id:"cu-run",    title:"Log running distance", emoji:"🏃", quip:"Every step toward Durban.", type:"distance", points:1, unit:"km" },
    ]
  },
  {
    id: "utmb", name: "Mont Blanc Ultra", emoji: "⛰️", category: "expedition",
    description: "Tackle the 171 km UTMB course circling Mont Blanc through France, Italy and Switzerland.",
    duration: 40, weeklyGoal: 5, defaultMode: "soft", routeKm: 171,
    routeGeo: [[0.379,0.456],[0.288,0.589],[0.514,1.0],[0.712,0.021],[0.467,0.0],[0.381,0.427],[0.379,0.456]],
    milestones: [
      { km: 22, name: "Les Houches", blurb: "The first climb out of the valley, night falling." },
      { km: 50, name: "Courmayeur", blurb: "Over the border into Italy, halfway through the loop." },
      { km: 80, name: "Champex-Lac", blurb: "A dark alpine lake, deep into the long night." },
      { km: 122, name: "Vallorcine", blurb: "Back near France, the final climbs waiting." },
      { km: 152, name: "La Flégère", blurb: "The last high balcony, Chamonix glittering below." },
      { km: 171, name: "Chamonix!", blurb: "Down to the finish line. The great alpine loop, closed." },
    ],
    habits: [
      { id:"utmb-run",  title:"Log running distance", emoji:"🏃", quip:"The mountains are waiting.", type:"distance", points:1, unit:"km" },
    ]
  },
  {
    id: "run-5-marathons", name: "5 Marathon Challenge", emoji: "🏃", category: "expedition",
    description: "Run the equivalent of 5 consecutive marathons — 211 km total. Pace doesn't matter. Showing up does.",
    duration: 45, weeklyGoal: 5, defaultMode: "soft", routeKm: 211,
    routeGeo: [[0.06,0.6],[0.24,0.52],[0.44,0.56],[0.62,0.48],[0.8,0.52],[0.95,0.44]],
    milestones: [
      { km: 42, name: "Marathon 1", blurb: "42 km down. Four to go -- settle into the rhythm." },
      { km: 84, name: "Marathon 2", blurb: "Two marathons banked. The legs are learning." },
      { km: 126, name: "Marathon 3", blurb: "Past halfway. This is where it becomes mental." },
      { km: 168, name: "Marathon 4", blurb: "One to go. You've already done more than most ever will." },
      { km: 211, name: "Marathon 5", blurb: "Five marathons. 211 km of proof you don't quit." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🏃", quip:"Every km counts. Log it.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "run-jogle", name: "Land's End to John o'Groats", emoji: "🏃", category: "expedition",
    description: "Run the entire length of Great Britain — 1,407 km from Land's End to John o'Groats. End to end.",
    duration: 90, weeklyGoal: 5, defaultMode: "soft", routeKm: 1407,
    routeGeo: [[0.443,1.0],[0.545,0.838],[0.557,0.602],[0.532,0.424],[0.53,0.0]],
    milestones: [
      { km: 1, name: "Land's End", blurb: "The far south-west tip of Britain -- the start line." },
      { km: 340, name: "Bristol", blurb: "Through the West Country and over the Severn." },
      { km: 600, name: "Manchester", blurb: "The industrial north, halfway up the island." },
      { km: 900, name: "Scottish Border", blurb: "Into Scotland, the Highlands rising ahead." },
      { km: 1407, name: "John o'Groats", blurb: "The far north-east corner. End to end, on foot." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🏃", quip:"North. Always north.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "run-trans-america", name: "Trans-America Run", emoji: "🏃", category: "expedition",
    description: "Run across the United States — 4,989 km from San Francisco to New York City.",
    duration: 180, weeklyGoal: 5, defaultMode: "soft", routeKm: 4989,
    routeGeo: [[0.0,0.583],[0.339,0.485],[0.504,0.429],[0.666,0.536],[1.0,0.417]],
    milestones: [
      { km: 1, name: "San Francisco", blurb: "The Pacific at your back, a continent ahead." },
      { km: 1500, name: "Rocky Mountains", blurb: "Up over the Continental Divide, the great climb." },
      { km: 2500, name: "Great Plains", blurb: "Endless straight roads across the heartland." },
      { km: 3500, name: "Mississippi River", blurb: "The mighty river -- the country's midpoint." },
      { km: 4989, name: "New York City", blurb: "The Atlantic coast. Ocean to ocean on your own two feet." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🏃", quip:"Coast to coast. One step at a time.", type:"distance", points:1, unit:"km" },
    ],
  },

  // ── Additional Cycling Expeditions ──────────────────────────────────────
  {
    id: "raid-pyrenees", name: "Pyrenees Crossing", emoji: "🚴", category: "expedition",
    description: "Cycle all 726 km of the legendary Pyrénées mountain route from the Atlantic coast to the Mediterranean.",
    duration: 45, weeklyGoal: 5, defaultMode: "soft", routeKm: 726,
    routeGeo: [[0.0,0.229],[0.217,0.446],[0.667,0.734],[0.844,0.738],[1.0,0.771]],
    milestones: [
      { km: 1, name: "Hendaye — Atlantic", blurb: "Wheels wet in the Atlantic, the range ahead." },
      { km: 150, name: "First High Passes", blurb: "The Basque foothills give way to real cols." },
      { km: 400, name: "Andorra", blurb: "High in the mountain principality, the crux of the ride." },
      { km: 600, name: "Final Cols", blurb: "The last great climbs before the sea." },
      { km: 726, name: "Cerbère — Mediterranean", blurb: "Down to the warm Mediterranean. Coast to coast, over the tops." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚴", quip:"Pedal. Climb. Breathe.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "trans-am-bike", name: "Trans-America Bike", emoji: "🚴", category: "expedition",
    description: "Ride the 6,771 km TransAm Bike Trail from Yorktown, Virginia to Astoria, Oregon.",
    duration: 180, weeklyGoal: 5, defaultMode: "soft", routeKm: 6771,
    routeGeo: [[1.0,0.76],[0.916,0.745],[0.673,0.669],[0.377,0.687],[0.0,0.24]],
    milestones: [
      { km: 1, name: "Yorktown, Virginia", blurb: "Atlantic tidewater -- the start of the crossing." },
      { km: 900, name: "Blue Ridge Parkway", blurb: "Rolling Appalachian ridges and long climbs." },
      { km: 2700, name: "Missouri River", blurb: "Into the Midwest, the plains stretching west." },
      { km: 4500, name: "Colorado Rockies", blurb: "Over the high passes of the Continental Divide." },
      { km: 6771, name: "Astoria, Oregon", blurb: "The Pacific at last. A whole continent by bike." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚴", quip:"Every state. Every climb. No shortcuts.", type:"distance", points:1, unit:"km" },
    ],
  },

  // ── Additional Rowing Expeditions ────────────────────────────────────────
  {
    id: "thames-row", name: "Thames Row", emoji: "🚣", category: "expedition",
    description: "Row the full length of the Thames from its source in the Cotswolds to the open sea — 346 km.",
    duration: 30, weeklyGoal: 5, defaultMode: "soft", routeKm: 346,
    routeGeo: [[0.0,0.386],[0.278,0.315],[0.513,0.644],[0.699,0.614],[1.0,0.685]],
    milestones: [
      { km: 1, name: "The Source, Cotswolds", blurb: "A trickle in a quiet field -- the river's beginning." },
      { km: 75, name: "Oxford", blurb: "Past the spires and college boathouses." },
      { km: 170, name: "Windsor Castle", blurb: "The royal towers watching over the river." },
      { km: 280, name: "London Bridge", blurb: "Through the heart of the capital, tide running." },
      { km: 346, name: "Thames Estuary", blurb: "The river widens to meet the sea. Source to sea, rowed." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚣", quip:"Pull. The river knows the way.", type:"distance", points:1, unit:"km" },
    ],
  },
  {
    id: "danube-row", name: "Danube Row", emoji: "🚣", category: "expedition",
    description: "Row 2,860 km down the Danube from Germany to the Black Sea — through 10 countries.",
    duration: 120, weeklyGoal: 5, defaultMode: "soft", routeKm: 2860,
    routeGeo: [[0.0,0.277],[0.37,0.239],[0.496,0.342],[0.66,0.761],[1.0,0.674]],
    milestones: [
      { km: 1, name: "Donaueschingen, Germany", blurb: "The Black Forest spring where the Danube rises." },
      { km: 360, name: "Vienna", blurb: "The imperial city on the river's banks." },
      { km: 680, name: "Budapest", blurb: "The Danube splits Buda from Pest beneath the bridges." },
      { km: 1400, name: "Iron Gates Gorge", blurb: "The river carves through the Carpathian cliffs." },
      { km: 2860, name: "Black Sea", blurb: "The great delta and the open sea. Europe's river, rowed." },
    ],
    habits: [
      { id:"dist",      title:"Log distance",  emoji:"🚣", quip:"Downstream. Europe unrolling behind you.", type:"distance", points:1, unit:"km" },
    ],
  },];

// ── Badge Definitions ──────────────────────────────────────────────────────

// Universal badges — earned once across all challenges (tracked in state.globalBadges)
const UNIVERSAL_BADGES = [
  // Streak milestones (best streak across any challenge)
  { id:"u-3d",     label:"✨ Getting Started",   desc:"Reach a 3-day streak in any challenge.",              test: u => u.longestStreak >= 3 },
  { id:"u-7d",     label:"🔥 On Fire",            desc:"7-day streak.",                                       test: u => u.longestStreak >= 7 },
  { id:"u-14d",    label:"🦾 Iron Week",          desc:"14-day streak.",                                      test: u => u.longestStreak >= 14 },
  { id:"u-21d",    label:"🧠 Locked In",       desc:"21-day streak. You've built a powerful routine.",    test: u => u.longestStreak >= 21 },
  { id:"u-30d",    label:"💪 Locked In",          desc:"30-day streak.",                                      test: u => u.longestStreak >= 30 },
  { id:"u-60d",    label:"📆 Two Months",         desc:"60-day streak.",                                      test: u => u.longestStreak >= 60 },
  { id:"u-75d",    label:"🏆 75 Streak",          desc:"75 consecutive days. Legendary.",                     test: u => u.longestStreak >= 75 },
  // Points (all-time total across all challenges)
  { id:"u-p10",    label:"⚡ First Points",       desc:"Earn your first 10 points.",                         test: u => u.totalPts >= 10 },
  { id:"u-p100",   label:"💯 Century",            desc:"100 points total.",                                   test: u => u.totalPts >= 100 },
  { id:"u-p500",   label:"🏅 Point Collector",    desc:"500 total points.",                                   test: u => u.totalPts >= 500 },
  { id:"u-p1k",    label:"💜 Elite",              desc:"1,000 total points. Rare.",                           test: u => u.totalPts >= 1000 },
  // Body tracking (global)
  { id:"u-scale",  label:"⚖️ On The Scale",       desc:"Log your first weight check-in.",                    test: u => u.weighIns >= 1 },
  { id:"u-1lb",    label:"📉 First Pound",        desc:"Lose 1 lb from your starting weight.",               test: u => u.weightLost >= 1 },
  { id:"u-5lb",    label:"📉 5 lbs Down",         desc:"Lose 5 lbs.",                                        test: u => u.weightLost >= 5 },
  { id:"u-10lb",   label:"💪 10 lbs Down",        desc:"Lose 10 lbs. Seriously impressive.",                 test: u => u.weightLost >= 10 },
  { id:"u-wgoal",  label:"🎯 Goal Reached",       desc:"Hit your goal weight.",                               test: u => u.weightGoalReached },
  // Modes & behaviour
  { id:"u-cmback", label:"🧡 Comeback Kid",       desc:"Use the Save My Day recovery.",                      test: u => u.anyRecovered },
  // Challenge milestones
  { id:"u-first",  label:"🌊 First Wave",         desc:"Complete 100% of tasks on your very first day.",   test: u => u.anyFirstDay },
  { id:"u-done1",  label:"✅ Challenge Done",     desc:"Finish your first challenge.",                        test: u => u.completedChallenges >= 1 },
  { id:"u-done3",  label:"🏆 Triple Threat",      desc:"Complete 3 challenges.",                              test: u => u.completedChallenges >= 3 },
  { id:"u-multi",  label:"🔀 Multi-Tasker",       desc:"Run 2 challenges at the same time.",                 test: u => u.activeChallenges >= 2 },
  { id:"u-perfwk", label:"⭐ Perfect Week",        desc:"Complete all tasks every day for 7 consecutive days.", test: u => u.hasPerfectWeek },
  // Hidden badges — show as "🔒 ???" until earned
  { id:"u-expedition",   label:"🗺️ The Expedition",  desc:"Complete any expedition challenge.",                          tier:"rare",      hidden:true, test: u => u.expeditionDone },
  { id:"u-double-agent", label:"🔀 Double Agent",     desc:"Complete the same challenge twice.",                         tier:"rare",      hidden:true, test: u => u.doubleAgent },
  { id:"u-dark-horse",   label:"🖤 Dark Horse",       desc:"Come back after a streak gap and still finish.",             tier:"epic",      hidden:true, test: u => u.darkHorse },
  { id:"u-perfect-mt",   label:"💎 Perfect Month",    desc:"Complete 100% of tasks every day for 30 consecutive days.", tier:"legendary", hidden:true, test: u => u.perfectMonth },
];

// Lifetime achievements — cross-challenge milestones earned once (tracked in state.globalBadges)
const LIFETIME_BADGES = [
  { id:"lt-100h",   label:"100 Logged",          desc:"Log 100 individual tasks across all challenges.",  test: l => l.totalHabitsLogged >= 100 },
  { id:"lt-500h",   label:"500 Logged",          desc:"Log 500 tasks total. You're built different.",     test: l => l.totalHabitsLogged >= 500 },
  { id:"lt-chal5",  label:"Serial Challenger",   desc:"Complete 5 challenges.",                            test: l => l.completedChallenges >= 5 },
  { id:"lt-cats",   label:"Well Rounded",        desc:"Complete a challenge in all 4 categories.",        test: l => l.allCategoriesDone },
  { id:"lt-perf",   label:"Perfect Run",         desc:"Complete a challenge without a single missed day.", test: l => l.perfectChallenge },
  { id:"lt-freeze", label:"Ice Age",             desc:"Use a streak freeze to save a streak.",             test: l => l.freezeUsed },
];

// Template-specific badges - 5 per template, only shown/counted for that challenge (tracked in challenge.badges)
const TEMPLATE_BADGES = {
  "30-pushups": [
    { id:"pu-first",    label:"First Rep",      desc:"Log your first push-up session.",      test: c => c.daysLogged >= 1 },
    { id:"pu-week",     label:"Push-Up Week",   desc:"7 consecutive push-up days.",          test: c => c.streak >= 7 },
    { id:"pu-halfway",  label:"Halfway",        desc:"15 days logged.",                      test: c => c.daysLogged >= 15 },
    { id:"pu-perfect",  label:"Perfect Week",   desc:"A full week with no missed days.",     test: c => c.completedWeeks >= 1 },
    { id:"pu-done",     label:"30 Days Strong", desc:"Complete the full 30-day challenge.",   test: c => c.pctDone >= 99 && c.complete },
  ],
  "dog-walk": [
    { id:"dw-first",    label:"First Walk",     desc:"Log your first dog walk.",                         test: c => c.daysLogged >= 1 },
    { id:"dw-6km",      label:"Adventure Walk", desc:"Log a 6 km+ walk.",                               test: c => c.has6kmWalk },
    { id:"dw-week",     label:"Walk Week",      desc:"7-day walking streak.",                            test: c => c.streak >= 7 },
    { id:"dw-halfway",  label:"Halfway",        desc:"15 walks logged.",                                 test: c => c.daysLogged >= 15 },
    { id:"dw-done",     label:"30 Walks Done",  desc:"Complete the full 30-day dog walk challenge.",     test: c => c.pctDone >= 99 && c.complete },
  ],
  "cycling": [
    { id:"cy-first",    label:"First Ride",       desc:"Log your first bike ride.",                        test: c => c.daysLogged >= 1 },
    { id:"cy-50km",     label:"Long Ride",        desc:"Log a 50 km+ ride.",                              test: c => c.has50kmRide },
    { id:"cy-week",     label:"Saddle Week",      desc:"7 consecutive riding days.",                       test: c => c.streak >= 7 },
    { id:"cy-halfway",  label:"Halfway",          desc:"15 rides logged.",                                 test: c => c.daysLogged >= 15 },
    { id:"cy-done",     label:"30 Days Cycling",  desc:"Complete the full 30-day challenge.",               test: c => c.pctDone >= 99 && c.complete },
  ],
  "walking": [
    { id:"wk-first",    label:"First Steps",        desc:"Log your first walk.",                             test: c => c.daysLogged >= 1 },
    { id:"wk-week",     label:"Walk Week",          desc:"7-day walking streak.",                            test: c => c.streak >= 7 },
    { id:"wk-10km",     label:"10 km Walk",         desc:"Log a 10 km+ walk.",                              test: c => c.has10kmWalk },
    { id:"wk-halfway",  label:"Halfway",            desc:"15 walks logged.",                                 test: c => c.daysLogged >= 15 },
    { id:"wk-done",     label:"Walking Month Done", desc:"Complete 30 days of walking.",                     test: c => c.pctDone >= 99 && c.complete },
  ],
  "running": [
    { id:"rn-first",    label:"First Run",            desc:"Log your first run.",                              test: c => c.runsLogged >= 1 },
    { id:"rn-5k",       label:"5k Done",              desc:"Run 5 km or further.",                             test: c => c.hasRun5k },
    { id:"rn-10",       label:"Ten Runs",             desc:"Log 10 run sessions.",                             test: c => c.runsLogged >= 10 },
    { id:"rn-halfway",  label:"Halfway",              desc:"15 runs logged.",                                  test: c => c.runsLogged >= 15 },
    { id:"rn-done",     label:"Running Month Done",   desc:"Complete 30 days of running.",                     test: c => c.pctDone >= 99 && c.complete },
  ],

  // Expedition routes - km-milestone badges
  "everest-bc": [
    { id:"ebc-start",     label:"🥾 First Steps",          desc:"Log your first km on the trail.",                  test: c => c.totalKm >= 1 },
    { id:"ebc-phakding",  label:"🏡 Phakding",             desc:"Reach the first mountain village (10 km).",        test: c => c.totalKm >= 10 },
    { id:"ebc-namche",    label:"🏙️ Namche Bazaar",        desc:"Climb to the Sherpa capital (40 km).",             test: c => c.totalKm >= 40 },
    { id:"ebc-gorak",     label:"⛺ Gorak Shep",           desc:"Reach the highest camp (100 km).",                 test: c => c.totalKm >= 100 },
    { id:"ebc-done",      label:"🏔️ Base Camp!",           desc:"Conquer Everest Base Camp — all 130 km.",          test: c => c.totalKm >= 130 },
  ],
  "west-highland-way": [
    { id:"whw-start",   label:"🥾 First Steps",     desc:"Log your first km on the Way.",                       test: c => c.totalKm >= 1   },
    { id:"whw-balmaha", label:"🌊 Balmaha",          desc:"Reach the shores of Loch Lomond (20 km).",           test: c => c.totalKm >= 20  },
    { id:"whw-inv",     label:"🏞️ Inverarnan",       desc:"Pass the north end of Loch Lomond (50 km).",         test: c => c.totalKm >= 50  },
    { id:"whw-tyn",     label:"🏘️ Tyndrum",          desc:"Into the open Highlands (80 km).",                   test: c => c.totalKm >= 80  },
    { id:"whw-kin",     label:"⛰️ Kinlochleven",     desc:"The final mountain crossing (120 km).",              test: c => c.totalKm >= 120 },
    { id:"whw-done",    label:"🎉 Fort William!",    desc:"Complete the full West Highland Way — 154 km.",      test: c => c.totalKm >= 154 },
  ],
  "tour-du-mont-blanc": [
    { id:"tmb-start",  label:"🥾 Chamonix Start",  desc:"Log your first km around the massif.",                test: c => c.totalKm >= 1   },
    { id:"tmb-cont",   label:"🌲 Les Contamines",  desc:"Into France's southern valleys (30 km).",             test: c => c.totalKm >= 30  },
    { id:"tmb-cour",   label:"🇮🇹 Courmayeur",     desc:"Cross into Italy (60 km).",                           test: c => c.totalKm >= 60  },
    { id:"tmb-fouly",  label:"🇨🇭 La Fouly",       desc:"Cross into Switzerland (90 km).",                     test: c => c.totalKm >= 90  },
    { id:"tmb-champ",  label:"🏞️ Champex-Lac",     desc:"The final Alpine section (130 km).",                  test: c => c.totalKm >= 130 },
    { id:"tmb-done",   label:"🏔️ Full Circle!",    desc:"Complete the Tour du Mont Blanc — 170 km.",           test: c => c.totalKm >= 170 },
  ],
  "john-muir-trail": [
    { id:"jmt-start",   label:"🥾 Happy Isles",       desc:"Step off from Yosemite. The Sierra awaits.",          test: c => c.totalKm >= 1   },
    { id:"jmt-tuol",    label:"🌿 Tuolumne",           desc:"Reach the High Sierra plateau (50 km).",             test: c => c.totalKm >= 50  },
    { id:"jmt-evol",    label:"🏔️ Evolution Valley",  desc:"Deep wilderness (120 km).",                          test: c => c.totalKm >= 120 },
    { id:"jmt-ranch",   label:"🏕️ Muir Trail Ranch",  desc:"Halfway through the Sierra (180 km).",               test: c => c.totalKm >= 180 },
    { id:"jmt-pinchot", label:"❄️ Pinchot Pass",      desc:"Over the high passes (250 km).",                     test: c => c.totalKm >= 250 },
    { id:"jmt-done",    label:"🦅 Whitney Summit!",   desc:"Highest peak in the lower 48 — all 340 km.",         test: c => c.totalKm >= 340 },
  ],
  "camino": [
    { id:"cam-start",     label:"🎒 Buen Camino",          desc:"Log your first km on the Way.",                    test: c => c.totalKm >= 1 },
    { id:"cam-pamplona",  label:"🏟️ Pamplona",             desc:"Reach Pamplona (75 km).",                          test: c => c.totalKm >= 75 },
    { id:"cam-burgos",    label:"🏰 Burgos",               desc:"Reach the Gothic city of Burgos (250 km).",        test: c => c.totalKm >= 250 },
    { id:"cam-leon",      label:"🦁 León",                 desc:"Pass through the city of León (400 km).",          test: c => c.totalKm >= 400 },
    { id:"cam-done",      label:"⛪ Santiago!",            desc:"Arrive at Santiago de Compostela — all 790 km.",   test: c => c.totalKm >= 790 },
  ],
  "appalachian": [
    { id:"at-start",      label:"🌅 Georgia Start",        desc:"Log your first km on the AT.",                     test: c => c.totalKm >= 1 },
    { id:"at-shenandoah", label:"🌿 Shenandoah",           desc:"Hike through Shenandoah Valley (300 km).",         test: c => c.totalKm >= 300 },
    { id:"at-halfway",    label:"🪨 Halfway There",         desc:"Pass the halfway mark in Pennsylvania (900 km).",  test: c => c.totalKm >= 900 },
    { id:"at-newengland", label:"🍂 New England",          desc:"Enter the final stretch (1,800 km).",              test: c => c.totalKm >= 1800 },
    { id:"at-done",       label:"🏔️ Katahdin!",            desc:"Reach Mount Katahdin — all 3,540 km.",             test: c => c.totalKm >= 3540 },
  ],
  "tour-de-france": [
    { id:"tdf-start",     label:"🟡 Maillot Jaune",        desc:"Clip in and log your first km.",                   test: c => c.totalKm >= 1 },
    { id:"tdf-brittany",  label:"🌊 Brittany",             desc:"Clear the Brittany coast (400 km).",               test: c => c.totalKm >= 400 },
    { id:"tdf-pyrenees",  label:"⛰️ Les Pyrénées",         desc:"Conquer the Pyrenees (1,600 km).",                 test: c => c.totalKm >= 1600 },
    { id:"tdf-alps",      label:"🏔️ Les Alpes",            desc:"Survive the Alps (2,400 km).",                     test: c => c.totalKm >= 2400 },
    { id:"tdf-done",      label:"🗼 Paris!",               desc:"Roll onto the Champs-Élysées — all 3,490 km.",     test: c => c.totalKm >= 3490 },
  ],
  "route66": [
    { id:"r66-start",     label:"🛣️ Hit the Road",         desc:"Start the Mother Road — log your first km.",       test: c => c.totalKm >= 1 },
    { id:"r66-springfield",label:"🌽 Springfield",         desc:"Roll through Springfield, IL (500 km).",           test: c => c.totalKm >= 500 },
    { id:"r66-okc",       label:"🤠 Oklahoma City",        desc:"Reach Oklahoma City (1,100 km).",                  test: c => c.totalKm >= 1100 },
    { id:"r66-abq",       label:"🌵 Albuquerque",          desc:"Cross the desert to Albuquerque (2,700 km).",      test: c => c.totalKm >= 2700 },
    { id:"r66-done",      label:"🎡 Santa Monica!",        desc:"Reach the end of Route 66 — all 3,940 km.",        test: c => c.totalKm >= 3940 },
  ],
  "amazon-river": [
    { id:"amz-start",     label:"🌿 Into the Jungle",      desc:"Launch onto the Amazon — log your first km.",      test: c => c.totalKm >= 1 },
    { id:"amz-iquitos",   label:"🐊 Iquitos",              desc:"Pass through Iquitos, Peru (500 km).",              test: c => c.totalKm >= 500 },
    { id:"amz-manaus",    label:"🏙️ Manaus",               desc:"Reach the heart of the Amazon (3,000 km).",        test: c => c.totalKm >= 3000 },
    { id:"amz-santarem",  label:"🦜 Santarém",             desc:"Approach the Atlantic delta (5,000 km).",          test: c => c.totalKm >= 5000 },
    { id:"amz-done",      label:"🌊 Atlantic!",            desc:"Flow into the Atlantic Ocean — all 6,437 km.",     test: c => c.totalKm >= 6437 },
  ],
  "everest-stairmaster": [
    { id:"esm-start",   label:"🏢 First Floor",        desc:"Log your first floor. The climb begins.",             test: c => c.totalKm >= 1     },
    { id:"esm-100",     label:"⛰️ Foothills",           desc:"Reach 100 floors — the foothills.",                  test: c => c.totalKm >= 100   },
    { id:"esm-1000",    label:"🏕️ Camp II",             desc:"1,000 floors deep. Basecamp II altitude.",           test: c => c.totalKm >= 1000  },
    { id:"esm-2000",    label:"☠️ Death Zone",           desc:"2,000 floors. The air is dangerously thin.",         test: c => c.totalKm >= 2000  },
    { id:"esm-summit",  label:"🏔️ Everest Summit!",     desc:"2,903 floors. You climbed an entire mountain.",      test: c => c.totalKm >= 2903.2},
  ],
  "kilimanjaro-stairmaster": [
    { id:"ksm-start",   label:"🏢 First Floor",          desc:"Log your first floor. Africa calls.",                test: c => c.totalKm >= 1     },
    { id:"ksm-600",     label:"🌲 Marangu Gate",          desc:"600 floors — through the tropical forest zone.",    test: c => c.totalKm >= 600   },
    { id:"ksm-900",     label:"🏕️ Mandara Hut",          desc:"900 floors. First mountain camp at 2,720 m.",       test: c => c.totalKm >= 900   },
    { id:"ksm-1200",    label:"⛺ Horombo Hut",           desc:"1,200 floors. High camp at 3,720 m.",               test: c => c.totalKm >= 1200  },
    { id:"ksm-1548",    label:"❄️ Kibo Hut",              desc:"1,548 floors. The final camp before the summit.",   test: c => c.totalKm >= 1548  },
    { id:"ksm-summit",  label:"🌋 Uhuru Peak!",           desc:"1,934 floors. Africa's highest point — 5,895 m.",  test: c => c.totalKm >= 1934  },
  ],
  "montblanc-stairmaster": [
    { id:"mb-start",    label:"🏢 First Floor",           desc:"Log your first floor. The Alps await.",             test: c => c.totalKm >= 1     },
    { id:"mb-400",      label:"🌲 Les Houches",            desc:"400 floors — into the Alpine foothills.",           test: c => c.totalKm >= 400   },
    { id:"mb-780",      label:"🦅 Nid d'Aigle",            desc:"780 floors. Eagle's Nest at 2,380 m.",              test: c => c.totalKm >= 780   },
    { id:"mb-1252",     label:"🏔️ Refuge du Goûter",      desc:"1,252 floors. The classic summit hut at 3,817 m.", test: c => c.totalKm >= 1252  },
    { id:"mb-summit",   label:"⛰️ Mont Blanc Summit!",    desc:"1,577 floors. Highest peak in the Alps — 4,808 m.",test: c => c.totalKm >= 1577  },
  ],
  "pct": [
    { id:"pct-start",  label:"🌵 Mexico Border",    desc:"Step off from the southern terminus. The journey begins.", test: c => c.totalKm >= 1    },
    { id:"pct-sierra", label:"⛰️ High Sierra",      desc:"Enter the Sierra Nevada (2,000 km).",                     test: c => c.totalKm >= 2000 },
    { id:"pct-oregon", label:"🌋 Into Oregon",      desc:"Cross into Oregon (3,100 km).",                           test: c => c.totalKm >= 3100 },
    { id:"pct-wa",     label:"🏔️ Washington",       desc:"Enter the final state (3,800 km).",                       test: c => c.totalKm >= 3800 },
    { id:"pct-done",   label:"🍁 Canada!",           desc:"4,286 km. You walked from Mexico to Canada.",            test: c => c.totalKm >= 4286 },
  ],
  "run-5-marathons": [
    { id:"r5m-start",   label:"👟 First Steps",      desc:"Log your first km.",                                      test: c => c.totalKm >= 1   },
    { id:"r5m-mar1",    label:"🏅 Marathon 1",        desc:"Cover 42 km — first marathon done.",                     test: c => c.totalKm >= 42  },
    { id:"r5m-halfway", label:"🔥 Halfway",           desc:"105 km — halfway through all 5 marathons.",              test: c => c.totalKm >= 105 },
    { id:"r5m-mar4",    label:"🏃 Marathon 4",        desc:"168 km — fourth marathon complete.",                     test: c => c.totalKm >= 168 },
    { id:"r5m-done",    label:"🎖️ Five Marathons!",   desc:"All 211 km done. Five consecutive marathons.",           test: c => c.totalKm >= 211 },
  ],
  "run-jogle": [
    { id:"jogle-start",   label:"🌊 Land's End",       desc:"Start your JOGLE run.",                                 test: c => c.totalKm >= 1    },
    { id:"jogle-bristol", label:"🏙️ Bristol",           desc:"Reach Bristol (340 km in).",                           test: c => c.totalKm >= 340  },
    { id:"jogle-manc",    label:"🏭 Manchester",        desc:"Run through Manchester (600 km).",                      test: c => c.totalKm >= 600  },
    { id:"jogle-border",  label:"🏴 Scotland",          desc:"Cross the Scottish Border (900 km).",                  test: c => c.totalKm >= 900  },
    { id:"jogle-done",    label:"🏔️ John o'Groats!",   desc:"Run the full length of Britain — 1,407 km.",           test: c => c.totalKm >= 1407 },
  ],
  "run-trans-america": [
    { id:"rta-start",   label:"🌉 San Francisco",     desc:"Set off from the Bay Area.",                             test: c => c.totalKm >= 1    },
    { id:"rta-rockies", label:"⛰️ Rockies",           desc:"Cross the Rocky Mountains (1,500 km).",                 test: c => c.totalKm >= 1500 },
    { id:"rta-plains",  label:"🌾 Great Plains",      desc:"Run through the Great Plains (2,500 km).",               test: c => c.totalKm >= 2500 },
    { id:"rta-miss",    label:"🌊 Mississippi",       desc:"Cross the Mississippi River (3,500 km).",               test: c => c.totalKm >= 3500 },
    { id:"rta-done",    label:"🗽 New York City!",    desc:"Run coast to coast — all 4,989 km.",                    test: c => c.totalKm >= 4989 },
  ],
  "raid-pyrenees": [
    { id:"rp-start",    label:"🌊 Hendaye",           desc:"Clip in at the Atlantic start.",                         test: c => c.totalKm >= 1   },
    { id:"rp-pass1",    label:"⛰️ First High Pass",   desc:"Conquer the first high passes (150 km).",               test: c => c.totalKm >= 150 },
    { id:"rp-andorra",  label:"🏔️ Andorra",           desc:"Reach Andorra at the halfway point (400 km).",          test: c => c.totalKm >= 400 },
    { id:"rp-final",    label:"🚴 Final Cols",         desc:"Enter the final mountain stretch (600 km).",             test: c => c.totalKm >= 600 },
    { id:"rp-done",     label:"☀️ Mediterranean!",    desc:"Reach Cerbère and the Mediterranean — all 726 km.",     test: c => c.totalKm >= 726 },
  ],
  "trans-am-bike": [
    { id:"tab-start",   label:"🏛️ Yorktown",          desc:"Roll out from the East Coast.",                          test: c => c.totalKm >= 1    },
    { id:"tab-ridge",   label:"🌄 Blue Ridge",        desc:"Ride the Blue Ridge Parkway (900 km).",                  test: c => c.totalKm >= 900  },
    { id:"tab-river",   label:"🌊 Missouri River",    desc:"Cross the Missouri River (2,700 km).",                  test: c => c.totalKm >= 2700 },
    { id:"tab-rockies", label:"🏔️ Colorado Rockies",  desc:"Conquer the Colorado Rockies (4,500 km).",               test: c => c.totalKm >= 4500 },
    { id:"tab-done",    label:"🌊 Astoria!",          desc:"Reach the Pacific — all 6,771 km.",                     test: c => c.totalKm >= 6771 },
  ],
  "thames-row": [
    { id:"thr-start",   label:"🌿 The Source",        desc:"Push off from the Thames source.",                       test: c => c.totalKm >= 1   },
    { id:"thr-oxford",  label:"🎓 Oxford",            desc:"Row through Oxford (75 km).",                           test: c => c.totalKm >= 75  },
    { id:"thr-windsor", label:"🏰 Windsor Castle",    desc:"Pass Windsor Castle (170 km).",                         test: c => c.totalKm >= 170 },
    { id:"thr-london",  label:"🌉 London Bridge",     desc:"Row under London Bridge (280 km).",                     test: c => c.totalKm >= 280 },
    { id:"thr-done",    label:"🌊 To the Sea!",       desc:"Reach the Thames Estuary — all 346 km.",                test: c => c.totalKm >= 346 },
  ],
  "danube-row": [
    { id:"dan-start",    label:"🇩🇪 Donaueschingen",  desc:"Launch on the Danube in Germany.",                       test: c => c.totalKm >= 1    },
    { id:"dan-vienna",   label:"🎼 Vienna",           desc:"Row past Vienna (360 km).",                             test: c => c.totalKm >= 360  },
    { id:"dan-budapest", label:"🏰 Budapest",         desc:"Pass through Budapest (680 km).",                       test: c => c.totalKm >= 680  },
    { id:"dan-gorge",    label:"⛰️ Iron Gates",       desc:"Navigate the Iron Gates Gorge (1,400 km).",             test: c => c.totalKm >= 1400 },
    { id:"dan-done",     label:"🌊 Black Sea!",       desc:"Row to the Black Sea — all 2,860 km.",                  test: c => c.totalKm >= 2860 },
  ],};

// ── Challenge Chains (what comes next after each template) ────────────────
const CHALLENGE_CHAINS = {
  "walking":            "running",
  "running":            "cycling",
  "pct":                "appalachian",
  // Rowing progression
  "thames-row":         "danube-row",
  "danube-row":         "amazon-river",
  // Running expedition progression
  "comrades-ultra":     "utmb",
  "utmb":               "run-5-marathons",
  "run-5-marathons":    "run-jogle",
  "run-jogle":          "run-trans-america",
  // Cycling expedition progression
  "raid-pyrenees":      "tour-de-france",
  "tour-de-france":     "trans-am-bike",
  // Endurance training progression
};

// ── PhotoDB — IndexedDB wrapper for progress photos ───────────────────────
const PhotoDB = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("endur_photos", 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore("photos", { keyPath: "key" }); };
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = () => reject(req.error);
    });
  },
  async set(key, dataURL) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").put({ key, dataURL });
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readonly");
      const req = tx.objectStore("photos").get(key);
      req.onsuccess = () => resolve(req.result?.dataURL || null);
      req.onerror   = () => reject(req.error);
    });
  },
  async list(prefix) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readonly");
      const req = tx.objectStore("photos").getAll();
      req.onsuccess = () => resolve((req.result || []).filter(r => r.key.startsWith(prefix)).sort((a,b) => a.key.localeCompare(b.key)));
      req.onerror   = () => reject(req.error);
    });
  },
  async delete(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").delete(key);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  },
};

// ── State Management ───────────────────────────────────────────────────────

let state = loadState();
let activeTab = "today";
let challengeSubTab = "habits";
let activeChartTab = "weight";
let sheetOpen = false;
let todayChallengeId = "__all__";
let builderOpen = false;
let builderStep = "template";
let builderForm = defaultBuilderForm();
let viewChallengeId = null;
let editChallengeId = null;
let editForm = null;         // temp copy of edit fields so Cancel truly reverts
let settingsOpen = false;
let justCompletedId  = null;   // challenge shown in completion modal right now
let justCompletedIds = [];     // queue of IDs waiting to be shown after the current one
let _confirmDialog   = null;   // { msg, onConfirm } — replaces window.confirm()
let _promptDialog    = null;   // { msg, defaultVal, onConfirm } — replaces window.prompt()
let _cloudAuthError   = "";    // error message for cloud auth form (settings)
let _cloudAuthLoading = false; // loading spinner for cloud auth (settings)
let _shareModalChallenge = null;    // challenge shown in share card modal
let _shareModalDone      = false;   // true = challenge completion card, false = streak card
let _shareCardDataUrl    = null;    // cached base64 PNG of the last drawn share card
let _notifNudgeDismissed = false;   // dismissal flag for the Day-3 notification nudge
let builderQuizAnswers   = { goal: null, time: null, level: null };
let _badgeSheetQueue     = [];       // { label, desc, tier } — queued badge celebrations
let _notifPromptVisible  = false;   // post-challenge-start notification prompt
let _templateFilter      = "all";   // "all" | "short" | "medium" | "long"
let _difficultyFilter    = "all";   // "all" | "beginner" | "intermediate" | "advanced" | "extreme"
let _statsCollapsed      = null;    // kept for legacy reads — accordion removed
let _measChartTab        = null;    // active tab in the inline measurement chart
let _savedFlash          = false;   // brief "Saved ✓" indicator after habit tap
let _obAuthError      = "";    // error message for onboarding account screen
let _obAuthLoading    = false; // loading spinner for onboarding account screen
let _obAuthMode       = "signup"; // "signup" | "signin" on the account screen
let _cloudPushTimer   = null;  // debounce timer for cloud push
let _skipCloudPush    = false; // prevent redundant push after pull
let reminderTimeout = null;
let _pwaInstallPrompt = null;  // beforeinstallprompt event (PWA install)
let _showInstallBanner = false; // show the PWA install nudge
let _cloudSyncing     = false; // true while CloudSync.pull / .push is in flight
let _newWeekBanner = null;     // { pts } — Monday new-week ceremony, null when dismissed
let _levelUpOverlay = null;   // { level, name, emoji, total } — full-screen level-up celebration
let _chapterOverlay = null;   // level number (5/10/15/20/25) — shown once per chapter threshold
let _resetConfirm = false;    // shows inline confirm step before wiping all data
let _safetyPendingTemplateId = null; // templateId awaiting health disclaimer acknowledgement
let _obTransitioning = false; // true while slide animation is in flight
let _prevObStep = undefined;  // last rendered onboardingStep — transition only when this changes
let _lastSyncError = false;        // true when last cloud push failed
let _isOffline = false;            // true when navigator is offline
let _skipAccountAfterStart = false; // goal picker bypassed account creation step
let _forgotPwMode = false;         // forgot-password form is showing

// Inject CSS for features added at runtime
(function injectFeatureCSS() {
  if (document.getElementById("endur-feature-css")) return;
  const s = document.createElement("style");
  s.id = "endur-feature-css";
  s.textContent = `
.day-plan-banner{border-radius:12px;padding:12px 14px;margin:0 0 12px;display:flex;align-items:center;gap:12px;border-left:3px solid transparent}
.day-plan-banner.plan-easy{background:rgba(76,175,80,.12);border-color:#4caf50}
.day-plan-banner.plan-tempo{background:rgba(255,152,0,.12);border-color:#ff9800}
.day-plan-banner.plan-long{background:rgba(244,67,54,.12);border-color:#f44336}
.day-plan-banner.plan-interval{background:rgba(255,152,0,.12);border-color:#ff9800}
.day-plan-banner.plan-cross{background:rgba(33,150,243,.12);border-color:#2196f3}
.day-plan-banner.plan-rest{background:rgba(120,120,120,.08);border-color:rgba(120,120,120,.3)}
.day-plan-banner.plan-strength{background:rgba(255,152,0,.1);border-color:#e65100}
.day-plan-banner.plan-wod{background:rgba(244,67,54,.1);border-color:#b71c1c}
.day-plan-banner.plan-simulate{background:rgba(255,215,0,.12);border-color:#f9a825}
.dpb-emoji{font-size:22px;flex-shrink:0}
.dpb-type{font-size:14px;font-weight:700;color:var(--text)}
.dpb-desc{font-size:12px;color:var(--text-dim);margin-top:2px}
.mode-chip--scheduled-rest{border-color:rgba(76,175,80,.5)!important;color:#4caf50!important}
.template-filter-bar--diff{margin-top:6px}
.cloud-sync-bar--warn{background:rgba(234,179,8,.18);color:#92400e;animation:none;height:auto;padding:5px 14px;font-size:12px;text-align:center}
.cloud-sync-bar--err{background:rgba(220,38,38,.12);color:#dc2626;animation:none;height:auto;padding:5px 14px;font-size:12px;text-align:center}
.cloud-sync-bar--err button.link-btn{color:#dc2626;font-size:12px;text-decoration:underline}
.backfill-limit-hint{font-size:11px;color:var(--text-dim);text-align:center;padding:2px 0 6px;opacity:.8}
.badge-hint{font-size:11px;color:var(--text-dim);margin-top:3px;font-weight:400}
.ob-forgot-sent{background:rgba(76,175,80,.12);border:1px solid rgba(76,175,80,.35);border-radius:8px;padding:10px 12px;font-size:13px;color:#166534;margin-bottom:12px;text-align:center}
.badges-new-hint{font-size:13px;color:var(--text-dim);text-align:center;padding:10px 14px 6px;line-height:1.5}
.xp-mult-badge{font-size:11px;font-weight:600;color:#ef9f27;margin-left:4px}
.mood-note-card{background:var(--surface-2);border-radius:12px;padding:12px 14px;margin:0 0 12px}
.mood-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.mood-label{font-size:13px;color:var(--text-dim);font-weight:600}
.mood-emojis{display:flex;gap:4px}
.mood-btn{background:none;border:2px solid transparent;border-radius:8px;font-size:20px;padding:3px 5px;cursor:pointer;transition:border-color .15s,transform .1s;line-height:1}
.mood-btn:hover{border-color:var(--primary);transform:scale(1.15)}
.mood-selected{border-color:var(--primary)!important;background:var(--primary-haze);transform:scale(1.1)}
.day-note-input{width:100%;background:var(--surface-3);border:1px solid var(--track);border-radius:8px;padding:8px 10px;font-size:13px;color:var(--text);resize:none;outline:none;min-height:52px;font-family:inherit;line-height:1.4}
.day-note-input:focus{border-color:var(--primary)}
.day-note-input::placeholder{color:var(--text-faint)}
.tf-surprise{background:var(--surface-2);border:1px dashed var(--primary);color:var(--primary);font-size:13px}
.tf-surprise:hover{background:var(--primary-haze)}
.measurement-habit-card{flex-wrap:wrap;gap:8px 10px;padding:12px 14px}
.measurement-habit-card .habit-info{flex:1;min-width:0}
.measurement-habit-card .measurement-input-wrap{flex:0 0 100%;margin-left:0;justify-content:center}
.meas-chart-card{background:var(--surface-2);border-radius:12px;padding:12px 10px 10px;margin:0 0 12px}
.meas-chart-label{font-size:12px;font-weight:600;color:var(--text-dim);margin-bottom:8px}
.meas-chart-tabs{display:flex;gap:4px;margin-bottom:8px}
.meas-chart-tab{flex:1;background:var(--surface-3);border:none;color:var(--text-dim);font-size:12px;font-weight:600;padding:5px 0;border-radius:6px;cursor:pointer}
.meas-chart-tab.active{background:var(--primary);color:#fff}
.meas-chart-svg{width:100%;height:110px;display:block}
.meas-chart-delta{font-size:13px;font-weight:700;text-align:center;padding:4px 0 2px}
.meas-chart-delta.good{color:#4ade80}.meas-chart-delta.bad{color:#f87171}
.meas-chart-hint{font-size:11px;color:var(--text-faint);text-align:center}
`;
  document.head.appendChild(s);
})();

// ── Analytics helper (Plausible — graceful no-op if script not loaded) ───────
function trackEvent(name, props) {
  try {
    if (typeof window.plausible === "function") {
      window.plausible(name, props ? { props } : undefined);
    }
  } catch(e) { /* silent */ }
}

// ── Cloud Sync (Supabase) ──────────────────────────────────────────────────
const SUPABASE_URL = "https://rmyvpndnwpgrxosqrqff.supabase.co";
const SUPABASE_KEY = "sb_publishable_NEeo1fUgGclLFN6VGGhl6w_ROgAEQJg";
let _sbClient = null;
function _sb() {
  if (!_sbClient) _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sbClient;
}

const CloudSync = {
  _user: null,

  get token()     { return null; },
  get uid()       { return this._user?.id || null; },
  get userEmail() { return this._user?.email || null; },
  get isSignedIn(){ return !!this._user; },

  async init() {
    const { data: { session } } = await _sb().auth.getSession();
    this._user = session?.user || null;
    if (this._user) {
      onboardingStep = null;  // already has an account — skip onboarding
      await this.pull();       // restore cloud data before first paint
      render();
    }
    _sb().auth.onAuthStateChange((_, session) => {
      this._user = session?.user || null;
      render();
    });
  },

  async signUp(email, password) {
    const { data, error } = await _sb().auth.signUp({ email, password });
    if (error) return { error: error.message };
    this._user = data.user;
    if (data.session) {
      await this.push();
      return {};
    }
    // Email confirmation required — session is null until confirmed
    return { emailPending: true };
  },

  async signIn(email, password) {
    const { data, error } = await _sb().auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    this._user = data.user;
    await this.pull();
    return {};
  },

  signOut() {
    _sb().auth.signOut();
    this._user = null;
    render();
  },

  async push() {
    if (!this.isSignedIn) return;
    _cloudSyncing = true; render();
    try {
      const stateObj = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      await _sb().from("user_data").upsert({
        user_id: this.uid,
        state_json: stateObj,
        updated_at: new Date().toISOString(),
      });
      _lastSyncError = false;
    } catch(e) { console.warn("Cloud push failed:", e); _lastSyncError = true; }
    finally { _cloudSyncing = false; render(); }
  },

  async pull() {
    if (!this.isSignedIn) return;
    _cloudSyncing = true; render();
    try {
      const { data, error } = await _sb()
        .from("user_data")
        .select("state_json")
        .eq("user_id", this.uid)
        .single();
      if (error || !data?.state_json) { return; }
      const remote = data.state_json;
      if (!remote || typeof remote !== "object" || !("challenges" in remote)) return;
      // Day-level union merge — local logs are never overwritten by a staler cloud copy.
      const merged = mergeStates(state, normalizeState(remote));
      _skipCloudPush = true;
      state = merged;
      saveState();
      _skipCloudPush = false;
      showToast("Data synced from cloud.");
    } catch(e) { console.warn("Cloud pull failed:", e); _lastSyncError = true; }
    finally { _cloudSyncing = false; render(); }
  },
};
let onboardingStep = null;   // null = done, 0-3 = active step
let bodyHistoryLimit = 5;    // how many history rows to show in Body tab
let _lastViewKey   = "";       // for scroll-to-top on navigation changes
let _viewChanged   = false;    // true on the render immediately after a tab/view switch
let _animHabitId = null;     // habit that just got checked (for pop animation)
let _eventsBound = false;        // event listeners are added once — not re-added on every render
let viewingDate       = null;     // null = today; set to a past dateKey to backfill habits
let challengeDetailView = "weeks"; // "weeks" | "calendar"
let calendarViewMonth   = null;    // null = auto; or "YYYY-MM-DD" (first of month)

function defaultBuilderForm() {
  return {
    templateId: null,
    name: "",
    emoji: "🎯",
    startDate: todayKey(),
    endDate: addDays(todayKey(), 29),
    mode: "soft",
    weeklyGoal: 100,
    jokerBudget: 3,
    noEndDate: false,
    goalWeight: null,
    habits: [],
    newHabitEmoji: "⭐",
    newHabitName: "",
    newHabitPoints: 2,
    newHabitType: "binary",
    newHabitTiers: [
      { label: "", points: 1 },
      { label: "", points: 2 },
      { label: "", points: 3 },
    ],
    expeditionUnit: "km",
    expeditionDistance: 100,
    expeditionDuration: 30,
  };
}

function saveBuilderFormFromDOM() {
  const nameEl  = document.getElementById("bf-name");
  const startEl = document.getElementById("bf-start");
  const endEl   = document.getElementById("bf-end");
  const goalEl  = document.getElementById("bf-goal");
  const emojiEl = document.getElementById("bf-emoji");
  const ongoingEl    = document.getElementById("bf-ongoing");
  const goalWeightEl = document.getElementById("bf-goalweight");
  if (nameEl)                builderForm.name       = nameEl.value;
  if (startEl?.value)        builderForm.startDate  = startEl.value;
  if (ongoingEl)             builderForm.noEndDate  = ongoingEl.checked;
  if (endEl?.value && !builderForm.noEndDate) builderForm.endDate = endEl.value;
  if (goalEl)                builderForm.weeklyGoal = Number(goalEl.value) || builderForm.weeklyGoal;
  if (emojiEl?.value.trim()) builderForm.emoji      = emojiEl.value.trim();
  if (goalWeightEl?.value)   builderForm.goalWeight = parseFloat(goalWeightEl.value) || null;
  // Persist new-habit input fields so they survive re-render
  const nhName  = document.getElementById("nh-name");
  const nhEmoji = document.getElementById("nh-emoji");
  const nhPts   = document.getElementById("nh-pts");
  if (nhName)  builderForm.newHabitName  = nhName.value;
  if (nhEmoji) builderForm.newHabitEmoji = nhEmoji.value;
  if (nhPts)   builderForm.newHabitPoints = Number(nhPts.value) || builderForm.newHabitPoints;
  builderForm.newHabitTiers = builderForm.newHabitTiers.map((t, i) => ({
    ...t,
    label:  document.getElementById(`nh-tier-${i}-label`)?.value ?? t.label,
    points: Number(document.getElementById(`nh-tier-${i}-pts`)?.value)  || t.points,
  }));
}

function normalizeDay(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    mode:         raw.mode === "rest" ? "rest" : "standard", // minimum/boss → standard
    done:         Array.isArray(raw.done) ? raw.done : [],
    recovered:    raw.recovered    === true,
    pts:          typeof raw.pts === "number" ? raw.pts : 0,
    tiers:        (raw.tiers && typeof raw.tiers === "object") ? raw.tiers : {},
    distances:    (raw.distances && typeof raw.distances === "object") ? raw.distances : {},
    note:         typeof raw.note === "string" ? raw.note : "",
    freezeUsed:   raw.freezeUsed   === true,
    scheduledRest: raw.scheduledRest === true,
  };
}

function normalizeHabit(raw) {
  if (!raw || typeof raw !== "object") return null;
  const habit = {
    id:          typeof raw.id === "string" && raw.id ? raw.id : uid(),
    title:       typeof raw.title === "string" ? raw.title : "Task",
    emoji:       typeof raw.emoji === "string" ? raw.emoji : "⭐",
    quip:        typeof raw.quip  === "string" ? raw.quip  : "",
    type:        ["binary","tiered","distance","measurement"].includes(raw.type) ? raw.type : "binary",
    points:      typeof raw.points === "number" && raw.points >= 1 ? Math.round(raw.points) : 2,
  };
  if (typeof raw.unit     === "string") habit.unit     = raw.unit;
  if (typeof raw.decimals === "number") habit.decimals = raw.decimals;
  if (Array.isArray(raw.tiers))         habit.tiers    = raw.tiers;
  return habit;
}

function normalizeChallenge(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rawDays = (raw.days && typeof raw.days === "object") ? raw.days : {};
  const days = {};
  for (const [k, v] of Object.entries(rawDays)) days[k] = normalizeDay(v);
  // Back-fill habit fields (e.g. unit) that may be missing in older saved data
  const tpl = raw.templateId ? TEMPLATES.find(t => t.id === raw.templateId) : null;
  const habits = (Array.isArray(raw.habits) ? raw.habits.map(normalizeHabit).filter(Boolean) : [])
    .map(h => {
      if (!h.unit && tpl) {
        const tplH = tpl.habits?.find(th => th.id === h.id);
        if (tplH?.unit) h.unit = tplH.unit;
      }
      return h;
    });
  return {
    id:         raw.id || uid(),
    name:       raw.name || "My Challenge",
    emoji:      raw.emoji || "🎯",
    description:raw.description || "",
    templateId: raw.templateId || null,
    startDate:  raw.startDate || todayKey(),
    endDate:    raw.endDate   || addDays(todayKey(), 29),
    mode:       ["strict","soft"].includes(raw.mode) ? raw.mode : "soft",
    status:     ["active","completed","failed","paused"].includes(raw.status) ? raw.status : "active",
    weeklyGoal: typeof raw.weeklyGoal === "number" ? raw.weeklyGoal : 100,
    habits,
    days,
    badges:      Array.isArray(raw.badges) ? raw.badges : [],
    createdAt:   raw.createdAt || todayKey(),
    pausedOn:    raw.pausedOn    || null,
    pausedDays:  typeof raw.pausedDays === "number" ? raw.pausedDays : 0,
    finalStreak:              raw.finalStreak ?? null,
    totalPts:                 typeof raw.totalPts === "number" ? raw.totalPts : 0,
    streakFreezes:            typeof raw.streakFreezes === "number" ? raw.streakFreezes : 0,
    streakFreezeWeeksAwarded: Array.isArray(raw.streakFreezeWeeksAwarded) ? raw.streakFreezeWeeksAwarded : [],
    jokerBudget:              typeof raw.jokerBudget === "number" ? raw.jokerBudget : 3,
    flags:                    (raw.flags && typeof raw.flags === "object" && !Array.isArray(raw.flags)) ? raw.flags : {},
    noEndDate:                raw.noEndDate === true,
    pinned:                   raw.pinned === true,
    resumeReminderDate:       raw.resumeReminderDate || null,
    goalWeight:               raw.goalWeight ?? null,
    routeKm:                  typeof raw.routeKm === "number" ? raw.routeKm : null,
  };
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") raw = {};
  const rawC = (raw.challenges && typeof raw.challenges === "object") ? raw.challenges : {};
  const challenges = {};
  for (const [k, v] of Object.entries(rawC)) {
    const c = normalizeChallenge(v);
    if (c) challenges[k] = c;
  }
  const rawBT = raw.bodyTracking || {};
  return {
    settings: {
      name:            raw.settings?.name            || "",
      reminderEnabled: raw.settings?.reminderEnabled === true,
      reminderTime:    raw.settings?.reminderTime    || "20:00",
      journeyTheme:    "endur",
      units: {
        weight:        raw.settings?.units?.weight        || "lbs",
        distance:      raw.settings?.units?.distance      || "km",
        measurements:  raw.settings?.units?.measurements  || "cm",
      },
    },
    challenges,
    bodyTracking: {
      entries:      Array.isArray(rawBT.entries)   ? rawBT.entries : [],
      startWeight:  rawBT.startWeight  ?? null,
      goalWeight:   rawBT.goalWeight   ?? null,
      startBodyFat: rawBT.startBodyFat ?? null,
    },
    globalBadges: Array.isArray(raw.globalBadges) ? raw.globalBadges : [],
    weeklyRecapDismissed: (raw.weeklyRecapDismissed && typeof raw.weeklyRecapDismissed === "object") ? raw.weeklyRecapDismissed : {},
    migrations:      (raw.migrations && typeof raw.migrations === "object") ? raw.migrations : {},
    xp:              typeof raw.xp === "number" ? raw.xp : 0,
    lastChapterSeen: typeof raw.lastChapterSeen === "number" ? raw.lastChapterSeen : 0,
    lastModified:    typeof raw.lastModified === "number" ? raw.lastModified : 0,
  };
}

// ── Cloud merge ──────────────────────────────────────────────────────────────
// Sync philosophy: never lose an additive fact. Logs, badges, XP and weigh-ins
// only ever get added, so on conflict we union them. Only genuine preferences
// (settings, goal weights) use newest-wins, decided by `lastModified`.
function _union(a, b) {
  return Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]));
}
// A day's "richness" — more tasks logged wins, points break ties. Used so a
// real log can never be overwritten by a staler copy of the same day.
function _dayRichness(d) {
  const done = Array.isArray(d?.done) ? d.done.length : 0;
  const pts  = typeof d?.pts === "number" ? d.pts : 0;
  return done * 100000 + pts;
}
function mergeChallenge(localC, remoteC, localNewer) {
  // Scalar fields (name, emoji, goal, etc.): the newer state wins.
  const base = localNewer ? { ...remoteC, ...localC } : { ...localC, ...remoteC };
  // Days: union by date; on conflict keep the richer day.
  const days = {};
  const dates = new Set([...Object.keys(localC.days || {}), ...Object.keys(remoteC.days || {})]);
  for (const k of dates) {
    const ld = localC.days?.[k], rd = remoteC.days?.[k];
    if (ld && !rd)      days[k] = ld;
    else if (rd && !ld) days[k] = rd;
    else {
      const lr = _dayRichness(ld), rr = _dayRichness(rd);
      days[k] = lr > rr ? ld : rr > lr ? rd : (localNewer ? ld : rd);
    }
  }
  base.days   = days;
  base.badges = _union(localC.badges, remoteC.badges);
  base.streakFreezeWeeksAwarded = _union(localC.streakFreezeWeeksAwarded, remoteC.streakFreezeWeeksAwarded);
  // flags are set-once booleans — keep any that's true on either side.
  base.flags = localNewer ? { ...(remoteC.flags || {}), ...(localC.flags || {}) }
                          : { ...(localC.flags || {}), ...(remoteC.flags || {}) };
  // Completion is sticky — a finished challenge never reverts to active.
  if (localC.status === "completed" || remoteC.status === "completed") base.status = "completed";
  base.finalStreak = Math.max(localC.finalStreak ?? 0, remoteC.finalStreak ?? 0) || (localC.finalStreak ?? remoteC.finalStreak ?? null);
  let tp = 0; for (const d of Object.values(days)) tp += d.pts || 0;
  base.totalPts = tp;
  return base;
}
function mergeStates(local, remote) {
  const localNewer = (local.lastModified || 0) >= (remote.lastModified || 0);
  const prefer = localNewer ? local : remote;
  const challenges = {};
  const ids = new Set([...Object.keys(local.challenges || {}), ...Object.keys(remote.challenges || {})]);
  for (const id of ids) {
    const lc = local.challenges?.[id], rc = remote.challenges?.[id];
    if (lc && !rc)      challenges[id] = lc;
    else if (rc && !lc) challenges[id] = rc;
    else                challenges[id] = mergeChallenge(lc, rc, localNewer);
  }
  // Body-tracking entries: union by date, newer state wins on a same-date conflict.
  const btMap = {};
  const olderBT = localNewer ? remote.bodyTracking : local.bodyTracking;
  const newerBT = localNewer ? local.bodyTracking  : remote.bodyTracking;
  for (const e of (olderBT?.entries || [])) if (e?.date) btMap[e.date] = e;
  for (const e of (newerBT?.entries || [])) if (e?.date) btMap[e.date] = e;
  const bodyTracking = {
    entries:      Object.values(btMap).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    startWeight:  prefer.bodyTracking.startWeight,
    goalWeight:   prefer.bodyTracking.goalWeight,
    startBodyFat: prefer.bodyTracking.startBodyFat,
  };
  return normalizeState({
    settings:             prefer.settings,
    challenges,
    bodyTracking,
    globalBadges:         _union(local.globalBadges, remote.globalBadges),
    weeklyRecapDismissed: { ...(remote.weeklyRecapDismissed || {}), ...(local.weeklyRecapDismissed || {}) },
    migrations:           { ...(remote.migrations || {}), ...(local.migrations || {}) },
    xp:                   Math.max(local.xp || 0, remote.xp || 0),
    lastChapterSeen:      Math.max(local.lastChapterSeen || 0, remote.lastChapterSeen || 0),
    lastModified:         Math.max(local.lastModified || 0, remote.lastModified || 0),
  });
}

function loadState() {
  // Try new storage key first
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try { return normalizeState(JSON.parse(stored)); }
    catch(e) { console.warn("State parse failed", e); }
  }
  return normalizeState({});
}

function saveState() {
  // Recalculate total pts per challenge
  for (const c of Object.values(state.challenges)) {
    let total = 0;
    for (const d of Object.values(c.days)) total += d.pts || 0;
    c.totalPts = total;
  }
  // Stamp the edit time so cloud merge can tell which device's preferences are newer.
  if (!_skipCloudPush) state.lastModified = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch(e) {
    console.warn("saveState failed (storage quota?):", e);
    showToast("⚠️ Storage full — export a backup to avoid losing data.");
  }
  // Debounced cloud push — 5 s after last save so rapid taps don't spam
  if (!_skipCloudPush && CloudSync.isSignedIn) {
    clearTimeout(_cloudPushTimer);
    _cloudPushTimer = setTimeout(() => CloudSync.push(), 5000);
  }
}

// Push any pending change immediately — called when the app is backgrounded or
// closed, so a task logged before leaving still reaches the cloud.
function flushCloudPush() {
  if (_cloudPushTimer) { clearTimeout(_cloudPushTimer); _cloudPushTimer = null; }
  if (!_skipCloudPush && CloudSync.isSignedIn) CloudSync.push();
}

// ── Date Helpers ───────────────────────────────────────────────────────────

function todayKey() { return toKey(new Date()); }
function toKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function parseDate(k) { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); }
function addDays(key, n) { const d=parseDate(key); d.setDate(d.getDate()+n); return toKey(d); }
function diffDays(a, b) { return Math.round((parseDate(b)-parseDate(a))/86400000); }
function clamp(n,lo,hi) { return Math.max(lo,Math.min(hi,n)); }
function uid() { return Math.random().toString(36).slice(2,10); }
// Returns the scheduled workout entry for a given day of a challenge
// Returns null if the challenge template has no weekSchedule
function getDaySchedule(challenge, dateKey) {
  const tpl = challenge?.templateId ? TEMPLATES.find(t => t.id === challenge.templateId) : null;
  if (!tpl?.weekSchedule) return null;
  const dayNum = diffDays(challenge.startDate, dateKey) + 1; // 1-indexed
  const dayOfWeek = ((dayNum - 1) % 7) + 1;                  // 1–7 repeating
  return tpl.weekSchedule.find(s => s.day === dayOfWeek) || null;
}

// Returns the effective day number accounting for paused days
function challengeDayNumber(c, dateKey) {
  const d = dateKey || todayKey();
  const raw = diffDays(c.startDate, d) + 1 - (c.pausedDays || 0);
  if (c.noEndDate) return Math.max(1, raw);
  const totalDays = diffDays(c.startDate, c.endDate) + 1;
  return clamp(raw, 1, totalDays);
}

// ── Challenge Engine ───────────────────────────────────────────────────────

function getActiveChallenges() {
  const today = todayKey();
  return Object.values(state.challenges).filter(c =>
    c.status === "active" && c.startDate <= today && (c.noEndDate || c.endDate >= today)
  ).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

function getAllChallenges() {
  return Object.values(state.challenges).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}

function getChallenge(id) { return state.challenges[id] || null; }

function effectiveDate() { return viewingDate || todayKey(); }

function getChallengeDay(challenge, key = todayKey()) {
  if (!challenge.days[key]) {
    challenge.days[key] = { mode:"standard", done:[], recovered:false, pts:0, tiers:{}, distances:{} };
    saveState();
  }
  return challenge.days[key];
}

function activeHabits(challenge, day) {
  if (day.mode === "rest") return []; // Flex Day: no habits required
  return challenge.habits;            // standard: all habits active
}

function tierPoints(habit, tierValue) {
  if (!habit.tiers || tierValue == null) return 0;
  // Support both {value, points} (old format) and {label, pts} (new format)
  // Fall back to index-based lookup when t.value is undefined
  const tier = habit.tiers.find((t, i) => String(t.value ?? i) === String(tierValue));
  return tier ? (tier.points ?? tier.pts ?? 0) : 0;
}

function completionInfo(challenge, day) {
  // Flex Day: treat as 100% complete, 0 pts
  if (day.mode === "rest") return { done: 1, total: 1, percent: 100, points: 0, maxPoints: 0, multiplier: 1 };
  const active = activeHabits(challenge, day);
  const done = day.done.filter(id => active.some(h => h.id === id)).length;
  const total = active.length;
  const multiplier = day.streakMult ?? 1;
  // Comeback bonus: 1.5× on the first day back after 3+ missed days (flag set externally)
  const effectiveMult = day.comebackBonus ? Math.max(multiplier, 1.5) : multiplier;
  // Completion bonus fires for any challenge with 2+ habits
  const bonusAmt = total >= 2 ? 5 : 0;
  const completionBonus = (done === total && total > 0) ? bonusAmt : 0;
  // Perfect week bonus: +15 pts on day 7, 14, 21... of a consecutive perfect run (flag set externally)
  const weekBonus = (day.weeklyBonus && done === total && total > 0) ? 15 : 0;
  const basePoints = active.reduce((s, h) => {
    if (!day.done.includes(h.id)) return s;
    if (h.type === "tiered") return s + tierPoints(h, day.tiers?.[h.id]);
    return s + h.points;
  }, 0);
  const baseMax = active.reduce((s, h) => {
    if (h.type === "tiered" && h.tiers?.length) return s + Math.max(...h.tiers.map(t => t.points ?? t.pts ?? 0));
    return s + h.points;
  }, 0);
  const points    = Math.round((basePoints + completionBonus + weekBonus) * effectiveMult);
  const maxPoints = Math.round((baseMax + bonusAmt + (day.weeklyBonus ? 15 : 0)) * effectiveMult);
  return { done, total, percent: total ? Math.round((done/total)*100) : 0, points, maxPoints, multiplier };
}

function challengeTotalKm(challenge) {
  let total = 0;
  for (const day of Object.values(challenge.days)) {
    if (day.distances) {
      for (const km of Object.values(day.distances)) total += Number(km) || 0;
    }
  }
  return Math.round(total * 10) / 10;
}

function challengeRouteKm(c) {
  if (c.routeKm) return c.routeKm;
  const tpl = c.templateId ? TEMPLATES.find(t => t.id === c.templateId) : null;
  return tpl?.routeKm ?? null;
}

function updateDayPoints(challenge, day) {
  const info = completionInfo(challenge, day);
  day.pts = info.points;
}

function dayLogged(day) {
  return day && (day.done.length > 0 || day.recovered || day.mode === "rest" || day.freezeUsed);
}

function calcChallengeStreak(challenge) {
  let streak = 0;
  const today = todayKey();
  const d = parseDate(today);
  const todayDay = challenge.days[today];
  // If today not logged; start counting from yesterday
  if (!dayLogged(todayDay)) d.setDate(d.getDate()-1);
  const totalDays = challenge.noEndDate
    ? diffDays(challenge.startDate, todayKey()) + 1
    : diffDays(challenge.startDate, challenge.endDate) + 1;
  const softMode  = challenge.mode === "soft";
  let graceUsed   = false;
  for (let i = 0; i < totalDays; i++) {
    const k = toKey(d);
    if (k < challenge.startDate) break;
    const day = challenge.days[k];
    if (day?.mode === "rest") {
      // Flex Day is streak-neutral: skip without consuming grace, don't count toward streak
      d.setDate(d.getDate()-1);
    } else if (dayLogged(day)) {
      streak++;
      d.setDate(d.getDate()-1);
    } else if (softMode && !graceUsed) {
      // Soft mode: one grace day — skip but don't break the streak
      graceUsed = true;
      d.setDate(d.getDate()-1);
    } else {
      break;
    }
  }
  return streak;
}

function challengeWeeks(challenge) {
  const start  = parseDate(challenge.startDate);
  const rawEnd = parseDate(challenge.endDate);
  // Cap ongoing challenges at today so week list stays finite
  const today  = parseDate(todayKey());
  const end    = challenge.noEndDate && rawEnd > today ? today : rawEnd;
  const weeks  = [];
  const cursor = new Date(start);
  let   num    = 1;
  while (cursor <= end) {
    const wStart = new Date(cursor);
    const wEnd   = new Date(cursor); wEnd.setDate(wEnd.getDate()+6);
    const wCap   = wEnd < end ? wEnd : end;
    const allDays = [];
    const fd = new Date(wStart);
    while (fd <= wCap) { allDays.push(toKey(fd)); fd.setDate(fd.getDate()+1); }
    const today = todayKey();
    const days  = allDays.filter(k => k <= today);
    const label = formatDate(wStart,{month:"short",day:"numeric"}) + " – " + formatDate(wCap,{month:"short",day:"numeric"});
    weeks.push({ num, label, days, allDays });
    cursor.setDate(cursor.getDate()+7);
    num++;
  }
  return weeks;
}

// ── Win the Week: weekly distance sub-target + week streak ──────────────────
function getWeeklyProgress(c) {
  const dist = c.habits.find(h => h.type === "distance");
  const routeKm = dist ? challengeRouteKm(c) : null;
  if (!routeKm) return null;
  const totalDays = c.noEndDate ? null : diffDays(c.startDate, c.endDate) + 1;
  const weeks = challengeWeeks(c);
  const plannedWeeks = totalDays ? Math.max(1, Math.ceil(totalDays / 7)) : Math.max(1, weeks.length);
  const goalNative = routeKm / plannedWeeks;
  const kmFor = keys => keys.reduce((s, k) => {
    const d = c.days[k];
    return s + (d && d.distances ? Object.values(d.distances).reduce((a, v) => a + (Number(v) || 0), 0) : 0);
  }, 0);
  const today = todayKey();
  const curWeek = weeks.find(w => w.allDays.includes(today)) || weeks[weeks.length - 1];
  const curIdx = curWeek ? weeks.indexOf(curWeek) : -1;
  const thisWeekKm = curWeek ? kmFor(curWeek.allDays) : 0;
  let streak = 0;
  for (let i = curIdx - 1; i >= 0; i--) {
    if (kmFor(weeks[i].allDays) >= goalNative - 1e-6) streak++; else break;
  }
  const unit = unitLabelFor(dist.unit);
  const isFloors = dist.unit === "floors";
  const f = unit === "mi" ? 0.621371 : 1;
  const r = v => isFloors ? Math.round(v * f) : Math.round(v * f * 10) / 10;
  return {
    unit, streak, weekNum: curWeek ? curWeek.num : 1,
    goal: r(goalNative), done: r(thisWeekKm), toGo: r(Math.max(0, goalNative - thisWeekKm)),
    pct: Math.min(100, Math.round((thisWeekKm / goalNative) * 100)),
    won: thisWeekKm >= goalNative - 1e-6,
  };
}

function renderThisWeek(c) {
  const w = getWeeklyProgress(c);
  if (!w) return "";
  const metaBits = [
    w.won
      ? `<span class="tw-won"><i class="ti ti-check"></i> Weekly goal reached</span>`
      : `<span class="tw-togo">${w.toGo} ${w.unit} to reach this week's goal</span>`,
    w.streak > 0 ? `<span class="tw-streak"><i class="ti ti-flame"></i> ${w.streak}-week streak</span>` : "",
  ].filter(Boolean);
  return `
  <section class="this-week panel">
    <div class="tw-label">This week</div>
    <div class="tw-main">${w.done}<span class="tw-unit"> ${w.unit}</span><span class="tw-goal"> of ${w.goal} ${w.unit} goal</span></div>
    <div class="tw-track"><div class="tw-fill" style="width:${w.pct}%"></div></div>
    <div class="tw-meta">${metaBits.join(`<span class="tw-dot">·</span>`)}</div>
  </section>`;
}

function createChallenge(form) {
  const template = form.templateId ? TEMPLATES.find(t => t.id === form.templateId) : null;
  const habits = template ? JSON.parse(JSON.stringify(template.habits)) : JSON.parse(JSON.stringify(form.habits));
  const c = normalizeChallenge({
    id: uid(),
    name: form.name || (template ? template.name : "My Challenge"),
    emoji: form.emoji || (template ? template.emoji : "🎯"),
    description: template ? template.description : "",
    templateId: form.templateId || null,
    startDate: form.startDate,
    endDate: form.endDate,
    mode: form.mode,
    status: "active",
    weeklyGoal: form.weeklyGoal || (template ? template.weeklyGoal : 100),
    jokerBudget: template?.noRestDay ? 0 : (typeof form.jokerBudget === "number" ? form.jokerBudget : 3),
    noEndDate: form.noEndDate === true,
    goalWeight: form.goalWeight ?? null,
    routeKm: form.routeKm || template?.routeKm || null,
    habits,
    days: {},
    badges: [],
    createdAt: todayKey(),
  });
  state.challenges[c.id] = c;
  saveState();
  return c;
}

function updateChallengeStatuses() {
  const today = todayKey();
  let changed = false;
  for (const c of Object.values(state.challenges)) {
    const _rk = challengeRouteKm(c);
    const _targetHit = _rk && challengeTotalKm(c) >= _rk;
    if (c.status === "active" && ((!c.noEndDate && c.endDate < today) || _targetHit)) {
      c.finalStreak = calcChallengeStreak(c); // snapshot before status changes
      c.status = "completed";
      if (!c.completedAt) c.completedAt = new Date().toISOString();
      if (!c.flags) c.flags = {};
      if (!c.flags.completionBonusPaid) {
        const dur = Math.round((new Date(c.endDate) - new Date(c.startDate)) / 86400000);
        const bonus = COMPLETION_BONUS[dur] ?? (dur >= 180 ? 300 : dur >= 90 ? 150 : 75);
        state.xp = (state.xp || 0) + bonus;
        c.flags.completionBonusPaid = true;
        c.completionBonus = bonus;
      }
      if (!c.personalBest) {
        c.personalBest = {
          streak: c.finalStreak,
          perfectDays: Object.values(c.days).filter(d => {
            const i = completionInfo(c, d); return d.mode !== "rest" && i.percent >= 100 && i.total > 0;
          }).length,
          totalPts: c.totalPts,
          completedAt: c.completedAt,
        };
      }
      // Queue — show first one immediately, rest after user dismisses
      if (!justCompletedId) justCompletedId = c.id;
      else justCompletedIds.push(c.id);
      launchConfetti();
      changed = true;
    }
  }
  if (changed) saveState();
}

// ── Badge Checks ───────────────────────────────────────────────────────────

function checkBadges(challenge) {
  const today    = todayKey();
  const day      = getChallengeDay(challenge);
  const info     = completionInfo(challenge, day);
  const allDays  = Object.values(challenge.days);
  const streak   = calcChallengeStreak(challenge);
  const totalPts = allDays.reduce((s,d) => s+(d.pts||0), 0);
  const totalDays = diffDays(challenge.startDate, challenge.endDate) + 1;
  const dayNumber = challengeDayNumber(challenge);
  const pctDone   = Math.round((dayNumber / totalDays) * 100);
  const daysLogged = allDays.filter(d => dayLogged(d)).length;
  // Compute once — reused in completedWeeks (cCtx) and checkStreakFreezeAward
  const myWeeks  = challengeWeeks(challenge);

  // ── Habit-type detection (template-agnostic) ──────────────────────────────
  const _runIds     = challenge.habits.filter(h =>
    h.type==="tiered" && h.tiers?.some(t => Number(t.value)===1 && /\bkm\b/i.test(t.label))
  ).map(h=>h.id);
  const _soberIds   = challenge.habits.filter(h =>
    h.id==="noalcohol" || h.id==="noalc" || /alcohol/i.test(h.title)
  ).map(h=>h.id);
  const _coldIds    = challenge.habits.filter(h =>
    h.id==="ce-cold" || /cold shower/i.test(h.title)
  ).map(h=>h.id);
  const _coldBoss   = challenge.habits.filter(h =>
    h.id==="ce-full"
  ).map(h=>h.id);
  const _medIds     = challenge.habits.filter(h =>
    h.id==="med-sit" || /meditat/i.test(h.title)
  ).map(h=>h.id);
  const _liftIds    = challenge.habits.filter(h =>
    h.id==="st-lift" || /lift session/i.test(h.title)
  ).map(h=>h.id);
  const _prIds      = challenge.habits.filter(h =>
    h.id==="st-pr" || /personal record/i.test(h.title)
  ).map(h=>h.id);
  const _sleepIds   = challenge.habits.filter(h =>
    h.id==="sl-hours" || /\d\+.{0,8}sleep|sleep.{0,8}\d\+/i.test(h.title)
  ).map(h=>h.id);
  const _noSugarIds = challenge.habits.filter(h =>
    h.id==="ns-nosugar" || /no.{0,6}sugar|zero.{0,6}sugar/i.test(h.title)
  ).map(h=>h.id);
  const _morningIds = challenge.habits.filter(h =>
    h.id==="mr-wake" || /wake up|no snooze/i.test(h.title)
  ).map(h=>h.id);
  const _detoxIds   = challenge.habits.filter(h =>
    h.id==="dd-limit" || /social media|screen time/i.test(h.title)
  ).map(h=>h.id);
  const _fastingIds = challenge.habits.filter(h =>
    h.id==="if-fast" || /fast completed|\d{2}-hour fast/i.test(h.title)
  ).map(h=>h.id);
  const _coreIds    = challenge.habits.filter(h =>
    h.id==="ca-core" || /core workout|ab workout/i.test(h.title)
  ).map(h=>h.id);
  const _yogaIds    = challenge.habits.filter(h =>
    h.id==="yf-yoga" || /yoga session/i.test(h.title)
  ).map(h=>h.id);
  const _photoIds   = challenge.habits.filter(h =>
    h.id==="photo" || /progress\s*photo/i.test(h.title)
  ).map(h=>h.id);
  const _walkIds    = challenge.habits.filter(h =>
    h.id==="dw-dist" || h.id==="wk-dist"
  ).map(h=>h.id);
  const _cycleIds   = challenge.habits.filter(h =>
    h.id==="cy-ride"
  ).map(h=>h.id);

  // ── 1. Template-specific context ─────────────────────────────────────────
  const cCtx = {
    dayNumber, pctDone, streak, totalPts, daysLogged,
    complete:              info.done === info.total && info.total > 0,
    completedWeeks: (() => {
      return myWeeks.filter(w => {
        const lastDay = w.allDays[w.allDays.length-1];
        if (!lastDay || lastDay >= today) return false;
        return w.allDays.length > 0 && w.allDays.every(k => {
          const d = challenge.days[k]; return d && (d.done.length || d.recovered);
        });
      }).length;
    })(),
    runsLogged:            _runIds.length     ? allDays.filter(d=>_runIds.some(id=>d.done.includes(id))).length : 0,
    hasRun5k:              _runIds.length     ? allDays.some(d=>_runIds.some(id=>{ const v=d.tiers?.[id]; return v==="5+"||Number(v)>=5; })) : false,
    soberStreak:           _soberIds.length   ? Math.max(0,..._soberIds.map(id=>habitStreakCount(challenge,id))) : 0,
    coldShowersLogged:     _coldIds.length    ? allDays.filter(d=>_coldIds.some(id=>d.done.includes(id))).length : 0,
    coldShowerStreak:      _coldIds.length    ? Math.max(0,..._coldIds.map(id=>habitStreakCount(challenge,id))) : 0,
    hasColdPlunge:         _coldBoss.length   ? allDays.some(d=>_coldBoss.some(id=>d.done.includes(id))) : false,
    meditationLogged:      _medIds.length     ? allDays.filter(d=>_medIds.some(id=>d.done.includes(id))).length : 0,
    meditationStreak:      _medIds.length     ? Math.max(0,..._medIds.map(id=>habitStreakCount(challenge,id))) : 0,
    hasLifted:             _liftIds.length    ? allDays.some(d=>_liftIds.some(id=>d.done.includes(id))) : false,
    liftsLogged:           _liftIds.length    ? allDays.filter(d=>_liftIds.some(id=>d.done.includes(id))).length : 0,
    hasPR:                 _prIds.length      ? allDays.some(d=>_prIds.some(id=>d.done.includes(id))) : false,
    sleepHabitsLogged:     _sleepIds.length   ? allDays.filter(d=>_sleepIds.some(id=>d.done.includes(id))).length : 0,
    sleepStreak:           _sleepIds.length   ? Math.max(0,..._sleepIds.map(id=>habitStreakCount(challenge,id))) : 0,
    noSugarLogged:         _noSugarIds.length ? allDays.filter(d=>_noSugarIds.some(id=>d.done.includes(id))).length : 0,
    noSugarStreak:         _noSugarIds.length ? Math.max(0,..._noSugarIds.map(id=>habitStreakCount(challenge,id))) : 0,
    morningRoutineLogged:  _morningIds.length ? allDays.filter(d=>_morningIds.some(id=>d.done.includes(id))).length : 0,
    morningRoutineStreak:  _morningIds.length ? Math.max(0,..._morningIds.map(id=>habitStreakCount(challenge,id))) : 0,
    detoxLogged:           _detoxIds.length   ? allDays.filter(d=>_detoxIds.some(id=>d.done.includes(id))).length : 0,
    detoxStreak:           _detoxIds.length   ? Math.max(0,..._detoxIds.map(id=>habitStreakCount(challenge,id))) : 0,
    fastingLogged:         _fastingIds.length ? allDays.filter(d=>_fastingIds.some(id=>d.done.includes(id))).length : 0,
    fastingStreak:         _fastingIds.length ? Math.max(0,..._fastingIds.map(id=>habitStreakCount(challenge,id))) : 0,
    coreLogged:            _coreIds.length    ? allDays.filter(d=>_coreIds.some(id=>d.done.includes(id))).length : 0,
    yogaLogged:            _yogaIds.length    ? allDays.filter(d=>_yogaIds.some(id=>d.done.includes(id))).length : 0,
    yogaStreak:            _yogaIds.length    ? Math.max(0,..._yogaIds.map(id=>habitStreakCount(challenge,id))) : 0,
    photosLogged:          _photoIds.length   ? allDays.filter(d=>_photoIds.some(id=>d.done.includes(id))).length : 0,
    has6kmWalk:            _walkIds.length    ? allDays.some(d=>_walkIds.some(id=>{ const v=d.tiers?.[id]; return Number(v)>=6; })) : false,
    has50kmRide:           _cycleIds.length   ? allDays.some(d=>_cycleIds.some(id=>{ const v=d.tiers?.[id]; return Number(v)>=50; })) : false,
    has10kmWalk:           _walkIds.length    ? allDays.some(d=>_walkIds.some(id=>{ const v=d.tiers?.[id]; return Number(v)>=10; })) : false,
    totalKm:               challengeTotalKm(challenge),
  };

  // Check template-specific badges
  let earned = false;
  const tBadges = TEMPLATE_BADGES[challenge.templateId] || [];
  tBadges.forEach(b => {
    if (!challenge.badges.includes(b.id) && b.test(cCtx)) {
      challenge.badges.push(b.id);
      _badgeSheetQueue.push({ label: b.label, desc: b.desc || "", tier: TEMPLATE_TIERS[challenge.templateId] || "common" });
      earned = true;
      // Completion badge → finalise challenge status and queue the modal
      if (b.id.endsWith("-done") && challenge.status !== "completed") {
        challenge.finalStreak = calcChallengeStreak(challenge);
        challenge.status = "completed";
        if (!challenge.completedAt) challenge.completedAt = new Date().toISOString();
        if (!challenge.flags.completionBonusPaid) {
          const dur = Math.round((new Date(challenge.endDate) - new Date(challenge.startDate)) / 86400000);
          const bonus = COMPLETION_BONUS[dur] ?? (dur >= 180 ? 300 : dur >= 90 ? 150 : 75);
          state.xp = (state.xp || 0) + bonus;
          challenge.flags.completionBonusPaid = true;
          challenge.completionBonus = bonus;
        }
        if (!challenge.personalBest) {
          challenge.personalBest = {
            streak: challenge.finalStreak,
            perfectDays: Object.values(challenge.days).filter(d => {
              const i = completionInfo(challenge, d); return d.mode !== "rest" && i.percent >= 100 && i.total > 0;
            }).length,
            totalPts: challenge.totalPts,
            completedAt: challenge.completedAt,
          };
        }
        if (!justCompletedId) justCompletedId = challenge.id;
        else justCompletedIds.push(challenge.id);
        trackEvent("Challenge Completed", { challenge: challenge.name, days: challenge.duration });
        launchConfetti();
      }
    }
  });

  // ── 2. Universal context (best/totals across all challenges) ─────────────
  const allChallenges = Object.values(state.challenges);
  const allDaysAll    = allChallenges.flatMap(c => Object.values(c.days));
  const uCtx = {
    longestStreak: Math.max(0, ...allChallenges.map(c =>
      (c.status==="completed"||c.status==="failed") && c.finalStreak!=null
        ? c.finalStreak : calcChallengeStreak(c)
    )),
    totalPts: allChallenges.reduce((s,c) =>
      s + Object.values(c.days).reduce((ss,d) => ss+(d.pts||0), 0), 0
    ),
    weighIns:          state.bodyTracking.entries.length,
    weightLost: (() => {
      const sw = state.bodyTracking.startWeight;
      const e  = state.bodyTracking.entries;
      return (sw && e.length) ? Math.max(0, sw - e[e.length-1].weight) : 0;
    })(),
    weightGoalReached: (() => {
      const gw = state.bodyTracking.goalWeight;
      const e  = state.bodyTracking.entries;
      return !!(gw && e.length && e[e.length-1].weight <= gw);
    })(),
    anyRecovered:  allDaysAll.some(d => d.recovered),
    anyFirstDay: allChallenges.some(c => {
      const fd = c.days[c.startDate];
      if (!fd) return false;
      const fi = completionInfo(c, fd);
      return fi.percent === 100 && fi.total > 0;
    }),
    completedChallenges: allChallenges.filter(c => c.status==="completed").length,
    activeChallenges:    getActiveChallenges().length,
    hasPerfectWeek:      allChallenges.some(c => getPerfectRunLength(c, todayKey()) >= 7),
    expeditionDone:      allChallenges.some(c => c.status==="completed" && c.habits.some(h => h.type==="distance")),
    doubleAgent: (() => {
      const done = allChallenges.filter(c => c.status==="completed" && c.templateId);
      const seen = new Set();
      return done.some(c => { if (seen.has(c.templateId)) return true; seen.add(c.templateId); return false; });
    })(),
    darkHorse:    allChallenges.some(c => c.status==="completed" && Object.values(c.days).some(d => d.comebackBonus)),
    perfectMonth: allChallenges.some(c => getPerfectRunLength(c, todayKey()) >= 30),
  };

  UNIVERSAL_BADGES.forEach(b => {
    if (!state.globalBadges.includes(b.id) && b.test(uCtx)) {
      state.globalBadges.push(b.id);
      _badgeSheetQueue.push({ label: b.label, desc: b.desc || "", tier: "uncommon" });
      earned = true;
    }
  });

  // ── 3. Lifetime context (cumulative cross-challenge achievements) ─────────
  const pb = computePersonalBests();
  const lCtx = {
    totalHabitsLogged: pb.totalHabits,
    completedChallenges: allChallenges.filter(c => c.status==="completed").length,
    allCategoriesDone: (() => {
      const cats = new Set(
        allChallenges
          .filter(c => c.status==="completed" && c.templateId)
          .map(c => TEMPLATES.find(t => t.id===c.templateId)?.category)
          .filter(Boolean)
      );
      return ["movement","endurance","health","expedition"].every(cat => cats.has(cat));
    })(),
    perfectChallenge: allChallenges.filter(c => c.status==="completed").some(c => {
      const start = parseDate(c.startDate), end = parseDate(c.endDate);
      const cur = new Date(start);
      while (cur <= end) {
        const d = c.days[toKey(cur)];
        if (!d || !dayLogged(d)) return false;
        cur.setDate(cur.getDate()+1);
      }
      return true;
    }),
    freezeUsed: allChallenges.some(c => Object.values(c.days).some(d => d.freezeUsed)),
  };

  LIFETIME_BADGES.forEach(b => {
    if (!state.globalBadges.includes(b.id) && b.test(lCtx)) {
      state.globalBadges.push(b.id);
      _badgeSheetQueue.push({ label: b.label, desc: b.desc || "", tier: "rare" });
      earned = true;
    }
  });

  if (earned) saveState();
  checkStreakFreezeAward(challenge, myWeeks);
}

function checkStreakFreezeAward(challenge, weeks) {
  const today = todayKey();
  weeks = weeks || challengeWeeks(challenge);
  const curWeek = weeks.find(w => w.allDays.includes(today));
  if (!curWeek) return;
  const weekKey = curWeek.allDays[0]; // first day of week = unique ID
  if ((challenge.streakFreezeWeeksAwarded || []).includes(weekKey)) return; // already awarded this week
  const daysLogged = curWeek.days.filter(k => {
    const d = challenge.days[k]; return d && (d.done.length || d.recovered);
  }).length;
  if (daysLogged >= 5) {
    challenge.streakFreezes = (challenge.streakFreezes || 0) + 1;
    if (!challenge.streakFreezeWeeksAwarded) challenge.streakFreezeWeeksAwarded = [];
    const isFirst = challenge.streakFreezeWeeksAwarded.length === 0;
    challenge.streakFreezeWeeksAwarded.push(weekKey);
    showBigToast("ti-snowflake", "Streak freeze banked!", "5 days logged this week - you've earned a streak freeze.");
    if (isFirst) setTimeout(() => showToast("Streak Freeze: tap the snowflake bar on any day you miss to use it."), 3500);
    saveState();
  }
}
function habitStreakCount(challenge, habitId) {
  let n = 0;
  const d = parseDate(todayKey());
  const totalDays = diffDays(challenge.startDate, challenge.endDate)+1;
  for (let i=0;i<totalDays;i++) {
    const day = challenge.days[toKey(d)];
    if (!day || !day.done.includes(habitId)) break;
    n++;
    d.setDate(d.getDate()-1);
  }
  return n;
}

function lastNDays(n) {
  const d = parseDate(todayKey());
  return Array.from({length:n},()=>{ const k=toKey(d); d.setDate(d.getDate()-1); return k; });
}

// ── Confirm Modal (replaces window.confirm — works in standalone PWA) ─────

function showConfirm(msg, onConfirm) {
  _confirmDialog = { msg, onConfirm };
  render();
}

function showPrompt(msg, defaultVal, onConfirm) {
  _promptDialog = { msg, defaultVal: defaultVal ?? "", onConfirm };
  render();
}

function renderConfirmModal() {
  if (!_confirmDialog) return "";
  return `
  <div class="confirm-overlay" data-confirm-overlay>
    <div class="confirm-modal panel">
      <p class="confirm-msg">${esc(_confirmDialog.msg)}</p>
      <div class="confirm-btns">
        <button class="secondary-button" data-confirm-cancel>Cancel</button>
        <button class="pill-btn confirm-danger-btn" data-confirm-ok>Confirm</button>
      </div>
    </div>
  </div>`;
}

function renderPromptModal() {
  if (!_promptDialog) return "";
  return `
  <div class="confirm-overlay" data-prompt-overlay>
    <div class="confirm-modal panel">
      <p class="confirm-msg">${esc(_promptDialog.msg)}</p>
      <input class="prompt-input" id="prompt-input-field" type="number" min="1" max="365"
             value="${esc(String(_promptDialog.defaultVal))}" placeholder="days">
      <div class="confirm-btns">
        <button class="secondary-button" data-prompt-cancel>Skip</button>
        <button class="pill-btn" data-prompt-ok>Set reminder</button>
      </div>
    </div>
  </div>`;
}

// ── Launch UX ────────────────────────────────────────────────────────────

// Monday new-week ceremony
function checkNewWeekCeremony() {
  const today = todayKey();
  const d = new Date();
  if (d.getDay() !== 1) return; // only Monday
  if (localStorage.getItem("endur_newweek") === today) return; // already shown this Monday
  // Calculate last week's total points across all active/completed challenges
  let lastWeekPts = 0;
  Object.values(state.challenges).forEach(c => {
    for (let i = 1; i <= 7; i++) {
      const k = addDays(today, -i);
      lastWeekPts += (c.days?.[k]?.pts || 0);
    }
  });
  if (lastWeekPts > 0) {
    _newWeekBanner = { pts: lastWeekPts };
    localStorage.setItem("endur_newweek", today);
  }
}

// Floating +pts animation
function showPtsAnim(pts, rect) {
  if (!pts || pts <= 0) return;
  const el = document.createElement("div");
  el.className = "pts-anim";
  el.textContent = `+${pts} pts`;
  el.style.left = `${rect.left + rect.width * 0.72}px`;
  el.style.top  = `${rect.top + 12}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// Big toast for special moments (Day 1, halfway, etc.)
function showBigToast(emoji, title, sub, duration = 4000) {
  const existing = document.querySelector(".big-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "big-toast";
  const iconMarkup = String(emoji).startsWith("ti-") ? `<i class="ti ${emoji}"></i>` : emoji;
  el.innerHTML = `<span class="big-toast-emoji">${iconMarkup}</span><div class="big-toast-title">${title}</div><div class="big-toast-sub">${sub}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
function renderLevelUpOverlay() {
  const o = _levelUpOverlay;
  return `
  <div class="luo-backdrop" data-close-levelup>
    <div class="luo-card" role="dialog" aria-modal="true" aria-label="Level up!">
      <div class="luo-burst"><i class="ti ti-bolt"></i></div>
      <div class="luo-badge">LEVEL UP</div>
      <div class="luo-level">${o.level}</div>
      <div class="luo-name">${o.name}</div>
      <div class="luo-total">${o.total.toLocaleString()} XP total</div>
      <button class="primary-button luo-cta" data-close-levelup>Keep going →</button>
    </div>
  </div>`;
}

// Count consecutive missed days immediately before today for a challenge
function getConsecutiveMisses(challenge) {
  let count = 0;
  const today = todayKey();
  let cursor = addDays(today, -1);
  while (cursor >= challenge.startDate) {
    const day = challenge.days[cursor];
    if (day?.mode === "rest") break; // Flex Day is not a miss
    if (!day || !dayLogged(day)) count++;
    else break;
    cursor = addDays(cursor, -1);
  }
  return count;
}

// Count consecutive 100%-complete non-Flex Days ending at endKey
function getPerfectRunLength(challenge, endKey) {
  const dates = Object.keys(challenge.days).sort().filter(k => k <= endKey);
  let run = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = challenge.days[dates[i]];
    if (!d || d.mode === "rest" || d.freezeUsed) continue;
    const info = completionInfo(challenge, d);
    if (info.percent < 100 || info.total === 0) break;
    run++;
  }
  return run;
}

// Best week score across all weeks of a challenge
function challengePersonalBest(challenge) {
  const weeks = challengeWeeks(challenge);
  return weeks.reduce((best, week) => {
    const score = week.allDays.reduce((s, d) => s + (challenge.days[d]?.pts || 0), 0);
    return Math.max(best, score);
  }, 0);
}

// Check and fire one-time milestone celebrations
function checkMilestones(challenge) {
  if (!challenge.flags) challenge.flags = {};
  const totalDays = diffDays(challenge.startDate, challenge.endDate) + 1;
  const dayNumber = challengeDayNumber(challenge);
  const today = todayKey();
  const day = challenge.days[today];
  if (!day) return;
  const info = completionInfo(challenge, day);
  const streak = calcChallengeStreak(challenge);

  // Day 1 complete
  if (dayNumber === 1 && info.percent === 100 && !challenge.flags.day1done) {
    challenge.flags.day1done = true;
    setTimeout(() => {
      showBigToast("ti-check", "Day 1 done.", "Come back tomorrow. Your streak starts now.");
      if (_pwaInstallPrompt && !localStorage.getItem("endur_install_shown")) {
        setTimeout(() => { _showInstallBanner = true; render(); }, 3000);
      }
      if ("Notification" in window && Notification.permission === "default" && !localStorage.getItem("endur_notif_asked")) {
        localStorage.setItem("endur_notif_asked", "1");
        setTimeout(() => { _notifPromptVisible = true; render(); }, 2500);
      }
    }, 500);
  }
  // Halfway
  if (dayNumber >= Math.ceil(totalDays / 2) && info.percent === 100 && !challenge.flags.halfway) {
    challenge.flags.halfway = true;
    setTimeout(() => showBigToast("ti-target", "Halfway there.", "Most people quit here. You didn't."), 600);
  }
  // Streak milestones — fire only when the streak just hit that number today
  const STREAK_MILESTONES = [
    { n:7,  icon:"ti-flame", title:"7-day streak!", sub:"One week straight. Momentum is building." },
    { n:14, icon:"ti-barbell", title:"14 days!",       sub:"Two weeks. You're building something real." },
    { n:21, icon:"ti-bolt", title:"21-day streak!", sub:"Three weeks in. This is who you are now." },
    { n:30, icon:"ti-trophy", title:"30 days!",        sub:"One month. Elite 1% territory." },
    { n:50, icon:"ti-star", title:"50-day streak!", sub:"Fifty days of showing up. Unbelievable." },
    { n:75,  icon:"ti-crown", title:"75 days!",         sub:"The full distance. You are unstoppable." },
    { n:100, icon:"ti-diamond", title:"100-day streak!", sub:"Triple digits. You are an absolute legend." },
  ];
  for (const ms of STREAK_MILESTONES) {
    const flagKey = `streak${ms.n}`;
    if (streak === ms.n && info.percent === 100 && !challenge.flags[flagKey]) {
      challenge.flags[flagKey] = true;
      const { icon, title, sub } = ms;
      setTimeout(() => showBigToast(icon, title, sub), 700);
      break; // only one streak toast per toggle
    }
  }
  // Phase completion toasts (all phases except the last — challenge completion has its own moment)
  const phases = getChallengePhases(challenge);
  if (phases && info.percent === 100) {
    for (let i = 0; i < phases.length - 1; i++) {
      const flagKey = `phase${i + 1}done`;
      if (dayNumber === phases[i].end && !challenge.flags[flagKey]) {
        challenge.flags[flagKey] = true;
        const nextPhase = phases[i + 1];
        setTimeout(() => showBigToast("ti-mountain", `Phase ${i + 1} complete!`, `Up next: ${nextPhase.name}`), 800);
        break;
      }
    }
  }
}

function getChallengePhases(challenge) {
  const totalDays = diffDays(challenge.startDate, challenge.endDate) + 1;
  if (totalDays <= 30) return null;
  if (totalDays <= 60) {
    const mid = Math.round(totalDays / 2);
    return [
      { name: "Getting Started", start: 1,       end: mid },
      { name: "Making It Stick", start: mid + 1, end: totalDays },
    ];
  }
  if (totalDays <= 90) {
    const t = Math.round(totalDays / 3);
    return [
      { name: "Foundation", start: 1,           end: t },
      { name: "Rising",     start: t + 1,       end: t * 2 },
      { name: "The Ascent", start: t * 2 + 1,   end: totalDays },
    ];
  }
  const q = Math.round(totalDays / 4);
  return [
    { name: "Foundation",  start: 1,           end: q },
    { name: "Building",    start: q + 1,       end: q * 2 },
    { name: "The Climb",   start: q * 2 + 1,   end: q * 3 },
    { name: "Summit Push", start: q * 3 + 1,   end: totalDays },
  ];
}

function getChallengePhaseInfo(challenge, dayNumber) {
  const phases = getChallengePhases(challenge);
  if (!phases) return null;
  for (let i = 0; i < phases.length; i++) {
    if (dayNumber <= phases[i].end) {
      return { phase: phases[i], phaseIndex: i + 1, totalPhases: phases.length };
    }
  }
  return { phase: phases[phases.length - 1], phaseIndex: phases.length, totalPhases: phases.length };
}

// ── Render Core ────────────────────────────────────────────────────────────

function applyTheme() {
  document.documentElement.setAttribute("data-theme", "endur");
  setDynamicIcon();
}

function render() {
  try {
    _renderInner();
  } catch (err) {
    console.error("Render error:", err);
    const app = document.getElementById("app");
    if (app) app.innerHTML = `<div style="padding:32px 20px;text-align:center;color:var(--text)">
      <div style="font-size:40px;margin-bottom:12px">⚠️</div>
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">Something went wrong</div>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:20px">A display error occurred. Your data is safe.</div>
      <button class="primary-button" onclick="window.location.reload()" style="margin:0 auto;max-width:200px">Reload app</button>
    </div>`;
  }
}
function _renderInner() {
  applyTheme();
  const app = document.getElementById("app");
  // Full-screen onboarding — render only the onboarding screen
  if (onboardingStep !== null) {
    const stepChanged = onboardingStep !== _prevObStep;
    _prevObStep = onboardingStep;
    app.innerHTML = renderOnboarding();
    if (stepChanged) {
      const scr = app.querySelector(".ob-screen");
      if (scr) scr.classList.add("ob-entering");
    }
    if (!_eventsBound) { bindEvents(); _eventsBound = true; }
    return;
  }
  // Scroll to top when the primary view changes (not for modals/sheet)
  const viewKey = `${activeTab}|${builderOpen}|${settingsOpen}|${viewChallengeId}|${editChallengeId}`;
  _viewChanged = (viewKey !== _lastViewKey && !justCompletedId);
  if (_viewChanged) {
    window.scrollTo(0, 0);
    _lastViewKey = viewKey;
  }
  let html = renderTopbar();
  if (builderOpen) {
    html += renderBuilder();
  } else if (settingsOpen) {
    html += renderSettings();
  } else if (editChallengeId) {
    html += renderEditChallenge(getChallenge(editChallengeId));
  } else if (viewChallengeId) {
    html += renderChallengeDetail(getChallenge(viewChallengeId));
  } else {
    html += activeTab === "today"      ? renderToday()      : "";
    html += activeTab === "challenges" ? renderChallenges() : "";

    html += activeTab === "badges"     ? renderBadges()     : "";
  }
  html += renderNav();
  if (justCompletedId) {
    const _cc = getChallenge(justCompletedId);
    if (_cc) html += renderCompletionModal(_cc);
  }
  html += renderShareModal();
  if (_badgeSheetQueue.length > 0) html += renderBadgeSheet(_badgeSheetQueue[0]);
  if (_levelUpOverlay) html += renderLevelUpOverlay();
  // Chapter milestone check (show once per threshold, guarded by state.lastChapterSeen)
  if (!_chapterOverlay && !_levelUpOverlay) {
    const _curLevel = getLevelInfo(state.xp).level;
    const _chapterDue = [5, 10, 15, 20, 25].find(l => l <= _curLevel && l > (state.lastChapterSeen ?? 0));
    if (_chapterDue) { _chapterOverlay = _chapterDue; state.lastChapterSeen = _chapterDue; saveState(); }
  }
  if (_chapterOverlay) html += renderChapterOverlay();
  if (_notifPromptVisible) html += renderNotifPrompt();
  html += renderConfirmModal();
  html += renderPromptModal();
  if (_safetyPendingTemplateId) html += renderSafetyModal();
  if (_showInstallBanner && _pwaInstallPrompt && !localStorage.getItem("endur_install_shown")) {
    html += `
    <div class="install-banner">
      <span style="font-size:28px">📲</span>
      <div class="install-banner-text">
        <strong>Add Endur to your Home Screen</strong>
        <span>Works offline. Opens like a native app.</span>
      </div>
      <button class="install-banner-btn" data-install-accept>Install</button>
      <button class="install-banner-dismiss" data-install-dismiss aria-label="Dismiss">×</button>
    </div>`;
  }
  app.innerHTML = html;
  if (!_eventsBound) { bindEvents(); _eventsBound = true; }
  requestAnimationFrame(() => {
    updateRingVisuals();
    _animHabitId = null;
    // Load progress photos into challenge detail strip (runs after every render so it works after navigation)
    const ppStrip = document.querySelector('[id^="pp-strip-"]');
    if (ppStrip && !ppStrip.dataset.loaded) {
      ppStrip.dataset.loaded = "1";
      const cid = ppStrip.id.replace("pp-strip-", "");
      PhotoDB.list(cid + "_").then(photos => {
        if (!photos.length) {
          ppStrip.innerHTML = `<p class="pp-empty">No photos yet — tap the camera on the progress photo task to capture one.</p>`;
        } else {
          ppStrip.innerHTML = `<div class="pp-grid">${
            photos.slice(-9).reverse().map(p => {
              const dateStr = p.key.split("_")[1] || "";
              const label = dateStr ? formatDate(parseDate(dateStr), {month:"short", day:"numeric"}) : dateStr;
              return `<div class="pp-item">
                <img src="${p.dataURL}" class="pp-img" alt="Progress ${label}">
                <div class="pp-date">${label}</div>
                <button class="pp-delete" data-delete-photo="${esc(p.key)}" title="Delete photo" aria-label="Delete photo">🗑</button>
              </div>`;
            }).join("")
          }</div><p class="pp-count">${photos.length} photo${photos.length===1?"":"s"}</p>`;
        }
      }).catch(() => { ppStrip.innerHTML = ""; });
    }
  });
}

function renderTopbar() {
  const showShare = activeTab === "today" && !builderOpen && !settingsOpen && !viewChallengeId && !editChallengeId && todayChallengeId !== "__all__" && getActiveChallenges().length > 0;
  return `
  ${_isOffline ? `<div class="cloud-sync-bar cloud-sync-bar--warn" role="status" aria-live="polite">Offline — will sync when reconnected</div>` : ""}
  ${_lastSyncError && !_isOffline ? `<div class="cloud-sync-bar cloud-sync-bar--err" role="alert">⚠ Sync failed — <button class="link-btn" data-retry-sync>retry</button></div>` : ""}
  ${_cloudSyncing ? `<div class="cloud-sync-bar" role="progressbar" aria-label="Syncing…"></div>` : ""}
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 36 36" width="30" height="30">
          <defs>
            <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style="stop-color:var(--primary)"/>
              <stop offset="100%" style="stop-color:var(--secondary)"/>
            </linearGradient>
          </defs>
          <rect width="36" height="36" rx="8" fill="#000"/>
          <circle cx="18" cy="18" r="13" fill="none" stroke="#111" stroke-width="2.5"/>
          <circle cx="18" cy="18" r="13" fill="none" stroke="url(#bm-g)" stroke-width="2.5"
            stroke-linecap="round" stroke-dasharray="61 20" transform="rotate(-90 18 18)"/>
          <text x="18" y="18" text-anchor="middle" dominant-baseline="central"
            font-family="'Lato',system-ui,sans-serif" font-weight="900" font-size="15" fill="var(--accent)">E</text>
        </svg>
      </span>
      <span>Endur</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <div class="date-chip">${formatDate(parseDate(todayKey()),{weekday:"short",month:"short",day:"numeric"})}</div>
      ${showShare ? `<button class="icon-btn" data-share-progress aria-label="Share progress">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
      </button>` : ""}
      <button class="icon-btn" data-open-settings aria-label="Settings">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>
  </header>`;
}

const NAV_ICONS = {
  today:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  challenges: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  body:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
  badges:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`,
};

function renderNav() {
  const tabs = [["today","Today"],["challenges","Challenges"],["badges","Badges"]];
  return `
  <nav class="bottom-nav" aria-label="Endur sections">
    ${tabs.map(([id,label]) => `
      <button class="nav-button ${activeTab===id&&!builderOpen&&!settingsOpen&&!viewChallengeId&&!editChallengeId?"active":""}" data-tab="${id}">
        ${NAV_ICONS[id]}${label}
      </button>`).join("")}
  </nav>`;
}

// ── Today Tab ─────────────────────────────────────────────────────────────

function renderToday() {
  const active = getActiveChallenges();
  if (!active.length) return renderNoChallenge();

  // Auto-select first challenge if none selected or selection invalid (but keep __all__)
  if (!todayChallengeId || (todayChallengeId !== "__all__" && !active.find(c => c.id === todayChallengeId))) {
    todayChallengeId = active[0].id;
  }

  // Unified all-challenges view
  if (todayChallengeId === "__all__") return renderTodayAll(active);
  const challenge = active.find(c => c.id === todayChallengeId);
  const today    = todayKey();
  const effDate  = effectiveDate();
  // Clamp viewingDate within challenge bounds and no further back than 3 days
  const minBack  = addDays(today, -3);
  const minDate  = challenge.startDate > minBack ? challenge.startDate : minBack;
  if (viewingDate && viewingDate < minDate) viewingDate = minDate;
  if (viewingDate && viewingDate > today)  viewingDate = null;
  const isToday  = effDate === today;

  const day  = getChallengeDay(challenge, effDate);
  const info = completionInfo(challenge, day);
  const totalDays  = challenge.noEndDate ? null : diffDays(challenge.startDate, challenge.endDate)+1;
  const dayNumber  = challengeDayNumber(challenge, effDate);
  const daysLeft   = challenge.noEndDate ? null : Math.max(0, diffDays(today, challenge.endDate));
  const journeyPct = totalDays ? clamp(Math.round((dayNumber/totalDays)*100), 0, 100) : null;
  const streak     = calcChallengeStreak(challenge);
  const phaseInfo  = getChallengePhaseInfo(challenge, dayNumber);

  const canGoBack  = addDays(effDate, -1) >= minDate;
  const canGoFwd   = !isToday;

  // Comeback: consecutive missed days before today
  const missedStreak = isToday ? getConsecutiveMisses(challenge) : 0;
  const xpInfo  = getLevelInfo(state.xp);
  const xpTheme = JOURNEY_THEMES[state.settings.journeyTheme] || JOURNEY_THEMES.endur;
  const xpToNext = xpInfo.next ? (xpInfo.next.xp - state.xp).toLocaleString() : null;

  return `
  <main${_viewChanged ? ` class="tab-fade-in"` : ""}>
    <div class="xp-mini-bar">
      <span class="xmb-badge"><i class="ti ti-bolt"></i> Lv.${xpInfo.level}</span>
      <span class="xmb-name">${xpInfo.name}</span>
      <span class="xmb-track"><span class="xmb-fill" style="width:${xpInfo.pct}%"></span></span>
      <span class="xmb-hint">${xpToNext ? xpToNext + " XP to next · XP never resets" : `<i class="ti ti-trophy"></i> Max Level`}</span>
    </div>
    ${active.length > 1 ? renderChallengePills(active) : ""}
    ${renderWeeklyRecap(challenge)}
    ${_newWeekBanner ? `
    <div class="new-week-banner${_viewChanged ? " new-week-banner--anim" : ""}">
      <h3><i class="ti ti-calendar-week"></i> New week. Clean slate.</h3>
      <p>Last week: <strong>${_newWeekBanner.pts} pts</strong>. Come back stronger.</p>
      <button class="new-week-dismiss" data-dismiss-newweek aria-label="Dismiss">×</button>
    </div>` : ""}
    ${missedStreak >= 2 ? `
    <div class="comeback-banner${_viewChanged ? " comeback-banner--anim" : ""}">
      <strong>Welcome back.</strong> ${missedStreak} days missed — that's okay. <span class="cb-alive">Your challenge is still running.</span> Today still counts.
    </div>` : missedStreak === 1 ? `
    <div class="comeback-banner comeback-banner--soft${_viewChanged ? " comeback-banner--anim" : ""}">
      Streak paused at ${streak} days. Come back today to restart. <span class="cb-alive">Your challenge is still running.</span>
    </div>` : ""}
    <div class="date-nav">
      <button class="date-nav-arrow ${canGoBack?"":"disabled"}" data-date-back ${canGoBack?"":"disabled"} aria-label="Previous day" ${!canGoBack ? 'title="Only the last 3 days can be logged"' : ""}>‹</button>
      <div class="date-nav-center">
        <span class="date-nav-label ${!isToday?"date-nav-past":""}">
          ${isToday ? "Today" : formatDate(parseDate(effDate), {weekday:"short", month:"short", day:"numeric"})}
        </span>
        ${isToday && canGoBack ? `<span class="date-nav-hint">‹ tap to log a past day</span>` : ""}
      </div>
      <button class="date-nav-arrow ${canGoFwd?"":"disabled"}" data-date-fwd ${canGoFwd?"":"disabled"} aria-label="Next day">›</button>
    </div>
    ${!canGoBack && minDate === addDays(today, -3) && challenge.startDate < minDate ? `<div class="backfill-limit-hint">Logging is limited to the last 3 days</div>` : ""}
    ${!isToday ? `<div class="backfill-banner">✏️ Editing ${formatDate(parseDate(effDate),{weekday:"long"})} — changes save immediately.</div>` : ""}
    <section class="hero">
      <div class="hero-daycount">Day ${dayNumber}${totalDays ? ` / ${totalDays}` : ""}</div>
      <div class="hero-titlebar">
        ${(() => { const tp = challenge.templateId ? TEMPLATES.find(t=>t.id===challenge.templateId) : null; return `<i class="ti ${tp?challengeIcon(tp):"ti-target"} hero-ic" aria-hidden="true"></i>`; })()}
        <h1 class="hero-name">${esc(challenge.name)}</h1>
      </div>
      ${(() => {
        const dh = challenge.habits.find(h => h.type === "distance");
        const ck = dh ? challengeRouteKm(challenge) : null;
        const barPct = (dh && ck) ? Math.min(100, Math.round(challengeTotalKm(challenge)/ck*100)) : journeyPct;
        return barPct !== null ? `<div class="journey-track"><div class="journey-fill" style="width:${barPct}%"></div></div>` : "";
      })()}
      <div class="hero-stats">
        ${(() => {
          const dh = challenge.habits.find(h => h.type === "distance");
          const ck = dh ? challengeRouteKm(challenge) : null;
          if (dh && ck) {
            const totNative = challengeTotalKm(challenge), u = unitLabelFor(dh.unit);
            const isFl = dh.unit === "floors", f = u === "mi" ? 0.621371 : 1;
            const r = v => isFl ? Math.round(v * f) : Math.round(v * f * 10) / 10;
            const pct = Math.min(100, Math.round(totNative/ck*100));
            const tot = r(totNative), rem = r(Math.max(0, ck-totNative));
            return `<span>${pct}%</span><span class="hero-stat-dot">·</span><span>${tot} ${u} banked</span><span class="hero-stat-dot">·</span><span>${rem} ${u} to go</span><span class="hero-stat-dot">·</span>`;
          }
          return journeyPct !== null ? `<span>${journeyPct}%</span><span class="hero-stat-dot">·</span>` : "";
        })()}
        <span>${challenge.noEndDate ? "Ongoing" : daysLeft > 0 ? daysLeft+" days left" : "Final day"}</span>
        ${phaseInfo ? `<span class="hero-stat-dot">·</span><span>${esc(phaseInfo.phase.name)}</span>` : ""}
        ${isToday ? `<button class="link-btn hero-settings-link" data-view-challenge="${challenge.id}">Edit</button>` : ""}
      </div>
      ${isToday ? `<div class="greeting">${currentGreeting(challenge, dayNumber, streak)}</div>` : ""}
      ${isToday && !challenge.habits.some(h => h.type === "distance") ? renderModeSelector(day, challenge) : ""}
    </section>
    ${phaseInfo && isToday && dayNumber === phaseInfo.phase.end && dayNumber > 1 ? `
    <div class="boss-day-callout"><div class="boss-day-callout-icon"><i class="ti ti-bolt"></i></div><div class="boss-day-callout-body"><div class="boss-day-callout-title">Phase Finale</div><div class="boss-day-callout-sub">Last day of <strong>${phaseInfo.phase.name}</strong> — finish strong.</div></div></div>` : ""}

    ${(() => {
      const sched = getDaySchedule(challenge, effDate);
      if (!sched) return "";
      const typeClass = { easy:"plan-easy", tempo:"plan-tempo", long:"plan-long", interval:"plan-interval", cross:"plan-cross", rest:"plan-rest", strength:"plan-strength", wod:"plan-wod", simulate:"plan-simulate", combo:"plan-interval" }[sched.type] || "plan-easy";
      return `<div class="day-plan-banner ${typeClass}">
        <span class="dpb-emoji"><i class="ti ${scheduleIcon(sched.type)}"></i></span>
        <div>
          <div class="dpb-type">Today's Plan: ${sched.label}</div>
          <div class="dpb-desc">${sched.desc}</div>
        </div>
      </div>`;
    })()}

    ${(() => {
      const tpl = challenge.templateId ? TEMPLATES.find(t=>t.id===challenge.templateId) : null;
      const isDist = challenge.habits.some(h => h.type === "distance");
      const stage = `<section class="today-stage panel">${renderRing(info, day, streak, challenge)}${isToday ? renderStreakFreezeUI(challenge) : ""}${renderCompleteBanner(day, info, challenge, dayNumber, totalDays, isToday)}</section>`;
      const logSection = `<section>
      <div class="section-head">${isDist
        ? `<div class="section-label" style="margin:0">Distance</div>`
        : `<div class="section-label" style="margin:0">Tasks</div>
           <div style="font-size:12px;font-weight:500;color:var(--text-dim)">${_savedFlash ? `<span class="saved-flash">Saved ✓</span>` : dayNumber === 1 && info.done === 0 ? "Tap to log your first day →" : `${info.done} / ${info.total}`}</div>`}</div>
      <div class="habit-list">${challenge.habits.map(h => renderHabit(h, day, challenge)).join("")}</div>
    </section>`;
      const map = challengeRouteKm(challenge) ? renderRouteProgress(challenge, tpl) : "";
      const extras = `${renderChallengeMetricChart(challenge)}${isToday ? renderAlmostThereBadge(challenge, streak) : ""}`;
      const nudge = (() => {
        if (!isToday) return "";
        if (shouldShowBackupNudge(challenge)) return renderBackupNudge(challenge);
        if (dayNumber >= 3 && !_notifNudgeDismissed && ("Notification" in window) && Notification.permission === "default") {
          return `<div class="notif-nudge" data-notif-nudge>
            <span class="notif-nudge-icon"><i class="ti ti-bell"></i></span>
            <span class="notif-nudge-text">Never miss a day — <button class="notif-nudge-link" data-request-notif-permission>enable reminders</button></span>
            <button class="notif-nudge-close" data-dismiss-notif-nudge aria-label="Dismiss">×</button>
          </div>`;
        }
        return "";
      })();
      const thisWeek = isDist ? renderThisWeek(challenge) : "";
      return isDist
        ? thisWeek + logSection + map + extras + nudge
        : stage + logSection + extras + nudge + map;
    })()}
  </main>`;
}

function renderTodayAll(active) {
  const effDate = effectiveDate();
  const today = todayKey();
  const isToday = effDate === today;
  let totalDone = 0, totalHabits = 0;
  for (const c of active) {
    const day = c.days[effDate] || normalizeDay({});
    const info = completionInfo(c, day);
    totalDone += info.done;
    totalHabits += info.total;
  }
  const allPct = totalHabits ? Math.round((totalDone / totalHabits) * 100) : 0;
  return `
  <main${_viewChanged ? ` class="tab-fade-in"` : ""}>
    ${renderChallengePills(active)}
    ${isToday ? renderXPBar() : ""}
    <div class="all-today-banner">
      <div class="atb-title"><i class="ti ti-list-check"></i> All Active Challenges</div>
      <div class="atb-stats">${totalDone} / ${totalHabits} tasks done today · ${allPct}%</div>
    </div>
    ${active.map(c => renderChallengeCard(c)).join("")}
    ${allPct === 100 ? `
    <div class="all-done-today">
      <div class="all-done-today-icon"><i class="ti ti-trophy"></i></div>
      <div class="all-done-today-title">All done today.</div>
      <div class="all-done-today-sub">Every task logged. Rest up — tomorrow we go again.</div>
    </div>` : ""}
  </main>`;
}
function renderChallengePills(active) {
  const today = todayKey();
  const showAll = active.length > 1;
  return `
  <div class="challenge-pills">
    ${showAll ? `<button class="c-pill ${todayChallengeId==="__all__"?"active":""}" data-today-challenge="__all__">All <span class="c-pill-pct">${active.length}</span></button>` : ""}
    ${active.map(c => {
      const tpl = c.templateId ? TEMPLATES.find(t=>t.id===c.templateId) : null;
      const totalDays  = diffDays(c.startDate, c.endDate) + 1;
      const dayNum     = challengeDayNumber(c);
      const journeyPct = clamp(Math.round((dayNum / totalDays) * 100), 0, 100);
      const todayD     = c.days[today];
      const todayInfo  = completionInfo(c, todayD || normalizeDay({}));
      const todayDot   = todayInfo.percent === 100 ? `<i class="ti ti-check c-pill-state"></i>` : todayInfo.percent > 0 ? `<i class="ti ti-point-filled c-pill-state"></i>` : "";
      const isExp      = c.habits.some(h => h.type === "distance");
      const distPct    = isExp && challengeRouteKm(c)
        ? Math.min(100, Math.round((challengeTotalKm(c) / challengeRouteKm(c)) * 100))
        : null;
      const pctStr     = isExp && distPct !== null
        ? `DIST ${distPct}% · TIME ${journeyPct}%`
        : `${journeyPct}%`;
      return `<button class="c-pill ${c.id===todayChallengeId?"active":""}" data-today-challenge="${c.id}">
        ${todayDot}<i class="ti ${tpl?challengeIcon(tpl):"ti-target"} c-pill-icon"></i> ${esc(c.name)} <span class="c-pill-pct">${pctStr}</span>
      </button>`;
    }).join("")}
  </div>`;
}
function renderNoChallenge() {
  const today = todayKey();
  const hasPast = Object.values(state.challenges).some(c => c.status !== "active");
  const upcoming = Object.values(state.challenges).filter(c => c.status === "active" && c.startDate > today);
  const isFirstTime = !hasPast && !upcoming.length;
  const iconForChallenge = c => c.templateId ? challengeIcon(TEMPLATES.find(t=>t.id===c.templateId) || {id:"",category:""}) : "ti-target";
  return `
  <main class="welcome-shell">
    <div class="welcome-logo">
      <svg viewBox="0 0 120 120" width="80" height="80">
        <rect width="120" height="120" rx="28" fill="#000"/>
        <circle cx="60" cy="60" r="46" fill="none" stroke="#111" stroke-width="8"/>
        <circle cx="60" cy="60" r="46" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="216 72" transform="rotate(-90 60 60)"/>
        <text x="60" y="60" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-weight="600" font-size="56" fill="var(--accent)">E</text>
      </svg>
    </div>
    <h1 class="welcome-title">Endur</h1>
    <p class="welcome-sub">${upcoming.length ? "Your next challenge starts soon." : hasPast ? "All challenges complete. Start a new one." : "Pick a challenge. Show up. Win."}</p>

    ${isFirstTime ? `
    <p class="welcome-desc">Take on any challenge in 21-86 days. Log daily, earn streaks and badges, and watch yourself change.</p>
    <div class="welcome-features">
      <div class="wf-item"><span class="wf-icon"><i class="ti ti-route"></i></span><span class="wf-text">55+ challenges, from daily walks to the Pacific Crest Trail and beyond</span></div>
      <div class="wf-item"><span class="wf-icon"><i class="ti ti-bed"></i></span><span class="wf-text">Self-paced by design. Scale the work, pause when needed, and keep the chain honest.</span></div>
      <div class="wf-item"><span class="wf-icon"><i class="ti ti-award"></i></span><span class="wf-text">Streaks, badges, streak freezes, and weekly recaps that keep you honest</span></div>
      <div class="wf-item"><span class="wf-icon"><i class="ti ti-device-mobile"></i></span><span class="wf-text">Works offline. No ads. Your data stays on your device.</span></div>
    </div>` : ""}

    ${upcoming.length ? `
    <div style="width:100%;max-width:320px;margin:0 auto 16px">
      ${upcoming.map(c=>`
      <button class="challenge-card" data-view-challenge="${c.id}" style="text-align:left;width:100%">
        <div class="cc-top">
          <div class="cc-emoji"><i class="ti ${iconForChallenge(c)}"></i></div>
          <div class="cc-info">
            <div class="cc-name">${c.name}</div>
            <div class="cc-meta">Starts ${c.startDate} · ${diffDays(today, c.startDate)} day${diffDays(today,c.startDate)===1?"":"s"} away</div>
          </div>
          <div class="cc-right"><div class="cc-status" style="color:var(--text-dim)">upcoming</div></div>
        </div>
      </button>`).join("")}
    </div>` : ""}
    <button class="primary-button" style="max-width:280px;margin:0 auto" data-open-builder>
      ${hasPast || upcoming.length ? "Start New Challenge" : "Start Your First Challenge"}
    </button>
    ${isFirstTime && !CloudSync.isSignedIn ? `
    <div class="device-only-nudge">
      <span class="don-icon"><i class="ti ti-device-floppy"></i></span>
      <div>Your data lives on this device only. <button class="link-btn" data-open-settings>Create a free account</button> to back it up.</div>
    </div>` : ""}
    ${isFirstTime ? `<p class="welcome-hint">No ads. No tracking. Just you and the challenge.</p>` : ""}
  </main>`;
}

function renderRing(info, day, streak, challenge) {
  const challengePts  = challenge ? (challenge.totalPts || 0) : 0;
  const gracePip      = challenge && graceUsedYesterday(challenge);
  const isExpedition  = challenge?.habits.some(h => h.type === "distance");
  const todayKmRaw    = isExpedition ? Object.values(day.distances || {}).reduce((s,v) => s + (Number(v)||0), 0) : null;
  const totalKmNative = isExpedition ? challengeTotalKm(challenge) : null;
  const routeKm       = isExpedition ? challengeRouteKm(challenge) : null;
  // Unit conversion for ring display
  const ringDistHabit = isExpedition ? challenge.habits.find(h => h.type === "distance") : null;
  const ringIsFloors  = ringDistHabit?.unit === "floors";
  const ringDUnit     = unitLabelFor(ringDistHabit?.unit);
  const ringFactor    = ringDUnit === "mi" ? 0.621371 : 1;
  const todayKmD      = todayKmRaw !== null ? Math.round(todayKmRaw * ringFactor * 100) / 100 : null;
  const totalKmD      = totalKmNative !== null ? Math.round(totalKmNative * ringFactor * 10) / 10 : null;
  const isPerfect = !isExpedition && day.mode !== "rest" && info.percent >= 100;
  return `
  <div class="ring-wrap ${day.mode==="rest"?"rest":""}${isPerfect?" perfect":""}">
    <svg class="progress-ring" viewBox="0 0 220 220" aria-hidden="true">
      <defs>
        <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style="stop-color:var(--primary)"/>
          <stop offset="100%" style="stop-color:var(--secondary)"/>
        </linearGradient>
        <linearGradient id="nav-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style="stop-color:var(--primary)"/>
          <stop offset="100%" style="stop-color:var(--secondary)"/>
        </linearGradient>
      </defs>
      <circle class="ring-track" cx="110" cy="110" r="90"/>
      <circle class="ring-value ${day.mode==="rest"?"rest-mode":""}" cx="110" cy="110" r="90" data-percent="${info.percent}"/>
    </svg>
    <div class="ring-center">
      ${day.mode === "rest"
        ? `<div class="percent percent-icon"><i class="ti ti-bed"></i></div><div class="ring-pts" style="font-size:11px;color:var(--text-dim)">Flex Day</div>`
        : isExpedition
          ? `<div class="percent" style="font-size:${todayKmD > 0 ? "1.6rem" : "2rem"}">${todayKmD > 0 ? todayKmD.toFixed(ringIsFloors?0:1) : "—"}</div><div class="ring-pts" style="font-size:11px;color:var(--text-dim)">${todayKmD > 0 ? ringDUnit+" today" : "log "+ringDUnit}</div>`
          : `<div class="percent">${info.percent}%</div><div class="ring-pts">${info.points}<span class="ring-pts-max">/${info.maxPoints}</span><span class="ring-pts-label"> pts</span></div>`
      }
    </div>
  </div>
  <div class="ring-stats">
    ${isExpedition ? `
    <div class="ring-stat">
      <div class="ring-stat-value">${totalKmD !== null ? totalKmD.toFixed(ringIsFloors?0:1) : "0"}<span class="ring-stat-sub"> ${ringDUnit}</span></div>
      <div class="ring-stat-label">total distance</div>
    </div>
    <div class="ring-stat-sep"></div>
    <div class="ring-stat">
      <div class="ring-stat-value">${routeKm ? Math.min(100,Math.round((totalKmNative/routeKm)*100)) : "—"}<span class="ring-stat-sub">${routeKm ? "%" : ""}</span></div>
      <div class="ring-stat-label">route done</div>
    </div>` : `
    <div class="ring-stat">
      <div class="ring-stat-value">${info.done}<span class="ring-stat-sub">/${info.total}</span></div>
      <div class="ring-stat-label">tasks</div>
    </div>
    <div class="ring-stat-sep"></div>
    <div class="ring-stat">
      <div class="ring-stat-value">${challengePts}</div>
      <div class="ring-stat-label">points</div>
    </div>`}
  </div>
  ${isPerfect ? `<div class="perfect-day-chip"><i class="ti ti-check"></i> PERFECT DAY</div>` : ""}
  ${day.comebackBonus ? `<div class="perfect-day-chip comeback-chip"><i class="ti ti-refresh"></i> COMEBACK DAY</div>` : ""}`;
}

function renderStreakFreezeUI(challenge) {
  const freezes = challenge.streakFreezes || 0;
  const yesterday = addDays(todayKey(), -1);
  const yDay = challenge.days[yesterday];
  const yesterdayUnlogged = yesterday >= challenge.startDate && yDay && !dayLogged(yDay) && yDay.mode !== "rest";
  if (freezes === 0) return "";
  return `
  <div class="freeze-bar">
    <span class="freeze-bar-label"><i class="ti ti-snowflake"></i> ${freezes} streak freeze${freezes > 1 ? "s" : ""}</span>
    ${yesterdayUnlogged
      ? `<button class="pill-btn" data-use-freeze>Protect streak</button>`
      : `<span class="freeze-bar-hint">Ready if you miss a day</span>`}
  </div>`;
}

function renderModeSelector(day, challenge) {
  const template        = challenge?.templateId ? TEMPLATES.find(t => t.id === challenge.templateId) : null;
  const noRestDay       = !!(template?.noRestDay);
  const schedule        = getDaySchedule(challenge, effectiveDate());
  const isScheduledRest = schedule?.type === "rest";
  const jokerBudget     = challenge?.jokerBudget ?? 3;
  const todayIsRest     = day.mode === "rest";
  // Only count user-chosen Flex Days (not scheduled ones) against the joker budget
  const jokersUsed      = Object.values(challenge?.days || {}).filter(d => d.mode === "rest" && !d.scheduledRest).length;
  const budgetExhausted = !todayIsRest && !isScheduledRest && jokersUsed >= jokerBudget;
  const jokersLeft      = Math.max(0, jokerBudget - jokersUsed);

  if (noRestDay) {
    return `<div class="mode-chip-row"><button class="mode-chip mode-chip--active" data-mode="rest" title="This challenge is self-paced. Scale or pause when needed."><i class="ti ti-target"></i> Standard Day <span class="mode-chip-no-rest">· no Flex Days</span></button></div>`;
  }
  if (isScheduledRest) {
    const restLabel = todayIsRest ? "Scheduled Rest · active" : "Scheduled Rest · free";
    return `
  <div class="mode-chip-row">
    <button class="mode-chip ${!todayIsRest ? "mode-chip--active" : ""}" data-mode="standard"><i class="ti ti-run"></i> Work out anyway</button>
    <button class="mode-chip mode-chip--rest ${todayIsRest ? "mode-chip--rest-active" : "mode-chip--scheduled-rest"}" data-mode="rest"><i class="ti ti-bed"></i> ${restLabel}</button>
  </div>`;
  }
  const restLabel = todayIsRest
    ? "Flex Day · active"
    : budgetExhausted
      ? `Flex Day · none left`
      : `Flex Day · ${jokersLeft} flex ${jokersLeft === 1 ? "day" : "days"} left`;
  const restDisabled = budgetExhausted ? "mode-chip--disabled" : "";
  const activeChip   = todayIsRest ? "mode-chip--rest-active" : "mode-chip--active";
  return `
  <div class="mode-chip-row">
    <button class="mode-chip ${!todayIsRest ? activeChip : ""}" data-mode="standard"><i class="ti ti-target"></i> Standard</button>
    <button class="mode-chip mode-chip--rest ${todayIsRest ? "mode-chip--rest-active" : ""} ${restDisabled}" data-mode="rest" ${budgetExhausted ? 'aria-disabled="true"' : ""}><i class="ti ti-bed"></i> ${restLabel}</button>
  </div>`;
}
function renderHabit(habit, day, challenge) {
  if (habit.type === "tiered")      return renderTieredHabit(habit, day, challenge);
  if (habit.type === "distance")    return renderDistanceHabit(habit, day, challenge);
  if (habit.type === "measurement") return renderMeasurementHabit(habit, day);
  const locked  = day.mode==="rest";
  const checked = day.done.includes(habit.id);
  const popping = _animHabitId === habit.id;
  // Photo habits get a camera capture button alongside the checkbox
  const isPhoto = !locked && (habit.id === "photo" || /progress\s*photo/i.test(habit.title));
  if (isPhoto) {
    return `
  <div class="habit-card photo-habit-card ${checked?"checked":""} ${popping?"habit-pop":""}">
    <span class="accent"></span>
    <span class="habit-emoji"><i class="ti ti-square"></i></span>
    <span class="habit-info">
      <span class="habit-title">${esc(habit.title)}</span>
      <span class="habit-quip">${checked ? "Photo logged" : esc(habit.quip)}</span>
    </span>
    <div class="photo-habit-actions">
      <button class="camera-btn" data-capture-photo="${habit.id}" aria-label="Take progress photo"><i class="ti ti-camera"></i></button>
      <button class="check-circle ${checked?"":"check-hollow"}" data-habit="${habit.id}" aria-label="Mark done">${checked?"✓":""}</button>
    </div>
  </div>`;
  }
  return `
  <button class="habit-card ${checked?"checked":""} ${locked?"locked":""} ${popping?"habit-pop":""}" data-habit="${habit.id}" ${locked?`aria-disabled="true"`:""}>
    <span class="accent"></span>
    <span class="habit-emoji">${locked?`<i class="ti ti-lock"></i>`:`<i class="ti ti-square"></i>`}</span>
    <span class="habit-info">
      <span class="habit-title">${esc(habit.title)}</span>
      <span class="habit-quip">${locked?"Flex Day — recover well.":esc(habit.quip)}</span>
    </span>
    <span class="check-circle">${checked?"✓":""}</span>
  </button>`;
}

function renderTieredHabit(habit, day, challenge) {
  const locked  = day.mode==="rest";
  const checked = day.done.includes(habit.id);
  const selVal  = day.tiers?.[habit.id] ?? null;
  if (locked) return `
  <div class="habit-card locked" aria-disabled="true">
    <span class="accent"></span>
    <span class="habit-emoji"><i class="ti ti-lock"></i></span>
    <span class="habit-info">
      <span class="habit-title">${esc(habit.title)}</span>
      <span class="habit-quip">Flex Day — recover well.</span>
    </span>
    <span class="check-circle"></span>
  </div>`;
  const popping = _animHabitId === habit.id;
  return `
  <div class="habit-card run-habit ${checked?"checked":""} ${popping?"habit-pop":""}">
    <span class="accent"></span>
    <span class="habit-emoji"><i class="ti ti-square"></i></span>
    <div class="run-body">
      <span class="habit-title">${esc(habit.title)}</span>
      <div class="run-distances">
        ${habit.tiers.map((t, i) => { const tv = t.value ?? i; return `<button class="run-dist ${String(selVal)===String(tv)?"active":""}" data-tier="${habit.id}" data-tier-val="${tv}">${t.label}</button>`; }).join("")}
      </div>
      ${!checked ? `<span class="tier-hint">Tap to log</span>` : ""}
    </div>
    <span class="check-circle">${checked && selVal != null ? (tierPoints(habit,selVal)+"pts") : checked ? "✓" : ""}</span>
  </div>`;
}

function unitLabelFor(u) {
  if (u === "floors") return "floors";
  if (u === "hours") return "hrs";
  return (state.settings.units.distance === "miles") ? "mi" : "km";
}

function renderDistanceHabit(habit, day, challenge) {
  const locked    = day.mode === "rest";
  const storedVal = day.distances?.[habit.id] ?? 0; // always in habit's native unit
  const habitUnit = habit.unit || "km";
  const isFloors  = habitUnit === "floors";
  // For km-type habits: respect the global distance unit setting
  const MI_PER_KM  = 0.621371;
  const KM_PER_MI  = 1.60934;
  const globalDist = state.settings.units.distance || "km";
  const displayUnit = unitLabelFor(habitUnit);
  // Convert stored km → display unit for input value
  const displayVal = isFloors ? Math.round(storedVal) :
    (displayUnit === "mi" ? Math.round(storedVal * MI_PER_KM * 100) / 100 : storedVal);

  const cRouteKm  = challenge ? challengeRouteKm(challenge) : null;
  const totalNative  = cRouteKm ? challengeTotalKm(challenge) : 0;
  // Convert totals to display units for quip text
  const totalDisplay = isFloors ? totalNative :
    (displayUnit === "mi" ? Math.round(totalNative * MI_PER_KM * 10) / 10 : totalNative);
  const routeDisplay = cRouteKm
    ? (isFloors ? cRouteKm : (displayUnit === "mi" ? Math.round(cRouteKm * MI_PER_KM * 10) / 10 : cRouteKm))
    : null;
  const remaining = routeDisplay !== null ? Math.max(0, routeDisplay - totalDisplay) : null;

  if (locked) return `
  <div class="habit-card locked" aria-disabled="true">
    <span class="accent"></span>
    <span class="habit-emoji"><i class="ti ti-lock"></i></span>
    <span class="habit-info">
      <span class="habit-title">${esc(habit.title)}</span>
      <span class="habit-quip">Flex Day — recover well.</span>
    </span>
    <span class="check-circle"></span>
  </div>`;
  const checked = day.done.includes(habit.id);
  const quip = checked
    ? `${displayVal} ${displayUnit} logged`
    : remaining !== null && remaining === 0
      ? `${isFloors ? "Summit" : "Route"} complete!`
      : remaining !== null
        ? `${remaining.toFixed(1)} ${displayUnit} left`
        : esc(habit.quip);
  return `
  <div class="habit-card distance-habit-card ${checked?"checked":""}">
    <span class="accent"></span>
    <span class="habit-emoji"><i class="ti ti-square"></i></span>
    <div class="habit-info">
      <span class="habit-title">${esc(habit.title)}</span>
      <span class="habit-quip">${quip}</span>
    </div>
    <div class="distance-input-wrap">
      <input type="number" class="distance-input" data-distance-habit="${habit.id}"
        value="${displayVal > 0 ? displayVal : ""}" min="0" max="99999"
        step="${isFloors ? "1" : "0.1"}" placeholder="0"
        inputmode="decimal" aria-label="Distance in ${displayUnit}">
      ${isFloors
        ? `<span class="distance-unit">floors</span>`
        : habitUnit === "hours" ? `<span class="distance-unit">hrs</span>`
        : `<select class="dist-unit-sel" data-dist-unit-sel="${habit.id}" aria-label="Unit">
             <option value="km" ${displayUnit==="km"?"selected":""}>km</option>
             <option value="mi" ${displayUnit==="mi"?"selected":""}>mi</option>
           </select>`}
    </div>
    ${isFloors ? `<div class="floor-steppers">
      <button class="floor-step-btn" data-floor-step="${habit.id}" data-step="1">+1</button>
      <button class="floor-step-btn" data-floor-step="${habit.id}" data-step="5">+5</button>
      <button class="floor-step-btn" data-floor-step="${habit.id}" data-step="10">+10</button>
    </div>` : ""}
  </div>`;
}

function renderMeasurementHabit(habit, day) {
  const locked   = day.mode === "rest";
  const rawUnit  = habit.unit || "";
  // "weight" is a sentinel — resolve to the user's weight unit setting
  const unit     = rawUnit === "weight" ? (state.settings.units.weight || "kg") : rawUnit;
  const decimals = typeof habit.decimals === "number" ? habit.decimals : 1;
  const stored   = day.distances?.[habit.id] ?? 0;

  if (locked) return `
  <div class="habit-card locked" aria-disabled="true">
    <span class="accent"></span>
    <span class="habit-emoji"><i class="ti ti-lock"></i></span>
    <span class="habit-info">
      <span class="habit-title">${esc(habit.title)}</span>
      <span class="habit-quip">Flex Day — recover well.</span>
    </span>
    <span class="check-circle"></span>
  </div>`;

  const checked = day.done.includes(habit.id);
  const refRange = UNIT_RANGES[unit] || null;
  const quip = checked
    ? `${stored.toFixed(decimals)} ${unit} logged`
    : refRange ? refRange : esc(habit.quip);

  return `
  <div class="habit-card measurement-habit-card ${checked?"checked":""}">
    <span class="accent"></span>
    <span class="habit-emoji"><i class="ti ti-square"></i></span>
    <div class="habit-info">
      <span class="habit-title">${esc(habit.title)}</span>
      <span class="habit-quip">${quip}</span>
    </div>
    <div class="measurement-input-wrap">
      <input type="number" class="measurement-input" data-measurement-habit="${habit.id}"
        value="${stored > 0 ? stored.toFixed(decimals) : ""}" min="0" max="99999"
        step="${decimals === 0 ? "1" : "0.1"}" placeholder="—"
        inputmode="decimal" aria-label="${esc(habit.title)} in ${unit}">
      <span class="measurement-unit">${esc(unit)}</span>
    </div>
  </div>`;
}

function renderRouteProgress(challenge, template) {
  const totalNative = challengeTotalKm(challenge); // always in native units (km or floors)
  const routeNative = template?.routeKm ?? challenge.routeKm;
  const distHabit   = challenge.habits.find(h => h.type === "distance");
  const habitUnit   = distHabit?.unit || "km";
  const isFloors    = habitUnit === "floors";
  const MI_PER_KM   = 0.621371;
  const globalDist  = state.settings.units.distance || "km";
  const displayUnit = unitLabelFor(habitUnit);
  const factor      = (displayUnit === "mi") ? MI_PER_KM : 1;
  const totalDisplay = Math.round(totalNative * factor * 10) / 10;
  const routeDisplay = Math.round(routeNative * factor * 10) / 10;
  const pct      = Math.min(100, Math.round((totalNative / routeNative) * 100));
  const remaining = Math.max(0, routeDisplay - totalDisplay);
  const milestones = template?.milestones ?? [];
  const reached = [...milestones].reverse().find(m => totalNative >= m.km);
  const next    = milestones.find(m => totalNative < m.km);
  const daysLeftR  = challenge.noEndDate ? null : Math.max(0, diffDays(todayKey(), challenge.endDate));
  const needPerDay = (daysLeftR && remaining > 0) ? Math.ceil((remaining / daysLeftR) * 10) / 10 : null;
  const markers = milestones.map(m => {
    const mPct = Math.round((m.km / routeNative) * 100);
    const done  = totalNative >= m.km;
    const mDisplay = Math.round(m.km * factor * 10) / 10;
    return `<div class="route-milestone-dot ${done?"done":""}" style="left:${mPct}%" title="${m.name} (${mDisplay} ${displayUnit})"></div>`;
  }).join("");
  const routeMap = template?.routeGeo ? (() => {
    const W=320, H=170, PAD=18;
    const pts = template.routeGeo.map(p => [PAD + p[0]*(W-2*PAD), PAD + p[1]*(H-2*PAD)]);
    const seg=[], cum=[0];
    for (let i=0;i<pts.length-1;i++){ const s=Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]); seg.push(s); cum.push(cum[i]+s); }
    const totLen = cum[cum.length-1] || 1;
    const at = t => { let d=Math.max(0,Math.min(1,t))*totLen; for(let i=0;i<seg.length;i++){ if(d<=cum[i+1]||i===seg.length-1){ const f=seg[i]?(d-cum[i])/seg[i]:0; return [pts[i][0]+(pts[i+1][0]-pts[i][0])*f, pts[i][1]+(pts[i+1][1]-pts[i][1])*f]; } } return pts[pts.length-1]; };
    const dPath = "M " + pts.map(p=>`${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ");
    const prog = Math.min(1, totalNative/routeNative);
    const dots = milestones.map(m => { const [x,y]=at(Math.min(1,m.km/routeNative)); const done=totalNative>=m.km; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${done?'var(--accent)':'#3a3a3e'}" stroke="var(--bg)" stroke-width="1.5"/>`; }).join("");
    const [sx,sy]=pts[0], [mx,my]=at(prog);
    return `<svg class="route-map" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Route progress map">
      <path d="${dPath}" fill="none" stroke="#2a2a2e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${dPath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${(prog*totLen).toFixed(1)} ${totLen.toFixed(1)}"/>
      ${dots}
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.5" fill="var(--text-dim)"/>
      <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="6" fill="var(--accent)" stroke="var(--bg)" stroke-width="2.5"/>
    </svg>`;
  })() : `<div class="route-progress-track"><div class="route-progress-fill" style="width:${pct}%"></div>${markers}</div>`;
  return `
  <section class="route-progress-section panel">
    <div class="route-progress-header">
      <span class="route-progress-name"><i class="ti ${template?challengeIcon(template):"ti-map-2"}"></i> ${template?.name ?? challenge.name}</span>
      <span class="route-progress-km">${isFloors ? Math.round(totalDisplay) : totalDisplay.toFixed(1)} <span style="font-weight:500;color:var(--text-dim)">/ ${isFloors ? Math.round(routeDisplay).toLocaleString() : routeDisplay.toLocaleString()} ${displayUnit}</span> <span style="color:var(--accent)">· ${pct}%</span></span>
    </div>
    ${routeMap}
    <div class="route-pace">
      ${remaining > 0
        ? `${isFloors ? Math.round(remaining) : remaining.toFixed(1)} ${displayUnit} remaining${next ? ` · next: ${next.name}` : ""}${needPerDay ? ` · ${needPerDay} ${displayUnit}/day to finish` : ""}`
         : `${isFloors ? "Summit reached" : "Route complete"}. You conquered ${template.name}.`}
    </div>
    ${reached && totalNative > 0 ? `
    <div class="route-milestone-banner">
      <span class="rmb-emoji"><i class="ti ti-flag"></i></span>
      <div>
        <div class="rmb-title">${reached.name}</div>
        <div class="rmb-sub">${reached.blurb ? esc(reached.blurb) : `${Math.round(reached.km * factor * 10) / 10} ${displayUnit} checkpoint reached`}</div>
      </div>
    </div>` : ""}
    ${!challenge.noEndDate && remaining > 0 && daysLeftR !== null && daysLeftR <= 10 ? `
    <div class="route-extend">
      <span>${daysLeftR === 0 ? "Deadline's here — no rush, take the time you need." : `${daysLeftR} day${daysLeftR===1?"":"s"} left. No pressure — move at your pace.`}</span>
      <button class="link-btn" data-extend-challenge="${challenge.id}">Extend +2 weeks</button>
    </div>` : ""}
  </section>`;
}

function renderWeightWidget() {
  const entries = state.bodyTracking.entries;
  if (!entries.length) return "";
  const latest = entries[entries.length-1];
  const sw = state.bodyTracking.startWeight;
  const gw = state.bodyTracking.goalWeight;
  const unit = state.settings.units.weight;
  const lost = sw ? parseFloat((sw-latest.weight).toFixed(1)) : null;
  const pct  = (sw&&gw&&sw>gw) ? clamp(Math.round(((sw-latest.weight)/(sw-gw))*100),0,100) : null;
  const toGoal = (gw&&latest.weight>gw) ? parseFloat((latest.weight-gw).toFixed(1)) : 0;
  const lostText = lost===null?"":lost>0?`↓ ${lost} ${unit} lost`:lost<0?`↑ ${Math.abs(lost)} ${unit} gained`:"Holding steady";
  return `
  <div class="weight-widget">
    <div class="ww-left">
      <div class="ww-value">${latest.weight}<span class="ww-unit"> ${unit}</span></div>
      <div class="ww-label">current weight</div>
    </div>
    <div class="ww-right">
      ${lost!==null?`<div class="ww-lost ${lost>0?"ww-good":lost<0?"ww-bad":""}">${lostText}</div>`:""}
      ${pct!==null?`<div class="ww-track"><div class="ww-fill" style="width:${pct}%"></div></div>
        <div class="ww-goal">${toGoal>0?`${toGoal} ${unit} to go`:"Goal reached"}</div>`:""}
    </div>
  </div>`;
}

function renderTodayWeightLog() {
  const today = todayKey();
  if (state.bodyTracking.entries.some(e => e.date === today)) return "";
  const unit = state.settings.units.weight;
  return `
  <div class="today-weight-log">
    <div class="twl-label"><i class="ti ti-scale"></i> Log today's weight</div>
    <div class="twl-row">
      <input id="twl-weight" type="number" step="0.1" inputmode="decimal" placeholder="${unit==="lbs"?"185.0":"84.0"}" class="twl-input">
      <span class="twl-unit">${unit}</span>
      <button class="pill-btn" data-log-today-weight>Log</button>
    </div>
  </div>`;
}


function renderCompleteBanner(day, info, challenge, dayNumber, totalDays, isToday) {
  if (info.done!==info.total || info.total===0) return "";
  const isExpedition = challenge?.habits.some(h => h.type === "distance");
  if (day.mode==="rest") return `<div class="complete-banner rest-complete"><span class="cb-icon"><i class="ti ti-bed"></i></span><div class="cb-body"><div class="cb-title">Flex Day</div><div class="cb-sub">Recover. Come back stronger.</div></div></div>`;
  if (isExpedition) {
    const distHabit  = challenge.habits.find(h => h.type === "distance");
    const habitUnit  = distHabit?.unit || "km";
    const isFloors   = habitUnit === "floors";
    const MI_PER_KM  = 0.621371;
    const globalDist = state.settings.units.distance || "km";
    const dUnit      = unitLabelFor(habitUnit);
    const factor     = (dUnit === "mi") ? MI_PER_KM : 1;
    const todayNative = Object.values(day.distances || {}).reduce((s,v) => s + (Number(v)||0), 0);
    const totalNative = challengeTotalKm(challenge);
    const remNative   = challengeRouteKm(challenge) ? Math.max(0, challengeRouteKm(challenge) - totalNative) : null;
    const todayD = Math.round(todayNative * factor * 10) / 10;
    const totalD = Math.round(totalNative * factor * 10) / 10;
    const remD   = remNative !== null ? Math.round(remNative * factor * 10) / 10 : null;
    const sub = remD !== null
      ? `${totalD.toFixed(1)} ${dUnit} covered · ${remD.toFixed(1)} ${dUnit} to go`
      : `${totalD.toFixed(1)} ${dUnit} covered`;
    return `<div class="complete-banner"><span class="cb-icon"><i class="ti ti-map-2"></i></span><div class="cb-body"><div class="cb-title">${todayD.toFixed(isFloors?0:1)} ${dUnit} today</div><div class="cb-sub">${sub}</div></div></div>`;
  }
  const currentStreak = challenge ? calcChallengeStreak(challenge) : 0;
  const streakShare = currentStreak >= 2 ? `<button class="cb-share-btn" data-share-streak><i class="ti ti-share-3"></i> Share streak</button>` : "";
  const firstHabit = challenge?.habits[0];
  const tomorrowHook = isToday && dayNumber && totalDays && dayNumber < totalDays
    ? `<div class="cb-tomorrow">Tomorrow: ${firstHabit ? esc(firstHabit.title) : "Day "+(dayNumber+1)} · ${currentStreak+1}-day streak</div>`
    : "";
  if (day.comebackBonus) {
    return `<div class="complete-banner"><span class="cb-icon"><i class="ti ti-refresh"></i></span><div class="cb-body"><div class="cb-title">Comeback. Day ${dayNumber||""} is done.</div><div class="cb-sub">That's what resilience looks like · ${info.points} pts</div>${tomorrowHook}${streakShare}</div></div>`;
  }
  const tpl = challenge?.templateId ? TEMPLATES.find(t => t.id === challenge.templateId) : null;
  const cat = tpl?.category || "transformation";
  const copyLines = COMPLETE_COPY[cat] || COMPLETE_COPY.transformation;
  const seed = parseInt((day.date || todayKey()).replace(/-/g,"")) || 0;
  const copy = copyLines[seed % copyLines.length];
  return `<div class="complete-banner"><span class="cb-icon"><i class="ti ti-flame"></i></span><div class="cb-body"><div class="cb-title">${copy}${dayNumber ? ` Day ${dayNumber} done.` : ""}</div><div class="cb-sub">All tasks done · ${info.points} pts</div>${tomorrowHook}${streakShare}</div></div>`;
}

function renderXPBar() {
  const info    = getLevelInfo(state.xp);
  const isMax   = !info.next;
  const toNext  = isMax ? 0 : info.next.xp - state.xp;
  const c       = currentChallenge();
  const freezes = c ? (c.streakFreezes || 0) : 0;
  const todayDay = c?.days[todayKey()];
  const mult     = todayDay?.streakMult ?? (c ? getStreakMultiplier(c) : 1);
  const multLabel = mult >= 1.40 ? `<i class="ti ti-flame"></i> +40% streak bonus active` : mult >= 1.25 ? `<i class="ti ti-flame"></i> +25% streak bonus active` : mult >= 1.15 ? `<i class="ti ti-flame"></i> +15% streak bonus active` : mult >= 1.10 ? `<i class="ti ti-flame"></i> +10% streak bonus active` : null;
  return `
  <div class="xp-bar-wrap">
    <div class="xp-bar-header">
      <span class="xp-level-badge"><i class="ti ti-bolt"></i> Lv.${info.level} <span class="xp-level-name">${info.name}</span></span>
      <div style="display:flex;align-items:center;gap:8px">
        ${freezes > 0 ? `<span class="xp-freeze-badge" title="Streak freezes — use one to protect a missed day"><i class="ti ti-snowflake"></i> ${freezes}</span>` : ""}
        <span class="xp-bar-to-next">${isMax ? "Max Level" : (() => { const avg = avgDailyXP(); const d = avg ? `~${Math.ceil(toNext/avg)}d` : null; return `${toNext.toLocaleString()} XP to Lv.${info.next.level}${d?` · ${d}`:""}` })()}</span>
      </div>
    </div>
    <div class="xp-bar-track" role="progressbar" aria-valuenow="${info.pct}" aria-valuemin="0" aria-valuemax="100">
      <div class="xp-bar-fill" style="width:${info.pct}%"></div>
    </div>
    <div class="xp-bar-explainer">${multLabel || "XP builds your level forever"}</div>
  </div>`;
}


// ── Weekly Recap (Sunday card) ────────────────────────────────────────────

function renderWeeklyRecap(challenge) {
  if (state.weeklyRecapDismissed?.[challenge.id] === todayKey()) return "";  // already dismissed today
  const todayK = todayKey();
  const weeks = challengeWeeks(challenge);
  const curWeekIdx = weeks.findIndex(w => w.allDays.includes(todayK));
  if (curWeekIdx <= 0) return "";                              // no completed week yet
  const lastWeek = weeks[curWeekIdx - 1];
  const pts = lastWeek.allDays.reduce((sum,k) => {
    const d = challenge.days[k]; return sum + (d ? completionInfo(challenge,d).points : 0);
  }, 0);
  const logged = lastWeek.allDays.filter(k => { const d=challenge.days[k]; return d&&(d.done.length||d.recovered); }).length;
  const streak = calcChallengeStreak(challenge);
  // Week-over-week delta
  const prevWeek = curWeekIdx >= 2 ? weeks[curWeekIdx - 2] : null;
  const prevPts  = prevWeek ? prevWeek.allDays.reduce((sum,k) => {
    const d = challenge.days[k]; return sum + (d ? completionInfo(challenge,d).points : 0);
  }, 0) : null;
  const delta = prevPts != null ? pts - prevPts : null;
  const deltaStr = delta == null ? "" :
    delta > 0 ? `<span class="wrc-delta up">↑ +${delta} vs last week</span>` :
    delta < 0 ? `<span class="wrc-delta down">↓ ${delta} vs last week</span>` :
                `<span class="wrc-delta flat">= same as last week</span>`;
  const isExpedition = challenge.habits.some(h => h.type === "distance");
  const distHabitR   = isExpedition ? challenge.habits.find(h => h.type === "distance") : null;
  const isFloorsR    = distHabitR?.unit === "floors";
  const weekKm = isExpedition ? lastWeek.allDays.reduce((s,k) => {
    const d = challenge.days[k];
    if (!d?.distances) return s;
    return s + Object.values(d.distances).reduce((ss,km) => ss + (Number(km)||0), 0);
  }, 0) : null;
  const weekDistLabel = isFloorsR ? Math.round(weekKm) : weekKm?.toFixed(1);
  const weekDistUnit  = isFloorsR ? "floors" : "km";
  const lastWeekGoal = isExpedition ? null : goalForWeek(challenge, curWeekIdx - 1);
  const goalMetLast  = lastWeekGoal != null && pts >= lastWeekGoal;
  const thisWeekGoal = isExpedition ? null : goalForWeek(challenge, curWeekIdx);
  const msgs = ["Progress compounds. Keep stacking.", "New week, fresh start. Let's go.", "Every logged day is a win.", "Last week was strong. Build on it.", "Momentum is real — keep it going."];
  const msg = msgs[new Date().getDate() % msgs.length];
  return `
  <div class="weekly-recap-card">
    <div class="wrc-top">
      <div class="wrc-title"><i class="ti ti-clipboard-list"></i> Week ${lastWeek.num} Review</div>
      <button class="wrc-dismiss" data-dismiss-weekly-recap="${challenge.id}" aria-label="Dismiss">✕</button>
    </div>
    <div class="wrc-stats">
      ${isExpedition
        ? `<div class="wrc-stat"><span class="wrc-val">${weekDistLabel}</span><span class="wrc-lbl">${weekDistUnit}</span></div>`
        : `<div class="wrc-stat"><span class="wrc-val">${pts}${lastWeekGoal ? `<span class="wrc-goal-sub">/${lastWeekGoal}</span>` : ""}</span><span class="wrc-lbl">pts</span></div>`}
      <div class="wrc-sep"></div>
      <div class="wrc-stat"><span class="wrc-val">${logged}/${lastWeek.allDays.length}</span><span class="wrc-lbl">days</span></div>
      <div class="wrc-sep"></div>
      <div class="wrc-stat"><span class="wrc-val">${streak}</span><span class="wrc-lbl">streak</span></div>
    </div>
    ${lastWeekGoal ? `<div class="wrc-goal-row${goalMetLast ? " wrc-goal-met" : ""}">${goalMetLast ? `<i class="ti ti-target"></i> Weekly goal hit!` : `<i class="ti ti-target"></i> ${pts}/${lastWeekGoal} pts - ${Math.round(pts/lastWeekGoal*100)}% of goal`}${thisWeekGoal && thisWeekGoal !== lastWeekGoal ? ` · Week ${curWeekIdx + 1} target: ${thisWeekGoal} pts` : ""}</div>` : ""}
    ${deltaStr ? `<div class="wrc-delta-row">${deltaStr}</div>` : ""}
    <div class="wrc-msg">${msg}</div>
  </div>`;
}


// ── Challenge Suggestions (post-completion) ───────────────────────────────

function suggestNextChallenges(c) {
  const finishedId = c.templateId;
  // Check challenge chain first
  const chainNextId = finishedId && CHALLENGE_CHAINS[finishedId];
  const chainNext   = chainNextId ? TEMPLATES.find(t => t.id === chainNextId) : null;
  const cat  = TEMPLATES.find(t => t.id === finishedId)?.category;
  const pool = TEMPLATES.filter(t => t.id !== finishedId && t.id !== chainNextId && !t.deprecated);
  const sameCat = pool.filter(t => t.category === cat);
  const extras  = pickRandom(sameCat.length ? sameCat : pool, chainNext ? 1 : 2);
  return chainNext ? [chainNext, ...extras] : extras;
}

function renderCompletionSuggestions(c) {
  const chainNextId = c.templateId && CHALLENGE_CHAINS[c.templateId];
  // Exclude the chain template — it's already featured prominently above
  let sugs = suggestNextChallenges(c).filter(t => t.id !== chainNextId);
  if (!sugs.length) return "";
  return `
  <div class="completion-suggestions">
    <div class="cs-label">You might also like</div>
    ${sugs.map(t => `
    <button class="cs-card" data-start-suggested="${t.id}">
      <span class="cs-emoji"><i class="ti ${challengeIcon(t)}"></i></span>
      <div class="cs-info">
        <div class="cs-name">${t.name}</div>
        <div class="cs-meta">${t.duration}d · ${t.category}</div>
      </div>
      <span class="cs-arrow">→</span>
    </button>`).join("")}
  </div>`;
}

// ── Personal Bests ────────────────────────────────────────────────────────

function computePersonalBests() {
  const all = getAllChallenges();
  let longestStreak = 0, bestWeekPts = 0, totalHabits = 0, totalDays = 0;
  for (const c of all) {
    const streak = (c.status==="completed"||c.status==="failed") && c.finalStreak!=null
      ? c.finalStreak : calcChallengeStreak(c);
    if (streak > longestStreak) longestStreak = streak;
    for (const w of challengeWeeks(c)) {
      const wpts = w.days.reduce((sum,k) => { const d=c.days[k]; return sum+(d?completionInfo(c,d).points:0); }, 0);
      if (wpts > bestWeekPts) bestWeekPts = wpts;
    }
    for (const d of Object.values(c.days)) {
      totalHabits += d.done.length;
      if (d.done.length > 0 || d.recovered) totalDays++;
    }
  }
  return { longestStreak, bestWeekPts, totalHabits, totalDays };
}

function renderPersonalBests() {
  const all = getAllChallenges();
  if (!all.length) return "";
  const pb = computePersonalBests();
  if (pb.totalHabits === 0) return "";
  return `
  <div class="section-label" style="margin-top:8px">Personal Bests</div>
  <div class="pb-grid">
    ${pbCard(`<i class="ti ti-flame"></i> Longest Streak`, pb.longestStreak, "days")}
    ${pbCard(`<i class="ti ti-bolt"></i> Best Week`,       pb.bestWeekPts,   "pts")}
    ${pbCard(`<i class="ti ti-check"></i> Tasks Logged`,  pb.totalHabits,   "")}
    ${pbCard(`<i class="ti ti-calendar-check"></i> Days Shown Up`,  pb.totalDays,     "")}
  </div>`;
}

function pbCard(label, value, unit) {
  return `<div class="pb-card">
    <div class="pb-label">${label}</div>
    <div class="pb-value">${value}${unit ? `<span class="pb-unit"> ${unit}</span>` : ""}</div>
  </div>`;
}


function shareAchievement(text) {
  if (navigator.share) {
    navigator.share({ title: "Endur", text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text).then(() => showToast("Copied to clipboard!")).catch(() => showToast(text));
  }
}

function showShareModal(challenge, isDone) {
  _shareModalChallenge = challenge;
  _shareModalDone = !!isDone;
  _shareCardDataUrl = drawShareCard(challenge, !!isDone).toDataURL("image/png");
  render();
}

function drawShareCard(challenge, isDone) {
  const s = 1080;
  const canvas = document.createElement("canvas");
  canvas.width  = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue("--primary").trim() || "#d97742";

  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, s, 10);

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  ctx.strokeRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);

  ctx.fillStyle = accent;
  ctx.font      = `600 ${Math.round(s * 0.052)}px 'Arial', sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("ENDUR", s / 2, s * 0.24);

  ctx.fillStyle = "#f0efed";
  ctx.font      = `500 ${Math.round(s * 0.065)}px 'Arial', sans-serif`;
  ctx.fillText(challenge.name, s / 2, s * 0.38);

  const _dh  = challenge.habits.find(h => h.type === "distance");
  const _u   = unitLabelFor(_dh?.unit);
  const _isFloors = _dh?.unit === "floors";
  const _f   = _u === "mi" ? 0.621371 : 1;
  const _tot = Math.round(challengeTotalKm(challenge) * _f * 10) / 10;
  const _totTxt = _isFloors ? Math.round(_tot).toLocaleString() : _tot;
  const _acts = Object.values(challenge.days).filter(d => d.distances && Object.values(d.distances).some(v => Number(v) > 0)).length;
  const totalDays  = diffDays(challenge.startDate, challenge.endDate) + 1;
  const statLine = isDone
    ? `${_totTxt} ${_u}  ·  ${_acts} sessions  ·  ${totalDays} days`
    : `${_totTxt} ${_u} logged  ·  ${_acts} sessions`;

  const pillW = s * 0.78, pillH = s * 0.085, pillX = (s - pillW) / 2, pillY = s * 0.44;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.strokeRect(pillX, pillY, pillW, pillH);

  ctx.fillStyle = "#9a9a98";
  ctx.font      = `400 ${Math.round(s * 0.038)}px 'Arial', sans-serif`;
  ctx.fillText(statLine, s / 2, pillY + pillH * 0.64);

  const headline = isDone ? "Mission complete."
    : `${_totTxt} ${_u} and counting.`;
  ctx.fillStyle = accent;
  ctx.font      = `500 ${Math.round(s * 0.055)}px 'Arial', sans-serif`;
  ctx.fillText(headline, s / 2, s * 0.65);

  ctx.fillStyle = "#9a9a98";
  ctx.font      = `400 ${Math.round(s * 0.033)}px 'Arial', sans-serif`;
  ctx.fillText(isDone ? "Every mile moved me somewhere." : "Every mile moves you somewhere. " + SHARE_URL, s / 2, s * 0.72);

  const _scLevel = getLevelInfo(state.xp);
  ctx.fillStyle = "rgba(154,154,152,0.6)";
  ctx.font      = `400 ${Math.round(s * 0.03)}px 'Arial', sans-serif`;
  ctx.fillText(`FIELD LOG · Lv.${_scLevel.level} ${_scLevel.name}`, s / 2, s * 0.81);

  ctx.fillStyle = "rgba(154,154,152,0.4)";
  ctx.font      = `700 ${Math.round(s * 0.028)}px 'Arial', sans-serif`;
  ctx.fillText("OUTLAST EVERYTHING", s / 2, s * 0.89);

  return canvas;
}

function renderShareModal() {
  if (!_shareModalChallenge || !_shareCardDataUrl) return "";
  const _sc       = _shareModalChallenge;
  const _sdh      = _sc.habits.find(h => h.type === "distance");
  const _su       = unitLabelFor(_sdh?.unit);
  const _sf       = _su === "mi" ? 0.621371 : 1;
  const _stot     = Math.round(challengeTotalKm(_sc) * _sf * 10) / 10;
  const _stotTxt  = _sdh?.unit === "floors" ? Math.round(_stot).toLocaleString() : _stot;
  const totalDays = diffDays(_sc.startDate, _sc.endDate) + 1;
  const shareText = _shareModalDone
    ? `I just completed ${_sc.name} on Endur — ${_stotTxt} ${_su} over ${totalDays} days.\nEvery mile moves you somewhere.\n${SHARE_URL}`
    : `${_stotTxt} ${_su} into ${_sc.name} on Endur.\nEvery mile moves you somewhere.\n${SHARE_URL}`;

  return `
  <div class="share-modal-overlay" data-close-share-modal>
    <div class="share-modal-inner" onclick="event.stopPropagation()">
      <img src="${_shareCardDataUrl}" class="share-card-img" alt="Share card">
      <div class="share-modal-actions">
        <button class="primary-button" data-share-card-native style="margin-bottom:8px"><i class="ti ti-share"></i> Share</button>
        <button class="secondary-button" data-download-share-card><i class="ti ti-download"></i> Save image</button>
        <button class="secondary-button" data-copy-share-text style="margin-top:8px"><i class="ti ti-copy"></i> Copy text</button>
      </div>
      <button class="share-modal-close" data-close-share-modal aria-label="Close">×</button>
    </div>
  </div>`;
}

function renderCompletionModal(c) {
  const totalDays    = diffDays(c.startDate, c.endDate) + 1;
  const totalPts     = Object.values(c.days).reduce((s,d) => s+(d.pts||0), 0);
  const finalStreak  = c.finalStreak ?? calcChallengeStreak(c);
  const canShare     = !!navigator.share || !!navigator.clipboard;
  const nextId       = c.templateId && CHALLENGE_CHAINS[c.templateId];
  const nextT        = nextId ? TEMPLATES.find(t => t.id === nextId) : null;
  const tpl          = c.templateId ? TEMPLATES.find(t => t.id === c.templateId) : null;
  const isMission     = c.habits.some(h => h.type === "distance");
  const mDistHabit    = isMission ? c.habits.find(h => h.type === "distance") : null;
  const mDUnit        = isMission ? unitLabelFor(mDistHabit?.unit) : "";
  const mIsFloors     = mDistHabit?.unit === "floors";
  const mFactor       = mDUnit === "mi" ? 0.621371 : 1;
  const totalKmNativeM = isMission ? challengeTotalKm(c) : 0;
  const mTotalD       = Math.round(totalKmNativeM * mFactor * 10) / 10;
  const routeFinished = challengeRouteKm(c) && totalKmNativeM >= challengeRouteKm(c);
  const activities    = isMission ? Object.values(c.days).filter(d => d.distances && Object.values(d.distances).some(v => Number(v) > 0)).length : 0;
  const longestD      = isMission ? Math.round(Math.max(0, ...Object.values(c.days).map(d => d.distances ? Object.values(d.distances).reduce((s,v)=>s+(Number(v)||0),0) : 0)) * mFactor * 10) / 10 : 0;
  const daysToDone    = c.completedAt ? diffDays(c.startDate, c.completedAt.slice(0,10)) + 1 : totalDays;
  const reachedCount  = tpl?.milestones ? tpl.milestones.filter(m => totalKmNativeM >= m.km).length : 0;
  const destName      = tpl?.milestones?.length ? tpl.milestones[tpl.milestones.length-1].name : c.name;
  const fmtD          = v => mIsFloors ? Math.round(v).toLocaleString() : v;
  const completionSub = isMission
    ? `You covered <strong>${fmtD(mTotalD)} ${mDUnit}</strong> over <strong>${activities}</strong> ${activities===1?"session":"sessions"}${routeFinished && tpl?.routeGeo?` and reached <strong>${esc(destName)}</strong>`:""} in <strong>${daysToDone}</strong> ${daysToDone===1?"day":"days"}.`
    : `${totalDays} days · ${totalPts} pts. That's what commitment looks like.`;
  const bonusXP = c.completionBonus || 0;
  return `
  <div class="sheet-backdrop" data-close-completion>
    <section class="sheet completion-modal" role="dialog">
      <div class="completion-emoji"><i class="ti ${tpl?challengeIcon(tpl):"ti-trophy"}"></i></div>
      <div class="completion-title">${isMission && routeFinished ? "Route Complete" : "Mission Complete"}</div>
      <div class="completion-name">${esc(c.name)}</div>
      <div class="completion-sub">${completionSub}</div>
      ${isMission ? `<div class="completion-stats">
        <div class="cstat"><div class="cstat-v">${fmtD(mTotalD)}</div><div class="cstat-l">${mDUnit}</div></div>
        <div class="cstat"><div class="cstat-v">${activities}</div><div class="cstat-l">${activities===1?"session":"sessions"}</div></div>
        <div class="cstat"><div class="cstat-v">${daysToDone}</div><div class="cstat-l">days</div></div>
        <div class="cstat"><div class="cstat-v">${reachedCount}</div><div class="cstat-l">checkpoints</div></div>
      </div>` : ""}
      ${bonusXP ? `<div class="completion-bonus-row"><i class="ti ti-bolt"></i> Challenge Complete Bonus: <strong>+${bonusXP} XP</strong></div>` : ""}
      ${nextT ? `
      <button class="chain-cta" data-start-suggested="${nextT.id}">
        <span class="chain-cta-pre">Continue your journey</span>
        <span class="chain-cta-main"><i class="ti ${challengeIcon(nextT)}"></i> ${nextT.name} -></span>
        <span class="chain-cta-sub">${nextT.duration} days · Level up</span>
      </button>` : ""}
      ${(() => {
        const restDays = totalDays >= 75 ? 5 : totalDays >= 30 ? 3 : 2;
        const nextStart = addDays(todayKey(), restDays);
        const nextStartLabel = formatDate(parseDate(nextStart), {month:"short", day:"numeric"});
        return `<div style="background:color-mix(in srgb,var(--accent) 8%,transparent);border:1px solid color-mix(in srgb,var(--accent) 25%,transparent);border-radius:10px;padding:12px 14px;margin-top:16px;text-align:left">
          <div style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">What's next</div>
          <div style="font-size:13px;color:var(--text);line-height:1.55">Take <strong>${restDays} days to recover</strong> — sleep, eat well, reflect on what you built. Your next challenge can start <strong>${nextStartLabel}</strong>.</div>
        </div>`;
      })()}
      <button class="${nextT?"secondary-button":"primary-button"}" data-close-completion style="margin-top:${nextT?"8":"16"}px">Done</button>
      ${canShare ? `<button class="secondary-button" data-share-completion style="margin-top:8px"><i class="ti ti-share-3"></i> Share your achievement</button>` : ""}
      <button class="secondary-button" data-completion-new-challenge style="margin-top:8px">Browse all challenges →</button>
      ${renderCompletionSuggestions(c)}
    </section>
  </div>`;
}

// ── Challenges Tab ────────────────────────────────────────────────────────

function renderChallenges() {
  const all    = getAllChallenges();
  const active = all.filter(c => c.status==="active");
  const paused = all.filter(c => c.status==="paused");
  const past   = all.filter(c => c.status!=="active" && c.status!=="paused");
  const emptyMsg = `<div class="empty-state-icon"><i class="ti ti-flame"></i></div><div class="empty-state-title">No active challenge</div><div class="empty-state-sub">Pick a challenge and start today.</div><div><button class="link-btn" data-open-builder>Browse challenges →</button></div>`;
  const recentlyCompleted = active.length === 0
    ? all.filter(c => c.status === "completed" && c.completedAt)
        .sort((a,b) => b.completedAt.localeCompare(a.completedAt))[0]
    : null;
  return `
  <main${_viewChanged ? ` class="tab-fade-in"` : ""}>
    ${recentlyCompleted ? `
    <div class="whats-next-banner">
      <div class="wnb-title">What's next?</div>
      <div class="wnb-sub">You finished <strong>${esc(recentlyCompleted.name)}</strong>. Keep the momentum going.</div>
      ${renderCompletionSuggestions(recentlyCompleted)}
    </div>` : ""}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="section-label" style="margin:0">Active Challenges</div>
      <button class="pill-btn" data-open-builder>+ New</button>
    </div>
    ${active.length ? active.map(c=>renderChallengeCard(c)).join("") : `<div class="empty-state">${emptyMsg}</div>`}
    ${paused.length ? `<div class="section-label">Paused</div>${paused.map(c=>renderChallengeCard(c)).join("")}` : ""}
    ${past.length   ? `<div class="section-label">Past</div>${past.map(c=>renderChallengeCard(c)).join("")}` : ""}
  </main>`;
}

function renderChallengeCard(c) {
  const today        = todayKey();
  const totalDays    = c.noEndDate ? null : diffDays(c.startDate, c.endDate)+1;
  const dayNumber    = challengeDayNumber(c);
  const pct          = totalDays ? clamp(Math.round((dayNumber/totalDays)*100), 0, 100) : 0;
  const streak       = (c.status==="completed"||c.status==="failed") && c.finalStreak!=null
    ? c.finalStreak : calcChallengeStreak(c);
  const day          = c.days[today];
  const todayInfo    = day ? completionInfo(c, day) : null;
  const statusColor  = c.status==="completed"?"var(--success)":c.status==="failed"?"var(--secondary)":c.status==="paused"?"var(--text-dim)":"";
  const isExpedition = c.habits.some(h => h.type === "distance");
  const tpl          = c.templateId ? TEMPLATES.find(t => t.id === c.templateId) : null;
  const cRouteKm     = challengeRouteKm(c);
  const totalKmVal   = isExpedition ? challengeTotalKm(c) : null;
  const routePct     = cRouteKm ? Math.min(100, Math.round((totalKmVal / cRouteKm) * 100)) : null;
  const distHabit    = isExpedition ? c.habits.find(h => h.type === "distance") : null;
  const isFloors     = distHabit?.unit === "floors";
  const MI_PER_KM    = 0.621371;
  const globalDist   = state.settings.units.distance || "km";
  const dUnit        = unitLabelFor(distHabit?.unit);
  const factor       = dUnit === "mi" ? MI_PER_KM : 1;
  const todayNativeKm = isExpedition && day?.distances
    ? Object.values(day.distances).reduce((s,v) => s + (Number(v)||0), 0) : null;
  const tier         = tpl ? (TEMPLATE_TIERS[tpl.id] || "common") : null;
  const tierData     = tier ? TIERS[tier] : null;
  const challengeBadgeTotal = c.templateId ? (TEMPLATE_BADGES[c.templateId]?.length || 0) : 0;
  const badgeMeta = challengeBadgeTotal ? `${c.badges.length}/${challengeBadgeTotal} badges` : `${c.badges.length} ${c.badges.length === 1 ? "badge" : "badges"}`;
  const resumeNudge = c.status === "paused" && c.resumeReminderDate && c.resumeReminderDate <= today;
  return `
  <div class="challenge-card-wrap">
    <button class="challenge-card" data-view-challenge="${c.id}">
      <div class="cc-top">
        <div class="cc-emoji"><i class="ti ${tpl?challengeIcon(tpl):"ti-target"}"></i></div>
        <div class="cc-info">
          <div class="cc-name">${esc(c.name)}${tierTag(c.templateId)}${c.noEndDate?` <span class="ongoing-badge">Ongoing</span>`:""}</div>
          <div class="cc-meta">${isExpedition && cRouteKm
            ? `${Math.round(totalKmVal * factor * 10)/10} / ${Math.round(cRouteKm * factor).toLocaleString()} ${dUnit} · Day ${dayNumber}`
            : c.noEndDate ? `Ongoing · ${c.mode} · Day ${dayNumber}` : `${totalDays}d · ${c.mode} · Day ${dayNumber}`}</div>
        </div>
        <div class="cc-right">
          ${c.status!=="active"
            ? `<div class="cc-status" style="color:${statusColor}">${c.status==="paused"?"paused":c.status}</div>`
            : isExpedition
              ? `<div class="cc-today">${todayNativeKm !== null && todayNativeKm > 0 ? (Math.round(todayNativeKm*factor*10)/10)+" "+dUnit : "—"}</div>`
              : `<div class="cc-today">${todayInfo?todayInfo.percent+"%":"—"}</div>`}
        </div>
      </div>
      <div class="cc-track">
        <div class="cc-fill" style="width:${isExpedition && routePct !== null ? routePct : pct}%"></div>
      </div>
      <div class="cc-sub">${isExpedition && routePct !== null
        ? `${routePct}% dist - ${todayInfo ? todayInfo.percent : 0}% today - ${pct}% time`
        : `${pct}% complete - ${badgeMeta}`}</div>
    </button>
    ${resumeNudge ? `<div class="resume-nudge"><i class="ti ti-clock"></i> Reminder to resume! <button class="link-btn" data-pause-challenge="${c.id}">Resume now →</button></div>` : ""}
  </div>`;
}

// ── Sparkline helper ─────────────────────────────────────────────────────

function renderSparkline(values, w = 88, h = 28) {
  const pts = values.filter(v => v != null && v > 0);
  if (pts.length < 2) return "";
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const coords = pts.map((v, i) => {
    const x = Math.round((i / (pts.length - 1)) * w);
    const y = Math.round(h - ((v - min) / range) * (h - 4) - 2);
    return `${x},${y}`;
  }).join(" ");
  const lastX = Math.round(((pts.length - 1) / (pts.length - 1)) * w);
  const lastY = Math.round(h - ((pts[pts.length-1] - min) / range) * (h - 4) - 2);
  return `<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${coords}"/>
    <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="var(--accent)"/>
  </svg>`;
}

// ── Challenge Detail ──────────────────────────────────────────────────────

function renderChallengeDetail(c) {
  if (!c) return `<main><div class="empty-state">Challenge not found.</div></main>`;
  const today     = todayKey();
  const weeks     = challengeWeeks(c);
  const totalDays = c.noEndDate ? null : diffDays(c.startDate, c.endDate)+1;
  const dayNumber = challengeDayNumber(c);
  const pct       = totalDays ? clamp(Math.round((dayNumber/totalDays)*100), 0, 100) : null;
  const streak    = calcChallengeStreak(c);
  const totalPts  = Object.values(c.days).reduce((s,d)=>s+(d.pts||0),0);
  const activeDays = Object.values(c.days).filter(d => d.mode !== "rest" && (d.done.length > 0 || d.recovered));
  const activeDaysDone = activeDays.filter(d => d.done.length > 0 || d.recovered).length;
  const activeTotal = Object.values(c.days).filter(d => d.mode !== "rest").length;
  const activeCompPct = activeTotal ? Math.round((activeDaysDone / activeTotal) * 100) : 0;
  const curWeekIdx = weeks.findIndex(w=>w.allDays.includes(today));
  const hasPhotoHabit = c.habits.some(h => h.id === "photo" || /progress\s*photo/i.test(h.title));
  const nextChainId   = c.templateId && CHALLENGE_CHAINS[c.templateId];
  const nextChainT    = nextChainId ? TEMPLATES.find(t => t.id === nextChainId) : null;
  const tpl           = c.templateId ? TEMPLATES.find(t => t.id === c.templateId) : null;
  const isExpedition  = !!challengeRouteKm(c) || c.habits.some(h => h.type === "distance");
  const totalNativeKm = isExpedition ? challengeTotalKm(c) : null;
  const distHabitDet  = isExpedition ? c.habits.find(h => h.type === "distance") : null;
  const isFloorsDet   = distHabitDet?.unit === "floors";
  const MI_PER_KM_D   = 0.621371;
  const globalDistD   = state.settings.units.distance || "km";
  const dUnitDet      = unitLabelFor(distHabitDet?.unit);
  const factorDet     = dUnitDet === "mi" ? MI_PER_KM_D : 1;
  const totalKmDisplay = isExpedition ? Math.round(totalNativeKm * factorDet * 10) / 10 : null;
  const challengeBadgeTotal = c.templateId ? (TEMPLATE_BADGES[c.templateId]?.length || 0) : 0;
  const badgeStat = challengeBadgeTotal ? `${c.badges.length}/${challengeBadgeTotal}` : c.badges.length;
  return `
  <main${_viewChanged ? ` class="slide-in-right"` : ""}>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button class="icon-btn" data-close-detail>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="display:flex;align-items:center;gap:9px">
        <i class="ti ${tpl?challengeIcon(tpl):"ti-target"}" style="color:var(--text-dim);font-size:21px"></i>
        <div>
          <div style="font-size:18px;font-weight:500">${esc(c.name)}${tierTag(c.templateId)}</div>
          <div style="font-size:12px;color:var(--text-dim)">${c.startDate}${c.noEndDate ? " - Ongoing" : ` -> ${c.endDate}`}</div>
        </div>
      </div>
    </div>
    <div class="stats-grid" style="margin-bottom:14px">
      ${statCard(`<i class="ti ti-bolt stat-ic"></i> Total pts`, totalPts, "")}
      ${isExpedition
        ? statCard(`<i class="ti ti-map-2 stat-ic"></i> Distance`, totalKmDisplay.toFixed(isFloorsDet?0:1), dUnitDet)
        : statCard(`<i class="ti ti-bolt stat-ic"></i> Total pts`, totalPts, "")}
      ${statCard(`<i class="ti ti-checkbox stat-ic"></i> Active days`, `${activeDaysDone}/${activeTotal}`, "")}
      ${statCard(`<i class="ti ti-medal stat-ic"></i> Badges`, badgeStat, "")}
    </div>
    ${pct !== null ? `<div class="detail-progress-bar" style="margin-bottom:14px"><div class="detail-progress-fill" style="width:${pct}%"></div><div class="detail-progress-label">${pct}% complete</div></div>` : `<div class="detail-progress-bar" style="margin-bottom:14px"><div class="detail-progress-label">Day ${dayNumber} - Ongoing</div></div>`}
    ${isExpedition ? renderRouteProgress(c, tpl) : ""}


    ${nextChainT && c.status === "completed" ? `
    <div class="chain-next-banner" data-start-suggested="${nextChainT.id}">
      <div class="cnb-label">Continue your journey -></div>
      <div class="cnb-row">
        <span class="cnb-emoji"><i class="ti ${challengeIcon(nextChainT)}"></i></span>
        <div class="cnb-info">
          <div class="cnb-name">${nextChainT.name}</div>
          <div class="cnb-meta">${nextChainT.duration} days · Level up</div>
        </div>
        <span class="cnb-arrow">-></span>
      </div>
    </div>` : ""}

    <div class="section-label">Calendar</div>
    ${renderMonthCalendar(c)}

    ${c.habits.some(h => h.type !== "distance") ? `
    <div class="section-label">Tasks</div>
    <div class="habit-preview-list" style="margin-bottom:14px">
      ${c.habits.filter(h => h.type !== "distance").map(h => {
        if (h.type === "distance") {
          const allDays = Object.values(c.days);
          const kmTotal = allDays.reduce((s,d) => s + (Number(d.distances?.[h.id]) || 0), 0);
          const daysLogged = allDays.filter(d => d.done.includes(h.id)).length;
          const routeKm = challengeRouteKm(c) || 0;
          const routePct = routeKm ? Math.min(100, Math.round((kmTotal / routeKm) * 100)) : null;
          return `<div class="habit-preview-item">
            <span class="hpi-title">${esc(h.title)}</span>
            <span class="hpi-rate ${routePct === 0 || daysLogged === 0 ? "hpi-rate--zero" : routePct === 100 ? "hpi-rate--done" : "hpi-rate--progress"}">${kmTotal.toFixed(1)} km${routePct !== null ? ` · ${routePct}% of route` : ` · ${daysLogged}d logged`}</span>
          </div>`;
        }
        if (h.type === "measurement") {
          const sortedDays = Object.entries(c.days)
            .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
            .sort(([a],[b]) => a.localeCompare(b))
            .map(([,d]) => d);
          const decimals = typeof h.decimals === "number" ? h.decimals : 1;
          const unit = h.unit === "weight" ? (state.settings.units.weight || "kg") : (h.unit || "");
          const vals = sortedDays.map(d => d.distances?.[h.id]).filter(v => v != null && v > 0);
          const latest = vals.length ? vals[vals.length - 1] : null;
          const avg = vals.length > 1 ? vals.reduce((a,b) => a+b, 0) / vals.length : null;
          const sparkData = sortedDays.map(d => d.distances?.[h.id] ?? null);
          const goalW = (h.unit === "weight" || h.unit === "lbs" || h.unit === "kg") && c.goalWeight ? c.goalWeight : null;
          const goalLine = goalW && latest != null
            ? `<span class="hpi-goal ${latest <= goalW ? "hpi-goal--reached":""}">${latest <= goalW ? "Goal reached" : `${Math.abs(latest - goalW).toFixed(decimals)} ${unit} to goal`}</span>`
            : "";
          return `<div class="habit-preview-item habit-preview-meas">
            <div class="hpm-top">
              <span class="hpi-title">${esc(h.title)}</span>
              <span class="hpi-rate" style="color:var(--accent)">
                ${latest != null ? `${latest.toFixed(decimals)} ${unit}` : "No entries"}${avg != null ? ` · avg ${avg.toFixed(decimals)}` : ""}
              </span>
            </div>
            ${goalLine}
            ${renderSparkline(sparkData)}
          </div>`;
        }
        const allDays = Object.values(c.days);
        const available = allDays.filter(d => d.mode !== "rest" && (d.done.length > 0 || d.recovered));
        const done = available.filter(d => d.done.includes(h.id)).length;
        const hpct = available.length ? Math.round((done / available.length) * 100) : null;
        const rateClass = hpct == null || hpct === 0 ? "hpi-rate--zero" : hpct >= 100 ? "hpi-rate--done" : "hpi-rate--progress";
        return `<div class="habit-preview-item">
          <span class="hpi-title">${esc(h.title)}</span>
          ${hpct != null ? `<span class="hpi-rate ${rateClass}">${hpct}%</span>` : ""}
        </div>`;
      }).join("")}
    </div>` : ""}

    ${hasPhotoHabit ? `
    <div class="section-label">Progress Photos</div>
    <div id="pp-strip-${c.id}" class="pp-strip"><div class="pp-loading">Loading photos…</div></div>
    ` : ""}

    ${c.habits.some(h => h.type === "measurement") ? `
    <div style="margin-top:16px">
      <button class="secondary-button" data-export-health="${c.id}"><i class="ti ti-download"></i> Export Health Data (CSV)</button>
    </div>` : ""}
    ${(c.status==="active"||c.status==="paused")?`
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      ${c.status==="active"?`<button class="secondary-button" data-edit-challenge="${c.id}"><i class="ti ti-pencil"></i> Edit</button>`:""}
      <button class="secondary-button" data-pause-challenge="${c.id}">${c.status==="paused"?`<i class="ti ti-player-play"></i> Resume`:`<i class="ti ti-player-pause"></i> Pause`}</button>
      ${(c.status==="active"&&!c.noEndDate)?`<button class="secondary-button" data-extend-challenge="${c.id}"><i class="ti ti-calendar-plus"></i> Extend +2 weeks</button>`:""}
      <button class="secondary-button danger" data-abandon-challenge="${c.id}">Abandon</button>
      <button class="secondary-button danger" data-delete-challenge="${c.id}"><i class="ti ti-trash"></i> Delete</button>
    </div>`:""}
    ${(c.status==="completed"||c.status==="failed")?`
    <div style="margin-top:16px">
      <button class="secondary-button danger" data-delete-challenge="${c.id}"><i class="ti ti-trash"></i> Delete challenge</button>
    </div>`:""}
  </main>`;
}

function renderEditChallenge(c) {
  if (!c) return `<main><div class="empty-state">Challenge not found.</div></main>`;
  return `
  <main${_viewChanged ? ` class="slide-in-right"` : ""}>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
      <button class="icon-btn" data-close-edit>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="font-size:16px;font-weight:700">Edit Challenge</div>
    </div>
    <div class="builder-form">
      <label class="field" style="margin-bottom:14px">
        Challenge name
        <input id="ec-name" type="text" value="${esc(c.name)}" maxlength="40">
      </label>
      <label class="field" style="margin-bottom:14px">
        Emoji
        <input id="ec-emoji" type="text" value="${esc(c.emoji)}" maxlength="2" class="emoji-input" style="width:64px">
      </label>
      <div class="field-grid" style="margin-bottom:14px">
        <label class="field">Start date<input id="ec-start" type="date" value="${c.startDate}"></label>
        <label class="field">End date<input id="ec-end" type="date" value="${c.endDate}"></label>
      </div>
      <div class="section-label" style="margin:0 0 8px">Challenge Mode</div>
      <div class="mode-selector" style="margin-bottom:14px">
        <button class="mode-button ${(editForm?.mode||c.mode)==="soft"?"active":""}" data-ec-mode="soft">Soft</button>
        <button class="mode-button ${(editForm?.mode||c.mode)==="strict"?"active":""}" data-ec-mode="strict">Strict</button>
      </div>
      <div class="section-label" style="margin:20px 0 8px">Tasks</div>
      <div class="custom-habits-list">
        ${(editForm?.habits || []).map((h, i) => {
          if (editForm?.habitEditIdx === i) {
            // Inline edit row
            const isTiered = h.type === "tiered";
            return `
            <div class="ech-edit-row">
              <div class="ech-edit-top">
                <input id="ech-emoji" class="emoji-input" type="text" value="${esc(h.emoji)}" maxlength="2" style="width:48px">
                <input id="ech-title" type="text" value="${esc(h.title)}" placeholder="Task name" style="flex:1">
                ${isTiered
                  ? `<span class="custom-habit-pts" style="font-size:11px">${h.tiers.map(t=>t.label||`Tier`).join(" / ")}</span>`
                  : `<input id="ech-pts" type="number" value="${h.points}" min="1" max="20" style="width:52px">`}
              </div>
              ${isTiered ? `<p style="font-size:11px;color:var(--text-dim);margin:0">Tiered task — to change tiers, delete and re-add.</p>` : ""}
              <div class="ech-edit-actions">
                <button class="pill-btn" data-ec-save-habit>Save ✓</button>
                <button class="secondary-button" style="padding:6px 12px;font-size:13px" data-ec-cancel-habit-edit>Cancel</button>
              </div>
            </div>`;
          }
          return `
          <div class="custom-habit-row">
            <span class="custom-habit-emoji"><i class="ti ti-square"></i></span>
            <span class="custom-habit-name">${esc(h.title)}</span>
            <span class="custom-habit-pts">${h.type==="tiered" ? `${h.tiers[0].points??h.tiers[0].pts??0}–${(t=>t.points??t.pts??0)(h.tiers[h.tiers.length-1])}pt` : h.points+"pt"}</span>
            <button class="icon-btn" data-ec-edit-habit="${i}" title="Edit">✏️</button>
            <button class="icon-btn" data-ec-delete-habit="${i}" title="Delete" style="color:var(--secondary)">✕</button>
          </div>`;
        }).join("")}
        ${(() => {
          const ef = editForm || {};
          const newType  = ef.newHabitType  || "binary";
          const newTiers = ef.newHabitTiers || [{label:"",points:1},{label:"",points:2},{label:"",points:3}];
          return `
        <div class="add-habit-form">
          <div class="add-habit-top-row">
            <input id="ech-new-emoji" class="emoji-input" type="text" value="${esc(ef.newHabitEmoji||"⭐")}" maxlength="2" placeholder="⭐" style="width:46px">
            <input id="ech-new-title" type="text" value="${esc(ef.newHabitTitle||"")}" placeholder="New task name" style="flex:1">
            <div class="habit-type-toggle">
              <button class="ht-btn ${newType!=="tiered"?"active":""}" data-ech-type="binary">Simple</button>
              <button class="ht-btn ${newType==="tiered"?"active":""}" data-ech-type="tiered">Tiered</button>
            </div>
          </div>
          ${newType === "tiered" ? `
          <div class="tier-inputs">
            <div class="tier-inputs-header"><span>Label</span><span>Pts</span>${newTiers.length>2?"<span></span>":""}</div>
            ${newTiers.map((t,i)=>`
            <div class="tier-row">
              <input class="tier-label-input" id="ech-tier-${i}-label" type="text" value="${esc(t.label)}" placeholder="e.g. 3 km">
              <input class="tier-pts-input" id="ech-tier-${i}-pts" type="number" value="${t.points}" min="1" max="20">
              ${newTiers.length>2?`<button class="icon-btn" data-ech-remove-tier="${i}" style="font-size:11px">✕</button>`:""}
            </div>`).join("")}
            ${newTiers.length<5?`<button class="link-btn" data-ech-add-tier style="font-size:12px;margin-top:2px">+ Add tier</button>`:""}
          </div>` : `
          <div class="tier-inputs-simple">
            <span style="font-size:12px;color:var(--text-dim)">Points</span>
            <input id="ech-new-pts" type="number" value="${ef.newHabitPoints||2}" min="1" max="20" style="width:60px">
          </div>`}
          <button class="pill-btn" data-ec-add-habit style="margin-top:8px;width:100%">+ Add task</button>
        </div>`;
        })()}
      </div>

      <button class="primary-button" data-save-edit style="margin-top:20px">Save Changes ✓</button>
      <button class="secondary-button" style="margin-top:8px" data-close-edit>Cancel</button>
    </div>
  </main>`;
}

function statCard(label, value, unit) {
  return `<div class="stat-card">
    <div class="label" style="font-size:11px;font-weight:500;color:var(--text-dim);margin-bottom:6px">${label}</div>
    <div class="stat-value">${value}<span style="font-size:13px;font-weight:500;color:var(--text-dim);margin-left:3px">${unit}</span></div>
  </div>`;
}

function goalForWeek(challenge, weekIdx) {
  const g = challenge.weeklyGoal;
  if (weekIdx <= 0) return Math.round(g * 0.5);
  if (weekIdx === 1) return Math.round(g * 0.7);
  if (weekIdx === 2) return Math.round(g * 0.85);
  return g;
}

function renderWeekCard(c, week, isCurrent) {
  const today = todayKey();
  const pts = week.days.reduce((s,k)=>s+(c.days[k]?completionInfo(c,c.days[k]).points:0),0);
  const logged = week.allDays.filter(k=>{ const d=c.days[k]; return d&&(d.done.length||d.recovered); }).length;
  // Expedition: sum km/floors across the week
  const isExpedition = c.habits.some(h => h.type === "distance");
  const distHabitW   = isExpedition ? c.habits.find(h => h.type === "distance") : null;
  const isFloorsW    = distHabitW?.unit === "floors";
  const weekKm = isExpedition ? week.allDays.reduce((s,k) => {
    const d = c.days[k];
    if (!d?.distances) return s;
    return s + Object.values(d.distances).reduce((ss,km) => ss + (Number(km)||0), 0);
  }, 0) : null;
  const weekGoal = isExpedition ? null : goalForWeek(c, week.num - 1);
  const goalMet  = weekGoal != null && pts >= weekGoal;
  const fillPct  = weekGoal ? Math.min(100, Math.round(pts / weekGoal * 100)) : 0;
  return `
  <div class="${isCurrent?"week-card week-card-current":"week-card"}">
    <div class="wc-top">
      <span class="wc-num">Week ${week.num}</span>
      <span class="wc-days">${logged}/${week.allDays.length}</span>
    </div>
    <div class="wc-label">${week.label}</div>
    <div class="wc-dots">${week.allDays.map(k=>{
      if(k>today) return `<span class="wdot future"></span>`;
      const d=c.days[k];
      if(!d||(!d.done.length&&!d.recovered)) return `<span class="wdot empty ${k===today?"now":""}"></span>`;
      const inf=completionInfo(c,d);
      if(inf.percent===100) return `<span class="wdot full ${k===today?"now":""}"></span>`;
      return `<span class="wdot partial"></span>`;
    }).join("")}</div>
    <div class="wc-goal-row">
      <span class="wc-pts">${pts}${weekGoal ? `<span class="wc-goal-of">/${weekGoal} pts</span>` : `<span class="wc-goal-of"> pts</span>`}</span>
      ${weekKm !== null
        ? `<span class="wc-km-badge">${isFloorsW ? Math.round(weekKm) : weekKm.toFixed(1)} ${isFloorsW ? "fl" : "km"}</span>`
        : goalMet ? `<span class="wc-goal-hit">✓ Goal</span>` : ""}
    </div>
    ${weekGoal ? `<div class="wc-goal-track"><div class="wc-goal-fill${goalMet ? " wc-goal-done" : ""}" style="width:${fillPct}%"></div></div><div class="wc-points-help">Task values create points. Weekly target is a pacing guide.</div>` : ""}
  </div>`;
}

// ── Month Calendar Heatmap ────────────────────────────────────────────────

function renderMonthCalendar(challenge) {
  const today = todayKey();
  // Determine which month to show
  let refKey = calendarViewMonth;
  if (!refKey) {
    if (today >= challenge.startDate && today <= challenge.endDate) refKey = today;
    else if (today > challenge.endDate) refKey = challenge.endDate;
    else refKey = challenge.startDate;
  }
  const ref       = parseDate(refKey);
  const year      = ref.getFullYear();
  const month     = ref.getMonth();
  const firstDay  = new Date(year, month, 1);
  const lastDay   = new Date(year, month + 1, 0);
  const padStart  = firstDay.getDay(); // 0=Sun

  // Build cells (null = padding)
  const cells = Array.from({length: padStart}, () => null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(toKey(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  // Navigation bounds
  const prevKey = toKey(new Date(year, month - 1, 1));
  const nextKey = toKey(new Date(year, month + 1, 1));
  const hasPrev = prevKey.slice(0,7) >= challenge.startDate.slice(0,7);
  const hasNext = nextKey.slice(0,7) <= (today > challenge.endDate ? challenge.endDate : today).slice(0,7);
  const monthLabel = formatDate(firstDay, { month: "long", year: "numeric" });

  const cellHTML = cells.map(k => {
    if (!k) return `<div class="cal-cell cal-pad"></div>`;
    const dn      = parseDate(k).getDate();
    const outside = k < challenge.startDate || k > challenge.endDate || k > today;
    if (outside) return `<div class="cal-cell cal-outside">${dn}</div>`;
    const day     = challenge.days[k];
    const isToday = k === today;
    const todayCls = isToday ? " cal-today" : "";
    if (!day || (!day.done.length && !day.recovered && day.mode !== "rest" && !day.freezeUsed)) {
      return `<div class="cal-cell cal-missed${todayCls}">${dn}</div>`;
    }
    const info = completionInfo(challenge, day);
    if (day.mode === "rest")                             return `<div class="cal-cell cal-rest${todayCls}"><i class="ti ti-bed"></i></div>`;
    if (day.freezeUsed && !day.done.length)              return `<div class="cal-cell cal-freeze${todayCls}"><i class="ti ti-snowflake"></i></div>`;
    if (info.percent === 100)                            return `<div class="cal-cell cal-full${todayCls}">${dn}</div>`;
    return `<div class="cal-cell cal-partial${todayCls}">${dn}</div>`;
  }).join("");

  return `
  <div class="month-cal">
    <div class="cal-nav">
      <button class="cal-nav-btn${hasPrev?"":" cal-nav-dis"}" data-cal-prev="${prevKey}" ${hasPrev?"":"disabled"}>‹</button>
      <span class="cal-month-label">${monthLabel}</span>
      <button class="cal-nav-btn${hasNext?"":" cal-nav-dis"}" data-cal-next="${nextKey}" ${hasNext?"":"disabled"}>›</button>
    </div>
    <div class="cal-header">
      ${["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=>`<div class="cal-wd">${d}</div>`).join("")}
    </div>
    <div class="cal-grid">${cellHTML}</div>
    <div class="cal-legend">
      <span class="cal-leg full"><i class="ti ti-check"></i> Full</span>
      <span class="cal-leg partial"><i class="ti ti-point-filled"></i> Partial</span>
      <span class="cal-leg rest"><i class="ti ti-bed"></i> Rest</span>
      <span class="cal-leg freeze"><i class="ti ti-snowflake"></i> Frozen</span>
      <span class="cal-leg missed"><i class="ti ti-minus"></i> Missed</span>
    </div>
  </div>`;
}

// ── Builder Quiz ──────────────────────────────────────────────────────────

function getQuizRecommendation(q) {
  const { goal, time, level } = q;
  if (goal === "fitness" && level === "hardcore") return "running";
  if (goal === "fitness" && level === "some") return "cycling";
  if (goal === "fitness") return "walking";
  if (goal === "endurance" && level === "hardcore") return "appalachian";
  if (goal === "endurance" && level === "some") return "camino";
  if (goal === "endurance") return "west-highland-way";
  if (goal === "health") return "zone2";
  if (goal === "explore" && level === "hardcore") return "pct";
  if (goal === "explore" && level === "some") return "camino";
  if (goal === "explore") return "west-highland-way";
  return "walking";
}

function renderBuilderQuiz() {
  const q = builderQuizAnswers;
  const ready = q.goal && q.time && q.level;
  const goalOpts  = [
    { id:"fitness",    label:"Get physically fitter",         icon:"ti-barbell" },
    { id:"endurance",  label:"Train for an event",            icon:"ti-medal" },
    { id:"explore",    label:"Conquer a route or expedition", icon:"ti-map-2" },
  ];
  const timeOpts  = [
    { id:"15", label:"15–30 min" },
    { id:"30", label:"30–60 min" },
    { id:"60", label:"60–90 min" },
    { id:"90", label:"90 min+"  },
  ];
  const levelOpts = [
    { id:"beginner", label:"Beginner — just starting out" },
    { id:"some",     label:"Some experience"              },
    { id:"hardcore", label:"Experienced — I push hard"   },
  ];
  return `
  <div class="builder-quiz">
    <div class="bq-title">Find your challenge</div>
    <div class="bq-sub">3 quick questions → 1 perfect match</div>

    <div class="bq-question">What's your main goal?</div>
    <div class="bq-options">
      ${goalOpts.map(o=>`
      <button class="bq-opt${q.goal===o.id?" bq-opt--active":""}" data-quiz-goal="${o.id}">
        <span class="bq-opt-emoji"><i class="ti ${o.icon}"></i></span>${o.label}
      </button>`).join("")}
    </div>

    <div class="bq-question">How much time can you commit per day?</div>
    <div class="bq-options bq-options--row">
      ${timeOpts.map(o=>`
      <button class="bq-opt bq-opt--sm${q.time===o.id?" bq-opt--active":""}" data-quiz-time="${o.id}">${o.label}</button>`).join("")}
    </div>

    <div class="bq-question">Your experience with fitness challenges?</div>
    <div class="bq-options">
      ${levelOpts.map(o=>`
      <button class="bq-opt${q.level===o.id?" bq-opt--active":""}" data-quiz-level="${o.id}">${o.label}</button>`).join("")}
    </div>

    <button class="primary-button" style="margin-top:20px" data-quiz-find ${ready?"":"disabled style='opacity:.35'"}>
      ${ready ? "Find my challenge →" : "Answer all 3 to continue"}
    </button>
    <div style="text-align:center;margin-top:10px">
      <button class="link-btn" data-quiz-skip>Skip — browse all challenges →</button>
    </div>
  </div>`;
}

// ── Builder ───────────────────────────────────────────────────────────────

function renderBuilder() {
  return `
  <main class="builder-shell${_viewChanged ? " slide-in-right" : ""}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
      <button class="icon-btn" data-close-builder>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
      <div style="font-size:16px;font-weight:700">
        ${builderStep==="quiz"?"Find Your Challenge":builderStep==="template"?"Choose Challenge":builderStep==="quickstart"?"Ready to Start?":"Customise"}
      </div>
    </div>
    ${builderStep==="quiz"              ? renderBuilderQuiz()                 : ""}
    ${builderStep==="template"          ? renderBuilderTemplates()             : ""}
    ${builderStep==="quickstart"        ? renderBuilderQuickstart()            : ""}
    ${builderStep==="customize"         ? renderBuilderCustomize()             : ""}
    ${builderStep==="expedition-custom" ? renderBuilderExpeditionCustomize()   : ""}
  </main>`;
}

// Minimal line-icon (Tabler outline) per challenge — replaces colorful emoji
const CHALLENGE_ICON = {
  "dog-walk":"ti-dog","cycling":"ti-bike","walking":"ti-walk","running":"ti-run",
  "strength":"ti-barbell","yoga-flexibility":"ti-yoga","core-abs":"ti-stretching",
  "c25k":"ti-run","5k-prep":"ti-run","pilates":"ti-stretching","12-3-30":"ti-treadmill",
  "kettlebell":"ti-barbell","calisthenics":"ti-barbell","beginner-strength":"ti-barbell",
  "pushup-challenge":"ti-barbell","pullup-progression":"ti-barbell",
  "zone2":"ti-heart-rate-monitor","hyrox":"ti-stopwatch","half-marathon-prep":"ti-run",
  "marathon-training":"ti-run","10k-prep":"ti-run","swim-foundation":"ti-swimming","swim-1k":"ti-swimming","open-water-prep":"ti-lifebuoy","ironman-703":"ti-swimming",
  "ironman-full":"ti-swimming","tough-mudder":"ti-medal","spartan-race":"ti-medal",
  "weight-loss-30":"ti-scale","body-composition":"ti-scale","glucose-control":"ti-droplet",
  "sleep-tracker":"ti-moon","recovery-reset":"ti-bed","protein-challenge":"ti-meat",
  "fiber-challenge":"ti-leaf","hydration":"ti-droplet","posture-fix":"ti-stretching",
  "everest-bc":"ti-mountain","west-highland-way":"ti-trekking","tour-du-mont-blanc":"ti-mountain",
  "john-muir-trail":"ti-trekking","camino":"ti-trekking","appalachian":"ti-trekking",
  "tour-de-france":"ti-bike","route66":"ti-road","amazon-river":"ti-kayak","pct":"ti-trekking",
  "everest-stairmaster":"ti-stairs","kilimanjaro-stairmaster":"ti-stairs","montblanc-stairmaster":"ti-stairs",
  "comrades-ultra":"ti-run","utmb":"ti-mountain","run-5-marathons":"ti-run","run-jogle":"ti-run",
  "run-trans-america":"ti-run","raid-pyrenees":"ti-bike","trans-am-bike":"ti-bike",
  "thames-row":"ti-kayak","danube-row":"ti-kayak",
};
const CATEGORY_ICON = { movement:"ti-run", endurance:"ti-stopwatch", health:"ti-heart-rate-monitor", expedition:"ti-map-2" };
function challengeIcon(t) { return CHALLENGE_ICON[t.id] || CATEGORY_ICON[t.category] || "ti-target"; }
function scheduleIcon(type) {
  return ({
    easy:"ti-run", tempo:"ti-gauge", long:"ti-road", interval:"ti-bolt", cross:"ti-arrows-cross",
    rest:"ti-bed", strength:"ti-barbell", wod:"ti-stopwatch", simulate:"ti-trophy", combo:"ti-bolt"
  })[type] || "ti-calendar";
}

const FITNESS_EXCLUDED_TEMPLATE_IDS = new Set([
  "reading", "journaling", "meditation", "digital-detox", "creative", "no-spend",
  "declutter", "self-care-30", "gratitude-reset", "mental-health-30", "language-learning",
  "budget-reset", "mindful-eating", "nature-reset", "monk-mode", "project-50",
]);
function renderBuilderTemplates() {
  const cats = [
    { id:"movement",   label:"Movement"    },
    { id:"endurance",  label:"Endurance"   },
    { id:"health",     label:"Health"      },
    { id:"expedition", label:"Expeditions" },
  ];
  const orderedCats = cats;
  const POPULAR_IDS = ["walking","running","cycling","dog-walk","zone2","everest-bc","camino","west-highland-way","pct","route66","danube-row","kilimanjaro-stairmaster"];
  const START_HERE_IDS = ["walking","dog-walk","cycling","running","zone2","west-highland-way","thames-row","everest-bc","camino","comrades-ultra"];
  const filterTabs = [
    { id:"all",      label:"All" },
    { id:"popular",  label:"Popular" },
    { id:"short",    label:"≤30d" },
    { id:"medium",   label:"31–60d" },
    { id:"long",     label:"61d+" },
  ];
  const diffTabs = [
    { id:"all",          label:"All" },
    { id:"beginner",     label:"Beginner" },
    { id:"intermediate", label:"Intermediate" },
    { id:"advanced",     label:"Advanced" },
    { id:"extreme",      label:"Extreme" },
  ];
  const passesFilter = t => {
    if (t.deprecated || FITNESS_EXCLUDED_TEMPLATE_IDS.has(t.id)) return false;
    const dur = _templateFilter;
    const diff = _difficultyFilter;
    if (dur === "popular" && !POPULAR_IDS.includes(t.id)) return false;
    if (dur === "short"   && t.duration > 30)             return false;
    if (dur === "medium"  && (t.duration <= 30 || t.duration > 60)) return false;
    if (dur === "long"    && t.duration <= 60)            return false;
    if (diff !== "all") {
      const d = TEMPLATE_DIFFICULTY[t.id] || "intermediate";
      if (d !== diff) return false;
    }
    return true;
  };
  const templateRow = t => {
    const isExpedition = t.category === "expedition";
    const distHabit    = t.habits?.find(h => h.type === "distance");
    const isFloors     = distHabit?.unit === "floors";
    const MI_PER_KM    = 0.621371;
    const globalDist   = state.settings.units.distance || "km";
    const dUnit        = unitLabelFor(distHabit?.unit);
    const factor       = dUnit === "mi" ? MI_PER_KM : 1;
    const diff     = TEMPLATE_DIFFICULTY[t.id] || "intermediate";
    const meta = isExpedition
      ? `${Math.round(t.routeKm * factor).toLocaleString()} ${dUnit} · ${t.duration} days · ${DIFF_LABEL[diff]}`
      : `${t.duration} days · ${t.defaultMode} · ${DIFF_LABEL[diff]}`;
    const hasSafety = !!TEMPLATE_SAFETY[t.id];
    return `
    <button class="cl-row" data-select-template="${t.id}">
      <i class="ti ${challengeIcon(t)} cl-ic" aria-hidden="true"></i>
      <span class="cl-main">
        <span class="cl-name">${t.name}${hasSafety?`<i class="ti ti-alert-triangle cl-safety" title="Safety note"></i>`:""}</span>
        <span class="cl-meta">${meta}</span>
      </span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`;
  };
  const chip = (active, attr, val, label) =>
    `<button class="cl-chip${active?" active":""}" ${attr}="${val}">${label}</button>`;
  const filterBar = `
  <div class="cl-filters">
    ${filterTabs.map(f => chip(_templateFilter===f.id, "data-template-filter", f.id, f.label)).join("")}
    <button class="cl-chip cl-chip--ghost" data-surprise-me title="Pick a random challenge for me"><i class="ti ti-arrows-shuffle"></i> Surprise</button>
  </div>
  <div class="cl-filters cl-filters--diff">
    ${diffTabs.map(f => chip(_difficultyFilter===f.id, "data-difficulty-filter", f.id, f.label)).join("")}
  </div>`;
  const catBlock = (label, count, rowsHtml) =>
    `<div class="cl-cat"><span class="cl-cat-name">${label}</span><span class="cl-cat-count">${count}</span></div>
     <div class="cl-list">${rowsHtml}</div>`;
  const showStartHere = _templateFilter === "all" && _difficultyFilter === "all";
  const startHereSection = showStartHere ? (() => {
    const picks = START_HERE_IDS.map(id => TEMPLATES.find(t => t.id === id)).filter(Boolean);
    return catBlock("Start here", picks.length, picks.map(templateRow).join(""));
  })() : "";
  const catSections = orderedCats.map(cat => {
    const group = TEMPLATES.filter(t => t.category === cat.id && passesFilter(t));
    if (!group.length) return "";
    const createRow = cat.id === "expedition" ? `
    <button class="cl-row" data-select-template="custom-expedition">
      <i class="ti ti-route cl-ic" aria-hidden="true"></i>
      <span class="cl-main">
        <span class="cl-name">Your Route</span>
        <span class="cl-meta">Any distance · Any duration</span>
      </span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>` : "";
    return catBlock(cat.label, group.length, createRow + group.map(templateRow).join(""));
  }).join("");
  const customSection = _templateFilter === "all" ? catBlock("Custom", 1, `
    <button class="cl-row" data-select-template="custom">
      <i class="ti ti-target cl-ic" aria-hidden="true"></i>
      <span class="cl-main">
        <span class="cl-name">Custom challenge</span>
        <span class="cl-meta">Build your own from scratch</span>
      </span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`) : "";
  return filterBar + startHereSection + catSections + customSection;
}

function renderBuilderExpeditionCustomize() {
  const u = builderForm.expeditionUnit || "km";
  return `
  <div class="builder-header">
    <button class="back-btn" data-builder-back-exp>← Back</button>
    <h2 class="builder-title">Your Expedition</h2>
  </div>
  <div class="exp-form panel">
    <label class="form-label">Name</label>
    <input id="exp-name" class="text-input" value="${esc(builderForm.name || "My Expedition")}" maxlength="60" placeholder="My Expedition">

    <label class="form-label">Marker</label><input id="exp-emoji" class="text-input exp-emoji-input" value="" maxlength="2" placeholder="optional">

    <label class="form-label">Unit</label>
    <div class="exp-unit-row">
      <button class="exp-unit-btn${u==="km"?" active":""}" data-exp-unit="km">km</button>
      <button class="exp-unit-btn${u==="floors"?" active":""}" data-exp-unit="floors">floors</button>
    </div>

    <label class="form-label">Total distance goal</label>
    <div class="exp-distance-row">
      <input id="exp-distance" class="text-input" type="number" min="1" max="99999"
             value="${builderForm.expeditionDistance || 100}" inputmode="decimal">
      <span class="exp-unit-label">${u}</span>
    </div>

    <label class="form-label">Duration (days)</label>
    <input id="exp-duration" class="text-input" type="number" min="1" max="730"
           value="${builderForm.expeditionDuration || 30}" inputmode="numeric">

    <label class="form-label">Start date</label>
    <input id="exp-start" class="text-input" type="date" value="${builderForm.startDate}">

    <button class="primary-button" style="margin-top:24px" data-start-expedition>
      <i class="ti ti-route"></i> Start Expedition</button>
  </div>`;
}

function renderBuilderCustomize() {
  const isCustom = !builderForm.templateId;
  const template = builderForm.templateId ? TEMPLATES.find(t=>t.id===builderForm.templateId) : null;
  return `
  <div class="builder-form">
    ${isCustom ? `
    <label class="field" style="margin-bottom:14px">
      Marker\n      <input id="bf-emoji" type="text" value="" maxlength="2" class="emoji-input" style="width:64px" placeholder="optional">
    </label>` : ""}
    <label class="field" style="margin-bottom:14px">
      Challenge name
      <input id="bf-name" type="text" value="${esc(builderForm.name)}" placeholder="${template?template.name:"My Challenge"}" maxlength="40">
    </label>
    <div class="field-grid" style="margin-bottom:6px">
      <label class="field">Start date<input id="bf-start" type="date" value="${builderForm.startDate}"></label>
      ${builderForm.noEndDate ? `<label class="field" style="opacity:.4">End date<input type="date" disabled value="—"></label>` : `<label class="field">End date<input id="bf-end" type="date" value="${builderForm.endDate}"></label>`}
    </div>
    ${builderForm.startDate < todayKey() ? `<p class="mode-desc" style="margin:-2px 0 10px">Starting in the past — days before today will show as unlogged. That's OK.</p>` : ""}
    <div class="ongoing-toggle" style="margin-bottom:14px">
      <label class="ongoing-toggle-label">
        <input type="checkbox" id="bf-ongoing" ${builderForm.noEndDate?"checked":""} style="width:16px;height:16px;accent-color:var(--accent)">
        <span>Ongoing — no end date</span>
      </label>
    </div>
    <div class="section-label" style="margin:0 0 8px">Challenge Mode</div>
    <div class="mode-selector" style="margin-bottom:6px">
      <button class="mode-button ${builderForm.mode==="soft"?"active":""}" data-bf-mode="soft">Soft</button>
      <button class="mode-button ${builderForm.mode==="strict"?"active":""}" data-bf-mode="strict">Strict</button>
    </div>
    <p class="mode-desc" style="margin-bottom:14px">${builderForm.mode==="soft"?"One grace day allowed if you miss — streak stays alive.":"Zero misses. Every day counts. No exceptions."}</p>
    ${template?.noRestDay ? `
    <div class="joker-budget-row" style="margin-bottom:14px">
      <span class="field-label">Pace</span>
      <span class="mode-desc" style="margin:0">Self-paced. Scale or pause outside the app whenever needed.</span>
    </div>` : `
    <div class="joker-budget-row" style="margin-bottom:14px">
      <div class="field-label">Flex days</div>
      <div class="joker-stepper">
        <button class="joker-step-btn" data-joker-adj="-1">−</button>
        <span class="joker-step-val" id="joker-val">${builderForm.jokerBudget}</span>
        <button class="joker-step-btn" data-joker-adj="1">+</button>
      </div>
      <p class="mode-desc" style="margin:4px 0 0">${builderForm.jokerBudget === 0 ? "No flex days selected." : `${builderForm.jokerBudget} flex day${builderForm.jokerBudget===1?"":"s"} available for life, recovery, or schedule changes.`}</p>
    </div>`}
    ${(() => {
      const tpl = builderForm.templateId ? TEMPLATES.find(t=>t.id===builderForm.templateId) : null;
      const hasWeightHabit = (tpl?.habits || builderForm.habits).some(h => h.unit === "weight" || h.unit === "lbs" || h.unit === "kg");
      if (!hasWeightHabit) return "";
      const wUnit = state.settings.units.weight || "lbs";
      return `<label class="field" style="margin-bottom:14px">
        Goal weight (${wUnit}) <span style="font-size:11px;color:var(--text-dim)">optional — shown as progress in the app</span>
        <input id="bf-goalweight" type="number" value="${builderForm.goalWeight || ""}" min="0" max="999" step="0.1" placeholder="e.g. 150">
      </label>`;
    })()}
    ${(() => {
      const habits = builderForm.templateId
        ? (TEMPLATES.find(t=>t.id===builderForm.templateId)?.habits || [])
        : builderForm.habits;
      const maxPtsPerDay = habits.reduce((s,h) => {
        if (h.type === "tiered" && h.tiers?.length) return s + Math.max(...h.tiers.map(t => t.points ?? t.pts ?? 0));
        return s + (h.points||0);
      }, 0);
      const bonus = habits.length >= 3 ? 3 : 0;
      const ptsPerWeek = (maxPtsPerDay + bonus) * 7;
      return ptsPerWeek > 0 ? `<p class="mode-desc" style="margin-bottom:16px">~${ptsPerWeek} pts/week if all tasks done daily${bonus ? " (incl. +3 completion bonus)" : ""}</p>` : `<p style="margin-bottom:16px"></p>`;
    })()}
    ${template?.routeKm ? `
    <div class="route-info-card">
      <div class="route-info-header">
        <span class="route-info-emoji"><i class="ti ti-route"></i></span>
        <div>
          <div class="route-info-name">${template.name}</div>
          <div class="route-info-km">${template.routeKm.toLocaleString()} km · ${template.milestones.length} milestones</div>
        </div>
      </div>
      <div class="route-milestones-preview">
        ${template.milestones.map(m => `<span class="route-ms-chip"><i class="ti ti-map-pin"></i> ${m.name}</span>`).join("")}
      </div>
      <p class="mode-desc" style="margin:8px 0 0">Log any distance each day — walking, running, cycling, swimming. It all counts toward your route.</p>
    </div>` : `
    <div class="section-label" style="margin:0 0 8px">Tasks (${template?template.habits.length:builderForm.habits.length})</div>
    ${template ? `
      <div class="habit-preview-list">
        ${template.habits.map(h=>`<div class="habit-preview-item"><i class="ti ti-square"></i> ${h.title}</div>`).join("")}
      </div>` : `
      <div class="custom-habits-list">
        ${builderForm.habits.map((h,i)=>`
          <div class="custom-habit-row">
            <span class="custom-habit-emoji"><i class="ti ti-square"></i></span>
            <span class="custom-habit-name">${esc(h.title)}</span>
            <span class="custom-habit-pts">${h.type==="tiered" ? `${h.tiers[0].points??h.tiers[0].pts??0}–${(t=>t.points??t.pts??0)(h.tiers[h.tiers.length-1])}pt` : h.points+"pt"}</span>
            <button class="icon-btn" data-remove-habit="${i}">✕</button>
          </div>`).join("")}
        <div class="add-habit-form">
          <div class="add-habit-top-row">
            <input id="nh-emoji" class="emoji-input" type="text" value="" maxlength="2" placeholder="mark" style="width:46px">
            <input id="nh-name" type="text" value="${esc(builderForm.newHabitName)}" placeholder="Task name" style="flex:1">
            <div class="habit-type-toggle">
              <button class="ht-btn ${builderForm.newHabitType!=="tiered"?"active":""}" data-nh-type="binary">Simple</button>
              <button class="ht-btn ${builderForm.newHabitType==="tiered"?"active":""}" data-nh-type="tiered">Tiered</button>
            </div>
          </div>
          ${builderForm.newHabitType === "tiered" ? `
          <div class="tier-inputs">
            <div class="tier-inputs-header"><span>Label</span><span>Pts</span>${builderForm.newHabitTiers.length>2?"<span></span>":""}</div>
            ${builderForm.newHabitTiers.map((t,i)=>`
            <div class="tier-row">
              <input class="tier-label-input" id="nh-tier-${i}-label" type="text" value="${esc(t.label)}" placeholder="e.g. 1 km">
              <input class="tier-pts-input" id="nh-tier-${i}-pts" type="number" value="${t.points}" min="1" max="20">
              ${builderForm.newHabitTiers.length>2?`<button class="icon-btn" data-nh-remove-tier="${i}" style="font-size:11px">✕</button>`:""}
            </div>`).join("")}
            ${builderForm.newHabitTiers.length<5?`<button class="link-btn" data-nh-add-tier style="font-size:12px;margin-top:2px">+ Add tier</button>`:""}
          </div>` : `
          <div class="tier-inputs-simple">
            <span style="font-size:12px;color:var(--text-dim)">Points</span>
            <input id="nh-pts" type="number" value="${builderForm.newHabitPoints}" min="1" max="20" style="width:60px">
          </div>`}
          <button class="pill-btn" data-add-habit style="margin-top:8px;width:100%">+ Add task</button>
        </div>
      </div>`}
    `}
    <div class="pts-explainer">
      <div class="pts-explainer-title"><i class="ti ti-bolt"></i> How points work</div>
      <div class="pts-explainer-body">Check off tasks to earn points and XP. XP builds your level and never resets. Log 5 days in a week to earn a streak freeze.</div>
    </div>
    ${("Notification" in window) && Notification.permission === "default" ? `
    <div class="builder-notif-request">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px"><i class="ti ti-bell"></i> Enable daily reminders?</div>
      <div class="mode-desc" style="margin-bottom:8px">People who enable reminders are far more likely to finish. Takes one tap.</div>
      <button class="secondary-button" style="width:100%" data-request-notif-from-builder>Enable Reminders</button>
    </div>` : ("Notification" in window) && Notification.permission === "granted" ? `
    <div class="builder-reminder-hint"><i class="ti ti-check"></i> Reminders on - we'll notify you at ${state.settings.reminderTime || "20:00"}.</div>` : `
    <div class="builder-reminder-hint"><i class="ti ti-bell"></i> Enable daily reminders in Settings after you start. It is the best task for actually finishing.</div>`}
    <div class="builder-cta-footer">
      <button class="primary-button" data-start-challenge><i class="ti ti-flag"></i> Start Challenge</button>
      <button class="secondary-button" style="margin-top:8px" data-builder-back>← Back</button>
    </div>
  </div>`;
}

// ── Body Tab ──────────────────────────────────────────────────────────────

function renderBody() {
  const entries = state.bodyTracking.entries;
  const latest  = entries[entries.length-1] ?? null;
  const prev    = entries.length>=2 ? entries[entries.length-2] : null;
  const unit    = state.settings.units.weight;
  const mUnit   = state.settings.units.measurements;
  const cw  = latest?.weight   ?? null;
  const cb  = latest?.bodyFat  ?? null;
  const cl  = latest?.leanMass ?? null;
  const cwa = latest?.waist    ?? null;
  const chi = latest?.hips     ?? null;
  const wDelta  = prev?.weight!=null&&cw!=null   ? cw-prev.weight   : null;
  const bDelta  = prev?.bodyFat!=null&&cb!=null  ? cb-prev.bodyFat  : null;
  const lDelta  = prev?.leanMass!=null&&cl!=null ? cl-prev.leanMass : null;
  const waDelta = prev?.waist!=null&&cwa!=null   ? cwa-prev.waist   : null;
  const hiDelta = prev?.hips!=null&&chi!=null    ? chi-prev.hips    : null;
  return `
  <main>
    <div class="section-label">Body Composition</div>
    ${!entries.length ? `
    <div style="padding:28px 20px;text-align:center;background:var(--surface-2);border-radius:12px;margin-bottom:12px">
      <div class="modal-line-icon"><i class="ti ti-chart-line"></i></div>
      <p style="font-weight:700;margin:0 0 4px">No check-ins yet</p>
      <p style="font-size:13px;color:var(--text-dim);margin:0">Log your first weight below to start tracking your progress.</p>
    </div>` : ""}
    <div class="metric-row">
      ${metricCard("Weight", cw!=null?cw.toFixed(1):"—", unit, wDelta, "weight")}
      ${metricCard("Body fat", cb!=null?cb.toFixed(1):"—", "%", bDelta, "bf")}
      ${metricCard("Lean est.", cl!=null?cl.toFixed(1):cw!=null&&cb!=null?((cw*(1-cb/100)).toFixed(1)):"—", unit, lDelta, "lean")}
    </div>
    <div class="metric-row">
      ${metricCard("Waist", cwa!=null?cwa.toFixed(1):"—", mUnit, waDelta, "waist")}
      ${metricCard("Hips", chi!=null?chi.toFixed(1):"—", mUnit, hiDelta, "hips")}
    </div>
    <div class="chart-card">
      <div class="chart-tabs">
        <button class="chart-tab ${activeChartTab==="weight"?"active":""}" data-chart="weight">Weight</button>
        <button class="chart-tab ${activeChartTab==="bf"?"active":""}" data-chart="bf">Body fat</button>
        <button class="chart-tab ${activeChartTab==="waist"?"active":""}" data-chart="waist">Waist</button>
        <button class="chart-tab ${activeChartTab==="hips"?"active":""}" data-chart="hips">Hips</button>
      </div>
      ${renderBodyChart()}
    </div>
    <div class="section-label">Log Check-in</div>
    <div class="log-card">
      <div class="field-grid">
        <label class="field">Weight (${unit})<input id="weight-input" type="number" step="0.1" inputmode="decimal" placeholder="${unit==="lbs"?"185.0":"84.0"}"></label>
        <label class="field">Body fat %<input id="bf-input" type="number" step="0.1" inputmode="decimal" placeholder="Optional"></label>
      </div>
      <div class="field-grid" style="margin-top:10px">
        <label class="field">Start weight${state.bodyTracking.startWeight!=null?`<span class="field-set-hint">${state.bodyTracking.startWeight} ${unit}</span>`:""}<input id="start-input" type="number" step="0.1" inputmode="decimal" placeholder="${state.bodyTracking.startWeight!=null?"Update…":"Set once"}"></label>
        <label class="field">Goal weight${state.bodyTracking.goalWeight!=null?`<span class="field-set-hint">${state.bodyTracking.goalWeight} ${unit}</span>`:""}<input id="goal-input" type="number" step="0.1" inputmode="decimal" placeholder="${state.bodyTracking.goalWeight!=null?"Update…":"Target"}"></label>
      </div>
      <div class="field-grid" style="margin-top:10px">
        <label class="field">Waist (${mUnit})<input id="waist-input" type="number" step="0.1" inputmode="decimal" placeholder="${mUnit==="cm"?"80.0":"32.0"}"></label>
        <label class="field">Hips (${mUnit})<input id="hips-input" type="number" step="0.1" inputmode="decimal" placeholder="${mUnit==="cm"?"95.0":"37.0"}"></label>
      </div>
      <button class="primary-button" data-log-weight style="margin-top:14px">Log Check-in</button>
    </div>
    ${entries.length ? renderWeighInHistory(entries) : ""}
  </main>`;
}

function metricCard(label, value, unit, delta, type) {
  let deltaClass="", deltaText="No prior data";
  if (delta!==null) {
    const abs=Math.abs(delta).toFixed(1); const arrow=delta<0?"↓":delta>0?"↑":"→";
    deltaText=`${arrow} ${abs} ${unit}`;
    const isGood=(type==="weight"||type==="bf"||type==="waist"||type==="hips")?delta<0:delta>0;
    deltaClass=delta===0?"":isGood?"good":"bad";
  }
  return `<div class="metric-card">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}<span class="metric-unit">${unit}</span></div>
    <div class="metric-delta ${deltaClass}">${deltaText}</div>
  </div>`;
}

function renderBodyChart() {
  const TAB_MAP = { weight:"weight", bf:"bodyFat", waist:"waist", hips:"hips" };
  const UNIT_MAP = {
    weight: state.settings.units.weight, bf:"%",
    waist: state.settings.units.measurements, hips: state.settings.units.measurements,
  };
  const field = TAB_MAP[activeChartTab] || "weight";
  const unit  = UNIT_MAP[activeChartTab] || state.settings.units.weight;
  const points = state.bodyTracking.entries.filter(e=>e[field]!=null).map(e=>({date:e.date,val:e[field]}));
  const metricLabels = { weight:"weight", bf:"body fat %", waist:"waist measurements", hips:"hips measurements" };
  if (points.length<2) return `<div class="chart-empty">Log two check-ins with ${metricLabels[activeChartTab]||"this metric"} to see your trend.</div>`;
  const vals=points.map(p=>p.val); const mn=Math.min(...vals); const mx=Math.max(...vals);
  const rng=Math.max(0.5,mx-mn); const W=300,H=120,P=16;
  const coords=points.map((p,i)=>{
    const x=P+(i/(points.length-1))*(W-P*2);
    const y=(H-P)-((p.val-mn)/rng)*(H-P*2);
    return[x.toFixed(1),y.toFixed(1)];
  });
  const line=coords.map(([x,y],i)=>`${i?"L":"M"} ${x} ${y}`).join(" ");
  const area=`${line} L ${coords[coords.length-1][0]} ${H} L ${coords[0][0]} ${H} Z`;
  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:120px">
    <defs>
      <linearGradient id="cg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" style="stop-color:var(--primary)"/><stop offset="100%" style="stop-color:var(--secondary)"/></linearGradient>
      <linearGradient id="cga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--primary);stop-opacity:0.22"/><stop offset="100%" style="stop-color:var(--secondary);stop-opacity:0"/></linearGradient>
    </defs>
    <path d="${area}" fill="url(#cga)"/>
    <path d="${line}" fill="none" stroke="url(#cg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${coords.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="3" fill="url(#cg)"/>`).join("")}
    <text x="${coords[0][0]}" y="${H-2}" fill="var(--text-dim)" font-size="9" text-anchor="middle">${vals[0].toFixed(1)}</text>
    <text x="${coords[coords.length-1][0]}" y="${H-2}" fill="var(--text-dim)" font-size="9" text-anchor="middle">${vals[vals.length-1].toFixed(1)}</text>
  </svg>`;
}

function renderWeighInHistory(entries) {
  const all=[...entries].reverse();
  const shown=all.slice(0,bodyHistoryLimit);
  const remaining=all.length-bodyHistoryLimit;
  const unit=state.settings.units.weight;
  const mUnit=state.settings.units.measurements;
  return `<div class="section-label">History</div>
  <div class="more-card" style="margin-bottom:0">
    <div class="summary-list">
      ${shown.map(w=>`<div class="summary-row"><span>${w.date}</span>
        <strong>${w.weight} ${unit}${w.bodyFat!=null?` · ${w.bodyFat}% fat`:""}${w.waist!=null?` · ${w.waist} ${mUnit} waist`:""}</strong>
      </div>`).join("")}
    </div>
    ${remaining>0?`<button class="link-btn" data-show-more-history style="margin-top:10px">Show ${remaining} more ↓</button>`:""}
  </div>`;
}

// ── Badges Tab ────────────────────────────────────────────────────────────

function renderLevelProfile() {
  const info  = getLevelInfo(state.xp);
  const isMax = !info.next;
  const toNext = isMax ? 0 : info.next.xp - state.xp;
  return `
  <div class="level-profile-card">
    <div class="lp-top">
      <div class="lp-level-num"><i class="ti ti-bolt"></i> Lv.${info.level}</div>
      <div class="lp-level-name">${info.name}</div>
    </div>
    <div class="xp-bar-track lp-track">
      <div class="xp-bar-fill" style="width:${info.pct}%"></div>
    </div>
    <div class="lp-xp-row">
      <span>${state.xp.toLocaleString()} XP total</span>
      <span class="lp-xp-next">${isMax ? `<i class="ti ti-trophy"></i> Max Level` : `${toNext.toLocaleString()} XP to Lv.${info.next.level}`}</span>
    </div>
    <div class="level-road">
      ${XP_LEVELS.map(lvl => {
        const unlocked = state.xp >= lvl.xp;
        const isCurrent = info.level === lvl.level;
        return `<div class="lvl-node ${unlocked ? "unlocked" : ""} ${isCurrent ? "current" : ""}" title="Lv.${lvl.level} ${getThemedLevelName(lvl.level)}">
          <div class="lvl-node-dot"></div>
          <div class="lvl-node-num">${lvl.level}</div>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

function renderTrophyCase() {
  const trophies = getAllChallenges()
    .filter(c => c.status === "completed")
    .sort((a,b) => (b.completedAt||"").localeCompare(a.completedAt||""));
  if (!trophies.length) return "";
  return `
  <div class="section-label"><i class="ti ti-trophy cat-ic"></i> Trophies</div>
  <div class="more-card trophy-case">
    ${trophies.map(c => {
      const streak = c.personalBest?.streak ?? c.finalStreak ?? 0;
      const perfectDays = c.personalBest?.perfectDays ?? 0;
      const totalPts = c.totalPts || Object.values(c.days).reduce((s,d) => s+(d.pts||0), 0);
      const dateStr = c.completedAt
        ? new Date(c.completedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
        : null;
      const challengeBadges = (TEMPLATE_BADGES[c.templateId] || []).filter(b => c.badges.includes(b.id));
      return `
      <div class="trophy-card">
        <div class="tc-top">
          <span class="tc-emoji"><i class="ti ${c.templateId ? challengeIcon(TEMPLATES.find(t=>t.id===c.templateId) || {id:"",category:""}) : "ti-trophy"}"></i></span>
          <div class="tc-info">
            <div class="tc-name">${esc(c.name)}</div>
            <div class="tc-meta">${streak}-day streak · ${totalPts} pts${dateStr ? ` · ${dateStr}` : ""}</div>
          </div>
        </div>
        ${perfectDays > 0 ? `<div class="tc-sub">${perfectDays} perfect day${perfectDays!==1?"s":""}</div>` : ""}
        ${challengeBadges.length ? `<div class="tc-badges">${challengeBadges.slice(0,5).map(b => `<span class="tc-badge-pill">${b.label}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

function renderChapterOverlay() {
  const level = _chapterOverlay;
  const data  = level ? CHAPTER_LEVELS[level] : null;
  if (!data) return "";
  const icon = level >= 25 ? "ti-trophy" : level >= 20 ? "ti-diamond" : level >= 15 ? "ti-flame" : level >= 10 ? "ti-bolt" : "ti-mountain";
  const levelName = getThemedLevelName(level, state.settings.journeyTheme);
  return `
  <div class="luo-backdrop" data-close-chapter>
    <div class="luo-card" role="dialog" aria-modal="true">
      <div class="luo-burst"><i class="ti ${icon}"></i></div>
      <div class="luo-badge">CHAPTER ${data.title.toUpperCase()}</div>
      <div class="luo-level">Level ${level}</div>
      <div class="luo-name">${levelName}</div>
      <div class="luo-total">${data.msg}</div>
      <button class="primary-button luo-cta" data-close-chapter>Keep going →</button>
    </div>
  </div>`;
}

function renderBadges() {
  const allChallenges    = getAllChallenges();
  // Only show/count template badges for challenges that have been started
  const startedChallenges = allChallenges.filter(c => Object.keys(c.days).length > 0 || c.badges.length > 0);

  // Honest denominator: fixed global pool + per-challenge template sets
  const templateTotal = startedChallenges.reduce((s,c) => s + (TEMPLATE_BADGES[c.templateId]?.length || 0), 0);
  const total  = UNIVERSAL_BADGES.length + LIFETIME_BADGES.length + templateTotal;

  const universalEarned = state.globalBadges.filter(id => UNIVERSAL_BADGES.some(b=>b.id===id)).length;
  const lifetimeEarned  = state.globalBadges.filter(id => LIFETIME_BADGES.some(b=>b.id===id)).length;
  const templateEarned  = allChallenges.reduce((s,c) => s+c.badges.length, 0);
  const earned = universalEarned + lifetimeEarned + templateEarned;

  const pct = total > 0 ? Math.round((earned/total)*100) : 0;
  return `
  <main${_viewChanged ? ` class="tab-fade-in"` : ""}>
    ${renderLevelProfile()}
    <div class="section-label">Badges</div>
    <div class="more-card">
      <div class="badge-overview">
        <div class="badge-overview-count"><span class="boc-num">${earned}</span><span class="boc-total"> / ${total}</span></div>
        <div class="badge-overview-label">badges earned</div>
      </div>
      <div class="badge-overall-track"><div class="badge-overall-fill" style="width:${pct}%"></div></div>
      ${earned === 0 ? `<div class="badges-new-hint">Log your first task to unlock your first badge — most people earn 3–5 in their first week.</div>` : ""}
      ${renderBadgeCat(`<i class="ti ti-world cat-ic"></i> Universal`, UNIVERSAL_BADGES, state.globalBadges, null, { xp: state.xp, maxStreak: Math.max(0, ...getAllChallenges().map(c => calcChallengeStreak(c))) })}
      ${renderBadgeCat(`<i class="ti ti-diamond cat-ic"></i> Lifetime Achievements`, LIFETIME_BADGES, state.globalBadges, null, null)}
      ${startedChallenges.map(c => {
        const tBadges = TEMPLATE_BADGES[c.templateId];
        if (!tBadges) return "";
        const tp = c.templateId ? TEMPLATES.find(t=>t.id===c.templateId) : null;
        return renderBadgeCat(`<i class="ti ${tp?challengeIcon(tp):"ti-target"} cat-ic"></i> ${esc(c.name)}`, tBadges, c.badges, c.templateId, null);
      }).join("")}
    </div>
    ${renderPersonalBests()}
    ${renderTrophyCase()}
    ${renderConsistencyChart(allChallenges)}
  </main>`;
}

function renderConsistencyChart(allChallenges) {
  if (!allChallenges.length) return "";

  const today = todayKey();
  // Find this week's Monday
  const todayD = parseDate(today);
  const dow = todayD.getDay();
  const daysBack = dow === 0 ? 6 : dow - 1;
  const thisMonday = addDays(today, -daysBack);

  const weeks = [];
  for (let w = 7; w >= 0; w--) {
    const weekStart = addDays(thisMonday, -w * 7);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter(d => d <= today);
    let totalPct = 0, counted = 0;
    for (const d of weekDays) {
      for (const c of allChallenges) {
        if (d < c.startDate || (!c.noEndDate && d > c.endDate)) continue;
        const day = c.days[d];
        if (day && day.done?.length > 0) { totalPct += completionInfo(c, day).percent; counted++; }
      }
    }
    const label = w === 0 ? "Now" : `${w}w`;
    weeks.push({ pct: counted ? Math.round(totalPct / counted) : 0, label, hasData: counted > 0 });
  }

  if (weeks.every(w => !w.hasData)) return "";

  return `
  <div class="pchart-section">
    <div class="section-label">Consistency</div>
    <div class="pchart-wrap">
      <div class="pchart-bars">
        ${weeks.map(w => `
        <div class="pchart-col">
          <div class="pchart-bar-outer">
            <div class="pchart-bar" style="height:${w.hasData ? Math.max(6, w.pct) : 0}%"></div>
          </div>
          <div class="pchart-week-label">${w.label}</div>
        </div>`).join("")}
      </div>
    </div>
  </div>`;
}

function renderBadgeCat(label, defs, earned, templateId, progressCtx) {
  const earnedSet = new Set(earned);
  const count = defs.filter(b=>earnedSet.has(b.id)).length;
  const catTier = templateId ? (TEMPLATE_TIERS[templateId] || "common") : null;

  // Progress hints for universal streak/xp badges
  const STREAK_BADGES = { "u-3d":3,"u-7d":7,"u-14d":14,"u-21d":21,"u-30d":30,"u-60d":60,"u-75d":75 };
  const XP_BADGES     = { "u-p10":10,"u-p100":100,"u-p500":500,"u-p1k":1000 };
  function badgeProgressHint(b) {
    if (!progressCtx || earnedSet.has(b.id)) return "";
    if (STREAK_BADGES[b.id] !== undefined) {
      const need = STREAK_BADGES[b.id];
      const have = Math.min(progressCtx.maxStreak, need);
      return `<div class="badge-hint">${have} / ${need} days</div>`;
    }
    if (XP_BADGES[b.id] !== undefined) {
      const need = XP_BADGES[b.id];
      const have = Math.min(progressCtx.xp, need);
      return `<div class="badge-hint">${have} / ${need} XP</div>`;
    }
    return "";
  }

  const renderBadgeTile = (b) => {
    const isEarned = earnedSet.has(b.id);
    if (b.hidden && !isEarned) {
      return `
      <div class="badge badge-hidden">
        <i class="ti ti-lock badge-ic" aria-hidden="true"></i>
        <div class="badge-label">???</div>
        <div class="badge-desc">Hidden badge</div>
      </div>`;
    }
    const tier = catTier || BADGE_TIERS[b.id] || b.tier || "common";
    return `
    <div class="badge ${isEarned?"earned":""}" title="${TIERS[tier]?.label || ""}">
      <i class="ti ${TIER_ICON[tier]||"ti-award"} badge-ic" aria-hidden="true"></i>
      <div class="badge-label">${stripBadgeEmoji(b.label)}</div>
      ${b.desc?`<div class="badge-desc">${b.desc}</div>`:""}
      ${!isEarned ? badgeProgressHint(b) : ""}
    </div>`;
  };

  const earnedDefs  = defs.filter(b =>  earnedSet.has(b.id));
  const lockedDefs  = defs.filter(b => !earnedSet.has(b.id));

  return `
  <div class="badge-cat">
    <div class="badge-cat-header">
      <span class="badge-cat-name">${label}</span>
      <span class="badge-cat-count">${count} / ${defs.length}</span>
    </div>
    ${earnedDefs.length ? `<div class="badge-grid">${earnedDefs.map(renderBadgeTile).join("")}</div>` : ""}
    ${lockedDefs.length ? `<div class="badge-grid badge-grid--locked">${lockedDefs.map(renderBadgeTile).join("")}</div>` : ""}
  </div>`;
}

function renderNotifPrompt() {
  const curTime = state.settings.reminderTime || "20:00";
  return `
  <div class="notif-prompt-overlay">
    <div class="notif-prompt-backdrop" data-notif-prompt-skip></div>
    <div class="notif-prompt" role="dialog" aria-modal="true">
      <div class="notif-prompt-icon"><i class="ti ti-bell"></i></div>
      <div class="notif-prompt-title">Day 1 done — great start!</div>
      <div class="notif-prompt-sub">People with daily reminders are 3× more likely to finish. When should we nudge you?</div>
      <div class="notif-time-row">
        <label class="notif-time-label">Reminder time</label>
        <input type="time" id="notif-time-input" class="notif-time-input" value="${curTime}">
      </div>
      <button class="primary-button" style="margin-top:16px" data-notif-prompt-enable>Enable Reminders</button>
      <p class="notif-caveat">Works while the app is open in your browser. Cannot deliver when your phone is locked or browser is closed.</p>
      <button class="link-btn notif-prompt-skip-btn" data-notif-prompt-skip>I'll risk forgetting →</button>
    </div>
  </div>`;
}

function renderBadgeSheet(badge) {
  const queue = _badgeSheetQueue;
  if (queue.length > 1) {
    return `
  <div class="badge-sheet-overlay" data-close-badge-sheet>
    <div class="badge-sheet" role="dialog" aria-modal="true" aria-label="Badges earned">
      <div class="badge-sheet-icon"><i class="ti ti-medal"></i></div>
      <div class="badge-sheet-tier" style="color:var(--accent)">${queue.length} Badges Unlocked</div>
      <div class="badge-sheet-title">Achievement haul</div>
      <div class="multi-badge-list">
        ${queue.map(b => {
          return `<div class="mbl-row">
            <div class="mbl-icon"><i class="ti ${TIER_ICON[b.tier]||"ti-award"}"></i></div>
            <div class="mbl-body">
              <div class="mbl-label">${esc(stripBadgeEmoji(b.label))}</div>
              ${b.desc ? `<div class="mbl-desc">${esc(b.desc)}</div>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
      <button class="primary-button badge-sheet-cta" data-close-badge-sheet>Awesome!</button>
    </div>
  </div>`;
  }
  const td = TIERS[badge.tier] || TIERS.common;
  const title = stripBadgeEmoji(badge.label);
  return `
  <div class="badge-sheet-overlay" data-close-badge-sheet>
    <div class="badge-sheet" role="dialog" aria-modal="true" aria-label="Badge earned">
      <div class="badge-sheet-icon"><i class="ti ${TIER_ICON[badge.tier]||"ti-award"}"></i></div>
      <div class="badge-sheet-tier" style="color:var(--accent)">${td.label}</div>
      <div class="badge-sheet-title">${esc(title)}</div>
      <div class="badge-sheet-desc">${esc(badge.desc)}</div>
      <div class="badge-sheet-congrats">Achievement unlocked</div>
      <button class="primary-button badge-sheet-cta" data-close-badge-sheet>Awesome!</button>
    </div>
  </div>`;
}

function shouldShowBackupNudge(challenge) {
  if (localStorage.getItem("endur_backup_nudge_dismissed")) return false;
  if (CloudSync.isSignedIn) return false;
  return challengeDayNumber(challenge) >= 7;
}

function renderBackupNudge(challenge) {
  if (!shouldShowBackupNudge(challenge)) return "";
  return `
  <div class="backup-nudge">
    <button class="backup-nudge-close" data-dismiss-backup-nudge aria-label="Dismiss">×</button>
    <div class="backup-nudge-icon"><i class="ti ti-cloud-upload"></i></div>
    <div class="backup-nudge-body">
      <div class="backup-nudge-title">Protect your progress</div>
      <div class="backup-nudge-sub">You've built a solid streak — back it up so you never lose it.</div>
    </div>
    <button class="secondary-button" style="margin-top:8px;width:100%" data-preview-onboarding>Back up free →</button>
  </div>`;
}

function renderMoodNote(day) {
  const MOODS = [
    { key:"great", emoji:"😄", label:"Great" },
    { key:"good",  emoji:"🙂", label:"Good"  },
    { key:"okay",  emoji:"😐", label:"Okay"  },
    { key:"rough", emoji:"😕", label:"Rough"  },
    { key:"bad",   emoji:"😩", label:"Bad"   },
  ];
  const cur = day.mood || null;
  const note = day.note || "";
  return `
  <div class="mood-note-card">
    <div class="mood-row">
      <span class="mood-label">How's today going?</span>
      <div class="mood-emojis">
        ${MOODS.map(m => `<button class="mood-btn${cur===m.key?" mood-selected":""}" data-mood="${m.key}" title="${m.label}" aria-label="${m.label}" aria-pressed="${cur===m.key}">${m.emoji}</button>`).join("")}
      </div>
    </div>
    <textarea class="day-note-input" placeholder="Add a note (optional)…" maxlength="280" data-day-note>${esc(note)}</textarea>
  </div>`;
}

function renderChallengeMetricChart(challenge) {
  const measHabits = challenge.habits.filter(h => h.type === "measurement");
  if (!measHabits.length) return "";
  const dayEntries = Object.entries(challenge.days)
    .filter(([, d]) => d.distances && measHabits.some(h => (d.distances[h.id] || 0) > 0))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30);
  const activeId = (_measChartTab && measHabits.find(h => h.id === _measChartTab))
    ? _measChartTab : measHabits[0].id;
  const habit = measHabits.find(h => h.id === activeId);
  const unit = habit.unit === "weight" ? (state.settings.units.weight || "kg") : habit.unit;
  const points = dayEntries.map(([, d]) => d.distances?.[activeId] || 0).filter(v => v > 0);
  return `
  <div class="meas-chart-card">
    ${measHabits.length > 1 ? `<div class="meas-chart-tabs">${measHabits.map(h =>
      `<button class="meas-chart-tab${h.id === activeId ? " active" : ""}" data-meas-tab="${h.id}">${esc(h.title.replace(/^Log /, ""))}</button>`
    ).join("")}</div>` : `<div class="meas-chart-label">📈 ${esc(habit.title)}</div>`}
    ${renderMeasurementChartSVG(points, unit, habit.unit === "weight" || habit.unit === "%")}
    ${dayEntries.length >= 2 ? `<div class="meas-chart-hint">Last 30 loggedrlier ← → recent</div>` : ""}
  </div>`;
}

function renderMeasurementChartSVG(points, unit, lowerIsBetter) {
  if (points.length < 2) return `<div class="chart-empty" style="padding:20px 0;font-size:12px">Log 2 check-ins with this metric to see your trend.</div>`;
  const mn = Math.min(...points), mx = Math.max(...points);
  const rng = Math.max(0.5, mx - mn);
  const W = 300, H = 110, P = 18;
  const coords = points.map((v, i) => {
    const x = P + (i / (points.length - 1)) * (W - P * 2);
    const y = (H - P) - ((v - mn) / rng) * (H - P * 2 - 14);
    return [x.toFixed(1), y.toFixed(1)];
  });
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
  const area = `${line} L ${coords[coords.length-1][0]} ${H} L ${coords[0][0]} ${H} Z`;
  const delta = points[points.length-1] - points[0];
  const isGood = lowerIsBetter ? delta <= 0 : delta >= 0;
  const arrow = delta < 0 ? "↓" : delta > 0 ? "↑" : "→";
  const deltaStr = `${arrow} ${Math.abs(delta).toFixed(1)} ${unit}`;
  return `
  <svg class="meas-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="mcg${W}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" style="stop-color:var(--primary)"/><stop offset="100%" style="stop-color:var(--secondary)"/></linearGradient>
      <linearGradient id="mcga${W}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" style="stop-color:var(--primary);stop-opacity:0.18"/><stop offset="100%" style="stop-color:var(--primary);stop-opacity:0"/></linearGradient>
    </defs>
    <path d="${area}" fill="url(#mcga${W})"/>
    <path d="${line}" fill="none" stroke="url(#mcg${W})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${coords[0][0]}" cy="${coords[0][1]}" r="3" fill="url(#mcg${W})"/>
    <circle cx="${coords[coords.length-1][0]}" cy="${coords[coords.length-1][1]}" r="3.5" fill="url(#mcg${W})"/>
    <text x="${coords[0][0]}" y="${H - 2}" fill="var(--text-dim)" font-size="9" text-anchor="middle">${points[0].toFixed(1)}</text>
    <text x="${coords[coords.length-1][0]}" y="${H - 2}" fill="var(--text-dim)" font-size="9" text-anchor="middle">${points[points.length-1].toFixed(1)}</text>
  </svg>
  <div class="meas-chart-delta ${delta === 0 ? "" : isGood ? "good" : "bad"}">${deltaStr}</div>`;
}

function renderAlmostThereBadge(challenge, streak) {
  const milestones = [7, 14, 21, 30, 50, 75];
  const allBadges = [...(challenge.badges || []), ...(state.globalBadges || [])];
  const next = milestones.find(m => {
    if (m > streak && (m - streak) <= 2) {
      // Skip if the streak badge for this milestone is already earned
      const badgeId = `streak-${m}`;
      return !allBadges.includes(badgeId);
    }
    return false;
  });
  if (!next) return "";
  const diff = next - streak;
  return `<div class="almost-badge-chip">🏅 ${diff === 1 ? "One more day" : "2 days"} to unlock your ${next}-day badge!</div>`;
}

// ── Settings ──────────────────────────────────────────────────────────────

// ── Onboarding ────────────────────────────────────────────────────────────

const ONBOARDING_STEPS = [
  { icon:"ti-target", title:"Pick a challenge",  body:"Choose from 55+ challenges — from a daily walk to the Pacific Crest Trail. Each one comes with daily tasks to check off." },
  { icon:"ti-bolt", title:"Earn points daily",  body:"Every task you check earns points and XP. XP builds your level — it never resets. Log 5 days in a week and you'll bank a streak freeze." },
  { icon:"ti-flame", title:"Come back tomorrow", body:"Your streak grows every day you log. Miss a day? Soft mode gives you grace. Move at your own pace. One day at a time." },
];
// onboardingStep: 0=hero, 2=goal, 3–(2+N)=info slides (N=ONBOARDING_STEPS.length), +3=name, +4=account (step 1/journey removed; hero skips 1→2)

function renderObHero() {
  const theme = JOURNEY_THEMES[state.settings.journeyTheme] || JOURNEY_THEMES.endur;
  return `
  <div class="ob-screen" role="main">
    <div class="ob-hero-top">
      <div class="ob-hero-icon" aria-hidden="true"><i class="ti ti-flame"></i></div>
      <div class="ob-hero-logo">ENDUR</div>
      <div class="ob-hero-tagline">${theme.tagline}.</div>
    </div>
    <ul class="ob-features" aria-label="App features">
      <li class="ob-feature"><span class="ob-feature-icon" aria-hidden="true"><i class="ti ti-mountain"></i></span><span>55+ challenges — from daily walks to epic trails</span></li>
      <li class="ob-feature"><span class="ob-feature-icon" aria-hidden="true"><i class="ti ti-stopwatch"></i></span><span>Daily points, streaks &amp; badges</span></li>
      <li class="ob-feature"><span class="ob-feature-icon" aria-hidden="true"><i class="ti ti-flame"></i></span><span>Self-paced challenges with streak protection</span></li>
      <li class="ob-feature"><span class="ob-feature-icon" aria-hidden="true"><i class="ti ti-lock"></i></span><span>Works offline — no account required</span></li>
    </ul>
    <button class="primary-button ob-cta" data-ob-next>Let's go →</button>
    <button class="link-btn ob-link" data-ob-to-signin>Already have an account? Sign in</button>
  </div>`;
}

function renderObGoal() {
  const goals = [
    { icon:"ti-walk",               label:"Get Active",        desc:"Walking, running, cycling",             template:"walking" },
    { icon:"ti-map-2",              label:"Conquer a Route",   desc:"Camino, West Highland Way, PCT",        template:"camino" },
    { icon:"ti-mountain",           label:"Climb a Mountain",  desc:"Everest, Kilimanjaro, Mont Blanc",      template:"everest-bc" },
    { icon:"ti-bike",               label:"Go the Distance",   desc:"Cycle across a country",                template:"cycling" },
    { icon:"ti-heart-rate-monitor", label:"Build Endurance",   desc:"Zone 2 base-building hours",            template:"zone2" },
  ];
  return `
  <div class="ob-screen ob-screen--slide" role="main">
    <div class="ob-slide-inner">
      <div class="ob-emoji" aria-hidden="true"><i class="ti ti-target"></i></div>
      <div class="ob-title">What's your main goal?</div>
      <div class="ob-body">We'll open your recommended challenge — ready to start.</div>
    </div>
    <div class="ob-goal-grid">
      ${goals.map(g => `
      <button class="ob-goal-btn" data-ob-goal="${g.template}">
        <span class="ob-goal-emoji"><i class="ti ${g.icon}"></i></span>
        <div class="ob-goal-info">
          <div class="ob-goal-label">${g.label}</div>
          <div class="ob-goal-desc">${g.desc}</div>
        </div>
        <span class="ob-goal-arrow">→</span>
      </button>`).join("")}
    </div>
    <button class="link-btn ob-link" data-ob-next>Skip — I'll choose myself →</button>
  </div>`;
}

function renderObSlide() {
  const theme = JOURNEY_THEMES[state.settings.journeyTheme] || JOURNEY_THEMES.endur;
  const slides = [
    { icon:"ti-target", title:"Pick a challenge",
      body:`55+ challenges — from a daily 5K to the Pacific Crest Trail. Each one comes with daily tasks to check off.` },
    { icon:"ti-bolt", title:"Log. Earn. Level up.",
      body:`Every habit earns XP. You start as a <strong>${theme.levels[0]}</strong> and climb all the way to <strong>${theme.levels[24]}</strong>. Your progress never resets.`,
      extra:`<div class="ob-ring-demo" aria-hidden="true"><div class="ob-ring-demo-pct">68%</div></div>` },
    { icon:"ti-flame", title:"Show up every day.",
      body:`Your streak grows with every logged day. Move at your own pace. One day at a time.` },
  ];
  const step = slides[onboardingStep - 3];
  const dots = ONBOARDING_STEPS.map((_,i) =>
    `<span class="ob-dot ${i === onboardingStep - 3 ? "active" : ""}"></span>`).join("");
  const isLast = onboardingStep === ONBOARDING_STEPS.length + 2;
  return `
  <div class="ob-screen ob-screen--slide" role="main">
    <div class="ob-slide-inner">
      <div class="ob-emoji" aria-hidden="true"><i class="ti ${step.icon}"></i></div>
      <div class="ob-title">${step.title}</div>
      <div class="ob-body">${step.body}</div>
      ${step.extra || ""}
    </div>
    <div class="ob-dots" aria-hidden="true">${dots}</div>
    <button class="primary-button ob-cta" data-ob-next>${isLast ? "Let's go →" : "Next →"}</button>
    <button class="link-btn ob-link" data-ob-skip>Skip intro →</button>
  </div>`;
}

function renderObName() {
  const saved = state.settings.name || "";
  return `
  <div class="ob-screen ob-screen--slide" role="main">
    <div class="ob-slide-inner">
      <div class="ob-emoji" aria-hidden="true"><i class="ti ti-user"></i></div>
      <div class="ob-title">What should we call you?</div>
      <div class="ob-body">We'll use your name to cheer you on along the way.</div>
    </div>
    <div class="ob-form">
      <label class="field ob-field">
        First name
        <input id="ob-name" type="text" placeholder="Your name" autocomplete="given-name" value="${esc(saved)}">
      </label>
      <button class="primary-button ob-cta" data-ob-save-name>Continue →</button>
    </div>
    <button class="link-btn ob-link ob-link--faint" data-ob-skip-name>Skip</button>
  </div>`;
}

function renderObAccount() {
  const isSignin = _obAuthMode === "signin";
  // Forgot password sub-screen
  if (_forgotPwMode) {
    return `
  <div class="ob-screen ob-screen--account" role="main">
    <div class="ob-slide-inner">
      <div class="ob-emoji" aria-hidden="true"><i class="ti ti-key"></i></div>
      <div class="ob-title">Reset your password</div>
      <div class="ob-body">Enter your email and we'll send you a reset link.</div>
    </div>
    ${_obAuthError ? `<div class="ob-auth-error">${esc(_obAuthError)}</div>` : ""}
    ${_obAuthLoading ? `<div class="ob-loading">Sending…</div>` : `
    <div class="ob-form">
      <label class="field ob-field">
        Email
        <input id="ob-reset-email" type="email" placeholder="your@email.com" autocomplete="email" inputmode="email">
      </label>
      <button class="primary-button ob-cta" data-ob-forgot-submit>Send reset link</button>
    </div>`}
    <button class="link-btn ob-link" data-ob-forgot-cancel>← Back to sign in</button>
  </div>`;
  }
  return `
  <div class="ob-screen ob-screen--account" role="main">
    <div class="ob-slide-inner">
      <div class="ob-emoji" aria-hidden="true"><i class="ti ti-cloud-upload"></i></div>
      <div class="ob-title">${isSignin ? "Welcome back" : "Save your progress"}</div>
      <div class="ob-body">${isSignin
        ? "Sign in to restore your challenges, streaks and badges."
        : "Create a free account so your data survives a reinstall or new phone."}</div>
    </div>
    ${_obAuthError ? `<div class="ob-auth-error">${esc(_obAuthError)}</div>` : ""}
    ${_obAuthLoading
      ? `<div class="ob-loading">One moment…</div>`
      : `<div class="ob-form">
          <label class="field ob-field">
            Email
            <input id="ob-email" type="email" placeholder="your@email.com" autocomplete="email" inputmode="email">
          </label>
          <label class="field ob-field">
            Password${!isSignin ? ` <span class="ob-pw-hint">(min 8 characters)</span>` : ""}
            <input id="ob-password" type="password" placeholder="••••••••" autocomplete="${isSignin ? "current-password" : "new-password"}">
          </label>
          <button class="primary-button ob-cta" data-ob-auth>${isSignin ? "Sign In" : "Create Account"}</button>
          ${isSignin ? `<button class="link-btn ob-link ob-link--faint" style="margin-top:4px" data-ob-forgot>Forgot password?</button>` : ""}
        </div>`}
    <button class="link-btn ob-link" data-ob-toggle-auth>
      ${isSignin ? "No account yet? Create one" : "Already have an account? Sign in"}
    </button>
    <button class="link-btn ob-link ob-link--faint" data-ob-skip-account>Skip — use offline</button>
    ${!isSignin ? `<p class="ob-privacy-note">By creating an account you agree to our <a href="/privacy.html" target="_blank" class="ob-privacy-link">Privacy Policy</a>.</p>` : ""}
  </div>`;
}

function renderOnboarding() {
  if (onboardingStep === null) return "";
  if (onboardingStep === 0) return renderObHero();
  if (onboardingStep === 2) return renderObGoal();
  if (onboardingStep <= ONBOARDING_STEPS.length + 2) return renderObSlide();
  if (onboardingStep === ONBOARDING_STEPS.length + 3) return renderObName();
  return renderObAccount();
}

function renderSafetyModal() {
  const t = _safetyPendingTemplateId ? TEMPLATES.find(t2 => t2.id === _safetyPendingTemplateId) : null;
  if (!t) return "";
  const warning = TEMPLATE_SAFETY[t.id];
  return `
  <div class="sheet-backdrop" data-safety-backdrop>
    <section class="sheet" role="dialog" style="max-width:400px">
      <div class="modal-line-icon"><i class="ti ti-alert-triangle"></i></div>
      <div style="font-size:18px;font-weight:500;text-align:center;margin-bottom:14px">Health Notice</div>
      <div style="font-size:14px;color:var(--text);line-height:1.65;margin-bottom:16px">${warning}</div>
      <div style="font-size:12px;color:var(--text-dim);line-height:1.55;margin-bottom:22px;padding:10px 12px;background:var(--surface-2,var(--surface));border-radius:8px">Endur is made for doing challenges at your own pace. The app tracks effort; it does not prescribe training, recovery, or medical advice. Adjust, pause, repeat, or stop as needed, and seek medical advice before starting if you have relevant health conditions.</div>
      <button class="primary-button" data-safety-confirm>I understand - Start ${esc(t.name)}</button>
      <button class="secondary-button" data-safety-dismiss style="margin-top:8px">Go back</button>
    </section>
  </div>`;
}

function renderDataSettings() {
  return `
  <div class="section-label" style="margin-top:20px">Data</div>
  ${!CloudSync.isSignedIn ? `
  <div style="background:rgba(234,179,8,0.1);border:1px solid rgba(234,179,8,0.35);border-radius:10px;padding:12px 14px;margin-bottom:12px;display:flex;gap:10px;align-items:flex-start">
    <span style="font-size:18px;flex-shrink:0"><i class="ti ti-alert-triangle"></i></span>
    <div>
      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">Your data is local only</div>
      <div style="font-size:12px;color:var(--text-dim);line-height:1.5">Progress is stored on this device. If you clear your browser or switch devices, it will be lost. <button class="link-btn" data-preview-onboarding style="font-size:12px">Sign in to back up →</button></div>
    </div>
  </div>` : ""}
  <div class="more-card">
    <div style="font-size:13px;color:var(--text-dim);margin-bottom:12px">Export a full backup of your challenges, body tracking, and badges as a JSON file.</div>
    <button class="secondary-button" data-export-data>Export backup ↓</button>
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px">Restore from a previously exported backup.</div>
      <label class="secondary-button" style="display:inline-block;cursor:pointer">
        Restore backup ↑
        <input type="file" id="import-file-input" accept=".json" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">
      </label>
      <div style="font-size:12px;color:var(--text-dim);margin-top:8px"><i class="ti ti-alert-triangle"></i> Restoring will overwrite all current data.</div>
    </div>
  </div>
  ${CloudSync.isSignedIn ? `
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
    ${_resetConfirm ? `
      <div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:10px;padding:14px">
        <div style="font-size:13px;font-weight:700;color:#f87171;margin-bottom:6px">Delete account?</div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">All challenges, XP, badges, streaks, and settings will be permanently deleted and your account removed. This cannot be undone.</div>
        <div style="display:flex;gap:8px">
          <button class="secondary-button" data-reset-cancel style="flex:1">Cancel</button>
          <button class="primary-button" data-reset-confirm style="flex:1;background:#dc2626;border-color:#dc2626">Yes, delete account</button>
        </div>
      </div>` : `
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px">Permanently delete your account and all data.</div>
      <button class="secondary-button" data-reset-app style="color:#f87171;border-color:rgba(220,38,38,0.4)">Delete account</button>`}
  </div>` : ""}
  <div style="margin-top:20px;text-align:center">
    <a href="/privacy.html" target="_blank" style="font-size:12px;color:var(--text-dim);text-decoration:none">Privacy Policy</a>
    <span style="font-size:12px;color:var(--text-faint);margin:0 8px">·</span>
    <span style="font-size:12px;color:var(--text-faint)">v${APP_VERSION}</span>
  </div>
  <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);text-align:center">
    <button class="link-btn" style="font-size:12px;color:var(--text-dim)" data-preview-onboarding>Replay intro screens</button>
  </div>`;
}

function renderReminderSettings() {
  const supported = "Notification" in window;
  const perm    = supported ? Notification.permission : "unsupported";
  const enabled = state.settings.reminderEnabled;
  const time    = state.settings.reminderTime || "20:00";
  let body = "";
  if (!supported) {
    body = `<p class="reminder-note">Your browser doesn't support notifications.</p>`;
  } else if (perm === "denied") {
    const ua = navigator.userAgent;
    const isChrome  = /Chrome/.test(ua) && !/Edg/.test(ua) && !/OPR/.test(ua);
    const isFirefox = /Firefox/.test(ua);
    const isSafari  = /Safari/.test(ua) && !/Chrome/.test(ua);
    const isEdge    = /Edg/.test(ua);
    let steps = isChrome
      ? `Click the <strong>lock icon</strong> in your address bar → <strong>Notifications</strong> → <strong>Allow</strong>`
      : isEdge
      ? `Click the <strong>lock icon</strong> in your address bar → <strong>Permissions for this site</strong> → Notifications → <strong>Allow</strong>`
      : isFirefox
      ? `Click the <strong>shield icon</strong> in your address bar → <strong>Permissions</strong> → Allow Notifications`
      : isSafari
      ? `Go to <strong>Safari menu → Settings for This Website → Notifications → Allow</strong>`
      : `Click the icon next to the address bar → find <strong>Notifications</strong> → set to <strong>Allow</strong>`;
    body = `
    <div style="text-align:center;padding:8px 0">
      <div class="settings-line-icon"><i class="ti ti-bell-off"></i></div>
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:8px">Notifications are blocked</div>
      <div style="font-size:13px;color:var(--text-dim);line-height:1.6;margin-bottom:14px">${steps}, then tap the button below.</div>
      <button class="secondary-button" style="width:100%" onclick="window.location.reload()">I've enabled them — reload ↻</button>
    </div>`;
  } else if (perm === "default") {
    body = `<button class="primary-button" data-request-notif-permission>Enable reminders</button>
            <p class="reminder-note" style="margin-top:8px">We'll nudge you once a day if habits are still open.</p>`;
  } else {
    body = `
    <div class="reminder-row">
      <div>
        <div style="font-size:14px;font-weight:700">Daily reminder</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px">Fires when today's habits are incomplete</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" ${enabled ? "checked" : ""} data-toggle-reminder>
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
    ${enabled ? `
    <label class="field" style="margin-top:12px">
      Remind me at
      <input id="reminder-time" type="time" value="${time}">
    </label>
    <button class="secondary-button" data-save-reminder style="margin-top:10px">Save time</button>` : ""}`;
  }
  return `
  <div class="section-label" style="margin-top:20px">Reminders</div>
  <div class="more-card">${body}</div>`;
}

function renderProSection() {
  if (CloudSync.isSignedIn) {
    // Already a member — show compact "Pro" badge + sync controls
    return `
    <div class="section-label"><i class="ti ti-cloud-upload cat-ic"></i> Cloud Backup</div>
    <div class="more-card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:18px"><i class="ti ti-check"></i></span>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text)">${esc(CloudSync.userEmail || "")}</div>
          <div style="font-size:11px;color:var(--text-dim)">Data auto-syncs after each save</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="secondary-button" style="flex:1" data-cloud-sync>${_cloudAuthLoading?"Syncing…":"Sync Now"}</button>
        <button class="secondary-button" style="flex:1" data-cloud-signout>Sign Out</button>
      </div>
    </div>`;
  }
  return `
  <div class="section-label"><i class="ti ti-cloud-upload cat-ic"></i> Cloud Backup</div>
  <div class="more-card" style="margin-bottom:14px">
    <div style="font-size:13px;color:var(--text-dim);margin-bottom:14px">Back up your progress and sync across devices. Your streaks, badges, and challenges stay safe even if you clear your browser.</div>
    ${_cloudAuthError ? `<div class="cloud-auth-error">${esc(_cloudAuthError)}</div>` : ""}
    ${_cloudAuthLoading ? `<div style="text-align:center;padding:12px;color:var(--text-dim);font-size:14px">Loading…</div>` : `
    <label class="field" style="margin-bottom:10px">
      Email
      <input id="cloud-email" type="email" placeholder="your@email.com" autocomplete="email" inputmode="email">
    </label>
    <label class="field" style="margin-bottom:14px">
      Password <span style="font-size:11px;font-weight:500;color:var(--text-dim)">(min 8 characters)</span>
      <input id="cloud-password" type="password" placeholder="Choose a password" autocomplete="new-password">
    </label>
    <div style="display:flex;gap:8px">
      <button class="secondary-button" style="flex:1" data-cloud-signin>Sign In</button>
      <button class="primary-button" style="flex:1" data-cloud-signup>Create Account →</button>
    </div>
    <button class="link-btn" style="font-size:12px;color:var(--text-dim);margin-top:10px" data-cloud-forgot>Forgot password?</button>`}
  </div>`;
}

function renderCloudSync() { return ""; }

function renderSettings() {
  const u = state.settings.units;
  return `
  <main${_viewChanged ? ` class="slide-in-right"` : ""}>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
      <button class="icon-btn" data-close-settings>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
      <div style="font-size:16px;font-weight:700">Settings</div>
    </div>
    <div class="section-label">Your Name</div>
    <div class="log-card" style="margin-bottom:14px">
      <label class="field">Name<input id="s-name" type="text" value="${esc(state.settings.name)}" placeholder="Optional" data-autosave-name></label>
    </div>
    <div class="section-label">Units</div>
    <div class="more-card">
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px">Distance</div>
        <div class="mode-selector">
          <button class="mode-button ${u.distance==="km"?"active":""}" data-unit-distance="km">km</button>
          <button class="mode-button ${u.distance==="miles"?"active":""}" data-unit-distance="miles">miles</button>
        </div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px">Weight</div>
        <div class="mode-selector">
          <button class="mode-button ${u.weight==="kg"?"active":""}" data-unit-weight="kg">kg</button>
          <button class="mode-button ${u.weight==="lbs"?"active":""}" data-unit-weight="lbs">lbs</button>
        </div>
      </div>
    </div>
    <div class="section-label" style="margin-top:20px">How Endur Works</div>
    <div class="more-card" style="font-size:13px;line-height:1.65;color:var(--text-dim)">
      <div style="margin-bottom:12px"><strong style="color:var(--text)"><i class="ti ti-target"></i> Challenges</strong> — Pick one of 55+ challenges. Each has daily tasks to check off. Complete all tasks for the day to earn full points.</div>
      <div style="margin-bottom:12px"><strong style="color:var(--text)"><i class="ti ti-bolt"></i> Points &amp; XP</strong> — Each habit is worth points. Points fuel your XP, which builds your level and never resets. Log 5 days in a week to bank a streak freeze.</div>
      <div style="margin-bottom:12px"><strong style="color:var(--text)"><i class="ti ti-flame"></i> Streaks</strong> - Your streak grows when you log the day. Soft mode gives you one grace day before it breaks.</div>
      <div style="margin-bottom:12px"><strong style="color:var(--text)"><i class="ti ti-route"></i> Your Pace</strong> - Endur is a tracker, not a coach. Repeat days, reduce volume, pause, or take recovery whenever your body or schedule needs it.</div>
      <div style="margin-bottom:12px"><strong style="color:var(--text)"><i class="ti ti-bolt"></i> XP &amp; Levels</strong> — XP accumulates from points across all challenges and never resets. Climb from Starting Line to Endur Athlete.</div>
      <div style="margin-bottom:12px"><strong style="color:var(--text)"><i class="ti ti-mountain"></i> Phases</strong> — Longer challenges are split into phases so the finish line always feels reachable. Each phase completion is celebrated.</div>
      <div><strong style="color:var(--text)"><i class="ti ti-medal"></i> Badges</strong> — Earn badges for streaks, consistency, and challenge completions. Proof of everything you've built.</div>
    </div>
    ${renderProSection()}
    ${renderReminderSettings()}
    ${renderDataSettings()}
  </main>`;
}

// ── Dynamic Visuals ───────────────────────────────────────────────────────

function updateRingVisuals() {
  const ring = document.querySelector(".ring-value");
  if (!ring) return;
  const pct = Number(ring.dataset.percent||0);
  ring.style.strokeDasharray  = RING_CIRC;
  ring.style.strokeDashoffset = RING_CIRC - (pct/100)*RING_CIRC;
}

// ── Events ────────────────────────────────────────────────────────────────

function bindEvents() {
  on("[data-tab]",          el => { activeTab=el.dataset.tab; challengeSubTab="habits"; builderOpen=false; settingsOpen=false; viewChallengeId=null; editChallengeId=null; editForm=null; viewingDate=null; render(); });
  on("[data-challenge-sub]",el => { challengeSubTab=el.dataset.challengeSub; render(); });
  on("[data-mode]",         el => setMode(el.dataset.mode));
  on("[data-habit]",        el => {
    const habitId = el.dataset.habit;
    const rect = el.getBoundingClientRect();
    const _c = currentChallenge();
    const _day = _c && getChallengeDay(_c, effectiveDate());
    const _ptsBefore = _day?.pts ?? 0;
    toggleHabit(habitId);
    const _ptsAfter = _day?.pts ?? 0;
    const _ptsDelta = _ptsAfter - _ptsBefore;
    if (_day?.done.includes(habitId) && _ptsDelta > 0) {
      showPtsAnim(_ptsDelta, rect);
    }
  });
  on("[data-tier]",         el => selectTier(el.dataset.tier, el.dataset.tierVal));
  on("[data-chart]",        el => { activeChartTab=el.dataset.chart; render(); });
  on("[data-today-challenge]", el => { todayChallengeId=el.dataset.todayChallenge; render(); });
  on("[data-date-back]", () => {
    const cur = effectiveDate();
    const prev = addDays(cur, -1);
    const challenge = getActiveChallenges().find(c => c.id === todayChallengeId);
    const minBack = addDays(todayKey(), -3);
    const minDate = challenge && challenge.startDate > minBack ? challenge.startDate : minBack;
    if (prev >= minDate) { viewingDate = prev; render(); }
  });
  on("[data-date-fwd]", () => {
    if (!viewingDate) return;
    const next = addDays(viewingDate, 1);
    viewingDate = next >= todayKey() ? null : next;
    render();
  });
  on("[data-open-builder]", () => { builderOpen=true; builderStep="template"; builderForm=defaultBuilderForm(); render(); });
  on("[data-close-builder]",() => { builderOpen=false; render(); });
  on("[data-open-settings]",() => { settingsOpen=!settingsOpen; render(); });
  on("[data-close-settings]",()=>{ settingsOpen=false; render(); });
  on("[data-preview-onboarding]", () => { settingsOpen=false; _obAuthError=""; _obAuthMode="signup"; onboardingStep=0; render(); });
  on("[data-view-challenge]",el=>{ viewChallengeId=el.dataset.viewChallenge; challengeDetailView="weeks"; calendarViewMonth=null; _pushAppState(); render(); });
  on("[data-close-detail]", () => { viewChallengeId=null; challengeDetailView="weeks"; calendarViewMonth=null; render(); });
  on("[data-detail-view]",  el => { challengeDetailView=el.dataset.detailView; render(); });
  on("[data-cal-prev]",     el => { calendarViewMonth=el.dataset.calPrev; render(); });
  on("[data-cal-next]",     el => { calendarViewMonth=el.dataset.calNext; render(); });
  on("[data-use-freeze]",   () => useStreakFreeze());
  on("[data-capture-photo]",el => captureProgressPhoto(el.dataset.capturePhoto));
  on("[data-log-weight]",   () => logWeight());
  on("[data-save-settings]",() => saveSettings());
  document.addEventListener("input", e => {
    if (!e.target.matches("[data-autosave-name]")) return;
    state.settings.name = e.target.value.trim();
    saveState();
  });
  on("[data-unit-weight]",        el => {
    state.settings.units.weight = el.dataset.unitWeight;
    saveState();
    if (state.bodyTracking.entries.length) showToast("Unit changed. Logged entries are not auto-converted.");
    render();
  });
  on("[data-unit-distance]",      el => { state.settings.units.distance=el.dataset.unitDistance; saveState(); render(); });
  on("[data-unit-measurements]",  el => {
    state.settings.units.measurements = el.dataset.unitMeasurements;
    saveState();
    if (state.bodyTracking.entries.some(e=>e.waist!=null||e.hips!=null)) showToast("Unit changed. Logged entries are not auto-converted.");
    render();
  });
  on("[data-select-template]", el => selectTemplate(el.dataset.selectTemplate));
  on("[data-builder-back-exp]", () => { builderStep = "template"; render(); });
  on("[data-exp-unit]", el => { builderForm.expeditionUnit = el.dataset.expUnit; render(); });
  on("[data-start-expedition]", () => {
    const name     = document.getElementById("exp-name")?.value.trim() || "My Expedition";
    const emoji    = document.getElementById("exp-emoji")?.value.trim() || "🗺️";
    const distance = parseFloat(document.getElementById("exp-distance")?.value) || 0;
    const duration = parseInt(document.getElementById("exp-duration")?.value) || 0;
    const startDate = document.getElementById("exp-start")?.value || todayKey();
    const unit     = builderForm.expeditionUnit || "km";
    if (!distance || distance <= 0) { showToast("Enter a distance goal."); return; }
    if (!duration || duration <= 0) { showToast("Enter a duration."); return; }
    const endDate  = addDays(startDate, duration - 1);
    const habitEmoji = unit === "floors" ? "🏢" : "🥾";
    const form = {
      templateId: null, name, emoji, startDate, endDate,
      mode: "soft", weeklyGoal: 5, jokerBudget: 3, noEndDate: false,
      routeKm: distance,
      habits: [{ id:"dist", title:"Log distance", emoji:habitEmoji, quip:"Every step counts.", type:"distance", points:1, unit }],
    };
    const c = createChallenge(form);
    todayChallengeId = c.id;
    builderOpen = false;
    activeTab = "today";
    showToast(`${emoji} ${name} started!`);
    trackEvent("Challenge Started", { challenge: name, template: "custom-expedition" });
    render();
  });
  on("[data-bf-mode]",      el => { saveBuilderFormFromDOM(); builderForm.mode=el.dataset.bfMode; render(); });
  on("[data-pin-challenge]", el => { // kept for old data; no-op
    const c = getChallenge(el.dataset.pinChallenge); if (!c) return;
    c.pinned = !c.pinned;
    saveState(); render();
  });
  document.addEventListener("change", e => {
    if (!e.target.matches("#bf-ongoing")) return;
    saveBuilderFormFromDOM();
    builderForm.noEndDate = e.target.checked;
    if (builderForm.noEndDate) builderForm.endDate = "9999-12-31";
    render();
  }, true);
  on("[data-joker-adj]",   el => {
    const delta = Number(el.dataset.jokerAdj);
    const dur = diffDays(builderForm.startDate, builderForm.endDate) + 1;
    const max = Math.floor(dur * 0.3); // cap at 30% of challenge length
    builderForm.jokerBudget = Math.max(0, Math.min(max, (builderForm.jokerBudget || 0) + delta));
    const valEl = document.getElementById("joker-val");
    if (valEl) valEl.textContent = builderForm.jokerBudget;
    // update the desc text inline without full re-render
    const row = el.closest(".joker-budget-row");
    const desc = row?.querySelector(".mode-desc");
    if (desc) desc.textContent = builderForm.jokerBudget === 0 ? "No flex days selected." : `${builderForm.jokerBudget} flex day${builderForm.jokerBudget===1?"":"s"} available for life, recovery, or schedule changes.`;
  });
  on("[data-builder-back]", () => {
    if (builderStep === "customize")  { builderStep = "quickstart"; render(); }
    else if (builderStep === "quickstart") { builderStep = "template"; render(); }
    else { builderOpen = false; render(); }
  });
  on("[data-quickstart-customise]", () => { builderStep = "customize"; render(); });
  on("[data-template-filter]", el => { _templateFilter = el.dataset.templateFilter; render(); });
  on("[data-difficulty-filter]", el => { _difficultyFilter = el.dataset.difficultyFilter; render(); });
  on("[data-meas-tab]", el => { _measChartTab = el.dataset.measTab; render(); });
  on("[data-surprise-me]", () => {
    const pool = TEMPLATES.filter(t => {
      const d = TEMPLATE_DIFFICULTY[t.id] || "intermediate";
      return d === "beginner" || d === "intermediate";
    });
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) { _safetyPendingTemplateId = null; selectTemplate(pick.id); }
  });
  on("[data-quiz-goal]",  el => { builderQuizAnswers.goal  = el.dataset.quizGoal;  render(); });
  on("[data-quiz-time]",  el => { builderQuizAnswers.time  = el.dataset.quizTime;  render(); });
  on("[data-quiz-level]", el => { builderQuizAnswers.level = el.dataset.quizLevel; render(); });
  on("[data-quiz-find]",  () => { selectTemplate(getQuizRecommendation(builderQuizAnswers)); });
  on("[data-quiz-skip]",  () => { builderStep="template"; render(); });
  on("[data-request-notif-from-builder]", () => requestNotificationPermission());
  on("[data-close-badge-sheet]",    () => { _badgeSheetQueue = []; render(); });
  on("[data-dismiss-backup-nudge]", () => { localStorage.setItem("endur_backup_nudge_dismissed","1"); render(); });
  on("[data-dismiss-email-capture]", () => { localStorage.setItem("endur_email_capture","dismissed"); render(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.id === "email-cap-input") document.querySelector("[data-email-capture-submit]")?.click();
  });
  on("[data-email-capture-submit]",  () => {
    const input = document.getElementById("email-cap-input");
    const email = input ? input.value.trim() : "";
    if (!email || !email.includes("@")) { if (input) { input.focus(); input.classList.add("input-shake"); setTimeout(()=>input.classList.remove("input-shake"),400); } return; }
    fetch("/", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body: new URLSearchParams({"form-name":"beta-waitlist", email}) }).catch(()=>{});
    localStorage.setItem("endur_email_capture","submitted");
    render();
  });
  on("[data-close-levelup]",        () => { _levelUpOverlay = null; render(); });
  on("[data-close-chapter]",        () => { _chapterOverlay = null; render(); });
  on("[data-notif-prompt-enable]",  async () => { _notifPromptVisible = false; await requestNotificationPermission(); render(); });
  on("[data-notif-prompt-skip]",    () => { _notifPromptVisible = false; render(); });
  on("[data-start-challenge]",() => startChallenge());
  on("[data-safety-confirm]",  () => startChallenge(true));
  on("[data-safety-dismiss]",  () => { _safetyPendingTemplateId = null; render(); });
  on("[data-safety-backdrop]", (el, e) => { if (e.target === el) { _safetyPendingTemplateId = null; render(); } });
  on("[data-add-habit]",    () => { saveBuilderFormFromDOM(); addCustomHabit(); });
  on("[data-remove-habit]", el => { saveBuilderFormFromDOM(); removeCustomHabit(Number(el.dataset.removeHabit)); });
  on("[data-close-completion]",       (el,e) => { if(e.target.closest("[data-close-completion]")){ justCompletedId = justCompletedIds.length ? justCompletedIds.shift() : null; render(); }});
  on("[data-completion-new-challenge]",     () => { justCompletedId=null; justCompletedIds=[]; builderOpen=true; builderStep="template"; builderForm=defaultBuilderForm(); render(); });
  on("[data-share-completion]", () => {
    const c = justCompletedId ? getChallenge(justCompletedId) : null; if (!c) return;
    showShareModal(c, true);
  });
  on("[data-share-streak]", () => {
    const c = currentChallenge(); if (!c) return;
    showShareModal(c, false);
  });
  on("[data-share-progress]", () => {
    const c = currentChallenge(); if (!c) return;
    showShareModal(c, false);
  });
  on("[data-close-share-modal]", () => { _shareModalChallenge = null; _shareCardDataUrl = null; render(); });
  on("[data-share-card-native]", () => {
    if (!_shareModalChallenge || !_shareCardDataUrl) return;
    const streak    = calcChallengeStreak(_shareModalChallenge);
    const totalPts  = Object.values(_shareModalChallenge.days).reduce((a,d)=>a+(d.pts||0),0);
    const totalDays = diffDays(_shareModalChallenge.startDate, _shareModalChallenge.endDate)+1;
    const dayNum    = challengeDayNumber(_shareModalChallenge);
    const text = _shareModalDone
      ? `I just completed the ${_shareModalChallenge.name} challenge on Endur.\n${totalDays} days · ${totalPts} pts · ${streak}-day streak.\nOutlast everything.\n${SHARE_URL}`
      : `Day ${dayNum} of my ${_shareModalChallenge.name} challenge - ${streak}-day streak.\nBuilding tasks one day at a time.\n${SHARE_URL}`;
    if (navigator.share) {
      fetch(_shareCardDataUrl).then(r=>r.blob()).then(blob => {
        const file = new File([blob], "endur-share.png", { type:"image/png" });
        const shareData = { title:"Endur", text };
        if (navigator.canShare?.({files:[file]})) shareData.files = [file];
        navigator.share(shareData).catch(()=>{});
      }).catch(() => shareAchievement(text));
    } else {
      shareAchievement(text);
    }
  });
  on("[data-download-share-card]", () => {
    if (!_shareCardDataUrl || !_shareModalChallenge) return;
    const a = document.createElement("a");
    a.href     = _shareCardDataUrl;
    a.download = `${(_shareModalChallenge.name||"endur").replace(/\s+/g,"-")}-day${challengeDayNumber(_shareModalChallenge)}.png`;
    a.click();
  });
  on("[data-copy-share-text]", () => {
    if (!_shareModalChallenge) return;
    const streak    = calcChallengeStreak(_shareModalChallenge);
    const totalPts  = Object.values(_shareModalChallenge.days).reduce((a,d)=>a+(d.pts||0),0);
    const totalDays = diffDays(_shareModalChallenge.startDate, _shareModalChallenge.endDate)+1;
    const dayNum    = challengeDayNumber(_shareModalChallenge);
    const text = _shareModalDone
      ? `I just completed the ${_shareModalChallenge.name} challenge on Endur.\n${totalDays} days · ${totalPts} pts · ${streak}-day streak.\nOutlast everything.\n${SHARE_URL}`
      : `Day ${dayNum} of my ${_shareModalChallenge.name} challenge - ${streak}-day streak.\nBuilding tasks one day at a time.\n${SHARE_URL}`;
    navigator.clipboard?.writeText(text).then(() => showToast("Copied!")).catch(() => showToast(text));
  });
  on("[data-dismiss-notif-nudge]", () => { _notifNudgeDismissed = true; render(); });
  on("[data-log-today-weight]", () => logTodayWeight());

  // ── Cloud Sync auth handlers ───────────────────────────────────────────────
  on("[data-cloud-signin]", async () => {
    const email    = document.getElementById("cloud-email")?.value?.trim();
    const password = document.getElementById("cloud-password")?.value;
    if (!email || !password) { _cloudAuthError = "Email and password are required."; render(); return; }
    _cloudAuthLoading = true; _cloudAuthError = ""; render();
    const res = await CloudSync.signIn(email, password);
    _cloudAuthLoading = false;
    if (res.error) { _cloudAuthError = res.error; render(); return; }
    showToast("Signed in. Data restored.");
    render();
  });
  on("[data-cloud-signup]", async () => {
    const email    = document.getElementById("cloud-email")?.value?.trim();
    const password = document.getElementById("cloud-password")?.value;
    if (!email || !password) { _cloudAuthError = "Email and password are required."; render(); return; }
    if (password.length < 8) { _cloudAuthError = "Password must be at least 8 characters."; render(); return; }
    _cloudAuthLoading = true; _cloudAuthError = ""; render();
    const res = await CloudSync.signUp(email, password);
    _cloudAuthLoading = false;
    if (res.error) { _cloudAuthError = res.error; render(); return; }
    if (res.emailPending) {
      showToast("Account created. Check your inbox to confirm your email.");
    } else {
      showToast("Account created. Data syncing to cloud.");
    }
    render();
  });
  on("[data-cloud-signout]",   () => { CloudSync.signOut(); _cloudAuthError = ""; render(); });
  on("[data-dismiss-newweek]", () => { _newWeekBanner = null; render(); });
  on("[data-install-accept]",  async () => {
    _showInstallBanner = false; render();
    if (_pwaInstallPrompt) {
      _pwaInstallPrompt.prompt();
      const choice = await _pwaInstallPrompt.userChoice;
      if (choice?.outcome === "accepted") trackEvent("App Installed");
      _pwaInstallPrompt = null;
    }
  });
  on("[data-install-dismiss]", () => { _showInstallBanner = false; localStorage.setItem("endur_install_shown","1"); render(); });
  on("[data-cloud-sync]", async () => {
    if (_cloudAuthLoading) return;
    _cloudAuthLoading = true; render();
    await CloudSync.push();
    _cloudAuthLoading = false;
    showToast("Data synced to cloud."); render();
  });
  on("[data-edit-challenge]", el => {
    const c = getChallenge(el.dataset.editChallenge); if (!c) return;
    editForm = {
      mode: c.mode,
      habits: JSON.parse(JSON.stringify(c.habits)),  // deep copy — Cancel discards this
      habitEditIdx: null,
      newHabitEmoji: "⭐", newHabitTitle: "", newHabitPoints: 2,
      newHabitType: "binary",
      newHabitTiers: [{ label:"", points:1 }, { label:"", points:2 }, { label:"", points:3 }],
    };
    editChallengeId = el.dataset.editChallenge;
    viewChallengeId = null;
    render();
  });
  on("[data-close-edit]",    () => { viewChallengeId=editChallengeId; editChallengeId=null; editForm=null; render(); });
  on("[data-ec-mode]",       el => { if (editForm) { editForm.mode=el.dataset.ecMode; render(); } });
  on("[data-save-edit]",         () => saveEditChallenge());

  // ── Habit CRUD inside Edit Challenge ──────────────────────────────────────
  on("[data-ec-edit-habit]", el => {
    if (!editForm) return;
    editForm.habitEditIdx = Number(el.dataset.ecEditHabit);
    render();
  });
  on("[data-ec-cancel-habit-edit]", () => {
    if (!editForm) return;
    editForm.habitEditIdx = null;
    render();
  });
  on("[data-ec-save-habit]", () => {
    if (!editForm || editForm.habitEditIdx == null) return;
    const i = editForm.habitEditIdx;
    const h = editForm.habits[i];
    const emoji = (document.getElementById("ech-emoji")?.value || "⭐").trim() || "⭐";
    const title = (document.getElementById("ech-title")?.value || "").trim();
    if (!title) { showToast("Task needs a name."); return; }
    if (h.type === "tiered") {
      editForm.habits[i] = { ...h, emoji, title };
    } else {
      const pts = Math.max(1, Math.min(20, Number(document.getElementById("ech-pts")?.value) || 2));
      editForm.habits[i] = { ...h, emoji, title, points: pts };
    }
    editForm.habitEditIdx = null;
    render();
  });
  on("[data-ec-delete-habit]", el => {
    if (!editForm) return;
    const i = Number(el.dataset.ecDeleteHabit);
    const h = editForm.habits[i];
    if (!h) return;
    showConfirm(
      `Remove "${h.title}" from this challenge? Past logs for this habit will be cleared.`,
      () => {
        editForm.habits.splice(i, 1);
        if (editForm.habitEditIdx === i) editForm.habitEditIdx = null;
        render();
      }
    );
  });
  on("[data-ec-add-habit]", () => {
    if (!editForm) return;
    const emoji = (document.getElementById("ech-new-emoji")?.value || "⭐").trim() || "⭐";
    const title = (document.getElementById("ech-new-title")?.value || "").trim();
    if (!title) { showToast("Enter a task name."); return; }
    if (editForm.newHabitType === "tiered") {
      const tiers = (editForm.newHabitTiers || []).map((t, i) => ({
        label:  (document.getElementById(`ech-tier-${i}-label`)?.value || t.label || `Tier ${i+1}`).trim() || `Tier ${i+1}`,
        value:  i,
        points: Math.max(1, Math.min(20, Number(document.getElementById(`ech-tier-${i}-pts`)?.value) || t.points)),
      }));
      if (tiers.filter(t => t.label).length < 2) { showToast("Fill in at least 2 tier labels."); return; }
      editForm.habits.push({ id: uid(), title, emoji, quip: "", type: "tiered", points: tiers[0].points, tiers });
    } else {
      const pts = Math.max(1, Math.min(20, Number(document.getElementById("ech-new-pts")?.value) || 2));
      editForm.habits.push({ id: uid(), title, emoji, quip: "", type: "binary", points: pts });
    }
    editForm.newHabitEmoji  = "⭐";
    editForm.newHabitTitle  = "";
    editForm.newHabitPoints = 2;
    editForm.newHabitType   = "binary";
    editForm.newHabitTiers  = [{ label:"", points:1 }, { label:"", points:2 }, { label:"", points:3 }];
    render();
  });
  // Habit type toggles in builder
  on("[data-nh-type]", el => {
    saveBuilderFormFromDOM();
    builderForm.newHabitType = el.dataset.nhType;
    render();
  });
  on("[data-nh-add-tier]", () => {
    saveBuilderFormFromDOM();
    if (builderForm.newHabitTiers.length < 5) {
      const lastPts = builderForm.newHabitTiers[builderForm.newHabitTiers.length - 1]?.points || 1;
      builderForm.newHabitTiers.push({ label: "", points: lastPts + 1 });
    }
    render();
  });
  on("[data-nh-remove-tier]", el => {
    saveBuilderFormFromDOM();
    builderForm.newHabitTiers.splice(Number(el.dataset.nhRemoveTier), 1);
    render();
  });
  // Habit type toggles in edit challenge
  on("[data-ech-type]", el => {
    if (!editForm) return;
    const newTitle = document.getElementById("ech-new-title")?.value || "";
    const newEmoji = document.getElementById("ech-new-emoji")?.value || "⭐";
    editForm.newHabitTiers = (editForm.newHabitTiers || []).map((t, i) => ({
      ...t,
      label:  document.getElementById(`ech-tier-${i}-label`)?.value ?? t.label,
      points: Number(document.getElementById(`ech-tier-${i}-pts`)?.value) || t.points,
    }));
    editForm.newHabitTitle = newTitle;
    editForm.newHabitEmoji = newEmoji;
    editForm.newHabitType  = el.dataset.echType;
    render();
  });
  on("[data-ech-add-tier]", () => {
    if (!editForm) return;
    if ((editForm.newHabitTiers || []).length < 5) {
      const last = editForm.newHabitTiers[editForm.newHabitTiers.length - 1]?.points || 1;
      editForm.newHabitTiers.push({ label: "", points: last + 1 });
    }
    render();
  });
  on("[data-ech-remove-tier]", el => {
    if (!editForm) return;
    editForm.newHabitTiers.splice(Number(el.dataset.echRemoveTier), 1);
    render();
  });
  on("[data-pause-challenge]",        el => pauseChallenge(el.dataset.pauseChallenge));
  on("[data-extend-challenge]",       el => extendChallenge(el.dataset.extendChallenge, 14));
  on("[data-abandon-challenge]",      el => abandonChallenge(el.dataset.abandonChallenge));
  on("[data-request-notif-permission]",  () => requestNotificationPermission());
  on("[data-toggle-reminder]",        el => {
    state.settings.reminderEnabled = el.checked;
    saveState();
    if (el.checked) scheduleReminder(); else clearTimeout(reminderTimeout);
    render();
  });
  on("[data-save-reminder]",   () => saveReminderTime());
  on("[data-export-data]",     () => exportData());
  on("[data-reset-app]",       () => { _resetConfirm = true;  render(); });
  on("[data-reset-cancel]",    () => { _resetConfirm = false; render(); });
  on("[data-reset-confirm]",   async () => {
    // 1. Kill pending push timer immediately
    clearTimeout(_cloudPushTimer);
    _cloudPushTimer = null;
    _skipCloudPush = true;
    // 2. Overwrite cloud row BEFORE clearing localStorage — auth token must
    //    still be in localStorage for Supabase to authenticate the upsert
    if (CloudSync.isSignedIn) {
      try {
        await _sb().from("user_data").upsert({
          user_id: CloudSync.uid,
          state_json: {},
          updated_at: new Date().toISOString(),
        });
      } catch(e) {}
    }
    // 3. Sign out (invalidates session server-side)
    try { await _sb().auth.signOut(); } catch(e) {}
    // 4. Now clear all client-side stores (auth token gone after signOut anyway)
    localStorage.clear();
    sessionStorage.clear();
    // 5. Clear IndexedDB
    try {
      const dbs = await indexedDB.databases?.() || [];
      for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
    } catch(e) {}
    // 6. Hard reload
    window.location.replace(window.location.pathname + "?reset=" + Date.now());
  });
  // Import file — delegated so it works when settings panel opens after first render
  document.addEventListener("change", e => {
    if (!e.target.matches("#import-file-input")) return;
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        // Basic shape check — must look like a Endur backup
        if (!parsed || typeof parsed !== "object" || !("challenges" in parsed)) {
          showToast("That doesn't look like a Endur backup file."); return;
        }
        const cCount = Object.keys(parsed.challenges || {}).length;
        const normalized = normalizeState(parsed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        showToast(`Backup restored (${cCount} challenge${cCount===1?"":"s"})! Reloading…`);
        setTimeout(() => window.location.reload(), 1400);
      } catch(err) {
        showToast("Invalid backup file — couldn't restore.");
      }
    };
    reader.readAsText(file);
  });
  // ── Onboarding navigation ──────────────────────────────────────────────────
  on("[data-ob-next]", () => {
    onboardingStep++;
    if (onboardingStep === 1) onboardingStep = 2; // journey/theme step removed
    render();
  });
  on("[data-ob-skip]", () => {
    // Skip info slides → jump straight to name screen
    onboardingStep = ONBOARDING_STEPS.length + 3;
    _obAuthError = "";
    render();
  });
  on("[data-ob-to-signin]", () => {
    _obAuthMode = "signin";
    onboardingStep = ONBOARDING_STEPS.length + 4; // skip name step for returning users
    _obAuthError = "";
    render();
  });
  on("[data-ob-goal]", el => {
    const templateId = el.dataset.obGoal;
    const tpl = TEMPLATES.find(t => t.id === templateId);
    onboardingStep = null;
    _skipAccountAfterStart = true;
    activeTab = "challenges";
    builderOpen = true;
    builderStep = "customize";
    builderForm = defaultBuilderForm();
    if (tpl) {
      builderForm.templateId = templateId;
      builderForm.name       = tpl.name;
      builderForm.emoji      = tpl.emoji;
      builderForm.endDate    = addDays(todayKey(), tpl.duration - 1);
      builderForm.weeklyGoal = tpl.weeklyGoal;
      builderForm.mode       = tpl.defaultMode || "soft";
      builderForm.jokerBudget = tpl.noRestDay ? 0 : 3;
    }
    render();
  });
  on("[data-ob-save-name]", () => {
    const nameInput = document.getElementById("ob-name");
    if (nameInput?.value?.trim()) { state.settings.name = nameInput.value.trim(); saveState(); }
    onboardingStep++;
    _obAuthError = "";
    render();
  });
  on("[data-ob-skip-name]", () => {
    onboardingStep++;
    _obAuthError = "";
    render();
  });
  on("[data-ob-toggle-auth]", () => {
    _obAuthMode = _obAuthMode === "signup" ? "signin" : "signup";
    _obAuthError = "";
    render();
  });
  on("[data-ob-auth]", async () => {
    const email    = document.getElementById("ob-email")?.value?.trim() || "";
    const password = document.getElementById("ob-password")?.value || "";
    if (!email || !password) { _obAuthError = "Email and password are required."; render(); return; }
    if (_obAuthMode === "signup" && password.length < 8) { _obAuthError = "Password must be at least 8 characters."; render(); return; }
    _obAuthLoading = true; _obAuthError = ""; render();
    const res = _obAuthMode === "signup"
      ? await CloudSync.signUp(email, password)
      : await CloudSync.signIn(email, password);
    _obAuthLoading = false;
    if (res.error) { _obAuthError = res.error; render(); return; }
    if (res.emailPending) {
      // Email confirmation required — show message and let user continue offline
      _obAuthError = "";
      showToast("Account created. Check your inbox to confirm your email.");
      trackEvent("Account Created");
      onboardingStep = null;
      activeTab = "challenges";
      builderOpen = true; builderStep = "template";
      builderForm = defaultBuilderForm();
      render(); return;
    }
    trackEvent(_obAuthMode === "signup" ? "Account Created" : "Sign In");
    // Success — go to challenge picker (signup) or today tab (signin with existing data)
    onboardingStep = null;
    if (_obAuthMode === "signin" && Object.keys(state.challenges).length > 0) {
      activeTab = "today";
      todayChallengeId = "__all__";
    } else {
      activeTab = "challenges";
      builderOpen = true;
      builderStep = "template";
      builderForm = defaultBuilderForm();
    }
    render();
  });
  on("[data-ob-skip-account]", () => {
    onboardingStep = null;
    activeTab = "challenges";
    builderOpen = true;
    builderStep = "template";
    builderForm = defaultBuilderForm();
    render();
  });
  // ── Forgot password ──────────────────────────────────────────────────────
  on("[data-ob-forgot]",         () => { _forgotPwMode = true; _obAuthError = ""; render(); });
  on("[data-ob-forgot-cancel]",  () => { _forgotPwMode = false; _obAuthError = ""; render(); });
  on("[data-ob-forgot-submit]",  async () => {
    const email = (document.getElementById("ob-reset-email")?.value || "").trim();
    if (!email) { _obAuthError = "Enter your email address."; render(); return; }
    _obAuthLoading = true; _obAuthError = ""; render();
    try { await _sb().auth.resetPasswordForEmail(email); } catch(e) { /* silent — Supabase always returns 200 */ }
    _obAuthLoading = false;
    _forgotPwMode = false;
    showToast("📧 Reset link sent — check your inbox.");
    render();
  });
  on("[data-cloud-forgot]",      async () => {
    const email = (document.getElementById("cloud-email")?.value || "").trim();
    if (!email) { _cloudAuthError = "Enter your email above, then tap Forgot password."; render(); return; }
    _cloudAuthLoading = true; _cloudAuthError = ""; render();
    try { await _sb().auth.resetPasswordForEmail(email); } catch(e) { /* silent */ }
    _cloudAuthLoading = false;
    showToast("📧 Reset link sent — check your inbox.");
    render();
  });
  on("[data-retry-sync]", () => { _lastSyncError = false; CloudSync.push(); });
  on("[data-mood]", el => {
    const c = currentChallenge(); if (!c) return;
    const day = getChallengeDay(c, todayKey());
    day.mood = day.mood === el.dataset.mood ? null : el.dataset.mood;
    saveState(); render();
  });
  document.addEventListener("change", e => {
    const ta = e.target.closest("[data-day-note]");
    if (!ta) return;
    const c = currentChallenge(); if (!c) return;
    const day = getChallengeDay(c, todayKey());
    day.note = ta.value.trim().slice(0, 280);
    saveState();
  });
  on("[data-confirm-ok]",      () => { const fn = _confirmDialog?.onConfirm; _confirmDialog = null; render(); if (fn) fn(); });
  on("[data-confirm-cancel]",  () => { _confirmDialog = null; render(); });
  on("[data-prompt-ok]",       () => { const val = document.getElementById("prompt-input-field")?.value; const fn = _promptDialog?.onConfirm; _promptDialog = null; render(); if (fn) fn(val); });
  on("[data-prompt-cancel]",   () => { _promptDialog = null; render(); });
  on("[data-delete-photo]",    el => {
    const key = el.dataset.deletePhoto;
    showConfirm("Delete this progress photo? This can't be undone.", async () => {
      try {
        await PhotoDB.delete(key);
        // Force the strip to re-load on next render
        const strip = document.querySelector('[id^="pp-strip-"]');
        if (strip) delete strip.dataset.loaded;
        render();
      } catch(e) { showToast("Couldn't delete photo — try again."); }
    });
  });
  on("[data-show-more-history]",() => { bodyHistoryLimit += 10; render(); });
  on("[data-delete-challenge]",  el => deleteChallenge(el.dataset.deleteChallenge));
  on("[data-export-health]",    el => { const c = getChallenge(el.dataset.exportHealth); if (c) exportHealthCSV(c); });
  on("[data-dismiss-weekly-recap]", el => {
    const cid = el.dataset.dismissWeeklyRecap;
    if (!state.weeklyRecapDismissed) state.weeklyRecapDismissed = {};
    state.weeklyRecapDismissed[cid] = todayKey();
    saveState(); render();
  });
  on("[data-start-suggested]", el => {
    const t = TEMPLATES.find(t2 => t2.id === el.dataset.startSuggested);
    if (!t) return;
    justCompletedId = null; justCompletedIds = [];
    builderOpen = true; builderStep = "customize";
    builderForm = defaultBuilderForm();
    builderForm.templateId = t.id;
    builderForm.name = t.name;
    builderForm.emoji = t.emoji;
    builderForm.mode = t.defaultMode;
    builderForm.weeklyGoal = t.weeklyGoal;
    builderForm.endDate = addDays(builderForm.startDate, t.duration - 1);
    render();
  });
  // Measurement habit input
  document.addEventListener("change", e => {
    if (!e.target.matches("[data-measurement-habit]")) return;
    const habitId  = e.target.dataset.measurementHabit;
    const raw = parseFloat(e.target.value) || 0;
    const inputVal = Math.min(Math.max(0, raw), 9999);
    if (inputVal !== raw) e.target.value = inputVal;
    logMeasurement(habitId, inputVal);
  });
  // Floor stepper buttons (+1/+5/+10)
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-floor-step]");
    if (!btn) return;
    const habitId = btn.dataset.floorStep;
    const step    = parseInt(btn.dataset.step, 10) || 1;
    const input   = document.querySelector(`[data-distance-habit="${habitId}"]`);
    if (!input) return;
    const newVal = Math.min(9999, (parseFloat(input.value) || 0) + step);
    input.value = newVal;
    const c = currentChallenge();
    const habit = c?.habits.find(h => h.id === habitId);
    if (habit) logDistance(habitId, newVal);
  });
  // Distance habit input — delegated change event (persists across re-renders)
  document.addEventListener("change", e => {
    if (!e.target.matches("[data-distance-habit]")) return;
    const habitId  = e.target.dataset.distanceHabit;
    const raw = parseFloat(e.target.value) || 0;
    const inputVal = Math.min(Math.max(0, raw), 9999);
    if (inputVal !== raw) e.target.value = inputVal;
    // Read the unit selector if present; defaults to global setting
    const unitSel   = document.querySelector(`[data-dist-unit-sel="${habitId}"]`);
    const inputUnit = unitSel?.value || (state.settings.units.distance === "miles" ? "mi" : "km");
    // Convert to km for storage (floor habits are stored as-is)
    const c = currentChallenge();
    const habit = c?.habits.find(h => h.id === habitId);
    const habitUnit = habit?.unit || "km";
    const storeVal  = (habitUnit === "km" && inputUnit === "mi") ? inputVal * 1.60934 : inputVal;
    logDistance(habitId, Math.round(storeVal * 1000) / 1000);
  });
}

function on(sel, fn) {
  // Proper event delegation — works after DOM re-renders because the listener lives on document
  document.addEventListener("click", e => {
    const el = e.target.closest(sel);
    if (el) fn(el, e);
  });
}

// ── Actions ───────────────────────────────────────────────────────────────

function currentChallenge() {
  if (!todayChallengeId) {
    const active = getActiveChallenges();
    if (active.length) todayChallengeId = active[0].id;
  }
  return getChallenge(todayChallengeId);
}

function setMode(mode) {
  const c = currentChallenge(); if (!c) return;
  const dayKey = effectiveDate();
  const isScheduledRest = getDaySchedule(c, dayKey)?.type === "rest";
  if (mode === "rest") {
    const tpl = c.templateId ? TEMPLATES.find(t => t.id === c.templateId) : null;
    if (tpl?.noRestDay) { showToast("This challenge is self-paced. Scale or pause when needed."); return; }
    const alreadyRest = c.days[dayKey]?.mode === "rest";
    if (!alreadyRest && !isScheduledRest) {
      const used = Object.values(c.days).filter(d => d.mode === "rest" && !d.scheduledRest).length;
      const budget = c.jokerBudget ?? 3;
      if (used >= budget) {
        showToast(`No flex days left. Keep going at your own pace.`);
        return;
      }
    }
  }
  const day = getChallengeDay(c, dayKey);
  if (mode === "rest" && isScheduledRest) day.scheduledRest = true;
  else if (mode === "standard") day.scheduledRest = false;
  applyMode(c, day, mode);
}

function applyMode(c, day, mode) {
  day.mode = mode;
  if (mode==="rest") day.done = [];
  updateDayPoints(c, day);
  saveState();
  if (mode==="rest") showToast("Flex Day set. Streak is safe.");
  checkBadges(c);
  render();
}

function toggleHabit(id) {
  const c = currentChallenge(); if (!c) return;
  const habit = c.habits.find(h=>h.id===id); if (!habit) return;
  const day = getChallengeDay(c, effectiveDate());
  if (day.mode==="rest") return;
  const xpBefore    = state.xp;
  const levelBefore = getLevelInfo(state.xp).level;
  const checking    = !day.done.includes(id);
  if (checking && effectiveDate() === todayKey() && day.streakMult === undefined) {
    day.streakMult = getStreakMultiplier(c);
  }
  if (checking && effectiveDate() === todayKey() && day.comebackBonus === undefined) {
    if (getConsecutiveMisses(c) >= 3) day.comebackBonus = true;
  }
  if (checking) { day.done.push(id); _animHabitId = id; }
  else          { day.done = day.done.filter(x=>x!==id); _animHabitId = null; }
  if (effectiveDate() === todayKey()) {
    const _perfRun = getPerfectRunLength(c, todayKey());
    day.weeklyBonus = (_perfRun > 0 && _perfRun % 7 === 0);
  }
  updateDayPoints(c, day);
  state.xp = recalcXP();
  const xpGain  = state.xp - xpBefore;
  const lvlInfo = getLevelInfo(state.xp);
  const newInfo = completionInfo(c, day);
  if (checking && newInfo.percent === 100 && effectiveDate() === todayKey()) {
    setTimeout(launchConfetti, 250);
  }
  if (lvlInfo.level > levelBefore) {
    const _luT = JOURNEY_THEMES[state.settings.journeyTheme] || JOURNEY_THEMES.endur;
    setTimeout(() => { _levelUpOverlay = { level: lvlInfo.level, name: lvlInfo.name, emoji: _luT.emoji, total: state.xp }; render(); }, 600);
  } else if (xpGain > 0) {
    const mult = day.streakMult || 1;
    const multStr = mult > 1 ? ` x${mult.toFixed(2)}` : "";
    showToast(`+${xpGain} XP${multStr}`);
  }
  saveState(); navigator.vibrate?.(10);
  _savedFlash = true;
  checkBadges(c);
  checkMilestones(c);
  render();
  setTimeout(() => { _savedFlash = false; render(); }, 1200);
}

function logMeasurement(habitId, value) {
  const c = currentChallenge(); if (!c) return;
  const habit = c.habits.find(h => h.id === habitId); if (!habit) return;
  if (habit.type !== "measurement") return;
  const day = getChallengeDay(c, effectiveDate());
  if (day.mode === "rest") return;
  if (!day.distances) day.distances = {};
  day.distances[habitId] = value;
  if (value > 0) {
    if (effectiveDate() === todayKey() && day.streakMult === undefined) day.streakMult = getStreakMultiplier(c);
    if (effectiveDate() === todayKey() && day.comebackBonus === undefined && getConsecutiveMisses(c) >= 3) day.comebackBonus = true;
    if (!day.done.includes(habitId)) { day.done.push(habitId); _animHabitId = habitId; }
  } else {
    day.done = day.done.filter(id => id !== habitId);
    _animHabitId = null;
  }
  if (effectiveDate() === todayKey()) { const _r = getPerfectRunLength(c, todayKey()); day.weeklyBonus = (_r > 0 && _r % 7 === 0); }
  updateDayPoints(c, day);
  state.xp = recalcXP();
  saveState();
  checkBadges(c);
  render();
}

function logDistance(habitId, km) {
  const c = currentChallenge(); if (!c) return;
  const habit = c.habits.find(h => h.id === habitId); if (!habit) return;
  if (habit.type !== "distance") return;
  const day = getChallengeDay(c, effectiveDate());
  if (day.mode === "rest") return;
  if (!day.distances) day.distances = {};
  day.distances[habitId] = habit.unit === "floors" ? Math.round(km) : km;
  if (km > 0) {
    if (effectiveDate() === todayKey() && day.streakMult === undefined) day.streakMult = getStreakMultiplier(c);
    if (effectiveDate() === todayKey() && day.comebackBonus === undefined && getConsecutiveMisses(c) >= 3) day.comebackBonus = true;
    if (!day.done.includes(habitId)) { day.done.push(habitId); _animHabitId = habitId; }
  } else {
    day.done = day.done.filter(id => id !== habitId);
    _animHabitId = null;
  }
  if (effectiveDate() === todayKey()) { const _r = getPerfectRunLength(c, todayKey()); day.weeklyBonus = (_r > 0 && _r % 7 === 0); }
  updateDayPoints(c, day);
  state.xp = recalcXP();
  saveState();
  checkBadges(c);
  checkMilestones(c);
  updateChallengeStatuses();
  render();
}

function selectTier(habitId, rawVal) {
  const c = currentChallenge(); if (!c) return;
  const habit = c.habits.find(h=>h.id===habitId); if (!habit) return;
  const day = getChallengeDay(c, effectiveDate());
  if (day.mode==="rest") return;
  const val = isNaN(Number(rawVal)) ? rawVal : Number(rawVal);
  if (!day.tiers) day.tiers = {};
  const selecting = String(day.tiers[habitId]) !== String(val);
  if (selecting && effectiveDate() === todayKey() && day.streakMult === undefined) {
    day.streakMult = getStreakMultiplier(c);
  }
  if (!selecting) {
    day.tiers[habitId] = null;
    day.done = day.done.filter(id=>id!==habitId);
    _animHabitId = null;
  } else {
    day.tiers[habitId] = val;
    if (!day.done.includes(habitId)) day.done.push(habitId);
    _animHabitId = habitId;
  }
  updateDayPoints(c, day);
  const xpBefore2    = state.xp;
  const levelBefore2 = getLevelInfo(state.xp).level;
  state.xp = recalcXP();
  const xpGain2   = state.xp - xpBefore2;
  const lvlInfo2  = getLevelInfo(state.xp);
  const newInfo2  = completionInfo(c, day);
  if (selecting && newInfo2.percent === 100 && effectiveDate() === todayKey()) {
    setTimeout(launchConfetti, 250);
  }
  if (lvlInfo2.level > levelBefore2) {
    const _luT2 = JOURNEY_THEMES[state.settings.journeyTheme] || JOURNEY_THEMES.endur;
    setTimeout(() => { _levelUpOverlay = { level: lvlInfo2.level, name: lvlInfo2.name, emoji: _luT2.emoji, total: state.xp }; render(); }, 600);
  } else if (xpGain2 > 0) {
    const mult2 = day.streakMult || 1;
    const multStr2 = mult2 > 1 ? ` x${mult2.toFixed(2)}` : "";
    showToast(`+${xpGain2} XP${multStr2}`);
  }
  saveState(); navigator.vibrate?.(10);
  checkBadges(c); checkMilestones(c); render();
}

function markRecovered() {
  const c = currentChallenge(); if (!c) return;
  const day = getChallengeDay(c, effectiveDate());
  day.recovered = true;
  updateDayPoints(c, day);
  saveState(); sheetOpen=false;
  showToast("Comeback complete. Tomorrow we go again.");
  checkBadges(c); render();
}

function logWeight() {
  const wVal = Number(document.getElementById("weight-input").value);
  const bfVal = document.getElementById("bf-input").value;
  const swVal = document.getElementById("start-input").value;
  const gwVal = document.getElementById("goal-input").value;
  if (swVal!=="") state.bodyTracking.startWeight = Number(swVal);
  if (gwVal!=="") state.bodyTracking.goalWeight  = Number(gwVal);
  if (!Number.isFinite(wVal)||wVal<=0) { showToast("Enter a weight first."); saveState(); render(); return; }
  const bodyFat  = bfVal===""?null:Number(bfVal);
  const leanMass = bodyFat!=null&&Number.isFinite(bodyFat)?Number((wVal*(1-bodyFat/100)).toFixed(1)):null;
  const waistRaw = document.getElementById("waist-input")?.value;
  const hipsRaw  = document.getElementById("hips-input")?.value;
  const waist    = waistRaw ? Number(waistRaw) : null;
  const hips     = hipsRaw  ? Number(hipsRaw)  : null;
  const entry = { date:todayKey(), weight:Number(wVal.toFixed(1)), bodyFat, leanMass, waist, hips };
  const idx = state.bodyTracking.entries.findIndex(e=>e.date===todayKey());
  if (idx>=0) state.bodyTracking.entries[idx]=entry; else state.bodyTracking.entries.push(entry);
  if (!state.bodyTracking.startWeight) state.bodyTracking.startWeight=Number(wVal.toFixed(1));
  saveState();
  // Check weight badges across all active challenges
  getActiveChallenges().forEach(c => checkBadges(c));
  showToast(leanMass?`Logged. Lean mass: ${leanMass} ${state.settings.units.weight}.`:"Logged.");
  render();
}

function logTodayWeight() {
  const wEl = document.getElementById("twl-weight");
  if (!wEl) return;
  const wVal = Number(wEl.value);
  if (!Number.isFinite(wVal) || wVal <= 0) { showToast("Enter a valid weight."); return; }
  const entry = { date: todayKey(), weight: Number(wVal.toFixed(1)), bodyFat: null, leanMass: null, waist: null, hips: null };
  const idx = state.bodyTracking.entries.findIndex(e => e.date === todayKey());
  if (idx >= 0) state.bodyTracking.entries[idx] = entry; else state.bodyTracking.entries.push(entry);
  if (!state.bodyTracking.startWeight) state.bodyTracking.startWeight = Number(wVal.toFixed(1));
  saveState();
  getActiveChallenges().forEach(c => checkBadges(c));
  showToast(`Weight logged: ${wVal} ${state.settings.units.weight}`);
  render();
}

function saveSettings() {
  const nameEl = document.getElementById("s-name");
  if (nameEl) state.settings.name = nameEl.value.trim();
  saveState(); scheduleReminder(); showToast("Settings saved."); render();
}

function exportData() {
  const json = localStorage.getItem(STORAGE_KEY) || "{}";
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `endur-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Backup downloaded ✓");
}

function saveReminderTime() {
  const el = document.getElementById("reminder-time");
  if (!el || !el.value) return;
  state.settings.reminderTime = el.value;
  saveState(); scheduleReminder();
  showToast("Reminder set for " + el.value); render();
}

function selectTemplate(id) {
  if (id === "custom-expedition") {
    builderForm = defaultBuilderForm();
    builderForm.name = "";
    builderForm.emoji = "🗺️";
    builderStep = "expedition-custom";
    render();
    return;
  }
  const template = id==="custom" ? null : TEMPLATES.find(t=>t.id===id);
  builderForm.templateId = id==="custom" ? null : id;
  builderForm.name  = template ? template.name  : "";
  builderForm.emoji = template ? template.emoji : "🎯";
  builderForm.mode  = template ? template.defaultMode : "soft";
  builderForm.weeklyGoal = template ? template.weeklyGoal : 100;
  builderForm.endDate = addDays(builderForm.startDate, (template?template.duration:30)-1);
  builderForm.habits = [];
  // Custom challenges always go straight to customize; templates get the quickstart screen
  builderStep = (id === "custom") ? "customize" : "quickstart";
  render();
}

function renderBuilderQuickstart() {
  const template = TEMPLATES.find(t => t.id === builderForm.templateId);
  if (!template) { builderStep = "customize"; render(); return ""; }
  const tier = TEMPLATE_TIERS[template.id] || "common";
  const td   = TIERS[tier];
  const dur  = diffDays(builderForm.startDate, builderForm.endDate) + 1;
  const habits = template.habits.slice(0, 5);
  const xpTheme  = JOURNEY_THEMES[state.settings.journeyTheme] || JOURNEY_THEMES.endur;
  const weeklyXP = template.habits.reduce((sum, h) => sum + (h.points || 2), 0) * 7;
  return `
  <div class="builder-quickstart">
    <div class="bqs-hero">
      <div class="bqs-emoji"><i class="ti ${challengeIcon(template)}"></i></div>
      <div class="bqs-tier" style="color:var(--accent)">${td.label}</div>
      <div class="bqs-name">${esc(template.name)}</div>
      <div class="bqs-meta">${dur} days · starts today</div>
    </div>
    <div class="bqs-habits">
      ${habits.map(h => `<div class="bqs-habit-row"><i class="ti ti-check"></i> ${esc(h.title)}</div>`).join("")}
      ${template.habits.length > 5 ? `<div class="bqs-habit-row" style="color:var(--text-faint)">+ ${template.habits.length - 5} more</div>` : ""}
    </div>
    <div class="bqs-desc">${esc(template.description)}</div>
    ${TEMPLATE_SAFETY[template.id] ? `<div class="bqs-safety-warning"><span class="bqs-safety-icon"><i class="ti ti-alert-triangle"></i></span><span>${TEMPLATE_SAFETY[template.id]}</span></div>` : ""}
    <div class="bqs-xp-row">
      <i class="ti ti-bolt"></i> Earn ~<strong>${weeklyXP.toLocaleString()} XP</strong> per week logging everything
    </div>
    <div class="bqs-mode-note">
      ${template.defaultMode === "soft"
        ? "<strong>Soft mode</strong> — one grace day per week if life gets in the way."
        : "<strong>Strict mode</strong> — no missed days. Zero compromise."}
    </div>
    <div class="builder-cta-footer">
      <button class="primary-button" data-start-challenge>Start ${dur}-day challenge</button>
      <button class="secondary-button" style="margin-top:8px" data-quickstart-customise>Customise first →</button>
      <button class="link-btn" style="margin-top:10px;text-align:center;display:block" data-builder-back>← Choose a different challenge</button>
    </div>
  </div>`;
}

function startChallenge(safetyConfirmed = false) {
  const nameEl       = document.getElementById("bf-name");
  const startEl      = document.getElementById("bf-start");
  const endEl        = document.getElementById("bf-end");
  const ongoingEl    = document.getElementById("bf-ongoing");
  const goalWeightEl = document.getElementById("bf-goalweight");
  if (nameEl)       builderForm.name      = nameEl.value.trim();
  if (startEl)      builderForm.startDate = startEl.value;
  if (ongoingEl)    builderForm.noEndDate = ongoingEl.checked;
  if (endEl && !builderForm.noEndDate) builderForm.endDate = endEl.value;
  if (builderForm.noEndDate) builderForm.endDate = "9999-12-31";
  if (goalWeightEl?.value) builderForm.goalWeight = parseFloat(goalWeightEl.value) || null;
  if (!builderForm.startDate) { showToast("Set a start date."); return; }
  if (!builderForm.noEndDate && !builderForm.endDate) { showToast("Set an end date or enable Ongoing."); return; }
  const template = builderForm.templateId ? TEMPLATES.find(t=>t.id===builderForm.templateId) : null;
  const habitCount = template ? template.habits.length : builderForm.habits.length;
  if (habitCount === 0) { showToast("Add at least one task first."); return; }
  if (!safetyConfirmed && template && TEMPLATE_SAFETY[template.id]) {
    _safetyPendingTemplateId = template.id;
    render();
    return;
  }
  _safetyPendingTemplateId = null;
  const c = createChallenge(builderForm);
  todayChallengeId = c.id;
  builderOpen = false;
  activeTab = "today";
  showToast(`${c.emoji} ${c.name} started!`);
  trackEvent("Challenge Started", { challenge: c.name, template: builderForm.templateId || "custom" });
  if (_skipAccountAfterStart && !CloudSync.isSignedIn) {
    _skipAccountAfterStart = false;
    _obAuthMode = "signup";
    _obAuthError = "";
    onboardingStep = ONBOARDING_STEPS.length + 4;
    render(); return;
  }
  _skipAccountAfterStart = false;
  render();
}

function addCustomHabit() {
  const emoji = (document.getElementById("nh-emoji")?.value||"⭐").trim()||"⭐";
  const name  = (document.getElementById("nh-name")?.value||"").trim();
  if (!name) { showToast("Enter a task name."); return; }

  if (builderForm.newHabitType === "tiered") {
    const tiers = builderForm.newHabitTiers.map((t, i) => ({
      label:  (document.getElementById(`nh-tier-${i}-label`)?.value || t.label || `Tier ${i+1}`).trim() || `Tier ${i+1}`,
      value:  i,
      points: Math.max(1, Math.min(20, Number(document.getElementById(`nh-tier-${i}-pts`)?.value) || t.points)),
    }));
    if (tiers.filter(t => t.label).length < 2) { showToast("Fill in at least 2 tier labels."); return; }
    builderForm.habits.push({ id:uid(), title:name, emoji, quip:"", type:"tiered", points:tiers[0].points, tiers });
  } else {
    const pts = Math.max(1, Math.min(20, Number(document.getElementById("nh-pts")?.value)||2));
    builderForm.habits.push({ id:uid(), title:name, emoji, quip:"", type:"binary", points:pts });
  }

  builderForm.newHabitEmoji  = "⭐";
  builderForm.newHabitName   = "";
  builderForm.newHabitPoints = 2;
  builderForm.newHabitType   = "binary";
  builderForm.newHabitTiers  = [{ label:"", points:1 }, { label:"", points:2 }, { label:"", points:3 }];
  render();
}

function removeCustomHabit(i) {
  builderForm.habits.splice(i,1);
  render();
}

function saveEditChallenge() {
  const c = getChallenge(editChallengeId); if (!c) return;
  const name  = document.getElementById("ec-name")?.value.trim();
  const emoji = document.getElementById("ec-emoji")?.value.trim();
  const start = document.getElementById("ec-start")?.value;
  const end   = document.getElementById("ec-end")?.value;
  if (!start || !end || start > end) { showToast("Check your dates."); return; }
  if (name)  c.name       = name;
  if (emoji) c.emoji      = emoji;
  c.startDate  = start;
  c.endDate    = end;
  c.mode       = editForm?.mode || c.mode;

  // ── Apply habit changes ──────────────────────────────────────────────────
  if (editForm?.habits) {
    const newHabitIds = new Set(editForm.habits.map(h => h.id));
    // Strip deleted tasks from every logged day
    for (const day of Object.values(c.days)) {
      day.done  = day.done.filter(id => newHabitIds.has(id));
      if (day.tiers) {
        for (const id of Object.keys(day.tiers)) {
          if (!newHabitIds.has(id)) delete day.tiers[id];
        }
      }
      if (day.distances) {
        for (const id of Object.keys(day.distances)) {
          if (!newHabitIds.has(id)) delete day.distances[id];
        }
      }
      // Recalculate stored pts for this day
      updateDayPoints(c, day);
    }
    c.habits = editForm.habits;
    if (c.habits.length === 0) { showToast("Add at least one habit."); return; }
  }

  state.xp = recalcXP();
  saveState();
  checkBadges(c);
  editChallengeId = null;
  editForm        = null;
  viewChallengeId = c.id;
  showToast("Challenge updated ✓");
  render();
}

function extendChallenge(id, days) {
  const c = getChallenge(id); if (!c || c.noEndDate) return;
  const base = c.endDate < todayKey() ? todayKey() : c.endDate;
  c.endDate = addDays(base, days);
  const rk = challengeRouteKm(c);
  if (c.status === "completed" && rk && challengeTotalKm(c) < rk) { c.status = "active"; delete c.completedAt; }
  showToast(`Deadline extended by ${days} days.`);
  saveState(); render();
}

function pauseChallenge(id) {
  const c = getChallenge(id); if (!c) return;
  if (c.status === "paused") {
    // Resuming: push end date forward by however many days it was paused
    const pausedOn = c.pausedOn || todayKey();
    const daysPaused = Math.max(0, diffDays(pausedOn, todayKey()));
    if (daysPaused > 0) c.endDate = addDays(c.endDate, daysPaused);
    c.pausedDays = (c.pausedDays || 0) + daysPaused;
    c.status = "active";
    delete c.pausedOn;
    showToast(`Challenge resumed. End date moved to ${c.endDate}.`);
    saveState(); render();
  } else {
    c.status = "paused";
    c.pausedOn = todayKey();
    c.resumeReminderDate = null;
    saveState(); render();
    showPrompt("Set a resume reminder? (days from now)", "7", (val) => {
      const days = parseInt(val || "0", 10);
      const ch = getChallenge(id); if (!ch) return;
      if (days > 0) {
        ch.resumeReminderDate = addDays(todayKey(), days);
        showToast(`Paused. Reminder set for ${ch.resumeReminderDate}.`);
      } else {
        showToast("Challenge paused. End date adjusts when you resume.");
      }
      saveState();
    });
  }
}

function abandonChallenge(id) {
  const c = getChallenge(id); if (!c) return;
  showConfirm(
    `Abandon "${c.name}"? Progress is kept but the challenge will be marked as failed.`,
    () => {
      c.finalStreak = calcChallengeStreak(c);
      c.status = "failed";
      saveState(); viewChallengeId = null;
      showToast("Challenge abandoned."); render();
    }
  );
}

function exportHealthCSV(challenge) {
  const mHabits = challenge.habits.filter(h => h.type === "measurement");
  if (!mHabits.length) return;
  const resolveUnit = h => h.unit === "weight" ? (state.settings.units.weight || "kg") : (h.unit || "");
  const cols = mHabits.map(h => `"${h.title} (${resolveUnit(h)})"`).join(",");
  const rows = [`Date,${cols}`];
  const sortedDays = Object.entries(challenge.days)
    .filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort(([a],[b]) => a.localeCompare(b));
  for (const [date, day] of sortedDays) {
    const vals = mHabits.map(h => {
      const v = day.distances?.[h.id];
      return (v != null && v > 0) ? v : "";
    });
    if (vals.some(v => v !== "")) rows.push(`${date},${vals.join(",")}`);
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${challenge.name.replace(/[^a-z0-9]/gi,"-")}-health-data.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function deleteChallenge(id) {
  const c = getChallenge(id); if (!c) return;
  showConfirm(
    `Delete "${c.name}"? All progress will be permanently removed.`,
    () => {
      delete state.challenges[id];
      saveState(); viewChallengeId = null;
      showToast("Challenge deleted."); render();
    }
  );
}

function useStreakFreeze() {
  const c = currentChallenge(); if (!c) return;
  if ((c.streakFreezes || 0) <= 0) { showToast("No streak freezes available."); return; }
  const yesterday = addDays(todayKey(), -1);
  if (yesterday < c.startDate) { showToast("Nothing to freeze — challenge just started."); return; }
  const day = getChallengeDay(c, yesterday);
  if (dayLogged(day)) { showToast("Yesterday is already logged. No freeze needed."); return; }
  day.freezeUsed = true;
  c.streakFreezes--;
  saveState();
  showToast("Streak freeze applied. Yesterday is covered. Streak protected.");
  render();
}

async function captureProgressPhoto(habitId) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.capture = "environment";
  Object.assign(input.style, { position:"absolute", width:"1px", height:"1px", opacity:"0", pointerEvents:"none" });
  document.body.appendChild(input);
  input.onchange = async e => {
    const file = e.target.files?.[0];
    document.body.removeChild(input);
    if (!file) return;
    showToast("Saving photo…");
    const c = currentChallenge(); if (!c) return;
    const dateKey = effectiveDate();
    try {
      const dataURL = await compressPhoto(file);
      if (!dataURL) { showToast("Couldn't process photo — try again."); return; }
      await PhotoDB.set(`${c.id}_${dateKey}`, dataURL);
      const day = getChallengeDay(c, dateKey);
      if (!day.done.includes(habitId)) {
        day.done.push(habitId); _animHabitId = habitId;
        updateDayPoints(c, day); state.xp = recalcXP(); saveState(); checkBadges(c);
      }
      showToast("📸 Progress photo saved!");
      render();
    } catch(err) { showToast("Couldn't save photo — try again."); }
  };
  input.click();
}

function compressPhoto(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxDim = 480;
      const ratio  = Math.min(maxDim / img.width, maxDim / img.height, 1);
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function saveNote() {
  const c = currentChallenge(); if (!c) return;
  const day = getChallengeDay(c, effectiveDate());
  const el = document.getElementById("day-note");
  if (!el) return;
  day.note = el.value;
  saveState();
}

// Returns true if the challenge is in soft mode AND yesterday was a missed day
// (meaning the grace day is "live" and today's log matters to keep the streak)
function graceUsedYesterday(challenge) {
  if (challenge.mode !== "soft") return false;
  if (dayLogged(challenge.days[todayKey()])) return false;  // today already logged; no warning needed
  const yesterday = addDays(todayKey(), -1);
  if (yesterday < challenge.startDate) return false;
  const yDay = challenge.days[yesterday];
  if (dayLogged(yDay)) return false;  // yesterday was logged, no grace in play
  // Only show warning if streak is still running (day before yesterday was logged, or it's only day 2)
  const twoDaysAgo = addDays(todayKey(), -2);
  if (twoDaysAgo < challenge.startDate) return true; // day 2: yesterday missed from first day
  const twoDay = challenge.days[twoDaysAgo];
  return dayLogged(twoDay);
}

// ── Confetti ──────────────────────────────────────────────────────────────

function launchConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["var(--primary)","var(--secondary)","var(--success)","#ffcc44","#f43f5e","#38bdf8"];
  const count = 48;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.cssText = [
      `left:${Math.random() * 100}vw`,
      `width:${6 + Math.random() * 6}px`,
      `height:${8 + Math.random() * 8}px`,
      `background:${colors[Math.floor(Math.random() * colors.length)]}`,
      `animation-duration:${0.9 + Math.random() * 1.1}s`,
      `animation-delay:${Math.random() * 0.5}s`,
    ].join(";");
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────

function showToast(msg) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  // Cap simultaneous toasts so badge bursts don't stack endlessly
  while (stack.children.length >= 3) stack.removeChild(stack.firstChild);
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function currentGreeting(challenge, dayNumber, streak) {
  const totalHabits = Object.values(state.challenges).reduce((sum, c) =>
    sum + Object.values(c.days).reduce((s, d) => s + (d.done?.length || 0), 0), 0);
  const h = new Date().getHours();
  const t = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  // Streak-based (highest priority — most motivating)
  if (streak >= 50) return `${streak}-day streak. You are in the 1%.`;
  if (streak >= 30) return `${streak} days straight. Most people never get here.`;
  if (streak >= 21) return `${streak} days. The average person quits at day 12. You didn't.`;
  if (streak >= 14) return `${streak} in a row. The week-one graveyard is behind you.`;
  if (streak >= 7)  return `${streak}-day streak. Habit is forming. Don't stop now.`;
  if (streak >= 3)  return `${streak} days in a row. The streak is real.`;
  // Data-driven on total habits logged
  if (totalHabits >= 200) return `${totalHabits} habits logged. You're not the same person you were.`;
  if (totalHabits >= 100) return `${totalHabits} habits. 100 small decisions that add up.`;
  if (totalHabits >= 50)  return `${totalHabits} habits logged. You've built more than you realise.`;
  // Day-number narrative
  if (dayNumber === 1) return `Day 1. Every legend has a first day. Make it count.`;
  if (dayNumber <= 3)  return `Day ${dayNumber} — the hardest days are the first ones. You're in them.`;
  if (dayNumber <= 7)  return `Day ${dayNumber} — still in the building phase. Trust the process.`;
  if (dayNumber >= 21) return `Day ${dayNumber}. Most people never make it this far.`;
  if (dayNumber >= 14) return `Day ${dayNumber}. Habit is forming. Keep the chain unbroken.`;
  // Time-of-day fallback
  if (t === "morning")   return `Good morning. The mission continues.`;
  if (t === "afternoon") return `Good afternoon. Close it out strong.`;
  return `Good evening. One more day in the books.`;
}

function isAfterSix() { return new Date().getHours()>=18; }
function formatDate(d,opts) { return new Intl.DateTimeFormat(undefined,opts).format(d); }
function pickRandom(arr,n) { return [...arr].sort(()=>Math.random()-0.5).slice(0,n); }
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }

// ── Notifications ────────────────────────────────────────────────────────

function scheduleReminder() {
  clearTimeout(reminderTimeout);
  if (!state.settings.reminderEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const [h, m] = (state.settings.reminderTime || "20:00").split(":").map(Number);
  const now = new Date();
  const fire = new Date(now);
  fire.setHours(h, m, 0, 0);
  if (fire <= now) fire.setDate(fire.getDate() + 1);
  reminderTimeout = setTimeout(() => { fireReminder(); scheduleReminder(); }, fire - now);
}

function fireReminder() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const incomplete = getActiveChallenges().filter(c => {
    const d = c.days[todayKey()];
    return !d || completionInfo(c, d).percent < 100;
  });
  if (!incomplete.length) return;
  const names = incomplete.length === 1
    ? incomplete[0].name
    : `${incomplete.length} challenges`;
  new Notification("Endur - Don't break the streak", {
    body: `${names}: you still have tasks left for today.`,
    icon: "/icons/icon-192.svg",
    tag: "endur-daily",
    renotify: true,
  });
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) { showToast("Notifications aren't supported in this browser."); return; }
  const timeInput = document.getElementById("notif-time-input");
  if (timeInput?.value) { state.settings.reminderTime = timeInput.value; saveState(); }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    state.settings.reminderEnabled = true;
    saveState();
    scheduleReminder();
    showToast("Reminders on. You'll be nudged at " + state.settings.reminderTime);
  } else {
    state.settings.reminderEnabled = false;
    saveState();
    showToast("Permission denied. Enable notifications in your browser settings.");
  }
  render();
}

// ── Auto-update System ────────────────────────────────────────────────────

async function clearAppCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith("cruise-mode-")||k.startsWith("endur-")).map(k=>caches.delete(k)));
}

function reloadForUpdate() {
  if (sessionStorage.getItem("endur_reloaded")===APP_VERSION) return;
  sessionStorage.setItem("endur_reloaded", APP_VERSION);
  window.location.reload();
}

async function applyAppUpdate(next) {
  console.info(`Endur update: ${APP_VERSION} → ${next}`);
  await clearAppCaches();
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  }
  reloadForUpdate();
}

let _lastUpdateCheckTime = 0;

async function checkForAppUpdate() {
  _lastUpdateCheckTime = Date.now();
  try {
    const r = await fetch(`/app-version.json?t=${Date.now()}`,{cache:"no-store"});
    if (!r.ok) return;
    const info = await r.json();
    if (info.version && info.version!==APP_VERSION) await applyAppUpdate(info.version);
  } catch(e) { console.warn("Update check failed",e); }
}

function startUpdateChecks() {
  if (!("fetch" in window)) return;
  checkForAppUpdate();
  setInterval(checkForAppUpdate, UPDATE_CHECK_MS);
  // Throttle: skip visibility-triggered checks that happen within 5 min of the last one
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (Date.now() - _lastUpdateCheckTime > 5 * 60 * 1000) checkForAppUpdate();
      scheduleReminder();
    } else {
      flushCloudPush();  // app backgrounded — don't let a fresh log wait out the debounce
    }
  });
  window.addEventListener("pagehide", flushCloudPush);
}

// ── Boot ──────────────────────────────────────────────────────────────────

if ("serviceWorker" in navigator && location.protocol!=="file:") {
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("/sw.js")
      .then(r=>r.update())
      .catch(e=>console.warn("SW failed",e));
  });
  navigator.serviceWorker.addEventListener("message",event=>{
    if (event.data?.type==="APP_UPDATED" && event.data.version!==APP_VERSION) reloadForUpdate();
  });
  navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);
}

function setDynamicIcon() {
  const link = document.querySelector("link[rel='icon']");
  if (!link) return;
  const cs = getComputedStyle(document.documentElement);
  const c1 = cs.getPropertyValue("--primary").trim()   || "#d97742";
  const c2 = cs.getPropertyValue("--secondary").trim() || "#e0935f";
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="192" height="192" rx="42" fill="#000"/><circle cx="96" cy="96" r="76" fill="none" stroke="#111" stroke-width="11"/><circle cx="96" cy="96" r="76" fill="none" stroke="var(--accent)" stroke-width="11" stroke-linecap="round" stroke-dasharray="358 120" transform="rotate(-90 96 96)"/><text x="96" y="96" text-anchor="middle" dominant-baseline="central" font-family="'Lato',system-ui,sans-serif" font-weight="900" font-size="88" fill="var(--accent)">E</text></svg>`;
  link.href=`data:image/svg+xml,${encodeURIComponent(svg)}`;
}

startUpdateChecks();
updateChallengeStatuses();
// Migration: badge system V2 — universal/lifetime/template architecture replaces single flat list
if (!state.migrations["badgeSystemV2"]) {
  for (const c of Object.values(state.challenges)) { c.badges = []; }
  state.globalBadges = [];
  for (const c of Object.values(state.challenges)) {
    if (Object.keys(c.days).length > 0) checkBadges(c);
  }
  state.migrations["badgeSystemV2"] = true;
  saveState();
}
// Migration: XP system — calculate initial XP from all existing challenge data
if (!state.migrations["xpSystemV1"]) {
  state.xp = recalcXP();
  state.migrations["xpSystemV1"] = true;
  saveState();
}
// Migration: recalculate all cached d.pts after bonus formula change (bonus now only for 3+ habit challenges)
if (!state.migrations["dPtsRecalcV1"]) {
  for (const c of Object.values(state.challenges)) {
    for (const day of Object.values(c.days)) updateDayPoints(c, day);
  }
  state.xp = recalcXP();
  state.migrations["dPtsRecalcV1"] = true;
  saveState();
}
// Migration: fix expedition challenges with unreachable weeklyGoal of 20 (max achievable is 7)
if (!state.migrations["expeditionGoalV1"]) {
  for (const c of Object.values(state.challenges)) {
    if (c.habits.length === 1 && c.habits[0].type === "distance" && c.weeklyGoal === 20) {
      c.weeklyGoal = 5;
    }
  }
  state.migrations["expeditionGoalV1"] = true;
  saveState();
}
// Migration: rename saved walking challenge habit and backfill newly added swim badges
if (!state.migrations["fitnessTemplateRefreshV1"]) {
  for (const c of Object.values(state.challenges)) {
    let pointsNeedUpdate = false;
    if (c.templateId === "walking") {
      for (const h of c.habits || []) {
        if (h.id === "wk-phone" || h.title === "Phone-free walk") {
          h.id = "wk-pace";
          h.title = "Brisk pace segment";
          h.quip = "Add 5-10 minutes where breathing gets heavier.";
          h.type = "binary";
          h.points = 2;
          pointsNeedUpdate = true;
        }
      }
      if (pointsNeedUpdate) {
        for (const day of Object.values(c.days || {})) {
          if (Array.isArray(day.done) && day.done.includes("wk-phone") && !day.done.includes("wk-pace")) {
            day.done = day.done.map(id => id === "wk-phone" ? "wk-pace" : id);
          }
          updateDayPoints(c, day);
        }
      }
    }
    if (["swim-foundation", "swim-1k", "open-water-prep"].includes(c.templateId)) {
      checkBadges(c);
    }
  }
  state.xp = recalcXP();
  state.migrations["fitnessTemplateRefreshV1"] = true;
  saveState();
}

// Show onboarding for truly new users (no challenges yet)
if (!Object.keys(state.challenges).length) {
  onboardingStep = 0;
}
// Monday new-week ceremony
checkNewWeekCeremony();
// PWA install prompt capture
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); _pwaInstallPrompt = e; });
saveState();
scheduleReminder();
setDynamicIcon();
CloudSync.init();

// ── Network status — offline banner + auto-retry on reconnect ─────────────
window.addEventListener("offline", () => { _isOffline = true; render(); });
window.addEventListener("online",  () => {
  _isOffline = false;
  _lastSyncError = false;
  if (CloudSync.isSignedIn) CloudSync.push();
  else render();
});

// ── History API: Android swipe-back stays inside the app ──────────────────
// Push a dummy history entry so the first "back" gesture pops state instead
// of navigating the browser away from the PWA.
function _pushAppState() {
  history.pushState({ endur: true }, "");
}
function _isInSubview() {
  return !!(viewChallengeId || editChallengeId || builderOpen || settingsOpen);
}
_pushAppState(); // initial entry
window.addEventListener("popstate", () => {
  if (_isInSubview()) {
    // Navigate back to the main view instead of leaving
    viewChallengeId = null; editChallengeId = null;
    builderOpen = false; settingsOpen = false; editForm = null;
    render();
  } else {
    // Already at root — re-push so the next back also stays in app
    activeTab = "today";
    todayChallengeId = "__all__";
    render();
  }
  _pushAppState();
});

render();
