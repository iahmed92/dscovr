import { useEffect, useState } from 'react';

import { EVENT_SELECT } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { EventWithDetails } from '@/lib/types';

export function useEvent(eventId: number | null) {
  const [event, setEvent] = useState<EventWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eventId === null) {
      // Clear the previous event too — otherwise a stale one keeps rendering
      // while the hook reports nothing is selected.
      setEvent(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data, error: fetchError } = await supabase
        .from('events')
        .select(EVENT_SELECT)
        .eq('id', eventId)
        .order('performance_order', { referencedTable: 'lineups', ascending: true })
        // maybeSingle, not single: single() treats "no rows" as an error, so a
        // link to a deleted or mistyped event surfaced the raw Postgres text
        // ("Cannot coerce the result to a single JSON object") instead of the
        // screen's own not-found copy. Missing is a normal outcome here.
        .maybeSingle();

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setEvent((data as unknown as EventWithDetails) ?? null);
        setError(null);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return { event, loading, error };
}
