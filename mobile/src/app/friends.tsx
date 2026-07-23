import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FindByPhone } from '@/components/find-by-phone';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { SendResult, useFriends } from '@/hooks/use-friends';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#FF3B7F';

const SEND_MESSAGE: Record<SendResult, string> = {
  sent: 'Request sent.',
  accepted: 'You’re now friends!',
  already_friends: 'You’re already friends.',
  already_pending: 'Request already pending.',
  self: 'That’s you.',
  not_found: 'No one with that username.',
};

export default function FriendsScreen() {
  const theme = useTheme();
  const { friends, requests, loading, sendRequest, respond, removeFriend } = useFriends();

  const [username, setUsername] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSend() {
    if (!username.trim()) return;
    setSending(true);
    setMessage(null);
    const { result, error } = await sendRequest(username);
    setSending(false);
    if (error) setMessage(error);
    else if (result) {
      setMessage(SEND_MESSAGE[result]);
      if (result === 'sent' || result === 'accepted') setUsername('');
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Add by username */}
          <View style={styles.addRow}>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder="Add by username"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={onSend}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <TouchableOpacity
              onPress={onSend}
              disabled={sending || !username.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send friend request"
              style={[styles.addButton, { backgroundColor: theme.text, opacity: sending || !username.trim() ? 0.5 : 1 }]}>
              {sending ? (
                <ActivityIndicator color={theme.background} size="small" />
              ) : (
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  Add
                </ThemedText>
              )}
            </TouchableOpacity>
          </View>
          {message && (
            <ThemedText type="small" themeColor="textSecondary">
              {message}
            </ThemedText>
          )}

          <FindByPhone sendRequest={sendRequest} />

          {loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : (
            <>
              {requests.length > 0 && (
                <View style={styles.section}>
                  <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                    REQUESTS
                  </ThemedText>
                  {requests.map((req) => (
                    <View key={req.request_id} style={styles.personRow}>
                      <PersonAvatar label={req.username} theme={theme} />
                      <ThemedText type="default" style={styles.personName} numberOfLines={1}>
                        {req.username ?? '—'}
                      </ThemedText>
                      <TouchableOpacity
                        onPress={() => respond(req.request_id, true)}
                        accessibilityLabel={`Accept ${req.username}`}
                        style={[styles.pill, { backgroundColor: ACCENT }]}>
                        <ThemedText type="small" style={{ color: '#fff' }}>
                          Accept
                        </ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => respond(req.request_id, false)}
                        accessibilityLabel={`Decline ${req.username}`}
                        style={[styles.pill, { borderColor: theme.backgroundSelected, borderWidth: 1 }]}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Decline
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.section}>
                <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
                  FRIENDS
                </ThemedText>
                {friends.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No friends yet. Add someone by their username above.
                  </ThemedText>
                ) : (
                  friends.map((friend) => (
                    <View key={friend.id} style={styles.personRow}>
                      <PersonAvatar label={friend.username} theme={theme} />
                      <ThemedText type="default" style={styles.personName} numberOfLines={1}>
                        {friend.username ?? '—'}
                      </ThemedText>
                      <TouchableOpacity
                        onPress={() => removeFriend(friend.id)}
                        accessibilityLabel={`Remove ${friend.username}`}
                        style={[styles.pill, { borderColor: theme.backgroundSelected, borderWidth: 1 }]}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Remove
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function PersonAvatar({ label, theme }: { label: string | null; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {(label ?? '?').charAt(0).toUpperCase()}
      </ThemedText>
    </View>
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
    padding: Spacing.three,
    gap: Spacing.three,
  },
  addRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  addButton: {
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  section: {
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personName: {
    flex: 1,
  },
  pill: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  loader: {
    marginVertical: Spacing.four,
  },
});
