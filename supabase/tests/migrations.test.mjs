// Runs every migration in supabase/migrations against a throwaway Postgres
// (PGlite — real Postgres compiled to WASM, so no Docker daemon needed), then
// exercises the functions they define.
//
//   node supabase/tests/migrations.test.mjs
//
// This project has no local Supabase stack, so without this the only way to
// find out whether a migration parses is to run it against production.
//
// PGlite has no auth schema and none of Supabase's roles, so the stubs below
// stand in for them. They are deliberately minimal: this harness proves the
// SQL is valid and the logic behaves, NOT that Supabase's own auth internals
// agree. Note PGlite is PG18 while production is PG17.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');

const SUPABASE_STUBS = `
CREATE SCHEMA IF NOT EXISTS auth;

-- Shape mirrors the columns our trigger reads off Supabase's managed table.
CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    phone TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Real auth.uid() reads the request JWT. Here it reads a GUC so tests can
-- impersonate a user with set_config('test.uid', ...).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $fn$
    SELECT NULLIF(current_setting('test.uid', true), '')::uuid;
$fn$;

DO $do$ BEGIN
    CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
DO $do$ BEGIN
    CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
DO $do$ BEGIN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Supabase ships this, and it is the whole reason the column REVOKEs in 0006
-- are load-bearing: every new public table is granted to the API roles
-- automatically. Without replicating it here, anon would start with no
-- privileges and the "secrets are withheld" assertions would pass vacuously.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
`;

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const db = await new PGlite();
await db.exec(SUPABASE_STUBS);

// Supabase grants these to the API roles as tables are created; mirror that so
// the column-level REVOKEs in 0006 are actually meaningful here.
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
console.log(`applying ${files.length} migration(s) against ${(await db.query('select version()')).rows[0].version.split(' ').slice(0, 2).join(' ')}\n`);

for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
  try {
    await db.exec(sql);
    console.log(`  ok    ${f}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${f}\n        ${err.message}`);
    console.log('\nAborting: later migrations depend on this one.');
    process.exit(1);
  }
}

console.log('\n--- trigger: auto-provisioned profiles ---');

// metadata username wins
await db.query(`INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('a@x.com', '{"username":"bassface"}')`);
// no metadata -> email prefix
await db.query(`INSERT INTO auth.users (email) VALUES ('dj.nova@x.com')`);
// no metadata, no email -> phone
await db.query(`INSERT INTO auth.users (phone) VALUES ('+15551234567')`);
// collides with the email-prefix user above -> must uniquify, not throw
await db.query(`INSERT INTO auth.users (email) VALUES ('dj.nova@other.com')`);
// nothing at all -> uid fallback
await db.query(`INSERT INTO auth.users DEFAULT VALUES`);

const profs = await db.query(`SELECT username, phone, role FROM profiles ORDER BY username`);
const names = profs.rows.map((r) => r.username);
check('profile row created per auth user', profs.rows.length === 5, `got ${profs.rows.length}`);
check('metadata username used', names.includes('bassface'));
check('email prefix used when metadata blank', names.includes('dj.nova'));
check('phone used when no email', names.includes('+15551234567'));
check('duplicate email prefix uniquified', names.includes('dj.nova1'), `got ${JSON.stringify(names)}`);
check('anonymous user still gets a username', names.some((n) => n && n.startsWith('raver_')));
check('role defaults to concert_goer', profs.rows.every((r) => r.role === 'concert_goer'));

console.log('\n--- friendships: order-independent uniqueness ---');
const [u1, u2] = (await db.query(`SELECT id FROM auth.users ORDER BY created_at LIMIT 2`)).rows.map((r) => r.id);
await db.query(`INSERT INTO friendships (user_id_1, user_id_2) VALUES ($1, $2)`, [u1, u2]);
let dupBlocked = false;
try {
  await db.query(`INSERT INTO friendships (user_id_1, user_id_2) VALUES ($1, $2)`, [u2, u1]);
} catch {
  dupBlocked = true;
}
check('reversed pair rejected as duplicate', dupBlocked);

let selfBlocked = false;
try {
  await db.query(`INSERT INTO friendships (user_id_1, user_id_2) VALUES ($1, $1)`, [u1]);
} catch {
  selfBlocked = true;
}
check('self-friendship rejected', selfBlocked);

console.log('\n--- attendance: unique per user+event ---');
// Ids are captured, never assumed: 0013 seeds real markets during migration,
// so the fixtures no longer land on id 1.
const marketId = (await db.query(
  `INSERT INTO markets (slug, name, state) VALUES ('test-market', 'Test', 'AZ') RETURNING id`)).rows[0].id;
const venueId = (await db.query(
  `INSERT INTO venues (market_id, name) VALUES ($1, 'Test Venue') RETURNING id`, [marketId])).rows[0].id;
const testEventId = (await db.query(
  `INSERT INTO events (venue_id, title, event_date) VALUES ($1, 'Test Show', CURRENT_DATE + 1) RETURNING id`,
  [venueId])).rows[0].id;
await db.query(`INSERT INTO event_attendance (user_id, event_id, status) VALUES ($1, $2, 'going')`, [u1, testEventId]);
let dupAttend = false;
try {
  await db.query(`INSERT INTO event_attendance (user_id, event_id) VALUES ($1, $2)`, [u1, testEventId]);
} catch {
  dupAttend = true;
}
check('duplicate attendance rejected', dupAttend);

let badStatus = false;
try {
  await db.query(`INSERT INTO event_attendance (user_id, event_id, status) VALUES ($1, $2, 'nonsense')`, [u2, testEventId]);
} catch {
  badStatus = true;
}
check('invalid attendance status rejected', badStatus);

console.log('\n--- column privileges: actually try the attacks as the API roles ---');

// Impersonate the real API roles rather than trusting information_schema: a
// grant that looks right can still be overridden by a table-level privilege.
// SET ROLE, not SET LOCAL ROLE: outside a transaction SET LOCAL silently does
// nothing, so every "attack" would run as the superuser — which bypasses both
// privileges and RLS and makes the whole section pass or fail meaninglessly.
const asRole = async (role, sql, params) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    const r = await db.query(sql, params);
    return { ok: true, rows: r.rows };
  } catch (err) {
    return { ok: false, err: err.message };
  } finally {
    await db.exec('RESET ROLE');
  }
};

check('anon can read public profile columns',
  (await asRole('anon', 'SELECT username, avatar_url FROM profiles LIMIT 1')).ok);

const leakToken = await asRole('anon', 'SELECT spotify_access_token FROM profiles LIMIT 1');
check('anon CANNOT read spotify_access_token', !leakToken.ok, leakToken.ok ? 'LEAKED' : '');

const leakRefresh = await asRole('authenticated', 'SELECT spotify_refresh_token FROM profiles LIMIT 1');
check('authenticated CANNOT read spotify_refresh_token', !leakRefresh.ok, leakRefresh.ok ? 'LEAKED' : '');

const leakPhone = await asRole('anon', 'SELECT phone FROM profiles LIMIT 1');
check('anon CANNOT read phone', !leakPhone.ok, leakPhone.ok ? 'LEAKED' : '');

const starSelect = await asRole('anon', 'SELECT * FROM profiles LIMIT 1');
check('anon SELECT * is refused rather than leaking', !starSelect.ok,
  starSelect.ok ? 'returned ' + JSON.stringify(Object.keys(starSelect.rows[0] ?? {})) : '');

console.log('\n--- privilege escalation: role column must not be self-writable ---');
await db.exec(`SELECT set_config('test.uid', '${u1}', false)`);
const escalate = await asRole('authenticated', `UPDATE profiles SET role = 'admin' WHERE id = $1`, [u1]);
check('authenticated CANNOT promote itself to admin', !escalate.ok, escalate.ok ? 'ESCALATED' : '');

const renameOk = await asRole('authenticated', `UPDATE profiles SET full_name = 'Renamed' WHERE id = $1`, [u1]);
check('authenticated CAN still update its own safe columns', renameOk.ok, renameOk.err ?? '');

const stillGoer = (await db.query(`SELECT role FROM profiles WHERE id = $1`, [u1])).rows[0].role;
check('role unchanged after escalation attempt', stillGoer === 'concert_goer', `role=${stillGoer}`);

console.log('\n--- vibe taxonomy: chaotic spotify tags -> master vibes ---');
const vibeOf = async (tags) =>
  (await db.query(`SELECT vibes_for_tags($1::varchar[]) AS v`, [tags])).rows[0].v.sort();

check('tech house -> house_techno', (await vibeOf(['tech house'])).includes('house_techno'));
check('melodic techno -> house_techno', (await vibeOf(['melodic techno'])).includes('house_techno'));
check('riddim -> bass_dubstep', (await vibeOf(['riddim'])).includes('bass_dubstep'));
check('drum and bass -> bass_dubstep', (await vibeOf(['drum and bass'])).includes('bass_dubstep'));
check('psytrance -> trance_progressive', (await vibeOf(['psytrance'])).includes('trance_progressive'));
check('big room -> mainstage_edm', (await vibeOf(['big room'])).includes('mainstage_edm'));
check('ambient -> underground_experimental', (await vibeOf(['ambient'])).includes('underground_experimental'));
check('unknown tag -> no vibe', (await vibeOf(['baroque'])).length === 0);
check('null tags -> empty, not error', (await vibeOf(null)).length === 0);

// The taxonomy is a table so patterns can be added without a migration. That
// only holds if vibes_for_tags is STABLE — declaring it IMMUTABLE (it reads a
// table) lets the planner fold the call and ignore new rows.
check('tag is unmatched before its pattern exists', (await vibeOf(['hardgroove'])).length === 0);
await db.query(`INSERT INTO vibe_taxonomy (vibe, pattern) VALUES ('house_techno', '%hardgroove%')`);
check('newly inserted pattern takes effect without a migration',
  (await vibeOf(['hardgroove'])).includes('house_techno'));
await db.query(`DELETE FROM vibe_taxonomy WHERE pattern = '%hardgroove%'`);
check('removing a pattern takes effect too', (await vibeOf(['hardgroove'])).length === 0);
// progressive house contains "house": both classifications are defensible and
// an event carrying two vibes is intended, so assert it rather than fight it.
check('progressive house -> trance_progressive (and house_techno)',
  (await vibeOf(['progressive house'])).includes('trance_progressive'));

