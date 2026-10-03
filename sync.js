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
      state.sync.pushedAt = startedAt;

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

      state.sync.lastSyncedAt = Date.now();
      save({ silent: true });
      this.status = "idle";
      this.onChange(changed);
    } catch (e) {
      this.fail(e);
    }
  },

  fail(e) {
    this.status = navigator.onLine ? "error" : "offline";
    this.error = e?.message || String(e);
    console.warn("VYRA sync:", this.error);
    this.onChange();
  },
};

function defaultSyncState() { return { userId: null, cursor: null, pushedAt: 0, lastSyncedAt: 0 }; }
