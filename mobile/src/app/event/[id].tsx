import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArtistLineup } from '@/components/artist-lineup';
import { AttendanceButton } from '@/components/attendance-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useEvent } from '@/hooks/use-event';
import { useTheme } from '@/hooks/use-theme';
import { lineupArtists, sourceLabel } from '@/lib/event-display';
import { formatEventDate, formatEventTime } from '@/lib/format-date';
import { mapsUrl } from '@/lib/maps';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  // Number('abc') is NaN, which is truthy enough to reach the query and comes
  // back as the Postgres error "invalid input syntax for type integer: NaN".
  // A non-numeric id in the URL is just a bad link — treat it as not found.
  const parsedId = Number(id);
  const eventId = id && Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;

  const { event, loading, error } = useEvent(eventId);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (error || !event) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary">
          {error ?? "Couldn't find that event."}
        </ThemedText>
      </ThemedView>
    );
  }

  const artists = lineupArtists(event.lineups);

  const venueMapsUrl = event.venues ? mapsUrl(event.venues) : null;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {event.flyer_url ? (
            <Image source={{ uri: event.flyer_url }} style={styles.flyer} contentFit="cover" />
          ) : (
            <View style={[styles.flyer, styles.flyerFallback, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="title" themeColor="textSecondary">
                {event.title.charAt(0)}
              </ThemedText>
            </View>
          )}

          <View style={styles.body}>
            <View style={styles.metaRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {formatEventDate(event.event_date)}
                {event.doors_time ? ` · ${formatEventTime(event.doors_time)}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {sourceLabel(event.source_type)}
              </ThemedText>
            </View>

            <ThemedText type="title" style={styles.title}>
              {event.title}
            </ThemedText>

            {event.venues && (
              <TouchableOpacity
                disabled={!venueMapsUrl}
                onPress={() => venueMapsUrl && Linking.openURL(venueMapsUrl)}
                style={styles.venueBlock}>
                <ThemedText type="default">{event.venues.name}</ThemedText>
                {event.venues.address && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {event.venues.address}
                    {event.venues.city ? `, ${event.venues.city}` : ''}
                  </ThemedText>
                )}
                {venueMapsUrl && (
                  <ThemedText type="linkPrimary" style={styles.mapsLink}>
                    Open in Maps ↗
                  </ThemedText>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.actions}>
              <AttendanceButton eventId={event.id} />

              {event.ticket_url && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(event.ticket_url!)}
                  style={[styles.ticketButton, { backgroundColor: theme.text }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Get Tickets
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>

            {artists.length > 0 && (
              <View style={styles.lineupSection}>
                <ThemedText type="subtitle" style={styles.lineupHeading}>
                  Lineup
                </ThemedText>
                <ArtistLineup artists={artists} />
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  content: {
    paddingBottom: Spacing.six,
  },
  flyer: {
    width: '100%',
    aspectRatio: 1,
  },
  flyerFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 28,
    lineHeight: 32,
  },
  venueBlock: {
    gap: Spacing.half,
  },
  mapsLink: {
    marginTop: Spacing.half,
  },
  actions: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  ticketButton: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  lineupSection: {
    marginTop: Spacing.four,
    gap: Spacing.three,
  },
  lineupHeading: {
    fontSize: 20,
    lineHeight: 24,
  },
});
