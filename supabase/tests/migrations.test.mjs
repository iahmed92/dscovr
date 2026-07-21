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

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
await db.close();
process.exit(failures ? 1 : 0);
