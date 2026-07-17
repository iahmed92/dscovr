import { useRouter } from 'expo-router';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { useTheme } from '@/hooks/use-theme';

// The former Explore starter boilerplate is now the account surface — sign-in
// state, and the eventual home for the "rave resume" (attended history) and
// friends. Route file stays explore.tsx so the typed routes and native tab
// config don't churn; the tab is labelled Account.
export default function AccountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { userId, initializing, signOut } = useAuth();
  const { profile } = useProfile();

  const signedIn = userId !== null;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={[styles.body, Platform.OS === 'web' && styles.bodyWeb]}>
          <ThemedText type="subtitle" style={styles.heading}>
            Account
          </ThemedText>

          {initializing ? null : signedIn ? (
            <>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">
                  Signed in as
                </ThemedText>
                <ThemedText type="default">{profile?.username ?? '—'}</ThemedText>
              </ThemedView>

              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                Shows you mark as “Going” are saved to your account. Your rave resume and friends
                are coming next.
              </ThemedText>

              <TouchableOpacity
                onPress={signOut}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                style={[styles.button, { borderColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold">Sign out</ThemedText>
              </TouchableOpacity>
            </>
          ) : (
            <>
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
            </>
          )}
        </View>
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
    gap: Spacing.three,
  },
  // Clears the floating tab pill on web, same inset the feed uses.
  bodyWeb: {
    paddingTop: Spacing.six,
  },
  heading: {
    fontSize: 32,
    lineHeight: 40,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  hint: {
    lineHeight: 20,
  },
  button: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
