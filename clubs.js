"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   Iron Forest — Phase 4 screens: clubs, gyms, teams, gym-vs-gym and local boards.
   Server rules in supabase/005_clubs.sql. Loaded before app.js.
   ════════════════════════════════════════════════════════════════════════════ */

/* Clubs are built and the database is ready, but the tab is switched off until we
   launch them. Set to true to bring the Clubs tab back; nothing is deleted. */
const FEATURES = { clubs: false };

const CLUB_KIND = { club: { label: "Club", icon: "ti-users-group" }, gym: { label: "Gym", icon: "ti-building" }, team: { label: "Team", icon: "ti-users" } };

async function loadClubs() {
  ui.clubs = { status: "loading", mine: ui.clubs?.mine || [], battle: ui.clubs?.battle || [] };
  try {
    const m = monthlyChallenge();
    const ath = athlete();
    const [mine, battle] = await Promise.all([
      Sync.myClubs(),
      Sync.clubBattle({ p_challenge: m.challengeId, p_variant: m.variant, p_division: ath.division,
        p_since: new Date(m.start).toISOString(), p_until: new Date(m.end).toISOString(), p_country: ui.battleLocal && ath.country ? ath.country : null, p_kind: null }),
    ]);
    ui.clubs = { status: "ok", mine, battle };
  } catch (e) { ui.clubs = { status: navigator.onLine ? "error" : "offline", mine: [], battle: [], error: e.message }; }
  if (ui.screen === "compete") rerender();
}

function clubRow(c, action = "") {
  const k = CLUB_KIND[c.kind] || CLUB_KIND.club;
  return `
  <div class="lib-row">
    <button class="cl-row" data-club="${c.id}"><i class="ti ${k.icon} cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">${esc(c.name)}${c.partner ? ` <span class="tag tag--live">Partner gym</span>` : ""}</span>
        <span class="cl-meta">${k.label}${c.city ? ` · ${esc(c.city)}` : ""}${c.country ? ` ${esc(c.country)}` : ""} · ${c.members} member${Number(c.members) === 1 ? "" : "s"}${c.my_role ? ` · ${esc(c.my_role === "member" ? "joined" : c.my_role)}` : c.open ? "" : " · invite only"}</span></span></button>
    ${action}
  </div>`;
}

