-- Membership and field-overlay schema.
--
-- Done before any claim flow exists because the claim flow writes into both
-- of these, and migrating off owner_id / introducing overlays is cheap now,
-- materially harder once real profiles are claimed and people depend on them.
--
-- ---------------------------------------------------------------------------
-- Verified before writing this, not assumed
-- ---------------------------------------------------------------------------
--
-- owner_id: bare UUID, no FK ever declared (0001), and 0 of 30 current
-- promoters rows have it set. The backfill below is written correctly and
-- generically regardless — it would do the right thing against a populated
-- column — but empirically it is a no-op today.
--
-- promoters.website / promoters.logo_url: both exist since 0001 and are BOTH
-- 0/30 populated. Grepping all four scrapers confirms why: every "website ="
-- write in this codebase targets VENUES (tmVenue.url, location.url,
-- venue.contentUrl — a different table with its own website column), never
-- promoters. So both columns are, in practice, inert since day one — which
-- makes them safe, correct COALESCE fallback targets for the overlay
-- resolution below even though today they always resolve to NULL. Nothing
-- pipeline-side needed to change to confirm the brief's "pipeline writes only
-- ingested columns" premise; it already did.

-- ---------------------------------------------------------------------------
-- promoter_members
-- ---------------------------------------------------------------------------

-- Many-to-many, deliberately: one person can hold several promoter brands,
-- one brand has several staff, staff move between brands. A departure removes
-- a row rather than orphaning a profile.
CREATE TABLE IF NOT EXISTS promoter_members (
    id          BIGSERIAL PRIMARY KEY,
    promoter_id INT  NOT NULL REFERENCES promoters(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Reserved, unused, deliberately unconstrained beyond NOT NULL: the whole
    -- point of shipping this column now is to avoid the migration that would
    -- be needed to ADD it once live RLS policies key on role values after
    -- profiles are claimed. A CHECK pinning it to today's one value would
    -- reintroduce exactly that migration the moment a second role exists —
    -- so this is one case where MORE constraint would work against the
    -- brief's own stated reason for the column existing at all.
    role        TEXT NOT NULL DEFAULT 'member',
    created_at  TIMESTAMPTZ DEFAULT now(),
    created_by  UUID,
    CONSTRAINT promoter_members_promoter_user_uniq UNIQUE (promoter_id, user_id)
);

-- Members have no management powers — adding/removing a member is service-role
-- only (the operator, in the table editor), so there is no INSERT, UPDATE, or
-- DELETE policy for anyone else at all. A user may only ever SELECT their own
-- membership rows, to know which promoters they can edit.
ALTER TABLE promoter_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON promoter_members FROM anon, authenticated;
REVOKE ALL ON SEQUENCE promoter_members_id_seq FROM anon, authenticated;
-- Not anon: anon has no auth.uid() to match against, and there is no
-- legitimate reason for a signed-out visitor to read membership rows at all.
GRANT SELECT ON promoter_members TO authenticated;

CREATE POLICY "A user can see their own memberships" ON promoter_members
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Migrate off promoters.owner_id
-- ---------------------------------------------------------------------------

INSERT INTO promoter_members (promoter_id, user_id)
SELECT id, owner_id FROM promoters
WHERE owner_id IS NOT NULL
ON CONFLICT (promoter_id, user_id) DO NOTHING;

ALTER TABLE promoters DROP COLUMN IF EXISTS owner_id;

-- ---------------------------------------------------------------------------
-- Overlay columns on promoters
-- ---------------------------------------------------------------------------

-- Two layers, resolved at read time (see promoters_public below). The
-- pipeline writes only to ingested columns (ingested_name, and — per the
-- ownership split — the event list/dates/venues/ticket URLs/last_seen_at that
-- live on events, not here) and never reads or respects these. Promoter edits
-- go here and here only. Nothing is ever overwritten in either direction —
-- confirmed structurally: no ingestion script in this repo references any of
-- these six column names, and the resolution view below never writes back to
-- ingested_name.
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS display_name_override TEXT;
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS bio_override TEXT;
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS logo_url_override TEXT;
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS website_override TEXT;
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS socials_override JSONB;
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS contact_override TEXT;

-- Ownership split (item 5), written into the schema as the durable record of
-- the decision, not just the migration commit message:
--
--   Promoter-owned (override wins, columns above): logo and brand assets,
--   bio, social links, public contact, website, display name. Later: an FAQ
--   block.
--
--   Pipeline-owned (always live, never overridable): the event list, dates,
--   venues, ticket URLs, last_seen_at, ingested_name. These are facts that
--   change; a promoter must not be able to freeze them — a stale event on a
--   claimed page is worse than on an unclaimed one. None of these have an
--   _override column, on purpose, and never should.

-- Display name vs. matching name (item 4): ingested_name stays what
-- promoter_aliases matches future events against (0023's
-- resolve_promoter_alias reads promoters.ingested_name, never
-- display_name_override). If a promoter's stylized display name were what the
-- normalizer saw, newly ingested events would stop attaching to their
-- profile the moment they diverge. Kept structurally separate: two columns,
-- two owners, one only ever read by matching, one only ever read by display.

-- REAL FINDING, caught by the harness, not theorized: UPDATE on promoters was
-- never revoked from anon/authenticated — only SELECT was, back in 0015. Since
-- Supabase's default privileges GRANT ALL on table creation, authenticated has
-- had blanket UPDATE on EVERY column of promoters (including status and
-- stripe_customer_id) since 0001, day one. This is the exact SELECT-side trap
-- CLAUDE.md already documents ("the table-level grant has to be revoked
-- first, because Postgres will not let a column-level REVOKE override a
-- table-level grant that implies it"), just on the UPDATE side, and it went
-- unnoticed until now because nothing before this brief ever tried to grant a
-- SCOPED update on this table — the harness caught it the moment this
-- migration's own "member cannot touch ingested_name/status" tests ran, both
-- came back WRITABLE. Confirmed before fixing, not assumed: no client code
-- anywhere in mobile/src ever calls UPDATE/INSERT/DELETE on promoters — the
-- only usage is the Brief 3 SELECT in use-promoter.ts — so closing this has
-- zero legitimate dependents to break.
REVOKE UPDATE, INSERT, DELETE ON promoters FROM anon, authenticated;

-- Members may update ONLY the six override columns — never ingested_name,
-- never status (publication stays curator-only), never anything on events.
-- Anon gets nothing here; editing requires being signed in AND a member.
GRANT UPDATE (display_name_override, bio_override, logo_url_override,
              website_override, socials_override, contact_override)
    ON promoters TO authenticated;

CREATE POLICY "Members can update their promoter's override fields" ON promoters
    FOR UPDATE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM promoter_members pm
        WHERE pm.promoter_id = promoters.id AND pm.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM promoter_members pm
        WHERE pm.promoter_id = promoters.id AND pm.user_id = auth.uid()
    ));

