"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Monthly challenge winners and reminders. A new challenge starts on
   the 1st of every month (MONTHLY_ROTATION in challenges.js); results are
   frozen by supabase/006_monthly.sql a day after the month ends.
   Loaded before app.js.
   ════════════════════════════════════════════════════════════════════════════ */

const MONTHLY_REMINDER_TIMES = ["08:00", "12:00", "18:00", "20:00"];
const MEDAL = { 1: "ti-crown", 2: "ti-medal", 3: "ti-medal-2" };

async function loadHall() {
  ui.hall = { status: "loading", rows: ui.hall?.rows || [] };
  try { ui.hall = { status: "ok", rows: await Sync.monthlyHall(12) || [] }; }
  catch (e) { ui.hall = { status: navigator.onLine ? "error" : "offline", rows: [], error: e.message }; }
  if (ui.screen === "hall") rerender();
}

/* Rows → [{ month, challenge, divisions: { open: { participants, podium, me } } }], newest first. */
function hallMonths(rows) {
  const byMonth = new Map();
  rows.forEach(r => {
    const key = String(r.month).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { key, month: Date.parse(`${key}-01T00:00:00Z`), challengeId: r.challenge_id, variant: r.variant, divisions: {} });
    const m = byMonth.get(key);
    const d = m.divisions[r.division] || (m.divisions[r.division] = { participants: Number(r.participants) || 0, podium: [], me: null });
    if (r.rank == null) return;
    const row = { rank: r.rank, name: r.display_name, handle: r.handle, score: Number(r.score), verified: r.verification === "verified", me: r.is_me };
    if (r.rank <= 3) d.podium.push(row);
    if (r.is_me) d.me = row;
  });
  return [...byMonth.values()].sort((a, b) => b.month - a.month);
}