function renderClubs() {
  if (!Sync.configured() || !Sync.user) {
    return `<div class="empty-card"><i class="ti ti-building big-ic"></i><p>Train with your club, gym or team: shared leaderboards and gym-vs-gym battles every month. Sign in under Profile → Account & sync to join.</p>
      <button class="btn-primary" data-go="profile"><i class="ti ti-user"></i> Go to Profile</button></div>`;
  }
  const s = ui.clubs;
  if (!s) loadClubs();
  const m = monthlyChallenge();
  const mc = challengeById(m.challengeId);
  const ath = athlete();
  const search = ui.clubSearch || { q: "", rows: null };
  return `
  ${sectionLabel("My clubs", `<button class="text-btn" data-go="club-new"><i class="ti ti-plus"></i> Create</button>`)}
  ${!s || s.status === "loading" && !s.mine.length ? `<p class="empty">Loading…</p>`
    : s.mine.length ? `<div class="cl-list">${s.mine.map(c => clubRow(c)).join("")}</div>`
    : `<p class="empty">You're not in a club yet. Join one below, use an invite code, or create your own.</p>`}
  <div class="field-row join-code">
    <input class="text-input" id="club-code" maxlength="8" placeholder="Invite code" autocapitalize="characters" aria-label="Invite code">
    <button class="btn-secondary btn-sm" data-act="club-join-code">Join</button>
  </div>

  ${sectionLabel(`Gym vs gym · ${esc(m.monthName)}`, ath.country ? `<span>${chips("data-battle-scope", [["all", "World"], ["local", ath.country]], ui.battleLocal ? "local" : "all")}</span>` : "")}
  <p class="hint">${esc(mc.name)}: every member's result earns points (1st 100 → last 10). A club's score is its best 10 members.</p>
  ${s?.battle?.length ? `<ol class="board">${s.battle.slice(0, 10).map(b => `
    <li class="${b.mine ? "is-me" : ""}"><span class="b-rank">${b.rank}</span>
      <button class="b-name" data-club="${b.club_id}">${esc(b.name)}${b.partner ? ' <i class="ti ti-rosette-discount-check" title="Partner gym"></i>' : ""}<span class="b-sub">${esc(CLUB_KIND[b.kind]?.label || "Club")}${b.city ? ` · ${esc(b.city)}` : ""} · ${b.athletes} athletes</span></button>
      <span class="b-score">${b.score}</span></li>`).join("")}</ol>` : `<p class="empty">No club results this month yet.</p>`}

  ${sectionLabel("Find a club or gym")}
  <div class="search"><i class="ti ti-search"></i>
    <input class="text-input" id="club-search" placeholder="Name or city" value="${esc(search.q)}" autocomplete="off" aria-label="Find a club"></div>
  ${search.rows ? `<div class="cl-list">${search.rows.length ? search.rows.map(c => clubRow(c, c.my_role ? "" : c.open
      ? `<button class="follow-btn" data-club-join="${c.id}">Join</button>` : `<span class="tag">Invite only</span>`)).join("") : `<p class="empty">No clubs match.</p>`}</div>` : ""}`;
}

async function searchClubs(q) {
  ui.clubSearch = { q, rows: ui.clubSearch?.rows || null };
  clearTimeout(searchClubs.t);
  searchClubs.t = setTimeout(async () => {
    try { const rows = await Sync.searchClubs(q, null); if (ui.clubSearch.q === q) ui.clubSearch = { q, rows }; } catch { ui.clubSearch = { q, rows: [] }; }
    if (ui.screen === "compete") { const pos = document.activeElement?.selectionStart; rerender(); const inp = document.getElementById("club-search"); if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); } }
  }, 300);
}

/* Club page */
async function loadClub(id) {
  ui.club = { id, status: "loading" };
  try {
    const data = await Sync.clubDetail(id);
    const code = data && ["owner", "admin"].includes(data.my_role) ? await Sync.inviteCode(id) : null;
    ui.club = { id, status: "ok", data, code };
  } catch (e) { ui.club = { id, status: "error", error: e.message }; }
  if (ui.screen === "club") rerender();
}

function renderClub() {
  const back = backButton("compete", "Clubs");
  const s = ui.club;
  if (!s || s.status === "loading") return `${topbar("", back)}<p class="empty">Loading…</p>`;
  if (s.status !== "ok" || !s.data) return `${topbar("", back)}<p class="empty">Couldn't load this club.</p>`;
  const c = s.data;
  const k = CLUB_KIND[c.kind] || CLUB_KIND.club;
  const m = monthlyChallenge();
  const mc = challengeById(m.challengeId);
  const division = athlete().division;
  const boardKeyClub = `${c.id}|${m.key}|${division}`;
  const board = ui.clubBoards?.[boardKeyClub];
  if (c.my_role && !board) loadClubBoard(c.id, mc, m, division, boardKeyClub);
  return `
  ${topbar("", back)}
  <section class="athlete-hero">
    <div class="avatar"><i class="ti ${k.icon}"></i></div>
    <div class="athlete-id"><h1 class="hero-name">${esc(c.name)}</h1>
      <div class="cl-meta">${k.label}${c.city ? ` · ${esc(c.city)}` : ""}${c.country ? ` ${esc(c.country)}` : ""} · ${c.members} member${c.members === 1 ? "" : "s"}${c.open ? "" : " · invite only"}</div></div>
  </section>
  ${c.partner ? `<div class="gear-note"><i class="ti ti-rosette-discount-check"></i> Iron Forest partner gym</div>` : ""}
  ${c.description ? `<p class="about">${esc(c.description)}</p>` : ""}
  ${c.my_role ? (c.my_role === "owner" ? "" : `<button class="text-btn" data-act="club-leave">${ui.confirm === "leave-club" ? "Tap again to leave" : "Leave club"}</button>`)
    : c.open ? `<button class="btn-primary btn-inline-start" data-club-join="${c.id}"><i class="ti ti-user-plus"></i> Join ${esc(k.label.toLowerCase())}</button>`
    : `<p class="hint">Invite only. Ask a member for the invite code.</p>`}
  ${s.code ? `<div class="invite"><span class="stat-label">Invite code</span><b>${esc(s.code)}</b>
    <button class="btn-secondary btn-sm" data-act="copy-code" data-code="${esc(s.code)}"><i class="ti ti-copy"></i> Copy</button></div>` : ""}

  ${c.my_role ? `
  ${sectionLabel(`${esc(m.monthName)} · ${esc(mc.name)}`, `<span class="cl-cat-count">Club leaderboard</span>`)}
  ${!board || board.status === "loading" ? `<p class="empty">Loading…</p>` : !board.rows.length ? `<p class="empty">No member results this month yet. Be the first.</p>`
    : `<ol class="board">${board.rows.map(r => `<li class="${r.is_me ? "is-me" : ""}"><span class="b-rank">${r.rank}</span><span class="b-name">${esc(r.display_name)}</span><span class="b-score">${esc(formatScore(mc, Number(r.score)))}</span></li>`).join("")}</ol>`}
  <button class="btn-secondary btn-inline-start" data-act="challenge-start" data-id="${mc.id}" data-variant="${m.variant}"><i class="ti ti-player-play"></i> Take the ${esc(m.monthName)} challenge</button>` : ""}

  ${sectionLabel("Members")}
  ${(c.roster || []).length ? `<div class="cl-list">${c.roster.map(p => `
    <button class="cl-row" ${p.public ? `data-athlete="${p.user_id}"` : "disabled"}><span class="avatar avatar--sm">${esc(initials(p.display_name))}</span>
      <span class="cl-main"><span class="cl-name">${esc(p.display_name)}</span><span class="cl-meta">${p.handle ? `@${esc(p.handle)} · ` : ""}${esc(p.role)}</span></span></button>`).join("")}</div>`
    : `<p class="empty">Join to see who's in.</p>`}`;
}

