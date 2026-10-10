"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   Iron Forest — Phase 3 screens: special events (Iron Forest, Wild Hunt), ghost racing,
   video verification and the staff review queue. Rules live in challenges.js;
   server rules in supabase/004_events.sql. Loaded before app.js.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── Events list & detail ─────────────────────────────────────────────────── */
async function loadEvents() {
  ui.events = { status: "loading", items: ui.events?.items || [] };
  try { ui.events = { status: "ok", items: await Sync.listEvents() }; }
  catch (e) { ui.events = { status: navigator.onLine ? "error" : "offline", items: [], error: e.message }; }
  if (["compete", "event"].includes(ui.screen)) rerender();
}

const isForest = ev => /forest/i.test(ev.name);
function countdown(ms) {
  if (ms <= 0) return "now";
  const d = Math.floor(ms / DAY_MS), h = Math.floor((ms % DAY_MS) / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function nextMilestone(ev, phase) {
  return { coming: ["Registration opens in", ev.registration_opens], registration: ["Starts in", ev.starts_at],
    open: ["Closes in", ev.ends_at], closed: ["Final results in", ev.final_at], final: ["", null] }[phase];
}

function eventCardFor(ev) {
  const phase = eventPhase(ev);
  const [label, at] = nextMilestone(ev, phase);
  const place = ev.kind === "in_person" ? `In person${ev.location ? ` · ${ev.location}` : ""}` : "Online";
  return `
  <button class="event ${isForest(ev) ? "" : "event--plain"}" data-event="${esc(ev.id)}">
    <div class="event-kicker">${esc(place)}${at ? ` · ${label} ${countdown(Date.parse(at) - Date.now())}` : ""}</div>
    <div class="event-name">${esc(ev.name)}</div>
    <div class="event-line">${esc(eventLine(ev, phase))}</div>
    ${ev.pitch ? `<p class="event-pitch">${esc(ev.pitch)}</p>` : ""}
    ${ev.tests?.length ? `<div class="event-tests">${ev.tests.map(t => `<span>${esc(t)}</span>`).join("<i>•</i>")}</div>` : ""}
    <div class="cl-meta">${ev.my_division ? `<b>Registered · ${esc(cap(ev.my_division))}</b> · ` : ""}${Number(ev.registered || 0)} athlete${Number(ev.registered) === 1 ? "" : "s"}${ev.capacity ? ` of ${ev.capacity} places` : ""}</div>
  </button>`;
}

function renderEvents() {
  if (!Sync.configured() || !Sync.user) {
    return `${eventCard()}<p class="hint"><i class="ti ti-calendar-event"></i> Sign in under Profile → Account & sync to register for events and see standings.</p>`;
  }
  const ev = ui.events;
  if (!ev) loadEvents();
  if (!ev || (ev.status === "loading" && !ev.items.length)) return `<p class="empty">Loading events…</p>`;
  if (ev.status !== "ok") return `${eventCard()}<p class="empty">${ev.status === "offline" ? "You're offline." : "Couldn't load events."} <button class="text-btn" data-act="events-refresh">Try again</button></p>`;
  const live = ev.items.filter(e => eventPhase(e) !== "final");
  const past = ev.items.filter(e => eventPhase(e) === "final");
  return `
  <div class="events">${live.map(eventCardFor).join("") || `<p class="empty">No upcoming events right now.</p>`}</div>
  ${past.length ? `${sectionLabel("Past events")}<div class="events">${past.map(eventCardFor).join("")}</div>` : ""}`;
}

async function loadEventDetail(id) {
  const ev = ui.events?.items.find(e => e.id === id);
  ui.event = { id, status: "loading", ev, trials: [] };
  try {
    const trials = await Sync.eventTrials(id);
    trials.forEach(t => { try { registerChallenge(challengeFromSpec({ ...t.spec, name: t.spec.name || t.name })); } catch (e) { console.warn("Bad trial spec", t.trial_id, e.message); } });
    ui.event = { ...ui.event, status: "ok", trials };
    state.eventCache = { ...(state.eventCache || {}), [id]: trials.map(t => ({ trial_id: t.trial_id, name: t.name, weight: t.weight, spec: t.spec })) };
    save({ silent: true });
  } catch (e) { ui.event = { ...ui.event, status: "error", error: e.message }; }
  if (ui.screen === "event") rerender();
}

async function loadStandings(id, division) {
  const key = `${id}|${division}`;
  ui.standings = { ...(ui.standings || {}), [key]: { status: "loading", rows: [] } };
  try { ui.standings[key] = { status: "ok", rows: await Sync.standings(id, division) }; }
  catch (e) { ui.standings[key] = { status: "error", rows: [], error: e.message }; }
  if (ui.screen === "event") rerender();
}

function renderEvent() {
  const back = backButton("compete", "Events");
  const d = ui.event;
  const ev = d?.ev;
  if (!ev) return `${topbar("", back)}<p class="empty">Event not found.</p>`;
  if (!d.trials.length && d.status === "idle") loadEventDetail(ev.id);
  const phase = eventPhase(ev);
  const [label, at] = nextMilestone(ev, phase);
  const mine = ev.my_division;
  const div = ui.eventDivision || mine || athlete().division;
  const revealed = d.trials.length > 0;
  const fmt = ts => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const canRegister = ["registration", "open"].includes(phase) && !mine;
  const sKey = `${ev.id}|${div}`;
  const st = ui.standings?.[sKey];
  if (revealed && !st && ["open", "closed", "final"].includes(phase)) loadStandings(ev.id, div);
  const myTrialBest = t => {
    const c = challengeById(t.spec.id);
    if (!c) return null;
    return bestAttempt(allAttempts().filter(a => a.eventId === ev.id && a.trialId === t.trial_id), c, "standard", null);
  };

  return `
  ${topbar("", back)}
  <section class="event event--hero ${isForest(ev) ? "" : "event--plain"}">
    <div class="event-kicker">${ev.kind === "in_person" ? `In person${ev.location ? ` · ${esc(ev.location)}` : ""}` : "Online event"}</div>
    <div class="event-name">${esc(ev.name)}</div>
    <div class="event-line">${esc(eventLine(ev, phase))}</div>
    ${at ? `<div class="event-countdown"><span>${label}</span><b>${countdown(Date.parse(at) - Date.now())}</b></div>` : ""}
    ${ev.pitch ? `<p class="event-pitch">${esc(ev.pitch)}</p>` : ""}
  </section>

  <div class="set-list">
    <div class="set-row"><i class="ti ti-user-plus set-ic"></i><span class="set-label">Registration<span class="set-unit">${fmt(ev.registration_opens)} – ${fmt(ev.ends_at)}</span></span></div>
    <div class="set-row"><i class="ti ti-flame set-ic"></i><span class="set-label">Competition window<span class="set-unit">${fmt(ev.starts_at)} – ${fmt(ev.ends_at)}</span></span></div>
    <div class="set-row"><i class="ti ti-trophy set-ic"></i><span class="set-label">Final results<span class="set-unit">${fmt(ev.final_at)} · top ${ev.verify_top} per division verify by video</span></span></div>
    ${ev.capacity ? `<div class="set-row"><i class="ti ti-users set-ic"></i><span class="set-label">Places<span class="set-unit">${ev.registered} of ${ev.capacity} taken</span></span></div>` : ""}
  </div>

  ${mine ? `<div class="gear-note"><i class="ti ti-circle-check"></i> You're registered in ${esc(cap(mine))}.${phase === "registration" ? ` <button class="text-btn" data-act="event-withdraw">${ui.confirm === "withdraw" ? "Tap again to withdraw" : "Withdraw"}</button>` : ""}</div>`
    : canRegister ? `
    ${sectionLabel("Register")}
    <div class="pad-y">${chips("data-event-division", (ev.divisions || ["open", "competitive", "elite"]).map(x => [x, cap(x)]), div)}
      <p class="hint">${esc(DIVISIONS.find(x => x.id === div)?.desc || "")} Scaled standards keep the intent of every Trial.</p></div>
    <button class="btn-primary btn-inline-start" data-act="event-register"><i class="ti ti-user-plus"></i> ${isForest(ev) ? "Enter the Iron Forest" : "Register"}</button>`
    : phase === "coming" ? `<p class="hint">Registration opens ${fmt(ev.registration_opens)}.</p>` : ""}

  ${sectionLabel(isForest(ev) ? "The Trials" : "Trials")}
  ${revealed ? `<div class="cl-list">${d.trials.map(t => {
      const c = challengeById(t.spec.id);
      const best = myTrialBest(t);
      const playable = c && phase === "open" && mine;
      return `
      <div class="lib-row">
        <div class="cl-row"><i class="ti ${c?.icon || "ti-trophy"} cl-ic" aria-hidden="true"></i>
          <span class="cl-main"><span class="cl-name">${esc(t.name)}${Number(t.weight) !== 1 ? ` <span class="tag tag--live">×${t.weight}</span>` : ""}</span>
            <span class="cl-meta">${esc(c?.tagline || "")}${best ? ` · <b>${esc(formatScore(c, best.score))}</b>` : ""}</span></span></div>
        ${playable ? `<button class="row-start" data-act="trial-start" data-trial="${esc(t.trial_id)}" aria-label="Start ${esc(t.name)}"><i class="ti ti-player-play"></i></button>` : ""}
      </div>`; }).join("")}</div>
      ${phase === "open" && !mine ? `<p class="hint">Register to take the Trials.</p>` : ""}
      <p class="hint">Each Trial gives Forest Points: 1st place 100, last 10, scaled by its weight. Your Forest Score is the sum, so no single strength wins on its own.</p>`
    : `<div class="secret"><i class="ti ti-lock"></i><div><b>The Trials stay secret until ${fmt(ev.reveal_at)}.</b>
        <p>${isForest(ev) ? "You'll need to" : "Expect to"} ${(ev.tests || []).map(x => x.toUpperCase()).join(" • ")}. Don't train for one memorized race.</p></div></div>`}

  ${revealed && ["open", "closed", "final"].includes(phase) ? `
  ${sectionLabel(phase === "final" ? "Final results" : "Standings", `<span class="cl-cat-count">${isForest(ev) ? "Forest Score" : "Points"}</span>`)}
  <div class="pad-y">${chips("data-standings-division", (ev.divisions || ["open", "competitive", "elite"]).map(x => [x, cap(x)]), div)}</div>
  ${!st || st.status === "loading" ? `<p class="empty">Loading…</p>` : st.status !== "ok" ? `<p class="empty">Couldn't load standings.</p>`
    : !st.rows.length ? `<p class="empty">No results yet.</p>`
    : `<ol class="board">${st.rows.map(r => `
      <li class="${r.is_me ? "is-me" : ""}" title="${esc((r.trials || []).map(t => `${t.name}: ${t.points} pts (#${t.rank})`).join(" · "))}">
        <span class="b-rank">${r.rank}</span>
        <span class="b-name">${esc(r.display_name)}<span class="b-sub">${(r.trials || []).map(t => `${esc(t.name.replace(/^The /, ""))} ${t.points}${t.verified ? "✓" : ""}`).join(" · ")}</span></span>
        <span class="b-score">${r.forest_score}</span></li>`).join("")}</ol>`}` : ""}`;
}

function startTrial(trialId) {
  const d = ui.event;
  const t = d.trials.find(x => x.trial_id === trialId);
  const c = t && challengeById(t.spec.id);
  if (!c) return toast("This Trial couldn't be loaded");
  const workout = challengeWorkout(c, "standard", d.ev.my_division || athlete().division);
  workout.challenge.eventId = d.ev.id;
  workout.challenge.trialId = t.trial_id;
  workout.name = `${d.ev.name}: ${t.name}`;
  const timeline = compile(workout, outdoorSwaps(state.profile.equipment), { warmup: state.profile.warmup, cooldown: state.profile.cooldown });
  startWorkout(workout.templateId, { workout, timeline, swaps: {} });
}

/* Re-register cached event Trials at startup so past event results still render offline. */
function restoreEventChallenges() {
  Object.values(state.eventCache || {}).flat().forEach(t => { try { registerChallenge(challengeFromSpec({ ...t.spec, name: t.spec.name || t.name })); } catch { /* ignore */ } });
}

/* ── Ghost racing ─────────────────────────────────────────────────────────── */
function ghostOptions(c, variant, division) {
  if (c.scoring !== "time" || c.better !== "lower") return [];
  const opts = [["off", "Off"]];
  const pr = bestAttempt(allAttempts(), c, variant, division);
  if (pr) opts.push(["pr", `Your PR ${formatScore(c, pr.score)}`]);
  const t = ui.target;
  if (t && t.challengeId === c.id && t.variant === variant && t.division === division) opts.push(["friend", `${t.name} ${formatScore(c, t.score)}`]);
  opts.push(["target", "Target time"]);
  return opts;
}

function ghostBlock(c, variant, division) {
  const opts = ghostOptions(c, variant, division);
  if (!opts.length) return "";
  const g = ui.ghost || { mode: "off" };
  const mode = opts.some(o => o[0] === g.mode) ? g.mode : "off";
  return `
  ${sectionLabel("Race a ghost")}
  <div class="pad-y">${chips("data-ghost", opts, mode)}
    ${mode === "target" ? `<div class="field-row ghost-target"><input class="text-input" id="ghost-target" inputmode="numeric" placeholder="mm:ss" value="${esc(g.target || "")}" aria-label="Target time"></div>` : ""}
    <p class="hint">During the workout Iron Forest shows whether you're ahead or behind at every split.</p></div>`;
}

function parseClock(str) {
  const m = String(str || "").trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/) || String(str || "").trim().match(/^(\d+)$/);
  if (!m) return null;
  if (m.length === 2) return Number(m[1]) * 60;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
}

