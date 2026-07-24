// Shared between the promoter profile page's two reads, so they can't drift.
// Deliberately lean, not EVENT_SELECT (which pulls lineups/artists) — this
// page renders facts only: title, date, venue, ticket link. No promoter
// display columns are read here beyond what anon is actually granted
// (slug, ingested_name, status — see migration 0024).
export const PROMOTER_SELECT = 'id, slug, ingested_name, status';

export const PROMOTER_EVENTS_SELECT =
  'id, title, event_date, doors_time, ticket_url, venues ( name, city, market_id )';