function renderHall() {
  const back = backButton("compete", "Compete");
  const m = monthlyStatus();
  const c = challengeById(m.challengeId);
  const div = ui.hallDivision || athlete().division;
  if (Sync.configured() && !ui.hall) loadHall();
  const h = ui.hall;
  const months = h?.rows ? hallMonths(h.rows) : [];
  const monthLabel = ts => new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  const past = !Sync.configured() ? `<p class="empty">Winners appear here once cloud sync is set up.</p>`
    : !h || (h.status === "loading" && !months.length) ? `<p class="empty">Loading…</p>`
    : h.status !== "ok" ? `<p class="empty">${h.status === "offline" ? "You're offline." : "Couldn't load the winners."} <button class="text-btn" data-act="hall-refresh">Try again</button></p>`
    : !months.length ? `<p class="empty">No finished months yet. Results appear the day after each month ends.</p>`
    : months.map(mo => {
      const ch = challengeById(mo.challengeId);
      const d = mo.divisions[div] || { participants: 0, podium: [], me: null };
      return `
      <section class="hall-month">
        <div class="hall-head"><div><div class="cl-name">${esc(monthLabel(mo.month))}</div>
          <div class="cl-meta">${esc(ch?.name || mo.challengeId)} · ${d.participants} athlete${d.participants === 1 ? "" : "s"}</div></div></div>
        ${d.podium.length ? `<ol class="board podium">${d.podium.map(p => `
          <li class="${p.me ? "is-me" : ""}"><span class="b-rank"><i class="ti ${MEDAL[p.rank] || "ti-medal"}"></i></span>
            <span class="b-name">${esc(p.name)}${p.verified ? ` <i class="ti ti-circle-check" title="Verified"></i>` : ""}</span>
            <span class="b-score">${ch ? esc(formatScore(ch, p.score)) : p.score}</span></li>`).join("")}</ol>`
          : `<p class="hint">Nobody in ${esc(cap(div))} this month.</p>`}
        ${d.me && d.me.rank > 3 ? `<div class="cl-meta hall-me">You finished <b>#${d.me.rank}</b> of ${d.participants} · ${ch ? esc(formatScore(ch, d.me.score)) : d.me.score}</div>` : ""}
      </section>`;
    }).join("");

  return `
  ${topbar("", back)}
  <section class="hero">
    <div class="hero-daycount">A new challenge every month</div>
    <div class="hero-titlebar"><i class="ti ti-crown hero-ic" aria-hidden="true"></i><h1 class="hero-name">Monthly winners</h1></div>
  </section>
  <div class="pick monthly ${m.final ? "monthly--final" : ""}">
    <div class="pick-eyebrow"><i class="ti ti-live-photo"></i> Now · ${esc(m.monthName)} · ${m.daysLeft} day${m.daysLeft === 1 ? "" : "s"} left</div>
    <button class="pick-main" data-challenge="${c.id}" data-variant="${m.variant}">
      <span class="pick-name">${esc(c.name)}</span><span class="pick-meta">${esc(c.tagline)} · see the live leaderboard</span></button>
    <div class="monthly-next"><i class="ti ti-arrow-right"></i> Next on the 1st: <b>${esc(challengeById(m.next.challengeId).name)}</b></div>
  </div>
  ${sectionLabel("Past months")}
  <div class="pad-y">${chips("data-hall-division", DIVISIONS.map(x => [x.id, x.label]), div)}</div>
  ${past}
  ${monthlyReminders()}
  <p class="hint">Months run on UTC time, the same window for everyone. Results freeze one day after a month ends, so late syncs still count.</p>`;
}

function monthlyReminders() {
  const r = state.monthlyReminders || {};
  const time = r.time || "18:00";
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
  const g = monthlyGoogleUrls(time, { url: `${location.origin}/`, timeZone: tz });
  const done = k => r.added?.includes(`${time}|${k}`);
  const row = (k, title, sub) => `
    <a class="cl-row" href="${esc(g[k])}" target="_blank" rel="noopener" data-month-remind="${k}">
      <i class="ti ${done(k) ? "ti-circle-check is-done" : "ti-bell"} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${title}</span><span class="cl-meta">${done(k) ? "Added · tap to add again" : sub}</span></span>
      <i class="ti ti-calendar-plus cl-go" aria-hidden="true"></i></a>`;
  return `
  <div id="hall-reminders">${sectionLabel("Reminders", `<span class="cl-cat-count">${esc(time)}</span>`)}</div>
  <div class="pad-y">${chips("data-month-time", MONTHLY_REMINDER_TIMES.map(x => [x, x]), time)}
    <p class="hint">Your phone's calendar alerts you every month, even when VYRA is closed.</p></div>
  <div class="cl-list">
    ${row("final", "5 days left", "Log your best before the month ends · Google Calendar")}
    ${row("live", "New challenge is live", "On the 1st of every month · Google Calendar")}
  </div>
  <button class="btn-secondary btn-sm btn-inline-start" data-act="month-ics"><i class="ti ti-download"></i> Apple / Outlook calendar</button>`;
}

function handleMonthlyClick(d) {
  if (d.hallDivision) { ui.hallDivision = d.hallDivision; return rerender(), true; }
  if (d.monthTime) { state.monthlyReminders = { ...(state.monthlyReminders || {}), time: d.monthTime }; save(); return rerender(), true; }
  if (d.monthRemind) {                                  // the link itself opens Google Calendar
    const r = state.monthlyReminders || {};
    const time = r.time || "18:00";
    state.monthlyReminders = { ...r, time, added: [...new Set([...(r.added || []), `${time}|${d.monthRemind}`])] };
    save(); setTimeout(rerender, 300);
    return true;
  }
  switch (d.act) {
    case "hall-refresh": ui.hall = null; return rerender(), true;
    case "hall-reminders":
      go("hall");
      requestAnimationFrame(() => document.getElementById("hall-reminders")?.scrollIntoView({ block: "start" }));
      return true;
    case "month-ics": {
      const time = state.monthlyReminders?.time || "18:00";
      const ics = icsCalendar(monthlyReminderEvents(time), { url: `${location.origin}/` });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "VYRA monthly challenges.ics";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const r = state.monthlyReminders || {};
      state.monthlyReminders = { ...r, time, added: [...new Set([...(r.added || []), `${time}|final`, `${time}|live`])] };
      save(); toast("Open the file to add the next 12 months to your calendar");
      return rerender(), true;
    }
  }
  return false;
}
