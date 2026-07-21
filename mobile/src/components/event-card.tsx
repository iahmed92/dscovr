import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArtistLineup } from '@/components/artist-lineup';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { lineupArtists } from '@/lib/event-display';
import { formatEventTime } from '@/lib/format-date';
import { EventWithDetails } from '@/lib/types';

// Compact row, Luma-style: the content leads and the artwork is a small square
// on the right. The previous full-bleed 16:9 hero plus a 32px title made every
// card a poster — fine for one event, unscannable as a feed.
//
// The lineup shows as a single muted line here rather than the interactive grid;
// Vibe Check playback lives on the detail screen, so the feed stays scannable.
export function EventCard({ event }: { event: EventWithDetails }) {
  const theme = useTheme();

  const artists = lineupArtists(event.lineups);
  const venue = [event.venues?.name, event.venues?.city].filter(Boolean).join(' · ');
  const time = event.doors_time ? formatEventTime(event.doors_time) : null;

  return (
    <Link href={`/event/${event.id}`} asChild>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`View ${event.title}`}
        // Flattened, not an array: expo-router's <Link asChild> slot rejects
        // style arrays on its direct child.
        style={StyleSheet.flatten([
          styles.card,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ])}>
        <View style={styles.text}>
          {event.is_featured && (
            <ThemedText style={styles.featured}>FEATURED</ThemedText>
          )}
          {time && (
            <ThemedText style={[styles.time, { color: theme.textSecondary }]}>{time}</ThemedText>
          )}

          <ThemedText style={styles.title} numberOfLines={2}>
            {event.title}
          </ThemedText>

          {venue ? (
            <ThemedText style={[styles.meta, { color: theme.textSecondary }]} numberOfLines={1}>
              {venue}
            </ThemedText>
          ) : null}

          {/* Compact lineup: one-tap previews without the icon column. Capped so
              a 30-artist festival doesn't turn its card into a wall. */}
          {artists.length > 0 && <ArtistLineup artists={artists} compact max={4} />}
        </View>

        {event.flyer_url ? (
          <Image source={{ uri: event.flyer_url }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText style={[styles.title, { color: theme.textSecondary }]}>
              {event.title.charAt(0)}
            </ThemedText>
          </View>
        )}
      </TouchableOpacity>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three - 2,
    borderRadius: 14,
    borderWidth: 1,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  // Tight ramp: weight and color carry the hierarchy, not size jumps.
  // Labelled, not disguised: a promoted slot says so.
  featured: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#FF3B7F',
  },
  time: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '500',
  },
  title: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  thumb: {
    width: 68,
    height: 68,
    borderRadius: 10,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
