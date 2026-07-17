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
        .single();

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setEvent(data as unknown as EventWithDetails);
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
