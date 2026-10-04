# Cloud sync setup (Supabase)

VYRA works fully offline. Accounts are optional: when someone signs in, their
workouts, settings and plan progress sync across devices. Until `config.js` has
values, sign-in is hidden and nothing leaves the device.

**Backend:** Supabase (US region), free tier.
**Sign-in:** email (magic link + 6-digit code) and Google.

## 1. Create the project (≈5 min)

1. Go to <https://supabase.com>, sign up, and create a **New project**.
   - Name: `vyra`
   - Region: **East US (North Virginia)** or **West US (Oregon)**
   - Save the database password somewhere safe (you won't need it for the app).
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and
   press **Run**. It creates the tables and the rules that keep each person's data
   private. It's safe to run again.

3. **Competition (leaderboards):** open another **New query**, paste the whole of
   `supabase/002_competition.sql`, and press **Run**. It adds athlete profiles,
   benchmark results and the leaderboard. Safe to run again. Supabase may warn
   about "destructive operations": that's the `drop policy if exists` /
   `drop trigger if exists` lines, which only replace VYRA's own rules.

4. **Community (following, feed, comments):** one more **New query** with
   `supabase/003_community.sql`, then **Run**. Run it after `002_competition.sql`.

All three files are tested against a real Postgres database on every push
(`npm run test:sql`, see `tests/sql/`).

## 2. Connect the app

1. Open **Project Settings → API** (also shown under **Connect**).
2. Copy the **Project URL** and the **anon public** key into `config.js`:

   ```js
   window.VYRA_CONFIG = {
     supabaseUrl: "https://abcdefgh.supabase.co",
     supabaseAnonKey: "eyJhbGciOi…",
   };
   ```

   The anon key is meant to be public. Never put the `service_role` key in the app.

## 3. Sign-in settings

**Authentication → URL Configuration**

- **Site URL:** your live address, e.g. `https://animated-babka-e7f528.netlify.app`
- **Redirect URLs:** add the live address and, for local testing,
  `http://localhost:8777`

**Authentication → Emails → Templates → Magic Link.** Add the code so people
using the installed app on iPhone can type it (links open in Safari, outside the
app). Replace the body with:

```html
<h2>Sign in to VYRA</h2>
<p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
<p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
```

**Email sending.** Supabase's built-in email is rate-limited and meant for testing.
Before launch, add your own SMTP under **Authentication → Emails → SMTP Settings**
(Resend, Postmark or Amazon SES all work).

## 4. Google sign-in

1. In <https://console.cloud.google.com>, create a project, then
   **APIs & Services → OAuth consent screen**: External, app name "VYRA", your
   support email, and your domain.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized JavaScript origins: your live address (and `http://localhost:8777`)
   - Authorized redirect URI: `https://<your-project>.supabase.co/auth/v1/callback`
     (Supabase shows the exact value under Authentication → Providers → Google)
3. Copy the **Client ID** and **Client secret** into Supabase:
   **Authentication → Providers → Google → Enable**.

## How sync works

- **Local-first:** the app reads and writes `localStorage`; sync runs in the
  background after changes, when the app opens or regains focus, and when the
  connection returns.
- **Workouts** merge one by one, and the newest edit wins. Deleting a workout leaves a
  tombstone so other devices remove it too.
- **Settings** (goal, level, equipment, workout settings, swaps, plan progress):
  whichever device changed them last wins. On a device's first sign-in, the
  account's existing settings replace that device's defaults.
- **Sample data** never uploads.
- **Sign out** keeps workouts on the device. **Delete account** removes the cloud
  copy and the login; the device keeps its workouts.
- Devices pull changes by server time, so a phone with a wrong clock can't hide
  its changes from other devices.

Merge rules: `core.js` (`mergeRemoteWorkouts`, `pendingWorkoutRows`), tested in
`tests/sync.test.js`. Network code: `sync.js`.

## Later: paid plans

The data model is ready for paid features without migration: add a
`subscriptions` table keyed by `user_id` (fed by a Stripe webhook through a
Supabase Edge Function) and check it before unlocking premium programs or
template packs.

## Leaderboards and privacy

- Athlete profiles start **private** and **off** the leaderboards. Athletes opt in
  under Profile → Athlete profile.
- Results are stored in `attempts`, which no other user can read directly. The
  `leaderboard()` function returns only opted-in athletes, and only their display
  name, best score and rank.
- Athletes can't mark their own results as verified; a database trigger
  downgrades that to "community". Verification (video review) is Phase 3.