/* Build the ghost for a session (called by startChallenge). */
function buildGhost(c, variant, division, timeline) {
  const g = ui.ghost;
  if (!g || g.mode === "off" || c.scoring !== "time" || c.better !== "lower") return null;
  if (g.mode === "pr") {
    const pr = bestAttempt(allAttempts(), c, variant, division);
    if (!pr) return null;
    const cps = pr.checkpoints && pr.checkpoints.length === scoredSegments(timeline).length ? pr.checkpoints : ghostFromTotal(timeline, pr.score);
    return { name: "PR", cps };
  }
  if (g.mode === "friend" && ui.target) return { name: ui.target.name.split(" ")[0].toUpperCase(), cps: ghostFromTotal(timeline, ui.target.score) };
  if (g.mode === "target") {
    const sec = parseClock(g.target);
    return sec ? { name: "TARGET", cps: ghostFromTotal(timeline, sec) } : null;
  }
  return null;
}

/* Live line in the player: "YOU 14:32 · SAM 14:47 · 15 SEC AHEAD" */
function ghostLine(e, elapsed) {
  const g = session?.ghost;
  if (!g) return "";
  const mine = checkpointsFromVisits(e.timeline, e.visits);
  const st = ghostStatus(g.cps, mine, mine.length, elapsed);
  if (!st) return "";
  return `YOU ${fmtShort(Math.round(elapsed))} · ${g.name} ${fmtShort(Math.max(0, Math.round(elapsed - st.delta)))} · ${ghostText(st.delta)}`;
}