console.log('\n--- get_filtered_events: timeframe windows ---');
// Seed dated shows relative to the same market-local today the function uses.
const today = (await db.query(`SELECT (now() AT TIME ZONE 'America/Phoenix')::date AS d`)).rows[0].d;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const plus = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};

await db.query(`INSERT INTO artists (name, genre_tags) VALUES
  ('Techno Person', ARRAY['tech house','minimal']::varchar[]),
  ('Bass Person', ARRAY['riddim','dubstep']::varchar[]),
  ('Trance Person', ARRAY['psytrance']::varchar[])`);
await db.query(`INSERT INTO events (venue_id, title, event_date, doors_time) VALUES
  ($4, 'Tonight Techno', $1, '22:00'),
  ($4, 'In Three Days Bass', $2, '21:00'),
  ($4, 'In 20 Days Trance', $3, '20:00')`, [plus(0), plus(3), plus(20), venueId]);
const evIds = (await db.query(`SELECT id, title FROM events ORDER BY id`)).rows;
const byTitle = Object.fromEntries(evIds.map((r) => [r.title, r.id]));
await db.query(`INSERT INTO lineups (event_id, artist_id, performance_order) VALUES
  ($1, (SELECT id FROM artists WHERE name='Techno Person'), 1),
  ($2, (SELECT id FROM artists WHERE name='Bass Person'), 1),
  ($3, (SELECT id FROM artists WHERE name='Trance Person'), 1)`,
  [byTitle['Tonight Techno'], byTitle['In Three Days Bass'], byTitle['In 20 Days Trance']]);

const feed = async (tf, vibe) =>
  (await db.query(`SELECT title, vibes FROM get_filtered_events('test-market', $1, $2)`, [tf, vibe])).rows.map((r) => r.title);

// The feed cards need more than names: an id for Vibe Check playback and the
// profile urls for the icons. 0009 exists because 0008 returned names only.
const lineupRow = (await db.query(
  `SELECT artists FROM get_filtered_events('test-market', 'all', null) WHERE title = 'Tonight Techno'`)).rows[0];
const lineup = lineupRow.artists;
check('artists is a JSON array on the feed row', Array.isArray(lineup) && lineup.length === 1, JSON.stringify(lineup));
check('lineup artist carries id', typeof lineup[0]?.id === 'number', JSON.stringify(lineup[0]));
check('lineup artist carries name', lineup[0]?.name === 'Techno Person');
check('lineup artist carries the profile url fields', 'spotify_url' in (lineup[0] ?? {}) && 'soundcloud_url' in (lineup[0] ?? {}));

const emptyLineup = (await db.query(
  `SELECT artists FROM get_filtered_events('test-market', 'all', null) WHERE title = 'Test Show'`)).rows[0].artists;
check('event with no lineup returns [] not null', Array.isArray(emptyLineup) && emptyLineup.length === 0, JSON.stringify(emptyLineup));

// Billing order is the DB's job; the client should not have to re-sort.
await db.query(`INSERT INTO artists (name, genre_tags) VALUES ('Opener Person', ARRAY['techno']::varchar[])`);
await db.query(`INSERT INTO lineups (event_id, artist_id, performance_order)
  VALUES ((SELECT id FROM events WHERE title='Tonight Techno'), (SELECT id FROM artists WHERE name='Opener Person'), 0)`);
const ordered = (await db.query(
  `SELECT artists FROM get_filtered_events('test-market', 'all', null) WHERE title = 'Tonight Techno'`)).rows[0].artists;
check('lineup comes back in performance_order',
  ordered.map((a) => a.name).join(',') === 'Opener Person,Techno Person', JSON.stringify(ordered.map((a) => a.name)));

const todayFeed = await feed('today', null);
check("timeframe 'today' returns only today's show", todayFeed.length === 1 && todayFeed[0] === 'Tonight Techno', JSON.stringify(todayFeed));

const weekFeed = await feed('this_week', null);
check("timeframe 'this_week' includes today + 3 days, excludes +20", weekFeed.includes('Tonight Techno') && weekFeed.includes('In Three Days Bass') && !weekFeed.includes('In 20 Days Trance'), JSON.stringify(weekFeed));

const monthFeed = await feed('next_month', null);
check("timeframe 'next_month' includes the +20 show", monthFeed.includes('In 20 Days Trance'), JSON.stringify(monthFeed));

const allFeed = await feed('all', null);
// 4, not 3: 'Test Show' (today+1) was seeded earlier for the attendance tests.
check("timeframe 'all' returns every upcoming show", allFeed.length === 4, JSON.stringify(allFeed));

let badTf = false;
try { await feed('nonsense', null); } catch { badTf = true; }
check('unknown timeframe raises rather than silently returning all', badTf);

console.log('\n--- get_filtered_events: vibe filter ---');
const bassFeed = await feed('all', 'bass_dubstep');
check("vibe 'bass_dubstep' isolates the bass show", bassFeed.length === 1 && bassFeed[0] === 'In Three Days Bass', JSON.stringify(bassFeed));
const houseFeed = await feed('all', 'house_techno');
check("vibe 'house_techno' isolates the techno show", houseFeed.includes('Tonight Techno') && !houseFeed.includes('In Three Days Bass'), JSON.stringify(houseFeed));
const noneFeed = await feed('all', 'mainstage_edm');
check("vibe with no matches returns empty", noneFeed.length === 0, JSON.stringify(noneFeed));

// 0011: events whose artists produced no genre tags are invisible to every
// named filter, so 'other' gives them a home instead of vanishing.
const otherFeed = await feed('all', 'other');
check("'other' returns the ungenred shows", otherFeed.includes('Test Show'), JSON.stringify(otherFeed));
check("'other' excludes shows that DO have a genre", !otherFeed.includes('Tonight Techno'), JSON.stringify(otherFeed));
const allFeed2 = await feed('all', null);
check("every show is reachable via all = genred + other",
  allFeed2.length === otherFeed.length + allFeed2.filter((t) => !otherFeed.includes(t)).length,
  `all=${allFeed2.length} other=${otherFeed.length}`);

console.log('\n--- timeframe_window: this_weekend across every weekday ---');
// Fixed, known dates rather than offsets from "today", and asserted against the
// SQL's real output — an earlier version of this test recomputed the window in
// JS and compared it to itself, which proved nothing.
// 2026-07-13 is a Monday, so this walks Mon..Sun.
const WEEK = [
  ['2026-07-13', 'Monday', '2026-07-17', '2026-07-19'],
  ['2026-07-14', 'Tuesday', '2026-07-17', '2026-07-19'],
  ['2026-07-15', 'Wednesday', '2026-07-17', '2026-07-19'],
  ['2026-07-16', 'Thursday', '2026-07-17', '2026-07-19'],
  ['2026-07-17', 'Friday', '2026-07-17', '2026-07-19'],
  // Saturday: weekend already underway — starts today, not next Friday.
  ['2026-07-18', 'Saturday', '2026-07-18', '2026-07-19'],
  // Sunday: last day of the weekend.
  ['2026-07-19', 'Sunday', '2026-07-19', '2026-07-19'],
];
for (const [day, label, wantStart, wantEnd] of WEEK) {
  const r = (await db.query(
    `SELECT range_start::text AS s, range_end::text AS e FROM timeframe_window('this_weekend', $1::date)`, [day])).rows[0];
  check(`${label} ${day} -> ${wantStart}..${wantEnd}`, r.s === wantStart && r.e === wantEnd, `got ${r.s}..${r.e}`);
}

// Sanity: the fixture dates really are the weekdays claimed.
const dowCheck = (await db.query(
  `SELECT EXTRACT(DOW FROM '2026-07-13'::date) AS mon, EXTRACT(DOW FROM '2026-07-19'::date) AS sun`)).rows[0];
check('fixture dates are really Mon..Sun', Number(dowCheck.mon) === 1 && Number(dowCheck.sun) === 0,
  `mon dow=${dowCheck.mon} sun dow=${dowCheck.sun}`);

const wk = (await db.query(`SELECT range_start::text AS s, range_end::text AS e FROM timeframe_window('this_week', '2026-07-16'::date)`)).rows[0];
check('this_week spans today..+7', wk.s === '2026-07-16' && wk.e === '2026-07-23', `got ${wk.s}..${wk.e}`);
const nm = (await db.query(`SELECT range_start::text AS s, range_end::text AS e FROM timeframe_window('next_month', '2026-07-16'::date)`)).rows[0];
check('next_month spans today..+30', nm.s === '2026-07-16' && nm.e === '2026-08-15', `got ${nm.s}..${nm.e}`);

console.log('\n--- get_personalized_recommendations ---');
// u1 loves the bass artist directly, and techno by genre affinity.
await db.query(`INSERT INTO user_favorite_artists (user_id, artist_id)
  VALUES ($1, (SELECT id FROM artists WHERE name='Bass Person'))`, [u1]);
await db.query(`INSERT INTO user_favorite_genres (user_id, genre, affinity_score)
  VALUES ($1, 'tech house', 3)`, [u1]);

const recs = (await db.query(
  `SELECT title, match_score, matched_artists, matched_genres
   FROM get_personalized_recommendations($1, $2)`, [u1, marketId])).rows;
const recTitles = recs.map((r) => r.title);
check('recommends the show with the favorited artist', recTitles.includes('In Three Days Bass'), JSON.stringify(recTitles));
check('recommends the show matching a favorite genre', recTitles.includes('Tonight Techno'));
check('does not recommend unmatched shows', !recTitles.includes('In 20 Days Trance'), JSON.stringify(recTitles));
check('direct artist match outranks genre-only match',
  recs[0]?.title === 'In Three Days Bass', `order=${JSON.stringify(recTitles)}`);
check('matched_artists is populated', (recs[0]?.matched_artists ?? []).includes('Bass Person'));

// Test Show (event 1) already has an attendance row for u1 from earlier.
await db.query(`INSERT INTO user_favorite_genres (user_id, genre, affinity_score) VALUES ($1, 'riddim', 5)
  ON CONFLICT DO NOTHING`, [u1]);
