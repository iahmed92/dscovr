import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

export type FavoriteArtist = { id: number; name: string; spotify_url: string | null };
export type FavoriteGenre = { genre: string; affinity_score: number };

// The user's imported Spotify taste, for display on the account dashboard.
// `connected` is inferred from having any favorites — the Spotify tokens on the
// profile are SELECT-revoked, so the client genuinely cannot read them to check
// directly.
export function useTasteProfile() {
  const { userId } = useAuth();
  const [artists, setArtists] = useState<FavoriteArtist[]>([]);
  const [genres, setGenres] = useState<FavoriteGenre[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (userId === null) {
      setArtists([]);
      setGenres([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const [a, g] = await Promise.all([
      supabase
        .from('user_favorite_artists')
        .select('artists ( id, name, spotify_url )')
        .eq('user_id', userId),
      supabase
        .from('user_favorite_genres')
        .select('genre, affinity_score')
        .eq('user_id', userId)
        .order('affinity_score', { ascending: false })
        .limit(8),
    ]);

    const rows = (a.data ?? []) as unknown as { artists: FavoriteArtist | null }[];
    setArtists(rows.map((r) => r.artists).filter((x): x is FavoriteArtist => x !== null));
    setGenres((g.data ?? []) as FavoriteGenre[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { artists, genres, loading, connected: artists.length > 0 || genres.length > 0, reload };
}
