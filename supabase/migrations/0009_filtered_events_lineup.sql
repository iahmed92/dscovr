-- get_filtered_events returns the lineup, not just artist names.
--
-- 0008 returned artist_names TEXT[], which is enough to print a list and
-- nothing else. The feed cards render each artist with a Vibe Check play button
-- and profile links, so they need the artist id and urls too — with names alone
-- the client has to re-query per event, which is exactly the round trip this
-- function exists to remove.
--
-- The return type changes, so the old signature has to go: CREATE OR REPLACE
-- cannot alter a function's output columns.
DROP FUNCTION IF EXISTS get_filtered_events(TEXT, TEXT, TEXT);

CREATE FUNCTION get_filtered_events(
    market_slug TEXT,
    timeframe TEXT DEFAULT NULL,
    vibe_filter TEXT DEFAULT NULL
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
    vibes TEXT[],
    -- [{id, name, spotify_url, soundcloud_url, performance_order}], already in
    -- billing order. JSONB rather than a composite type so PostgREST hands the
    -- client a plain nested array and the shape can gain fields without another
    -- signature change.
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
           ev.vibes,
           COALESCE(
               (SELECT jsonb_agg(
                           jsonb_build_object(
                               'id', a.id,
                               'name', a.name,
                               'spotify_url', a.spotify_url,
                               'soundcloud_url', a.soundcloud_url,
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
      AND (vibe_filter IS NULL OR vibe_filter = '' OR vibe_filter = 'all'
           OR vibe_filter = ANY (ev.vibes))
    -- Same total ordering the feed relies on: event_date alone leaves same-day
    -- shows unordered and the list reshuffles between fetches.
    ORDER BY e.event_date ASC, e.doors_time ASC NULLS LAST, e.id ASC;
END;
$$;
