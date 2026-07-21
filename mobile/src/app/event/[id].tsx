import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArtistLineup } from '@/components/artist-lineup';
import { AttendanceButton } from '@/components/attendance-button';
import { FriendsGoing } from '@/components/friends-going';
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
          {/* Inset and rounded rather than a full-bleed square — the same card
              language as the feed, so the two screens read as one app. */}
          <View style={styles.flyerWrap}>
            {event.flyer_url ? (
              <Image
                source={{ uri: event.flyer_url }}
                style={[styles.flyer, { borderColor: theme.border }]}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.flyer,
                  styles.flyerFallback,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                ]}>
                <ThemedText style={styles.title} themeColor="textSecondary">
                  {event.title.charAt(0)}
                </ThemedText>
              </View>
            )}
          </View>

          <View style={styles.body}>
            <View style={styles.metaRow}>
              <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
                {formatEventDate(event.event_date)}
                {event.doors_time ? ` · ${formatEventTime(event.doors_time)}` : ''}
              </ThemedText>
              <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
                {sourceLabel(event.source_type)}
              </ThemedText>
            </View>

            <ThemedText style={styles.title}>{event.title}</ThemedText>

            {event.is_festival && (
              <View style={[styles.badge, { borderColor: theme.border }]}>
                <ThemedText style={[styles.badgeText, { color: theme.textSecondary }]}>
                  FESTIVAL
                </ThemedText>
              </View>
            )}

            {event.venues && (
              <TouchableOpacity
                disabled={!venueMapsUrl}
                onPress={() => venueMapsUrl && Linking.openURL(venueMapsUrl)}
                style={[
                  styles.venueBlock,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                ]}>
                <ThemedText style={styles.venueName}>{event.venues.name}</ThemedText>
                {event.venues.address && (
                  <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
                    {event.venues.address}
                    {event.venues.city ? `, ${event.venues.city}` : ''}
                  </ThemedText>
                )}
                {venueMapsUrl && (
                  <ThemedText style={styles.mapsLink}>Open in Maps ↗</ThemedText>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.actions}>
              <AttendanceButton eventId={event.id} />
              <FriendsGoing eventId={event.id} />

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
                <ThemedText style={styles.sectionHeading}>Lineup</ThemedText>
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
  flyerWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  // 16:9 rather than a full-bleed square: the poster shouldn't own the whole
  // first screen before the title and time.
  flyer: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 14,
    borderWidth: 1,
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
  // Same narrow ramp as the feed — 24px here rather than 16 because the title
  // is the page, but nowhere near the old 28px on the loose starter scale.
  title: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  venueBlock: {
    gap: 3,
    padding: Spacing.three - 2,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: Spacing.one,
  },
  venueName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
  },
  mapsLink: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: '#FF3B7F',
    marginTop: 2,
  },
  actions: {
    marginTop: Spacing.two,
    gap: Spacing.two,
  },
  ticketButton: {
    paddingVertical: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
  },
  lineupSection: {
    marginTop: Spacing.four,
    gap: Spacing.three,
  },
  // Matches the feed's day headers so sections read consistently.
  sectionHeading: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
});
