import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useFriends } from '@/hooks/use-friends';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type State = 'idle' | 'sending' | 'sent' | 'connected' | 'error';

/**
 * "Alex invited you" — what closes the referral loop.
 *
 * Without this the invite link is decorative: a friend taps it, lands on the
 * event, and nothing connects them. The whole point of carrying invited_by is
 * to turn one share into a friendship, which is what makes avatar stacks and
 * friends-going worth anything.
 *
 * It offers, it does not act. Landing on a link is not consent to be someone's
 * friend, and auto-accepting would also let anyone force themselves into your
 * graph just by getting you to open a URL. So this sends a normal friend
 * request that the other person still has to accept.
 *
 * Renders nothing when the id is bogus, is you, or you're already friends —
 * a share link that gets forwarded around shouldn't nag people.
 */
export function InviterBanner({ inviterId }: { inviterId: string }) {
  const theme = useTheme();
  const { userId } = useAuth();
  const { friends, sendRequest } = useFriends();
  const [username, setUsername] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Named columns, not select=*: profiles withholds phone and Spotify tokens
    // with column privileges, so a star select is refused outright.
    supabase
      .from('profiles')
      .select('username')
      .eq('id', inviterId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setUsername((data as { username: string | null } | null)?.username ?? null);
        setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [inviterId]);

  const alreadyFriends = friends.some((f) => f.id === inviterId);

  // Wait for the lookup before deciding — rendering "someone invited you" and
  // then yanking it once the name arrives is worse than a beat of nothing.
  if (!resolved || username === null) return null;
  if (userId === inviterId) return null;
  if (alreadyFriends && state !== 'sent') return null;

  async function onAdd() {
    if (username === null) return;
    setState('sending');
    const { result, error } = await sendRequest(username);

    if (error) {
      setState('error');
      setMessage(error);
      return;
    }
    if (result === 'accepted' || result === 'already_friends') {
      setState('connected');
      return;
    }
    if (result === 'sent' || result === 'already_pending') {
      setState('sent');
      return;
    }
    setState('error');
    setMessage("That account isn't available.");
  }

  return (
    <View style={[styles.banner, { borderColor: theme.border }]}>
      <View style={styles.text}>
        <ThemedText type="smallBold">{username} invited you</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {state === 'connected'
            ? "You're now friends"
            : state === 'sent'
              ? 'Friend request sent'
              : state === 'error'
                ? (message ?? 'Something went wrong')
                : 'Add them to see who else is going'}
        </ThemedText>
      </View>

      {state !== 'sent' && state !== 'connected' && (
        userId === null ? (
          <Link href="/sign-in" asChild>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Sign in to add ${username}`}
              style={StyleSheet.flatten([styles.button, { backgroundColor: theme.text }])}>
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                Sign in
              </ThemedText>
            </TouchableOpacity>
          </Link>
        ) : (
          <TouchableOpacity
            onPress={onAdd}
            disabled={state === 'sending'}
            accessibilityRole="button"
            accessibilityLabel={`Add ${username} as a friend`}
            style={[
              styles.button,
              { backgroundColor: theme.text, opacity: state === 'sending' ? 0.5 : 1 },
            ]}>
            {state === 'sending' ? (
              <ActivityIndicator size="small" color={theme.background} />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.background }}>
                Add friend
              </ThemedText>
            )}
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.three,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    minWidth: 92,
    alignItems: 'center',
  },
});
