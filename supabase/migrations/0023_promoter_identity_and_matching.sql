-- Promoter extraction and normalization.
--
-- events.promoter_id was nullable and only ever filled by ad-hoc
-- getOrCreatePromoter() calls in each scraper, which created a fresh promoters
-- row per exact raw string with no reconciliation. Production already shows the
-- damage: "INSOMNIAC PRESENTS" (130 events) and "Insomniac" (15 events) are two
-- separate rows for one promoter, today. This migration replaces ad-hoc creation
-- with a conservative, auditable matching pipeline, and stops creating new
-- promoters rows from the pipeline at all — a promoters row now only comes into
-- existence by deliberate human action in the table editor.
--
-- ---------------------------------------------------------------------------
-- Corrections against the brief, found by inspecting the real sources
-- ---------------------------------------------------------------------------
--
-- Resident Advisor: the brief assumed a single organizer/promoter per listing.
-- RA's GraphQL actually returns event.promoters as an ARRAY (0, 1, or 2+ per
-- event, sampled: 6% none, 82% one, 12% two-or-more), each {id, name}. No
-- source_promoter_id column is added here to hold RA's id — matching stays
-- raw_string based for all four sources, consistent with Ticketmaster and
-- Insomniac, which have no comparable id. Multiple raw strings ARE all captured
-- into promoter_aliases (occurrence tracking, so a recurring co-promoter still
-- surfaces for curation); only the first (RA's own primary-first ordering,
-- matching how they render it) is attached to events.promoter_id, mirroring the
-- brief's own "capture all, prefer primary" rule for Ticketmaster.
--
-- RA's promoter names are also frequently just whoever personally listed the
-- show ("Dj Magneto", "Ian Zunich") rather than a promoter brand — confirmed by
-- sampling. No code here tries to distinguish a person from a brand; that would
-- be exactly the fuzzy/heuristic judgment call the brief prohibits. Both land in
-- promoter_aliases as unmatched, at occurrence_count=1, and are indistinguishable
-- from a real small promoter until a human looks at the queue. This is
-- deliberate, not an oversight — the brief's own philosophy that an unmatched
-- row costing ten seconds beats a wrong guess applies exactly here.
--
-- Insomniac: the brief assumed an `organizer` field exists in the schema.org
-- JSON-LD already being parsed. It does not — a real detail page's MusicEvent
-- node has no organizer key at all. Insomniac is therefore treated as a second
-- constant-entity source alongside Relentless Beats: every event resolves to
-- the fixed string 'Insomniac', resolved once per run rather than per event.
--
-- ---------------------------------------------------------------------------
-- promoters: add pipeline-owned matching identity
-- ---------------------------------------------------------------------------

-- ingested_name is what NEW raw strings match against (rule 2). It is written
-- once, by the pipeline or by a human creating the row, and never overwritten
-- by a sync — Brief 4's display-name override lives on the existing `name`
-- column, which stays free to diverge from ingested_name after creation.
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS ingested_name TEXT;
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE promoters ADD COLUMN IF NOT EXISTS primary_market_id INT REFERENCES markets(id);

-- Backfill the 30 existing rows so matching starts working against them
-- immediately, without requiring a human to manually recreate every promoter
-- that already exists. ingested_name = name is the correct one-time seed: it is
-- literally what the old ad-hoc code stored as the raw name. Idempotent by the
-- WHERE clause — safe to re-run, touches nothing already populated.
UPDATE promoters SET ingested_name = name WHERE ingested_name IS NULL;

-- Slug generation, uniquified on collision. Same base+suffix loop already
-- established in migration 0006's handle_new_user() for usernames — reused
-- here rather than inventing a second idiom for the same problem.
DO $$
DECLARE
    r RECORD;
    base_slug TEXT;
    candidate TEXT;
    suffix INT;
