import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

// 'going' is the only status the button sets; 'attended' is applied later
// (a show whose date has passed) and 'interested' is reserved. null means the
// signed-in user has no row for this event.
export type AttendanceStatus = 'going' | 'attended' | 'interested';

export function useAttendance(eventId: number | null) {
  const { userId } = useAuth();
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  // Separate from `loading`: the initial read vs. an in-flight toggle. The
  // button stays interactive during the read but shows a spinner mid-write.
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Signed out, or no event yet: nothing to read, and RLS would return
    // empty anyway.
    if (userId === null || eventId === null) {
      setStatus(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    supabase
      .from('event_attendance')
      .select('status')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: readError }) => {
        if (cancelled) return;
        if (readError) setError(readError.message);
        else setStatus((data?.status as AttendanceStatus | undefined) ?? null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, eventId]);

  // Toggle the 'going' state. Returns false when the user isn't signed in so
  // the caller can route them to sign-in instead.
  async function toggleGoing(): Promise<boolean> {
    if (userId === null || eventId === null) return false;

    setSaving(true);
    setError(null);
    const previous = status;

    if (status === null) {
      // Insert with an explicit user_id so it satisfies the RLS WITH CHECK
      // (auth.uid() = user_id) — the column has no default.
      setStatus('going');
      const { error: writeError } = await supabase
        .from('event_attendance')
        .insert({ event_id: eventId, user_id: userId, status: 'going' });
      if (writeError) {
        setStatus(previous);
        setError(writeError.message);
      }
    } else {
      // Any existing status toggles off — un-RSVPing a going/interested show.
      setStatus(null);
      const { error: deleteError } = await supabase
        .from('event_attendance')
        .delete()
        .eq('event_id', eventId)
        .eq('user_id', userId);
      if (deleteError) {
        setStatus(previous);
        setError(deleteError.message);
      }
    }

    setSaving(false);
    return true;
  }

  return { status, isGoing: status !== null, loading, saving, error, toggleGoing };
}
