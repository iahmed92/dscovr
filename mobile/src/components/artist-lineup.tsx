import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { ActivityIndicator, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useNowPlaying } from '@/hooks/use-now-playing';
import { useTheme } from '@/hooks/use-theme';
import { Artist } from '@/lib/types';

const VIBE_ACCENT = '#FF3B7F';

function IconLink({ url, icon, color }: { url: string; icon: 'spotify' | 'soundcloud'; color: string }) {
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel={`Open ${icon} profile`}>
      <FontAwesome5 name={icon} size={16} color={color} />
    </TouchableOpacity>
  );
}

function VibeCheckButton({ artistId }: { artistId: number }) {
  const theme = useTheme();
  const { activeArtistId, isPlaying, loadingArtistId, errorArtistId, toggle } = useNowPlaying();

  const isLoading = loadingArtistId === artistId;
  const isActive = activeArtistId === artistId;
  const hasNoPreview = errorArtistId === artistId;

  if (isLoading) {
    return <ActivityIndicator size="small" color={VIBE_ACCENT} style={styles.vibeButton} />;
  }

  return (
    <TouchableOpacity
      onPress={() => toggle(artistId)}
      hitSlop={8}
      style={styles.vibeButton}
      accessibilityRole="button"
      accessibilityLabel={isActive && isPlaying ? 'Pause preview' : 'Play preview'}>
      <FontAwesome5
        name={isActive && isPlaying ? 'pause' : 'play'}
        size={14}
        color={hasNoPreview ? theme.textSecondary : VIBE_ACCENT}
        style={hasNoPreview ? styles.mutedIcon : undefined}
      />
    </TouchableOpacity>
  );
}

export function ArtistLineup({ artists }: { artists: Artist[] }) {
  const theme = useTheme();

  if (artists.length === 0) return null;

  return (
    <View style={styles.container}>
      {artists.map((artist) => (
        <View key={artist.id} style={styles.row}>
          <ThemedText type="small" style={styles.name} numberOfLines={1}>
            {artist.name}
          </ThemedText>
          <View style={styles.icons}>
            <VibeCheckButton artistId={artist.id} />
            {artist.spotify_url && (
              <IconLink url={artist.spotify_url} icon="spotify" color="#1DB954" />
            )}
            {artist.soundcloud_url && (
              <IconLink url={artist.soundcloud_url} icon="soundcloud" color={theme.textSecondary} />
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  name: {
    flex: 1,
  },
  icons: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  vibeButton: {
    width: 16,
    alignItems: 'center',
  },
  mutedIcon: {
    opacity: 0.4,
  },
});
