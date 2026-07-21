import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ShowRow } from '@/components/show-row';
import { SpotifyConnectCard } from '@/components/spotify-connect-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useMyShows } from '@/hooks/use-my-shows';
import { useProfile } from '@/hooks/use-profile';
import { useTasteProfile } from '@/hooks/use-taste-profile';
import { useTheme } from '@/hooks/use-theme';

// The former Explore starter boilerplate is now the account surface — sign-in
// state plus the rave resume (saved shows). Friends land here next. Route file
// stays explore.tsx so the typed routes and native tab config don't churn; the
// tab is labelled Account.
export default function AccountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { userId, initializing, signOut } = useAuth();
  const { profile } = useProfile();
  const { upcoming, past, loading, reload } = useMyShows();
  const { artists: favoriteArtists, genres: favoriteGenres, connected: spotifyConnected } = useTasteProfile();

  const signedIn = userId !== null;

  // Re-fetch each time the tab regains focus, so a show just saved from the
  // detail screen shows up on the way back without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.body, Platform.OS === 'web' && styles.bodyWeb]}
          showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle" style={styles.heading}>
            Account
          </ThemedText>

          {initializing ? null : !signedIn ? (
            <View style={styles.section}>
              <ThemedText themeColor="textSecondary">
                Sign in to save the shows you’re hitting and get picks tuned to your taste.
              </ThemedText>
              <TouchableOpacity
                onPress={() => router.push('/sign-in')}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                style={[styles.button, { backgroundColor: theme.text }]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  Sign in
                </ThemedText>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
                <View style={styles.profileRow}>
                  <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="default" themeColor="textSecondary">
                      {(profile?.username ?? '?').charAt(0).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.profileText}>
                    <ThemedText type="default">{profile?.username ?? '—'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {past.length} attended · {upcoming.length} going
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      spotifyConnected
                        ? { borderColor: '#1DB954' }
                        : { borderColor: theme.border },
                    ]}>
                    <ThemedText
                      style={[
                        styles.badgeText,
                        { color: spotifyConnected ? '#1DB954' : theme.textSecondary },
                      ]}>
                      {spotifyConnected ? 'SPOTIFY' : 'NOT LINKED'}
                    </ThemedText>
                  </View>
                </View>

                {favoriteGenres.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {favoriteGenres.map((g) => g.genre).join(' · ')}
                  </ThemedText>
                )}
              </ThemedView>

              {favoriteArtists.length > 0 && (
                <View style={styles.section}>
                  <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                    YOUR ARTISTS
                  </ThemedText>
                  <View style={styles.artistWrap}>
                    {favoriteArtists.slice(0, 12).map((a) => (
                      <View
                        key={a.id}
                        style={[styles.artistChip, { borderColor: theme.border }]}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {a.name}
                        </ThemedText>
                      </View>
                    ))}
                    {favoriteArtists.length > 12 && (
                      <ThemedText type="small" themeColor="textSecondary">
                        +{favoriteArtists.length - 12}
                      </ThemedText>
                    )}
                  </View>
                </View>
              )}

              <TouchableOpacity
                onPress={() => router.push('/for-you')}
                accessibilityRole="button"
                accessibilityLabel="For you — personalized picks"
                style={[styles.forYou, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.forYouText}>
                  <ThemedText type="default">For you</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Picks tuned to your taste
                  </ThemedText>
                </View>
                <ThemedText type="default" themeColor="textSecondary">
                  ›
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/friends')}
                accessibilityRole="button"
                accessibilityLabel="Friends"
                style={[styles.forYou, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.forYouText}>
                  <ThemedText type="default">Friends</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    See who’s going out
                  </ThemedText>
                </View>
                <ThemedText type="default" themeColor="textSecondary">
                  ›
                </ThemedText>
              </TouchableOpacity>

              <SpotifyConnectCard />

              {loading && upcoming.length === 0 && past.length === 0 ? (
                <ActivityIndicator style={styles.loader} />
              ) : upcoming.length === 0 && past.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                  No saved shows yet. Tap “Going” on a show and it lands here.
                </ThemedText>
              ) : (
                <>
                  {upcoming.length > 0 && (
                    <View style={styles.section}>
                      <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                        UPCOMING
                      </ThemedText>
                      {upcoming.map((show) => (
                        <ShowRow key={show.id} show={show} />
                      ))}
                    </View>
                  )}

                  {past.length > 0 && (
                    <View style={styles.section}>
                      <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                        RAVE RESUME
                      </ThemedText>
                      {past.map((show) => (
                        <ShowRow key={show.id} show={show} />
                      ))}
                    </View>
                  )}
                </>
              )}

              <TouchableOpacity
                onPress={signOut}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                style={[styles.button, styles.signOut, { borderColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold">Sign out</ThemedText>
              </TouchableOpacity>
            </>
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
  body: {
    padding: Spacing.four,
    gap: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  // Clears the floating tab pill on web, same inset the feed uses.
  bodyWeb: {
    paddingTop: Spacing.six,
  },
  heading: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  artistWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  artistChip: {
    paddingHorizontal: Spacing.three - 4,
    paddingVertical: Spacing.one + 1,
    borderRadius: 999,
    borderWidth: 1,
  },
  forYou: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  forYouText: {
    gap: Spacing.half,
  },
  section: {
    gap: Spacing.three,
  },
  hint: {
    lineHeight: 20,
  },
  loader: {
    marginVertical: Spacing.four,
  },
  button: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  signOut: {
    marginTop: Spacing.two,
  },
});