-- ---------------------------------------------------------------------------
-- promoters_public — resolved values, the three-state trap handled once
-- ---------------------------------------------------------------------------

-- COALESCE(override, ingested) is already correct here, and needs no special
-- case: Postgres COALESCE only substitutes on true SQL NULL, never on ''. Do
-- NOT "fix" this into a CASE/IF — there is nothing to fix. The trap this
-- whole brief exists to guard against is exclusively a JavaScript hazard
-- (`if (!x)` / `x || y` both treat '' as falsy and silently collapse the
-- third state), and it lives entirely on the CLIENT side reading this view's
-- output — see the comment in use-promoter.ts where these values are
-- consumed, which is where an accidental `??`/`||`/truthy check would
-- actually do the damage.
--
-- Three states, every override column: NULL = no override (falls through to
-- the ingested value, or to nothing for columns with no ingested
-- counterpart); '' = the promoter deliberately wants nothing shown; any text
-- = the promoter's value.
--
-- security_invoker, not security_definer: this view enforces RLS as the
-- CALLING role against the base promoters table — it is not a bypass. An
-- anon query against this view for a draft promoter still returns zero rows,
-- for the exact same reason a direct query against promoters does (Brief 3's
-- status-filtered policy), because a security_invoker view re-checks the
-- underlying table's RLS under the caller's own privileges rather than the
-- view owner's.
--
-- bio_override, contact_override, and socials_override have no ingested
-- counterpart anywhere in the schema — the pipeline has never produced a bio,
-- a contact, or a set of socials for a promoter, ever. For those three the
-- "resolved" value is the override column passed through unchanged (NULL
-- stays NULL, '' stays ''); there is no second argument to COALESCE against,
-- and inventing an ingested_bio/ingested_contact/ingested_socials companion
-- nobody asked for would be scope beyond this brief's six named columns.
CREATE OR REPLACE VIEW promoters_public WITH (security_invoker = true) AS
SELECT
    p.id,
    p.slug,
    p.status,
    p.ingested_name,
    COALESCE(p.display_name_override, p.ingested_name) AS display_name,
    p.bio_override                                      AS bio,
    COALESCE(p.logo_url_override, p.logo_url)           AS logo_url,
    COALESCE(p.website_override, p.website)             AS website,
    p.contact_override                                  AS contact,
    p.socials_override                                  AS socials
FROM promoters p;

-- ingested_name/slug/status keep their existing Brief-3 grant on the base
-- table (0024) — harmless, and useful for internal tooling that specifically
-- wants the raw pipeline value rather than a resolved one. promoters_public
-- is additive: the new path the app actually reads for rendering, which is
-- what makes "select from promoters now returns resolved values" true of the
-- app's real behavior without collapsing ingested_name and its resolved
-- display counterpart into one ambiguous column.
GRANT SELECT ON promoters_public TO anon, authenticated;
