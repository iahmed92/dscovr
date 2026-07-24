-- Seeded public profiles + private view tracking.
--
-- The pages exist publicly before anyone claims them, so a link to a
-- promoter's own page — already populated with their own events, because
-- aggregation came first — is a sales asset, not an invitation to do data
-- entry. This is why publication is a curated column flip, not automatic.
--
-- ---------------------------------------------------------------------------
-- What is NOT decided by this migration — flagged, not silently chosen
-- ---------------------------------------------------------------------------
--
-- The app is a pure static export (web.output: "static" in app.json) served
-- through Vercel rewrites with no per-request server code anywhere today —
-- confirmed empirically: curl-ing a nonexistent event id right now returns
-- HTTP 200 with an empty shell, and only the CLIENT decides "not found" after
-- JS runs. So "status = 'draft' returns a real 404" (acceptance criterion 1)
-- cannot be satisfied by this migration alone, or by the route component
-- alone — it needs a decision about where a REAL HTTP 404 comes from, which is
-- an infrastructure/cost question, not a data question. promoters_publishable
-- below is exactly the shortlist a build-time static-page generator would
-- consume for that; see the accompanying message for the options.
--
-- ip_hash is present per the brief but is always NULL from the plain-insert
-- path built here: a static SPA calling PostgREST directly has no reliable
-- access to the caller's real IP (no header-GUC or request-IP mechanism is
-- verified to exist on this project, and guessing one exists here would be
-- the same mistake as the exactMatch ?? candidates[0] fallback — assuming a
-- convenient answer instead of checking). Left NULL and documented rather
-- than populated from a guess. If it's wanted for real, this project already
-- has the right precedent for it: a Supabase Edge Function (see
-- supabase/functions/vibecheck/) can see the real request and hash the true
-- IP; a follow-up, not silently built here.

-- ---------------------------------------------------------------------------
-- promoters: publication state
-- ---------------------------------------------------------------------------

ALTER TABLE promoters ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE promoters ADD CONSTRAINT promoters_status_check
    CHECK (status IN ('draft', 'published', 'claimed'));

-- ---------------------------------------------------------------------------
-- promoters RLS: public only sees published/claimed rows
-- ---------------------------------------------------------------------------

-- 0015's policy is USING (true) — unconditional. RLS policies are OR'd
-- together, so adding a status-filtered policy alongside it would do nothing;
-- the old permissive one has to be dropped, not layered under.
DROP POLICY IF EXISTS "Allow public read access to promoters" ON promoters;

CREATE POLICY "Public can read published or claimed promoters" ON promoters
    FOR SELECT TO anon, authenticated
    USING (status IN ('published', 'claimed'));

