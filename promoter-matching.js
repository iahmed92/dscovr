// Client-side entry point into the promoter matching pipeline. The actual
// rules (exact-match, normalized-match, never-guess) live in
// resolve_promoter_alias() (migration 0023) so they hold regardless of caller;
// this module's only job is turning "the raw strings a source gave one event"
// into the single promoter_id that event's row gets.

/**
 * Resolves the promoter for one event from its raw source strings.
 *
 * Every non-empty raw string is sent through resolve_promoter_alias — so a
 * secondary/co-promoter still gets tracked in promoter_aliases for future
 * curation — but only the FIRST one determines events.promoter_id. "First" is
 * whatever the caller considers primary: Ticketmaster's own `promoter` field
 * ahead of `promoters[]`, RA's array order (their own primary-first
 * convention), or the sole entry for a constant-entity source.
 *
 * Returns null if there are no raw strings, or none resolved to a promoter —
 * both are valid, common outcomes, never an error.
 */
export async function resolvePrimaryPromoter(supabase, rawStrings, sourceType) {
  const cleaned = [...new Set((rawStrings ?? []).map((s) => s?.trim()).filter(Boolean))];
  if (cleaned.length === 0) return null;

  let primaryId = null;
  for (let i = 0; i < cleaned.length; i++) {
    const { data, error } = await supabase.rpc('resolve_promoter_alias', {
      p_raw_string: cleaned[i],
      p_source_type: sourceType,
    });
    if (error) {
      console.warn(`[promoter] resolve failed for "${cleaned[i]}" (${sourceType}): ${error.message}`);
      continue;
    }
    if (i === 0) primaryId = data;
  }
  return primaryId;
}
