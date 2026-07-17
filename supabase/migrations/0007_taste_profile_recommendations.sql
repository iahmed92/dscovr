-- Spotify taste profile and the recommendation engine that reads it.
--
-- These two tables are a cache of what we learned from a user's Spotify
-- account, not a source of truth — they are safe to wipe and rebuild.

CREATE TABLE IF NOT EXISTS user_favorite_genres (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Stored as Spotify writes it. Matching lowercases both sides rather than
    -- normalizing on write, so a re-sync can't silently change the PK.
    genre VARCHAR(100) NOT NULL,
    affinity_score INT NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, genre)
);

CREATE TABLE IF NOT EXISTS user_favorite_artists (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    artist_id INT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, artist_id)
);

CREATE INDEX IF NOT EXISTS user_favorite_genres_genre_idx ON user_favorite_genres (lower(genre));
CREATE INDEX IF NOT EXISTS user_favorite_artists_artist_idx ON user_favorite_artists (artist_id);

ALTER TABLE user_favorite_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_favorite_artists ENABLE ROW LEVEL SECURITY;

-- A taste profile is private: it is not something other users get to browse.
CREATE POLICY "Users manage their own favorite genres" ON user_favorite_genres
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage their own favorite artists" ON user_favorite_artists
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Recommendations
-- ---------------------------------------------------------------------------

-- Scores upcoming shows in a market against the user's cached taste profile.
--
-- SECURITY INVOKER (the default) is deliberate: the favorites tables are
-- RLS-protected, so passing someone else's uid returns an empty profile and
-- therefore no rows, rather than leaking what they like. Do not make this
-- DEFINER without adding an explicit auth.uid() check.
CREATE OR REPLACE FUNCTION get_personalized_recommendations(
    target_user_id UUID,
    target_market_id INT
)
RETURNS TABLE (
    event_id INT,
    title VARCHAR,
    event_date DATE,
    doors_time TIME,
    flyer_url TEXT,
    ticket_url TEXT,
    venue_name VARCHAR,
    venue_city VARCHAR,
    match_score NUMERIC,
    matched_artists TEXT[],
    matched_genres TEXT[]
)
LANGUAGE sql
STABLE
AS $$
    WITH fav_artists AS (
        SELECT ufa.artist_id FROM user_favorite_artists ufa WHERE ufa.user_id = target_user_id
    ),
    fav_genres AS (
        SELECT lower(ufg.genre) AS genre, ufg.affinity_score
        FROM user_favorite_genres ufg WHERE ufg.user_id = target_user_id
    ),
    upcoming AS (
        SELECT e.id, e.title, e.event_date, e.doors_time, e.flyer_url, e.ticket_url,
               v.name AS venue_name, v.city AS venue_city
        FROM events e
        JOIN venues v ON v.id = e.venue_id
        WHERE v.market_id = target_market_id
          AND e.event_date >= CURRENT_DATE
          -- Already on the rave resume (going/attended) — recommending it back
          -- is noise, not a suggestion.
          AND NOT EXISTS (
              SELECT 1 FROM event_attendance ea
              WHERE ea.event_id = e.id AND ea.user_id = target_user_id
          )
    ),
    booked AS (
        SELECT l.event_id, a.id AS artist_id, a.name AS artist_name, a.genre_tags
        FROM lineups l
        JOIN artists a ON a.id = l.artist_id
        WHERE l.event_id IN (SELECT u.id FROM upcoming u)
    ),
    -- A booked favorite is the strongest signal we have, so it outweighs any
    -- single genre affinity.
    artist_match AS (
        SELECT b.event_id,
               COUNT(*) * 10 AS points,
               ARRAY_AGG(DISTINCT b.artist_name::text) AS names
        FROM booked b
        WHERE b.artist_id IN (SELECT fa.artist_id FROM fav_artists fa)
        GROUP BY b.event_id
    ),
    -- Summed per (artist, genre) hit, so a night stacked with artists in a
    -- genre you love outranks one with a single passing match.
    genre_match AS (
        SELECT b.event_id,
               SUM(fg.affinity_score) AS points,
               ARRAY_AGG(DISTINCT fg.genre::text) AS genres
        FROM booked b
        CROSS JOIN LATERAL unnest(COALESCE(b.genre_tags, ARRAY[]::varchar[])) AS tag
        JOIN fav_genres fg ON fg.genre = lower(tag)
        GROUP BY b.event_id
    )
    SELECT u.id,
           u.title,
           u.event_date,
           u.doors_time,
           u.flyer_url,
           u.ticket_url,
           u.venue_name,
           u.venue_city,
           (COALESCE(am.points, 0) + COALESCE(gm.points, 0))::numeric AS match_score,
           COALESCE(am.names, ARRAY[]::text[]) AS matched_artists,
           COALESCE(gm.genres, ARRAY[]::text[]) AS matched_genres
    FROM upcoming u
    LEFT JOIN artist_match am ON am.event_id = u.id
    LEFT JOIN genre_match gm ON gm.event_id = u.id
    -- Unmatched shows are just the normal feed; a recommendation has to be
    -- earned by at least one signal.
    WHERE COALESCE(am.points, 0) + COALESCE(gm.points, 0) > 0
    ORDER BY match_score DESC, u.event_date ASC, u.id ASC;
$$;