const recIds = (await db.query(`SELECT event_id FROM get_personalized_recommendations($1, $2)`, [u1, marketId])).rows.map((r) => r.event_id);
check('already-logged events are excluded from recommendations', !recIds.includes(testEventId), JSON.stringify(recIds));

const noTaste = (await db.query(`SELECT * FROM get_personalized_recommendations($1, $2)`, [u2, marketId])).rows;
check('user with no taste profile gets no recommendations', noTaste.length === 0);

console.log('\n--- 0012: festivals + live-set columns ---');
// Seeded heuristic: keyword OR >=8 artists. 'Tonight Techno' has 2 artists and
// no keyword, so it must NOT be flagged.
await db.query(`INSERT INTO events (venue_id, title, event_date, doors_time) VALUES
  ($1, 'Testville Music Festival', CURRENT_DATE + 2, '14:00')`, [venueId]);
await db.query(`UPDATE events e SET is_festival = true
  WHERE e.is_festival = false AND (e.title ~* '\\y(festival|fest|massive|carnival)\\y'
    OR (SELECT count(*) FROM lineups l WHERE l.event_id = e.id) >= 8)`);

const fests = (await db.query(`SELECT title FROM events WHERE is_festival`)).rows.map((r) => r.title);
check('keyword seeds a festival', fests.includes('Testville Music Festival'), JSON.stringify(fests));
check('an ordinary 2-artist show is not flagged', !fests.includes('Tonight Techno'), JSON.stringify(fests));

const festFeed = (await db.query(
  `SELECT title FROM get_filtered_events('test-market', 'all', null, true)`)).rows.map((r) => r.title);
check('festivals_only returns just festivals', festFeed.every((t) => fests.includes(t)) && festFeed.length > 0, JSON.stringify(festFeed));
const allFeed3 = (await db.query(
  `SELECT title FROM get_filtered_events('test-market', 'all', null, false)`)).rows.map((r) => r.title);
check('festivals_only=false still returns everything', allFeed3.length > festFeed.length, `all=${allFeed3.length} fest=${festFeed.length}`);

const festRow = (await db.query(
  `SELECT is_festival, artists FROM get_filtered_events('test-market','all',null,true) LIMIT 1`)).rows[0];
check('row exposes is_festival', festRow.is_festival === true);
check('artists JSON now carries mixcloud_url',
  'mixcloud_url' in ((await db.query(
    `SELECT artists FROM get_filtered_events('test-market','all',null,false) WHERE title='Tonight Techno'`)).rows[0].artists[0] ?? {}));

console.log('\n--- 0016: featured placement + promoter attribution ---');
// A featured show later the same day must outrank an earlier unfeatured one,
// but must NOT jump ahead of an earlier day.
const promoId = (await db.query(
  `INSERT INTO promoters (name) VALUES ('Bass Promotions') RETURNING id`)).rows[0].id;
await db.query(
  `INSERT INTO events (venue_id, title, event_date, doors_time, is_featured, promoter_id)
   VALUES ($1, 'Paid Placement', $2, '23:30', true, $3)`,
  [venueId, plus(0), promoId]);

const dayOne = (await db.query(
  `SELECT title, is_featured, promoter_name FROM get_filtered_events('test-market','all',null,false)
   WHERE event_date = $1`, [plus(0)])).rows;
check('featured event sorts first within its day',
  dayOne[0]?.title === 'Paid Placement', JSON.stringify(dayOne.map((r) => r.title)));
check('is_featured is exposed on the row', dayOne[0]?.is_featured === true);
check('promoter_name is exposed', dayOne[0]?.promoter_name === 'Bass Promotions', JSON.stringify(dayOne[0]));

const wholeFeed = (await db.query(
  `SELECT title, event_date FROM get_filtered_events('test-market','all',null,false)`)).rows;
// Compare as timestamps: String(Date) gives "Mon Jul 20 …", which sorts
// alphabetically by weekday and would call a correct order broken.
const dates = wholeFeed.map((r) => new Date(r.event_date).getTime());
check('featured does NOT jump the calendar — dates stay ascending',
  dates.every((d, i) => i === 0 || dates[i - 1] <= d),
  JSON.stringify(wholeFeed.slice(0, 6).map((r) => new Date(r.event_date).toISOString().slice(0, 10))));
check('unfeatured events still carry is_featured=false',
  wholeFeed.length > 1 && (await db.query(
    `SELECT is_featured FROM get_filtered_events('test-market','all',null,false)
     WHERE title = 'Tonight Techno'`)).rows[0].is_featured === false);

console.log('\n--- 0015: promoters readable, billing fields withheld ---');
await db.query(`INSERT INTO promoters (name, website, stripe_customer_id)
  VALUES ('Test Promoter', 'https://x.test', 'cus_secret123')`);
const promoRead = await asRole('anon', `SELECT id, name, is_verified FROM promoters LIMIT 1`);
check('anon can now read promoter names', promoRead.ok, promoRead.err ?? '');
const promoBilling = await asRole('anon', `SELECT stripe_customer_id FROM promoters LIMIT 1`);
check('anon CANNOT read stripe_customer_id', !promoBilling.ok, promoBilling.ok ? 'LEAKED' : '');
const promoStar = await asRole('anon', `SELECT * FROM promoters LIMIT 1`);
check('anon SELECT * on promoters fails closed', !promoStar.ok, promoStar.ok ? 'LEAKED' : '');

console.log('\n--- 0014/0017: ticket click tracking ---');
await db.exec(`SELECT set_config('test.uid', '${u1}', false)`);

// Direct writes are revoked; everything goes through the RPC now.
const directInsert = await asRole('authenticated', `INSERT INTO ticket_clicks (event_id) VALUES ($1)`, [testEventId]);
check('clients can no longer INSERT directly', !directInsert.ok, directInsert.ok ? 'WRITABLE' : '');

// auth.uid() here reads a GUC, so a genuinely anonymous caller means clearing
// it — otherwise the "anon" role still carries a uid and the row is attributed.
await db.exec(`SELECT set_config('test.uid', '', false)`);
const rpcAnon = await asRole('anon', `SELECT log_ticket_click($1)`, [testEventId]);
check('anon can log through the RPC', rpcAnon.ok, rpcAnon.err ?? '');
await db.exec(`SELECT set_config('test.uid', '${u1}', false)`);

const rpcUser = await asRole('authenticated', `SELECT log_ticket_click($1)`, [testEventId]);
check('a signed-in user can log through the RPC', rpcUser.ok, rpcUser.err ?? '');

// user_id is stamped from auth.uid(), so a caller cannot forge attribution.
const attributed = (await db.query(`SELECT user_id FROM ticket_clicks WHERE user_id IS NOT NULL`)).rows;
check('the RPC stamps the caller, not a client-supplied id',
  attributed.length === 1 && attributed[0].user_id === u1, JSON.stringify(attributed));

// Double-tap / refresh loop collapses for a signed-in user.
await asRole('authenticated', `SELECT log_ticket_click($1)`, [testEventId]);
await asRole('authenticated', `SELECT log_ticket_click($1)`, [testEventId]);
const afterRepeat = (await db.query(`SELECT count(*)::int AS n FROM ticket_clicks WHERE user_id = $1`, [u1])).rows[0].n;
check('repeat clicks within the window are collapsed', afterRepeat === 1, `got ${afterRepeat}`);

// Orphan ids are rejected rather than accumulating.
await db.exec(`SELECT set_config('test.uid', '', false)`);
await asRole('anon', `SELECT log_ticket_click(999999)`);
await db.exec(`SELECT set_config('test.uid', '${u1}', false)`);
const orphans = (await db.query(`SELECT count(*)::int AS n FROM ticket_clicks WHERE event_id = 999999`)).rows[0].n;
check('clicks for a nonexistent event are dropped', orphans === 0, `got ${orphans}`);

const readBack = await asRole('authenticated', `SELECT * FROM ticket_clicks`);
check('clients still cannot read the click log', !readBack.ok, readBack.ok ? 'READABLE' : '');

const stats = (await db.query(`SELECT clicks, signed_in_users FROM ticket_click_stats`)).rows;
check('service role sees the rollup', stats.length === 1 && Number(stats[0].clicks) === 2, JSON.stringify(stats));
check('signed-in users counted separately from anonymous',
  Number(stats[0].signed_in_users) === 1, JSON.stringify(stats));


console.log('\n--- friend graph ---');
// Fresh users with known usernames (the trigger derives username from metadata).
for (const name of ['alice', 'bob', 'carol', 'dave']) {
  await db.query(`INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2)`,
    [`${name}@x.com`, JSON.stringify({ username: name })]);
}
const idOf = Object.fromEntries(
  (await db.query(`SELECT id, username FROM profiles WHERE username IN ('alice','bob','carol','dave')`)).rows.map((r) => [r.username, r.id])
);
// auth.uid() in every function reads this GUC; set it to impersonate.
const as = async (uid) => db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
const rpc1 = async (sql, params) => (await db.query(sql, params)).rows[0];

await as(idOf.alice);
check('send to unknown username -> not_found',
  (await rpc1(`SELECT send_friend_request('nobody') AS r`)).r === 'not_found');
check('send to self -> self',
  (await rpc1(`SELECT send_friend_request('alice') AS r`)).r === 'self');
check('send to bob -> sent',
  (await rpc1(`SELECT send_friend_request('bob') AS r`)).r === 'sent');
check('sending again while pending -> already_pending',
  (await rpc1(`SELECT send_friend_request('bob') AS r`)).r === 'already_pending');

// Bob sees the incoming request; Alice (the requester) does not.
await as(idOf.bob);
const bobIncoming = (await db.query(`SELECT request_id, username FROM list_incoming_requests()`)).rows;
check('recipient sees the incoming request', bobIncoming.length === 1 && bobIncoming[0].username === 'alice', JSON.stringify(bobIncoming));
await as(idOf.alice);
check('requester does not see it as incoming',
  (await db.query(`SELECT * FROM list_incoming_requests()`)).rows.length === 0);

