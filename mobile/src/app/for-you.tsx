import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Dropdown } from '@/components/dropdown';
import { RecommendationRow } from '@/components/recommendation-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useMarkets } from '@/hooks/use-markets';
import { useRecommendations } from '@/hooks/use-recommendations';
import { useTheme } from '@/hooks/use-theme';

const DEFAULT_MARKET_SLUG = 'phoenix-tucson';

// Personalized picks for a market, scored against the user's Spotify taste
// profile. A modal-style pushed screen off Account rather than a tab: it only
// makes sense signed in with a taste profile, so it doesn't earn permanent
// tab-bar real estate.
export default function ForYouScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { userId } = useAuth();
  const { markets } = useMarkets();
  const [marketId, setMarketId] = useState<number | null>(null);

  useEffect(() => {
    if (marketId !== null || markets.length === 0) return;
    setMarketId((markets.find((m) => m.slug === DEFAULT_MARKET_SLUG) ?? markets[0]).id);
  }, [markets, marketId]);

  const { recs, loading, error } = useRecommendations(marketId);

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={[styles.header, Platform.OS === 'web' && styles.headerWeb]}>
          <ThemedText type="subtitle" style={styles.heading}>
            For you
          </ThemedText>
          <View style={styles.filters}>
            <Dropdown
              options={markets.map((m) => ({ value: m.id, label: m.name }))}
              value={marketId}
              onChange={setMarketId}
              placeholder="City"
              accessibilityLabel="Filter by city"
            />
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {userId === null ? (
            <View style={styles.centered}>
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                Sign in and connect Spotify to get picks tuned to your taste.
              </ThemedText>
              <TouchableOpacity
                onPress={() => router.replace('/sign-in')}
                style={[styles.button, { backgroundColor: theme.text }]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  Sign in
                </ThemedText>
              </TouchableOpacity>
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                Couldn’t load picks: {error}
              </ThemedText>
            </View>
          ) : loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : recs.length === 0 ? (
            <View style={styles.centered}>
              <ThemedText themeColor="textSecondary" style={styles.centerText}>
                No picks yet. Connect Spotify from your account, or mark a few favorite artists, and
                your recommendations show up here.
              </ThemedText>
            </View>
          ) : (
            recs.map((rec) => <RecommendationRow key={rec.event_id} rec={rec} />)
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  headerWeb: {
    paddingTop: Spacing.six,
  },
  heading: {
    fontSize: 32,
    lineHeight: 40,
    paddingHorizontal: Spacing.three,
  },
  filters: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  centerText: {
    textAlign: 'center',
  },
  loader: {
    marginVertical: Spacing.six,
  },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.six,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
});