/* ── Verification ─────────────────────────────────────────────────────────── */
const VERIFY_LABEL = { pending: "Video under review", approved: "Verified", rejected: "Not verified" };

function verifyChip(a) {
  if (a.verification === "verified") return `<span class="tag tag--live"><i class="ti ti-circle-check"></i> Verified</span>`;
  if (a.verifyStatus) return `<span class="tag">${VERIFY_LABEL[a.verifyStatus]}</span>`;
  return "";
}

function renderVerify() {
  const h = state.history.find(x => x.id === ui.verifyId);
  const back = backButton("challenge", "Back");
  if (!h?.attempt) return `${topbar("", back)}<p class="empty">Result not found.</p>`;
  const c = challengeById(h.attempt.challengeId);
  const a = h.attempt;
  return `
  ${topbar("", back)}
  <section class="hero"><div class="hero-daycount">${esc(c?.name || "")} · ${esc(formatScore(c, a.score))} · ${fmtDate(h.date)}</div>
    <div class="hero-titlebar"><h1 class="hero-name">Verify with video</h1></div>
    <p class="about">Film the whole attempt in one take with the screen or monitor visible, upload it (YouTube unlisted, Google Drive, Dropbox…) and paste the link. Iron Forest staff review it, usually within a few days. Top results in events and prize challenges need this.</p></section>
  ${a.verifyStatus ? `<div class="gear-note ${a.verifyStatus === "rejected" ? "gear-note--warn" : ""}"><i class="ti ti-video"></i> ${VERIFY_LABEL[a.verifyStatus]}${a.verifyNote ? `: ${esc(a.verifyNote)}` : ""}</div>` : ""}
  <div class="account">
    <label class="field"><span>Video link</span><input class="text-input" id="verify-url" type="url" inputmode="url" placeholder="https://youtu.be/…" value="${esc(ui.verifyDraft?.url || "")}"></label>
    <label class="field"><span>Note for the reviewer <small>(optional)</small></span><input class="text-input" id="verify-note" maxlength="280" placeholder="Rower damper 6, treadmill 1%" value="${esc(ui.verifyDraft?.note || "")}"></label>
  </div>
  <button class="btn-primary btn-inline-start" data-act="verify-submit" ${a.verification === "verified" ? "disabled" : ""}><i class="ti ti-send"></i> ${a.verifyStatus ? "Submit a new link" : "Submit for review"}</button>`;
}