// Consent: the requester cannot accept their own request.
let selfAcceptBlocked = false;
try { await db.query(`SELECT respond_to_friend_request($1, true)`, [bobIncoming[0].request_id]); }
catch { selfAcceptBlocked = true; }
check('requester cannot accept their own request', selfAcceptBlocked);

// Bob accepts.
await as(idOf.bob);
check('recipient accepts -> accepted',
  (await rpc1(`SELECT respond_to_friend_request($1, true) AS r`, [bobIncoming[0].request_id]).then((r) => r)).r === 'accepted');

// Both now list each other as friends.
await as(idOf.alice);
const aliceFriends = (await db.query(`SELECT username FROM list_friends()`)).rows.map((r) => r.username);
check('alice lists bob as friend', aliceFriends.includes('bob'), JSON.stringify(aliceFriends));
await as(idOf.bob);
const bobFriends = (await db.query(`SELECT username FROM list_friends()`)).rows.map((r) => r.username);
check('bob lists alice as friend', bobFriends.includes('alice'), JSON.stringify(bobFriends));

await as(idOf.alice);
check('re-sending to an accepted friend -> already_friends',
  (await rpc1(`SELECT send_friend_request('bob') AS r`)).r === 'already_friends');

// Reverse-pending auto-accept: carol requests alice, then alice sends to carol.
await as(idOf.carol);
await db.query(`SELECT send_friend_request('alice')`);
await as(idOf.alice);
check('sending back to a pending requester -> accepted',
  (await rpc1(`SELECT send_friend_request('carol') AS r`)).r === 'accepted');
check('alice now has two friends', (await db.query(`SELECT * FROM list_friends()`)).rows.length === 2);

// Unfriend.
check('remove_friend drops the edge',
  await db.query(`SELECT remove_friend($1)`, [idOf.carol]).then(async () =>
    (await db.query(`SELECT username FROM list_friends()`)).rows.every((r) => r.username !== 'carol')));

console.log('\n--- friends_going: social proof, friends only ---');
// alice & bob are friends. dave is a stranger to alice. All three RSVP event 1.
await db.query(`INSERT INTO event_attendance (user_id, event_id, status) VALUES
  ($1, $4, 'going'), ($2, $4, 'going'), ($3, $4, 'going')
  ON CONFLICT (user_id, event_id) DO NOTHING`, [idOf.alice, idOf.bob, idOf.dave, testEventId]);

await as(idOf.alice);
const aliceSeesGoing = (await db.query(`SELECT username FROM friends_going($1)`, [testEventId])).rows.map((r) => r.username);
check('alice sees her friend bob going', aliceSeesGoing.includes('bob'), JSON.stringify(aliceSeesGoing));
check('alice does NOT see the stranger dave', !aliceSeesGoing.includes('dave'), JSON.stringify(aliceSeesGoing));
check('friends_going excludes the caller themselves', !aliceSeesGoing.includes('alice'), JSON.stringify(aliceSeesGoing));

// dave, friend of nobody, sees no one going even though bob and alice are.
await as(idOf.dave);
check('a friendless user sees no friends going',
  (await db.query(`SELECT * FROM friends_going($1)`, [testEventId])).rows.length === 0);

// Anonymous (no test.uid) leaks nothing.
await db.exec(`SELECT set_config('test.uid', '', false)`);
check('anon caller sees no friends going',
  (await db.query(`SELECT * FROM friends_going($1)`, [testEventId])).rows.length === 0);

console.log('\n--- 0018: growth + monetization ---');
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

// --- contact matching: the enumeration guards are the point ---
const noPhone = await asRole('authenticated', `SELECT * FROM get_contacts_on_dscovr(ARRAY['6025550147'])`);
check('caller without a phone is refused (enumeration needs a real identity)',
  !noPhone.ok, noPhone.ok ? 'ALLOWED' : '');

await db.query(`UPDATE profiles SET phone = '+1 (602) 555-0100' WHERE id = $1`, [idOf.alice]);
await db.query(`UPDATE profiles SET phone = '602-555-0199' WHERE id = $1`, [idOf.bob]);

const matched = await asRole('authenticated', `SELECT username FROM get_contacts_on_dscovr($1)`,
  [['(602) 555-0199', '6025550000']]);
check('matches a contact across different phone formats',
  matched.ok && matched.rows.length === 1 && matched.rows[0].username === 'bob', JSON.stringify(matched.rows ?? matched.err));
check('unknown numbers reveal nothing', (matched.rows ?? []).length === 1);

const selfMatch = await asRole('authenticated', `SELECT username FROM get_contacts_on_dscovr($1)`,
  [['602-555-0100']]);
check('caller never matches themselves', (selfMatch.rows ?? []).length === 0, JSON.stringify(selfMatch.rows));

const tooMany = await asRole('authenticated',
  `SELECT * FROM get_contacts_on_dscovr($1)`, [Array.from({ length: 501 }, (_, i) => String(6025550000 + i))]);
check('oversized batches are rejected (no range sweeping)', !tooMany.ok, tooMany.ok ? 'ALLOWED' : '');

const contactCols = await asRole('authenticated', `SELECT phone FROM get_contacts_on_dscovr(ARRAY['6025550199'])`);
check('the result never exposes a phone number', !contactCols.ok, contactCols.ok ? 'LEAKED' : '');

// --- batched social proof keeps the friends-only boundary ---
const batch = await asRole('authenticated', `SELECT event_id, username FROM friends_going_batch($1)`, [[testEventId]]);
check('batch social proof returns friends', batch.ok && batch.rows.some((r) => r.username === 'bob'),
  JSON.stringify(batch.rows ?? batch.err));
check('batch social proof still excludes strangers',
  !(batch.rows ?? []).some((r) => r.username === 'dave'), JSON.stringify(batch.rows));

await db.exec(`SELECT set_config('test.uid', '', false)`);
const batchAnon = await asRole('anon', `SELECT * FROM friends_going_batch($1)`, [[testEventId]]);
check('anon sees nobody in the batch', (batchAnon.rows ?? []).length === 0);
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

// --- VIP leads carry a phone, so they are locked down like one ---
const vipInsert = await asRole('authenticated',
  `INSERT INTO vip_inquiries (event_id, user_id, phone, group_size) VALUES ($1, $2, '6025550100', 6)`,
  [testEventId, idOf.alice]);
check('a user can submit their own VIP inquiry', vipInsert.ok, vipInsert.err ?? '');

const vipSpoof = await asRole('authenticated',
  `INSERT INTO vip_inquiries (event_id, user_id, phone) VALUES ($1, $2, '6025559999')`,
  [testEventId, idOf.dave]);
check('a user cannot submit an inquiry as someone else', !vipSpoof.ok, vipSpoof.ok ? 'SPOOFED' : '');

const vipPhone = await asRole('authenticated', `SELECT phone FROM vip_inquiries`);
check('the lead phone is not readable by clients', !vipPhone.ok, vipPhone.ok ? 'LEAKED' : '');

await db.exec(`SELECT set_config('test.uid', '${idOf.bob}', false)`);
const vipOther = await asRole('authenticated', `SELECT id FROM vip_inquiries`);
check('a user cannot read another user inquiry', (vipOther.rows ?? []).length === 0, JSON.stringify(vipOther.rows));
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

// --- demand analytics suppresses small cells ---
const demand = (await db.query(`SELECT * FROM promoter_market_demand`)).rows;
check('cells under 5 users are suppressed (no identifying individuals)',
  demand.every((r) => Number(r.users) >= 5), JSON.stringify(demand));

console.log('\n--- 0019: phone presence ---');
// alice + bob were given phones in the 0018 block; dave never was.
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);
const hasPhone = await asRole('authenticated', `SELECT current_user_has_phone() AS v`);
check('reports true for a user with a phone', hasPhone.ok && hasPhone.rows[0].v === true,
  JSON.stringify(hasPhone.rows ?? hasPhone.err));

await db.exec(`SELECT set_config('test.uid', '${idOf.dave}', false)`);
const noPhoneFlag = await asRole('authenticated', `SELECT current_user_has_phone() AS v`);
check('reports false for a user without one', noPhoneFlag.ok && noPhoneFlag.rows[0].v === false,
  JSON.stringify(noPhoneFlag.rows ?? noPhoneFlag.err));

// The whole point is that the flag never becomes the number.
const flagLeak = await asRole('authenticated', `SELECT phone FROM profiles WHERE id = auth.uid()`);
check('the number itself stays unreadable (flag is not a backdoor)',
  !flagLeak.ok, flagLeak.ok ? 'LEAKED' : '');

await db.exec(`SELECT set_config('test.uid', '', false)`);
const anonFlag = await asRole('anon', `SELECT current_user_has_phone() AS v`);
check('anon gets a plain false, not an error', anonFlag.ok && anonFlag.rows[0].v === false,
  JSON.stringify(anonFlag.rows ?? anonFlag.err));
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

console.log('\n--- 0020: source identity + liveness (Phase A) ---');

