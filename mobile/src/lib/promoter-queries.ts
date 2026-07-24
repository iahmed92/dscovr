// Shared between the promoter profile page's two reads, so they can't drift.
// Deliberately lean, not EVENT_SELECT (which pulls lineups/artists) — this
// page renders facts only: title, date, venue, ticket link.
//
// Reads promoters_public (migration 0025), not the raw promoters table:
// display_name/bio/website/contact/socials are already resolved server-side
// (override where present, ingested as fallback), so the client never touches
// raw override columns or re-implements the NULL-vs-'' resolution itself. See
// use-promoter.ts for why that specific distinction has to stay explicit even
// after the SQL side already resolved it correctly.
export const PROMOTER_SELECT =
  'id, slug, ingested_name, status, display_name, bio, website, contact, socials';

export const PROMOTER_EVENTS_SELECT =
  'id, title, event_date, doors_time, ticket_url, venues ( name, city, market_id )';
