# Endur — Field Design Rollout — Master Prompt for Codex

You are continuing a UI redesign of **Endur**, a fitness + endurance/expedition challenge tracker. A design language called **"Field"** has been approved and applied to the core screens. Your job: **finish rolling "Field" across every remaining screen** with the exact same conventions, verifying as you go. Do not redesign — replicate the established pattern.

---

## 1. Project facts

- **Location:** `C:\Users\carol\OneDrive\Challenges\`
- **Stack:** Vanilla JS PWA. **No build step, no framework, no npm.** Just static files.
  - `app.js` (~7,500 lines) — all logic + HTML rendered via template strings.
  - `style.css` (~120 KB) — all styles.
  - `index.html`, `sw.js` (service worker), `manifest.json`.
- **Python (for any scripts):** `"C:\Program Files\Python314\python.exe"`
- **Run locally:** `python -m http.server 8777 --directory "C:\Users\carol\OneDrive\Challenges"` then open `http://localhost:8777`.
- **Rendering model:** State lives in `state` (persisted to `localStorage` key `endur_v1`). The whole UI re-renders via `render()`. Screens are functions returning template-string HTML (e.g. `renderToday()`, `renderChallenges()`, `renderBadges()`). Event handlers are wired with `on("[data-...]", el => {...})`.

### ⚠️ Service worker caching — CRITICAL
`sw.js` caches aggressively. After editing files, a plain reload may show stale code. To reliably see changes in the browser, run this in the devtools console (or your automated harness) before reloading:
```js
(async () => {
  if ('serviceWorker' in navigator) { const rs = await navigator.serviceWorker.getRegistrations(); for (const r of rs) await r.unregister(); }
  if (window.caches) { const ks = await caches.keys(); for (const k of ks) await caches.delete(k); }
  location.reload();
})()
```

---

## 2. The "Field" design language (do not deviate)

Stark, editorial, masculine, minimal — think a printed training log / Norseman triathlon. Reference: oversized condensed title, a `DAY x / y` micro-label, a hairline rule, a monospace stat row, a flat ember progress bar, and **square ghost checkboxes**.

### Palette (already in `:root` of style.css — use the CSS vars, never hardcode)
- `--bg #0b0b0c`, `--surface #141416`, `--surface-2 #1c1c1f`, `--surface-3 #26262a`
- `--accent`/`--primary` **#d97742 (ember)**, `--secondary #e0935f`
- `--text #f0efed`, `--text-dim #9a9a98`, `--text-faint #5a5a58`
- `--border rgba(255,255,255,0.09)`, `--border-active rgba(255,255,255,0.20)`
- Font: **Inter** (`--font`).

### Rules
1. **Monochrome + ember only.** Everything is greyscale; ember (`var(--accent)`) is the ONLY color, used sparingly for interaction / active / done / progress. No greens, blues, purples, golds. **No gradients** — flat fills only (the old gradient `--gradient` should become solid `var(--accent)`).
2. **Hairline rows, not bordered cards.** Prefer lists divided by `border-bottom:1px solid var(--border)` over boxed cards with radius. Where cards remain, keep them flat (transparent or `--surface`, 1px border, small radius).
3. **Typography:** titles `font-weight:500` (NOT 700), tight letter-spacing. Micro-meta is UPPERCASE, `letter-spacing:0.6–2px`, `font-variant-numeric:tabular-nums`, `color:var(--text-faint)`. Example: `30 DAYS · SOFT · BEGINNER`.
4. **No colorful emoji anywhere.** Replace every emoji with a Tabler **outline** line icon (see §3). This includes section headers, stat labels, badges, banners, buttons.
5. **Square ghost checkboxes** (3px radius, `1.5px solid var(--text-faint)`); checked = solid `var(--accent)` with dark-ember check glyph (`color:#2a1206`).

### Icons — Tabler outline webfont
Loaded in `index.html`: `@tabler/icons-webfont@3.31.0` (jsdelivr). Usage: `<i class="ti ti-NAME"></i>` (monochrome, inherits `color` and `font-size`). **Outline only** — never `-filled` variants. Verify a name renders (missing icons render blank).
- Helpers already defined in app.js (reuse them):
  - `CHALLENGE_ICON` — `{ templateId: "ti-..." }` map for all challenges.
  - `CATEGORY_ICON` — `{ movement, endurance, health, expedition }` fallback.
  - `challengeIcon(t)` — returns the icon for a template object (use for any challenge/template).
  - `TIER_ICON` — `{ common:"ti-award", uncommon:"ti-award", rare:"ti-medal", epic:"ti-medal-2", legendary:"ti-trophy" }`.
  - `stripBadgeEmoji(label)` — strips a leading emoji token from a string (badge labels embed an emoji prefix).
- Common icons used: `ti-run ti-walk ti-bike ti-barbell ti-mountain ti-trekking ti-stairs ti-kayak ti-road ti-swimming ti-stopwatch ti-medal ti-trophy ti-award ti-flame ti-bolt ti-target ti-map-2 ti-heart-rate-monitor ti-droplet ti-moon ti-bed ti-check ti-chevron-right ti-alert-triangle ti-world ti-diamond ti-checkbox ti-clock`.

### CSS convention (IMPORTANT)
All new Field CSS is **appended at the END of `style.css`** under a header comment, so overrides win by cascade order. Example block format:
```css
/* ── Endur · Field — <area name> ─────────────────────────────────────────── */
.some-class { ... }
```
Use `!important` only where overriding deep existing rules (as the existing Field blocks already do). Reuse the established classes where possible: `.cl-row/.cl-list/.cl-cat/.cl-cat-name/.cl-cat-count/.cl-chip/.cl-ic/.cl-name/.cl-meta/.cl-go` (list rows), `.hero-daycount/.hero-titlebar/.hero-ic/.hero-name/.hero-stats` (hero), `.badge-ic/.cat-ic/.stat-ic`, `.journey-track/.journey-fill`.

