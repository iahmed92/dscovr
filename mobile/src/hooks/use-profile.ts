import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

// The public-readable slice of a profile. The phone and Spotify token columns
// are revoked from clients at the column level (migration 0006), so selecting
// them here would 401 — only these are requested.
export type PublicProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
};

const PUBLIC_COLUMNS = 'id, username, full_name, avatar_url, role';

export function useProfile() {
  const { userId } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userId === null) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    supabase
      .from('profiles')
      .select(PUBLIC_COLUMNS)
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setProfile((data as PublicProfile | null) ?? null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { profile, loading };
}
