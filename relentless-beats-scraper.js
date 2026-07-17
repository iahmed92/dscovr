// Scrapes relentlessbeats.com (a local AZ EDM promoter Ticketmaster doesn't
// cover — warehouse afters, club nights, underground bookings) and feeds
// events into the same upsert pipeline as DSCOVR.js so they merge cleanly
// with Ticketmaster data instead of duplicating it.
//
// Site structure (verified 2026-07-16):
//   - /events is server-rendered (Astro SSR) and — importantly — renders
//     EVERY market nationwide in one page; the ?m=phx query param only
//     filters client-side via JS. So we fetch it once, then filter by each
//     card's data-market attribute ourselves. Each event is also duplicated
//     in the markup (separate mobile/desktop layouts), so we dedupe by
//     data-event-id.
//   - Each event's detail page (/events/{slug}) embeds real schema.org
//     MusicEvent JSON-LD with a clean performer[] lineup, venue address, and
//     the actual ticket purchase URL — far more reliable than scraping the
//     listing card's display HTML, so that's the actual data source; the
//     listing page is only used to discover which slugs belong to phx/tuc.
//
// robots.txt allows general fetching (`User-agent: * / Allow: /`, and the
// site's own section explicitly welcomes AI/LLM crawlers), but asks that
// content not be used for ai-train — this script only aggregates listings
// for display, not model training. Per scraper etiquette we identify
// honestly via User-Agent (not a spoofed browser string) and rate-limit.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MARKET_SLUG = 'phoenix-tucson';
const RB_MARKET_CODES = ['phx', 'tuc'];
const EVENTS_URL = 'https://relentlessbeats.com/events';
const TIMEZONE = 'America/Phoenix';
const REQUEST_DELAY_MS = 400;
const USER_AGENT =
  'DSCOVR-EventBot/1.0 (+mailto:isahmed92@gmail.com; aggregating AZ EDM listings)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Discovery: find phx/tuc event detail URLs from the listing page
// ---------------------------------------------------------------------------

async function discoverEventUrls() {
  const html = await politeFetch(EVENTS_URL);
  const $ = cheerio.load(html);

  const seen = new Map(); // event-id -> detail URL

  $('[data-rb-event-wrap]').each((_, el) => {
    const $el = $(el);
    const eventId = $el.attr('data-event-id');
    const market = $el.attr('data-market');
    if (!eventId || seen.has(eventId)) return;
    if (!RB_MARKET_CODES.includes(market)) return;

    const href = $el.find('a[href^="/events/"]').first().attr('href');
    if (!href) return;

    seen.set(eventId, new URL(href, EVENTS_URL).toString());
  });

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Detail page: extract the MusicEvent JSON-LD
// ---------------------------------------------------------------------------

async function fetchMusicEvent(detailUrl) {
  const html = await politeFetch(detailUrl);
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let parsed;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : (parsed['@graph'] ?? [parsed]);
    const musicEvent = candidates.find((node) => node?.['@type'] === 'MusicEvent');
    if (musicEvent) return musicEvent;
  }

  return null;
}

function localDatePart(isoString) {
  // en-CA formats as YYYY-MM-DD, which matches Postgres DATE input directly.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(isoString));
}

function localTimePart(isoString) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoString));

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

// ---------------------------------------------------------------------------
// Supabase upsert helpers (mirrors DSCOVR.js)
// ---------------------------------------------------------------------------

async function getMarketId(slug) {
  const { data, error } = await supabase.from('markets').select('id').eq('slug', slug).single();
  if (error || !data) {
    throw new Error(`Market "${slug}" not found in Supabase — seed it before running the sync.`);
  }
  return data.id;
}

async function getOrCreatePromoter(name) {
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

// venues.name is UNIQUE. Only include keys we actually have data for, so a
// conflicting update never overwrites good existing data (e.g. lat/long
// already populated by the Ticketmaster sync) with a null.
async function upsertVenue(location, marketId) {
  if (!location?.name) return null;

  const record = { market_id: marketId, name: location.name };
  if (location.address?.streetAddress) record.address = location.address.streetAddress;
  if (location.address?.addressLocality) record.city = location.address.addressLocality;
  if (location.url) record.website = location.url;

  const { data, error } = await supabase
    .from('venues')
    .upsert(record, { onConflict: 'name' })
    .select('id')
    .single();

  if (error) throw new Error(`Venue upsert failed for "${location.name}": ${error.message}`);
  return data.id;
}

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

function pickFlyerUrl(image) {
  if (!image) return null;
  return Array.isArray(image) ? (image[0] ?? null) : image;
}

function pickTicketUrl(offers) {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  return offer?.url ?? null;
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

async function syncEvent(musicEvent, marketId, promoterId) {
  if (musicEvent.eventStatus?.includes('Cancelled')) {
    console.warn(`Skipping "${musicEvent.name}" — cancelled`);
    return;
  }
  if (!musicEvent.location || !musicEvent.startDate) {
    console.warn(`Skipping "${musicEvent.name}" — missing venue or start date`);
    return;
  }

  const venueId = await upsertVenue(musicEvent.location, marketId);

  const eventRecord = {
    venue_id: venueId,
    promoter_id: promoterId,
    title: musicEvent.name,
    event_date: localDatePart(musicEvent.startDate),
    doors_time: localTimePart(musicEvent.startDate),
    ticket_url: pickTicketUrl(musicEvent.offers),
    flyer_url: pickFlyerUrl(musicEvent.image),
    source_type: 'relentless_beats',
  };

  const { data: eventRow, error: eventError } = await supabase
    .from('events')
    .upsert(eventRecord, { onConflict: 'venue_id,title,event_date' })
    .select('id')
    .single();

  if (eventError) {
    console.error(`Event upsert failed for "${musicEvent.name}": ${eventError.message}`);
    return;
  }

  const performers = musicEvent.performer ?? [];
  for (let i = 0; i < performers.length; i++) {
    const artistId = await upsertArtist(performers[i].name);
    if (!artistId) continue;

    const { error: lineupError } = await supabase
      .from('lineups')
      .upsert(
        { event_id: eventRow.id, artist_id: artistId, performance_order: i },
        { onConflict: 'event_id,artist_id' }
      );

    if (lineupError) {
      console.error(
        `Lineup upsert failed for "${performers[i].name}" @ "${musicEvent.name}": ${lineupError.message}`
      );
    }
  }

  console.log(`Synced: ${musicEvent.name} (${eventRecord.event_date})`);
}

async function main() {
  console.log('Starting Relentless Beats scrape...');
  const marketId = await getMarketId(MARKET_SLUG);
  const promoterId = await getOrCreatePromoter('Relentless Beats');

  const eventUrls = await discoverEventUrls();
  console.log(`Found ${eventUrls.length} AZ events on relentlessbeats.com.`);

  for (const url of eventUrls) {
    try {
      const musicEvent = await fetchMusicEvent(url);
      if (!musicEvent) {
        console.warn(`No MusicEvent JSON-LD found at ${url}`);
      } else {
        await syncEvent(musicEvent, marketId, promoterId);
      }
    } catch (err) {
      console.error(`Error processing ${url}:`, err.message);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log('Relentless Beats scrape complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
