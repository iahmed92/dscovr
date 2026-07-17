import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArtistLineup } from '@/components/artist-lineup';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDate } from '@/lib/format-date';
import { EventWithDetails } from '@/lib/types';

const SOURCE_LABEL: Record<string, string> = {
  ticketmaster: 'Ticketmaster',
  relentless_beats: 'Relentless Beats',
  curated: 'Curated',
};

export function EventCard({ event }: { event: EventWithDetails }) {
  const theme = useTheme();

  const artists = event.lineups
    .slice()
    .sort((a, b) => (a.performance_order ?? 0) - (b.performance_order ?? 0))
    .map((slot) => slot.artists)
    .filter((artist): artist is NonNullable<typeof artist> => artist !== null);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Link href={`/event/${event.id}`} asChild>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`View ${event.title}`}>
          {event.flyer_url ? (
            <Image source={{ uri: event.flyer_url }} style={styles.flyer} contentFit="cover" />
          ) : (
            <View style={[styles.flyer, styles.flyerFallback, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="title" themeColor="textSecondary">
                {event.title.charAt(0)}
              </ThemedText>
            </View>
          )}

          <View style={styles.cardTextBlock}>
            <View style={styles.metaRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {formatEventDate(event.event_date)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {SOURCE_LABEL[event.source_type] ?? event.source_type}
              </ThemedText>
            </View>

            <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>
              {event.title}
            </ThemedText>

            {event.venues && (
              <ThemedText type="default" themeColor="textSecondary">
                {event.venues.name}
                {event.venues.city ? ` · ${event.venues.city}` : ''}
              </ThemedText>
            )}
          </View>
        </TouchableOpacity>
      </Link>

      <View style={styles.body}>
        {artists.length > 0 && (
          <View style={styles.lineupSection}>
            <ArtistLineup artists={artists} />
          </View>
        )}

        {event.ticket_url && (
          <TouchableOpacity onPress={() => Linking.openURL(event.ticket_url!)}>
            <ThemedText type="linkPrimary">Tickets ↗</ThemedText>
          </TouchableOpacity>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  flyer: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  flyerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTextBlock: {
    padding: Spacing.three,
    paddingBottom: 0,
    gap: Spacing.one,
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.one,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    marginBottom: Spacing.one,
  },
  lineupSection: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
});
