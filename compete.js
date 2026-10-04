"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Compete: benchmarks, results, PRs, leaderboards, athlete profile.
   Screens only; the rules live in challenges.js. Uses app.js globals at call
   time (state, ui, save, render…), so it is loaded before app.js.
   ════════════════════════════════════════════════════════════════════════════ */

const DEFAULT_ATHLETE = { displayName: "", handle: "", birthYear: null, category: "open", division: "open", visibility: "private", leaderboards: false, activity: "off" };
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
  const view = ui.competeView || "challenges";
  const header = `
  ${topbar()}
  <section class="hero">
    <div class="hero-daycount">Train alone. Compete together.</div>
    <div class="hero-titlebar"><h1 class="hero-name">Compete</h1></div>
  </section>
  <div class="segmented" role="tablist">
    <button role="tab" class="${view === "challenges" ? "on" : ""}" data-compete-view="challenges" aria-selected="${view === "challenges"}"><i class="ti ti-trophy"></i> Challenges</button>
    <button role="tab" class="${view === "events" ? "on" : ""}" data-compete-view="events" aria-selected="${view === "events"}"><i class="ti ti-flame"></i> Events</button>
    <button role="tab" class="${view === "community" ? "on" : ""}" data-compete-view="community" aria-selected="${view === "community"}"><i class="ti ti-users"></i> Community</button>
    <button role="tab" class="${view === "clubs" ? "on" : ""}" data-compete-view="clubs" aria-selected="${view === "clubs"}"><i class="ti ti-building"></i> Clubs</button>
  </div>`;
  if (view === "community") return header + renderCommunity();
  if (view === "events") return header + renderEvents();
  if (view === "clubs") return header + renderClubs();
  return `
  ${header}
  ${monthlyCard(true)}
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
  ${targetBanner(c, v.id, division)}
  <button class="btn-primary btn-inline-start" data-act="challenge-start" data-id="${c.id}" data-variant="${v.id}" data-division="${division}"><i class="ti ti-player-play"></i> Start ${esc(c.name)}</button>

  ${ghostBlock(c, v.id, division)}

  ${sectionLabel("Standard")}
  <ol class="rules">${c.rules.map(r => `<li>${esc(r)}</li>`).join("")}</ol>

  ${leaderboardBlock(c, v.id, division)}

  ${mine.length ? `${sectionLabel("Your attempts")}
  <div class="cl-list">${mine.map(a => `
    <button class="cl-row" data-history="${a.id}">
      <i class="ti ${prIds.has(a.id) ? "ti-trophy" : a.dnf ? "ti-flag" : "ti-check"} cl-ic ${prIds.has(a.id) ? "is-done" : ""}" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${a.dnf ? "Did not finish" : esc(formatScore(c, a.score))}${prIds.has(a.id) ? ` <span class="tag tag--live">PR</span>` : ""}</span>
        <span class="cl-meta">${fmtDay(a.date)} · ${esc(VERIFICATION[a.verification]?.label || "")} ${verifyChip(a)}</span></span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`).join("")}</div>` : ""}`;
}

