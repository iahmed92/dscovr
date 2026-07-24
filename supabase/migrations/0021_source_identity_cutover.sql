-- Step 4/5 cutover: retire the natural key as the conflict target and make
-- source identity authoritative.
--
-- APPLY THIS INSIDE A PAUSE WINDOW. There is no safe overlap:
--
--   pause scrapers -> apply this migration -> deploy the new conflict target
--   -> resume scrapers
--
-- Between the DROP below and the scrapers switching their conflict target,
-- every ingest upsert still names (venue_id, title, event_date) — which no
-- longer has a unique index to target, so PostgREST rejects it. Running the
-- ingests during that gap fails loudly rather than corrupting anything, but it
-- fails.
--
-- PRE-FLIGHT: run `npm run report:ingest` first. If it reports any repeated
-- (source_type, source_event_id), the unique index below will fail and abort
-- this migration. That failure is a real finding — a source handing out the
-- same id twice, or the same RA event arriving under two adjacent area ids.
-- Resolve it deliberately; do not weaken the index to accommodate it.

-- ---------------------------------------------------------------------------
-- 1. Drop the natural key
-- ---------------------------------------------------------------------------

-- Mandatory, not cosmetic. Once each source keys on its own identity, two
-- sources legitimately hold their own row for the same real-world event. With
-- this constraint still in place the second source's INSERT raises a unique
-- violation and the whole run fails, so the cross-source split it is supposed
-- to permit could never happen.
--
-- Cross-source duplicates therefore become visible after this. That is the
-- accepted, deliberate consequence — dedup is a separate piece of work and is
-- explicitly not attempted here.
ALTER TABLE events DROP CONSTRAINT IF EXISTS unique_venue_title_date;

-- ---------------------------------------------------------------------------
-- 2. Keep (venue_id, event_date) indexed
-- ---------------------------------------------------------------------------

-- Dropping the constraint above also drops its index, which was doing real work
-- for venue+date lookups. This replaces that access path, and is the blocking
-- key any future dedup pass will group candidates on: same venue, same night is
-- the cheap partition before any title comparison. Non-unique by design — two
-- rows sharing a venue and date is now a legal, expected state.
CREATE INDEX IF NOT EXISTS events_venue_date_idx ON events (venue_id, event_date);

-- ---------------------------------------------------------------------------
-- 3. Source identity becomes the upsert key
-- ---------------------------------------------------------------------------

-- Plain, non-partial, non-concurrent, and each of those is deliberate:
--
--   * Not CONCURRENTLY. At this table size the index builds in milliseconds, so
--     CONCURRENTLY buys nothing, cannot run inside a migration's transaction,
--     and — worse — the PGlite harness accepts it happily, so the failure would
--     only appear against production. A false pass is the one thing the harness
--     exists to prevent.
--
--   * No `WHERE source_event_id IS NOT NULL`. Postgres already treats NULLs as
--     distinct in a unique index, so every not-yet-reconciled row coexists
--     without a predicate. And a partial index would be unusable as an upsert
--     target anyway: PostgREST's on_conflict takes column names only and cannot
--     restate the predicate, so the scrapers could never point at it.
CREATE UNIQUE INDEX IF NOT EXISTS events_source_identity_uniq
    ON events (source_type, source_event_id);
