import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

export type Friend = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  friends_since: string;
};

export type FriendRequest = {
  request_id: number;
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  requested_at: string;
};

// Result strings mirror send_friend_request in migration 0010.
export type SendResult = 'sent' | 'accepted' | 'already_friends' | 'already_pending' | 'self' | 'not_found';

// The friend graph, over the RPCs. Mutations return so the caller can surface a
// message and then reload — the lists are cheap and always re-read from source
// rather than being patched locally, so the two can't drift.
export function useFriends() {
  const { userId } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (userId === null) {
      setFriends([]);
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [f, r] = await Promise.all([
      supabase.rpc('list_friends'),
      supabase.rpc('list_incoming_requests'),
    ]);
    setFriends((f.data ?? []) as Friend[]);
    setRequests((r.data ?? []) as FriendRequest[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const sendRequest = useCallback(
    async (username: string): Promise<{ result: SendResult | null; error: string | null }> => {
      const { data, error } = await supabase.rpc('send_friend_request', {
        target_username: username.trim(),
      });
      if (error) return { result: null, error: error.message };
      // A 'sent'/'accepted' changes the lists (accepted adds a friend); reload.
      if (data === 'sent' || data === 'accepted') await reload();
      return { result: data as SendResult, error: null };
    },
    [reload]
  );

  const respond = useCallback(
    async (requestId: number, accept: boolean): Promise<string | null> => {
      const { error } = await supabase.rpc('respond_to_friend_request', {
        request_id: requestId,
        accept,
      });
      await reload();
      return error?.message ?? null;
    },
    [reload]
  );

  const removeFriend = useCallback(
    async (otherUserId: string): Promise<string | null> => {
      const { error } = await supabase.rpc('remove_friend', { other_user_id: otherUserId });
      await reload();
      return error?.message ?? null;
    },
    [reload]
  );

  return { friends, requests, loading, reload, sendRequest, respond, removeFriend };
}
