import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useVipInquiry } from '@/hooks/use-vip-inquiry';

/**
 * "VIP & table service" — a paid-lead capture on the event page.
 *
 * This is the revenue surface: a warm inquiry (who, how big a group, how to
 * reach them) that sales works as the service role. Deliberately understated —
 * an outlined button below Get Tickets, not competing with the primary action —
 * because most people want a ticket, not a table, and a loud upsell on every
 * card would cheapen the feed.
 *
 * Signed out it points to sign-in rather than collecting a lead anonymously:
 * an inquiry with no account behind it can't be followed up or de-duplicated,
 * and vip_inquiries is gated on auth.uid() = user_id anyway.
 */
export function VipInquiryButton({ eventId }: { eventId: number }) {
  const theme = useTheme();
  const { submitted, checking, submit, signedIn } = useVipInquiry(eventId);

  const [open, setOpen] = useState(false);
  const [groupSize, setGroupSize] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to show until we know the state, so the button doesn't flip from
  // "request" to "requested" a beat after it renders.
  if (checking) return null;

  if (submitted) {
    return (
      <View style={[styles.done, { borderColor: theme.border }]}>
        <ThemedText type="small" themeColor="textSecondary">
          VIP request received — the team will reach out.
        </ThemedText>
      </View>
    );
  }

  if (!signedIn) {
    return (
      <Link href="/sign-in" asChild>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Sign in to request VIP or table service"
          style={StyleSheet.flatten([styles.trigger, { borderColor: theme.border }])}>
          <ThemedText type="smallBold">VIP & table service</ThemedText>
        </TouchableOpacity>
      </Link>
    );
  }

  if (!open) {
    return (
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Request VIP or table service"
        style={[styles.trigger, { borderColor: theme.border }]}>
        <ThemedText type="smallBold">VIP & table service</ThemedText>
      </TouchableOpacity>
    );
  }

  async function onSubmit() {
    const size = parseInt(groupSize, 10);
    setSending(true);
    setError(null);
    const err = await submit({ groupSize: size, phone });
    setSending(false);
    if (err) setError(err);
  }

  return (
    <View style={[styles.form, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">VIP & table service</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Tell us your group size and a number — the team handles the rest.
      </ThemedText>

      <TextInput
        value={groupSize}
        onChangeText={setGroupSize}
        placeholder="Group size"
        placeholderTextColor={theme.textSecondary}
        keyboardType="number-pad"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="Best number to reach you"
        placeholderTextColor={theme.textSecondary}
        keyboardType="phone-pad"
        autoComplete="tel"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />

      {error && (
        <ThemedText type="small" style={{ color: '#FF3B7F' }}>
          {error}
        </ThemedText>
      )}

      <View style={styles.row}>
        <TouchableOpacity
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Cancel VIP request"
          style={[styles.secondary, { borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Cancel
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSubmit}
          disabled={sending || !groupSize.trim()}
          accessibilityRole="button"
          accessibilityLabel="Send VIP request"
          style={[
            styles.primary,
            { backgroundColor: theme.text, opacity: sending || !groupSize.trim() ? 0.5 : 1 },
          ]}>
          {sending ? (
            <ActivityIndicator color={theme.background} size="small" />
          ) : (
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              Send request
            </ThemedText>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    paddingVertical: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  done: {
    padding: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  form: {
    padding: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    gap: Spacing.two,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  secondary: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  primary: {
    flex: 2,
    paddingVertical: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
  },
});
