import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { EventWithDetails, FilteredEventRow, Timeframe, Genre } from '@/lib/types';

// The feed reads through get_filtered_events rather than selecting events
// directly: timeframe and vibe filtering happen in Postgres, so a filter change
// costs one round trip instead of shipping every upcoming show to the client
// and narrowing it here. Ordering (event_date, doors_time, id) lives in the
// function too — same total order the old query needed to stop the list
// reshuffling under the user.
//
// The detail screen still uses a plain select (use-event.ts); it wants one
// event by id, which is not what this function is for.
function toEventWithDetails(row: FilteredEventRow): EventWithDetails {
  return {
    id: row.event_id,
    title: row.title,
    event_date: row.event_date,
    doors_time: row.doors_time,
    ticket_url: row.ticket_url,
    flyer_url: row.flyer_url,
    source_type: row.source_type,
    // The feed only ever renders name and city; the detail screen fetches the
    // address and coordinates it needs for the Maps link.
    venues: row.venue_name
      ? {
          name: row.venue_name,
          city: row.venue_city,
          address: null,
          latitude: null,
          longitude: null,
          website: null,
        }
      : null,
    // Already ordered by performance_order in SQL — kept in the LineupSlot
    // shape so EventCard and the detail screen consume the same thing.
    lineups: (row.artists ?? []).map((artist) => ({
      performance_order: artist.performance_order,
      artists: {
        id: artist.id,
        name: artist.name,
        spotify_url: artist.spotify_url,
        soundcloud_url: artist.soundcloud_url,
      },
    })),
    vibes: row.vibes ?? [],
  };
}

export function useEvents(
  marketSlug: string | null,
  timeframe: Timeframe,
  // 'other' is the ungenred catch-all handled by get_filtered_events (0011).
  vibe: Genre | 'other' | null
) {
  const [events, setEvents] = useState<EventWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (marketSlug === null) {
      setEvents([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data, error: fetchError } = await supabase.rpc('get_filtered_events', {
        market_slug: marketSlug,
        timeframe,
        vibe_filter: vibe,
      });

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setEvents(((data ?? []) as FilteredEventRow[]).map(toEventWithDetails));
        setError(null);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [marketSlug, timeframe, vibe]);

  return { events, loading, error };
}
