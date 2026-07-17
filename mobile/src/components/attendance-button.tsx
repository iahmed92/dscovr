import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAttendance } from '@/hooks/use-attendance';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#FF3B7F';

export function AttendanceButton({ eventId }: { eventId: number }) {
  const theme = useTheme();
  const router = useRouter();
  const { userId, initializing } = useAuth();
  const { isGoing, loading, saving, toggleGoing } = useAttendance(eventId);

  // Don't flash a stale signed-out state on cold start while the persisted
  // session is still loading.
  if (initializing) return null;

  async function onPress() {
    if (userId === null) {
      router.push('/sign-in');
      return;
    }
    await toggleGoing();
  }

  const busy = loading || saving;
  const label =
    userId === null ? 'Sign in to save this show' : isGoing ? 'Going — tap to remove' : 'Mark as going';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected: isGoing, busy }}
      accessibilityLabel={label}
      style={[
        styles.button,
        isGoing
          ? { backgroundColor: ACCENT }
          : { backgroundColor: 'transparent', borderColor: theme.backgroundSelected, borderWidth: 1 },
      ]}>
      {busy ? (
        <ActivityIndicator color={isGoing ? '#fff' : theme.text} />
      ) : (
        <ThemedText type="smallBold" style={{ color: isGoing ? '#fff' : theme.text }}>
          {userId === null ? 'Sign in to save' : isGoing ? '★ Going' : '☆ Going'}
        </ThemedText>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
});
