// Scrapes insomniac.com/events into the same upsert pipeline as DSCOVR.js and
// the other scrapers. Insomniac (EDC, HARD, Beyond Wonderland, Countdown, plus
// their Factory 93 / Day Trip club nights) is the biggest EDM promoter and its
// festivals were essentially absent from the feed — its inventory sells through
// Front Gate / its own site, so the Ticketmaster API doesn't reliably carry it.
//
// Data source (verified 2026-07-22):
//   insomniac.com is a WordPress site behind Cloudflare, but the /events archive
//   is server-rendered and fetchable with an honest browser UA. Each listing
//   card links to an insomniac.com/events/{slug} detail page whose slug encodes
//   the LOCAL date and city (…-2026-07-24-seattle-wa), and which embeds a clean
//   schema.org MusicEvent JSON-LD (real venue, start time, ticket URL, lineup) —
//   the same shape the Relentless Beats scraper relies on. We parse the slug to
//   filter to our markets before fetching, then read the JSON-LD for the rest.
//
// A handful of marquee festivals link to their own domains instead of an
// insomniac.com detail page; those are skipped here (no per-event JSON-LD to
// key on) and are the one gap to revisit if needed.
//
// Etiquette: honest User-Agent, rate-limited, listings-for-display only.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { finishRun, observe, seenNow, sourceIdentity, startRun } from './ingest-telemetry.js';
import * as cheerio from 'cheerio';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const EVENTS_URL = 'https://www.insomniac.com/events/';
const MAX_PAGES = 20;
const REQUEST_DELAY_MS = 500;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Insomniac city (as it appears in the detail-page slug, hyphenated + state) ->
// our market slug. Suburbs fold into their metro (Scottsdale -> Phoenix). Cities
// not listed here are skipped, so expanding coverage is one line each.
const CITY_TO_MARKET = {
  // Los Angeles metro
  'los-angeles-ca': 'los-angeles', 'san-bernardino-ca': 'los-angeles',
  'pomona-ca': 'los-angeles', 'hollywood-ca': 'los-angeles', 'inglewood-ca': 'los-angeles',
  'santa-ana-ca': 'los-angeles', 'anaheim-ca': 'los-angeles', 'long-beach-ca': 'los-angeles',
  // SF Bay
  'san-francisco-ca': 'san-francisco', 'oakland-ca': 'san-francisco', 'san-jose-ca': 'san-francisco',
  // San Diego
  'san-diego-ca': 'san-diego', 'chula-vista-ca': 'san-diego',
  // Phoenix
  'phoenix-az': 'phoenix-tucson', 'scottsdale-az': 'phoenix-tucson',
  'tempe-az': 'phoenix-tucson', 'mesa-az': 'phoenix-tucson', 'tucson-az': 'phoenix-tucson',
  // Vegas
  'las-vegas-nv': 'las-vegas',
  // Pacific NW
  'seattle-wa': 'seattle', 'portland-or': 'portland',
  // Mountain
  'denver-co': 'denver', 'salt-lake-city-ut': 'salt-lake-city',
  // Texas
  'austin-tx': 'austin', 'dallas-tx': 'dallas', 'fort-worth-tx': 'dallas', 'houston-tx': 'houston',
  // Midwest
  'chicago-il': 'chicago', 'detroit-mi': 'detroit', 'minneapolis-mn': 'minneapolis',
  'kansas-city-mo': 'kansas-city', 'kansas-city-ks': 'kansas-city',
  // South / Southeast
  'atlanta-ga': 'atlanta', 'nashville-tn': 'nashville', 'new-orleans-la': 'new-orleans',
  'miami-fl': 'miami', 'miami-gardens-fl': 'miami', 'orlando-fl': 'orlando', 'tampa-fl': 'tampa',
  // Northeast
  'new-york-ny': 'new-york-city', 'brooklyn-ny': 'new-york-city', 'queens-ny': 'new-york-city',
  'boston-ma': 'boston', 'philadelphia-pa': 'philadelphia', 'washington-dc': 'washington-dc',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function politeFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

// slug tail is `…-{YYYY-MM-DD}-{city-hyphenated}-{st}`. Pull the local date and
// the city+state key. Returns null if the slug doesn't carry them.
function parseSlug(detailUrl) {
  const m = detailUrl.match(/\/events\/.*?-(\d{4}-\d{2}-\d{2})-([a-z]+(?:-[a-z]+)*-[a-z]{2})\/?$/);
  if (!m) return null;
  return { eventDate: m[1], cityKey: m[2] };
}

// ---------------------------------------------------------------------------
// Discovery: collect insomniac.com detail URLs across listing pages
// ---------------------------------------------------------------------------

async function discoverDetailUrls() {
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? EVENTS_URL : `${EVENTS_URL}page/${page}/`;
    let html;
    try {
      html = await politeFetch(url);
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    let added = 0;
    $('a[aria-label*="detail page via title"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !href.includes('insomniac.com/events/')) return; // skip external festival sites
      const clean = href.split('?')[0];
      if (!seen.has(clean)) {
        seen.add(clean);
        added++;
      }
    });
    // Featured cards repeat on every page; once a page adds nothing new we're done.
    if (added === 0) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Detail page: MusicEvent JSON-LD (same shape as the Relentless Beats scraper)
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
    const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] ?? [parsed]);
    const event = nodes.find((n) => n?.['@type'] === 'MusicEvent' || n?.['@type'] === 'Event');
    if (event) return event;
  }
  return null;
}

