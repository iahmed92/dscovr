import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MyShow } from '@/hooks/use-my-shows';
import { formatEventDate, formatEventTime } from '@/lib/format-date';

// Compact row for the rave resume — a thumbnail, title, date, venue. Lighter
// than EventCard (no flyer hero, lineup, or ticket button) because a saved-shows
// list is a scan, not a browse.
export function ShowRow({ show }: { show: MyShow }) {
  const theme = useTheme();

  const meta = [
    formatEventDate(show.event_date),
    show.doors_time ? formatEventTime(show.doors_time) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const venue = [show.venue_name, show.venue_city].filter(Boolean).join(' · ');

  return (
    <Link href={`/event/${show.id}`} asChild>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`View ${show.title}`}
        style={styles.row}>
        {show.flyer_url ? (
          <Image source={{ uri: show.flyer_url }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {show.title.charAt(0)}
            </ThemedText>
          </View>
        )}

        <View style={styles.text}>
          <ThemedText type="small" themeColor="textSecondary">
            {meta}
          </ThemedText>
          <ThemedText type="default" numberOfLines={1}>
            {show.title}
          </ThemedText>
          {venue ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {venue}
            </ThemedText>
          ) : null}
        </View>
      </TouchableOpacity>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});
