-- Live-set links and festival classification.
--
-- Two additions driven by what the data actually supports:
--
-- artists.mixcloud_url — a link to the artist's most recent set. SoundCloud
-- can't back this: its API has been closed to new registrations for years, so
-- soundcloud_url was only ever a search link pretending to be a profile.
-- Mixcloud's API is open, and matching the artist's own account (not a title
-- search) yields a real set — but only for ~29% of our roster, so the client
-- falls back to a labelled YouTube search rather than showing nothing.
--
-- events.is_festival — curated, not computed. No rule survives the data:
-- title keywords catch 6 of 518 and miss Decadence, Obsidian and Goldrush;
-- lineup size catches most but Decadence Arizona has 0 artists booked so far,
-- and it false-positives on multi-artist club nights. So this is a real column
-- seeded by a heuristic below and meant to be corrected by hand.

ALTER TABLE artists ADD COLUMN IF NOT EXISTS mixcloud_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_festival BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS events_is_festival_idx ON events (is_festival) WHERE is_festival;

-- Seed pass. Deliberately errs toward recall: a stacked bill is more often a
-- festival than not, and a wrong flag is one UPDATE away from fixed.
UPDATE events e
SET is_festival = true
WHERE e.is_festival = false
  AND (
      e.title ~* '\y(festival|fest|massive|carnival)\y'
      OR (SELECT count(*) FROM lineups l WHERE l.event_id = e.id) >= 8
  );

-- ---------------------------------------------------------------------------
-- Feed function: festival filter + is_festival on the row + mixcloud on artists
-- ---------------------------------------------------------------------------

-- Signature and output both change, so the old one has to go.
DROP FUNCTION IF EXISTS get_filtered_events(TEXT, TEXT, TEXT);

CREATE FUNCTION get_filtered_events(
    market_slug TEXT,
    timeframe TEXT DEFAULT NULL,
    vibe_filter TEXT DEFAULT NULL,
    festivals_only BOOLEAN DEFAULT false
)
RETURNS TABLE (
    event_id INT,
    title VARCHAR,
    event_date DATE,
    doors_time TIME,
    flyer_url TEXT,
    ticket_url TEXT,
    source_type VARCHAR,
    venue_name VARCHAR,
    venue_city VARCHAR,
    is_festival BOOLEAN,
    vibes TEXT[],
    artists JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    today DATE := (now() AT TIME ZONE 'America/Phoenix')::date;
    range_start DATE;
    range_end DATE;
BEGIN
    SELECT w.range_start, w.range_end INTO range_start, range_end
    FROM timeframe_window(timeframe, today) w;

    RETURN QUERY
    SELECT e.id,
           e.title,
           e.event_date,
           e.doors_time,
           e.flyer_url,
           e.ticket_url,
           e.source_type,
           v.name,
           v.city,
           e.is_festival,
           ev.vibes,
           COALESCE(
               (SELECT jsonb_agg(
                           jsonb_build_object(
                               'id', a.id,
                               'name', a.name,
                               'spotify_url', a.spotify_url,
                               'soundcloud_url', a.soundcloud_url,
                               'mixcloud_url', a.mixcloud_url,
                               'performance_order', l.performance_order
                           )
                           ORDER BY l.performance_order NULLS LAST, a.name
                       )
                FROM lineups l
                JOIN artists a ON a.id = l.artist_id
                WHERE l.event_id = e.id),
               '[]'::jsonb
           )
    FROM events e
    JOIN venues v ON v.id = e.venue_id
    JOIN markets m ON m.id = v.market_id
    JOIN event_vibes ev ON ev.event_id = e.id
    WHERE m.slug = market_slug
      AND e.event_date BETWEEN range_start AND range_end
      AND (NOT festivals_only OR e.is_festival)
      AND (vibe_filter IS NULL OR vibe_filter = '' OR vibe_filter = 'all'
           -- Events we couldn't classify at all.
           OR (vibe_filter = 'other' AND COALESCE(cardinality(ev.vibes), 0) = 0)
           OR vibe_filter = ANY (ev.vibes))
    ORDER BY e.event_date ASC, e.doors_time ASC NULLS LAST, e.id ASC;
END;
$$;
