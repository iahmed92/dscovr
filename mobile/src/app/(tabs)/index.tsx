import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DateHeader, TimelineRow, buildTimeline } from '@/components/event-timeline';
import { FilterChips } from '@/components/filter-chips';
import { MarketPicker } from '@/components/market-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useEvents } from '@/hooks/use-events';
import { useMarkets } from '@/hooks/use-markets';
import {
  TIMEFRAMES,
  TIMEFRAME_LABELS,
  Timeframe,
  VIBES,
  VIBE_LABELS,
  Vibe,
} from '@/lib/types';

const DEFAULT_MARKET_SLUG = 'phoenix-tucson';

const TIMEFRAME_OPTIONS = TIMEFRAMES.map((value) => ({ value, label: TIMEFRAME_LABELS[value] }));
// 'all' is a first-class option rather than a deselect: roughly half of events
// carry no vibe at all (genre_tags only exist where Spotify matched), so a vibe
// filter always hides a large chunk of the feed and needs an obvious way out.
const VIBE_OPTIONS: { value: Vibe | 'all'; label: string }[] = [
  { value: 'all', label: 'All vibes' },
  ...VIBES.map((value) => ({ value: value as Vibe | 'all', label: VIBE_LABELS[value] })),
];

export default function HomeScreen() {
  const { markets, loading: marketsLoading, error: marketsError } = useMarkets();
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [vibe, setVibe] = useState<Vibe | 'all'>('all');

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
    vibe === 'all' ? null : vibe
  );

  const loading = marketsLoading || (eventsLoading && events.length === 0);
  const error = marketsError ?? eventsError;

  // Day headers + rail metadata, recomputed only when the feed changes.
  const timeline = useMemo(() => buildTimeline(events), [events]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedView style={[styles.header, Platform.OS === 'web' && styles.headerWeb]}>
          {Platform.OS !== 'web' && (
            <ThemedText type="title" style={styles.heading}>
              DSCOVR
            </ThemedText>
          )}
          <MarketPicker
            markets={markets}
            selectedId={selectedMarketId}
            onSelect={setSelectedMarketId}
          />
          <FilterChips
            options={TIMEFRAME_OPTIONS}
            selected={timeframe}
            onSelect={setTimeframe}
            accessibilityLabel="Filter by timeframe"
          />
          <FilterChips
            options={VIBE_OPTIONS}
            selected={vibe}
            onSelect={setVibe}
            accessibilityLabel="Filter by vibe"
          />
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
              {timeframe === 'all' && vibe === 'all'
                ? 'No upcoming events in this market yet.'
                : 'No events match these filters.'}
            </ThemedText>
            {vibe !== 'all' && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                Only artists we matched on Spotify carry a vibe, so some shows won&apos;t appear
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
