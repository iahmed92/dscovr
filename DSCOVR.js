// Ticketmaster Discovery API -> Supabase ingestion sync for DSCOVR.
// Pulls Dance/Electronic events for the seeded market and upserts
// venues / promoters / events / artists / lineups against the live schema.

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

const MARKET_SLUG = 'phoenix-tucson';
const STATE_CODE = 'AZ';
const CLASSIFICATION_NAME = 'Dance/Electronic';
const PAGE_SIZE = 199; // Ticketmaster's max page size
const MAX_PAGES = 5; // free-tier keys reject deep paging past ~1000 results
const REQUEST_DELAY_MS = 250; // stay comfortably under the 5 req/sec rate limit

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Ticketmaster fetch
// ---------------------------------------------------------------------------

async function fetchEventsPage(page) {
  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  url.searchParams.set('apikey', TICKETMASTER_API_KEY);
  url.searchParams.set('stateCode', STATE_CODE);
  url.searchParams.set('classificationName', CLASSIFICATION_NAME);
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort', 'date,asc');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Ticketmaster API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchAllEvents() {
  const events = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages) {
    const data = await fetchEventsPage(page);
    const pageEvents = data._embedded?.events ?? [];
    events.push(...pageEvents);

    totalPages = Math.min(data.page?.totalPages ?? 1, MAX_PAGES);
    console.log(`Fetched page ${page + 1}/${totalPages} (${pageEvents.length} events)`);

    page += 1;
    if (page < totalPages) await sleep(REQUEST_DELAY_MS);
  }

  return events;
}

// ---------------------------------------------------------------------------
// Supabase upsert helpers
// ---------------------------------------------------------------------------

async function getMarketId(slug) {
  const { data, error } = await supabase.from('markets').select('id').eq('slug', slug).single();

  if (error || !data) {
    throw new Error(`Market "${slug}" not found in Supabase — seed it before running the sync.`);
  }
  return data.id;
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

// artists.name is UNIQUE. Only `name` is sent so existing spotify_id /
// spotify_preview_url / genre_tags from the Vibe Check script are never clobbered.
async function upsertArtist(name) {
  if (!name) return null;

  const { data, error } = await supabase
    .from('artists')
    .upsert({ name }, { onConflict: 'name' })
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
    console.warn(`Skipping "${tmEvent.name}" — no venue data`);
    return;
  }

  if (!tmEvent.dates?.start?.localDate) {
    console.warn(`Skipping "${tmEvent.name}" — no event_date`);
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
    console.error(`Event upsert failed for "${tmEvent.name}": ${eventError.message}`);
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
        `Lineup upsert failed for "${attractions[i].name}" @ "${tmEvent.name}": ${lineupError.message}`
      );
    }
  }

  console.log(`Synced: ${tmEvent.name} (${eventRecord.event_date})`);
}

async function main() {
  console.log(`Starting Ticketmaster sync for market "${MARKET_SLUG}"...`);
  const marketId = await getMarketId(MARKET_SLUG);

  const tmEvents = await fetchAllEvents();
  console.log(`Fetched ${tmEvents.length} events from Ticketmaster.`);

  for (const tmEvent of tmEvents) {
    try {
      await syncEvent(tmEvent, marketId);
    } catch (err) {
      console.error(`Error syncing "${tmEvent.name}":`, err.message);
    }
  }

  console.log('Sync complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
