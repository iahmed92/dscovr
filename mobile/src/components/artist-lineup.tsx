import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { ActivityIndicator, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useNowPlaying } from '@/hooks/use-now-playing';
import { useTheme } from '@/hooks/use-theme';
import { Artist } from '@/lib/types';

const VIBE_ACCENT = '#FF3B7F';
const SPOTIFY_GREEN = '#1DB954';
const MIXCLOUD_BLUE = '#5000FF';
const YOUTUBE_RED = '#FF0033';
const ICON = 14;

function IconLink({ url, icon, color }: { url: string; icon: 'spotify' | 'soundcloud'; color: string }) {
  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      hitSlop={10}
      accessibilityRole="link"
      accessibilityLabel={`Open ${icon} profile`}>
      <FontAwesome5 name={icon} size={ICON} color={color} />
    </TouchableOpacity>
  );
}

// "Hear a recent set" — the thing the SoundCloud icon was always meant to be.
// It never could be: soundcloud_url is a synthesized search link, because
// SoundCloud's API has been closed to new registrations for years.
//
// Two tiers. If the enrichment resolved the artist's own Mixcloud account we
// link their latest set directly. Otherwise we open a YouTube search for
// "<artist> live set" — labelled as a search, so it stops promising a profile
// and delivering a results page.
function LiveSetLink({ artist }: { artist: Artist }) {
  const hasSet = !!artist.mixcloud_url;

  const url = hasSet
    ? artist.mixcloud_url!
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist.name} live set`)}`;

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      hitSlop={10}
      accessibilityRole="link"
      accessibilityLabel={hasSet ? `Latest set by ${artist.name}` : `Search live sets for ${artist.name}`}>
      <FontAwesome5
        name={hasSet ? 'mixcloud' : 'youtube'}
        size={ICON}
        color={hasSet ? MIXCLOUD_BLUE : YOUTUBE_RED}
        // A search is a weaker promise than a real set, so it reads quieter.
        style={hasSet ? undefined : styles.searchIcon}
      />
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
      hitSlop={10}
      style={styles.vibeButton}
      accessibilityRole="button"
      accessibilityLabel={isActive && isPlaying ? 'Pause preview' : 'Play preview'}>
      <FontAwesome5
        name={isActive && isPlaying ? 'pause' : 'play'}
        size={ICON}
        color={hasNoPreview ? theme.textSecondary : VIBE_ACCENT}
        style={hasNoPreview ? styles.mutedIcon : undefined}
      />
    </TouchableOpacity>
  );
}

// Luma-style lineup: a wrap-around grid of artist cells rather than a full-width
// vertical stack. Each cell is the name with its streaming indicators tucked
// underneath at 14px, so the icons read as quiet metadata instead of a column
// of buttons fighting the names for attention.
// `compact` is the feed variant: play button beside the name, inline and
// wrapping, with the profile links left to the detail screen. Keeps one-tap
// previews while browsing without rebuilding the heavy icon column that made
// every card a wall of buttons.
export function ArtistLineup({
  artists,
  compact = false,
  max,
}: {
  artists: Artist[];
  compact?: boolean;
  max?: number;
}) {
  const theme = useTheme();

  if (artists.length === 0) return null;

  const shown = max ? artists.slice(0, max) : artists;
  const hidden = artists.length - shown.length;

  if (compact) {
    return (
      <View style={styles.compactRow}>
        {shown.map((artist) => (
          <View key={artist.id} style={styles.compactItem}>
            <VibeCheckButton artistId={artist.id} />
            <ThemedText style={[styles.compactName, { color: theme.textSecondary }]} numberOfLines={1}>
              {artist.name}
            </ThemedText>
          </View>
        ))}
        {hidden > 0 && (
          <ThemedText style={[styles.compactName, { color: theme.textSecondary }]}>
            +{hidden}
          </ThemedText>
        )}
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {shown.map((artist) => (
        <View key={artist.id} style={styles.cell}>
          <ThemedText type="small" numberOfLines={1}>
            {artist.name}
          </ThemedText>
          <View style={styles.icons}>
            <VibeCheckButton artistId={artist.id} />
            {artist.spotify_url && (
              <IconLink url={artist.spotify_url} icon="spotify" color={SPOTIFY_GREEN} />
            )}
            <LiveSetLink artist={artist} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  compactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: Spacing.one,
    columnGap: Spacing.two + 2,
    marginTop: 2,
  },
  compactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 1,
    maxWidth: '100%',
  },
  compactName: {
    fontSize: 12,
    lineHeight: 17,
    flexShrink: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.three,
    columnGap: Spacing.three,
  },
  // Two columns that wrap; flexGrow lets a lone trailing cell fill the row.
  cell: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 130,
    gap: Spacing.one,
  },
  icons: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  vibeButton: {
    width: ICON,
    alignItems: 'center',
  },
  mutedIcon: {
    opacity: 0.4,
  },
  searchIcon: {
    opacity: 0.55,
  },
});
