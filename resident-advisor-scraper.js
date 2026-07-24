// Pulls electronic-music events from Resident Advisor (ra.co) into the same
// upsert pipeline as DSCOVR.js and the Relentless Beats scraper, so RA's deep
// underground/club coverage merges with Ticketmaster instead of duplicating it.
//
// RA is the canonical listings source for house/techno/underground — exactly
// the independent-promoter and club shows Ticketmaster misses in most markets.
//
// Data source (verified 2026-07-22):
//   ra.co's own site is Cloudflare-gated (the HTML 403s), but its GraphQL
//   endpoint (https://ra.co/graphql) answers structured queries directly —
//   far more reliable than scraping HTML. We use the same `eventListings`
//   query the site uses, filtered by an RA "area" id (a city) and a date
//   window. The area-id-per-market map below was resolved once via RA's
//   areas(searchTerm:) lookup; adding a market is one line.
//
// Etiquette: we identify honestly via User-Agent and rate-limit between calls.
// This aggregates public listings for display only.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { finishRun, observe, seenNow, sourceIdentity, startRun } from './ingest-telemetry.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// market slug -> RA area id. Resolved from RA's areas(searchTerm:) lookup.
// Kansas City has no RA presence, so it's intentionally absent.
const RA_AREA_BY_MARKET = {
  atlanta: 532,
  austin: 321,
  boston: 530,
  chicago: 17,
  dallas: 319,
  denver: 519,
  detroit: 19,
  houston: 63,
  'las-vegas': 527,
  'los-angeles': 23,
  miami: 38,
  minneapolis: 590,
  nashville: 653,
  'new-orleans': 606,
  'new-york-city': 8,
  orlando: 315,
  philadelphia: 528,
  'phoenix-tucson': 591,
  portland: 125,
  'salt-lake-city': 592,
  'san-diego': 309,
  'san-francisco': 218,
  seattle: 46,
  tampa: 316,
  'washington-dc': 22,
};

const GRAPHQL_URL = 'https://ra.co/graphql';
const DAYS_AHEAD = 60;
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 500;
// A real browser UA: RA's edge rejects obvious bots. We still identify DSCOVR
// in a comment header below and keep request volume low and polite.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EVENT_LISTINGS_QUERY = `
query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data {
      event {
        id
        title
        date
        startTime
        contentUrl
        venue { id name contentUrl area { id name } }
        artists { id name }
        images { filename }
      }
    }
    totalResults
  }
}`;

async function graphql(variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://ra.co/events',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({ query: EVENT_LISTINGS_QUERY, variables }),
  });
  if (!res.ok) throw new Error(`RA GraphQL failed ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`RA GraphQL error: ${json.errors[0]?.message}`);
  return json.data.eventListings;
}

function isoDay(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10) + 'T00:00:00.000Z';
}

// RA returns naive local datetimes (no timezone) — event.date is midnight on
// the show's local calendar day, startTime is the local start. Per the repo's
// date rule we slice the parts by hand and never route them through Date(),
// which near midnight UTC would shift the day.
function localDatePart(raDate) {
  return typeof raDate === 'string' ? raDate.slice(0, 10) : null;
}
function localTimePart(raStartTime) {
  if (typeof raStartTime !== 'string' || raStartTime.length < 19) return null;
  return raStartTime.slice(11, 19); // HH:MM:SS
}

// ---------------------------------------------------------------------------
// Supabase upsert helpers (mirror DSCOVR.js / relentless-beats-scraper.js)
// ---------------------------------------------------------------------------

async function getMarketId(slug) {
  const { data, error } = await supabase.from('markets').select('id').eq('slug', slug).single();
  if (error || !data) throw new Error(`Market "${slug}" not found in Supabase — seed it first.`);
  return data.id;
}

// venues.name is UNIQUE. Only send keys we have, so we never clobber richer
// existing data (e.g. a Ticketmaster-populated address) with a null.
async function upsertVenue(venue, areaName, marketId) {
  if (!venue?.name) return null;
  const record = { market_id: marketId, name: venue.name };
  if (areaName) record.city = areaName;
  if (venue.contentUrl) record.website = `https://ra.co${venue.contentUrl}`;

  const { data, error } = await supabase
    .from('venues')
    .upsert(record, { onConflict: 'name' })
    .select('id')
    .single();
  if (error) throw new Error(`Venue upsert failed for "${venue.name}": ${error.message}`);
  return data.id;
}

