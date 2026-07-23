# DSCOVR — planning brief for Claude

Paste the block below into a fresh Claude chat to continue product/technical
planning with full context. Fill in `[TODAY'S TOPIC]` at the bottom each time.

---

I'm building DSCOVR, an EDM event-discovery app that is LIVE at dscovr.live. I want your help PLANNING features and workflow — not writing code (my codebase is on another machine while I travel). Keep me at the planning altitude.

WHAT IT IS
A Node pipeline ingests events from Ticketmaster, Relentless Beats, and Resident Advisor into Supabase (Postgres), enriches artists with Spotify taste data, and an Expo (React Native) app reads them. Web is live on Vercel; the SAME Expo codebase becomes the native iOS/Android app — it's a build step, not a rewrite.

WHAT'S LIVE NOW
- Discovery feed across 22 US markets; city/date/genre filters; festivals toggle; deep-linkable event pages; dark "Luma-style" design
- Email auth with user-chosen usernames; real transactional email (Resend + DMARC)
- Spotify OAuth taste import → "For You" recommendations (hardened against rate-limit spikes)
- Social/viral: friends by username OR phone number; "Going" RSVPs; "Rave Resume" history; referral share links that offer to connect you with the inviter; friend avatar stacks; SMS "text friends" invites
- Monetization surfaces: VIP/table-service lead capture (live); featured-event placement; tamper-proof ticket click tracking; referral attribution on ticket links

EVENT SOURCING (the core coverage problem)
There's no single source of EDM events; aggregation is the moat. Live sources: Ticketmaster (major venues/festivals, API), Relentless Beats (one AZ promoter), and Resident Advisor (underground/independent/club, via their GraphQL, mapped per market by "area"). Still missing: the long tail of independent promoters. The strategic answer is a PROMOTER PORTAL — promoters self-submit events for free distribution and pay for featured placement + tracking — which solves coverage AND monetization at once. Also viable: more per-source scrapers (DICE, Shotgun, Eventbrite) and artist-based backfill (Bandsintown/Songkick per known artist). Hard parts to plan: deduplication across sources (natural key is venue+title+date), scraper brittleness, and per-source legal/ToS.

ARCHITECTURE FACTS THAT CONSTRAIN PLANNING
- Supabase Postgres + row-level security; sensitive columns (phone, Spotify tokens) are write-but-not-read by design
- The linked Supabase project IS production; migrations are tested via an in-process PGlite harness (no local DB)
- Spotify uses PKCE (no secret). Spotify's terms FORBID selling Spotify-derived data to third parties, and require "Extended Quota" (privacy policy + review) for public use beyond 25 users
- Contacts import + push notifications require shipping the native app; the matching backend already exists

WHAT'S NEXT (roadmap)
1. Native app: first EAS cloud build → TestFlight → App Store (Apple Developer account in hand); needs a branded icon + a privacy-policy page
2. Event coverage: promoter portal; add DICE/Shotgun/Eventbrite scrapers; dedup layer
3. Revenue: promoter tracking dashboard, featured-event sales + Stripe billing, promoter business development
4. Growth/retention: push notifications, referral analytics, more markets

Help me think through: [TODAY'S TOPIC]. Ask me questions where it would sharpen the plan.
