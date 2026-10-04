"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Compete: benchmarks, results, PRs, leaderboards, athlete profile.
   Screens only; the rules live in challenges.js. Uses app.js globals at call
   time (state, ui, save, render…), so it is loaded before app.js.
   ════════════════════════════════════════════════════════════════════════════ */

const DEFAULT_ATHLETE = { displayName: "", handle: "", birthYear: null, category: "open", division: "open", visibility: "private", leaderboards: false };
const athlete = () => ({ ...DEFAULT_ATHLETE, ...(state.athlete || {}) });
const SCORING_ICON = { time: "ti-stopwatch", distance: "ti-route", reps: "ti-repeat", load: "ti-barbell", rounds: "ti-rotate-clockwise", points: "ti-trophy", completion: "ti-check" };

/* Every saved attempt, newest first: { ...attempt, id, date, name }. */
function allAttempts() {
  return state.history.filter(h => h.attempt).map(h => ({ ...h.attempt, id: h.id, date: h.date }));
}
function attemptsFor(c, variant, division) {
  return allAttempts().filter(a => a.challengeId === c.id && (!variant || a.variant === variant) && (!division || a.division === division));
}

/* ── Compete tab ──────────────────────────────────────────────────────────── */
function renderCompete() {
  const ath = athlete();
  const filter = ui.benchFilter || "all";
  const groups = { all: () => true, time: c => c.scoring === "time", distance: c => c.scoring === "distance", strength: c => ["reps", "load", "rounds"].includes(c.scoring) };
  const list = BENCHMARKS.filter(groups[filter]);
  return `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">Train alone. Compete together.</div>
    <div class="hero-titlebar"><h1 class="hero-name">Compete</h1></div>
  </section>
  ${monthlyCard(true)}
  ${eventCard()}
  ${sectionLabel("Benchmarks", `<span class="cl-cat-count">${BENCHMARKS.length} permanent tests</span>`)}
  <div class="pad-y">${chips("data-bench-filter", [["all", "All"], ["time", "For time"], ["distance", "For distance"], ["strength", "Reps, load & rounds"]], filter)}</div>
  <div class="cl-list">${list.map(c => {
    const v = variantOf(c, c.defaultVariant);
    const best = bestAttempt(allAttempts(), c, v.id, ath.division);
    const tries = attemptsFor(c).length;
    return `
    <button class="cl-row" data-challenge="${c.id}">
      <i class="ti ${c.icon} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(c.name)}</span>
        <span class="cl-meta">${esc(c.tagline)}${tries ? ` · ${tries} attempt${tries === 1 ? "" : "s"}` : ""}</span></span>
      <span class="pr-chip ${best ? "" : "pr-chip--empty"}">${best ? esc(formatScore(c, best.score)) : "—"}</span>
    </button>`;
  }).join("")}</div>
  ${!Sync.user ? `<p class="hint"><i class="ti ti-trophy"></i> Sign in under Profile → Account & sync to join leaderboards. Your results and PRs work without an account.</p>` : ""}`;
}

