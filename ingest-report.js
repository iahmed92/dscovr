// Reports the state of the source-identity migration. Read-only: this script
// never writes, never deletes, and never resolves anything it finds.
//
//   npm run report:ingest
//
// Four questions, in the order they matter:
//
//   1. RESIDUE      — after a complete run, which rows still have no source id?
//   2. IDENTITY DUPES — do any (source_type, source_event_id) pairs repeat?
//                     These BLOCK the Phase C unique index, and are also where
//                     Resident Advisor's cross-area duplicates surface: the same
//                     RA event arriving twice under two adjacent area ids.
//   3. STALE        — what is in the database but absent from the most recent
//                     complete run for its source and market? (criterion 5)
//   4. SPLIT FORECAST — how many natural keys were seen from more than one
//                     source? That is the row increase to expect at step 5,
//                     known in advance rather than as a surprise.
//
// (3) is computed here in JS for readability, but the canonical single-query
// form is printed by --sql so it can be run directly in the SQL editor.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { OBSERVATIONS_PATH } from './ingest-telemetry.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Criterion 5 as one query. ingest_runs is service-role only, so this is meant
// for the Supabase SQL editor.
const STALE_SQL = `
-- Events absent from the most recent COMPLETE run for their source + market.
-- "Complete" is the point: a half-failed run must not make live events look
-- delisted. Reports only; deletes nothing.
WITH last_complete AS (
    SELECT DISTINCT ON (source_type, market_id)
           source_type, market_id, started_at
    FROM ingest_runs
    WHERE status = 'complete'
    ORDER BY source_type, market_id, started_at DESC
)
SELECT e.id, e.title, e.event_date, e.source_type, v.market_id, e.last_seen_at
FROM events e
JOIN venues v ON v.id = e.venue_id
JOIN last_complete lc
  ON lc.source_type = e.source_type AND lc.market_id = v.market_id
WHERE e.event_date >= CURRENT_DATE
  AND (e.last_seen_at IS NULL OR e.last_seen_at < lc.started_at)
ORDER BY e.source_type, v.market_id, e.event_date;`;

if (process.argv.includes('--sql')) {
  console.log(STALE_SQL);
  process.exit(0);
}

async function fetchAll(table, select, tune = (q) => q) {
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tune(supabase.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows = rows.concat(data);
    if (data.length < 1000) break;
  }
  return rows;
}

const today = new Date().toISOString().slice(0, 10);

const markets = await fetchAll('markets', 'id,slug');
const marketSlug = new Map(markets.map((m) => [m.id, m.slug]));

const events = await fetchAll(
  'events',
  'id,title,event_date,source_type,source_event_id,last_seen_at,venue_id, venues(market_id)',
  (q) => q.gte('event_date', today)
);

const runs = await fetchAll('ingest_runs', 'source_type,market_id,status,started_at,events_seen');

const marketOf = (e) => e.venues?.market_id ?? null;
const key = (s, m) => `${s}|${m}`;

// Most recent complete run per (source, market).
const lastComplete = new Map();
for (const r of runs.filter((r) => r.status === 'complete')) {
  const k = key(r.source_type, r.market_id);
  const prev = lastComplete.get(k);
  if (!prev || new Date(r.started_at) > new Date(prev.started_at)) lastComplete.set(k, r);
}

console.log(`upcoming events: ${events.length} | ingest_runs rows: ${runs.length} | complete (source,market) pairs: ${lastComplete.size}\n`);

