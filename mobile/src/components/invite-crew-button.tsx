import { useState } from 'react';
import { Platform, Share, StyleSheet, TouchableOpacity } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

// Public origin for share links. Native has no window.location, and a link
// built from localhost is useless in a text message, so the production host is
// the fallback rather than whatever the app happens to be served from.
const SHARE_ORIGIN = 'https://www.dscovr.live';

function shareUrl(eventId: number, userId: string | null) {
  const base = `${SHARE_ORIGIN}/e/${eventId}`;
  return userId ? `${base}?invited_by=${encodeURIComponent(userId)}` : base;
}

// "Invite Crew" — produces the short referral link for an event.
//
// Signed out it still shares, just without attribution: a share that works is
// worth more than a share withheld to capture a referrer.
export function InviteCrewButton({ eventId, title }: { eventId: number; title: string }) {
  const theme = useTheme();
  const { userId } = useAuth();
  const [copied, setCopied] = useState(false);

  async function onPress() {
    const url = shareUrl(eventId, userId);
    const message = `${title} — who's coming?`;

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
      await Share.share({ message: `${message} ${url}` });
    } catch {
      // Dismissed.
    }
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Invite your crew to ${title}`}
      style={[styles.button, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{copied ? 'Link copied' : 'Invite crew'}</ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
});
