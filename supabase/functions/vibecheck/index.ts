// GET /functions/v1/vibecheck?artist_id=123
//
// Resolves a fresh, valid 30-second preview MP3 URL on-demand for the given
// artist row. Preview URLs are never cached in Postgres — both Spotify's
// preview_url (mostly null for API apps since Nov 2024) and Deezer's signed
// preview links (expire within hours) are too unstable to store long-term.
// This function is the single source of truth the mobile/web client calls
// at playback time.
//
// Deploy: supabase functions deploy vibecheck
// Secrets: supabase secrets set SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=...
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically by the platform.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SPOTIFY_CLIENT_ID = Deno.env.get('SPOTIFY_CLIENT_ID')!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MARKET = 'US';
const RESULT_CACHE_SECONDS = 1800; // well under Deezer's URL expiry window

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${RESULT_CACHE_SECONDS}`,
    },
  });

// ---------------------------------------------------------------------------
// Spotify (token cached in-memory for the life of the function instance)
// ---------------------------------------------------------------------------

let cachedSpotifyToken: { token: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string> {
  if (cachedSpotifyToken && cachedSpotifyToken.expiresAt > Date.now()) {
    return cachedSpotifyToken.token;
  }

  const basicAuth = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Spotify auth failed ${res.status}`);
  const data = await res.json();

  cachedSpotifyToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedSpotifyToken.token;
}

async function resolveSpotifyPreview(spotifyId: string): Promise<string | null> {
  const token = await getSpotifyToken();
  const res = await fetch(
    `https://api.spotify.com/v1/artists/${spotifyId}/top-tracks?market=${MARKET}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;

  const data = await res.json();
  const track = (data.tracks ?? []).find((t: { preview_url: string | null }) => t.preview_url);
  return track?.preview_url ?? null;
}

// ---------------------------------------------------------------------------
// Deezer (unauthenticated)
// ---------------------------------------------------------------------------

async function resolveDeezerPreview(deezerId: string): Promise<string | null> {
  const res = await fetch(`https://api.deezer.com/artist/${deezerId}/top?limit=5`);
  if (!res.ok) return null;

  const data = await res.json();
  const track = (data.data ?? []).find((t: { preview: string | null }) => t.preview);
  return track?.preview ?? null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const artistId = url.searchParams.get('artist_id');

  if (!artistId) {
    return jsonResponse({ error: 'artist_id query param is required' }, 400);
  }

  const { data: artist, error } = await supabase
    .from('artists')
    .select('id, name, spotify_id, deezer_id')
    .eq('id', artistId)
    .single();

  if (error || !artist) {
    return jsonResponse({ error: 'Artist not found' }, 404);
  }

  let previewUrl: string | null = null;
  let source: 'spotify' | 'deezer' | null = null;

  if (artist.spotify_id) {
    previewUrl = await resolveSpotifyPreview(artist.spotify_id);
    if (previewUrl) source = 'spotify';
  }

  if (!previewUrl && artist.deezer_id) {
    previewUrl = await resolveDeezerPreview(artist.deezer_id);
    if (previewUrl) source = 'deezer';
  }

  return jsonResponse({
    artist_id: artist.id,
    name: artist.name,
    preview_url: previewUrl,
    source,
  });
});
