"use strict";
/* Loads the browser scripts (no DOM needed) into one sandbox, the same way the page does. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILES = ["workouts.js", "core.js", "challenges.js", "progress.js", "sync.js"];
const EXPORTS = [
  "EXERCISES", "TEMPLATES", "PROGRAMS", "WARMUP", "COOLDOWN", "LOW_IMPACT_IDS", "PATTERNS",
  "createWorkout", "compile", "resolveSegments", "swappableIds", "planTotals", "IntervalEngine",
  "hasGear", "gearPlan", "allExerciseIds", "programSessions", "programParams", "programStatus", "programById",
  "recommend", "weeklySeries", "weekStreak", "dayRun", "patternBalance", "badgeStatus", "progressionAdvice",
  "startOfWeek", "DAY_MS", "visitPatterns", "benchmarkLegs", "benchTotalMi",
  "stampChanges", "profileBlob", "mergeRemoteWorkouts", "pendingWorkoutRows", "deletionStamp",
  "BENCHMARKS", "SCORING", "DIVISIONS", "challengeById", "variantOf", "challengeWorkout", "scoreFromInputs", "formatScore",
  "ATHLETE_CATEGORIES", "activityRow", "competitionContext", "formatDelta", "prCheck", "bestAttempt", "rankEntries", "monthlyChallenge", "ageGroup", "EVENTS",
];

module.exports = function load() {
  const source = FILES.map(f => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n");
  const context = vm.createContext({ console, performance, Math, Date, JSON });
  return vm.runInContext(`${source}\n;({ ${EXPORTS.join(", ")} })`, context);
};
