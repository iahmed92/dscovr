import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EventCard } from '@/components/event-card';
import { MarketPicker } from '@/components/market-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useEvents } from '@/hooks/use-events';
import { useMarkets } from '@/hooks/use-markets';

const DEFAULT_MARKET_SLUG = 'phoenix-tucson';

export default function HomeScreen() {
  const { markets, loading: marketsLoading, error: marketsError } = useMarkets();
  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedMarketId !== null || markets.length === 0) return;
    const defaultMarket = markets.find((m) => m.slug === DEFAULT_MARKET_SLUG) ?? markets[0];
    setSelectedMarketId(defaultMarket.id);
  }, [markets, selectedMarketId]);

  const { events, loading: eventsLoading, error: eventsError } = useEvents(selectedMarketId);

  const loading = marketsLoading || (eventsLoading && events.length === 0);
  const error = marketsError ?? eventsError;

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
            <ThemedText themeColor="textSecondary">No upcoming events in this market yet.</ThemedText>
          </ThemedView>
        )}

        {!error && !loading && events.length > 0 && (
          <FlatList
            data={events}
            keyExtractor={(event) => String(event.id)}
            renderItem={({ item }) => <EventCard event={item} />}
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
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
  },
});
