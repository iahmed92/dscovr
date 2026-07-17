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
};
