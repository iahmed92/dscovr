export type Market = {
  id: number;
  slug: string;
  name: string;
  state: string;
};

export type Artist = {
  id: number;
  name: string;
  spotify_url: string | null;
  soundcloud_url: string | null;
};

export type LineupSlot = {
  performance_order: number | null;
  artists: Artist | null;
};

export type Venue = {
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
};

export type EventWithDetails = {
  id: number;
  title: string;
  event_date: string;
  doors_time: string | null;
  ticket_url: string | null;
  flyer_url: string | null;
  source_type: string;
  venues: Venue | null;
  lineups: LineupSlot[];
  // Only the feed carries these — they come from get_filtered_events, not from
  // the plain event select the detail screen uses.
  vibes?: Vibe[];
};

// Mirrors timeframe_window() in supabase/migrations/0008. The database raises
// on an unknown timeframe, so these must stay in step with it.
export const TIMEFRAMES = ['all', 'today', 'this_weekend', 'this_week', 'next_month'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  all: 'Anytime',
  today: 'Tonight',
  this_weekend: 'This weekend',
  this_week: 'This week',
  next_month: 'Next month',
};

// Mirrors the vibe column of vibe_taxonomy.
export const VIBES = [
  'house_techno',
  'bass_dubstep',
  'trance_progressive',
  'mainstage_edm',
  'underground_experimental',
] as const;
export type Vibe = (typeof VIBES)[number];

export const VIBE_LABELS: Record<Vibe, string> = {
  house_techno: 'House / Techno',
  bass_dubstep: 'Bass / Dubstep',
  trance_progressive: 'Trance / Prog',
  mainstage_edm: 'Mainstage',
  underground_experimental: 'Underground',
};

// One row of get_filtered_events. Flat, and the lineup arrives as JSON rather
// than a PostgREST embed, so use-events reshapes it into EventWithDetails.
export type FilteredEventRow = {
  event_id: number;
  title: string;
  event_date: string;
  doors_time: string | null;
  flyer_url: string | null;
  ticket_url: string | null;
  source_type: string;
  venue_name: string | null;
  venue_city: string | null;
  vibes: Vibe[] | null;
  artists: (Artist & { performance_order: number | null })[] | null;
};
