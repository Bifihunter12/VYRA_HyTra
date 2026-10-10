"use strict";
/* ════════════════════════════════════════════════════════════════════════════
   Iron Forest — the athlete's own plans ("Make my plan") and saved workouts ("My
   workouts"). Plan logic lives in progress.js (makePlan, planProgram); a plan
   runs through the same program engine as the built-in 4-week programs.
   Loaded before app.js.
   ════════════════════════════════════════════════════════════════════════════ */

/* ── Own plans ────────────────────────────────────────────────────────────── */
const customPlans = () => state.customPlans || [];
const customPlanById = id => customPlans().find(p => p.id === id) || null;

/* Keep the program registry (core.js) in step with the stored plans. */
function refreshUserPrograms() {
  USER_PROGRAMS.length = 0;
  customPlans().forEach(p => USER_PROGRAMS.push(planProgram(p)));
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];          // Monday first
const sortDays = list => [...list].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

function defaultPlanDraft() {
  const n = Math.min(6, Math.max(2, state.profile.goal || 3));
  const days = { 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] }[n];
  const noGear = !state.profile.equipment.some(e => e !== "outdoors");
  return { days, goal: noGear ? "nogear" : "fit", minutes: 30 };
}

function makePlanCard() {
  return `
    <button class="cl-row" data-go="plan-make">
      <i class="ti ti-wand cl-ic" aria-hidden="true"></i>
      <span class="cl-main"><span class="cl-name">Make my own plan</span>
        <span class="cl-sub">Pick your days, goal and time. Iron Forest builds 4 weeks around them.</span></span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
    </button>`;
}

function renderPlanMake() {
  const d = ui.planDraft || (ui.planDraft = defaultPlanDraft());
  const goal = PLAN_GOALS.find(g => g.id === d.goal);
  const kit = state.profile.equipment.map(e => EQUIPMENT_LABEL[e]).filter(Boolean);
  return `
  ${topbar("", backButton("library", "Library"))}
  <section class="hero">
    <div class="hero-daycount">4 weeks, built around you</div>
    <div class="hero-titlebar"><i class="ti ti-wand hero-ic" aria-hidden="true"></i><h1 class="hero-name">Make my plan</h1></div>
  </section>

  ${sectionLabel("Which days do you train?", `<span class="cl-cat-count">${d.days.length} × week</span>`)}
  <div class="pad-y">${chips("data-pd-day", DAY_ORDER.map(n => [n, WEEKDAYS[n]]), d.days, true)}
    <p class="hint">${d.days.length >= 6 ? "Six days is a lot. Keep at least one full rest day; that's when you get fitter."
      : d.days.length < 2 ? "Pick at least two days." : "Iron Forest keeps hard sessions off back-to-back days."}</p></div>

  ${sectionLabel("Your goal")}
  <div class="pad-y">${chips("data-pd-goal", PLAN_GOALS.map(g => [g.id, g.label]), d.goal)}
    <p class="hint">${esc(goal.desc)}</p></div>

  ${sectionLabel("Time per session")}
  <div class="pad-y">${chips("data-pd-min", [[20, "20 min"], [30, "30 min"], [45, "45 min"]], d.minutes)}
    <p class="hint">Plus a few minutes of warm-up and cool-down if you have them on.</p></div>

  <div class="gear-note"><i class="ti ti-adjustments"></i> Built for your level (${esc(cap(state.profile.level))}) and equipment (${esc(kit.join(", ") || "none")}). Change those in Profile.</div>
  <button class="btn-primary btn-inline-start" data-act="plan-make" ${d.days.length < 2 ? "disabled" : ""}><i class="ti ti-wand"></i> Make my plan</button>`;
}

/* Extra parts of the program screen for the athlete's own plan. */
function customPlanTools(p) {
  if (!p.custom) return "";
  return `
  <div class="plan-tools">
    <button class="btn-secondary btn-sm" data-act="plan-edit"><i class="ti ti-pencil"></i> Edit plan</button>
    <button class="text-btn" data-act="plan-delete">${ui.confirm === "plan-delete" ? "Tap again to delete" : "Delete plan"}</button>
  </div>
  ${planReminders(customPlanById(p.id))}`;
}