/* Staff review queue */
async function loadQueue() {
  ui.queue = { status: "loading", rows: [] };
  try { ui.queue = { status: "ok", rows: await Sync.reviewQueue() }; } catch (e) { ui.queue = { status: "error", rows: [], error: e.message }; }
  if (ui.screen === "review") rerender();
}

function renderReview() {
  const q = ui.queue;
  if (!q) loadQueue();
  return `
  ${topbar("", backButton("profile", "Profile"))}
  <section class="hero"><div class="hero-daycount">Iron Forest staff</div><div class="hero-titlebar"><h1 class="hero-name">Review queue</h1></div></section>
  ${!q || q.status === "loading" ? `<p class="empty">Loading…</p>` : q.status !== "ok" ? `<p class="empty">Couldn't load the queue.</p>`
    : !q.rows.length ? `<p class="empty">Nothing to review. Nice.</p>`
    : `<div class="feed">${q.rows.map(r => { const c = challengeById(r.challenge_id); return `
      <article class="post">
        <div class="act-title">${esc(r.display_name.toUpperCase())} · ${esc((c?.name || r.challenge_id).toUpperCase())} · ${esc(cap(r.division))}</div>
        <div class="post-score">${esc(c ? formatScore(c, Number(r.score)) : String(r.score))}</div>
        <a class="text-btn" href="${esc(r.video_url)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-video"></i> Open video</a>
        ${r.note ? `<p class="cl-meta">${esc(r.note)}</p>` : ""}
        <footer class="post-actions">
          <button class="follow-btn" data-review="${r.user_id}" data-attempt="${esc(r.attempt_id)}" data-approve="1"><i class="ti ti-check"></i> Verify</button>
          <button class="follow-btn on" data-review="${r.user_id}" data-attempt="${esc(r.attempt_id)}" data-approve="0">Reject</button>
        </footer>
      </article>`; }).join("")}</div>`}`;
}

/* ── Clicks ───────────────────────────────────────────────────────────────── */
async function handleEventsClick(d) {
  if (d.event) {
    const ev = ui.events?.items.find(e => e.id === d.event);
    if (!ev) return true;
    ui.event = { id: ev.id, ev, status: "idle", trials: [] };
    ui.eventDivision = null;
    ui.screen = "event"; render(); return true;
  }
  if (d.eventDivision) { ui.eventDivision = d.eventDivision; rerender(); return true; }
  if (d.standingsDivision) { ui.eventDivision = d.standingsDivision; rerender(); return true; }
  if (d.ghost) { ui.ghost = { ...(ui.ghost || {}), mode: d.ghost }; rerender(); return true; }
  if (d.review) {
    const approve = d.approve === "1";
    try { await Sync.review(d.review, d.attempt, approve, approve ? null : "Not enough of the attempt visible"); toast(approve ? "Verified" : "Rejected"); }
    catch (e) { toast(`Couldn't review: ${e.message}`); }
    loadQueue();
    return true;
  }
  switch (d.act) {
    case "events-refresh": ui.events = null; rerender(); return true;
    case "event-register": {
      const ev = ui.event.ev;
      const div = ui.eventDivision || athlete().division;
      try { await Sync.register(ev.id, div); ev.my_division = div; ev.registered = Number(ev.registered || 0) + 1; toast(isForest(ev) ? "You've entered the Iron Forest" : "Registered"); }
      catch (e) { toast(`Couldn't register: ${e.message}`); }
      rerender(); return true;
    }
    case "event-withdraw": {
      if (ui.confirm !== "withdraw") { ui.confirm = "withdraw"; rerender(); return true; }
      ui.confirm = null;
      const ev = ui.event.ev;
      try { await Sync.withdraw(ev.id); ev.my_division = null; ev.registered = Math.max(0, Number(ev.registered || 1) - 1); toast("Withdrawn"); }
      catch (e) { toast(`Couldn't withdraw: ${e.message}`); }
      rerender(); return true;
    }
    case "trial-start": startTrial(d.trial); return true;
    case "verify-open": ui.verifyId = d.id; ui.verifyDraft = null; ui.screen = "verify"; render(); return true;
    case "verify-submit": {
      const url = (document.getElementById("verify-url")?.value || "").trim();
      const note = (document.getElementById("verify-note")?.value || "").trim();
      ui.verifyDraft = { url, note };
      if (!/^https:\/\/\S{8,}$/.test(url)) { toast("Paste an https:// link to your video"); return true; }
      const h = state.history.find(x => x.id === ui.verifyId);
      try {
        await Sync.run();                                    // make sure the result itself is uploaded first
        await Sync.requestVerification(h.id, url, note);
        h.attempt = { ...h.attempt, verifyStatus: "pending", verifyNote: "" };
        save(); toast("Sent for review");
        go("challenge");
      } catch (e) { toast(`Couldn't submit: ${e.message}`); }
      return true;
    }
  }
  return false;
}
