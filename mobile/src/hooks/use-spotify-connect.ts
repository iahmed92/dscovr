import { exchangeCodeAsync, useAuthRequest } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_DISCOVERY,
  SPOTIFY_SCOPES,
  spotifyRedirectUri,
} from '@/lib/spotify-auth';
import { buildTasteProfile, normalizeArtistName, SpotifyArtist } from '@/lib/spotify-taste';
import { supabase } from '@/lib/supabase';

// Required so the browser tab/popup that Spotify redirects back to can hand the
// result to the waiting request instead of dead-ending. No-op off web.
WebBrowser.maybeCompleteAuthSession();

type Status = 'idle' | 'authorizing' | 'importing' | 'done' | 'error';

// Connects the signed-in user's Spotify account (PKCE, no secret) and turns
// their top artists into the taste profile that powers recommendations. All of
// it runs client-side against RLS-protected tables — the user writes their own
// favorites and stores their own tokens; no edge function or service role.
export function useSpotifyConnect() {
  const { userId } = useAuth();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ artists: number; genres: number } | null>(null);

  const redirectUri = spotifyRedirectUri();

  const [request, response, promptAsync] = useAuthRequest(
    {
      clientId: SPOTIFY_CLIENT_ID ?? '',
      scopes: SPOTIFY_SCOPES,
      usePKCE: true,
      redirectUri,
    },
    SPOTIFY_DISCOVERY
  );

  useEffect(() => {
    if (!response) return;

    if (response.type === 'error') {
      setStatus('error');
      setError(response.error?.message ?? 'Spotify authorization failed.');
      return;
    }
    if (response.type !== 'success' || !request?.codeVerifier) return;

    let cancelled = false;

    async function importTaste(code: string, verifier: string) {
      try {
        setStatus('importing');
        setError(null);

        // PKCE exchange — code_verifier stands in for the client secret.
        const token = await exchangeCodeAsync(
          {
            clientId: SPOTIFY_CLIENT_ID ?? '',
            code,
            redirectUri,
            extraParams: { code_verifier: verifier },
          },
          SPOTIFY_DISCOVERY
        );

        const topArtists = await fetchTopArtists(token.accessToken);
        const roster = await loadRoster();
        const profile = buildTasteProfile(topArtists, roster);

        if (cancelled || userId === null) return;

        await persistTaste(userId, profile.favoriteGenres, profile.favoriteArtistIds);
        await persistTokens(userId, token.accessToken, token.refreshToken ?? null);

        if (cancelled) return;
        setSummary({ artists: profile.favoriteArtistIds.length, genres: profile.favoriteGenres.length });
        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Could not import your Spotify taste.');
      }
    }

    importTaste(response.params.code, request.codeVerifier);
    return () => {
      cancelled = true;
    };
    // redirectUri is stable per render; response/request drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, request, userId]);

  async function connect() {
    if (!SPOTIFY_CLIENT_ID) {
      setStatus('error');
      setError('Spotify is not configured (missing EXPO_PUBLIC_SPOTIFY_CLIENT_ID).');
      return;
    }
    setStatus('authorizing');
    setError(null);
    await promptAsync();
  }

  return { connect, status, error, summary, redirectUri, ready: !!request };
}

async function fetchTopArtists(accessToken: string): Promise<SpotifyArtist[]> {
  const res = await fetch('https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Spotify top artists failed (${res.status})`);
  const data = await res.json();
  return (data.items ?? []).map((a: { id: string; name: string; genres?: string[] }) => ({
    id: a.id,
    name: a.name,
    genres: a.genres ?? [],
  }));
}

// Normalized-name -> our artists.id, for matching the user's Spotify artists
// back to our roster. artists is public-read, so the anon key is enough.
async function loadRoster(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('artists').select('id, name');
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as { id: number; name: string }[]) {
    map.set(normalizeArtistName(row.name), row.id);
  }
  return map;
}

// Replace, not merge: a re-import should reflect current taste, not accumulate
// stale favorites. Delete-then-insert under the user's own RLS.
async function persistTaste(
  userId: string,
  genres: { genre: string; affinity_score: number }[],
  artistIds: number[]
) {
  await supabase.from('user_favorite_genres').delete().eq('user_id', userId);
  await supabase.from('user_favorite_artists').delete().eq('user_id', userId);

  if (genres.length > 0) {
    const { error } = await supabase
      .from('user_favorite_genres')
      .insert(genres.map((g) => ({ user_id: userId, genre: g.genre, affinity_score: g.affinity_score })));
    if (error) throw new Error(error.message);
  }
  if (artistIds.length > 0) {
    const { error } = await supabase
      .from('user_favorite_artists')
      .insert(artistIds.map((artist_id) => ({ user_id: userId, artist_id })));
    if (error) throw new Error(error.message);
  }
}

async function persistTokens(userId: string, accessToken: string, refreshToken: string | null) {
  // The profile UPDATE grant covers these columns; SELECT on them is revoked,
  // so the client writes but can't read them back.
  const { error } = await supabase
    .from('profiles')
    .update({ spotify_access_token: accessToken, spotify_refresh_token: refreshToken })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
