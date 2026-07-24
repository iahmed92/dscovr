// Shared ingest telemetry: run records and natural-key observations.
//
// Two jobs, both feeding the source-identity migration:
//
// 1. ingest_runs — "stale" is only decidable relative to a run that COMPLETED.
//    A source that dies halfway is otherwise indistinguishable from one that
//    legitimately dropped 200 events, so every ingest opens a 'running' row per
//    (source, market) and closes it 'complete' or 'failed'.
//
// 2. Natural-key observations — during steps 2-4 the upsert still conflicts on
//    (venue_id, title, event_date), so when two sources produce the same
//    natural key the row flip-flops between them and only the last writer is
//    visible in the database. That means the size of the cross-source split
//    coming at step 5 CANNOT be measured after the fact. It has to be captured
//    while the runs happen, which is what observe() is for.
//
// Observations go to a JSONL file rather than a table: this is a one-off
// measurement for a migration, not a permanent product surface, and the brief
// authorises exactly one new table.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OBSERVATIONS_PATH = join(HERE, 'reports', 'natural-key-observations.jsonl');

// ---------------------------------------------------------------------------
// ingest_runs
// ---------------------------------------------------------------------------

export async function startRun(supabase, sourceType, marketId) {
  const { data, error } = await supabase
    .from('ingest_runs')
    .insert({
      source_type: sourceType,
      market_id: marketId ?? null,
      started_at: new Date().toISOString(),
      status: 'running',
    })
    .select('id')
    .single();
  if (error) {
    // Telemetry must never take the ingest down with it.
    console.warn(`[telemetry] could not open run for ${sourceType}: ${error.message}`);
    return null;
  }
  return data.id;
}

export async function finishRun(supabase, runId, { status, eventsSeen = null, notes = null }) {
  if (runId === null) return;
  const { error } = await supabase
    .from('ingest_runs')
    .update({
      finished_at: new Date().toISOString(),
      status,
      events_seen: eventsSeen,
      notes,
    })
    .eq('id', runId);
  if (error) console.warn(`[telemetry] could not close run ${runId}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Natural-key observations
// ---------------------------------------------------------------------------

let observationsReady = false;

/**
 * Record that `sourceType` saw this natural key on this run. Appended, never
 * read back by the ingest — `npm run report:collisions` aggregates across all
 * four sources afterwards.
 */
export function observe({ venueId, title, eventDate, sourceType }) {
  if (venueId == null || !title || !eventDate) return;
  try {
    if (!observationsReady) {
      mkdirSync(dirname(OBSERVATIONS_PATH), { recursive: true });
      observationsReady = true;
    }
    appendFileSync(
      OBSERVATIONS_PATH,
      JSON.stringify({ venueId, title, eventDate, sourceType }) + '\n'
    );
  } catch (err) {
    console.warn(`[telemetry] observation not recorded: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// The safety rule, enforced in one place
// ---------------------------------------------------------------------------

/**
 * source_type and source_event_id must be written together, always, in the same
 * payload. During steps 2-4 a contested natural key flips between sources on
 * every sync — harmless while the pair stays consistent, permanently corrupting
 * the moment one is written without the other (you'd get one source's type
 * carrying another source's id, and step 5 would key the row to the wrong
 * identity forever).
 *
 * Returns the two fields, or null if the id is missing — in which case the
 * caller must skip the write entirely rather than write a half-pair. Preferring
 * no-write over a wrong write is the same rule that the Spotify matcher learned
 * the hard way.
 */
export function sourceIdentity(sourceType, sourceEventId) {
  const id = sourceEventId == null ? null : String(sourceEventId).trim();
  if (!sourceType || !id) return null;
  return { source_type: sourceType, source_event_id: id };
}

/** Timestamp for last_seen_at. Stamped on every touch, changed fields or not. */
export function seenNow() {
  return new Date().toISOString();
}
