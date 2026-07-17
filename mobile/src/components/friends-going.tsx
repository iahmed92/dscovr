import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useFriendsGoing } from '@/hooks/use-friends-going';
import { useTheme } from '@/hooks/use-theme';

// "N friends going", with initial avatars. Renders nothing when no friends are
// attending (or signed out) — friends_going returns an empty set, so the strip
// just disappears rather than showing a zero state.
export function FriendsGoing({ eventId }: { eventId: number }) {
  const theme = useTheme();
  const friends = useFriendsGoing(eventId);

  if (friends.length === 0) return null;

  const names = friends.map((f) => f.username ?? 'a friend');
  const summary =
    names.length === 1
      ? `${names[0]} is going`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are going`
        : `${names[0]}, ${names[1]} and ${names.length - 2} more are going`;

  return (
    <View style={styles.row}>
      <View style={styles.avatars}>
        {friends.slice(0, 3).map((friend, i) => (
          <View
            key={friend.id}
            style={[
              styles.avatar,
              { backgroundColor: theme.backgroundSelected, borderColor: theme.background, marginLeft: i === 0 ? 0 : -10 },
            ]}>
            <ThemedText type="small" themeColor="textSecondary">
              {(friend.username ?? '?').charAt(0).toUpperCase()}
            </ThemedText>
          </View>
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text} numberOfLines={1}>
        {summary}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatars: {
    flexDirection: 'row',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
});