// Additive only: the columns must exist and accept NULL, because ~4,400
// existing rows have no source id until reconciliation fills them.
const addedCols = await db.query(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'events' AND column_name IN ('source_event_id', 'last_seen_at')
    ORDER BY column_name`);
check('events gains source_event_id + last_seen_at', addedCols.rows.length === 2,
  JSON.stringify(addedCols.rows));
check('both are nullable (existing rows must survive Phase A)',
  addedCols.rows.every((r) => r.is_nullable === 'YES'), JSON.stringify(addedCols.rows));

// NB: Phase A deliberately does NOT create the identity index — the backfill has
// to run first. That ordering can't be asserted here, because the harness
// applies every migration before any test runs, so by now 0021 has added it.
// The index's properties are asserted in the 0021 section instead.

// A row with no source id must still be insertable, and two of them must
// coexist — otherwise Phase A would break ingestion before Phase B can run.
const nullIds = await db.query(
  `INSERT INTO events (venue_id, title, event_date) VALUES ($1,'Null Id A', CURRENT_DATE + 40), ($1,'Null Id B', CURRENT_DATE + 40) RETURNING id`,
  [venueId]);
check('rows without a source_event_id still insert (and coexist)', nullIds.rows.length === 2);

console.log('\n--- 0020: ingest_runs is service-role only ---');
const runIns = await db.query(
  `INSERT INTO ingest_runs (source_type, market_id, started_at, status, events_seen)
   VALUES ('resident_advisor', $1, now(), 'complete', 12) RETURNING id`, [marketId]);
check('a run row can be recorded', runIns.rows.length === 1);

const badStatusRun = await db.query(`SELECT 1`).then(async () => {
  try { await db.query(`INSERT INTO ingest_runs (source_type, started_at, status) VALUES ('x', now(), 'nonsense')`); return false; }
  catch { return true; }
});
check('an invalid run status is rejected', badStatusRun);

// The point of the REVOKE: RLS with no policy would return zero rows, which is
// indistinguishable from "no runs yet". A hard permission denial is the goal.
await db.exec(`SELECT set_config('test.uid', '', false)`);
const anonRead = await asRole('anon', `SELECT * FROM ingest_runs`);
check('anon cannot read ingest_runs at all', !anonRead.ok, anonRead.ok ? 'READABLE' : '');
const authedRead = await asRole('authenticated', `SELECT * FROM ingest_runs`);
check('a signed-in user cannot read ingest_runs either', !authedRead.ok, authedRead.ok ? 'READABLE' : '');
const anonWrite = await asRole('authenticated',
  `INSERT INTO ingest_runs (source_type, started_at, status) VALUES ('forged', now(), 'complete')`);
check('clients cannot forge a run record', !anonWrite.ok, anonWrite.ok ? 'WROTE' : '');

// events stays publicly readable, so the new columns are readable too — they
// carry no secret. What matters is that they are not client-WRITABLE.
const anonSeesCols = await asRole('anon', `SELECT source_event_id, last_seen_at FROM events LIMIT 1`);
check('the new events columns are readable (events is public by design)', anonSeesCols.ok,
  anonSeesCols.err ?? '');
// An UPDATE with no matching UPDATE policy does not raise — RLS filters it to
// zero rows and the statement "succeeds". Asserting !ok would pass vacuously
// against a table that were fully writable, so assert the rows instead: nothing
// may come back, and the stored value must be untouched.
await db.query(`UPDATE events SET last_seen_at = TIMESTAMPTZ '2020-01-01 00:00:00+00' WHERE id = $1`,
  [testEventId]);
const anonWritesCol = await asRole('anon',
  `UPDATE events SET last_seen_at = now() WHERE id = $1 RETURNING id`, [testEventId]);
const stillOld = await db.query(`SELECT last_seen_at FROM events WHERE id = $1`, [testEventId]);
check('anon writes zero rows to last_seen_at',
  (anonWritesCol.rows ?? []).length === 0, JSON.stringify(anonWritesCol.rows ?? anonWritesCol.err));
check('and the stored last_seen_at is untouched',
  new Date(stillOld.rows[0].last_seen_at).getUTCFullYear() === 2020,
  String(stillOld.rows[0].last_seen_at));
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

console.log('\n--- 0021: source-identity cutover ---');

// The natural key is gone, so two sources may each hold their own row for the
// same real-world event. This is the cross-source split becoming POSSIBLE — the
// whole point of the cutover, and previously a unique violation that would have
// failed the run.
const twin = await db.query(
  `INSERT INTO events (venue_id, title, event_date, source_type, source_event_id)
   VALUES ($1,'Twin Night', CURRENT_DATE + 50, 'resident_advisor','ra-twin'),
          ($1,'Twin Night', CURRENT_DATE + 50, 'ticketmaster','tm-twin') RETURNING id`,
  [venueId]);
check('two sources can hold the same venue+title+date', twin.rows.length === 2,
  JSON.stringify(twin.rows));

const oldConstraint = await db.query(
  `SELECT conname FROM pg_constraint WHERE conname = 'unique_venue_title_date'`);
check('unique_venue_title_date is dropped', oldConstraint.rows.length === 0);

// Not partial: PostgREST's on_conflict takes column names only and cannot
// restate a predicate, so a partial index would be unusable as an upsert target.
const idxDef = await db.query(
  `SELECT indexdef FROM pg_indexes WHERE indexname = 'events_source_identity_uniq'`);
check('the identity unique index exists', idxDef.rows.length === 1);
check('and it is NOT partial (usable as a PostgREST on_conflict target)',
  idxDef.rows.length === 1 && !/where/i.test(idxDef.rows[0].indexdef),
  idxDef.rows[0]?.indexdef ?? 'missing');

let identityDupBlocked = false;
try {
  await db.query(
    `INSERT INTO events (venue_id, title, event_date, source_type, source_event_id)
     VALUES ($1,'Different Title', CURRENT_DATE + 51, 'resident_advisor','ra-twin')`, [venueId]);
} catch { identityDupBlocked = true; }
check('a repeated (source_type, source_event_id) is rejected', identityDupBlocked);

// Every one of the ~4,400 pre-reconciliation rows carries NULL here. If NULLs
// collided, creating this index would have failed outright — so this is the
// assertion that makes the phased rollout viable at all.
const nulls = await db.query(
  `INSERT INTO events (venue_id, title, event_date, source_type, source_event_id)
   VALUES ($1,'Unreconciled A', CURRENT_DATE + 52, 'ticketmaster', NULL),
          ($1,'Unreconciled B', CURRENT_DATE + 52, 'ticketmaster', NULL) RETURNING id`,
  [venueId]);
check('rows sharing a source_type with NULL ids still coexist', nulls.rows.length === 2);

const venueDateIdx = await db.query(
  `SELECT indexdef FROM pg_indexes WHERE indexname = 'events_venue_date_idx'`);
check('the (venue_id, event_date) blocking-key index exists', venueDateIdx.rows.length === 1);
check('and it is non-unique (venue+date collisions are legal now)',
  venueDateIdx.rows.length === 1 && !/unique/i.test(venueDateIdx.rows[0].indexdef),
  venueDateIdx.rows[0]?.indexdef ?? 'missing');

console.log('\n--- 0023: normalize_promoter_name ---');
const norm = async (s) => (await db.query(`SELECT normalize_promoter_name($1) AS n`, [s])).rows[0].n;
check('"INSOMNIAC PRESENTS" and "Insomniac" normalize equal',
  (await norm('INSOMNIAC PRESENTS')) === (await norm('Insomniac')),
  `${await norm('INSOMNIAC PRESENTS')} vs ${await norm('Insomniac')}`);
check('trailing corporate suffix + punctuation stripped',
  (await norm('Live Nation, LLC.')) === 'live nation', await norm('Live Nation, LLC.'));
check('mid-string "presents" is NOT stripped (trailing only)',
  (await norm('Bar Franca Presents Live')).includes('presents'), await norm('Bar Franca Presents Live'));
check('a name with no suffix is untouched but normalized',
  (await norm('Bar Franca')) === 'bar franca');
check('null-safe', (await norm(null)) === '');

console.log('\n--- 0023: promoters gains matching identity ---');
const promCols = await db.query(`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'promoters' AND column_name IN ('ingested_name', 'slug', 'primary_market_id')
    ORDER BY column_name`);
check('promoters gains ingested_name, primary_market_id, slug', promCols.rows.length === 3,
  JSON.stringify(promCols.rows));
const slugUniq = await db.query(
  `SELECT conname FROM pg_constraint WHERE conname = 'promoters_slug_uniq'`);
check('slug is unique', slugUniq.rows.length === 1);

console.log('\n--- 0023: resolve_promoter_alias — the matching rules ---');

// Rule 3 (normalized match against an existing promoter).
const insomniacPromoterId = (await db.query(
  `INSERT INTO promoters (name, ingested_name) VALUES ('Insomniac', 'Insomniac') RETURNING id`)).rows[0].id;
const rule3 = await db.query(
  `SELECT resolve_promoter_alias('INSOMNIAC PRESENTS', 'insomniac_test') AS id`);
check('rule 3: normalized match attaches an existing promoter',
  rule3.rows[0].id === insomniacPromoterId, String(rule3.rows[0].id));
const rule3Alias = await db.query(
  `SELECT status, promoter_id FROM promoter_aliases WHERE raw_string = 'INSOMNIAC PRESENTS' AND source_type = 'insomniac_test'`);
check('rule 3 marks the alias matched, not left unmatched',
  rule3Alias.rows[0]?.status === 'matched' && rule3Alias.rows[0]?.promoter_id === insomniacPromoterId,
  JSON.stringify(rule3Alias.rows[0]));

// Rule 1 (already matched — the exact same call again must not re-derive).
const rule1 = await db.query(
  `SELECT resolve_promoter_alias('INSOMNIAC PRESENTS', 'insomniac_test') AS id`);
check('rule 1: an already-matched alias returns the same promoter_id',
  rule1.rows[0].id === insomniacPromoterId);

// Rule 4 (no match anywhere — stays unmatched, NULL returned).
const rule4 = await db.query(
  `SELECT resolve_promoter_alias('Some Totally New Promoter Nobody Has Seen', 'insomniac_test') AS id`);
check('rule 4: unrecognized raw string returns NULL', rule4.rows[0].id === null);
const rule4Alias = await db.query(
  `SELECT status, occurrence_count FROM promoter_aliases WHERE raw_string = 'Some Totally New Promoter Nobody Has Seen'`);
check('rule 4 leaves the alias unmatched with occurrence_count 1',
  rule4Alias.rows[0]?.status === 'unmatched' && rule4Alias.rows[0]?.occurrence_count === 1,
  JSON.stringify(rule4Alias.rows[0]));

console.log('\n--- 0023: idempotency (criterion 5) ---');
await db.query(`SELECT resolve_promoter_alias('Repeat Offender', 'idem_test')`);
await db.query(`SELECT resolve_promoter_alias('Repeat Offender', 'idem_test')`);
await db.query(`SELECT resolve_promoter_alias('Repeat Offender', 'idem_test')`);
const repeatRows = await db.query(
  `SELECT occurrence_count FROM promoter_aliases WHERE raw_string = 'Repeat Offender' AND source_type = 'idem_test'`);
check('three calls with the same (raw_string, source_type) produce ONE row',
  repeatRows.rows.length === 1, `${repeatRows.rows.length} rows`);
check('occurrence_count is 3, not reset per call', repeatRows.rows[0]?.occurrence_count === 3,
  String(repeatRows.rows[0]?.occurrence_count));

console.log('\n--- 0023: human curation via the table editor (criterion 2) ---');
// Simulate: a raw string arrives unmatched, a human later edits the row by hand
// (exactly what the Supabase table editor does), then the next sync re-derives.
await db.query(`SELECT resolve_promoter_alias('Underrated Presents', 'curation_test')`);
const preEdit = await db.query(
  `SELECT status FROM promoter_aliases WHERE raw_string = 'Underrated Presents' AND source_type = 'curation_test'`);
check('starts unmatched, as any never-seen raw string does', preEdit.rows[0]?.status === 'unmatched');

const humanPickedPromoter = (await db.query(
  `INSERT INTO promoters (name, ingested_name) VALUES ('Underrated Presents', 'Underrated Presents') RETURNING id`)).rows[0].id;
await db.query(
  `UPDATE promoter_aliases SET status = 'matched', promoter_id = $1
   WHERE raw_string = 'Underrated Presents' AND source_type = 'curation_test'`, [humanPickedPromoter]);

const postEdit = await db.query(
  `SELECT resolve_promoter_alias('Underrated Presents', 'curation_test') AS id`);
check('re-running after a manual table-editor edit attaches the human-picked promoter — no code change, no deploy',
  postEdit.rows[0].id === humanPickedPromoter);

console.log('\n--- 0023: an "ignored" alias is never re-attached ---');
await db.query(`SELECT resolve_promoter_alias('Dj Magneto', 'ignore_test')`);
await db.query(
  `UPDATE promoter_aliases SET status = 'ignored' WHERE raw_string = 'Dj Magneto' AND source_type = 'ignore_test'`);
// Even if a promoter named exactly this were later created, an ignored alias
// must not silently start matching against it.
await db.query(`INSERT INTO promoters (name, ingested_name) VALUES ('Dj Magneto', 'Dj Magneto')`);
const ignored = await db.query(`SELECT resolve_promoter_alias('Dj Magneto', 'ignore_test') AS id`);
check('an ignored alias returns NULL even when a matching promoter now exists',
  ignored.rows[0].id === null);
const ignoredCount = await db.query(
  `SELECT occurrence_count, status FROM promoter_aliases WHERE raw_string = 'Dj Magneto' AND source_type = 'ignore_test'`);
check('but occurrence_count still advances — we are still seeing it',
  ignoredCount.rows[0]?.occurrence_count === 2 && ignoredCount.rows[0]?.status === 'ignored',
  JSON.stringify(ignoredCount.rows[0]));

console.log('\n--- 0023: data integrity ---');
let inconsistentBlocked = false;
try {
  await db.query(
    `INSERT INTO promoter_aliases (raw_string, source_type, status) VALUES ('bad', 'bad_test', 'matched')`);
} catch { inconsistentBlocked = true; }
check('a "matched" alias with no promoter_id is rejected (addition beyond the brief)',
  inconsistentBlocked);

console.log('\n--- 0023: promoter_aliases is service-role only ---');
await db.exec(`SELECT set_config('test.uid', '', false)`);
const anonSelect = await asRole('anon', `SELECT * FROM promoter_aliases`);
check('anon cannot read promoter_aliases', !anonSelect.ok, anonSelect.ok ? 'READABLE' : '');
const authSelect = await asRole('authenticated', `SELECT * FROM promoter_aliases`);
check('a signed-in user cannot read promoter_aliases either', !authSelect.ok, authSelect.ok ? 'READABLE' : '');
const anonExecute = await asRole('anon', `SELECT resolve_promoter_alias('x', 'y')`);
check('anon cannot call resolve_promoter_alias', !anonExecute.ok, anonExecute.ok ? 'EXECUTABLE' : '');
// Superseded by 0024: ingested_name becomes publicly readable for
// published/claimed promoters (the profile page needs to render it). Every
// promoter created in this 0023 section defaults to status='draft', so this
// still evaluates to "not readable" here — but now because the ROW is hidden
// by 0024's status-filtered policy, not because the column is ungranted. The
// positive case (a published promoter's ingested_name IS visible) is asserted
// in the 0024 section below, where it belongs.
const anonIngestedName = await asRole('anon', `SELECT ingested_name FROM promoters LIMIT 1`);
check('a draft promoter is invisible to anon regardless of column grants',
  (anonIngestedName.rows ?? []).length === 0,
  JSON.stringify(anonIngestedName.rows ?? anonIngestedName.err));
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

console.log('\n--- 0024: promoters.status ---');
const statusDefault = (await db.query(
  `INSERT INTO promoters (name, ingested_name) VALUES ('Draft Test Promoter', 'Draft Test Promoter') RETURNING status`)).rows[0].status;
check('status defaults to draft', statusDefault === 'draft', statusDefault);

let badStatusBlocked = false;
try {
  await db.query(`INSERT INTO promoters (name, status) VALUES ('Bad Status', 'nonsense')`);
} catch { badStatusBlocked = true; }
check('an invalid status is rejected', badStatusBlocked);

console.log('\n--- 0024: promoters RLS is status-filtered (0015\'s USING(true) is gone) ---');
const draftPromoterId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Hidden Promoter', 'Hidden Promoter', 'draft') RETURNING id`)).rows[0].id;
const publishedPromoterId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Visible Promoter', 'Visible Promoter', 'published') RETURNING id`)).rows[0].id;
const claimedPromoterId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Claimed Promoter', 'Claimed Promoter', 'claimed') RETURNING id`)).rows[0].id;

