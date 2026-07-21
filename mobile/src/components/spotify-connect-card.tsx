import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useSpotifyConnect } from '@/hooks/use-spotify-connect';
import { supabase } from '@/lib/supabase';

const SPOTIFY_GREEN = '#1DB954';

// "Connected" is inferred from having favorite artists/genres — the only source
// of those today is a Spotify import, and the tokens on the profile are
// SELECT-revoked so the client can't read them to check directly. Good enough
// until a dedicated flag is worth a migration.
export function SpotifyConnectCard() {
  const { userId } = useAuth();
  const { connect, status, error, summary, pkceAvailable } = useSpotifyConnect();
  const [favArtists, setFavArtists] = useState<number | null>(null);

  const refreshCounts = useCallback(async () => {
    if (userId === null) {
      setFavArtists(null);
      return;
    }
    const { count } = await supabase
      .from('user_favorite_artists')
      .select('artist_id', { count: 'exact', head: true })
      .eq('user_id', userId);
    setFavArtists(count ?? 0);
  }, [userId]);

  // Re-check on focus and after an import finishes.
  useFocusEffect(
    useCallback(() => {
      refreshCounts();
    }, [refreshCounts])
  );
  if (status === 'done' && favArtists === null) refreshCounts();

  const connected = (favArtists ?? 0) > 0 || status === 'done';
  const busy = status === 'authorizing' || status === 'importing';

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.textCol}>
          <ThemedText type="default">Spotify</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {!pkceAvailable
              ? 'Needs a secure (https) connection'
              : connected
                ? summary
                  ? `Imported ${summary.artists} artists · ${summary.genres} genres`
                  : 'Connected — powering your picks'
                : 'Connect to tune your recommendations'}
          </ThemedText>
        </View>

        <TouchableOpacity
          onPress={connect}
          disabled={busy || !pkceAvailable}
          accessibilityRole="button"
          accessibilityLabel={connected ? 'Refresh Spotify taste' : 'Connect Spotify'}
          style={[
            styles.button,
            { backgroundColor: SPOTIFY_GREEN, opacity: busy || !pkceAvailable ? 0.4 : 1 },
          ]}>
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <ThemedText type="smallBold" style={{ color: '#fff' }}>
              {connected ? 'Refresh' : 'Connect'}
            </ThemedText>
          )}
        </TouchableOpacity>
      </View>

      {status === 'importing' && (
        <ThemedText type="small" themeColor="textSecondary">
          Importing your top artists…
        </ThemedText>
      )}
      {error && (
        <ThemedText type="small" style={{ color: '#FF3B7F' }}>
          {error}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  textCol: {
    flex: 1,
    gap: Spacing.half,
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    minWidth: 96,
  },
});