/* ── Reminders: the phone's calendar alerts on every plan day ─────────────── */
const APP_URL = () => `${location.origin}/`;
const reminderSig = plan => JSON.stringify([plan.remindAt || "17:30", plan.slots.map(x => [x.day, x.t, x.name || ""])]);

function reminderItems(plan) {
  const items = plan.slots.map(x => {
    const t = templateById(x.t);
    const minutes = planFor(t.id, sessionParams(t, paramsFor(t.id), { set: x.set })).totals.main / 60;
    return { day: x.day, name: x.name || t.name, minutes };
  });
  return reminderStarts(items, plan.remindAt || "17:30");
}

function planReminders(plan) {
  if (!plan?.slots.length) return "";
  const time = plan.remindAt || "17:30";
  const other = ui.remindOther || !REMINDER_TIMES.includes(time);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
  const added = plan.reminders || {};
  const stale = added.sig && added.sig !== reminderSig(plan);
  return `
  ${sectionLabel("Reminders", `<span class="cl-cat-count">${esc(time)}</span>`)}
  <div class="pad-y">${chips("data-remind-at", [...REMINDER_TIMES.map(x => [x, x]), ["other", "Other"]], other ? "other" : time)}
    ${other ? `<div class="field-row"><input class="text-input remind-time" id="remind-time" type="time" value="${esc(time)}" aria-label="Reminder time"></div>` : ""}
    <p class="hint">Your phone's calendar alerts you at this time on every plan day, for all four weeks, even when Iron Forest is closed.</p></div>
  ${stale ? `<div class="gear-note gear-note--warn"><i class="ti ti-alert-triangle"></i> You changed the plan or the time since adding reminders. Add them again and delete the old ones in your calendar.</div>` : ""}
  <div class="cl-list">${reminderItems(plan).map(it => `
    <a class="cl-row" href="${esc(googleCalendarUrl(plan, it, { url: APP_URL(), timeZone: tz }))}" target="_blank" rel="noopener" data-remind-day="${it.day}">
      <span class="day-tag">${WEEKDAYS[it.day]}</span>
      <span class="cl-main"><span class="cl-name">${esc(it.name)}</span>
        <span class="cl-meta">${!stale && added.days?.includes(it.day) ? "Added · tap to add again" : "Add to Google Calendar"}</span></span>
      <i class="ti ${!stale && added.days?.includes(it.day) ? "ti-circle-check is-done" : "ti-calendar-plus"} cl-go" aria-hidden="true"></i>
    </a>`).join("")}</div>
  <button class="btn-secondary btn-sm btn-inline-start" data-act="remind-ics"><i class="ti ti-download"></i> Apple / Outlook calendar</button>`;
}

function renderPlanEdit() {
  const plan = customPlanById(ui.programId);
  if (!plan) return `${topbar("", backButton("library", "Library"))}<p class="empty">Plan not found.</p>`;
  const used = new Set(plan.slots.map(s => s.day));
  const freeDay = DAY_ORDER.find(n => !used.has(n));
  const rows = plan.slots.map((s, i) => {
    const t = templateById(s.t);
    return `
    <div class="slot-row">
      <select class="slot-day" data-slot-day="${i}" aria-label="Day">${DAY_ORDER.map(n => `<option value="${n}" ${n === s.day ? "selected" : ""} ${n !== s.day && used.has(n) ? "disabled" : ""}>${WEEKDAYS[n]}</option>`).join("")}</select>
      <button class="slot-main" data-slot-change="${i}">
        <span class="cl-name">${esc(s.name || t.name)}</span>
        <span class="cl-meta">${s.set?.rounds ? `${s.set.rounds} rounds · ` : ""}${esc(t.tagline)}</span>
      </button>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i>
      <button class="icon-btn" data-slot-remove="${i}" aria-label="Remove ${WEEKDAYS[s.day]}"><i class="ti ti-trash"></i></button>
    </div>`;
  }).join("");
  return `
  ${topbar("", backButton("program", "Plan"))}
  <section class="hero">
    <div class="hero-daycount">Edit your plan</div>
    <div class="hero-titlebar"><h1 class="hero-name">${esc(plan.name)}</h1></div>
  </section>
  <label class="field"><span>Plan name</span><input class="text-input" id="plan-name" maxlength="40" value="${esc(plan.name)}"></label>
  ${sectionLabel("Every week", `<span class="cl-cat-count">${plan.slots.length} sessions</span>`)}
  <div class="slot-list">${rows || `<p class="empty">No sessions yet.</p>`}</div>
  ${freeDay != null && plan.slots.length < 6 ? `<button class="text-btn" data-act="slot-add"><i class="ti ti-plus"></i> Add a day</button>` : ""}
  <p class="hint">Changes apply to all four weeks. Weeks 2–3 add a little, week 4 is lighter. Progress you've made stays.</p>
  <button class="btn-primary btn-inline-start" data-act="plan-edit-done"><i class="ti ti-check"></i> Done</button>`;
}

