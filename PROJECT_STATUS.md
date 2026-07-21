# DSCOVR — project status

A handoff snapshot for planning what comes next. Written 2026-07-17.

---

## What it is

EDM event discovery. A Node pipeline ingests events into Supabase (Postgres); an
Expo app reads them. Live at **https://www.dscovr.live** (Vercel, auto-deploys
from `main` on GitHub at `iahmed92/dscovr`).

**Stack:** Expo / React Native (web + native targets, `mobile/`) · Supabase
(Postgres + Auth + RLS) · Vercel · Node ingestion scripts at repo root.

---

## What works today

**Data pipeline**
- Ticketmaster ingestion + a Relentless Beats scraper, ~520 upcoming events
- Spotify enrichment resolves artist ids and `genre_tags`
- Mixcloud enrichment resolves each artist's latest set (~29% coverage)
- Nightly Windows scheduled task at 04:00 runs ingest → scrape → enrich, in that
  order (enrichment last, so artists ingested tonight get links tonight)

**App**
- Feed as a Luma-style timeline: events grouped under day headings with a left
  rail, compact cards with a square thumbnail
- Filters as three dropdowns — city (grouped by state), date, genre — plus a
  Festivals toggle
- Event detail: flyer, venue with Maps link, lineup with per-artist preview
  playback, Spotify, YouTube live-set search, Mixcloud set where resolved
- Email auth, "Going" attendance, a rave resume of saved shows
- Spotify OAuth (PKCE) builds a taste profile → personalized recommendations
  that explain themselves ("Because you like Dirt Monkey")
- Friends: request/accept, and "N friends going" on an event
- Outbound ticket-click tracking

**Engineering**
- 17 migrations, all applied to production
- `npm test` runs every migration against PGlite (Postgres as WASM) with a
  stubbed auth schema, then exercises triggers, RLS, privileges and functions.
  There is **no local database**, so this harness is the only thing standing
  between a migration and production.
- GitHub Actions runs the harness, a Spotify taste unit test, and a mobile
  typecheck on every push

---

## Known gaps

Ordered by how much they'd hurt.

1. **Native is completely untested.** Every verification has been on web. The
   tab bar has a separate native implementation (`app-tabs.tsx` vs
   `app-tabs.web.tsx`) and that split is historically where bugs hide here.
2. **Friends has never been exercised with two real accounts.** Built, migrated,
   and unit-tested against PGlite — never used by two humans.
3. **No search.** You cannot look up an artist, venue or event.
4. **No sharing.** No way to send someone an event, which is how an app like
   this actually spreads.
5. **No onboarding.** New users land cold on a feed.
6. **No notifications.** Nothing brings a user back — no "your artist just
   announced", no presale reminder.
7. **~50% of events carry no genre.** `genre_tags` only exist where Spotify
   matched, so genre filters hide a lot. The "Other" bucket makes them
   reachable but doesn't classify them.
8. **Festival flags are curated, not computed.** No rule survived the data
   (keywords catch 6 of 518; Decadence has 0 artists booked). 13 are flagged by
   hand-corrected heuristic and will drift as new events arrive.
9. **Recommendations favour festivals** — a stacked lineup outscores a single
   favourite artist, by construction.

---

## Monetization — where it stands

The asset is intent data: who is going to which shows, plus real taste from
Spotify.

**Built:** outbound click tracking (`ticket_clicks`, `ticket_click_stats`) and
featured placement (`events.is_featured`, surfaced with a FEATURED label and
sorted first within its day, never jumping the calendar).

**The order that works:**
1. **Flat monthly featured placement.** Needs no attribution, easy to sell,
   already fulfillable with one `UPDATE`.
2. **Ticket affiliate** — Ticketmaster runs one, and we already deep-link there.
3. **Per-ticket rev-share, last.** It requires a promoter to share tracking
   links or conversion reports; no client-side code can see inside their
   checkout.

**Be careful:** selling user data would breach Spotify's developer terms and
lose the taste layer entirely. Treat it as off the table.

**Integrity caveat to state plainly in any pitch:** clicks are logged through a
SECURITY DEFINER RPC that stamps the user server-side and de-duplicates repeats,
so signed-in click counts are defensible. Anonymous clicks cannot be
de-duplicated — we deliberately store nothing identifying an anonymous visitor —
so `signed_in_users` is the number to quote, and total clicks stay advisory
until reconciled against a promoter's own reporting.

---

## Non-obvious things worth knowing

- **There is no local database.** The linked Supabase project *is* production.
  `supabase db push` writes to live data. The PGlite harness exists for exactly
  this reason.
- **`soundcloud_url` is a search link, not a profile.** SoundCloud closed public
  API registration years ago. That's why live sets go through Mixcloud +
  a labelled YouTube search instead.
- **Artist matching is strict on purpose.** An earlier fuzzy matcher linked
  local DJ "Donk" to Beyoncé and a venue to a baroque ensemble — 8% of links
  were wrong. Matching now requires a normalized name match and returns null
  otherwise. A wrong link is worse than none: the preview plays the wrong music.
- **RLS is row-level, not column-level.** Profiles are publicly readable, so
  phone and Spotify tokens are withheld with column privileges — and the
  table-level grant must be revoked *first*, or the column revoke is decorative.
  Consequence: `select=*` on profiles fails; clients must name columns.
- **`event_date` is a bare calendar date and `doors_time` a bare TIME.** Never
  route either through `Date` parsing or `toISOString()` — near midnight UTC it
  shifts the day.
- **Feed queries need a total ordering.** `event_date` alone leaves same-day
  shows unordered and the list reshuffles between fetches, so a tap lands on the
  wrong card.
- **Spotify redirect URIs must match the origin exactly.** The app derives its
  redirect from wherever it's served. `www.dscovr.live` and `dscovr.live` are
  different origins, and Spotify rejects `localhost` (use `127.0.0.1`).

---

## Suggested next moves

**To make it retain users:** search, sharing, and notifications are the three
missing pieces that turn a directory into something people come back to.
Notifications are the highest leverage and the most work.

**To make it sellable:** it already is — featured placement works. The gap is
audience. Click data is only persuasive once real people generate it.

**To reduce risk:** test native, and exercise friends with two accounts. Both
are unknowns that will surface at the worst time otherwise.

**The strategic question worth deciding:** is DSCOVR a web app with a domain, or
a native app with a landing page? Everything is verified on web today, and the
native target is entirely unexplored. That choice shapes notifications, the
onboarding flow, and whether App Store review ever enters the picture.