const anonDraft = await asRole('anon', `SELECT id FROM promoters WHERE id = $1`, [draftPromoterId]);
check('a draft promoter is invisible to anon', (anonDraft.rows ?? []).length === 0,
  JSON.stringify(anonDraft.rows ?? anonDraft.err));
const anonPublished = await asRole('anon', `SELECT id, ingested_name, slug, status FROM promoters WHERE id = $1`, [publishedPromoterId]);
check('a published promoter is visible to anon, with the new columns readable',
  anonPublished.ok && anonPublished.rows.length === 1 && anonPublished.rows[0].ingested_name === 'Visible Promoter',
  JSON.stringify(anonPublished.rows ?? anonPublished.err));
const anonClaimed = await asRole('anon', `SELECT id FROM promoters WHERE id = $1`, [claimedPromoterId]);
check('a claimed promoter is also visible to anon', anonClaimed.ok && anonClaimed.rows.length === 1);

const anonMarketId = await asRole('anon', `SELECT primary_market_id FROM promoters WHERE id = $1`, [publishedPromoterId]);
check('primary_market_id stays out of the public grant even for a published row',
  !anonMarketId.ok, anonMarketId.ok ? 'READABLE' : '');

console.log('\n--- 0024: promoters_publishable — a shortlist, not a trigger ---');
// Reuses testEventId's venue/market from earlier in the file for the
// resolved-market cases, and builds a second venue with a NULL market for the
// negative case.
const pubVenueId = (await db.query(
  `INSERT INTO venues (market_id, name) VALUES ($1, 'Publishable Test Venue') RETURNING id`, [marketId])).rows[0].id;
const noMarketVenueId = (await db.query(
  `INSERT INTO venues (market_id, name) VALUES (NULL, 'No Market Venue') RETURNING id`)).rows[0].id;

async function makeMatchedPromoter(name) {
  const id = (await db.query(
    `INSERT INTO promoters (name, ingested_name, status) VALUES ($1, $2, 'draft') RETURNING id`, [name, name])).rows[0].id;
  // Route through the real matcher so the alias is genuinely 'matched', not
  // hand-set — this is what makes the guard clause meaningful rather than
  // circular.
  await db.query(`SELECT resolve_promoter_alias($1, 'publishable_test')`, [name]);
  return id;
}

const twoEventsId = await makeMatchedPromoter('Two Events Promoter');
await db.query(
  `INSERT INTO events (venue_id, title, event_date, promoter_id) VALUES
   ($1, 'Show A', CURRENT_DATE + 10, $2), ($1, 'Show B', CURRENT_DATE + 11, $2)`,
  [pubVenueId, twoEventsId]);

const oneEventId = await makeMatchedPromoter('One Event Promoter');
await db.query(
  `INSERT INTO events (venue_id, title, event_date, promoter_id) VALUES ($1, 'Solo Show', CURRENT_DATE + 10, $2)`,
  [pubVenueId, oneEventId]);

const noMarketId = await makeMatchedPromoter('No Market Promoter');
await db.query(
  `INSERT INTO events (venue_id, title, event_date, promoter_id) VALUES
   ($1, 'Show C', CURRENT_DATE + 10, $2), ($1, 'Show D', CURRENT_DATE + 11, $2)`,
  [noMarketVenueId, noMarketId]);

// A promoter with 2+ events whose promoter_id was set WITHOUT going through
// the matcher (simulating some other path onto events.promoter_id ever
// existing) — must still be excluded, because the view's EXISTS clause checks
// for a genuinely matched alias independently of event count.
const unmatchedPathId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Unmatched Path Promoter', 'Unmatched Path Promoter', 'draft') RETURNING id`)).rows[0].id;
await db.query(
  `INSERT INTO events (venue_id, title, event_date, promoter_id) VALUES
   ($1, 'Show E', CURRENT_DATE + 10, $2), ($1, 'Show F', CURRENT_DATE + 11, $2)`,
  [pubVenueId, unmatchedPathId]);

const alreadyPublishedId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Already Published Promoter', 'Already Published Promoter', 'published') RETURNING id`)).rows[0].id;
await db.query(`SELECT resolve_promoter_alias('Already Published Promoter', 'publishable_test')`);
await db.query(
  `INSERT INTO events (venue_id, title, event_date, promoter_id) VALUES
   ($1, 'Show G', CURRENT_DATE + 10, $2), ($1, 'Show H', CURRENT_DATE + 11, $2)`,
  [pubVenueId, alreadyPublishedId]);

