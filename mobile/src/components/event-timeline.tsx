import { StyleSheet, View } from 'react-native';

import { EventCard } from '@/components/event-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatSectionDate } from '@/lib/format-date';
import { EventWithDetails } from '@/lib/types';

// The feed is a timeline: events grouped under day headings, with a rail down
// the left connecting them. Flattened into a single list rather than a
// SectionList so FlatList still virtualizes across the whole thing.
export type TimelineItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'event'; key: string; event: EventWithDetails; isLastOfDay: boolean };

// Events arrive already ordered (event_date, doors_time, id) from
// get_filtered_events, so grouping is a single pass — no re-sorting, which
// would risk disagreeing with the server's total ordering.
export function buildTimeline(events: EventWithDetails[]): TimelineItem[] {
  const items: TimelineItem[] = [];

  events.forEach((event, i) => {
    const prev = events[i - 1];
    const next = events[i + 1];

    if (!prev || prev.event_date !== event.event_date) {
      items.push({
        type: 'header',
        key: `h-${event.event_date}`,
        label: formatSectionDate(event.event_date),
      });
    }

    items.push({
      type: 'event',
      key: `e-${event.id}`,
      event,
      isLastOfDay: !next || next.event_date !== event.event_date,
    });
  });

  return items;
}

export function DateHeader({ label }: { label: string }) {
  return (
    <ThemedText style={styles.header}>{label}</ThemedText>
  );
}

export function TimelineRow({
  event,
  isLastOfDay,
}: {
  event: EventWithDetails;
  isLastOfDay: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        {/* Spans the row's bottom padding too, so it meets the next row's line.
            On the day's last event it stops just past the dot. */}
        <View
          style={[
            styles.line,
            { backgroundColor: theme.border },
            isLastOfDay && styles.lineStub,
          ]}
        />
        <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />
      </View>

      <View style={styles.card}>
        <EventCard event={event} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    paddingBottom: Spacing.two,
  },
  rail: {
    width: 18,
  },
  line: {
    position: 'absolute',
    left: 3,
    top: 0,
    bottom: 0,
    width: 1,
  },
  lineStub: {
    bottom: undefined,
    height: 26,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginTop: 20,
    marginLeft: 0,
    opacity: 0.7,
  },
  card: {
    flex: 1,
  },
});
