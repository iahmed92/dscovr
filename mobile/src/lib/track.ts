import { supabase } from '@/lib/supabase';

// Records that we sent someone to a ticket page. This is the number any
// promoter conversation starts from — we can't see inside their checkout, so
// demonstrable referred clicks are the honest metric until one shares
// conversion data.
//
// Goes through an RPC rather than a direct insert: the function stamps the user
// from auth.uid() server-side and collapses repeats, so a client can neither
// forge attribution nor inflate the count by looping. Direct writes to
// ticket_clicks are revoked (migration 0017).
//
// Fire-and-forget on purpose — opening the ticket page must never wait on, or be
// blocked by, analytics. A failed log is a lost data point, not a lost sale, so
// the rejection is swallowed explicitly rather than escaping as an unhandled
// promise rejection when the device is offline.
export function logTicketClick(eventId: number) {
  // Two-argument then, not .catch(): the builder is a PromiseLike, so it has no
  // .catch to chain — and without a rejection handler an offline tap escapes as
  // an unhandled rejection.
  supabase.rpc('log_ticket_click', { target_event_id: eventId }).then(
    ({ error }) => {
      if (error && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[track] ticket click not logged:', error.message);
      }
    },
    () => {
      // Offline or transport failure. Intentionally ignored.
    }
  );
}
