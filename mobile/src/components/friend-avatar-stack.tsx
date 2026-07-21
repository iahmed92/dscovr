import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { FriendGoingBrief } from '@/hooks/use-friends-going-batch';
import { useTheme } from '@/hooks/use-theme';

const MAX_SHOWN = 3;

function initial(friend: FriendGoingBrief) {
  return (friend.username ?? '?').charAt(0).toUpperCase();
}

// Overlapping avatars plus "N friends going" — the social proof that makes a
// card worth tapping. Renders nothing when no friends are going, so a card for
// a signed-out user or an event nobody's friends care about stays clean.
export function FriendAvatarStack({ friends }: { friends: FriendGoingBrief[] }) {
  const theme = useTheme();
  if (friends.length === 0) return null;

  const shown = friends.slice(0, MAX_SHOWN);
  const overflow = friends.length - shown.length;
  const names =
    friends.length === 1
      ? `${friends[0].username ?? 'A friend'} is going`
      : `${friends.length} friends going`;

  return (
    <View style={styles.container}>
      <View style={styles.stack}>
        {shown.map((friend, index) => (
          <View
            key={friend.id}
            style={[
              styles.avatar,
              {
                backgroundColor: theme.backgroundSelected,
                borderColor: theme.background,
              },
              index > 0 && styles.overlap,
            ]}>
            {friend.avatar_url ? (
              <Image source={{ uri: friend.avatar_url }} style={styles.image} contentFit="cover" />
            ) : (
              <ThemedText style={styles.initial} themeColor="textSecondary">
                {initial(friend)}
              </ThemedText>
            )}
          </View>
        ))}
        {overflow > 0 && (
          <View
            style={[
              styles.avatar,
              styles.overlap,
              { backgroundColor: theme.backgroundSelected, borderColor: theme.background },
            ]}>
            <ThemedText style={styles.initial} themeColor="textSecondary">
              +{overflow}
            </ThemedText>
          </View>
        )}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {names}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  stack: {
    flexDirection: 'row',
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  overlap: {
    marginLeft: -8,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  initial: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '600',
  },
});