BEGIN
    FOR r IN SELECT id, name FROM promoters WHERE slug IS NULL LOOP
        base_slug := lower(regexp_replace(trim(r.name), '[^a-zA-Z0-9]+', '-', 'g'));
        base_slug := trim(both '-' from base_slug);
        IF base_slug = '' THEN
            base_slug := 'promoter-' || r.id;
        END IF;

        candidate := base_slug;
        suffix := 1;
        WHILE EXISTS (SELECT 1 FROM promoters WHERE slug = candidate) LOOP
            suffix := suffix + 1;
            candidate := base_slug || '-' || suffix;
        END LOOP;

        UPDATE promoters SET slug = candidate WHERE id = r.id;
    END LOOP;
END $$;

ALTER TABLE promoters ADD CONSTRAINT promoters_slug_uniq UNIQUE (slug);

-- New columns are internal matching/curation data, not display data — they stay
-- out of the public grant. 0015 already REVOKEd table-level SELECT and GRANTs
-- an explicit column list; a column simply absent from that list is invisible
-- to anon/authenticated by construction, so no additional REVOKE is needed
-- here. Verified in the harness rather than assumed.

-- ---------------------------------------------------------------------------
-- normalize_promoter_name — comparison-only, never written back
-- ---------------------------------------------------------------------------