/* Pick a workout for one day of the plan. */
function renderPlanPick() {
  const plan = customPlanById(ui.programId);
  const slot = plan?.slots[ui.slotIndex];
  if (!slot) return `${topbar("", backButton("plan-edit", "Edit plan"))}<p class="empty">Nothing to change.</p>`;
  const metas = TEMPLATES.filter(t => t.category !== "benchmark").map(templateMeta).filter(m => m.doable);
  const mine = myWorkouts();
  const row = (attrs, name, sub, on) => `
    <button class="cl-row ${on ? "is-current" : ""}" ${attrs}>
      <span class="cl-main"><span class="cl-name">${esc(name)}${on ? ` <span class="tag tag--live">Now</span>` : ""}</span><span class="cl-meta">${esc(sub)}</span></span>
      <i class="ti ti-chevron-right cl-go" aria-hidden="true"></i></button>`;
  return `
  ${topbar("", backButton("plan-edit", "Edit plan"))}
  <section class="hero">
    <div class="hero-daycount">${WEEKDAYS[slot.day]}</div>
    <div class="hero-titlebar"><h1 class="hero-name">Pick a workout</h1></div>
  </section>
  ${mine.length ? `${sectionLabel("My workouts")}<div class="cl-list">${mine.map(m => row(`data-pick-mine="${m.id}"`, m.name, `Based on ${templateById(m.templateId).name}`, slot.mine === m.id)).join("")}</div>` : ""}
  ${CATEGORIES.filter(c => c.id !== "benchmark").map(c => {
    const items = metas.filter(m => m.t.category === c.id);
    return items.length ? `${sectionLabel(c.label)}<div class="cl-list">${items.map(m => row(`data-pick="${m.t.id}"`, m.t.name, `${m.t.tagline} · ${cap(m.t.level)}`, !slot.mine && slot.t === m.t.id)).join("")}</div>` : "";
  }).join("")}`;
}

function savePlans(plans) {
  state.customPlans = plans;
  refreshUserPrograms();
  save();
}
function updatePlan(id, fn) {
  savePlans(customPlans().map(p => (p.id === id ? fn(structuredClone(p)) : p)));
}

/* ── My workouts: saved settings + swaps of a library workout ─────────────── */
const myWorkouts = () => state.myWorkouts || [];
const mineById = id => myWorkouts().find(m => m.id === id) || null;
/* The saved workout being viewed on the setup screen, if any. */
const activeMine = templateId => { const m = mineById(ui.mineId); return m && m.templateId === templateId ? m : null; };

function mineRow(m) {
  const t = templateById(m.templateId);
  const minutes = Math.round(planFor(t.id, { ...defaultParams(t), ...m.params }).totals.main / 60);
  return `
    <div class="lib-row">
      <button class="cl-row" data-mine="${m.id}" aria-label="${esc(m.name)} details">
        <i class="ti ti-bookmark cl-ic" aria-hidden="true"></i>
        <span class="cl-main"><span class="cl-name">${esc(m.name)}</span>
          <span class="cl-sub">Based on ${esc(t.name)}</span>
          <span class="cl-meta">${minutes} min · ${cap(t.level)}</span></span>
      </button>
      <button class="row-start" data-act="mine-start" data-id="${m.id}" aria-label="Start ${esc(m.name)}"><i class="ti ti-player-play"></i><span>Start</span></button>
    </div>`;
}

