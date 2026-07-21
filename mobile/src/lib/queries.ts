// Shared between the feed and detail screens so the two queries can never
// drift out of sync with each other or with EventWithDetails.
export const EVENT_SELECT = `id, title, event_date, doors_time, ticket_url, flyer_url, source_type, is_festival,
  venues!inner ( name, address, city, latitude, longitude, website, market_id ),
  lineups ( performance_order, artists ( id, name, spotify_url, soundcloud_url, mixcloud_url ) )`;
