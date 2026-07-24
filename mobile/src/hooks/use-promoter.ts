import { useEffect, useState } from 'react';

import { PROMOTER_EVENTS_SELECT, PROMOTER_SELECT } from '@/lib/promoter-queries';
import { supabase } from '@/lib/supabase';

export type PublicPromoter = {
  id: number;
  slug: string;
  ingested_name: string;
  // Typed as the full enum, not narrowed to 'published' | 'claimed': RLS
  // (migration 0024) should make a 'draft' row unreachable here, but the type
  // stays honest about what COULD arrive rather than asserting a guarantee
  // this hook doesn't itself enforce. The route is what turns that guarantee
  // into a visible, defensive check — see [slug].tsx.
  status: 'draft' | 'published' | 'claimed';
  // Everything below comes pre-resolved from promoters_public (migration
  // 0025) — override where present, ingested as fallback, computed in SQL via
  // COALESCE. `string | null` on every one of these is deliberate and load-
  // bearing, NOT the same as "optional": null means no override was ever set
  // (falls through to the ingested value, or to nothing for fields with none),
  // '' means the promoter explicitly wants that field blank, and any other
  // string is their real value. THIS IS THE THREE-STATE TRAP THE BRIEF WARNS
  // ABOUT: `if (!promoter.bio)` or `promoter.bio || fallback` both treat ''
  // as falsy and silently collapse "deliberately blank" into "not set" or
  // "show the fallback" — exactly the bug the SQL COALESCE was written to
  // avoid, reintroduced one layer up if this gets read carelessly. Always
  // compare with `!== null && !== undefined`, never a truthiness check —
  // enforced at the one call site that reads these, in [slug].tsx.
  display_name: string;
  bio: string | null;
  website: string | null;
  contact: string | null;
  socials: Record<string, string> | null;
};

export type PromoterMarket = { name: string } | null;

export type PromoterEvent = {
  id: number;
  title: string;
  event_date: string;
  doors_time: string | null;
  ticket_url: string | null;
  venues: { name: string; city: string | null; market_id: number } | null;
};

// A draft promoter is invisible to anon by RLS (migration 0024's status-
// filtered policy) — the query for one returns no row, indistinguishable from
// a slug that never existed. That collapse is deliberate: "exists but
// unpublished" and "never existed" should read identically to a visitor, and
// the caller renders the same not-found state for both.
export function usePromoter(slug: string | null) {
  const [promoter, setPromoter] = useState<PublicPromoter | null>(null);
  const [events, setEvents] = useState<PromoterEvent[]>([]);
  const [market, setMarket] = useState<PromoterMarket>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setPromoter(null);
      setEvents([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data: promoterRow, error: promoterError } = await supabase
        .from('promoters_public')
        .select(PROMOTER_SELECT)
        .eq('slug', slug)
        // maybeSingle, not single: a missing/draft slug is a normal outcome
        // here, not an error state — same reasoning as useEvent.
        .maybeSingle();

      if (cancelled) return;

      if (promoterError) {
        setError(promoterError.message);
        setPromoter(null);
        setEvents([]);
        setLoading(false);
        return;
      }

      if (!promoterRow) {
        setPromoter(null);
        setEvents([]);
        setError(null);
        setLoading(false);
        return;
      }

      setPromoter(promoterRow as PublicPromoter);

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const { data: eventRows, error: eventsError } = await supabase
        .from('events')
        .select(PROMOTER_EVENTS_SELECT)
        .eq('promoter_id', promoterRow.id)
        .gte('event_date', todayStr)
        .order('event_date', { ascending: true })
        .order('doors_time', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });

      if (cancelled) return;

      if (eventsError) {
        setError(eventsError.message);
        setLoading(false);
        return;
      }

      const rows = (eventRows ?? []) as unknown as PromoterEvent[];
      setEvents(rows);
      setError(null);

      // "Market" is a single top-level fact tied to the promoter's near-term
      // calendar, not a stored column — derived from the earliest upcoming
      // event's market so it is read live and can never go stale the way a
      // separately-stored primary_market_id could. Events are already sorted
      // by date, so rows[0] is that earliest show.
      const marketId = rows[0]?.venues?.market_id ?? null;
      if (marketId) {
        const { data: marketRow } = await supabase
          .from('markets')
          .select('name')
          .eq('id', marketId)
          .maybeSingle();
        if (!cancelled) setMarket(marketRow ?? null);
      } else if (!cancelled) {
        setMarket(null);
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { promoter, events, market, loading, error };
}
