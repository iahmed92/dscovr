import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Why ua_class classification (migration 0024) matters as much as it does:
// iMessage/WhatsApp/Slack/etc. fetch a shared link server-side, without
// executing JS, to build a preview card. That is the SAME fact that makes a
// real per-URL HTTP 404 unreachable in this app's current rendering mode
// (see the long comment in promoters/[slug].tsx) — here it means those
// fetches show up as phantom views on the day a link is sent; there it means
// the preview itself renders a generic shell, not the promoter's actual name
// or events. One non-JS-fetcher fact, two symptoms.
const VISITOR_HASH_KEY = 'dscovr.visitor_hash';

// A coarse, self-issued visitor identifier — explicitly NOT derived from IP or
// any device fingerprint, just a random token this app mints once and reuses.
// Persisted the same way the Supabase client persists its own session
// (AsyncStorage, backed by localStorage on web), and the same SSR-safety
// applies: Expo Router's web export renders on Node first, where `window`
// doesn't exist yet, so this is guarded exactly like supabase.ts's storage
// wrapper — no-op during SSR, real storage once the app hydrates.
async function getOrCreateVisitorHash(): Promise<string | null> {
  if (typeof window === 'undefined' && Platform.OS === 'web') return null;

  try {
    const existing = await AsyncStorage.getItem(VISITOR_HASH_KEY);
    if (existing) return existing;

    const fresh =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem(VISITOR_HASH_KEY, fresh);
    return fresh;
  } catch {
    // Storage can fail (private browsing, quota, native permission quirks) —
    // a view still gets recorded, just without a repeat-visit signal.
    return null;
  }
}

// user_agent and referrer are real browser globals that only exist on web —
// there's no client-side equivalent to fake on native, so they're simply
// absent there. ip_hash is never set from the client at all: a static SPA
// calling PostgREST directly has no reliable access to its own public IP
// without a third-party lookup, which isn't worth adding just to fill one
// nullable analytics column — see migration 0024's note on this.
function webOnlyContext(): { userAgent: string | null; referrer: string | null } {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') {
    return { userAgent: null, referrer: null };
  }
  return {
    userAgent: navigator.userAgent ?? null,
    referrer: typeof document !== 'undefined' ? document.referrer || null : null,
  };
}

/**
 * Records exactly one view of a published/claimed promoter's public profile.
 * Fire-and-forget, matching this app's other analytics writes (logTicketClick):
 * a failed insert is a lost data point, never a reason to block the page.
 *
 * ua_class is intentionally NOT sent — the client can't be trusted to
 * self-classify its own request, and the column isn't even in the anon INSERT
 * grant (migration 0024). The server-side trigger derives it from user_agent.
 */
export async function recordPromoterView(promoterId: number, outreachToken: string | null) {
  const [visitorHash, { userAgent, referrer }] = await Promise.all([
    getOrCreateVisitorHash(),
    Promise.resolve(webOnlyContext()),
  ]);

  supabase
    .from('promoter_profile_views')
    .insert({
      promoter_id: promoterId,
      outreach_token: outreachToken,
      visitor_hash: visitorHash,
      user_agent: userAgent,
      referrer,
    })
    .then(
      ({ error }) => {
        if (error && __DEV__) {
          // eslint-disable-next-line no-console
          console.warn('[promoter-tracking] view not recorded:', error.message);
        }
      },
      () => {
        // Offline or transport failure. Intentionally ignored.
      }
    );
}
