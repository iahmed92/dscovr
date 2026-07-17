// Ticketmaster Discovery API -> Supabase ingestion sync for DSCOVR.
// Loops over every active row in `markets`, pulls Dance/Electronic events
// for that market's state (see filtering strategy below), and upserts
// venues / promoters / events / artists / lineups against the live schema —
// scales to new markets just by adding rows to the table, no code changes
// required.
//
// MULTI-METRO STATES: markets are always fetched by Ticketmaster `stateCode`
// first, then optionally narrowed by `markets.cities` (a text array) to only
// the venue cities that actually belong to that market — e.g. an LA market
// row would set cities to ['Los Angeles', 'Hollywood', 'Anaheim', ...] so a
// CA-wide stateCode fetch doesn't also attribute San Francisco/San Diego/
// Sacramento events to LA. Single-metro markets (phoenix-tucson, denver,
// las-vegas) leave `cities` NULL and are unaffected — the filter is a no-op
// when unset.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TICKETMASTER_API_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}
if (!TICKETMASTER_API_KEY) {
  throw new Error('Missing TICKETMASTER_API_KEY in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Filtering EDM content out of Ticketmaster is a precision/recall tradeoff,
// verified live both ways:
//   - `classificationName=Dance/Electronic` (free-text, fuzzy-matched by TM
//     across segment/genre/subgenre) has good recall but pulls in real noise
//     — e.g. a Vegas stage show TM tags Music > Pop > Electro Pop.
//   - `genreId=<Dance/Electronic>` (exact match against TM's own genre field)
//     has good precision but WORSE recall — TM itself inconsistently tags
//     genuine EDM headliners (RÜFÜS DU SOL, Griz, Gryffin, Bob Moses, Chasing
//     Abbey, Slow Magic...) under Alternative/Pop/Rock instead, so genreId
//     alone silently drops real festival-headliner-tier acts.
// So: fetch both, union by Ticketmaster's own event id, and exclude the one
// confirmed false positive by name. Add to EXCLUDED_TITLE_PATTERNS as new
// false positives turn up rather than tightening the genre filter further.
const DANCE_ELECTRONIC_GENRE_ID = 'KnvZfZ7vAvF';
const CLASSIFICATION_NAME = 'Dance/Electronic';
const EXCLUDED_TITLE_PATTERNS = [/jabbawockeez/i];
const PAGE_SIZE = 199; // Ticketmaster's max page size
const MAX_PAGES = 5; // free-tier keys reject deep paging past ~1000 results
const REQUEST_DELAY_MS = 250; // stay comfortably under the 5 req/sec rate limit

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Ticketmaster fetch
// ---------------------------------------------------------------------------

async function fetchEventsPage(stateCode, filterParam, filterValue, page) {
  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  url.searchParams.set('apikey', TICKETMASTER_API_KEY);
  url.searchParams.set('stateCode', stateCode);
  url.searchParams.set(filterParam, filterValue);
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort', 'date,asc');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Ticketmaster API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchAllEventsForFilter(stateCode, filterParam, filterValue) {
  const events = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages) {
    const data = await fetchEventsPage(stateCode, filterParam, filterValue, page);
    const pageEvents = data._embedded?.events ?? [];
    events.push(...pageEvents);

    totalPages = Math.min(data.page?.totalPages ?? 1, MAX_PAGES);
    console.log(`  [${filterParam}] page ${page + 1}/${totalPages} (${pageEvents.length} events)`);

    page += 1;
    if (page < totalPages) await sleep(REQUEST_DELAY_MS);
  }

  return events;
}

async function fetchAllEvents(stateCode) {
  const byClassification = await fetchAllEventsForFilter(stateCode, 'classificationName', CLASSIFICATION_NAME);
  await sleep(REQUEST_DELAY_MS);
  const byGenre = await fetchAllEventsForFilter(stateCode, 'genreId', DANCE_ELECTRONIC_GENRE_ID);

  const merged = new Map();
  for (const e of [...byClassification, ...byGenre]) merged.set(e.id, e);

  return [...merged.values()].filter(
    (e) => !EXCLUDED_TITLE_PATTERNS.some((pattern) => pattern.test(e.name))
  );
}

// ---------------------------------------------------------------------------
// Supabase upsert helpers
// ---------------------------------------------------------------------------

async function getActiveMarkets() {
  const { data, error } = await supabase
    .from('markets')
    .select('id, slug, name, state, cities')
    .eq('is_active', true);

  if (error) throw new Error(`Failed to load markets: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('No active markets found in Supabase — seed at least one before running the sync.');
  }
  return data;
}

// No-op when `cities` is unset — only multi-metro markets need to set it.
function matchesMarketCities(tmEvent, cities) {
  if (!cities || cities.length === 0) return true;

  const eventCity = tmEvent._embedded?.venues?.[0]?.city?.name;
  if (!eventCity) return false;

  const normalized = cities.map((c) => c.trim().toLowerCase());
  return normalized.includes(eventCity.trim().toLowerCase());
}

// venues.name is UNIQUE, so a real upsert works here.
async function upsertVenue(tmVenue, marketId) {
  if (!tmVenue?.name) return null;

  const record = {
    market_id: marketId,
    name: tmVenue.name,
    address: tmVenue.address?.line1 ?? null,
    city: tmVenue.city?.name ?? null,
    latitude: tmVenue.location?.latitude ? parseFloat(tmVenue.location.latitude) : null,
    longitude: tmVenue.location?.longitude ? parseFloat(tmVenue.location.longitude) : null,
    website: tmVenue.url ?? null,
  };

  const { data, error } = await supabase
    .from('venues')
    .upsert(record, { onConflict: 'name' })
    .select('id')
    .single();

  if (error) throw new Error(`Venue upsert failed for "${tmVenue.name}": ${error.message}`);
  return data.id;
}

// promoters.name has NO unique constraint in the schema, so ON CONFLICT upsert
// isn't possible here — do a manual select-then-insert instead.
async function getOrCreatePromoter(name) {
  if (!name) return null;

  const { data: existing, error: selectError } = await supabase
    .from('promoters')
    .select('id')
    .eq('name', name)
    .maybeSingle();

  if (selectError) throw new Error(`Promoter lookup failed for "${name}": ${selectError.message}`);
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from('promoters')
    .insert({ name })
    .select('id')
    .single();

  if (insertError) throw new Error(`Promoter insert failed for "${name}": ${insertError.message}`);
  return created.id;
}

// No API-verified SoundCloud ID exists, so this is always a search-results
// link rather than a guaranteed direct profile match.
function soundcloudSearchUrl(name) {
  return `https://soundcloud.com/search/people?q=${encodeURIComponent(name)}`;
}

// artists.name is UNIQUE. Only `name` and the deterministic soundcloud_url
// are sent so existing spotify_id / spotify_url / deezer_id / genre_tags
// from the Vibe Check script are never clobbered.
async function upsertArtist(name) {
  if (!name) return null;

  const { data, error } = await supabase
    .from('artists')
    .upsert({ name, soundcloud_url: soundcloudSearchUrl(name) }, { onConflict: 'name' })
    .select('id')
    .single();

  if (error) throw new Error(`Artist upsert failed for "${name}": ${error.message}`);
  return data.id;
}

function pickFlyerUrl(images = []) {
  const widescreen = images.find((img) => img.ratio === '16_9' && img.width >= 640);
  return widescreen?.url ?? images[0]?.url ?? null;
}

function extractPromoterName(tmEvent) {
  return tmEvent.promoter?.name ?? tmEvent.promoters?.[0]?.name ?? null;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function syncEvent(tmEvent, marketId) {
  const tmVenue = tmEvent._embedded?.venues?.[0];
  if (!tmVenue) {
    console.warn(`  Skipping "${tmEvent.name}" — no venue data`);
    return;
  }

  if (!tmEvent.dates?.start?.localDate) {
    console.warn(`  Skipping "${tmEvent.name}" — no event_date`);
    return;
  }

  const venueId = await upsertVenue(tmVenue, marketId);
  const promoterId = await getOrCreatePromoter(extractPromoterName(tmEvent));

  const eventRecord = {
    venue_id: venueId,
    promoter_id: promoterId,
    title: tmEvent.name,
    event_date: tmEvent.dates.start.localDate,
    // Ticketmaster doesn't expose a separate "doors" time — this is the
    // show/set start time, used as the closest available proxy.
    doors_time: tmEvent.dates.start.localTime ?? null,
    ticket_url: tmEvent.url ?? null,
    flyer_url: pickFlyerUrl(tmEvent.images),
    source_type: 'ticketmaster',
  };

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .upsert(eventRecord, { onConflict: 'venue_id,title,event_date' })
    .select('id')
    .single();

  if (eventError) {
    console.error(`  Event upsert failed for "${tmEvent.name}": ${eventError.message}`);
    return;
  }

  const attractions = tmEvent._embedded?.attractions ?? [];
  for (let i = 0; i < attractions.length; i++) {
    const artistId = await upsertArtist(attractions[i].name);
    if (!artistId) continue;

    const { error: lineupError } = await supabase
      .from('lineups')
      .upsert(
        { event_id: eventRow.id, artist_id: artistId, performance_order: i },
        { onConflict: 'event_id,artist_id' }
      );

    if (lineupError) {
      console.error(
        `  Lineup upsert failed for "${attractions[i].name}" @ "${tmEvent.name}": ${lineupError.message}`
      );
    }
  }

  console.log(`  Synced: ${tmEvent.name} (${eventRecord.event_date})`);
}

async function syncMarket(market) {
  console.log(`\nMarket "${market.name}" (${market.slug}, ${market.state})...`);

  const allEvents = await fetchAllEvents(market.state);
  const tmEvents = allEvents.filter((e) => matchesMarketCities(e, market.cities));

  if (market.cities?.length) {
    console.log(
      `  Fetched ${allEvents.length} events, ${tmEvents.length} match cities [${market.cities.join(', ')}].`
    );
  } else {
    console.log(`  Fetched ${tmEvents.length} events from Ticketmaster.`);
  }

  for (const tmEvent of tmEvents) {
    try {
      await syncEvent(tmEvent, market.id);
    } catch (err) {
      console.error(`  Error syncing "${tmEvent.name}":`, err.message);
    }
  }
}

async function main() {
  const markets = await getActiveMarkets();
  console.log(`Starting Ticketmaster sync for ${markets.length} active market(s): ${markets.map((m) => m.slug).join(', ')}`);

  for (const market of markets) {
    try {
      await syncMarket(market);
    } catch (err) {
      console.error(`Fatal error syncing market "${market.slug}":`, err.message);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log('\nSync complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
