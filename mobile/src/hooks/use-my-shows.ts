import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';
import { todayLocalDateString } from '@/lib/format-date';

// One saved show, flattened from the event_attendance -> events -> venues embed.
export type MyShow = {
  attendanceStatus: string;
  id: number;
  title: string;
  event_date: string;
  doors_time: string | null;
  flyer_url: string | null;
  venue_name: string | null;
  venue_city: string | null;
};

type AttendanceRow = {
  status: string;
  events: {
    id: number;
    title: string;
    event_date: string;
    doors_time: string | null;
    flyer_url: string | null;
    venues: { name: string; city: string | null } | null;
  } | null;
};

// The rave resume: every event the user has saved, split into what's still
// ahead and what's already happened. Bucketed by event_date, not the stored
// status — nothing transitions 'going' to 'attended' yet, so a show marked
// going that has since passed still lands in the past section on its own.
export function useMyShows() {
  const { userId } = useAuth();
  const [upcoming, setUpcoming] = useState<MyShow[]>([]);
  const [past, setPast] = useState<MyShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the newest load may write state — a slow response for a previous user
  // (e.g. after a fast sign-out/sign-in) is discarded rather than clobbering.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestId.current;

    if (userId === null) {
      setUpcoming([]);
      setPast([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    // RLS scopes event_attendance to this user; events/venues are public read.
    // !inner drops any attendance row whose event was deleted out from under it.
    const { data, error: fetchError } = await supabase
      .from('event_attendance')
      .select(
        `status,
         events!inner ( id, title, event_date, doors_time, flyer_url,
           venues ( name, city ) )`
      )
      .eq('user_id', userId);

    if (request !== requestId.current) return;

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const today = todayLocalDateString();
    const rows = ((data ?? []) as unknown as AttendanceRow[])
      .filter(
        (row): row is AttendanceRow & { events: NonNullable<AttendanceRow['events']> } =>
          row.events !== null
      )
      .map((row) => ({
        attendanceStatus: row.status,
        id: row.events.id,
        title: row.events.title,
        event_date: row.events.event_date,
        doors_time: row.events.doors_time,
        flyer_url: row.events.flyer_url,
        venue_name: row.events.venues?.name ?? null,
        venue_city: row.events.venues?.city ?? null,
      }));

    // Upcoming ascending (next show first); past descending (most recent first).
    setUpcoming(
      rows.filter((r) => r.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date))
    );
    setPast(
      rows.filter((r) => r.event_date < today).sort((a, b) => b.event_date.localeCompare(a.event_date))
    );
    setError(null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  return { upcoming, past, loading, error, reload: load };
}
