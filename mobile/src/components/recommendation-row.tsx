import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Recommendation } from '@/hooks/use-recommendations';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDate, formatEventTime } from '@/lib/format-date';

// A recommendation is a show plus a reason. The reason is what makes it more
// than the feed: it names the favorite artist or genre that earned the pick,
// so the suggestion is legible rather than a black-box score.
export function RecommendationRow({ rec }: { rec: Recommendation }) {
  const theme = useTheme();

  const meta = [
    formatEventDate(rec.event_date),
    rec.doors_time ? formatEventTime(rec.doors_time) : null,
    rec.venue_name,
  ]
    .filter(Boolean)
    .join(' · ');

  // Artists are the stronger signal, so lead with them; fall back to genres.
  const reason =
    rec.matched_artists.length > 0
      ? `Because you like ${joinNames(rec.matched_artists)}`
      : rec.matched_genres.length > 0
        ? `Matches your ${joinNames(rec.matched_genres)}`
        : null;

  return (
    <Link href={`/event/${rec.event_id}`} asChild>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`View ${rec.title}`}
        style={styles.row}>
        {rec.flyer_url ? (
          <Image source={{ uri: rec.flyer_url }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {rec.title.charAt(0)}
            </ThemedText>
          </View>
        )}

        <View style={styles.text}>
          <ThemedText type="small" themeColor="textSecondary">
            {meta}
          </ThemedText>
          <ThemedText type="default" numberOfLines={1}>
            {rec.title}
          </ThemedText>
          {reason ? (
            <ThemedText type="small" numberOfLines={1} style={{ color: '#FF3B7F' }}>
              {reason}
            </ThemedText>
          ) : null}
        </View>
      </TouchableOpacity>
    </Link>
  );
}

// "A", "A and B", "A, B and 2 more" — keeps the reason one line.
function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
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