-- Lowercase, strip punctuation, collapse whitespace, strip TRAILING corporate/
-- presentation suffixes only (mid-string occurrences are untouched — "Bar
-- Franca Presents Live" does not lose "presents"). IMMUTABLE because it reads
-- nothing but its argument.
CREATE OR REPLACE FUNCTION normalize_promoter_name(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    -- Trimmed BEFORE the suffix-strip regex runs, not just at the end: stripping
    -- punctuation (e.g. the trailing "." in "LLC.") leaves a trailing space, and
    -- the suffix pattern anchors on $ — "llc " with a trailing space does not
    -- match "...llc$", so the suffix silently survives untrimmed input. Caught
    -- by the harness on "Live Nation, LLC." normalizing to "live nation llc"
    -- instead of "live nation".
    SELECT trim(
        regexp_replace(
            trim(
                regexp_replace(
                    regexp_replace(lower(COALESCE(raw, '')), '[^a-z0-9\s]+', ' ', 'g'),
                    '\s+', ' ', 'g'
                )
            ),
            '(\s(llc|inc|events|presents|presenting|productions))+$', ''
        )
    );
$$;

-- ---------------------------------------------------------------------------
-- promoter_aliases — the audit trail and the matching queue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS promoter_aliases (
    id               BIGSERIAL PRIMARY KEY,
    raw_string       TEXT NOT NULL,
    source_type      TEXT NOT NULL,
    promoter_id      INT REFERENCES promoters(id) ON DELETE SET NULL,
    status           TEXT NOT NULL DEFAULT 'unmatched',
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    occurrence_count INT NOT NULL DEFAULT 1,
    CONSTRAINT promoter_aliases_status_check CHECK (status IN ('unmatched', 'matched', 'ignored')),
    -- Addition beyond the brief's literal column list: a 'matched' row without a
    -- promoter_id is an inconsistent state the matching function must never
    -- produce, and this makes that a hard guarantee rather than a convention.
    CONSTRAINT promoter_aliases_matched_has_promoter CHECK (
        (status = 'matched' AND promoter_id IS NOT NULL) OR (status <> 'matched')
    ),
    CONSTRAINT promoter_aliases_raw_source_uniq UNIQUE (raw_string, source_type)
);

CREATE INDEX IF NOT EXISTS promoter_aliases_unmatched_idx
    ON promoter_aliases (occurrence_count DESC) WHERE status = 'unmatched';

-- No anon access at all — this is pipeline/curation machinery, not user data.
-- Both the REVOKE and the policy-less RLS matter for the same reason as
-- ingest_runs in 0020: Supabase's default privileges grant ALL on every new
-- table, and RLS with no policy merely returns zero rows rather than refusing,
-- so the REVOKE is what turns it into a hard denial.
ALTER TABLE promoter_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON promoter_aliases FROM anon, authenticated;
REVOKE ALL ON SEQUENCE promoter_aliases_id_seq FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_promoter_alias — the matching rules, as the single source of truth
-- ---------------------------------------------------------------------------

-- Touches/creates the alias row and returns a promoter_id or NULL. Never
-- creates a promoters row. Rules, in order:
--
--   1. Already 'matched' (by a human, or by this function on an earlier call)
--      -> return its promoter_id.
--   2. Already 'ignored' (a human's explicit "this is not a promoter") -> return
--      NULL, and never re-attempt rule 3 against it. An ignored raw string that
--      starts appearing under a different source_type is a DIFFERENT alias row
--      (the unique key includes source_type), so this does not silently
--      suppress a genuinely new sighting elsewhere.
--   3. Otherwise, normalized exact match against an existing promoter's
--      ingested_name -> attach: mark this alias 'matched' and return that
--      promoter_id. No fuzzy comparison, no similarity threshold.
--   4. No match -> the row stays/becomes 'unmatched'. Return NULL.
--
-- occurrence_count and last_seen_at advance on EVERY call regardless of which
-- rule fires, via the initial upsert — the alias table's coverage of "was this
-- seen" must not depend on whether it happened to already match.
--
-- Idempotent by construction: the upsert conflicts on (raw_string, source_type),
-- so repeated calls with the same pair increment one row rather than creating
-- rows. Not SECURITY DEFINER — the pipeline always calls this as the service
-- role (which bypasses RLS already), and running as invoker means a lower-
-- privileged caller's internal writes fail under promoter_aliases' own RLS
-- rather than needing a second layer of defense inside the function.
CREATE OR REPLACE FUNCTION resolve_promoter_alias(p_raw_string TEXT, p_source_type TEXT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_alias promoter_aliases%ROWTYPE;
    v_normalized TEXT;
    v_matched_promoter_id INT;
BEGIN
    INSERT INTO promoter_aliases (raw_string, source_type, status, occurrence_count)
    VALUES (p_raw_string, p_source_type, 'unmatched', 1)
    ON CONFLICT (raw_string, source_type) DO UPDATE
        SET occurrence_count = promoter_aliases.occurrence_count + 1,
            last_seen_at = now()
    RETURNING * INTO v_alias;

    IF v_alias.status = 'matched' THEN
        RETURN v_alias.promoter_id;
    END IF;

    IF v_alias.status = 'ignored' THEN
        RETURN NULL;
    END IF;

    v_normalized := normalize_promoter_name(p_raw_string);
    SELECT id INTO v_matched_promoter_id
    FROM promoters
    WHERE normalize_promoter_name(ingested_name) = v_normalized
    LIMIT 1;

    IF v_matched_promoter_id IS NOT NULL THEN
        UPDATE promoter_aliases
        SET status = 'matched', promoter_id = v_matched_promoter_id
        WHERE id = v_alias.id;
        RETURN v_matched_promoter_id;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_promoter_alias(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION normalize_promoter_name(TEXT) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- Does not merge the existing fragmented promoters ("INSOMNIAC PRESENTS" vs
-- "Insomniac" stay two separate rows). Deciding those are the same entity is
-- exactly the kind of judgment call the brief's "no fuzzy matching, no closest
-- candidate" rule prohibits automating. It is a human curation task: point one
-- promoter_aliases row's promoter_id at the other's promoters row. Reported,
-- not resolved, by promoter-report.js.
--
-- Does not enforce "no promoters row with zero events" as a database
-- constraint. The pipeline never creates a promoters row, so it structurally
-- cannot violate this — but a human legitimately has a promoter row with zero
-- events for the short window between creating it and aliasing the first raw
-- string to it, and a hard constraint would break that ordinary workflow.
-- Reported as an observability check instead.
--
-- Does not touch existing events.promoter_id values already set by the old
-- ad-hoc code. They are correct data (each points at a real promoters row for
-- the exact raw string that was ingested), not identified for backfill, and
-- will be recomputed to the same value on the next sync via rule 3 matching
-- the same row's now-backfilled ingested_name.