-- The public profile page needs three columns 0015 didn't grant, because at
-- the time nothing public read them: `slug` (the page is queried by it —
-- PostgREST requires SELECT privilege on any column touched by a filter, not
-- just returned columns, so .eq('slug', ...) would fail without this),
-- `ingested_name` (the brief's "Promoter name (ingested)" — rendered
-- specifically instead of `name`, so this page shows exactly what the
-- pipeline extracted and stays correct even after Brief 4 lets `name`
-- diverge as a human-edited display value), and `status` itself (the page
-- has to tell 'published' apart from 'claimed' to render an honest
-- unclaimed-state label — showing "claim this" on an already-claimed page
-- would violate the brief's own "honest and unambiguous" requirement).
--
-- Deliberately NOT granted: `primary_market_id` — the page derives Market
-- from the promoter's actual live events instead (see the app query), which
-- can never drift stale the way a separately-stored id could.
-- `stripe_customer_id` / `owner_id` stay internal per 0015's original reasoning.
GRANT SELECT (slug, ingested_name, status) ON promoters TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- promoters_publishable — a shortlist for a human, not a trigger
-- ---------------------------------------------------------------------------

-- security_invoker so this view is subject to the SAME RLS/grants as whoever
-- queries it — it is read from the Supabase SQL editor as service role for
-- curation, never exposed to anon, but there's no reason to make it a
-- privilege-escalation surface if that ever changes.
CREATE OR REPLACE VIEW promoters_publishable WITH (security_invoker = true) AS
SELECT p.id, p.name, p.ingested_name, p.status,
       count(DISTINCT e.id) AS upcoming_event_count
FROM promoters p
JOIN events e ON e.promoter_id = p.id AND e.event_date >= CURRENT_DATE
JOIN venues v ON v.id = e.venue_id
WHERE p.status = 'draft'
  -- "a matched (not unmatched-alias-derived) name": the promoter must have at
  -- least one alias a human or resolve_promoter_alias() actually matched to
  -- it. Every events.promoter_id today can only ever have been set via a
  -- matched alias (0023 never sets it otherwise), so this is currently
  -- implied by the join above — asserted explicitly anyway, because the
  -- brief names it as its own criterion and this guards the invariant even
  -- if a future change adds another path onto events.promoter_id.
  AND EXISTS (
      SELECT 1 FROM promoter_aliases pa
      WHERE pa.promoter_id = p.id AND pa.status = 'matched'
  )
  -- "a resolved market": venues.market_id is nullable (ON DELETE SET NULL),
  -- so this is a real filter, not a formality.
  AND v.market_id IS NOT NULL
GROUP BY p.id, p.name, p.ingested_name, p.status
HAVING count(DISTINCT e.id) >= 2
ORDER BY count(DISTINCT e.id) DESC;

-- ---------------------------------------------------------------------------
-- promoter_profile_views — rows, not a counter
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS promoter_profile_views (
    id             BIGSERIAL PRIMARY KEY,
    promoter_id    INT NOT NULL REFERENCES promoters(id) ON DELETE CASCADE,
    viewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    outreach_token TEXT,
    visitor_hash   TEXT,
    ip_hash        TEXT,
    user_agent     TEXT,
    ua_class       TEXT NOT NULL DEFAULT 'unknown',
    referrer       TEXT,
    CONSTRAINT promoter_profile_views_ua_class_check
        CHECK (ua_class IN ('human', 'bot', 'link_preview', 'unknown'))
);

CREATE INDEX IF NOT EXISTS promoter_profile_views_promoter_idx
    ON promoter_profile_views (promoter_id, viewed_at DESC);
-- Supports "default reporting excludes bot/link_preview" without a full scan.
CREATE INDEX IF NOT EXISTS promoter_profile_views_reporting_idx
    ON promoter_profile_views (promoter_id, viewed_at DESC) WHERE ua_class = 'human';

-- classify_view_user_agent(): pure classification, no table access, so it can
-- run in a BEFORE INSERT trigger without recursion or extra round trips.
-- iMessage, WhatsApp, Slack, Discord and Twitter/X all fetch a shared link
-- SERVER-SIDE to build a preview card before any human opens it — since
-- outreach here is texting/DMing links to promoters, every send manufactures
-- phantom views on the exact day of the send, which would otherwise read as
-- "spiked interest" right when it's actually just the message being sent.
-- Signatures are the well-known, stable tokens each service's fetcher
-- identifies itself with.
CREATE OR REPLACE FUNCTION classify_view_user_agent(ua TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN ua IS NULL OR trim(ua) = '' THEN 'unknown'
        WHEN ua ~* '(facebookexternalhit|Twitterbot|Slackbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot|SkypeUriPreview|iMessage|redditbot|Google-InspectionTool|Pinterest)'
            THEN 'link_preview'
        WHEN ua ~* '(bot|crawl|spider|Googlebot|Bingbot|DuckDuckBot|AhrefsBot|SemrushBot|MJ12bot|YandexBot|facebookcatalog|python-requests|curl/|Go-http-client|Scrapy)'
            THEN 'bot'
        ELSE 'human'
    END;
$$;
-- No REVOKE here, deliberately: the BEFORE INSERT trigger below calls this
-- function while running AS THE INSERTING ROLE (it is not SECURITY DEFINER),
-- so anon needs EXECUTE for the trigger to fire at all — caught by the
-- harness, which failed with "permission denied for function
-- classify_view_user_agent" the moment RETURNING stopped masking it. Letting
-- anon also call this directly is harmless: it is a pure function with no
-- table access and no side effects, and the real security boundary is the
-- trigger overwriting NEW.ua_class unconditionally, not who can classify a
-- string in the abstract.

-- Server-authoritative classification: the RLS shape below is a direct anon
-- INSERT (matching the brief's literal "same pattern as phone numbers and
-- Spotify tokens"), which means the client sends the raw user_agent string but
-- must NOT be trusted to self-report its own ua_class — that would let
-- anything claim 'human'. This trigger recomputes it from user_agent on every
-- insert and overwrites whatever the client sent, the same "never trust a
-- client-asserted classification" instinct as log_ticket_click() refusing a
-- client-supplied user_id.
CREATE OR REPLACE FUNCTION set_view_ua_class()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.ua_class := classify_view_user_agent(NEW.user_agent);
    RETURN NEW;
END;
$$;

CREATE TRIGGER promoter_profile_views_classify
    BEFORE INSERT ON promoter_profile_views
    FOR EACH ROW EXECUTE FUNCTION set_view_ua_class();

-- Write-but-not-read, same shape as phone numbers and Spotify tokens: anon can
-- create a row, and can never read any back (their own or anyone else's) —
-- there is no owner-scoping identity to grant a narrower SELECT against
-- anyway, since visitors are virtually always signed out. No dedup, no rate
-- limit: repeat visits are explicitly a signal per the brief ("repeat token
-- hits are a buying signal"), not something to collapse the way
-- log_ticket_click() collapses a double-tap.
ALTER TABLE promoter_profile_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON promoter_profile_views FROM anon, authenticated;
GRANT INSERT (promoter_id, outreach_token, visitor_hash, user_agent, referrer)
    ON promoter_profile_views TO anon, authenticated;
GRANT USAGE ON SEQUENCE promoter_profile_views_id_seq TO anon, authenticated;

CREATE POLICY "Anyone can record a profile view" ON promoter_profile_views
    FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- outreach_tokens — operator bookkeeping, zero anon interaction
-- ---------------------------------------------------------------------------

-- A view row's outreach_token is stored verbatim from ?ref=<token> with no
-- validation against this table (per the brief: "a visit carrying ?ref=<token>
-- stores the token" — nothing conditions that on the token being real). So
-- this table never needs to be read by the client at all; it exists purely so
-- a human can look up "who did token abc123 go to" later.
CREATE TABLE IF NOT EXISTS outreach_tokens (
    id          BIGSERIAL PRIMARY KEY,
    promoter_id INT NOT NULL REFERENCES promoters(id) ON DELETE CASCADE,
    token       TEXT UNIQUE NOT NULL,
    label       TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE outreach_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach_tokens FROM anon, authenticated;
REVOKE ALL ON SEQUENCE outreach_tokens_id_seq FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention — a window is required, not merely nice-to-have (item 6)
-- ---------------------------------------------------------------------------

-- No enforcement mechanism (a cron/scheduled delete) is wired up here — that
-- needs the privacy policy page to exist first and state the window publicly,
-- and that page is a Parallel Track blocking App Store submission and Spotify
-- Extended Quota already, not something to duplicate ad hoc in a migration
-- comment. Recorded here so the obligation isn't lost: pick a window (90 days
-- is a reasonable default for outreach-cycle analytics), state it on the
-- privacy page, then add the actual deletion job.