const shortlist = (await db.query(`SELECT id FROM promoters_publishable`)).rows.map((r) => r.id);
check('2+ events, matched alias, resolved market -> appears', shortlist.includes(twoEventsId));
check('only 1 event -> excluded', !shortlist.includes(oneEventId));
check('events with no resolved market -> excluded', !shortlist.includes(noMarketId));
check('2+ events but no genuinely matched alias -> excluded (the EXISTS guard is load-bearing, not redundant)',
  !shortlist.includes(unmatchedPathId));
check('already published -> excluded (it is a shortlist of drafts, not a status report)',
  !shortlist.includes(alreadyPublishedId));
check('publishing nothing by itself: none of the qualifying promoters changed status',
  (await db.query(`SELECT status FROM promoters WHERE id = $1`, [twoEventsId])).rows[0].status === 'draft');

console.log('\n--- 0024: promoter_profile_views — rows, not a counter, write-but-not-read ---');
await db.exec(`SELECT set_config('test.uid', '', false)`);

// No RETURNING/.select() anywhere here: a bare INSERT needs only INSERT
// privilege on the columns written, but RETURNING needs genuine SELECT
// privilege on whatever it returns — even just `id` — which would quietly
// poke a hole in "write but not read". This also matches the real client
// call, which is a fire-and-forget `.insert(payload)` with no `.select()`.
const viewInsert = await asRole('anon',
  `INSERT INTO promoter_profile_views (promoter_id, outreach_token, visitor_hash, user_agent, referrer)
   VALUES ($1, 'tok_abc123', 'visitor_xyz', 'Mozilla/5.0 (Macintosh)', 'https://instagram.com')`,
  [publishedPromoterId]);
check('anon can insert a view row', viewInsert.ok, viewInsert.err ?? '');
const insertedRow = await db.query(
  `SELECT * FROM promoter_profile_views WHERE promoter_id = $1 ORDER BY id DESC LIMIT 1`, [publishedPromoterId]);
check('the row actually landed with the right fields',
  insertedRow.rows[0]?.outreach_token === 'tok_abc123' && insertedRow.rows[0]?.visitor_hash === 'visitor_xyz',
  JSON.stringify(insertedRow.rows[0]));

const viewSelect = await asRole('anon', `SELECT * FROM promoter_profile_views`);
check('anon cannot select from promoter_profile_views — write but not read',
  !viewSelect.ok, viewSelect.ok ? 'READABLE' : '');

// Two distinct guarantees, not one. First: ua_class isn't in the granted
// column list at all, so a client can't even ATTEMPT to set it — this is
// stronger than "the trigger overwrites it" (which would imply the write is
// briefly accepted); it's rejected outright at the column-privilege level,
// before the trigger runs.
const spoofAttempt = await asRole('anon',
  `INSERT INTO promoter_profile_views (promoter_id, user_agent, ua_class)
   VALUES ($1, 'facebookexternalhit/1.1', 'human')`, [publishedPromoterId]);
check('a client cannot even include ua_class in the INSERT — column privilege denies it outright',
  !spoofAttempt.ok, spoofAttempt.ok ? 'ACCEPTED' : '');

// Second: the trigger's real job is DERIVING ua_class from user_agent on a
// well-formed insert (the only kind that's actually possible). Exercise that
// end to end with a link-preview UA and a plain human UA.
await asRole('anon',
  `INSERT INTO promoter_profile_views (promoter_id, user_agent) VALUES ($1, 'facebookexternalhit/1.1')`,
  [publishedPromoterId]);
const derivedRow = await db.query(
  `SELECT ua_class FROM promoter_profile_views WHERE promoter_id = $1 AND user_agent = 'facebookexternalhit/1.1'`,
  [publishedPromoterId]);
check('the trigger derives link_preview from user_agent on a real insert',
  derivedRow.rows[0]?.ua_class === 'link_preview', derivedRow.rows[0]?.ua_class);

const uaCases = [
  ['facebookexternalhit/1.1', 'link_preview'],
  ['WhatsApp/2.23', 'link_preview'],
  ['Slackbot-LinkExpanding 1.0', 'link_preview'],
  ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'bot'],
  ['python-requests/2.31', 'bot'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15', 'human'],
  [null, 'unknown'],
];
for (const [ua, expected] of uaCases) {
  const got = (await db.query(`SELECT classify_view_user_agent($1) AS c`, [ua])).rows[0].c;
  check(`classify_view_user_agent(${ua === null ? 'NULL' : `"${ua}"`}) -> ${expected}`, got === expected, got);
}

await asRole('anon',
  `INSERT INTO promoter_profile_views (promoter_id, outreach_token) VALUES ($1, 'tok_real')`,
  [publishedPromoterId]);
const tokenRow = await db.query(
  `SELECT outreach_token FROM promoter_profile_views WHERE promoter_id = $1 AND outreach_token = 'tok_real'`,
  [publishedPromoterId]);
check('a ?ref= token is stored verbatim, unvalidated against outreach_tokens',
  tokenRow.rows[0]?.outreach_token === 'tok_real');

await asRole('anon', `INSERT INTO promoter_profile_views (promoter_id) VALUES ($1)`, [publishedPromoterId]);
const noTokenRow = await db.query(
  `SELECT outreach_token FROM promoter_profile_views WHERE promoter_id = $1 ORDER BY id DESC LIMIT 1`,
  [publishedPromoterId]);
check('no ?ref= -> stored as NULL, not a placeholder string',
  noTokenRow.rows[0]?.outreach_token === null);

const ipHashAttempt = await asRole('anon',
  `INSERT INTO promoter_profile_views (promoter_id, ip_hash) VALUES ($1, 'sneaky')`, [publishedPromoterId]);
check('a client cannot set ip_hash — not in the granted column list',
  !ipHashAttempt.ok, ipHashAttempt.ok ? 'WRITABLE' : '');

const viewCountBefore = (await db.query(
  `SELECT count(*)::int c FROM promoter_profile_views WHERE promoter_id = $1`, [publishedPromoterId])).rows[0].c;
await asRole('anon', `INSERT INTO promoter_profile_views (promoter_id, visitor_hash) VALUES ($1, 'v1')`, [publishedPromoterId]);
await asRole('anon', `INSERT INTO promoter_profile_views (promoter_id, visitor_hash) VALUES ($1, 'v1')`, [publishedPromoterId]);
const viewCountAfter = (await db.query(
  `SELECT count(*)::int c FROM promoter_profile_views WHERE promoter_id = $1`, [publishedPromoterId])).rows[0].c;
check('repeat visits are NOT deduped — every view is its own row, a buying signal per the brief',
  viewCountAfter === viewCountBefore + 2, `${viewCountBefore} -> ${viewCountAfter}`);

console.log('\n--- 0024: outreach_tokens — zero anon interaction ---');
const otSelect = await asRole('anon', `SELECT * FROM outreach_tokens`);
check('anon cannot read outreach_tokens', !otSelect.ok, otSelect.ok ? 'READABLE' : '');
const otInsert = await asRole('anon',
  `INSERT INTO outreach_tokens (promoter_id, token) VALUES ($1, 'forged')`, [publishedPromoterId]);
check('anon cannot write outreach_tokens', !otInsert.ok, otInsert.ok ? 'WRITABLE' : '');

await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

console.log('\n--- 0025: owner_id is gone ---');
const ownerIdGone = await db.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'promoters' AND column_name = 'owner_id'`);
check('promoters.owner_id no longer exists', ownerIdGone.rows.length === 0);
// The backfill-before-drop ordering within 0025 can't be exercised here for
// the same reason noted in earlier briefs: the harness applies every
// migration before any test runs, so there is no "before the drop" moment to
// insert legacy owner_id data into. Verified instead against real production
// data before writing the migration: 0/30 promoters rows had owner_id set,
// so the backfill was empirically a no-op — see the migration's own header.

console.log('\n--- 0025: promoter_members ---');
const memberUniq = await db.query(
  `SELECT conname FROM pg_constraint WHERE conname = 'promoter_members_promoter_user_uniq'`);
check('(promoter_id, user_id) is unique', memberUniq.rows.length === 1);

const memberPromoterId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Member Test Promoter', 'Member Test Promoter', 'published') RETURNING id`)).rows[0].id;
const otherPromoterId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Other Promoter', 'Other Promoter', 'published') RETURNING id`)).rows[0].id;

await db.query(`INSERT INTO promoter_members (promoter_id, user_id) VALUES ($1, $2)`, [memberPromoterId, idOf.alice]);

await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);
const ownMembership = await asRole('authenticated', `SELECT promoter_id FROM promoter_members WHERE user_id = $1`, [idOf.alice]);
check('a user can see their own membership row', ownMembership.ok && ownMembership.rows.length === 1,
  JSON.stringify(ownMembership.rows ?? ownMembership.err));

await db.exec(`SELECT set_config('test.uid', '${idOf.bob}', false)`);
const othersMembership = await asRole('authenticated', `SELECT promoter_id FROM promoter_members WHERE user_id = $1`, [idOf.alice]);
check('a different user cannot see alice\'s membership row', (othersMembership.rows ?? []).length === 0,
  JSON.stringify(othersMembership.rows ?? othersMembership.err));

const memberSelfInsert = await asRole('authenticated',
  `INSERT INTO promoter_members (promoter_id, user_id) VALUES ($1, $2)`, [otherPromoterId, idOf.bob]);
check('no non-service-role can insert their own membership — service role only, by design',
  !memberSelfInsert.ok, memberSelfInsert.ok ? 'INSERTED' : '');
const memberSelfDelete = await asRole('authenticated',
  `DELETE FROM promoter_members WHERE user_id = $1`, [idOf.alice]);
check('and none can delete a membership either', !memberSelfDelete.ok, memberSelfDelete.ok ? 'DELETED' : '');
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);

