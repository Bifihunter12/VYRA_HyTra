"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   VYRA — Cloud sync (optional, local-first)
   The app always works from localStorage. When the athlete signs in, workouts
   and settings sync to Supabase in the background and merge across devices.
   Merge rules live in core.js (mergeRemoteWorkouts, pendingWorkoutRows).
   Needs: config.js (URL + anon key) and the supabase-js UMD bundle.
   ════════════════════════════════════════════════════════════════════════════ */

const Sync = {
  client: null,
  user: null,
  status: "off",          // off | signed-out | syncing | idle | error | offline
  error: "",
  timer: null,
  running: null,
  onChange: () => {},

  configured() {
    const c = window.VYRA_CONFIG || {};
    return !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase?.createClient);
  },

  redirectUrl() { return location.origin + location.pathname; },

  async init(onChange) {
    this.onChange = onChange || this.onChange;
    if (!this.configured()) { this.status = "off"; return; }
    const { supabaseUrl, supabaseAnonKey } = window.VYRA_CONFIG;
    try {
      this.client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "vyra_auth" },
      });
    } catch (e) { this.fail(e); return; }

    this.client.auth.onAuthStateChange((event, sess) => {
      const before = this.user?.id;
      this.user = sess?.user || null;
      this.status = this.user ? (this.status === "syncing" ? "syncing" : "idle") : "signed-out";
      if (this.user && this.user.id !== before) this.schedule(0);
      this.onChange();
    });
    const { data } = await this.client.auth.getSession();
    this.user = data.session?.user || null;
    this.status = this.user ? "idle" : "signed-out";
    // Remove ?code= / #access_token= left by the sign-in redirect.
    if (/[?&]code=|access_token=|error_description=/.test(location.href)) history.replaceState(null, "", this.redirectUrl());
    this.onChange();
    if (this.user) this.schedule(0);

    window.addEventListener("online", () => this.schedule(0));
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.schedule(500); });
  },

  /* ── Sign-in ──────────────────────────────────────────────────────────── */
  async sendEmail(email) {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: this.redirectUrl(), shouldCreateUser: true } });
    if (error) throw error;
  },
  async verifyCode(email, token) {
    const { error } = await this.client.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
  },
  async google() {
    const { error } = await this.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: this.redirectUrl() } });
    if (error) throw error;
  },
  async signOut() {
    await this.client.auth.signOut();
    state.sync = { ...defaultSyncState() };
    save({ silent: true });
  },
  async deleteAccount() {
    const { error } = await this.client.rpc("delete_my_account");
    if (error) throw error;
    await this.client.auth.signOut();
    state.sync = { ...defaultSyncState() };
    save({ silent: true });
  },

  /* ── Sync loop ────────────────────────────────────────────────────────── */
  schedule(delay = 1500) {
    if (!this.client || !this.user) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), delay);
  },

  async run() {
    if (!this.client || !this.user) return;
    if (this.running) return this.running;
    if (!navigator.onLine) { this.status = "offline"; this.onChange(); return; }
    this.running = this._run().finally(() => { this.running = null; });
    return this.running;
  },

  async _run() {
    const db = this.client;
    const uid = this.user.id;
    this.status = "syncing"; this.error = ""; this.onChange();
    try {
      // A different account on this device starts from scratch (and uploads what's here).
      const firstSync = state.sync.userId !== uid;
      if (firstSync) state.sync = { ...defaultSyncState(), userId: uid };
      const startedAt = Date.now();

      // 1. Pull workouts changed on the server since the last pull.
      let cursor = state.sync.cursor || "1970-01-01T00:00:00Z";
      let changed = false;
      for (let page = 0; page < 50; page++) {
        const { data: rows, error } = await db.from("workouts")
          .select("id, data, deleted, updated_at, server_updated_at")
          .gt("server_updated_at", cursor).order("server_updated_at", { ascending: true }).limit(500);
        if (error) throw error;
        if (!rows.length) break;
        const merged = mergeRemoteWorkouts(state.history, state.deleted, rows);
        state.history = merged.history; state.deleted = merged.tombstones;
        changed = changed || merged.changed;
        cursor = rows[rows.length - 1].server_updated_at;
        if (rows.length < 500) break;
      }
      state.sync.cursor = cursor;

      // 2. Push local workouts and deletions edited since the last push.
      const rows = pendingWorkoutRows(state.history, state.deleted, state.sync.pushedAt || 0).map(r => ({ ...r, user_id: uid }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from("workouts").upsert(rows.slice(i, i + 200), { onConflict: "user_id,id" });
        if (error) throw error;
      }

      // 2b. Benchmark results feed the leaderboards (own table, never readable by others directly).
      const results = rows.filter(row => row.data?.attempt).map(row => {
        const a = row.data.attempt;
        return { user_id: uid, id: row.id, challenge_id: a.challengeId, variant: a.variant, division: a.division,
          score: a.score, better: a.better, verification: a.verification === "verified" ? "community" : a.verification,
          dnf: !!a.dnf, performed_at: row.performed_at, deleted: false, updated_at: row.updated_at,
          event_id: a.eventId || null, trial_id: a.trialId || null };
      });
      for (let i = 0; i < results.length; i += 200) {
        const { error } = await db.from("attempts").upsert(results.slice(i, i + 200), { onConflict: "user_id,id" });
        if (error) throw error;
      }
      const gone = rows.filter(row => row.deleted).map(row => row.id);
      if (gone.length) {
        const { error } = await db.from("attempts").update({ deleted: true }).eq("user_id", uid).in("id", gone);
        if (error) throw error;
      }
      // 2d. Activity for the community feed — only when the athlete shares it.
      const sharing = state.athlete && state.athlete.activity && state.athlete.activity !== "off";
      const athleteChanged = JSON.stringify(state.athlete || null) !== state.sync.athleteSig;
      if (sharing) {
        // Turning sharing on (or a new device) backfills the last few workouts.
        const source = athleteChanged || firstSync
          ? state.history.filter(h => !h.demo).slice(0, 20).map(h => ({ id: h.id, data: h, performed_at: new Date(h.date).toISOString(), updated_at: new Date(h.updatedAt || h.date).toISOString() }))
          : rows.filter(row => !row.deleted);
        const items = source.map(row => activityRow(uid, row));
        for (let i = 0; i < items.length; i += 200) {
          const { error } = await db.from("activity").upsert(items.slice(i, i + 200), { onConflict: "user_id,id" });
          if (error) throw error;
        }
      }
      if (gone.length) {
        const { error } = await db.from("activity").update({ deleted: true }).eq("user_id", uid).in("id", gone);
        if (error) throw error;
      }
      state.sync.pushedAt = startedAt;

      // 2c. Athlete card (name, division, privacy) whenever it changed.
      const athSig = JSON.stringify(state.athlete || null);
      if (state.athlete && (firstSync || athSig !== state.sync.athleteSig)) {
        const a = state.athlete;
        const { error } = await db.from("athletes").upsert({
          user_id: uid, handle: a.handle || null, display_name: a.displayName || null, birth_year: a.birthYear || null,
          category: a.category || "open", division: a.division || "open", visibility: a.visibility || "private",
          leaderboards: !!a.leaderboards, activity: a.activity || "off",
          country: a.country || null, city: a.city || null, updated_at: new Date().toISOString(),
        });
        if (error) throw error.code === "23505" ? new Error("That handle is already taken. Pick another in your athlete profile.") : error;
        state.sync.athleteSig = athSig;
      }

      // 3. Settings: whichever side changed last wins.
      const { data: prof, error: pErr } = await db.from("profiles").select("data, updated_at").eq("user_id", uid).maybeSingle();
      if (pErr) throw pErr;
      const remoteAt = prof ? Date.parse(prof.updated_at) : 0;
      const localAt = state.profileUpdatedAt || 0;
      // On a device's first sync, an existing account's settings win over this device's defaults.
      if (prof && (firstSync || remoteAt > localAt)) {
        Object.assign(state, prof.data);
        state.profileUpdatedAt = remoteAt;
        state.profileSig = JSON.stringify(profileBlob(state));
        changed = true;
      } else if (!prof || localAt > remoteAt) {
        const { error } = await db.from("profiles").upsert({ user_id: uid, data: profileBlob(state), updated_at: new Date(localAt || Date.now()).toISOString() });
        if (error) throw error;
      }

      // 4. Verification status of my submitted videos.
      try {
        const { data: reqs } = await db.from("verification_requests").select("attempt_id, status, review_note");
        (reqs || []).forEach(q => {
          const h = state.history.find(x => x.id === q.attempt_id && x.attempt);
          if (!h) return;
          const verification = q.status === "approved" ? "verified" : h.attempt.verification === "verified" ? "community" : h.attempt.verification;
          if (h.attempt.verifyStatus !== q.status || h.attempt.verification !== verification) {
            h.attempt = { ...h.attempt, verifyStatus: q.status, verifyNote: q.review_note || "", verification };
            h._remoteAt = h.updatedAt = Date.now(); // a server-side change: don't bounce it back as an edit
            const { updatedAt, _sig, _remoteAt, ...rest } = h; h._sig = JSON.stringify(rest);
            changed = true;
          }
        });
      } catch { /* table may not exist yet (004 not run): ignore */ }

      state.sync.lastSyncedAt = Date.now();
      save({ silent: true });
      this.status = "idle";
      this.onChange(changed);
    } catch (e) {
      this.fail(e);
    }
  },

  /* ── Community (Phase 2) ── */
  async call(name, args) {
    if (!this.client || !this.user) throw new Error("Sign in first");
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw error;
    return data;
  },
  feed(before = null) { return this.call("feed", { p_limit: 30, p_before: before }); },
  comments(owner, id) { return this.call("activity_comments", { p_owner: owner, p_id: id }); },
  search(q) { return this.call("search_athletes", { p_query: q }); },
  profile(userId) { return this.call("athlete_profile", { p_user: userId }); },
  async write(table, op, payload, match) {
    if (!this.client || !this.user) throw new Error("Sign in first");
    let q = this.client.from(table);
    q = op === "insert" ? q.insert(payload) : q.delete().match(match);
    const { error } = await q;
    if (error) throw error;
  },
  follow(userId) { return this.write("follows", "insert", { follower: this.user.id, followee: userId }); },
  unfollow(userId) { return this.write("follows", "delete", null, { follower: this.user.id, followee: userId }); },
  react(owner, id, kind, on) {
    return on ? this.write("reactions", "insert", { owner, activity_id: id, kind })
      : this.write("reactions", "delete", null, { owner, activity_id: id, user_id: this.user.id, kind });
  },
  addComment(owner, id, body) { return this.write("comments", "insert", { owner, activity_id: id, body }); },
  deleteComment(commentId) { return this.write("comments", "delete", null, { id: commentId }); },

  /* ── Events, verification, clubs (Phases 3–4) ── */
  listEvents() { return this.call("list_events", {}); },
  async eventTrials(eventId) {
    const { data, error } = await this.client.from("event_trials").select("trial_id, position, name, weight, spec").eq("event_id", eventId).order("position");
    if (error) throw error;
    return data || [];
  },
  register(eventId, division) { return this.write("registrations", "insert", { event_id: eventId, division }); },
  withdraw(eventId) { return this.write("registrations", "delete", null, { event_id: eventId, user_id: this.user.id }); },
  standings(eventId, division, category = null) { return this.call("event_standings", { p_event: eventId, p_division: division, p_category: category }); },
  async requestVerification(attemptId, url, note) {
    if (!this.client || !this.user) throw new Error("Sign in first");
    const { error } = await this.client.from("verification_requests").upsert(
      { user_id: this.user.id, attempt_id: attemptId, video_url: url, note: note || null, status: "pending", reviewer: null, review_note: null, created_at: new Date().toISOString(), reviewed_at: null },
      { onConflict: "user_id,attempt_id" });
    if (error) throw error;
  },
  async isStaff() { try { return !!(await this.call("is_staff", {})); } catch { return false; } },
  reviewQueue() { return this.call("review_queue", {}); },
  review(userId, attemptId, approve, note) { return this.call("review_attempt", { p_user: userId, p_attempt: attemptId, p_approve: approve, p_note: note || null }); },
  myClubs() { return this.call("my_clubs", {}); },
  searchClubs(q, country) { return this.call("search_clubs", { p_query: q || "", p_country: country || null }); },
  clubDetail(id) { return this.call("club_detail", { p_club: id }); },
  inviteCode(id) { return this.call("club_invite_code", { p_club: id }); },
  joinClub(code) { return this.call("join_club", { p_code: code }); },
  joinOpen(clubId) { return this.write("club_members", "insert", { club_id: clubId, user_id: this.user.id, role: "member" }); },
  leaveClub(clubId) { return this.write("club_members", "delete", null, { club_id: clubId, user_id: this.user.id }); },
  async createClub(club) {
    if (!this.client || !this.user) throw new Error("Sign in first");
    const { data, error } = await this.client.from("clubs").insert(club).select("id").single();
    if (error) throw error;
    return data.id;
  },
  clubBattle(params) { return this.call("club_battle", params); },

  /* Ranked best results for one challenge. Returns [] when not signed in. */
  async leaderboard(params) {
    if (!this.client || !this.user) return [];
    const { data, error } = await this.client.rpc("leaderboard", params);
    if (error) throw error;
    return data || [];
  },

  fail(e) {
    this.status = navigator.onLine ? "error" : "offline";
    this.error = e?.message || String(e);
    console.warn("VYRA sync:", this.error);
    this.onChange();
  },
};

function defaultSyncState() { return { userId: null, cursor: null, pushedAt: 0, lastSyncedAt: 0 }; }

/* One feed item for a saved workout or benchmark result. */
function activityRow(uid, row) {
  const h = row.data;
  const a = h.attempt;
  // "Training" results are private: they appear as a plain workout, without the score.
  const c = a && a.verification !== "training" && typeof challengeById === "function" ? challengeById(a.challengeId) : null;
  const v = c ? variantOf(c, a.variant) : null;
  return {
    user_id: uid, id: row.id, kind: c ? "result" : "workout",
    title: (c ? `${c.name}${c.variants.length > 1 ? ` · ${v.name}` : ""}` : h.name || "Workout").slice(0, 80),
    challenge_id: c ? c.id : null, variant: c ? a.variant : null, division: c ? a.division : null,
    score: c && !a.dnf ? a.score : null, better: c ? a.better : null,
    pr: !!(c && a.pr), first: !!(c && a.first), dnf: !!(c && a.dnf),
    duration_sec: h.stats ? Math.round(h.stats.totalSec) : null,
    performed_at: row.performed_at, deleted: false, updated_at: row.updated_at,
  };
}
