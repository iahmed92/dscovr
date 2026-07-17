import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Landing route for the Spotify OAuth redirect on web. Its only job is to exist
// so <origin>/spotify-callback serves the app bundle (a 404 here can't run the
// code that finishes the flow). WebBrowser.maybeCompleteAuthSession() — called
// at module load in use-spotify-connect — detects the ?code= on this page and
// hands it back to the waiting request in the opener, which then closes this.
// Native never routes here; it round-trips through the dscovr:// scheme.
export default function SpotifyCallbackScreen() {
  return (
    <ThemedView style={styles.screen}>
      <ActivityIndicator />
      <ThemedText type="small" themeColor="textSecondary">
        Finishing Spotify sign-in…
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
});
