import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

// A VIP / table-service lead for one event (vip_inquiries, migration 0018).
//
// The inquiry carries a phone, so the table is locked down like the profile
// phone: a user may insert their own and read their own back, nothing else.
// `submitted` reflects whether this user already asked about THIS event, so the
// button can show "requested" instead of inviting a duplicate.
export function useVipInquiry(eventId: number) {
  const { userId } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [checking, setChecking] = useState(true);

  const reload = useCallback(async () => {
    if (userId === null) {
      setSubmitted(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    const { data } = await supabase
      .from('vip_inquiries')
      .select('id')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .limit(1);
    setSubmitted((data ?? []).length > 0);
    setChecking(false);
  }, [userId, eventId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Returns an error string, or null on success.
  const submit = useCallback(
    async ({ groupSize, phone }: { groupSize: number; phone: string }): Promise<string | null> => {
      if (userId === null) return 'Sign in first.';
      // The DB CHECK is 1..100; guard here too so the error is friendly.
      if (!Number.isInteger(groupSize) || groupSize < 1 || groupSize > 100) {
        return 'Enter a group size between 1 and 100.';
      }
      const { error } = await supabase.from('vip_inquiries').insert({
        event_id: eventId,
        user_id: userId,
        group_size: groupSize,
        phone: phone.trim() || null,
      });
      if (error) return error.message;
      setSubmitted(true);
      return null;
    },
    [userId, eventId]
  );

  return { submitted, checking, submit, signedIn: userId !== null };
}
