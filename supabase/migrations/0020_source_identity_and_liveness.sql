-- Phase A of source identity + liveness. Additive only: two nullable columns on
-- events and one new table. Nothing reads or writes them yet, so deploying this
-- changes no behaviour.
--
-- Why this exists: re-ingest currently matches on the natural key
-- (venue_id, title, event_date), so there is no idempotent update path. When a
-- source renames an event or corrects its venue, the next run cannot find the
-- old row and inserts a second one. That duplication compounds every sync from
-- within a single source, independent of any cross-source overlap.
--
-- The unique index on (source_type, source_event_id) is deliberately NOT created
-- here — the ~4,400 existing rows have no source id and it cannot be derived
-- from what is stored, so the index has to wait until reconciliation has
-- backfilled them (Phase C).

-- ---------------------------------------------------------------------------
-- events: source identity + liveness
-- ---------------------------------------------------------------------------

-- The source's own identifier for this event (RA event id, Insomniac slug,
-- Ticketmaster event id, Relentless Beats data-event-id). Nullable because
-- existing rows predate it and reconciliation fills them in Phase B.
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_event_id TEXT;

-- Stamped on every touch by an ingest, INCLUDING touches where no other field
-- changed. That is the whole point: an unchanged event that is still listed has
-- to be distinguishable from one the source has delisted. Staleness is only
-- meaningful relative to a run that completed — see ingest_runs.
ALTER TABLE events ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Supports the "what did the last complete run not see" query without scanning.
CREATE INDEX IF NOT EXISTS events_source_liveness_idx
    ON events (source_type, last_seen_at);

-- ---------------------------------------------------------------------------
-- ingest_runs
-- ---------------------------------------------------------------------------

-- A source that fails halfway looks exactly like a source that legitimately
-- dropped 200 events. Without a per-run completion record, "stale" is not a
-- decidable property and any pruning built on last_seen_at would silently hide
-- live events after a partial failure.
CREATE TABLE IF NOT EXISTS ingest_runs (
    id           BIGSERIAL PRIMARY KEY,
    source_type  TEXT        NOT NULL,
    market_id    INT         REFERENCES markets(id),
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ,
    status       TEXT        NOT NULL,
    events_seen  INT,
    notes        TEXT,
    CONSTRAINT ingest_runs_status_check CHECK (status IN ('running', 'complete', 'failed'))
);

CREATE INDEX IF NOT EXISTS ingest_runs_lookup_idx
    ON ingest_runs (source_type, market_id, status, started_at DESC);

-- RLS: no client access at all. This is operational telemetry, not user data —
-- the pipeline writes it as the service role (which bypasses RLS) and the only
-- reader is the Supabase table editor (also service role).
--
-- Both the REVOKE and the enabled-but-policy-less RLS are load-bearing, and for
-- different reasons. Supabase's ALTER DEFAULT PRIVILEGES grants ALL on every new
-- public table to anon/authenticated, so without the REVOKE the table is
-- readable at the privilege level; and RLS with no policy would merely return
-- zero rows rather than refusing. Revoking makes it a hard permission denial,
-- and RLS stays on so a future accidental GRANT still fails closed.
ALTER TABLE ingest_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ingest_runs FROM anon, authenticated;
REVOKE ALL ON SEQUENCE ingest_runs_id_seq FROM anon, authenticated;
