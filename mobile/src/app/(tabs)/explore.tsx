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
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">
                  Signed in as
                </ThemedText>
                <ThemedText type="default">{profile?.username ?? '—'}</ThemedText>
              </ThemedView>

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
    gap: Spacing.half,
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
