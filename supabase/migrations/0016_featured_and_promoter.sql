-- Surface featured placement and promoter attribution in the feed.
--
-- events.is_featured has existed since 0001 and never been read. It is the
-- sellable product: a flat monthly placement is far easier for a promoter to
-- buy than per-ticket revenue share, which needs conversion data nobody has
-- yet. Featured events sort to the top of their day rather than jumping the
-- calendar — a paid slot shouldn't let a November show outrank tonight.
--
-- promoter_name comes along because 66% of events carry a promoter_id and the
-- app could never display it (promoters was unreadable until 0015). Showing
-- "Presented by Relentless Beats" is worth something to them before any money
-- changes hands.

DROP FUNCTION IF EXISTS get_filtered_events(TEXT, TEXT, TEXT, BOOLEAN);

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
    is_featured BOOLEAN,
    promoter_name VARCHAR,
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
           e.is_featured,
           p.name,
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
    LEFT JOIN promoters p ON p.id = e.promoter_id
    WHERE m.slug = market_slug
      AND e.event_date BETWEEN range_start AND range_end
      AND (NOT festivals_only OR e.is_festival)
      AND (vibe_filter IS NULL OR vibe_filter = '' OR vibe_filter = 'all'
           OR (vibe_filter = 'other' AND COALESCE(cardinality(ev.vibes), 0) = 0)
           OR vibe_filter = ANY (ev.vibes))
    -- Featured first *within* the day; still a total ordering, so the feed
    -- can't reshuffle between fetches.
    ORDER BY e.event_date ASC, e.is_featured DESC, e.doors_time ASC NULLS LAST, e.id ASC;
END;
$$;
