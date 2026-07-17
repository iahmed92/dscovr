// "Vibe Check" ID resolver: scans the artists table for rows missing a
// stable streaming-service ID, and backfills spotify_id / spotify_url /
// genre_tags (Spotify), deezer_id (Deezer), and soundcloud_url (always, a
// search-results link — there's no API-verified SoundCloud ID to key off).
//
// This script does NOT fetch or store preview URLs. Both Spotify's
// preview_url (killed for API apps in Nov 2024) and Deezer's preview MP3s
// (signed, expire within hours) are too unstable to cache long-term.
// Instead we store the permanent artist IDs here, and resolve a fresh
// preview URL on-demand via the `vibecheck` Supabase Edge Function
// (supabase/functions/vibecheck) at request time.

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } =
  process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}
if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REQUEST_DELAY_MS = 150;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

// Booking names carry decoration the streaming services don't: "(UK)" region
// tags, "DJ Set" / "B2B" billing, a leading "The". Strip that before comparing
// so "Tycho DJ Set" still resolves to Tycho.
export function normalizeArtistName(name) {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(dj set|live set|b2b)\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

// Both search endpoints rank *something* first for any query, so trusting the
// top hit silently links unknown local DJs to whoever is popular — "Donk" to
// Beyoncé, the venue "Hamburger Mary's" to a baroque ensemble. A wrong id is
// worse than none: the vibecheck function plays that artist's audio. So only
// a normalized name match counts, and no match resolves to null.
function pickMatch(candidates, name, readName) {
  const target = normalizeArtistName(name);
  return candidates.find((c) => normalizeArtistName(readName(c)) === target) ?? null;
}

// ---------------------------------------------------------------------------
// Spotify auth + fetch
// ---------------------------------------------------------------------------

async function getSpotifyToken() {
  const basicAuth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString(
    'base64'
  );

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Spotify auth failed ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function spotifyFetch(url, token, attempt = 1) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 429 && attempt <= 3) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 1);
    console.warn(`Rate limited by Spotify, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return spotifyFetch(url, token, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Spotify API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function findSpotifyArtist(name, token) {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', name);
  url.searchParams.set('type', 'artist');
  url.searchParams.set('limit', '5');

  const data = await spotifyFetch(url, token);
  const candidates = data.artists?.items ?? [];
  return pickMatch(candidates, name, (artist) => artist.name);
}

// ---------------------------------------------------------------------------
// Deezer lookup (unauthenticated)
// ---------------------------------------------------------------------------

async function findDeezerArtistId(name) {
  const searchUrl = new URL('https://api.deezer.com/search/artist');
  searchUrl.searchParams.set('q', name);

  const res = await fetch(searchUrl);
  if (!res.ok) throw new Error(`Deezer artist search failed ${res.status}`);
  const data = await res.json();

  const candidates = data.data ?? [];
  return pickMatch(candidates, name, (a) => a.name)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function getArtistsMissingIds() {
  const { data, error } = await supabase
    .from('artists')
    .select('id, name, spotify_id, deezer_id')
    .is('deezer_id', null);

  if (error) throw new Error(`Failed to load artists: ${error.message}`);
  return data;
}

async function updateArtist(id, fields) {
  const { error } = await supabase.from('artists').update(fields).eq('id', id);
  if (error) throw new Error(`Failed to update artist ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Main sync
// ---------------------------------------------------------------------------

function soundcloudSearchUrl(name) {
  return `https://soundcloud.com/search/people?q=${encodeURIComponent(name)}`;
}

async function processArtist(artist, token) {
  const fields = { soundcloud_url: soundcloudSearchUrl(artist.name) };

  const spotifyMatch = await findSpotifyArtist(artist.name, token);
  if (spotifyMatch) {
    fields.spotify_id = spotifyMatch.id;
    fields.spotify_url = `https://open.spotify.com/artist/${spotifyMatch.id}`;
    if (spotifyMatch.genres?.length) fields.genre_tags = spotifyMatch.genres.slice(0, 10);
  } else {
    console.warn(`No Spotify match for "${artist.name}"`);
  }

  let deezerId = null;
  try {
    deezerId = await findDeezerArtistId(artist.name);
    if (deezerId) fields.deezer_id = String(deezerId);
  } catch (err) {
    console.warn(`Deezer lookup failed for "${artist.name}": ${err.message}`);
  }

  if (Object.keys(fields).length > 0) {
    await updateArtist(artist.id, fields);
  }

  const sources = [spotifyMatch ? 'spotify' : null, deezerId ? 'deezer' : null].filter(Boolean);
  console.log(
    sources.length > 0
      ? `Vibe Check: "${artist.name}" -> resolved (${sources.join(', ')})`
      : `Vibe Check: "${artist.name}" -> no match on Spotify or Deezer`
  );
}

async function main() {
  console.log('Starting Spotify Vibe Check ID resolver...');
  const token = await getSpotifyToken();

  const artists = await getArtistsMissingIds();
  console.log(`${artists.length} artist(s) missing a deezer_id.`);

  for (const artist of artists) {
    try {
      await processArtist(artist, token);
    } catch (err) {
      console.error(`Error processing "${artist.name}":`, err.message);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log('Vibe Check ID resolver complete.');
}

// Guarded so the matching helpers above can be imported (by tests, or the
// link auditor) without kicking off a full sync as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