async function loadClubBoard(clubId, c, m, division, key) {
  ui.clubBoards = { ...(ui.clubBoards || {}), [key]: { status: "loading", rows: [] } };
  try {
    const rows = await Sync.leaderboard({ p_challenge: c.id, p_variant: m.variant, p_division: division,
      p_since: new Date(m.start).toISOString(), p_until: new Date(m.end).toISOString(), p_limit: 50, p_club: clubId });
    ui.clubBoards[key] = { status: "ok", rows };
  } catch (e) { ui.clubBoards[key] = { status: "error", rows: [] }; }
  if (ui.screen === "club") rerender();
}

/* Create a club */
function renderClubNew() {
  const d = ui.clubDraft || (ui.clubDraft = { name: "", kind: "club", city: athlete().city || "", country: athlete().country || "", open: true, description: "" });
  return `
  ${topbar("", backButton("compete", "Clubs"))}
  <section class="hero"><div class="hero-daycount">Club, gym or team</div><div class="hero-titlebar"><h1 class="hero-name">Create a club</h1></div></section>
  <div class="pad-y">${chips("data-club-kind", Object.entries(CLUB_KIND).map(([id, k]) => [id, k.label]), d.kind)}
    <p class="hint">${{ club: "A running club, training group or friends.", gym: "A gym or box. Iron Forest can mark official partners.", team: "A small team of up to 6 athletes." }[d.kind]}</p></div>
  <div class="account">
    <label class="field"><span>Name</span><input class="text-input" id="club-name" maxlength="60" value="${esc(d.name)}" placeholder="Iron Works Berlin"></label>
    <label class="field"><span>City <small>(optional)</small></span><input class="text-input" id="club-city" maxlength="60" value="${esc(d.city)}" placeholder="Berlin"></label>
    <label class="field"><span>Country code <small>(optional, e.g. DE, US)</small></span><input class="text-input" id="club-country" maxlength="2" value="${esc(d.country)}" placeholder="DE" autocapitalize="characters"></label>
    <label class="field"><span>Description <small>(optional)</small></span><input class="text-input" id="club-desc" maxlength="280" value="${esc(d.description)}" placeholder="Tuesday and Thursday hybrid sessions"></label>
  </div>
  <div class="pad-y">${chips("data-club-open", [["open", "Anyone can join"], ["closed", "Invite code only"]], d.open ? "open" : "closed")}</div>
  <button class="btn-primary btn-inline-start" data-act="club-create"><i class="ti ti-plus"></i> Create ${esc(CLUB_KIND[d.kind].label.toLowerCase())}</button>`;
}

async function handleClubsClick(d) {
  if (d.club) { ui.screen = "club"; loadClub(d.club); render(); return true; }
  if (d.clubJoin) {
    try { await Sync.joinOpen(d.clubJoin); toast("Joined"); } catch (e) { toast(`Couldn't join: ${e.message}`); return true; }
    ui.clubs = null; ui.clubSearch = null;
    if (ui.screen === "club") loadClub(d.clubJoin); else rerender();
    return true;
  }
  if (d.clubKind) { ui.clubDraft.kind = d.clubKind; rerender(); return true; }
  if (d.clubOpen) { ui.clubDraft.open = d.clubOpen === "open"; rerender(); return true; }
  if (d.battleScope) { ui.battleLocal = d.battleScope === "local"; ui.clubs = null; rerender(); return true; }
  switch (d.act) {
    case "club-join-code": {
      const code = (document.getElementById("club-code")?.value || "").trim();
      if (code.length < 6) { toast("Enter the 8-character invite code"); return true; }
      try { const id = await Sync.joinClub(code); toast("Joined"); ui.clubs = null; ui.screen = "club"; loadClub(id); render(); }
      catch (e) { toast(e.message.includes("No club") ? "No club with that code" : `Couldn't join: ${e.message}`); }
      return true;
    }
    case "club-create": {
      const dr = ui.clubDraft;
      const country = dr.country.trim().toUpperCase();
      if (dr.name.trim().length < 2) { toast("Give your club a name"); return true; }
      if (country && !/^[A-Z]{2}$/.test(country)) { toast("Country code is two letters, like DE or US"); return true; }
      try {
        const id = await Sync.createClub({ name: dr.name.trim(), kind: dr.kind, city: dr.city.trim() || null, country: country || null, open: dr.open, description: dr.description.trim() || null });
        ui.clubDraft = null; ui.clubs = null; toast("Club created");
        ui.screen = "club"; loadClub(id); render();
      } catch (e) { toast(`Couldn't create: ${e.message}`); }
      return true;
    }
    case "club-leave": {
      if (ui.confirm !== "leave-club") { ui.confirm = "leave-club"; rerender(); return true; }
      ui.confirm = null;
      try { await Sync.leaveClub(ui.club.id); toast("Left the club"); ui.clubs = null; loadClub(ui.club.id); } catch (e) { toast(`Couldn't leave: ${e.message}`); }
      return true;
    }
    case "copy-code":
      try { await navigator.clipboard.writeText(d.code); toast("Invite code copied"); } catch { toast(`Invite code: ${d.code}`); }
      return true;
  }
  return false;
}