// --- 1. Residue -------------------------------------------------------------
// Scoped as specified: upcoming only, and only sources/markets that actually
// have a complete run — an unreconciled row under a source that never finished
// is not evidence of anything.
console.log('1) RESIDUE — upcoming rows with no source_event_id, where a complete run exists');
const residue = new Map();
let unscoped = 0;
for (const e of events) {
  if (e.source_event_id !== null) continue;
  const k = key(e.source_type, marketOf(e));
  if (!lastComplete.has(k)) { unscoped++; continue; }
  residue.set(k, (residue.get(k) ?? 0) + 1);
}
if (residue.size === 0) console.log('   none — every in-scope row reconciled');
for (const [k, n] of [...residue.entries()].sort((a, b) => b[1] - a[1])) {
  const [src, mid] = k.split('|');
  console.log(`   ${src.padEnd(18)} ${(marketSlug.get(Number(mid)) ?? 'no-market').padEnd(18)} ${n}`);
}
console.log(`   (${unscoped} null-id rows excluded: no complete run yet for their source+market)`);

// --- 2. Identity duplicates -------------------------------------------------
console.log('\n2) IDENTITY DUPES — repeated (source_type, source_event_id). These block the Phase C index.');
const byIdentity = new Map();
for (const e of events) {
  if (!e.source_event_id) continue;
  const k = key(e.source_type, e.source_event_id);
  (byIdentity.get(k) ?? byIdentity.set(k, []).get(k)).push(e);
}
const dupes = [...byIdentity.entries()].filter(([, g]) => g.length > 1);
if (dupes.length === 0) {
  console.log('   none — the unique index can be created safely');
} else {
  console.log(`   ${dupes.length} colliding identity/-ies — REPORTED, NOT RESOLVED:`);
  for (const [k, g] of dupes.slice(0, 20)) {
    const [src, sid] = k.split('|');
    console.log(`   ${src} ${sid}: rows ${g.map((e) => e.id).join(', ')} — ${g[0].title}`);
    console.log(`      markets: ${[...new Set(g.map((e) => marketSlug.get(marketOf(e)) ?? '?'))].join(', ')}`);
  }
  const raDupes = dupes.filter(([k]) => k.startsWith('resident_advisor|'));
  console.log(`   of which Resident Advisor (the cross-area class): ${raDupes.length}`);
}

// --- 3. Stale ---------------------------------------------------------------
console.log('\n3) STALE — present in the DB but absent from the most recent complete run');
const stale = new Map();
for (const e of events) {
  const k = key(e.source_type, marketOf(e));
  const run = lastComplete.get(k);
  if (!run) continue;
  if (e.last_seen_at === null || new Date(e.last_seen_at) < new Date(run.started_at)) {
    stale.set(k, (stale.get(k) ?? 0) + 1);
  }
}
if (stale.size === 0) console.log('   none');
for (const [k, n] of [...stale.entries()].sort((a, b) => b[1] - a[1])) {
  const [src, mid] = k.split('|');
  console.log(`   ${src.padEnd(18)} ${(marketSlug.get(Number(mid)) ?? 'no-market').padEnd(18)} ${n}`);
}
console.log('   (run `node ingest-report.js --sql` for the single-query form)');

// --- 4. Split forecast ------------------------------------------------------
console.log('\n4) SPLIT FORECAST — natural keys observed from more than one source');
if (!existsSync(OBSERVATIONS_PATH)) {
  console.log('   no observations recorded yet — run the ingests once after deploying step 2');
} else {
  const sourcesByKey = new Map();
  for (const line of readFileSync(OBSERVATIONS_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const k = `${o.venueId}|${o.title}|${o.eventDate}`;
    (sourcesByKey.get(k) ?? sourcesByKey.set(k, new Set()).get(k)).add(o.sourceType);
  }
  const contested = [...sourcesByKey.entries()].filter(([, s]) => s.size > 1);
  const extraRows = contested.reduce((n, [, s]) => n + (s.size - 1), 0);
  console.log(`   natural keys observed: ${sourcesByKey.size}`);
  console.log(`   contested by >1 source: ${contested.length}`);
  console.log(`   => expected NEW rows at step 5: ${extraRows}`);
  const pairs = new Map();
  for (const [, s] of contested) {
    const p = [...s].sort().join(' + ');
    pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  for (const [p, n] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${p}: ${n}`);
  }
}
