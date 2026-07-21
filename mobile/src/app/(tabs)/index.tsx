import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dropdown } from '@/components/dropdown';
import { DateHeader, TimelineRow, buildTimeline } from '@/components/event-timeline';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useEvents } from '@/hooks/use-events';
import { useMarkets } from '@/hooks/use-markets';
import {
  TIMEFRAMES,
  TIMEFRAME_LABELS,
  Timeframe,
  GENRES,
  GENRE_LABELS,
  Genre,
} from '@/lib/types';

const DEFAULT_MARKET_SLUG = 'phoenix-tucson';

const TIMEFRAME_OPTIONS = TIMEFRAMES.map((value) => ({ value, label: TIMEFRAME_LABELS[value] }));
// 'all' is a first-class option rather than a deselect: roughly half of events
// carry no genre at all (genre_tags only exist where Spotify matched), so a
// genre filter always hides a large chunk of the feed and needs an obvious way out.
// 'other' is the catch-all for events whose artists produced no genre tags
// (about half of them) — without it, picking any genre silently hides them.
const GENRE_OPTIONS: { value: Genre | 'all' | 'other'; label: string }[] = [
  { value: 'all', label: 'All genres' },
  ...GENRES.map((value) => ({ value: value as Genre | 'all' | 'other', label: GENRE_LABELS[value] })),
  { value: 'other', label: 'Other' },
];

export default function HomeScreen() {
  const { markets, loading: marketsLoading, error: marketsError } = useMarkets();
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [genre, setGenre] = useState<Genre | 'all' | 'other'>('all');

  useEffect(() => {
    if (selectedMarketId !== null || markets.length === 0) return;
    const defaultMarket = markets.find((m) => m.slug === DEFAULT_MARKET_SLUG) ?? markets[0];
    setSelectedMarketId(defaultMarket.id);
  }, [markets, selectedMarketId]);

  // get_filtered_events keys off the slug, not the id.
  const marketSlug = markets.find((m) => m.id === selectedMarketId)?.slug ?? null;

  const { events, loading: eventsLoading, error: eventsError } = useEvents(
    marketSlug,
    timeframe,
    genre === 'all' ? null : genre
  );

  const loading = marketsLoading || (eventsLoading && events.length === 0);
  const error = marketsError ?? eventsError;

  // Day headers + rail metadata, recomputed only when the feed changes.
  const timeline = useMemo(() => buildTimeline(events), [events]);

  const marketOptions = useMemo(
    () => markets.map((m) => ({ value: m.id, label: m.name })),
    [markets]
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedView style={[styles.header, Platform.OS === 'web' && styles.headerWeb]}>
          {Platform.OS !== 'web' && (
            <ThemedText type="title" style={styles.heading}>
              DSCOVR
            </ThemedText>
          )}
          {/* Three compact dropdowns on one line, instead of three stacked pill
              rows that pushed the first event ~150px down the screen. */}
          <View style={styles.filters}>
            <Dropdown
              options={marketOptions}
              value={selectedMarketId}
              onChange={setSelectedMarketId}
              placeholder="City"
              accessibilityLabel="Filter by city"
            />
            <Dropdown
              options={TIMEFRAME_OPTIONS}
              value={timeframe}
              onChange={setTimeframe}
              accessibilityLabel="Filter by date"
            />
            <Dropdown
              options={GENRE_OPTIONS}
              value={genre}
              onChange={setGenre}
              accessibilityLabel="Filter by genre"
            />
          </View>
        </ThemedView>

        {error && (
          <ThemedView style={styles.centered}>
            <ThemedText themeColor="textSecondary">Couldn&apos;t load events: {error}</ThemedText>
          </ThemedView>
        )}

        {!error && loading && (
          <ThemedView style={styles.centered}>
            <ActivityIndicator />
          </ThemedView>
        )}

        {!error && !loading && events.length === 0 && (
          <ThemedView style={styles.centered}>
            <ThemedText themeColor="textSecondary" style={styles.emptyText}>
              {timeframe === 'all' && genre === 'all'
                ? 'No upcoming events in this market yet.'
                : 'No events match these filters.'}
            </ThemedText>
            {genre !== 'all' && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                Only artists we matched on Spotify carry a genre, so some shows won&apos;t appear
                under one.
              </ThemedText>
            )}
          </ThemedView>
        )}

        {!error && !loading && events.length > 0 && (
          <FlatList
            data={timeline}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) =>
              item.type === 'header' ? (
                <DateHeader label={item.label} />
              ) : (
                <TimelineRow event={item.event} isLastOfDay={item.isLastOfDay} />
              )
            }
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  // Web puts the tab bar in a floating pill pinned to the top that already
  // carries the DSCOVR brand, so the heading above is native-only and the
  // content clears the pill instead — same inset explore.tsx uses.
  headerWeb: {
    paddingTop: Spacing.six,
  },
  heading: {
    paddingHorizontal: Spacing.three,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  emptyText: {
    textAlign: 'center',
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
  },
});
