import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, Share, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { eventShareUrl, inviteMessage, smsInviteUrl } from '@/lib/share-links';

// True on an iPhone/iPad, including iPad-pretending-to-be-a-Mac. Only used to
// pick the sms: separator, which iOS and Android spell differently.
function isIOSDevice() {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS !== 'web') return false;
  const nav = globalThis.navigator;
  if (!nav) return false;
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

// Whether an sms: link will go anywhere. Desktop browsers have no messaging
// app, so offering "Text friends" there would be a button that does nothing.
function canSendSMS() {
  if (Platform.OS !== 'web') return true;
  const nav = globalThis.navigator;
  return !!nav && /Android|iPad|iPhone|iPod/.test(nav.userAgent);
}

/**
 * "Invite crew" — the referral loop.
 *
 * Two buttons, because they do different jobs. Share opens the OS share sheet
 * (any app, or the clipboard on desktop). Text friends jumps straight into
 * Messages with the invite pre-typed and no recipient, so the user picks who
 * from their own contacts.
 *
 * Notably there is no SMS provider behind this and there doesn't need to be:
 * the message is sent by the user's own phone, from their own number. That
 * costs us nothing, can't be abused to pump traffic to premium-rate numbers,
 * and means we never store a contact list.
 *
 * Signed out it still shares, just without attribution — a share that works
 * beats a share withheld to capture a referrer.
 */
export function InviteCrewButton({ eventId, title }: { eventId: number; title: string }) {
  const theme = useTheme();
  const { userId } = useAuth();
  const [copied, setCopied] = useState(false);

  const url = eventShareUrl(eventId, userId);
  const message = inviteMessage(title, url);

  async function onShare() {
    // Web's share sheet is not universal (Safari and Chrome-on-desktop differ),
    // so fall back to the clipboard rather than failing silently.
    if (Platform.OS === 'web') {
      const nav = globalThis.navigator as Navigator & {
        share?: (data: { title: string; text: string; url: string }) => Promise<void>;
      };
      try {
        if (nav?.share) {
          await nav.share({ title, text: message, url });
          return;
        }
        await nav.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // User dismissed the sheet, or the clipboard was denied. Nothing to do.
      }
      return;
    }

    try {
      await Share.share({ message });
    } catch {
      // Dismissed.
    }
  }

  function onText() {
    // No await and no catch: on web this is a navigation the browser owns, and
    // a user with no SMS handler registered simply sees nothing happen.
    Linking.openURL(smsInviteUrl(message, isIOSDevice())).catch(() => {});
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel={`Share ${title}`}
        style={[styles.button, { borderColor: theme.border }]}>
        <ThemedText type="smallBold">{copied ? 'Link copied' : 'Invite crew'}</ThemedText>
      </TouchableOpacity>

      {canSendSMS() && (
        <TouchableOpacity
          onPress={onText}
          accessibilityRole="button"
          accessibilityLabel={`Text friends about ${title}`}
          style={[styles.button, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">Text friends</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
});