/* Save / rename / delete block on the setup screen. */
function mineTools(t) {
  const m = activeMine(t.id);
  const naming = ui.mineName != null;
  if (naming) return `
    <div class="save-mine">
      <input class="text-input" id="mine-name" maxlength="40" value="${esc(ui.mineName)}" placeholder="Name your workout" aria-label="Workout name">
      <button class="btn-secondary btn-sm" data-act="mine-save"><i class="ti ti-check"></i> Save</button>
      <button class="text-btn" data-act="mine-cancel">Cancel</button>
    </div>`;
  return m ? `
    <div class="plan-tools">
      <button class="btn-secondary btn-sm" data-act="mine-rename"><i class="ti ti-pencil"></i> Rename</button>
      <button class="text-btn" data-act="mine-delete">${ui.confirm === "mine-delete" ? "Tap again to delete" : "Delete"}</button>
    </div>`
    : `<button class="text-btn" data-act="mine-new"><i class="ti ti-bookmark-plus"></i> Save as my workout</button>`;
}

/* ── Clicks & inputs ──────────────────────────────────────────────────────── */
function handlePlansClick(d) {
  if (d.pdDay) { const n = Number(d.pdDay); const days = ui.planDraft.days; ui.planDraft.days = days.includes(n) ? days.filter(x => x !== n) : sortDays([...days, n]); return rerender(), true; }
  if (d.pdGoal) { ui.planDraft.goal = d.pdGoal; return rerender(), true; }
  if (d.pdMin) { ui.planDraft.minutes = Number(d.pdMin); return rerender(), true; }
  if (d.slotChange) { ui.slotIndex = Number(d.slotChange); ui.screen = "plan-pick"; return render(), true; }
  if (d.slotRemove) {
    updatePlan(ui.programId, p => { p.slots.splice(Number(d.slotRemove), 1); return p; });
    return rerender(), true;
  }
  if (d.pick || d.pickMine) {
    const plan = customPlanById(ui.programId);
    const m = d.pickMine ? mineById(d.pickMine) : null;
    const tid = m ? m.templateId : d.pick;
    const set = m ? { ...m.params } : fitToMinutes(templateById(tid), plan.minutes || 30, state.profile.equipment);
    updatePlan(ui.programId, p => {
      const s = p.slots[ui.slotIndex];
      p.slots[ui.slotIndex] = { day: s.day, t: tid, set, ...(m ? { mine: m.id, name: m.name } : {}) };
      return p;
    });
    ui.screen = "plan-edit"; return render(), true;
  }
  if (d.remindAt) {
    if (d.remindAt === "other") { ui.remindOther = true; return rerender(), true; }
    ui.remindOther = false;
    updatePlan(ui.programId, p => ({ ...p, remindAt: d.remindAt }));
    return rerender(), true;
  }
  if (d.remindDay) {                                   // the link itself opens Google Calendar
    updatePlan(ui.programId, p => {
      const r = p.reminders?.sig === reminderSig(p) ? p.reminders : { sig: reminderSig(p), days: [] };
      return { ...p, reminders: { ...r, days: [...new Set([...r.days, Number(d.remindDay)])] } };
    });
    setTimeout(rerender, 300);
    return true;
  }
  if (d.mine) { ui.mineId = d.mine; ui.mineName = null; ui.programKey = null; ui.templateId = mineById(d.mine).templateId; ui.screen = "setup"; return render(), true; }
  switch (d.act) {
    case "plan-make": {
      const dr = ui.planDraft;
      const plan = makePlan({ goal: dr.goal, days: dr.days, minutes: dr.minutes, level: state.profile.level, equipment: state.profile.equipment });
      if (!plan.slots.length) { toast("No workouts fit those choices. Try another goal or check your equipment."); return true; }
      savePlans([...customPlans(), plan]);
      ui.planDraft = null; ui.programId = plan.id; ui.screen = "program"; render();
      toast("Your plan is ready");
      return true;
    }
    case "plan-edit": ui.screen = "plan-edit"; return render(), true;
    case "plan-edit-done": ui.screen = "program"; return render(), true;
    case "plan-delete": {
      if (ui.confirm !== "plan-delete") { ui.confirm = "plan-delete"; return rerender(), true; }
      ui.confirm = null;
      if (state.program?.id === ui.programId) state.program = null;
      savePlans(customPlans().filter(p => p.id !== ui.programId));
      toast("Plan deleted"); go("library"); return true;
    }
    case "slot-add": {
      const plan = customPlanById(ui.programId);
      const used = new Set(plan.slots.map(s => s.day));
      const day = DAY_ORDER.find(n => !used.has(n));
      const best = planCandidates({ goal: plan.goal || "fit", level: state.profile.level, equipment: state.profile.equipment, minutes: plan.minutes || 30 })
        .find(c => !plan.slots.some(s => s.t === c.t.id && !s.mine)) || null;
      if (day == null || !best) return true;
      updatePlan(plan.id, p => { p.slots.push({ day, t: best.t.id, set: best.set }); p.slots.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)); return p; });
      return rerender(), true;
    }
    case "remind-ics": {
      const plan = customPlanById(ui.programId);
      const blob = new Blob([planIcs(plan, reminderItems(plan), { url: APP_URL() })], { type: "text/calendar" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `${plan.name.replace(/[^\w -]+/g, "").trim() || "Iron Forest plan"}.ics`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      updatePlan(plan.id, p => ({ ...p, reminders: { sig: reminderSig(p), days: p.slots.map(x => x.day) } }));
      toast("Open the file to add the reminders to your calendar");
      return rerender(), true;
    }
    case "mine-new": ui.mineName = `My ${templateById(ui.templateId).name}`; return rerender(), true;
    case "mine-rename": ui.mineName = mineById(ui.mineId).name; return rerender(), true;
    case "mine-cancel": ui.mineName = null; return rerender(), true;
    case "mine-save": {
      const name = (document.getElementById("mine-name")?.value || "").trim().slice(0, 40);
      if (!name) { toast("Give it a name"); return true; }
      const m = activeMine(ui.templateId);
      if (m) state.myWorkouts = myWorkouts().map(x => (x.id === m.id ? { ...x, name } : x));
      else {
        const t = templateById(ui.templateId);
        const mine = { id: `mine-${uid()}`, name, templateId: t.id, params: { ...paramsFor(t.id) }, swaps: { ...swapsFor(t.id) }, createdAt: Date.now() };
        state.myWorkouts = [...myWorkouts(), mine];
        ui.mineId = mine.id;
      }
      ui.mineName = null; save(); toast(m ? "Renamed" : "Saved to My workouts"); return rerender(), true;
    }
    case "mine-delete": {
      if (ui.confirm !== "mine-delete") { ui.confirm = "mine-delete"; return rerender(), true; }
      ui.confirm = null;
      state.myWorkouts = myWorkouts().filter(m => m.id !== ui.mineId);
      ui.mineId = null; save(); toast("Deleted"); return rerender(), true;
    }
    case "mine-start": {
      const m = mineById(d.id);
      if (!m) return true;
      ui.mineId = m.id; ui.programKey = null;
      startWorkout(m.templateId);
      return true;
    }
  }
  return false;
}

function handlePlansInput(ev) {
  if (ev.target.id === "plan-name") {
    const name = ev.target.value.slice(0, 40);
    state.customPlans = customPlans().map(p => (p.id === ui.programId ? { ...p, name: name || p.name } : p));
    refreshUserPrograms(); save({ silent: false });
    return true;
  }
  if (ev.target.id === "mine-name") { ui.mineName = ev.target.value; return true; }
  if (ev.target.id === "remind-time" && /^\d{2}:\d{2}$/.test(ev.target.value)) {
    updatePlan(ui.programId, p => ({ ...p, remindAt: ev.target.value }));
    return true;
  }
  return false;
}

function handlePlansChange(ev) {
  if (ev.target.id === "remind-time") { rerender(); return true; }
  const i = ev.target.dataset?.slotDay;
  if (i == null) return false;
  updatePlan(ui.programId, p => {
    p.slots[Number(i)].day = Number(ev.target.value);
    p.slots.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
    return p;
  });
  rerender();
  return true;
}
