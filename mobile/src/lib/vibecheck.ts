const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export type VibeCheckResult = {
  artist_id: number;
  name: string;
  preview_url: string | null;
  source: 'spotify' | 'deezer' | null;
};

// Resolves a fresh preview URL on demand — never cached client-side, since
// both Spotify's and Deezer's underlying URLs are themselves short-lived
// (see supabase/functions/vibecheck for why nothing is stored in Postgres).
export async function resolvePreview(artistId: number): Promise<VibeCheckResult> {
  const url = `${supabaseUrl}/functions/v1/vibecheck?artist_id=${artistId}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey!,
    },
  });

  if (!res.ok) {
    throw new Error(`vibecheck failed: HTTP ${res.status}`);
  }

  return res.json();
}