function monthlyCard(full = false) {
  const m = monthlyChallenge();
  const c = challengeById(m.challengeId);
  const v = variantOf(c, m.variant);
  const daysLeft = Math.max(0, Math.ceil((m.end - Date.now()) / DAY_MS));
  const ath = athlete();
  const best = bestAttempt(allAttempts(), c, v.id, ath.division, { since: m.start, until: m.end });
  const board = ui.boards?.[boardKey(c.id, v.id, ath.division, "month")];
  const me = board?.rows?.find(r => r.is_me);
  if (full && Sync.user && ath.leaderboards && !board) loadBoard(c, v.id, ath.division, "month");
  return `
  <div class="pick monthly">
    <div class="pick-eyebrow"><i class="ti ti-calendar-event"></i> ${esc(m.monthName)} challenge · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</div>
    <button class="pick-main" data-challenge="${c.id}" data-variant="${v.id}">
      <span class="pick-name">${esc(c.name)}${c.variants.length > 1 ? `: ${esc(v.name)}` : ""}</span>
      <span class="pick-meta">${esc(c.tagline)}</span>
    </button>
    <div class="monthly-stats">
      <div><span class="stat-label">Your best this month</span><b>${best ? esc(formatScore(c, best.score)) : "Not yet"}</b></div>
      ${me ? `<div><span class="stat-label">Monthly rank</span><b>#${me.rank}<small> of ${me.total}</small></b></div>` : ""}
    </div>
    <button class="btn-primary" data-act="challenge-start" data-id="${c.id}" data-variant="${v.id}"><i class="ti ti-player-play"></i> ${best ? "Try to beat it" : "Take the challenge"}</button>
  </div>`;
}

function eventCard() {
  const e = EVENTS[0];
  const days = Math.max(0, Math.ceil((e.opensAt - Date.now()) / DAY_MS));
  return `
  <div class="event">
    <div class="event-kicker">Special event · opens in ${days} days</div>
    <div class="event-name">${esc(e.name)}</div>
    <div class="event-line">${esc(e.line)}</div>
    <p class="event-pitch">${esc(e.pitch)}</p>
    <div class="event-tests">${e.tests.map(t => `<span>${t}</span>`).join("<i>•</i>")}</div>
    <div class="cl-meta">Trials stay secret until competition week. Registration opens soon.</div>
  </div>`;
}

/* ── Challenge detail ─────────────────────────────────────────────────────── */
function renderChallenge() {
  const c = challengeById(ui.challengeId);
  const ath = athlete();
  const v = variantOf(c, ui.challengeVariant);
  const division = ui.challengeDivision || ath.division;
  const mine = attemptsFor(c, v.id, division).sort((a, b) => b.date - a.date);
  const best = bestAttempt(allAttempts(), c, v.id, division);
  const prIds = new Set();
  [...mine].reverse().reduce((b, a) => { if (isBetter(c, a.score, b) && !a.dnf) { prIds.add(a.id); return a.score; } return b; }, null);
  const missing = c.equipment.filter(e => !state.profile.equipment.includes(e));
  const series = [...mine].reverse().filter(a => !a.dnf).map(a => a.score);

  return `
  ${topbar("", backButton("compete", "Compete"))}
  <section class="hero">
    <div class="hero-daycount">${SCORING[c.scoring].label}${c.better === "higher" && c.scoring === "time" ? " (longest wins)" : ""} · ${cap(c.level)}</div>
    <div class="hero-titlebar"><i class="ti ${c.icon} hero-ic" aria-hidden="true"></i><h1 class="hero-name">${esc(c.name)}</h1></div>
    <p class="about">${esc(c.story)}</p>
  </section>

  ${c.variants.length > 1 ? `<div class="pad-y">${chips("data-cvariant", c.variants.map(x => [x.id, x.name]), v.id)}</div>` : ""}
  <div class="pad-y">${chips("data-cdivision", DIVISIONS.map(d => [d.id, d.label]), division)}
    ${c.divisions ? `<p class="hint">${esc(DIVISIONS.find(d => d.id === division).label)} standard: <b>${esc(c.divisions[division])}</b></p>` : ""}</div>

  <div class="pr-card">
    <div><span class="stat-label"><i class="ti ti-trophy"></i> Personal record</span>
      <b>${best ? esc(formatScore(c, best.score)) : "No result yet"}</b>
      <span class="cl-meta">${best ? `${fmtDate(best.date)} · ${mine.length} attempt${mine.length === 1 ? "" : "s"}` : "Your first attempt sets the mark."}</span></div>
    ${series.length > 1 ? `<div class="pr-spark">${sparklineSVG(c.better === "lower" ? series.map(x => -x) : series, { W: 160, H: 56 }).replace(/<title>[^<]*<\/title>/g, "")}</div>` : ""}
  </div>
  ${missing.length ? `<div class="gear-note gear-note--warn"><i class="ti ti-alert-triangle"></i> Needs ${missing.map(e => EQUIPMENT_LABEL[e]).join(", ")}. Benchmarks keep the same equipment so results stay comparable.</div>` : ""}
  <button class="btn-primary btn-inline-start" data-act="challenge-start" data-id="${c.id}" data-variant="${v.id}" data-division="${division}"><i class="ti ti-player-play"></i> Start ${esc(c.name)}</button>

  ${sectionLabel("Standard")}
  <ol class="rules">${c.rules.map(r => `<li>${esc(r)}</li>`).join("")}</ol>

  ${leaderboardBlock(c, v.id, division)}

  ${mine.length ? `${sectionLabel("Your attempts")}
  <div class="cl-list">${mine.map(a => `
    <button class="cl-row" data-history="${a.id}">
      <i class="ti ${prIds.has(a.id) ? "ti-trophy" : a.dnf ? "ti-flag" : "ti-check"} cl-ic ${prIds.has(a.id) ? "is-done" : ""}" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${a.dnf ? "Did not finish" : esc(formatScore(c, a.score))}${prIds.has(a.id) ? ` <span class="tag tag--live">PR</span>` : ""}</span>
        <span class="cl-meta">${fmtDay(a.date)} · ${esc(VERIFICATION[a.verification]?.label || "")}</span></span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`).join("")}</div>` : ""}`;
}

/* ── Leaderboards ─────────────────────────────────────────────────────────── */
const boardKey = (id, variant, division, scope, cat = "all", age = "all") => [id, variant, division, scope, cat, age].join("|");

async function loadBoard(c, variant, division, scope, cat = "all", age = "all") {
  ui.boards = ui.boards || {};
  const key = boardKey(c.id, variant, division, scope, cat, age);
  ui.boards[key] = { status: "loading", rows: [] };
  const m = monthlyChallenge();
  const ath = athlete();
  const ag = ageGroup(ath.birthYear);
  const ageRange = { u30: [new Date().getFullYear() - 29, 2100], "30-39": [new Date().getFullYear() - 39, new Date().getFullYear() - 30],
    "40-49": [new Date().getFullYear() - 49, new Date().getFullYear() - 40], "50-59": [new Date().getFullYear() - 59, new Date().getFullYear() - 50],
    "60+": [1900, new Date().getFullYear() - 60] }[ag];
  try {
    const rows = await Sync.leaderboard({
      p_challenge: c.id, p_variant: variant, p_division: division,
      p_since: scope === "month" ? new Date(m.start).toISOString() : null,
      p_until: scope === "month" ? new Date(m.end).toISOString() : null,
      p_category: cat === "mine" && ath.category !== "open" ? ath.category : null,
      p_min_birth: age === "mine" && ageRange ? ageRange[0] : null,
      p_max_birth: age === "mine" && ageRange ? ageRange[1] : null,
      p_limit: 50,
    });
    ui.boards[key] = { status: "ok", rows };
  } catch (e) {
    ui.boards[key] = { status: navigator.onLine ? "error" : "offline", rows: [], error: e.message };
  }
  if (["challenge", "compete", "today"].includes(ui.screen)) rerender();
}

function leaderboardBlock(c, variant, division) {
  const ath = athlete();
  const scope = ui.boardScope || "you";
  const cat = ui.boardCat || "all";
  const age = ui.boardAge || "all";
  const tabs = chips("data-board-scope", [["you", "You"], ["month", "This month"], ["all", "All time"]], scope);

  let body = "";
  if (scope === "you") {
    const mine = attemptsFor(c, variant, division).filter(a => !a.dnf);
    const ranked = rankEntries(c, mine.map(a => ({ ...a, name: fmtDay(a.date) })));
    body = ranked.length ? `<ol class="board">${ranked.slice(0, 10).map(r => `
      <li class="${r.rank === 1 ? "is-me" : ""}"><span class="b-rank">${r.rank}</span><span class="b-name">${esc(r.name)}</span><span class="b-score">${esc(formatScore(c, r.score))}</span></li>`).join("")}</ol>`
      : `<p class="empty">Your attempts will be ranked here, best first.</p>`;
  } else if (!Sync.configured() || !Sync.user) {
    body = `<p class="empty">Sign in under Profile → Account & sync to see how you compare with other athletes.</p>`;
  } else if (!ath.leaderboards) {
    body = `<div class="empty"><p>Join the leaderboards to see and appear in rankings.</p>
      <button class="btn-secondary btn-sm" data-go="athlete-edit"><i class="ti ti-user"></i> Set up athlete profile</button></div>`;
  } else {
    const key = boardKey(c.id, variant, division, scope, cat, age);
    const b = ui.boards?.[key];
    if (!b) { loadBoard(c, variant, division, scope, cat, age); body = `<p class="empty">Loading…</p>`; }
    else if (b.status === "loading") body = `<p class="empty">Loading…</p>`;
    else if (b.status !== "ok") body = `<p class="empty">${b.status === "offline" ? "You're offline." : "Couldn't load the leaderboard."} <button class="text-btn" data-act="board-retry">Try again</button></p>`;
    else if (!b.rows.length) body = `<p class="empty">No results yet. Be the first on the board.</p>`;
    else body = `<ol class="board">${b.rows.map(r => `
      <li class="${r.is_me ? "is-me" : ""}"><span class="b-rank">${r.rank}</span>
        <span class="b-name">${esc(r.display_name)}${r.verification === "verified" ? ` <i class="ti ti-circle-check" title="Verified"></i>` : ""}</span>
        <span class="b-score">${esc(formatScore(c, Number(r.score)))}</span></li>`).join("")}</ol>
      ${b.rows[0] ? `<div class="cl-meta">${b.rows[0].total} athlete${b.rows[0].total === 1 ? "" : "s"} ranked</div>` : ""}`;
  }

  const filters = scope !== "you" && Sync.user && ath.leaderboards ? `
    <div class="board-filters">
      ${chips("data-board-cat", [["all", "Everyone"], ["mine", ath.category === "open" ? "Open" : cap(ath.category)]], cat)}
      ${ath.birthYear ? chips("data-board-age", [["all", "All ages"], ["mine", AGE_LABEL[ageGroup(ath.birthYear)]]], age) : ""}
    </div>` : "";

  return `${sectionLabel("Leaderboard", `<span class="cl-cat-count">${esc(DIVISIONS.find(d => d.id === division).label)}</span>`)}
  <div class="pad-y">${tabs}</div>${filters}${body}`;
}

/* ── Start a challenge ────────────────────────────────────────────────────── */
function startChallenge(id, variantId, division) {
  const c = challengeById(id);
  const div = division || athlete().division;
  const workout = challengeWorkout(c, variantId, div);
  const timeline = compile(workout, {}, { warmup: state.profile.warmup, cooldown: state.profile.cooldown });
  startWorkout(workout.templateId, { workout, timeline, swaps: {} });
}

/* ── Result entry (on the summary screen) ─────────────────────────────────── */
function challengeResultBlock(rec) {
  const meta = rec.challenge;
  const c = challengeById(meta.id);
  const ath = athlete();
  const draft = rec.resultDraft || (rec.resultDraft = { values: {}, division: meta.division, verification: Sync.user && ath.leaderboards ? "community" : "training" });
  const fields = c.inputs ? c.inputs() : [];
  const timeSec = Math.max(0, rec.stats.totalSec - (rec.stats.warmSec || 0));
  const finished = c.scoring !== "time" || c.better === "higher" || !rec.early;
  const a = rec.attempt;
  let banner = "";
  if (a) {
    const pr = prCheck(allAttempts(), { ...a, id: rec.id, date: rec.date });
    const rank = ui.lastRank?.id === rec.id ? ui.lastRank : null;
    banner = `
    <div class="result-card ${pr.pr ? "is-pr" : ""}">
      <div class="result-who">${esc((ath.displayName || "You").toUpperCase())} ${a.dnf ? "STARTED" : "COMPLETED"} ${esc(c.name.toUpperCase())}</div>
      <div class="result-score">${a.dnf ? "DNF" : esc(formatScore(c, a.score))}</div>
      ${a.dnf ? `<div class="result-pr">Not finished · not ranked</div>`
        : pr.first ? `<div class="result-pr">FIRST RESULT · THE MARK TO BEAT</div>`
        : pr.pr ? `<div class="result-pr">NEW PR ${esc(formatDelta(c, pr.delta))}</div>`
        : `<div class="result-sub">PR ${esc(formatScore(c, pr.previous))}</div>`}
      ${rank ? `<div class="result-sub">Monthly rank #${rank.rank} of ${rank.total}</div>` : ""}
    </div>`;
  }
  return `
  ${sectionLabel(a ? "Your result" : "Record your result", `<span class="cl-cat-count">${SCORING[c.scoring].label}</span>`)}
  ${banner}
  ${c.scoring === "time" ? `
    <div class="set-list"><div class="set-row"><i class="ti ti-stopwatch set-ic"></i>
      <span class="set-label">${c.better === "higher" ? "Time lasted" : "Finish time"}<span class="set-unit">${finished ? "Measured by VYRA, warm-up excluded" : "Ended before the finish: recorded as DNF"}</span></span>
      <span class="bench-sum">${fmtShort(timeSec)}</span></div></div>` : `
    <div class="set-list">${fields.map(f => `
      <div class="set-row">
        <label class="set-label" for="res-${f.key}">${esc(f.label)}<span class="set-unit">${esc(f.unit)}</span></label>
        <input class="num-input" id="res-${f.key}" data-result="${f.key}" type="number" inputmode="decimal" min="0" step="${f.unit === "km" ? 0.01 : 1}" value="${esc(draft.values[f.key] ?? "")}" placeholder="0">
      </div>`).join("")}</div>`}
  <div class="pad-y">
    <div class="filter-group"><span class="filter-label">Division</span>${chips("data-res-division", DIVISIONS.map(d => [d.id, d.label]), draft.division)}</div>
    <div class="filter-group"><span class="filter-label">Result</span>${chips("data-res-verify", [["training", "Training"], ["community", "Community"]], draft.verification)}</div>
    <p class="hint">${esc(VERIFICATION[draft.verification].desc)}${draft.verification === "community" && !(Sync.user && ath.leaderboards) ? " Sign in and join the leaderboards in your athlete profile so it appears there." : ""}</p>
  </div>
  <button class="btn-primary" data-act="save-result">${a ? '<i class="ti ti-check"></i> Update result' : '<i class="ti ti-device-floppy"></i> Save result'}</button>`;
}

function saveResult(rec) {
  const c = challengeById(rec.challenge.id);
  const d = rec.resultDraft;
  const timeSec = Math.max(0, rec.stats.totalSec - (rec.stats.warmSec || 0));
  const dnf = c.scoring === "time" && c.better === "lower" && rec.early;
  const score = scoreFromInputs(c, d.values, timeSec);
  if (!dnf && c.scoring !== "time" && !(score > 0)) { toast("Enter your result first"); return false; }
  rec.attempt = {
    challengeId: c.id, variant: rec.challenge.variant, division: d.division, score, better: c.better,
    splits: { ...d.values, timeSec }, verification: d.verification, dnf,
  };
  const pr = prCheck(allAttempts().filter(a => a.id !== rec.id), { ...rec.attempt, id: rec.id, date: rec.date });
  // A first result sets the mark; a PR has to beat something.
  rec.attempt.pr = pr.pr && !pr.first && !dnf;
  rec.attempt.first = pr.first && !dnf;
  if (!state.history.some(h => h.id === rec.id)) { rec.saved = true; state.history.unshift(rec); }
  save();
  toast(rec.attempt.pr ? `New PR ${formatDelta(c, pr.delta)}` : rec.attempt.first ? "First result saved" : "Result saved");
  // Fetch the monthly rank once the result has synced.
  if (Sync.user && athlete().leaderboards && d.verification === "community" && !dnf) {
    setTimeout(async () => {
      await Sync.run();
      const m = monthlyChallenge();
      try {
        const rows = await Sync.leaderboard({ p_challenge: c.id, p_variant: rec.challenge.variant, p_division: d.division,
          p_since: new Date(m.start).toISOString(), p_until: new Date(m.end).toISOString(), p_limit: 1 });
        const me = rows.find(r => r.is_me);
        if (me) { ui.lastRank = { id: rec.id, rank: me.rank, total: me.total }; if (ui.screen === "summary") rerender(); }
      } catch { /* rank is a bonus */ }
    }, 300);
  }
  return true;
}

/* ── Athlete profile ──────────────────────────────────────────────────────── */
function initials(name) { return (name || "V").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase(); }

function personalRecords() {
  const out = [];
  const attempts = allAttempts();
  BENCHMARKS.forEach(c => c.variants.forEach(v => DIVISIONS.forEach(d => {
    const best = bestAttempt(attempts, c, v.id, d.id);
    if (best) out.push({ c, v, d, best });
  })));
  return out.sort((a, b) => b.best.date - a.best.date);
}

function activityLine(h) {
  const ath = athlete();
  const who = (ath.displayName || "You").toUpperCase();
  if (h.attempt) {
    const c = challengeById(h.attempt.challengeId);
    return { title: `${who} ${h.attempt.dnf ? "STARTED" : "COMPLETED"} ${c.name.toUpperCase()}`, score: h.attempt.dnf ? "DNF" : formatScore(c, h.attempt.score),
      pr: h.attempt.pr ? "NEW PR" : h.attempt.first ? "FIRST RESULT" : "" };
  }
  return { title: `${who} TRAINED ${h.name.toUpperCase()}`, score: fmtClock(h.stats.totalSec), pr: "" };
}

function renderAthlete() {
  const ath = athlete();
  const prs = personalRecords();
  const attempts = allAttempts();
  const ag = ageGroup(ath.birthYear);
  return `
  ${topbar("", backButton("profile", "Profile"))}
  <section class="athlete-hero">
    <div class="avatar">${esc(initials(ath.displayName))}</div>
    <div class="athlete-id">
      <h1 class="hero-name">${esc(ath.displayName || "Your athlete profile")}</h1>
      <div class="cl-meta">${ath.handle ? `@${esc(ath.handle)} · ` : ""}${ath.visibility === "public" ? "Public profile" : "Private profile"}</div>
    </div>
  </section>
  <div class="tag-row">
    <span class="tag">${esc(DIVISIONS.find(d => d.id === ath.division).label)}</span>
    ${ath.category !== "open" ? `<span class="tag">${esc(cap(ath.category))}</span>` : ""}
    ${ag ? `<span class="tag">${esc(AGE_LABEL[ag])}</span>` : ""}
    <span class="tag tag--equip">${ath.leaderboards ? "On leaderboards" : "Not on leaderboards"}</span>
  </div>
  <div class="tiles">
    <div class="tile"><span class="stat-label">Workouts</span><b>${state.history.length}</b></div>
    <div class="tile"><span class="stat-label">Benchmarks</span><b>${new Set(attempts.map(a => a.challengeId)).size}<small>/${BENCHMARKS.length}</small></b></div>
    <div class="tile"><span class="stat-label">PRs set</span><b>${attempts.filter(a => a.pr).length}</b></div>
  </div>
  <button class="btn-secondary btn-inline-start" data-go="athlete-edit"><i class="ti ti-adjustments"></i> Edit profile & privacy</button>

  ${sectionLabel("Personal records", `<span class="cl-cat-count">${prs.length}</span>`)}
  ${prs.length ? `<div class="cl-list">${prs.map(p => `
    <button class="cl-row" data-challenge="${p.c.id}" data-variant="${p.v.id}" data-division="${p.d.id}">
      <i class="ti ${p.c.icon} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(p.c.name)}${p.c.variants.length > 1 ? ` · ${esc(p.v.name)}` : ""}</span>
        <span class="cl-meta">${esc(p.d.label)} · ${fmtDate(p.best.date)}</span></span>
      <span class="pr-chip">${esc(formatScore(p.c, p.best.score))}</span>
    </button>`).join("")}</div>`
    : `<p class="empty">Take a benchmark in the Compete tab to set your first record.</p>`}

  ${sectionLabel("Recent activity")}
  ${state.history.length ? `<div class="activity">${state.history.slice(0, 6).map(h => { const a = activityLine(h); return `
    <button class="act" data-history="${h.id}">
      <span class="act-title">${esc(a.title)}</span>
      <span class="act-score">${esc(a.score)}</span>
      ${a.pr ? `<span class="act-pr ${a.pr === "FIRST RESULT" ? "act-pr--first" : ""}">${a.pr}</span>` : ""}
      <span class="cl-meta">${fmtDay(h.date)}</span>
    </button>`; }).join("")}</div>` : `<p class="empty">Your workouts and results will show up here.</p>`}`;
}

function renderAthleteEdit() {
  const d = ui.athleteDraft || (ui.athleteDraft = athlete());
  const signedIn = !!Sync.user;
  return `
  ${topbar("", backButton("athlete", "Athlete profile"))}
  <section class="hero"><div class="hero-daycount">Shown on leaderboards when you join them</div>
    <div class="hero-titlebar"><h1 class="hero-name">Edit profile</h1></div></section>
  <div class="account">
    <label class="field"><span>Display name</span><input class="text-input" id="ath-name" maxlength="40" value="${esc(d.displayName)}" placeholder="Caro"></label>
    <label class="field"><span>Handle</span><input class="text-input" id="ath-handle" maxlength="20" value="${esc(d.handle)}" placeholder="caro_runs" autocapitalize="none"></label>
    <label class="field"><span>Birth year <small>(for age groups, optional)</small></span><input class="text-input" id="ath-birth" inputmode="numeric" maxlength="4" value="${esc(d.birthYear || "")}" placeholder="1990"></label>
  </div>
  ${sectionLabel("Category")}
  <div class="pad-y">${chips("data-ath-category", ATHLETE_CATEGORIES.map(x => [x.id, x.label]), d.category)}</div>
  ${sectionLabel("Division")}
  <div class="pad-y">${chips("data-ath-division", DIVISIONS.map(x => [x.id, x.label]), d.division)}
    <p class="hint">${esc(DIVISIONS.find(x => x.id === d.division).desc)}</p></div>
  ${sectionLabel("Privacy")}
  <div class="pad-y">${chips("data-ath-visibility", [["private", "Private"], ["public", "Public"]], d.visibility)}
    <p class="hint">${d.visibility === "public" ? "Other athletes can see your name, handle and division." : "Only you can see your profile."}</p></div>
  <div class="set-list">
    ${switchRow('data-act="ath-leaderboards"', d.leaderboards, "Show my results on leaderboards", "ti-trophy",
      signedIn ? "Only your display name and best scores are shown" : "Needs an account: Profile → Account & sync")}
  </div>
  ${ui.athleteError ? `<p class="hint hint--warn">${esc(ui.athleteError)}</p>` : ""}
  <button class="btn-primary btn-inline-start" data-act="ath-save"><i class="ti ti-check"></i> Save profile</button>`;
}

/* ── Clicks (called from app.js before its own handler) ───────────────────── */
function handleCompeteClick(d) {
  if (d.challenge) { ui.challengeId = d.challenge; ui.challengeVariant = d.variant || null; ui.challengeDivision = d.division || null; ui.screen = "challenge"; render(); return true; }
  if (d.cvariant) { ui.challengeVariant = d.cvariant; rerender(); return true; }
  if (d.cdivision) { ui.challengeDivision = d.cdivision; rerender(); return true; }
  if (d.benchFilter) { ui.benchFilter = d.benchFilter; rerender(); return true; }
  if (d.boardScope) { ui.boardScope = d.boardScope; rerender(); return true; }
  if (d.boardCat) { ui.boardCat = d.boardCat; rerender(); return true; }
  if (d.boardAge) { ui.boardAge = d.boardAge; rerender(); return true; }
  if (d.resDivision) { ui.summary.resultDraft.division = d.resDivision; rerender(); return true; }
  if (d.resVerify) { ui.summary.resultDraft.verification = d.resVerify; rerender(); return true; }
  if (d.athCategory) { ui.athleteDraft.category = d.athCategory; rerender(); return true; }
  if (d.athDivision) { ui.athleteDraft.division = d.athDivision; rerender(); return true; }
  if (d.athVisibility) { ui.athleteDraft.visibility = d.athVisibility; rerender(); return true; }
  switch (d.act) {
    case "challenge-start": startChallenge(d.id, d.variant, d.division); return true;
    case "save-result": if (saveResult(ui.summary)) rerender(); return true;
    case "board-retry": ui.boards = {}; rerender(); return true;
    case "ath-leaderboards": ui.athleteDraft.leaderboards = !ui.athleteDraft.leaderboards; rerender(); return true;
    case "ath-save": {
      const dr = ui.athleteDraft;
      dr.displayName = (document.getElementById("ath-name")?.value || "").trim();
      dr.handle = (document.getElementById("ath-handle")?.value || "").trim().toLowerCase();
      const by = Number(document.getElementById("ath-birth")?.value) || null;
      dr.birthYear = by;
      const year = new Date().getFullYear();
      ui.athleteError = dr.handle && !/^[a-z0-9_]{3,20}$/.test(dr.handle) ? "Handles use 3–20 lowercase letters, numbers or _."
        : by && (by < year - 100 || by > year - 13) ? "Enter a valid birth year (13 or older)."
        : dr.leaderboards && !dr.displayName ? "Add a display name to appear on leaderboards." : "";
      if (ui.athleteError) { rerender(); return true; }
      state.athlete = { ...dr };
      ui.athleteDraft = null; ui.boards = {};
      save(); toast("Profile saved");
      go("athlete");
      return true;
    }
  }
  return false;
}
