// Turns a Spotify "top artists" response into the rows that populate a user's
// taste profile. Pure and dependency-free so it can be unit-tested directly
// (node --experimental-strip-types) and can't drift from what the app runs.
//
// normalizeArtistName mirrors the pipeline's matcher in spotify-vibe-check.js on
// purpose: that script matched our booked artists *to* Spotify; this matches a
// user's Spotify artists back *to* our roster. Same normalization on both sides
// or the two never line up.

export type SpotifyArtist = {
  id: string;
  name: string;
  genres: string[];
};

export type FavoriteGenre = { genre: string; affinity_score: number };

export type TasteProfile = {
  favoriteGenres: FavoriteGenre[];
  // Our artists.id for every top artist we could match by normalized name.
  favoriteArtistIds: number[];
  // Top-artist names we could NOT match — surfaced for diagnostics, not stored.
  unmatchedArtistNames: string[];
};

export function normalizeArtistName(name: string): string {
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

// Keep the genre list to the strongest signals; a long Spotify genre tail is
// noise the recommendation scorer would sum over.
const MAX_GENRES = 20;

// artistIdByNormalizedName maps our roster's normalized names to ids — built by
// the caller from a `select id, name from artists`. Genre affinity is frequency:
// how many of the user's top artists play that genre, which is exactly what
// get_personalized_recommendations sums, so a genre many top artists share
// scores higher.
export function buildTasteProfile(
  topArtists: SpotifyArtist[],
  artistIdByNormalizedName: Map<string, number>
): TasteProfile {
  const genreCounts = new Map<string, number>();
  const artistIds = new Set<number>();
  const unmatched: string[] = [];

  for (const artist of topArtists) {
    for (const genre of artist.genres) {
      const key = genre.trim().toLowerCase();
      if (!key) continue;
      genreCounts.set(key, (genreCounts.get(key) ?? 0) + 1);
    }

    const id = artistIdByNormalizedName.get(normalizeArtistName(artist.name));
    if (id !== undefined) artistIds.add(id);
    else unmatched.push(artist.name);
  }

  const favoriteGenres = [...genreCounts.entries()]
    .map(([genre, affinity_score]) => ({ genre, affinity_score }))
    // Highest affinity first; ties broken alphabetically so the cut at
    // MAX_GENRES is deterministic rather than insertion-order-dependent.
    .sort((a, b) => b.affinity_score - a.affinity_score || a.genre.localeCompare(b.genre))
    .slice(0, MAX_GENRES);

  return {
    favoriteGenres,
    favoriteArtistIds: [...artistIds],
    unmatchedArtistNames: unmatched,
  };
}
