import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

// One scored suggestion from get_personalized_recommendations. matched_artists
// / matched_genres are the "why" — the favorites that earned the pick.
export type Recommendation = {
  event_id: number;
  title: string;
  event_date: string;
  doors_time: string | null;
  flyer_url: string | null;
  ticket_url: string | null;
  venue_name: string | null;
  venue_city: string | null;
  match_score: number;
  matched_artists: string[];
  matched_genres: string[];
};

export function useRecommendations(marketId: number | null) {
  const { userId } = useAuth();
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const request = ++requestId.current;

    // The RPC is SECURITY INVOKER over RLS-protected favorites, so a signed-out
    // call just returns nothing — but skip it rather than round-trip for empty.
    if (userId === null || marketId === null) {
      setRecs([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    supabase
      .rpc('get_personalized_recommendations', {
        target_user_id: userId,
        target_market_id: marketId,
      })
      .then(({ data, error: rpcError }) => {
        if (request !== requestId.current) return;
        if (rpcError) setError(rpcError.message);
        else {
          setRecs((data ?? []) as Recommendation[]);
          setError(null);
        }
        setLoading(false);
      });
  }, [userId, marketId]);

  return { recs, loading, error };
}