// Insomniac's JSON-LD stamps startDate with a +00:00 offset that is really the
// venue-local time (21:00 = a 9pm door, not 9pm UTC). Per the repo's date rule
// we never route these through Date(): the event's local calendar date comes
// from the slug, and the door time is the naive time slice.
function timePartFromStartDate(startDate) {
  if (typeof startDate !== 'string') return null;
  const m = startDate.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Supabase upsert helpers (mirror relentless-beats-scraper.js)
// ---------------------------------------------------------------------------

async function getMarketIds() {
  const { data, error } = await supabase.from('markets').select('id,slug');
  if (error) throw new Error(`Market lookup failed: ${error.message}`);
  return new Map(data.map((m) => [m.slug, m.id]));
}

async function getOrCreatePromoter(name) {
  const { data: existing } = await supabase.from('promoters').select('id').eq('name', name).maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await supabase.from('promoters').insert({ name }).select('id').single();
  if (error) throw new Error(`Promoter insert failed: ${error.message}`);
  return created.id;
}

async function upsertVenue(location, marketId) {
  if (!location?.name) return null;
  const record = { market_id: marketId, name: location.name };
  const addr = location.address;
  if (addr?.streetAddress) record.address = addr.streetAddress;
  if (addr?.addressLocality) record.city = addr.addressLocality;
  const { data, error } = await supabase
    .from('venues')
    .upsert(record, { onConflict: 'name' })
    .select('id')
    .single();
  if (error) throw new Error(`Venue upsert failed for "${location.name}": ${error.message}`);
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

function pickFlyer(image) {
  if (!image) return null;
  return Array.isArray(image) ? (image[0] ?? null) : image;
}
function pickTicketUrl(offers, fallback) {
  const offer = Array.isArray(offers) ? offers[0] : offers;
  return offer?.url ?? fallback;
}

// The slug is Insomniac's stable identity for an event.
function slugFromUrl(detailUrl) {
  const parts = detailUrl.split('?')[0].split('/').filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

async function syncEvent(detailUrl, eventDate, marketId, promoterId) {
  const musicEvent = await fetchMusicEvent(detailUrl);
  if (!musicEvent || !musicEvent.location || !musicEvent.name) return false;

  // Written as one pair — see ingest-telemetry.sourceIdentity.
  const identity = sourceIdentity('insomniac', slugFromUrl(detailUrl));
  if (!identity) return false;

  const venueId = await upsertVenue(musicEvent.location, marketId);

  observe({ venueId, title: musicEvent.name, eventDate, sourceType: 'insomniac' });

  const record = {
    venue_id: venueId,
    promoter_id: promoterId,
    title: musicEvent.name,
    event_date: eventDate, // from the slug — the local calendar date
    doors_time: timePartFromStartDate(musicEvent.startDate),
    ticket_url: pickTicketUrl(musicEvent.offers, detailUrl),
    flyer_url: pickFlyer(musicEvent.image),
    ...identity,
    last_seen_at: seenNow(),
  };

  const { data: eventRow, error } = await supabase
    .from('events')
    .upsert(record, { onConflict: 'venue_id,title,event_date' })
    .select('id')
    .single();
  if (error) {
    console.error(`Event upsert failed for "${musicEvent.name}": ${error.message}`);
    return false;
  }

  const performers = musicEvent.performer ?? [];
  for (let i = 0; i < performers.length; i++) {
    const artistId = await upsertArtist(performers[i].name);
    if (!artistId) continue;
    await supabase
      .from('lineups')
      .upsert(
        { event_id: eventRow.id, artist_id: artistId, performance_order: i },
        { onConflict: 'event_id,artist_id' }
      );
  }

  console.log(`  synced: ${musicEvent.name} @ ${musicEvent.location.name} (${eventDate})`);
  return true;
}

async function main() {
  console.log('Starting Insomniac scrape...');
  const marketIds = await getMarketIds();
  const promoterId = await getOrCreatePromoter('Insomniac');

  const detailUrls = await discoverDetailUrls();
  console.log(`Found ${detailUrls.length} Insomniac detail page(s).`);

  const today = new Date().toISOString().slice(0, 10);
  let synced = 0;
  let skipped = 0;

  // Insomniac's listing is global, so ONE completed run sweeps every mapped
  // market — which means "absent from this run" is meaningful for each of them,
  // including markets that legitimately had zero events. So a run row is opened
  // per market, not one for the source as a whole.
  const perMarket = new Map();
  const runIds = new Map();
  for (const slug of new Set(Object.values(CITY_TO_MARKET))) {
    if (!marketIds.has(slug)) continue;
    runIds.set(slug, await startRun(supabase, 'insomniac', marketIds.get(slug)));
    perMarket.set(slug, 0);
  }

  try {
  for (const url of detailUrls) {
    const parsed = parseSlug(url);
    if (!parsed) { skipped++; continue; }
    const marketSlug = CITY_TO_MARKET[parsed.cityKey];
    if (!marketSlug || !marketIds.has(marketSlug)) { skipped++; continue; } // unmapped city / not our market
    if (parsed.eventDate < today) { skipped++; continue; } // past

    try {
      if (await syncEvent(url, parsed.eventDate, marketIds.get(marketSlug), promoterId)) {
        synced++;
        perMarket.set(marketSlug, (perMarket.get(marketSlug) ?? 0) + 1);
      }
    } catch (err) {
      console.error(`Error processing ${url}:`, err.message);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  } catch (err) {
    for (const [slug, runId] of runIds) {
      await finishRun(supabase, runId, { status: 'failed', notes: err.message });
    }
    throw err;
  }

  for (const [slug, runId] of runIds) {
    await finishRun(supabase, runId, { status: 'complete', eventsSeen: perMarket.get(slug) ?? 0 });
  }

  console.log(`Insomniac scrape complete — ${synced} event(s) synced, ${skipped} skipped (unmapped city or past).`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
