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

## 5. Still pending

- **Migration 0010** (friends) isn't applied yet: `npx supabase db push`.

## Notes

- `vercel.json` rewrites `/event/:id` → the exported `/event/[id]` shell so deep
  links to a specific event resolve; `cleanUrls` serves `/explore` etc. without
  `.html`. If a deep link 404s after the first deploy, that rewrite is where to
  look.
- Rebuilds happen automatically on every push to the connected branch.
