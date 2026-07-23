# DSCOVR — planning brief for Claude

Paste the block below into a fresh Claude chat to continue product/technical
planning with full context. Fill in `[TODAY'S TOPIC]` at the bottom each time.

---

I'm building DSCOVR, an EDM event-discovery app that is LIVE at dscovr.live. Help me PLAN features, architecture, and workflow — don't write code (my repo is on another machine while I travel). Keep me at planning altitude and ask sharpening questions.

WHAT IT IS
A Node pipeline ingests events into Supabase (Postgres); an Expo (React Native) app reads them. Web is live on Vercel; the same Expo codebase becomes the native iOS/Android app — a build step, not a rewrite.

EVENT SOURCES (all live) — ~4,400 upcoming events total
- Ticketmaster (API): major venues/festivals (~1,720)
- Resident Advisor (~2,600, via their GraphQL, per-market by "area"): underground/independent/club
- Insomniac (scraper reading schema.org JSON-LD off detail pages): big-promoter concerts + club nights
- Relentless Beats: one AZ promoter
There's no single source of EDM events — aggregation is the moat.

WHAT'S LIVE
Feed across 22 US markets (city/date/genre filters, festivals toggle, deep-linkable pages); email auth with chosen usernames; Spotify taste import to "For You" recs (rate-limit hardened); social/viral loop (friends by username or phone, "Going" RSVPs, Rave Resume, referral links that offer to connect you with the inviter, avatar stacks, SMS invites); monetization surfaces (VIP/table lead capture, featured placement, ticket click tracking + attribution).

ARCHITECTURE CONSTRAINTS
- Supabase Postgres + row-level security; sensitive columns (phone, Spotify tokens) are write-but-not-read
- The linked Supabase project IS production; migrations tested via an in-process PGlite harness (no local DB)
- Spotify PKCE (no secret); their terms forbid SELLING Spotify-derived data, and require Extended Quota (privacy policy + review) beyond 25 users
- Contacts import + push notifications need the native app; the matching backend already exists

OPEN THINGS TO PLAN (pick one per session)
- Feed ranking/curation: RA now dominates (~2,600 events) — how to balance sources, relevance, and freshness so users see what they care about, not 300 club nights first
- Insomniac festival-card capture: marquee festivals (HARD Summer, EDC) link to their own ticketing domains with no detail-page JSON-LD, so they're missed — design a card-level parse
- Cross-source deduplication (natural key is venue + title + date)
- Native app: EAS build to TestFlight to App Store (needs branded icon + privacy-policy page)
- Promoter portal: promoters self-submit events (free distribution) + pay for featured placement/tracking — solves coverage AND monetization
- Monetization activation: Stripe billing, promoter tracking dashboard, featured-event sales
- Push notifications (friend going, artist booked, weekend digest)

Help me think through: [TODAY'S TOPIC]. Ask questions where it sharpens the plan.
