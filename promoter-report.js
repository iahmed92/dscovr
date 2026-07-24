// Reports the state of promoter matching. Read-only: resolves nothing, creates
// nothing, edits nothing. The only "fix" this script ever suggests is editing a
// row in the Supabase table editor.
//
//   npm run report:promoters
//
// Three questions:
//
//   1. COVERAGE   — per market, upcoming events with a promoter vs. without.
//                  (criterion 6)
//   2. UNMATCHED  — raw strings nothing has claimed yet, sorted by
//                  occurrence_count so the highest-value curation targets sort
//                  to the top. (criterion 4)
//   3. EMPTY PROMOTERS — promoters rows with zero attached upcoming events.
//                  The pipeline never creates these (0023), so any that exist
//                  are either mid-curation (a human just created the row and
//                  hasn't aliased anything to it yet — expected, harmless) or
//                  worth a second look. (criterion 3, as observability)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function requireMigration0023() {
  const probe = await supabase.from('promoters').select('ingested_name').limit(1);
  if (probe.error && /does not exist/i.test(probe.error.message)) {
    console.error('Migration 0023 has not been applied to this database yet.');
    console.error('\n  supabase/migrations/0023_promoter_identity_and_matching.sql\n');
    process.exit(1);
  }
}
await requireMigration0023();

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
  'id,promoter_id,source_type, venues!inner(market_id)',
  (q) => q.gte('event_date', today)
);

// --- 1. Coverage per market --------------------------------------------------
console.log('1) COVERAGE — upcoming events with a promoter vs. without, per market\n');
const byMarket = new Map();
for (const e of events) {
  const slug = marketSlug.get(e.venues?.market_id) ?? 'no-market';
  const row = byMarket.get(slug) ?? { with: 0, without: 0 };
  if (e.promoter_id) row.with++; else row.without++;
  byMarket.set(slug, row);
}
let totalWith = 0, totalWithout = 0;
for (const [slug, r] of [...byMarket.entries()].sort((a, b) => (b[1].with + b[1].without) - (a[1].with + a[1].without))) {
  const total = r.with + r.without;
  const pct = total ? ((r.with / total) * 100).toFixed(0) : '0';
  console.log(`   ${slug.padEnd(18)} ${String(r.with).padStart(4)} with / ${String(r.without).padStart(4)} without  (${pct}%)`);
  totalWith += r.with; totalWithout += r.without;
}
const totalAll = totalWith + totalWithout;
console.log(`\n   TOTAL: ${totalWith} with / ${totalWithout} without of ${totalAll} (${totalAll ? ((totalWith / totalAll) * 100).toFixed(1) : 0}%)`);

// --- 2. Unmatched aliases, sorted by occurrence_count -----------------------
console.log('\n2) UNMATCHED — raw strings not yet aliased to a promoter, by occurrence_count\n');
const unmatched = await fetchAll(
  'promoter_aliases', 'raw_string,source_type,occurrence_count,first_seen_at,last_seen_at',
  (q) => q.eq('status', 'unmatched').order('occurrence_count', { ascending: false })
);
if (unmatched.length === 0) {
  console.log('   none — every raw string seen so far has resolved');
} else {
  console.log(`   ${unmatched.length} unmatched raw string(s). Top 30 by occurrence:\n`);
  for (const a of unmatched.slice(0, 30)) {
    console.log(`   ${String(a.occurrence_count).padStart(4)}x  [${a.source_type.padEnd(16)}] "${a.raw_string}"`);
  }
  if (unmatched.length > 30) console.log(`   ... and ${unmatched.length - 30} more`);
}

// --- 3. Promoters with zero upcoming events ---------------------------------
console.log('\n3) EMPTY PROMOTERS — zero attached upcoming events (never created by the pipeline; check if mid-curation)\n');
const promoters = await fetchAll('promoters', 'id,name,ingested_name');
const eventCountByPromoter = new Map();
for (const e of events) {
  if (!e.promoter_id) continue;
  eventCountByPromoter.set(e.promoter_id, (eventCountByPromoter.get(e.promoter_id) ?? 0) + 1);
}
const empty = promoters.filter((p) => !eventCountByPromoter.has(p.id));
if (empty.length === 0) {
  console.log('   none');
} else {
  for (const p of empty) console.log(`   #${p.id}  "${p.name}"  (ingested_name: ${p.ingested_name ?? '(null)'})`);
}
