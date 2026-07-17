import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

export type FriendGoing = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  status: string;
};

// Friends attending a given event, via friends_going (0010). The function is
// SECURITY DEFINER and friendship-gated, so signed out or with no friends it
// simply returns nothing — safe to call unconditionally.
export function useFriendsGoing(eventId: number | null) {
  const { userId } = useAuth();
  const [friends, setFriends] = useState<FriendGoing[]>([]);

  useEffect(() => {
    if (eventId === null || userId === null) {
      setFriends([]);
      return;
    }

    let cancelled = false;
    supabase
      .rpc('friends_going', { target_event_id: eventId })
      .then(({ data }) => {
        if (!cancelled) setFriends((data ?? []) as FriendGoing[]);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, userId]);

  return friends;
}
