# Deploying the web app to DSCOVR.live (Vercel)

The Expo app exports as a static web build (`web.output: "static"`), one HTML
file per route. `mobile/vercel.json` carries the build + routing config. These
are the steps that need a human — accounts and DNS I can't touch.

## 1. Get the repo on GitHub (one-time)

Vercel deploys from GitHub. Create a repo (private is fine) and push:

```bash
git remote add origin https://github.com/<you>/dscovr.git
git push -u origin main        # or push the current branch and open a PR
```

This also unlocks CI for the test harnesses (`npm test`, `npm run test:taste`)
and lets the nightly sync move off your laptop to a GitHub Action later.

## 2. Import into Vercel

New Project → import the repo, then set:

- **Root Directory:** `mobile`  ← important; the app isn't at the repo root.
- Framework Preset: **Other** (vercel.json already sets build/output).
- **Environment Variables** (from `mobile/.env` — all three are public
  `EXPO_PUBLIC_` values, safe to put in Vercel):
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`

Deploy. You'll get a `*.vercel.app` URL — confirm the app loads there before
wiring the domain.

## 3. Add the domain

Vercel → Project → Settings → Domains → add `dscovr.live` (and `www` if you
want it). Vercel shows the exact DNS records to create — typically an `A` record
for the apex to Vercel's IP and a `CNAME` for `www`. Paste those at your
registrar. Propagation + auto HTTPS take a few minutes.

## 4. Register the production Spotify redirect

Once the site is at `https://dscovr.live`, the app derives its OAuth redirect
from the origin, so it will send `https://dscovr.live/spotify-callback`. Add that
exact string to the Spotify app's Redirect URIs (Settings → Redirect URIs → Save).

A real HTTPS origin retires the local `127.0.0.1` workaround — no code change,
the redirect URI is computed at runtime.

## 5. Transactional email (custom SMTP) — do before real launch

Sign-up uses Supabase Auth, which emails a confirmation link. Out of the box
that goes through **Supabase's built-in email sender, which is capped at ~2–4
emails per hour across the whole project** and is labelled "for testing only."
It is shared, not per-user, so a couple of testers exhaust it and the next
person sees **"email rate limit exceeded."** This is config, not code — the
`signUp` call needs no change.

The fix is to point Supabase Auth at a real email provider over SMTP. Resend's
free tier (3,000/month, 100/day) is enough to launch on.

1. **Resend account + domain.** Sign up at resend.com → **Domains → Add
   Domain → `dscovr.live`**. Resend shows an **MX**, an **SPF** (TXT) and a
   **DKIM** (TXT) record, generated per-domain.
2. **Add those DNS records** wherever `dscovr.live`'s DNS lives — the same
   place as the records in step 3 above (Vercel → Domains if the nameservers
   point at Vercel, otherwise the registrar). Then hit **Verify** in Resend.
   Sending from your own domain is what keeps the mail out of spam; the
   default Supabase sender gets filtered.
3. **API key.** Resend → **API Keys → Create**, copy the `re_…` value — it's
   the SMTP password.
4. **Supabase → Authentication → Emails → SMTP Settings**, enable custom SMTP:

   | Field | Value |
   | --- | --- |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the `re_…` API key |
   | Sender email | `no-reply@dscovr.live` |
   | Sender name | `DSCOVR` |

5. **Raise the limit.** Authentication → Rate Limits → bump **email** up from
   the default ~4/hr (a few hundred/hr is safe once real SMTP is behind it).

The DKIM/domain verification in step 2 is the step that usually stalls —
almost always because the records went to the wrong DNS host (registrar vs.
Vercel). A failed sign-up can also leave a half-created unconfirmed user;
delete it under **Authentication → Users** if the email later reads as taken.

Alternative for testing only: **Authentication → Providers → Email → turn off
"Confirm email."** Sign-up then returns a session with no email sent, so the
limit can't be hit — but anyone can register an address they don't own, so
re-enable it (with SMTP configured) before launch.

## 6. Still pending

- Nothing blocking: migrations are applied through **0018** as of this writing
  (`npx supabase migration list` shows local/remote parity). Re-check after
  writing any new migration.

## Notes

- `vercel.json` rewrites `/event/:id` → the exported `/event/[id]` shell so deep
  links to a specific event resolve; `cleanUrls` serves `/explore` etc. without
  `.html`. If a deep link 404s after the first deploy, that rewrite is where to
  look.
- Rebuilds happen automatically on every push to the connected branch.