---

## 3. What is ALREADY done (match this — don't redo)

- **Branding/theme:** App renamed Conqur→Endur. The 9 old "journey themes" were removed and collapsed to a single identity; `JOURNEY_THEMES.endur` holds the Norseman level names (Lv1 Recruit → Lv24 Black Shirt → Lv25 Norseman). The theme picker + settings switcher are gone. Palette is the ember one above. **Do not reintroduce themes.**
- **Global color fix:** all old hardcoded purple `rgb(180,79,255)` / pink `rgb(255,79,163)` were replaced with ember. If you find any leftover bright theme colors, convert to ember.
- **No habits/expeditions split:** the Challenges tab is ONE unified active-challenges list; the browser shows Expeditions as a normal inline category (`orderedCats = cats`). **Keep it unified — never reintroduce sub-tabs.**
- **"Habits" wording purged** from UI → "Tasks" (section labels, buttons, validation). The internal data field is still named `habits:` — **leave the code field alone**, only change user-facing strings.
- **Field-applied screens (already done, use as templates for the rest):**
  - `renderBuilderTemplates()` — the challenge **list** (`.cl-*` classes). This is the canonical Field reference.
  - `renderToday()` — single-challenge hero + habit rows (square ghost checkboxes).
  - `renderBadges()` + `renderBadgeCat()` + `renderBadgeSheet()` — tier line icons, monochrome.
  - `renderBuilderQuickstart()` — "Ready to Start?" screen.
  - `renderObGoal()` — onboarding goal cards.
  - `renderChallengeCard()` + `renderChallengeDetail()` — line icon, no tier color, ember stat icons.

---

## 4. What REMAINS — your task list (work top to bottom, verify each)

1. **`renderTodayAll(active)`** — the aggregated "All Active Challenges" view (shown when `todayChallengeId === "__all__"`). Its mini challenge cards still use `c.emoji` and old styling. Convert to line icons (`challengeIcon`) + Field.
2. **Settings screen** (`renderSettings` / settings panel) — replace emoji, Field-ify toggles. The **mode selector** (`.mode-selector` pill toggle with gradient active) should become a flat Field square toggle (ember active, no gradient). Same for any other pill toggles.
3. **Completion screens / modals** (`renderCompletion*`, day-complete banner, `renderCompleteBanner`) — emoji → icons, flat ember.
4. **`renderLevelProfile()`** — the XP "level road" (the row of level numbers + the level-up visuals). Replace flame/emoji, Field-ify the road.
5. **Onboarding hero + slides** — `renderObHero()` uses `theme.featureIcons` (`🏔️ ⏱️ 🔥 🔒`); the `.ob-emoji` big header on each slide and `renderObSlide()` use emoji. Convert all to line icons. (`renderObGoal` is already done — copy its approach.)
6. **Detail task breakdown** — the per-task rows in `renderChallengeDetail` (week/calendar/task list) still show the small habit emoji (`h.emoji`). Hide or replace with a neutral marker, consistent with how `renderToday()` hides `.habit-emoji`.
7. **Personal bests / trophy case** (`pbCard`, `renderPersonalBests`, `renderTrophyCase`) — `✅ ⚡ 🏆` etc → line icons.
8. **Banners & misc emoji** — new-week banner (`🗓`), boss-day callout (`⚡`), notif nudge (`🔔`), backup nudge, day-plan banner (`sched.emoji`), share/canvas card. Sweep `app.js` for remaining emoji in template strings and convert.
9. **Progress ring decision** — `renderRing()` draws a circular SVG ring on the Today screen (a holdover from an earlier mockup). The approved "Field" look (mockup A) used a **thin linear ember bar**, not a ring. **Ask the user** whether to keep the ring (already ember/clean) or replace it with a linear bar. Don't change it unilaterally.
10. **`TIERS` bright colors** — `TIERS` still defines WoW-style colors (green/blue/purple/gold). They're no longer rendered in badges, but may surface elsewhere (e.g. status colors). When you find tier color rendered as text/border, desaturate to monochrome + ember.
11. **Optional:** colloquial "habit" mentions remain in some template **description** data strings (e.g. "build the habit"). Low priority; reword only if the user asks.

### How to find remaining emoji
Sweep for emoji in user-facing strings:
```bash
grep -nP "[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE0F}]" app.js
```
For each hit in rendered HTML/copy, replace with the apt `<i class="ti ...">` or remove. (Skip matches inside comments or non-rendered data you've been told to leave.)

---

## 5. Workflow & guardrails

- **Make small, verifiable changes.** After each screen: serve, clear SW (snippet in §1), reload, **check the console for errors**, and screenshot/inspect the screen. Do not batch many screens without verifying.
- **Match existing patterns exactly** — appended CSS blocks, `<i class="ti ...">` icons, `var(--accent)` for ember, weight 500 titles, uppercase tabular meta.
- **Never** reintroduce: themes, the habits/expeditions sub-tabs, gradients, colorful emoji, bright tier colors, or the word "habits" in UI copy.
- **Don't rename** the internal `habits:` data field or break logic. Only touch presentation + user-facing strings.
- `esc()` escapes user content; helpers like `statCard()` and badge category labels render **raw HTML**, so you can embed `<i>` icons in their label arguments.
- Keep diffs minimal and readable; don't reformat untouched code.
- When unsure between two visual options (e.g. the ring), **ask the user** rather than guessing.

### Definition of done
Every screen and modal in the app uses the Field language: monochrome + ember, line icons (no emoji), hairline/flat surfaces, weight-500 titles with uppercase tabular meta, square ghost checkboxes — and the console is error-free on every screen.