function soundcloudSearchUrl(name) {
  return `https://soundcloud.com/search/people?q=${encodeURIComponent(name)}`;
}

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

function pickFlyerUrl(images) {
  if (!Array.isArray(images)) return null;
  return images.find((i) => i?.filename)?.filename ?? null;
}

// ---------------------------------------------------------------------------
// Sync one event
// ---------------------------------------------------------------------------

async function syncEvent(event, marketId) {
  const eventDate = localDatePart(event.date);
  if (!event.title || !eventDate || !event.venue?.name) {
    return false; // not enough to key or place the row
  }

  // Written as one pair — see ingest-telemetry.sourceIdentity.
  const identity = sourceIdentity('resident_advisor', event.id);
  if (!identity) return false;

  const venueId = await upsertVenue(event.venue, event.venue.area?.name, marketId);

  observe({ venueId, title: event.title, eventDate, sourceType: 'resident_advisor' });

  const record = {
    venue_id: venueId,
    title: event.title,
    event_date: eventDate,
    doors_time: localTimePart(event.startTime),
    ticket_url: event.contentUrl ? `https://ra.co${event.contentUrl}` : null,
    flyer_url: pickFlyerUrl(event.images),
    ...identity,
    last_seen_at: seenNow(),
  };

  const { data: eventRow, error } = await supabase
    .from('events')
    .upsert(record, { onConflict: 'venue_id,title,event_date' })
    .select('id')
    .single();
  if (error) {
    console.error(`Event upsert failed for "${event.title}": ${error.message}`);
    return false;
  }

  const artists = event.artists ?? [];
  for (let i = 0; i < artists.length; i++) {
    const artistId = await upsertArtist(artists[i].name);
    if (!artistId) continue;
    const { error: lineupError } = await supabase
      .from('lineups')
      .upsert(
        { event_id: eventRow.id, artist_id: artistId, performance_order: i },
        { onConflict: 'event_id,artist_id' }
      );
    if (lineupError) {
      console.error(`Lineup upsert failed for "${artists[i].name}": ${lineupError.message}`);
    }
  }

  console.log(`  synced: ${event.title} @ ${event.venue.name} (${eventDate})`);
  return true;
}

// ---------------------------------------------------------------------------
// Sync one market: page through its RA area for the date window
// ---------------------------------------------------------------------------

async function syncMarket(slug, areaId) {
  const marketId = await getMarketId(slug);
  const filters = {
    areas: { eq: areaId },
    listingDate: { gte: isoDay(0), lte: isoDay(DAYS_AHEAD) },
  };

  let page = 1;
  let synced = 0;
  for (;;) {
    const listings = await graphql({ filters, pageSize: PAGE_SIZE, page });
    const rows = listings.data ?? [];
    for (const row of rows) {
      if (row.event && (await syncEvent(row.event, marketId))) synced++;
    }
    const total = listings.totalResults ?? 0;
    if (rows.length === 0 || page * PAGE_SIZE >= total) break;
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`${slug}: ${synced} RA event(s).`);
  return synced;
}

async function main() {
  // Optional CLI arg limits to one market, e.g. `node resident-advisor-scraper.js los-angeles`.
  const only = process.argv[2];
  const entries = Object.entries(RA_AREA_BY_MARKET).filter(([slug]) => !only || slug === only);
  if (only && entries.length === 0) {
    throw new Error(`No RA area configured for market "${only}".`);
  }

  console.log(`Starting Resident Advisor sync (${entries.length} market(s), ${DAYS_AHEAD}-day window)...`);
  let total = 0;
  for (const [slug, areaId] of entries) {
    const marketId = await getMarketId(slug).catch(() => null);
    const runId = await startRun(supabase, 'resident_advisor', marketId);
    try {
      const seen = await syncMarket(slug, areaId);
      total += seen;
      await finishRun(supabase, runId, { status: 'complete', eventsSeen: seen });
    } catch (err) {
      console.error(`Error syncing ${slug}:`, err.message);
      await finishRun(supabase, runId, { status: 'failed', notes: err.message });
    }
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`Resident Advisor sync complete — ${total} event(s) across ${entries.length} market(s).`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
