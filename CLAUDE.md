# DSCOVR

EDM event discovery: a Node data pipeline ingests events from Ticketmaster and
Relentless Beats into Supabase (Postgres), and an Expo app in `mobile/` reads
them. Repo root is the pipeline; `mobile/` is a separate npm project.

## Layout

| Path | What |
| --- | --- |
| `DSCOVR.js` | Ticketmaster ingestion, loops every active `markets` row |
| `relentless-beats-scraper.js` | Relentless Beats scraper (cheerio) |
| `resident-advisor-scraper.js` | Resident Advisor ingestion via ra.co GraphQL, per-market by area id |
| `insomniac-scraper.js` | Insomniac ingestion — listing → per-event schema.org JSON-LD |
| `spotify-vibe-check.js` | Enrichment: backfills spotify/deezer ids + genre_tags |
| `supabase/migrations/` | Schema, numbered `NNNN_*.sql` |
| `supabase/functions/vibecheck/` | Edge function, resolves preview audio on demand |
| `mobile/` | Expo Router app |

Scripts: `npm run sync:ticketmaster`, `sync:spotify`, `scrape:relentlessbeats`,
`scrape:ra` (Resident Advisor — optional `<market-slug>` arg limits to one).

RA is the underground/independent-promoter source Ticketmaster misses. ra.co's
HTML is Cloudflare-gated, but its GraphQL endpoint answers directly; the scraper
maps each market to an RA "area" id (`RA_AREA_BY_MARKET`) and pages its
`eventListings`. Adding a market is one line. RA returns naive local datetimes,
so — like the rest of the pipeline — parse the parts by hand, never via `Date`.

Insomniac is the big-promoter source (festivals + Factory 93 / Day Trip club
nights) that mostly sells off Ticketmaster. Its /events archive is Cloudflare-
gated but server-rendered; each card links to an insomniac.com/events/{slug}
detail page whose slug carries the local date + city and which embeds a
schema.org MusicEvent JSON-LD (real venue/time/lineup) — same shape as the RB
scraper. `CITY_TO_MARKET` maps its cities (suburbs fold into the metro). Known
gap: a few marquee festivals link to their own ticketing domains (no
insomniac.com detail page), so they're skipped — revisit with card-level parsing
if a coverage gap shows up.

## The pipeline is two-stage

Ingestion and enrichment are separate passes, and this trips people up:

1. **Ingest** (`DSCOVR.js`) upserts an artist with only `name` plus a
   deterministic `soundcloud_url` *search* link — never a verified profile.
   That is why `soundcloud_url` is ~100% populated and means nothing.
2. **Enrich** (`spotify-vibe-check.js`) fills `spotify_id`/`spotify_url`/
   `genre_tags`/`deezer_id` via API lookup, and only matches some artists.

So a new market's artists have no Spotify links until the enrichment pass is
run again. If Spotify links are missing for a city, the fix is almost always
"run `npm run sync:spotify`", not a code change. Its work queue is
`WHERE deezer_id IS NULL`.

**Known bug:** `findSpotifyArtist()` returns `exactMatch ?? candidates[0]`, so
a name with no exact match silently links to Spotify's first guess. ~8% of
artists are wrong this way — local DJ "Donk" resolves to Beyoncé, the venue
"Hamburger Mary's" to a baroque ensemble. Full coverage therefore does not mean
correct data, and Vibe Check plays the wrong audio for those rows. Fix the
matcher before automating this script.

Enrichment stores permanent ids, never preview URLs — Spotify killed
`preview_url` for API apps and Deezer's previews expire in hours. Playback
resolves a fresh URL at request time via the `vibecheck` edge function.

## Testing migrations

There is **no local database**: no `config.toml`, no Docker, so `supabase start`
cannot run. The linked project is production. To avoid "test by applying to
prod", `npm test` runs every migration against PGlite (Postgres compiled to
WASM) with a stubbed `auth` schema, then exercises the functions:

    npm test          # supabase/tests/migrations.test.mjs

