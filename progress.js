"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Progress: weeks, streaks, movement balance, badges, recommendations,
   progression advice and the small SVG visuals (rings, bars, stars, sparklines).
   Reads the saved history only; it never changes it.
   ════════════════════════════════════════════════════════════════════════════ */

const DAY_MS = 86400000;

function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
/* Weeks start on Monday. */
function startOfWeek(ts) {
  const d = new Date(startOfDay(ts));
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

/* ── Aggregates ────────────────────────────────────────────────────────────── */

function sessionsInRange(history, from, to) {
  return history.filter(h => h.date >= from && h.date < to);
}

/* Last n weeks, oldest first: [{ start, count, minutes }] */
function weeklySeries(history, n = 12, now = Date.now()) {
  const thisWeek = startOfWeek(now);
  return Array.from({ length: n }, (_, i) => {
    const start = thisWeek - (n - 1 - i) * 7 * DAY_MS;
    const list = sessionsInRange(history, start, start + 7 * DAY_MS);
    return { start, count: list.length, minutes: Math.round(list.reduce((a, h) => a + h.stats.totalSec, 0) / 60) };
  });
}

/* Consecutive weeks meeting the goal. The current week counts once it is met;
   until then the streak is carried from last week so it never looks broken mid-week. */
function weekStreak(history, goal, now = Date.now()) {
  const weeks = weeklySeries(history, 104, now);
  let i = weeks.length - 1;
  let streak = 0;
  if (weeks[i].count >= goal) streak++;
  i--;
  for (; i >= 0 && weeks[i].count >= goal; i--) streak++;
  return streak;
}

function bestWeekStreak(history, goal, now = Date.now()) {
  let best = 0, run = 0;
  weeklySeries(history, 104, now).forEach(w => { run = w.count >= goal ? run + 1 : 0; best = Math.max(best, run); });
  return best;
}

/* Days in a row with a workout, ending today or yesterday. */
function dayRun(history, now = Date.now()) {
  const days = new Set(history.map(h => dayKey(h.date)));
  let d = startOfDay(now);
  if (!days.has(dayKey(d))) d -= DAY_MS;
  let n = 0;
  while (days.has(dayKey(d))) { n++; d -= DAY_MS; }
  return n;
}

/* Seconds per movement pattern over the last `days` days. */
function patternBalance(history, days = 30, now = Date.now()) {
  const from = now - days * DAY_MS;
  const out = Object.fromEntries(PATTERNS.map(p => [p.id, 0]));
  history.filter(h => h.date >= from).forEach(h => {
    Object.entries(h.patterns || {}).forEach(([p, sec]) => { if (p in out) out[p] += sec; });
  });
  return out;
}

function totals(history) {
  return {
    sessions: history.length,
    seconds: history.reduce((a, h) => a + h.stats.totalSec, 0),
    runMi: history.reduce((a, h) => a + (h.stats.distance || 0), 0),
    rated: history.filter(h => h.rating > 0),
  };
}

/* ── Badges ───────────────────────────────────────────────────────────────── */

const BADGES = [
  { id: "first",   icon: "ti-player-play", name: "First session",   desc: "Finish your first workout",   value: c => c.sessions, goal: 1 },
  { id: "five",    icon: "ti-award",       name: "Five down",       desc: "Finish 5 workouts",           value: c => c.sessions, goal: 5 },
  { id: "ten",     icon: "ti-medal",       name: "Ten strong",      desc: "Finish 10 workouts",          value: c => c.sessions, goal: 10 },
  { id: "quarter", icon: "ti-trophy",      name: "Twenty-five",     desc: "Finish 25 workouts",          value: c => c.sessions, goal: 25 },
  { id: "streak4", icon: "ti-flame",       name: "Month of habit",  desc: "Hit your weekly goal 4 weeks in a row", value: c => c.bestStreak, goal: 4 },
  { id: "hours10", icon: "ti-hourglass",   name: "Ten hours",       desc: "Train for 10 hours in total", value: c => Math.floor(c.seconds / 3600), goal: 10 },
  { id: "marathon",icon: "ti-route",       name: "Marathon miles",  desc: "Run 26.2 miles in workouts",  value: c => Math.floor(c.runMi * 10) / 10, goal: 26.2 },
  { id: "explorer",icon: "ti-books",       name: "Explorer",        desc: "Try 5 different workouts",   value: c => c.variety, goal: 5 },
  { id: "bench",   icon: "ti-target",      name: "Benchmarked",     desc: "Log a Row → Bike → Run benchmark", value: c => c.benchmarks, goal: 1 },
  { id: "pb",      icon: "ti-trending-up", name: "Personal best",   desc: "Beat your own benchmark total", value: c => c.pbs, goal: 1 },
  { id: "plan",    icon: "ti-calendar-event", name: "Plan finished", desc: "Complete a 4-week program", value: c => c.plans, goal: 1 },
  { id: "month1",  icon: "ti-medal-2",     name: "Monthly challenger", desc: "Complete a monthly challenge", value: c => c.months, goal: 1 },
  { id: "month3",  icon: "ti-calendar-star", name: "Regular",        desc: "Complete 3 monthly challenges", value: c => c.months, goal: 3 },
  { id: "bench5",  icon: "ti-target",      name: "Five benchmarks",  desc: "Set a result in 5 different benchmarks", value: c => c.benchDone, goal: 5 },
  { id: "pr5",     icon: "ti-trending-up", name: "Record breaker",   desc: "Set 5 personal records", value: c => c.prCount, goal: 5 },
  { id: "compdiv", icon: "ti-award",       name: "Competitive standard", desc: "Finish a benchmark in the Competitive division", value: c => c.competitive, goal: 1 },
  { id: "elitediv",icon: "ti-trophy",      name: "Elite standard",   desc: "Finish a benchmark in the Elite division", value: c => c.elite, goal: 1 },
  { id: "event1",  icon: "ti-flame",       name: "Event athlete",   desc: "Record a result in a special event", value: c => c.eventResults, goal: 1 },
  { id: "verified",icon: "ti-circle-check", name: "Verified",        desc: "Get a result verified by video", value: c => c.verifiedResults, goal: 1 },
  { id: "warm",    icon: "ti-shield-check",name: "Warmed up",       desc: "Finish 10 workouts with a warm-up", value: c => c.warmups, goal: 10 },
];

function badgeContext(history, goal) {
  const t = totals(history);
  let pbs = 0;
  const bestSoFar = {};
  [...history].sort((a, b) => a.date - b.date).forEach(h => {
    const v = h.bench?.totalMi || 0;
    if (!v) return;
    if (bestSoFar[h.templateId] && v > bestSoFar[h.templateId]) pbs++;
    bestSoFar[h.templateId] = Math.max(bestSoFar[h.templateId] || 0, v);
  });
  return {
    sessions: t.sessions, seconds: t.seconds, runMi: t.runMi,
    bestStreak: bestWeekStreak(history, goal),
    variety: new Set(history.map(h => h.templateId)).size,
    benchmarks: history.filter(h => h.bench?.totalMi > 0).length,
    pbs, warmups: history.filter(h => h.stats.warmSec > 0).length,
    plans: history.filter(h => h.programDone).length,
    ...competitionContext(history),
  };
}

function badgeStatus(history, goal) {
  const c = badgeContext(history, goal);
  return BADGES.map(b => {
    const v = b.value(c);
    return { ...b, current: v, earned: v >= b.goal, pct: Math.min(1, v / b.goal) };
  });
}

/* ── Recommendation for today ──────────────────────────────────────────────── */

const CHECKINS = [
  { id: "fresh", label: "Fresh", icon: "ti-bolt" },
  { id: "ok",    label: "A bit stiff", icon: "ti-mood-smile" },
  { id: "sore",  label: "Sore", icon: "ti-alert-triangle" },
  { id: "pain",  label: "Pain or injury", icon: "ti-first-aid-kit" },
];

/* candidates: [{ t, doable, minutes }] */
function recommend({ history, candidates, checkin, level, now = Date.now() }) {
  if (checkin === "pain") {
    return { rest: true, title: "Rest and recover today",
      reason: "Training through pain is how small niggles become injuries. Walk, stretch gently, and see a professional if it doesn't settle." };
  }
  const run = dayRun(history, now);
  const trainedToday = history.some(h => startOfDay(h.date) === startOfDay(now));
  const balance = patternBalance(history, 14, now);
  const strengthPatterns = ["squat", "hinge", "lunge", "push", "pull", "carry"];
  const weakest = strengthPatterns.reduce((a, p) => (balance[p] < balance[a] ? p : a), strengthPatterns[0]);
  const lastDone = id => history.find(h => h.templateId === id)?.date || 0;
  const levelRank = { beginner: 0, intermediate: 1, advanced: 2 };
  const soreish = checkin === "sore" || run >= 3;

  const scored = candidates.filter(c => c.doable).map(c => {
    let score = 0;
    const reasons = [];
    const since = (now - lastDone(c.t.id)) / DAY_MS;
    if (!lastDone(c.t.id)) { score += 2; reasons.push("Something new for you"); }
    else if (since > 7) { score += 3; reasons.push(`You haven't done this in ${Math.floor(since)} days`); }
    else if (since < 2) score -= 4;
    const gap = Math.abs((levelRank[c.t.level] ?? 1) - (levelRank[level] ?? 1));
    score -= gap * 1.5;
    // Never suggest a session more than one level above the athlete.
    if ((levelRank[c.t.level] ?? 1) - (levelRank[level] ?? 1) >= 2) score -= 100;
    if (soreish) {
      if (LOW_IMPACT_IDS.includes(c.t.id)) { score += 5; reasons.unshift(run >= 3 ? `${run} days in a row: keep today low impact` : "Low impact for sore legs"); }
      if (c.t.focus.includes("strength-heavy") || c.t.level === "advanced") score -= 4;
    }
    if (checkin === "fresh" && c.t.level === "advanced" && level !== "beginner") score += 1;
    if (c.patterns.has(weakest) && history.length) { score += 2; reasons.push(`Builds your least-trained pattern: ${PATTERNS.find(p => p.id === weakest).label.toLowerCase()}`); }
    const lastRating = history.find(h => h.templateId === c.t.id)?.rating || 0;
    if (lastRating >= 4) { score += 1; reasons.push(`You rated it ${lastRating} stars last time`); }
    return { ...c, score, reason: reasons[0] || "A balanced session for today" };
  }).sort((a, b) => b.score - a.score);

  const pick = scored[0];
  if (!pick) return null;
  return { pick, alternatives: scored.slice(1, 3), note: trainedToday ? "You already trained today. A second session is optional." : run >= 3 ? "Consider a rest day soon. Recovery is when you get fitter." : "" };
}

/* ── Progression advice after a session ───────────────────────────────────── */

function progressionAdvice(template, params, feel) {
  if (!feel || feel === "right") return null;
  const dir = feel === "easy" ? 1 : -1;
  const find = key => template.params.find(p => p.key === key);
  const clamp = (p, v) => Math.min(p.max, Math.max(p.min, Math.round(v * 10) / 10));
  const speed = find("speed");
  const rounds = find("rounds");
  const workKey = ["stationSec", "workSec", "strengthSec", "carrySec", "circuitSec", "legSec", "machineSec", "cardioSec"].find(find);
  let change = null;
  if (speed && clamp(speed, params.speed + dir * 0.3) !== params.speed) {
    const v = clamp(speed, params.speed + dir * 0.3);
    change = { key: "speed", value: v, text: `Treadmill ${fmtSpeed(params.speed)} → ${fmtSpeed(v)} mph` };
  } else if (rounds && clamp(rounds, params.rounds + dir) !== params.rounds) {
    const v = clamp(rounds, params.rounds + dir);
    change = { key: "rounds", value: v, text: `${params.rounds} → ${v} rounds` };
  } else if (workKey) {
    const p = find(workKey);
    const v = clamp(p, params[workKey] + dir * p.step);
    if (v !== params[workKey]) change = { key: workKey, value: v, text: `${p.label} ${fmtShort(params[workKey])} → ${fmtShort(v)}` };
  }
  if (!change) return null;
  return { ...change, title: dir > 0 ? "Make it a little harder next time" : "Make it a little easier next time" };
}

/* ── SVG visuals ──────────────────────────────────────────────────────────── */

/* Progress ring. pct 0..1, centre is HTML placed over the ring. */
function ringSVG(pct, { size = 132, stroke = 10, label = "" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return `
  <svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
    ${p > 0 ? "" : "<!--"}<circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>${p > 0 ? "" : "-->"}
  </svg>`;
}

/* Five stars; interactive when `name` is given. Drawn, not icon-font, so a filled star stays on-brand. */
const STAR_PATH = "M12 2.8l2.75 5.8 6.35.75-4.7 4.35 1.25 6.3L12 16.85 6.35 20l1.25-6.3L2.9 9.35l6.35-.75z";
function starsSVG(value, { size = 18, act = null } = {}) {
  return `<span class="stars ${act ? "stars--input" : ""}" role="${act ? "radiogroup" : "img"}" aria-label="${value} of 5 stars">${[1, 2, 3, 4, 5].map(i => {
    const svg = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${STAR_PATH}" class="${i <= value ? "star-on" : "star-off"}"/></svg>`;
    return act ? `<button class="star-btn" data-act="${act}" data-value="${i}" role="radio" aria-checked="${i === value}" aria-label="${i} star${i > 1 ? "s" : ""}">${svg}</button>` : svg;
  }).join("")}</span>`;
}

/* Weekly workouts bar chart with a dashed goal line. */
function weeklyBarsSVG(weeks, goal) {
  const W = 340, H = 150, padL = 22, padB = 22, padT = 10;
  const max = Math.max(goal + 1, ...weeks.map(w => w.count), 3);
  const bw = (W - padL) / weeks.length;
  const y = v => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  const fmtWk = ts => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Workouts per week, last ${weeks.length} weeks">
    ${ticks.map(t => `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 6}" y="${y(t) + 3.5}" class="axis" text-anchor="end">${t}</text>`).join("")}
    ${weeks.map((w, i) => {
      const x = padL + i * bw + 3, h = Math.max(0, y(0) - y(w.count));
      const met = w.count >= goal;
      return `<g class="bar-g"><title>${fmtWk(w.start)}: ${w.count} workout${w.count === 1 ? "" : "s"} · ${w.minutes} min</title>
        <rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
        ${w.count ? `<path d="${roundTopBar(x, y(w.count), bw - 6, h, 3)}" class="${met ? "bar bar--met" : "bar"}"/>` : ""}
      </g>`;
    }).join("")}
    <line x1="${padL}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="goal-line"/>
    <text x="${padL + 4}" y="${y(goal) - 5}" class="axis axis--goal">Goal ${goal}</text>
    <text x="${padL}" y="${H - 6}" class="axis">${fmtWk(weeks[0].start)}</text>
    <text x="${W}" y="${H - 6}" class="axis" text-anchor="end">This week</text>
  </svg>`;
}

function roundTopBar(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* Benchmark trend: totals over attempts, best point emphasised. */
function sparklineSVG(values, { W = 300, H = 70 } = {}) {
  if (!values.length) return "";
  const pad = 8;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = i => (values.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (values.length - 1));
  const y = v => pad + (H - 2 * pad) * (1 - (v - min) / span);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const bestI = values.indexOf(max);
  const area = `M${x(0)},${H - pad} L${pts.join(" L")} L${x(values.length - 1)},${H - pad}Z`;
  return `
  <svg class="chart spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Benchmark totals over ${values.length} attempts">
    <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="grid"/>
    ${values.length > 1 ? `<path d="${area}" class="spark-area"/><polyline points="${pts.join(" ")}" class="spark-line"/>` : ""}
    ${values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === bestI ? 5 : 3}" class="${i === bestI ? "spark-best" : "spark-dot"}"><title>Attempt ${i + 1}: ${v.toFixed(2)} mi${i === bestI ? " (best)" : ""}</title></circle>`).join("")}
  </svg>`;
}

/* Badge inputs from benchmark attempts (challenges.js). */
function competitionContext(history) {
  const done = history.filter(h => h.attempt && !h.attempt.dnf);
  const months = new Set();
  done.forEach(h => {
    if (typeof monthlyChallenge !== "function") return;
    const m = monthlyChallenge(new Date(h.date));
    if (h.attempt.challengeId === m.challengeId && h.attempt.variant === m.variant) months.add(m.key);
  });
  return {
    months: months.size,
    benchDone: new Set(done.map(h => h.attempt.challengeId)).size,
    prCount: done.filter(h => h.attempt.pr).length,
    competitive: done.filter(h => h.attempt.division === "competitive").length,
    elite: done.filter(h => h.attempt.division === "elite").length,
    eventResults: done.filter(h => h.attempt.eventId).length,
    verifiedResults: done.filter(h => h.attempt.verification === "verified").length,
  };
}