console.log('\n--- 0025: override columns exist, ownership split enforced at the GRANT level ---');
const overlayCols = await db.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'promoters'
    AND column_name IN ('display_name_override','bio_override','logo_url_override','website_override','socials_override','contact_override')`);
check('all six override columns exist', overlayCols.rows.length === 6, JSON.stringify(overlayCols.rows));

const memberBioUpdate = await asRole('authenticated',
  `UPDATE promoters SET bio_override = 'A real bio' WHERE id = $1`, [memberPromoterId]);
check('a member CAN update an override column for their own promoter', memberBioUpdate.ok, memberBioUpdate.err ?? '');

const memberIngestedNameAttempt = await asRole('authenticated',
  `UPDATE promoters SET ingested_name = 'Hacked Name' WHERE id = $1`, [memberPromoterId]);
check('but NOT ingested_name — not in the granted column list even for a real member',
  !memberIngestedNameAttempt.ok, memberIngestedNameAttempt.ok ? 'WRITABLE' : '');
const memberStatusAttempt = await asRole('authenticated',
  `UPDATE promoters SET status = 'claimed' WHERE id = $1`, [memberPromoterId]);
check('and NOT status — publication stays curator-only, a member cannot self-claim',
  !memberStatusAttempt.ok, memberStatusAttempt.ok ? 'WRITABLE' : '');

console.log('\n--- 0025: "and no other" — membership scoping (criterion 7) ---');
await db.query(`UPDATE promoters SET bio_override = 'Untouched' WHERE id = $1`, [otherPromoterId]);
const crossPromoterAttempt = await asRole('authenticated',
  `UPDATE promoters SET bio_override = 'Sneaky' WHERE id = $1`, [otherPromoterId]);
const otherPromoterAfter = await db.query(`SELECT bio_override FROM promoters WHERE id = $1`, [otherPromoterId]);
check('a member of promoter A cannot update promoter B, even with a well-formed statement',
  otherPromoterAfter.rows[0].bio_override === 'Untouched',
  JSON.stringify({ attemptOk: crossPromoterAttempt.ok, value: otherPromoterAfter.rows[0].bio_override }));

console.log('\n--- 0025: revocation is immediate on row deletion (criterion 8, "verify this") ---');
await db.query(`DELETE FROM promoter_members WHERE promoter_id = $1 AND user_id = $2`, [memberPromoterId, idOf.alice]);
const afterRevoke = await asRole('authenticated',
  `UPDATE promoters SET bio_override = 'Should not land' WHERE id = $1`, [memberPromoterId]);
const bioAfterRevoke = await db.query(`SELECT bio_override FROM promoters WHERE id = $1`, [memberPromoterId]);
check('once the membership row is gone, the same user immediately loses update access',
  bioAfterRevoke.rows[0].bio_override === 'A real bio',
  `expected unchanged "A real bio", got: ${JSON.stringify({ attemptOk: afterRevoke.ok, value: bioAfterRevoke.rows[0].bio_override })}`);
// Re-add so later sections needing a member can rely on one existing.
await db.query(`INSERT INTO promoter_members (promoter_id, user_id) VALUES ($1, $2)`, [memberPromoterId, idOf.alice]);

console.log('\n--- 0025: promoters_public — the three-state resolution ---');

// No overrides set yet on a fresh promoter: display falls back to
// ingested_name; bio/website/logo_url/contact/socials have no ingested
// counterpart at all, so they resolve to plain NULL.
const freshId = (await db.query(
  `INSERT INTO promoters (name, ingested_name, status) VALUES ('Fresh Promoter', 'Fresh Promoter', 'published') RETURNING id`)).rows[0].id;
const freshView = (await db.query(`SELECT * FROM promoters_public WHERE id = $1`, [freshId])).rows[0];
check('no override set -> display_name falls back to ingested_name',
  freshView.display_name === 'Fresh Promoter', freshView.display_name);
check('no override set -> bio (no ingested counterpart) is NULL, not empty string',
  freshView.bio === null, JSON.stringify(freshView.bio));

// Criterion 1: override = 'text' renders that text.
await db.query(`UPDATE promoters SET bio_override = 'My real bio' WHERE id = $1`, [freshId]);
const withBio = (await db.query(`SELECT bio FROM promoters_public WHERE id = $1`, [freshId])).rows[0];
check('bio_override = text -> resolved bio is that text', withBio.bio === 'My real bio', withBio.bio);

// Criterion 2: override = NULL reverts, no data loss to sibling columns.
await db.query(`UPDATE promoters SET website_override = 'https://example.com' WHERE id = $1`, [freshId]);
await db.query(`UPDATE promoters SET bio_override = NULL WHERE id = $1`, [freshId]);
const revertedBio = (await db.query(`SELECT bio, website FROM promoters_public WHERE id = $1`, [freshId])).rows[0];
check('bio_override -> NULL reverts bio to null with no ingested counterpart to fall back to',
  revertedBio.bio === null, JSON.stringify(revertedBio.bio));
check('and the UNRELATED website override set moments earlier is untouched — no data loss',
  revertedBio.website === 'https://example.com', revertedBio.website);

// Criterion 3: override = '' renders BLANK, not the fallback — this is the
// entire point of the brief. Proven against display_name specifically,
// because it is the one field with a REAL ingested fallback to wrongly fall
// back to if '' were mishandled as falsy.
await db.query(`UPDATE promoters SET display_name_override = '' WHERE id = $1`, [freshId]);
const blankName = (await db.query(`SELECT display_name FROM promoters_public WHERE id = $1`, [freshId])).rows[0];
check('display_name_override = \'\' -> resolved display_name is \'\', NOT ingested_name',
  blankName.display_name === '', JSON.stringify(blankName.display_name));
check('(sanity: an empty string is not the same value as the fallback it could have collapsed into)',
  blankName.display_name !== 'Fresh Promoter');

// And the same for bio, where '' vs NULL is the whole three-state distinction
// even with no ingested fallback in play.
await db.query(`UPDATE promoters SET bio_override = '' WHERE id = $1`, [freshId]);
const blankBio = (await db.query(`SELECT bio FROM promoters_public WHERE id = $1`, [freshId])).rows[0];
check('bio_override = \'\' -> resolved bio is \'\', distinct from the NULL case above',
  blankBio.bio === '' && blankBio.bio !== null, JSON.stringify(blankBio.bio));

// Everything above ran as the superuser connection (db.query), which proves
// the SQL resolution logic is correct but NOT that anon can actually reach
// it — a security_invoker view needs the CALLING role to hold SELECT on
// every base-table column the view's definition touches, not just its output
// columns, and that is a separate, real failure mode from RLS row-visibility.
// This bit production once already: 0025 granted UPDATE on the six override
// columns but never SELECT, so anon querying promoters_public got a flat
// "permission denied for table promoters" for every row — a bug this exact
// harness section originally missed, because its only asRole('anon', ...)
// check collapsed a hard permission error and a legitimate empty RLS result
// into the same "0 rows" outcome. Fixed in 0026; both branches — the
// permission grant AND the RLS row-filter — are now exercised for real,
// through the actual anon role, not the superuser connection.
const publishedThroughView = await asRole('anon',
  `SELECT display_name, bio FROM promoters_public WHERE id = $1`, [freshId]);
check('anon can actually READ a published promoter through promoters_public — not just get zero rows for the wrong reason',
  publishedThroughView.ok, publishedThroughView.err ?? '');
check('and the resolved value anon receives is correct, not just present',
  publishedThroughView.rows?.[0]?.bio === '', JSON.stringify(publishedThroughView.rows));

await db.query(`UPDATE promoters SET status = 'draft' WHERE id = $1`, [freshId]);
await db.exec(`SELECT set_config('test.uid', '', false)`);
const draftThroughView = await asRole('anon', `SELECT id FROM promoters_public WHERE id = $1`, [freshId]);
// .ok must be true here — a permission error and "RLS legitimately returned
// nothing" are different outcomes, and only the second is what this check
// claims to prove. If .ok were false, EITHER the grant broke again OR
// something else is wrong; either way this must fail loudly, not silently
// agree via an empty array that could mean anything.
check('a draft promoter is invisible through promoters_public too (security_invoker, not a bypass) — genuinely verified, not a masked permission error',
  draftThroughView.ok && draftThroughView.rows.length === 0,
  JSON.stringify({ ok: draftThroughView.ok, err: draftThroughView.err, rows: draftThroughView.rows }));
await db.exec(`SELECT set_config('test.uid', '${idOf.alice}', false)`);
await db.query(`UPDATE promoters SET status = 'published' WHERE id = $1`, [freshId]);

console.log('\n--- 0025: display name vs matching name stay independent (criterion 5) ---');
// A promoter whose display_name_override diverges wildly from ingested_name
// must still receive newly ingested events, because matching reads
// ingested_name, never the override.
await db.query(`UPDATE promoters SET display_name_override = 'A Totally Different Stylized Name (TM)' WHERE id = $1`, [freshId]);
const stillMatches = await db.query(`SELECT resolve_promoter_alias('Fresh Promoter', 'divergence_test') AS id`);
check('a wildly different display_name_override does not break alias matching against ingested_name',
  stillMatches.rows[0].id === freshId, JSON.stringify(stillMatches.rows[0]));
const divergedView = (await db.query(`SELECT display_name, ingested_name FROM promoters_public WHERE id = $1`, [freshId])).rows[0];
check('meanwhile the public page still renders the stylized override, not the matching name',
  divergedView.display_name === 'A Totally Different Stylized Name (TM)' && divergedView.ingested_name === 'Fresh Promoter',
  JSON.stringify(divergedView));

console.log('\n--- 0025: a full re-ingest cannot disturb override columns (criterion 4) ---');
// Simulates a pipeline-style write to the ingested identity column and proves
// it is structurally independent of every override column, regardless of
// whether the current pipeline ever actually performs such a write (Brief 2:
// promoters are never auto-updated by ingestion today; this proves the
// COLUMNS themselves cannot cross-contaminate if that ever changes).
await db.query(`UPDATE promoters SET ingested_name = 'Fresh Promoter (re-ingested)' WHERE id = $1`, [freshId]);
const afterReingest = (await db.query(`SELECT ingested_name, bio_override, website_override, display_name_override FROM promoters WHERE id = $1`, [freshId])).rows[0];
check('ingested_name changes on a simulated re-ingest', afterReingest.ingested_name === 'Fresh Promoter (re-ingested)');
check('every override column is untouched by it', afterReingest.bio_override === '' &&
  afterReingest.website_override === 'https://example.com' &&
  afterReingest.display_name_override === 'A Totally Different Stylized Name (TM)',
  JSON.stringify(afterReingest));

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
await db.close();
process.exit(failures ? 1 : 0);