/* ── Leaderboards ─────────────────────────────────────────────────────────── */
const boardKey = (id, variant, division, scope, cat = "all", age = "all") => [id, variant, division, scope, cat, age, ui.boardWhere || "all"].join("|");

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
      ...(ui.boardWhere === "country" && ath.country ? { p_country: ath.country } : {}),
      ...(ui.boardWhere === "city" && ath.city ? { p_city: ath.city, p_country: ath.country || null } : {}),
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
      ${ath.country ? chips("data-board-where", [["all", "Everywhere"], ["country", ath.country], ...(ath.city ? [["city", ath.city]] : [])], ui.boardWhere || "all") : ""}
    </div>` : "";

  return `${sectionLabel("Leaderboard", `<span class="cl-cat-count">${esc(DIVISIONS.find(d => d.id === division).label)}</span>`)}
  <div class="pad-y">${tabs}</div>${filters}${body}`;
}

/* ── Start a challenge ────────────────────────────────────────────────────── */
function startChallenge(id, variantId, division) {
  const c = challengeById(id);
  const div = division || athlete().division;
  const workout = challengeWorkout(c, variantId, div);
  const t = ui.target;
  if (t && t.challengeId === c.id && t.variant === workout.challenge.variant && t.division === div) workout.challenge.target = { name: t.name, score: t.score };
  const timeline = compile(workout, {}, { warmup: state.profile.warmup, cooldown: state.profile.cooldown });
  startWorkout(workout.templateId, { workout, timeline, swaps: {}, ghost: buildGhost(c, workout.challenge.variant, div, timeline) });
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
      ${a.target && !a.dnf ? `<div class="result-vs ${targetVerdict(c, a).startsWith("You beat") ? "won" : ""}"><i class="ti ti-swords"></i> ${esc(targetVerdict(c, a))}</div>` : ""}
    </div>`;
  }
  return `
  ${sectionLabel(a ? "Your result" : "Record your result", `<span class="cl-cat-count">${SCORING[c.scoring].label}</span>`)}
  ${!a && meta.target ? `<div class="target"><i class="ti ti-swords"></i><div><span class="stat-label">Result to beat</span><b>${esc(meta.target.name)} · ${esc(formatScore(c, meta.target.score))}</b></div></div>` : ""}
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
  ${a && !a.dnf && a.verification !== "training" && Sync.user ? `<div class="verify-row">${verifyChip(a)}${a.verification !== "verified" ? `<button class="text-btn" data-act="verify-open" data-id="${rec.id}"><i class="ti ti-video"></i> ${a.verifyStatus ? "Verification" : "Verify with video"}</button>` : ""}</div>` : ""}
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
    ...(rec.challenge.target ? { target: rec.challenge.target } : {}),
    ...(rec.checkpoints?.length ? { checkpoints: rec.checkpoints } : {}),
    ...(rec.challenge.eventId ? { eventId: rec.challenge.eventId, trialId: rec.challenge.trialId } : {}),
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

  ${(() => { const months = monthlyMedals(); return months.length ? `${sectionLabel("Monthly challenges", `<span class="cl-cat-count">${months.length}</span>`)}
  <div class="medals">${months.map(m => `<div class="medal" title="${esc(m.challenge)}"><i class="ti ti-medal-2"></i><b>${esc(m.label)}</b><span>${esc(m.challenge)}</span></div>`).join("")}</div>` : ""; })()}

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
    <label class="field"><span>City <small>(optional, for local leaderboards)</small></span><input class="text-input" id="ath-city" maxlength="60" value="${esc(d.city || "")}" placeholder="Berlin"></label>
    <label class="field"><span>Country code <small>(optional, e.g. DE, US)</small></span><input class="text-input" id="ath-country" maxlength="2" value="${esc(d.country || "")}" placeholder="DE" autocapitalize="characters"></label>
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
  ${sectionLabel("Share activity")}
  <div class="pad-y">${chips("data-ath-activity", [["off", "Off"], ["followers", "Followers"], ["public", "Everyone"]], d.activity || "off")}
    <p class="hint">${{ off: "Your workouts stay private.", followers: "Athletes who follow you see your workouts and results in their feed.", public: "Anyone who opens your profile sees your recent workouts and results." }[d.activity || "off"]}
    ${(d.activity || "off") !== "off" && d.visibility !== "public" ? " Needs a public profile so people can follow you." : ""} Results saved as Training never show a score.</p></div>
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
  if (d.boardWhere) { ui.boardWhere = d.boardWhere; rerender(); return true; }
  if (d.resDivision) { ui.summary.resultDraft.division = d.resDivision; rerender(); return true; }
  if (d.resVerify) { ui.summary.resultDraft.verification = d.resVerify; rerender(); return true; }
  if (d.athCategory) { ui.athleteDraft.category = d.athCategory; rerender(); return true; }
  if (d.athDivision) { ui.athleteDraft.division = d.athDivision; rerender(); return true; }
  if (d.athVisibility) { ui.athleteDraft.visibility = d.athVisibility; rerender(); return true; }
  if (d.athActivity) { ui.athleteDraft.activity = d.athActivity; rerender(); return true; }
  if (d.competeView) { ui.competeView = d.competeView; rerender(); return true; }
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
      dr.city = (document.getElementById("ath-city")?.value || "").trim();
      dr.country = (document.getElementById("ath-country")?.value || "").trim().toUpperCase();
      const year = new Date().getFullYear();
      ui.athleteError = dr.handle && !/^[a-z0-9_]{3,20}$/.test(dr.handle) ? "Handles use 3–20 lowercase letters, numbers or _."
        : by && (by < year - 100 || by > year - 13) ? "Enter a valid birth year (13 or older)."
        : dr.country && !/^[A-Z]{2}$/.test(dr.country) ? "Country code is two letters, like DE or US."
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

/* ════════════════════════════════════════════════════════════════════════════
   Phase 2 — Community: feed, reactions, comments, following, challenge a friend
   ════════════════════════════════════════════════════════════════════════════ */
const REACTIONS = [{ id: "respect", icon: "ti-hand-stop", label: "Respect" }, { id: "fire", icon: "ti-flame", label: "Fire" }, { id: "strong", icon: "ti-barbell", label: "Strong" }];

function timeAgo(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  return fmtDay(ts);
}

function feedTitle(it) {
  const who = (it.is_me ? (athlete().displayName || "You") : it.display_name || "Athlete").toUpperCase();
  return `${who} ${it.kind === "result" ? (it.dnf ? "STARTED" : "COMPLETED") : "TRAINED"} ${String(it.title).toUpperCase()}`;
}
function feedScore(it) {
  const c = it.challenge_id && challengeById(it.challenge_id);
  if (c && it.score != null && !it.dnf) return formatScore(c, Number(it.score));
  if (it.dnf) return "DNF";
  return it.duration_sec ? fmtClock(it.duration_sec) : "";
}

async function loadFeed(more = false) {
  const f = ui.feed || (ui.feed = { status: "idle", items: [] });
  f.status = "loading";
  try {
    const before = more && f.items.length ? f.items[f.items.length - 1].performed_at : null;
    const rows = await Sync.feed(before);
    f.items = more ? [...f.items, ...rows] : rows;
    f.done = rows.length < 30;
    f.status = "ok";
  } catch (e) { f.status = navigator.onLine ? "error" : "offline"; f.error = e.message; }
  if (["compete", "activity"].includes(ui.screen)) rerender();
}

function activityCard(it, { detail = false } = {}) {
  const c = it.challenge_id && challengeById(it.challenge_id);
  const canChallenge = c && !it.is_me && it.kind === "result" && !it.dnf && it.score != null;
  return `
  <article class="post">
    <header class="post-head">
      <button class="post-who" ${it.is_me ? 'data-go="athlete"' : `data-athlete="${it.owner}"`}>
        <span class="avatar avatar--xs">${esc(initials(it.is_me ? athlete().displayName : it.display_name))}</span>
        <span>${esc(it.is_me ? "You" : it.display_name)}</span></button>
      <span class="cl-meta">${esc(timeAgo(Date.parse(it.performed_at)))}</span>
    </header>
    <div class="act-title">${esc(feedTitle(it))}</div>
    <div class="post-score">${esc(feedScore(it))}${it.pr ? ` <span class="act-pr">NEW PR</span>` : it.first ? ` <span class="act-pr act-pr--first">FIRST RESULT</span>` : ""}</div>
    <footer class="post-actions">
      ${REACTIONS.map(r => {
        const on = (it.my_reactions || []).includes(r.id);
        const n = Number(it[r.id] || 0);
        return `<button class="react ${on ? "on" : ""}" data-react="${r.id}" data-owner="${it.owner}" data-id="${esc(it.id)}" aria-pressed="${on}" aria-label="${r.label}"><i class="ti ${r.icon}"></i>${n ? `<span>${n}</span>` : ""}</button>`;
      }).join("")}
      ${detail ? "" : `<button class="react" data-comments="${esc(it.id)}" data-owner="${it.owner}" aria-label="Comments"><i class="ti ti-message-circle"></i>${Number(it.comment_count) ? `<span>${it.comment_count}</span>` : ""}</button>`}
      ${canChallenge ? `<button class="challenge-btn" data-act="challenge-result" data-id="${c.id}" data-variant="${esc(it.variant)}" data-division="${esc(it.division)}" data-score="${it.score}" data-name="${esc(it.display_name)}"><i class="ti ti-swords"></i> Challenge this result</button>` : ""}
    </footer>
  </article>`;
}

function renderCommunity() {
  if (!Sync.configured() || !Sync.user) {
    return `<div class="empty-card"><i class="ti ti-users big-ic"></i><p>Follow friends, react to their results and challenge them to beat yours. Sign in under Profile → Account & sync to join the community.</p>
      <button class="btn-primary" data-go="profile"><i class="ti ti-user"></i> Go to Profile</button></div>`;
  }
  const ath = athlete();
  const f = ui.feed;
  if (!f) loadFeed();
  const s = ui.search || { q: "", rows: [] };
  const setupNote = ath.visibility !== "public" || ath.activity === "off" || !ath.activity ? `
    <button class="gear-note" data-go="athlete-edit"><i class="ti ti-user-share"></i>
      ${ath.visibility !== "public" ? "Your profile is private, so friends can't find or follow you." : "You're not sharing your activity yet."} Change it in your athlete profile.</button>` : "";
  return `
  ${setupNote}
  <div class="search">
    <i class="ti ti-search"></i>
    <input class="text-input" id="athlete-search" placeholder="Find athletes by name or @handle" value="${esc(s.q)}" autocomplete="off" autocapitalize="none" aria-label="Find athletes">
  </div>
  ${s.q.length >= 2 ? `<div class="cl-list">${s.status === "loading" ? `<p class="empty">Searching…</p>` : s.rows.length ? s.rows.map(a => `
    <div class="lib-row">
      <button class="cl-row" data-athlete="${a.user_id}"><span class="avatar avatar--sm">${esc(initials(a.display_name))}</span>
        <span class="cl-main"><span class="cl-name">${esc(a.display_name)}</span><span class="cl-meta">${a.handle ? `@${esc(a.handle)} · ` : ""}${esc(cap(a.division))}</span></span></button>
      <button class="follow-btn ${a.i_follow ? "on" : ""}" data-follow="${a.user_id}" data-on="${a.i_follow ? 1 : 0}">${a.i_follow ? "Following" : "Follow"}</button>
    </div>`).join("") : `<p class="empty">No public athletes match "${esc(s.q)}".</p>`}</div>` : ""}

  ${sectionLabel("Following", `<button class="text-btn" data-act="feed-refresh"><i class="ti ti-refresh"></i> Refresh</button>`)}
  ${!f || f.status === "loading" && !f.items.length ? `<p class="empty">Loading…</p>`
    : f.status === "error" || f.status === "offline" ? `<p class="empty">${f.status === "offline" ? "You're offline." : "Couldn't load the feed."} <button class="text-btn" data-act="feed-refresh">Try again</button></p>`
    : !f.items.length ? `<div class="empty-card"><p>Your feed is empty. Find athletes above and follow them to see their workouts and results here.</p></div>`
    : `<div class="feed">${f.items.map(it => activityCard(it)).join("")}</div>
       ${f.done ? "" : `<button class="text-btn text-btn--center" data-act="feed-more">Load more</button>`}`}`;
}

/* Activity detail with comments */
async function loadComments() {
  const a = ui.activity;
  a.comments = { status: "loading", rows: [] };
  try { a.comments = { status: "ok", rows: await Sync.comments(a.item.owner, a.item.id) }; }
  catch (e) { a.comments = { status: "error", rows: [], error: e.message }; }
  if (ui.screen === "activity") rerender();
}

function renderActivity() {
  const a = ui.activity;
  if (!a) return renderCompete();
  if (!a.comments) loadComments();
  const rows = a.comments?.rows || [];
  return `
  ${topbar("", backButton("compete", "Community"))}
  ${activityCard(a.item, { detail: true })}
  ${sectionLabel("Comments", `<span class="cl-cat-count">${rows.length}</span>`)}
  ${a.comments?.status === "loading" ? `<p class="empty">Loading…</p>` : rows.length ? `<div class="comments">${rows.map(cm => `
    <div class="comment">
      <span class="avatar avatar--xs">${esc(initials(cm.display_name))}</span>
      <div class="comment-body"><b>${esc(cm.is_me ? "You" : cm.display_name)}</b> <span class="cl-meta">${esc(timeAgo(Date.parse(cm.created_at)))}</span>
        <p>${esc(cm.body)}</p></div>
      ${cm.can_delete ? `<button class="icon-btn icon-btn--sm" data-del-comment="${cm.id}" aria-label="Delete comment"><i class="ti ti-trash"></i></button>` : ""}
    </div>`).join("")}</div>` : `<p class="empty">No comments yet. Say something encouraging.</p>`}
  <div class="field-row comment-box">
    <input class="text-input" id="comment-input" maxlength="280" placeholder="Add a comment" value="${esc(a.draft || "")}" aria-label="Comment">
    <button class="btn-primary btn-sm" data-act="comment-post" ${a.posting ? "disabled" : ""}>Post</button>
  </div>`;
}

/* Another athlete's profile */
async function loadProfile(userId) {
  ui.viewProfile = { userId, status: "loading" };
  try { ui.viewProfile = { userId, status: "ok", data: await Sync.profile(userId) }; }
  catch (e) { ui.viewProfile = { userId, status: "error", error: e.message }; }
  if (ui.screen === "athlete-view") rerender();
}

function renderAthleteView() {
  const v = ui.viewProfile;
  const back = backButton("compete", "Community");
  if (!v || v.status === "loading") return `${topbar("", back)}<p class="empty">Loading…</p>`;
  if (v.status === "error" || !v.data) return `${topbar("", back)}<p class="empty">${v.status === "error" ? "Couldn't load this profile." : "This profile is private."}</p>`;
  const p = v.data;
  const records = (p.records || []).map(r => ({ ...r, c: challengeById(r.challenge_id) })).filter(r => r.c);
  return `
  ${topbar("", back)}
  <section class="athlete-hero">
    <div class="avatar">${esc(initials(p.display_name))}</div>
    <div class="athlete-id"><h1 class="hero-name">${esc(p.display_name)}</h1>
      <div class="cl-meta">${p.handle ? `@${esc(p.handle)} · ` : ""}${esc(cap(p.division))}</div></div>
  </section>
  <div class="tiles">
    <div class="tile"><span class="stat-label">Followers</span><b>${p.followers}</b></div>
    <div class="tile"><span class="stat-label">Following</span><b>${p.following}</b></div>
    <div class="tile"><span class="stat-label">Records</span><b>${records.length}</b></div>
  </div>
  ${p.is_me ? "" : `<button class="${p.i_follow ? "btn-secondary" : "btn-primary"} btn-inline-start" data-follow="${p.user_id}" data-on="${p.i_follow ? 1 : 0}">
    <i class="ti ${p.i_follow ? "ti-user-check" : "ti-user-plus"}"></i> ${p.i_follow ? "Following" : "Follow"}</button>`}

  ${sectionLabel("Records")}
  ${records.length ? `<div class="cl-list">${records.map(r => `
    <div class="lib-row">
      <div class="cl-row"><i class="ti ${r.c.icon} cl-ic" aria-hidden="true"></i>
        <span class="cl-main"><span class="cl-name">${esc(r.c.name)}${r.c.variants.length > 1 ? ` · ${esc(variantOf(r.c, r.variant).name)}` : ""}</span>
          <span class="cl-meta">${esc(cap(r.division))} · ${esc(formatScore(r.c, Number(r.score)))}</span></span></div>
      ${p.is_me ? "" : `<button class="follow-btn" data-act="challenge-result" data-id="${r.c.id}" data-variant="${esc(r.variant)}" data-division="${esc(r.division)}" data-score="${r.score}" data-name="${esc(p.display_name)}"><i class="ti ti-swords"></i> Beat it</button>`}
    </div>`).join("")}</div>` : `<p class="empty">No public benchmark results yet.</p>`}

  ${sectionLabel("Recent activity")}
  ${p.activity === null ? `<p class="empty">${p.i_follow ? "This athlete doesn't share activity." : "Follow to see this athlete's activity."}</p>`
    : (p.activity || []).length ? `<div class="activity">${p.activity.map(it => { const x = { ...it, display_name: p.display_name, is_me: p.is_me };
      return `<div class="act"><span class="act-title">${esc(feedTitle(x))}</span><span class="act-score">${esc(feedScore(x))}</span>
        ${it.pr ? `<span class="act-pr">NEW PR</span>` : ""}<span class="cl-meta">${esc(timeAgo(Date.parse(it.performed_at)))}</span></div>`; }).join("")}</div>`
    : `<p class="empty">No activity yet.</p>`}`;
}

/* Target banner when challenging someone's result */
function targetBanner(c, variant, division) {
  const t = ui.target;
  if (!t || t.challengeId !== c.id || t.variant !== variant || t.division !== division) return "";
  return `<div class="target"><i class="ti ti-swords"></i><div><span class="stat-label">Result to beat</span>
    <b>${esc(t.name)} · ${esc(formatScore(c, t.score))}</b></div><button class="icon-btn icon-btn--sm" data-act="target-clear" aria-label="Remove target"><i class="ti ti-x"></i></button></div>`;
}

function targetVerdict(c, attempt) {
  const t = attempt.target;
  if (!t || attempt.dnf) return "";
  const diff = attempt.score - t.score;
  if (diff === 0) return `Dead level with ${t.name}`;
  const won = c.better === "lower" ? diff < 0 : diff > 0;
  const gap = c.scoring === "time" ? formatScore(c, Math.abs(diff)) : formatDelta(c, Math.abs(diff)).replace(/^[+−]/, "");
  return won ? `You beat ${t.name} by ${gap}` : `${t.name} still leads by ${gap}`;
}

async function searchAthletes(q) {
  ui.search = { q, rows: ui.search?.rows || [], status: "loading" };
  clearTimeout(searchAthletes.t);
  if (q.length < 2) { ui.search = { q, rows: [] }; return; }
  searchAthletes.t = setTimeout(async () => {
    try { const rows = await Sync.search(q); if (ui.search.q === q) ui.search = { q, rows, status: "ok" }; }
    catch { ui.search = { q, rows: [], status: "error" }; }
    if (ui.screen === "compete") { const el = document.activeElement; const pos = el?.selectionStart; rerender(); const inp = document.getElementById("athlete-search"); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); } }
  }, 300);
}

async function handleCommunityClick(d) {
  if (d.athlete) { ui.screen = "athlete-view"; loadProfile(d.athlete); render(); return true; }
  if (d.comments) {
    const item = ui.feed?.items.find(x => x.id === d.comments && x.owner === d.owner);
    if (item) { ui.activity = { item }; ui.screen = "activity"; render(); }
    return true;
  }
  if (d.react) {
    const item = (ui.activity?.item?.id === d.id && ui.activity.item.owner === d.owner) ? ui.activity.item : ui.feed?.items.find(x => x.id === d.id && x.owner === d.owner);
    if (!item) return true;
    const mine = new Set(item.my_reactions || []);
    const on = !mine.has(d.react);
    on ? mine.add(d.react) : mine.delete(d.react);
    item.my_reactions = [...mine];
    item[d.react] = Number(item[d.react] || 0) + (on ? 1 : -1);
    rerender();
    try { await Sync.react(d.owner, d.id, d.react, on); }
    catch (e) { toast(`Couldn't react: ${e.message}`); on ? mine.delete(d.react) : mine.add(d.react); item.my_reactions = [...mine]; item[d.react] += on ? -1 : 1; rerender(); }
    return true;
  }
  if (d.follow) {
    const on = d.on !== "1";
    try { on ? await Sync.follow(d.follow) : await Sync.unfollow(d.follow); toast(on ? "Following" : "Unfollowed"); }
    catch (e) { toast(`Couldn't ${on ? "follow" : "unfollow"}: ${e.message}`); return true; }
    if (ui.search?.rows) ui.search.rows = ui.search.rows.map(a => (a.user_id === d.follow ? { ...a, i_follow: on } : a));
    if (ui.viewProfile?.data?.user_id === d.follow) { ui.viewProfile.data.i_follow = on; ui.viewProfile.data.followers += on ? 1 : -1; }
    ui.feed = null;
    rerender();
    return true;
  }
  if (d.delComment) {
    try { await Sync.deleteComment(d.delComment); await loadComments(); } catch (e) { toast(`Couldn't delete: ${e.message}`); }
    return true;
  }
  switch (d.act) {
    case "feed-refresh": ui.feed = null; rerender(); return true;
    case "feed-more": loadFeed(true); return true;
    case "comment-post": {
      const a = ui.activity;
      const body = (document.getElementById("comment-input")?.value || "").trim();
      if (!body) return true;
      a.posting = true; rerender();
      try { await Sync.addComment(a.item.owner, a.item.id, body); a.draft = ""; a.item.comment_count = Number(a.item.comment_count || 0) + 1; await loadComments(); }
      catch (e) { toast(`Couldn't post: ${e.message}`); }
      a.posting = false; rerender();
      return true;
    }
    case "challenge-result":
      ui.target = { challengeId: d.id, variant: d.variant, division: d.division, score: Number(d.score), name: d.name };
      ui.challengeId = d.id; ui.challengeVariant = d.variant; ui.challengeDivision = d.division; ui.competeView = "challenges";
      ui.screen = "challenge"; render(); return true;
    case "target-clear": ui.target = null; rerender(); return true;
  }
  return false;
}

/* Months in which the athlete completed that month's featured challenge. */
function monthlyMedals() {
  const seen = new Map();
  allAttempts().filter(a => !a.dnf).forEach(a => {
    const m = monthlyChallenge(new Date(a.date));
    if (a.challengeId === m.challengeId && a.variant === m.variant && !seen.has(m.key)) {
      seen.set(m.key, { key: m.key, label: new Date(m.start).toLocaleDateString(undefined, { month: "short", year: "2-digit" }), challenge: challengeById(a.challengeId).name, start: m.start });
    }
  });
  return [...seen.values()].sort((a, b) => b.start - a.start);
}
