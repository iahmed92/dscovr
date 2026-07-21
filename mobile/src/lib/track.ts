import { supabase } from '@/lib/supabase';

// Records that we sent someone to a ticket page. This is the number any
// promoter conversation starts from — we can't see inside their checkout, so
// demonstrable referred clicks are the honest metric until one shares
// conversion data.
//
// Fire-and-forget on purpose: opening the ticket page must never wait on, or be
// blocked by, analytics. A failed insert is a lost data point, not a lost sale.
export function logTicketClick(eventId: number, userId: string | null) {
  void supabase
    .from('ticket_clicks')
    .insert({ event_id: eventId, user_id: userId })
    .then(({ error }) => {
      if (error && __DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[track] ticket click not logged:', error.message);
      }
    });
}
