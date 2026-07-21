import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

export type FriendGoingBrief = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  status: string;
};

// Friends attending, for a whole page of events in one call (friends_going_batch,
// 0018). The per-event friends_going would be an N+1 round trip per scroll.
//
// Returns a Map keyed by event id; an event with no friends is simply absent.
// Like friends_going the function is friendship-gated, so signed out this
// resolves to an empty map without a request.
export function useFriendsGoingBatch(eventIds: number[]) {
  const { userId } = useAuth();
  const [byEvent, setByEvent] = useState<Map<number, FriendGoingBrief[]>>(new Map());

  // The dependency is the joined id list, not the array: `events` is a fresh
  // array on every render, so depending on it re-fetches forever.
  const key = eventIds.join(',');

  useEffect(() => {
    if (userId === null || eventIds.length === 0) {
      setByEvent(new Map());
      return;
    }

    let cancelled = false;
    supabase
      .rpc('friends_going_batch', { target_event_ids: eventIds })
      .then(({ data }) => {
        if (cancelled) return;
        const grouped = new Map<number, FriendGoingBrief[]>();
        for (const row of (data ?? []) as (FriendGoingBrief & { event_id: number })[]) {
          const list = grouped.get(row.event_id);
          const brief = {
            id: row.id,
            username: row.username,
            avatar_url: row.avatar_url,
            status: row.status,
          };
          if (list) list.push(brief);
          else grouped.set(row.event_id, [brief]);
        }
        setByEvent(grouped);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId]);

  return byEvent;
}
