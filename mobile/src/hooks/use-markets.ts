import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { Market } from '@/lib/types';

export function useMarkets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('markets')
        .select('id, slug, name, state')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (cancelled) return;

      if (fetchError) {
        setError(fetchError.message);
      } else {
        setMarkets(data ?? []);
        setError(null);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { markets, loading, error };
}