Write the test alongside the migration. Two traps it exists to catch, both of
which produced false passes on the way in:

- The stub **must** replicate Supabase's `ALTER DEFAULT PRIVILEGES ... GRANT ALL
  ON TABLES TO anon, authenticated`. Without it every "secrets are withheld"
  assertion passes vacuously, because PGlite grants nothing by default.
- Assert privileges by `SET ROLE anon` and *attempting the read*, not by
  querying `information_schema`. And it is `SET ROLE`, not `SET LOCAL ROLE` —
  outside a transaction the latter silently does nothing and every check then
  runs as superuser, which bypasses RLS and privileges entirely.

PGlite is PG18; production is PG17. Close enough for syntax and logic, not a
guarantee about Supabase's own auth internals.

## Schema notes

`markets -> venues -> events -> lineups -> artists`. Natural keys carry the
upsert logic, so respect them: `artists.name`, `venues.name`, and
`markets.slug` are UNIQUE; events are unique on `(venue_id, title, event_date)`
and lineups on `(event_id, artist_id)`.

User-side (0006-0008): `profiles` mirrors `auth.users` via an AFTER INSERT
trigger; `friendships` and `event_attendance` hang off `auth.users`;
`user_favorite_genres` / `user_favorite_artists` cache the Spotify taste
profile. Functions: `get_personalized_recommendations`, `get_filtered_events`,
`timeframe_window`, `vibes_for_tags`, plus the `event_vibes` view.

**RLS is row-level, not column-level.** `profiles` is publicly readable, so the
phone and Spotify tokens are held back with column privileges instead — and the
table-level grant has to be revoked *first*, because Postgres will not let a
column-level REVOKE override a table-level grant that implies it. A consequence
worth knowing: `select=*` on profiles is refused for `anon`, so clients must
name columns. `role` is deliberately not client-writable or a user could
promote themselves to admin.

Ingestion sends only the columns it owns so it can never clobber enrichment's
fields on re-run. Keep it that way when adding columns.

`event_date` is the show's **local calendar date** and `doors_time` a bare
Postgres TIME — neither has a timezone. Never route either through `Date`
parsing or `toISOString()`; near midnight UTC that shifts the day. See
`todayDateString()` in `use-events.ts` and `formatEventTime()` in
`format-date.ts`, which both parse the parts by hand.

Always give feed queries a total ordering. `event_date` alone leaves same-day
shows unordered, Postgres returns them differently per refetch, and the feed
reshuffles under the user's finger onto the wrong card.

## Mobile

Expo Router, `src/app/`, path alias `@/` -> `src/`. Routes: `(tabs)` group for
the tab screens, root `_layout.tsx` owns a Stack so `event/[id]` pushes over
the tabs.

**The tab bar differs per platform, and this is where bugs hide.**
`app-tabs.tsx` uses `NativeTabs` along the bottom; `app-tabs.web.tsx` (the
`.web.tsx` suffix swaps it at bundle time) renders a floating pill pinned to
the *top* that also carries the DSCOVR brand. Consequences:

- `BottomTabInset` is 0 on web by design. Web content instead clears the pill
  with `paddingTop: Spacing.six` — see `explore.tsx` and `index.tsx`.
- The pill already brands the app, so the Home heading is native-only.
  Rendering a brand on both duplicates it under the `position: absolute` pill.

Share Supabase selects via `EVENT_SELECT` in `lib/queries.ts` so the feed and
detail queries cannot drift from each other or from `EventWithDetails`.

Verify with `npx tsc --noEmit` (no test suite). Checking the app in a browser
works, but the in-app preview pane's viewport emulation paints stale frames
after a resize — a ghost copy of the UI is the tool, not a bug. Reload clears it.

## Secrets

Root `.env` holds `SUPABASE_SERVICE_ROLE_KEY` (privileged — pipeline writes)
and Ticketmaster/Spotify keys. `mobile/.env` holds `EXPO_PUBLIC_*` vars, which
are baked into the client bundle and are public by design, gated by RLS.
