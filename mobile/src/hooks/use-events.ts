import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { EventWithDetails } from '@/lib/types';

// Local calendar date, not UTC — event_date is stored as the show's local
// calendar date, so a UTC-based "today" (toISOString) can be off by a day
// near midnight, same pitfall the ingestion scripts already guard against.
function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useEvents(marketId: number | null) {
  const [events, setEvents] = useState<EventWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (marketId === null) {
      setEvents([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data, error: fetchError } = await supabase
        .from('events')
        .select(
          `id, title, event_date, doors_time, ticket_url, flyer_url, source_type,
           venues!inner ( name, city, market_id ),
           lineups ( performance_order, artists ( id, name, spotify_url, soundcloud_url ) )`
        )
        .eq('venues.market_id', marketId)
        .gte('event_date', todayDateString())
        .order('event_date', { ascending: true })
        .order('performance_order', { referencedTable: 'lineups', ascending: true })
        .limit(100);

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setEvents((data as unknown as EventWithDetails[]) ?? []);
        setError(null);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  return { events, loading, error };
}
