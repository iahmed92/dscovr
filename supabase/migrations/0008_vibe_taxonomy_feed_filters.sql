-- Master "vibe" taxonomy and the filtered feed the mobile UI calls.
--
-- Spotify's genre_tags are granular and chaotic ("egg punk", "melodic riddim"),
-- which is useless as a filter chip. These map the long tail onto five master
-- categories the UI can show as buttons.

-- ---------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------

-- A table, not a CASE expression: the tag long tail grows every time we ingest
-- a new artist, and adding a pattern should be an INSERT, not a migration.
CREATE TABLE IF NOT EXISTS vibe_taxonomy (
    vibe TEXT NOT NULL,
    -- Matched with LIKE against a lowercased tag, so 'tech house' catches
    -- "tech house" and '%techno%' catches "melodic techno", "peak time techno".
    pattern TEXT NOT NULL,
    PRIMARY KEY (vibe, pattern)
);

INSERT INTO vibe_taxonomy (vibe, pattern) VALUES
    ('house_techno', '%tech house%'),
    ('house_techno', '%techno%'),
    ('house_techno', '%house%'),
    ('house_techno', '%deep house%'),
    ('house_techno', '%minimal%'),
    ('bass_dubstep', '%dubstep%'),
    ('bass_dubstep', '%riddim%'),
    ('bass_dubstep', '%drum and bass%'),
    ('bass_dubstep', '%drum & bass%'),
    ('bass_dubstep', '%dnb%'),
    ('bass_dubstep', '%trap%'),
    ('bass_dubstep', '%tearout%'),
    ('bass_dubstep', '%bass%'),
    ('trance_progressive', '%trance%'),
    ('trance_progressive', '%progressive house%'),
    ('trance_progressive', '%psytrance%'),
    ('mainstage_edm', '%big room%'),
    ('mainstage_edm', '%future bass%'),
    ('mainstage_edm', '%electro house%'),
    ('mainstage_edm', '%dance-pop%'),
    ('mainstage_edm', '%dance pop%'),
    ('mainstage_edm', '%edm%'),
    ('underground_experimental', '%experimental%'),
    ('underground_experimental', '%ambient%'),
    ('underground_experimental', '%leftfield%')
ON CONFLICT DO NOTHING;

ALTER TABLE vibe_taxonomy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to vibe_taxonomy" ON vibe_taxonomy
    FOR SELECT TO anon, authenticated USING (true);

-- Resolves one artist's raw genre_tags to the master vibes they imply.
-- Ordering matters for specificity: '%experimental bass%' hits both
-- bass_dubstep and underground_experimental, and that is intentional — an
-- event can carry more than one vibe.
-- STABLE, not IMMUTABLE: this reads vibe_taxonomy. IMMUTABLE promises the
-- result depends on the arguments alone and that the function never touches the
-- database, which would let the planner fold a call to a constant and go on
-- ignoring later edits to the taxonomy — the exact thing the table exists to
-- allow. (timeframe_window below is IMMUTABLE precisely because it reads
-- nothing but its arguments.)
CREATE OR REPLACE FUNCTION vibes_for_tags(tags VARCHAR[])
RETURNS TEXT[]
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(ARRAY_AGG(DISTINCT vt.vibe), ARRAY[]::text[])
    FROM unnest(COALESCE(tags, ARRAY[]::varchar[])) AS tag
    JOIN vibe_taxonomy vt ON lower(tag) LIKE vt.pattern;
$$;

-- ---------------------------------------------------------------------------
-- Per-event vibe aggregation
-- ---------------------------------------------------------------------------

-- An event's vibes are the union of its booked artists' vibes. Exposed as a
-- view so the feed function and any ad-hoc query agree on the definition.
--
-- security_invoker is on because a view otherwise runs as its owner (postgres)
-- and silently bypasses RLS on events/lineups/artists. Those are public-read
-- today so nothing leaks either way, but the day anyone restricts them this
-- view would quietly become the hole. Cheaper to be correct now.
CREATE OR REPLACE VIEW event_vibes WITH (security_invoker = true) AS
SELECT e.id AS event_id,
       COALESCE(
           (SELECT ARRAY_AGG(DISTINCT v.vibe)
            FROM lineups l
            JOIN artists a ON a.id = l.artist_id
            CROSS JOIN LATERAL unnest(vibes_for_tags(a.genre_tags)) AS v(vibe)
            WHERE l.event_id = e.id),
           ARRAY[]::text[]
       ) AS vibes
FROM events e;

-- ---------------------------------------------------------------------------
-- Indexes for the feed path
-- ---------------------------------------------------------------------------

-- get_filtered_events walks markets -> venues -> events and filters on a date
-- window. Postgres does not index foreign keys automatically, and the baseline
-- schema never added these, so both the market lookup and the date window were
-- sequential scans. events(venue_id) is already covered by the leading column
-- of unique_venue_title_date.
CREATE INDEX IF NOT EXISTS venues_market_id_idx ON venues (market_id);
CREATE INDEX IF NOT EXISTS events_event_date_idx ON events (event_date);

-- ---------------------------------------------------------------------------
-- The feed
-- ---------------------------------------------------------------------------

-- Resolves a timeframe name to a date window, given the caller's "today".
--
-- Split out from get_filtered_events specifically so it is testable: the feed
-- reads the clock, which makes the weekend branch impossible to drive for a
-- day that isn't today. Taking `today` as an argument means every weekday can
-- be asserted directly. IMMUTABLE for the same reason — no clock inside.
CREATE OR REPLACE FUNCTION timeframe_window(timeframe TEXT, today DATE)
RETURNS TABLE (range_start DATE, range_end DATE)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    -- Postgres dow: 0=Sunday .. 5=Friday, 6=Saturday
    dow INT := EXTRACT(DOW FROM today);
BEGIN
    IF timeframe IS NULL OR timeframe = '' OR timeframe = 'all' THEN
        range_start := today;
        range_end := DATE '9999-12-31';
    ELSIF timeframe = 'today' THEN
        range_start := today;
        range_end := today;
    ELSIF timeframe = 'this_week' THEN
        range_start := today;
        range_end := today + 7;
    ELSIF timeframe = 'this_weekend' THEN
        -- Friday through Sunday of the current week. On Sat/Sun the weekend is
        -- already underway, so it starts today rather than jumping to next
        -- Friday and hiding tonight's show.
        IF dow = 0 THEN
            range_start := today;          -- Sunday: the tail of this weekend
            range_end := today;
        ELSIF dow = 6 THEN
            range_start := today;          -- Saturday
            range_end := today + 1;
        ELSE
            range_start := today + (5 - dow);
            range_end := range_start + 2;
        END IF;
    ELSIF timeframe = 'next_month' THEN
        range_start := today;
        range_end := today + 30;
    ELSE
        RAISE EXCEPTION 'unknown timeframe %, expected today|this_week|this_weekend|next_month|all', timeframe;
    END IF;

    RETURN NEXT;
END;
$$;

-- Timeframe + vibe filtering done in Postgres so the client fetches a screen's
-- worth of rows instead of paging a chronological firehose.
--
-- Dates are compared against a market-local "today". event_date is a bare
-- calendar DATE with no timezone, and CURRENT_DATE on the server is UTC — so
-- for a few hours each night a UTC server would call tomorrow's shows "today"
-- for a US market. The market's timezone is not modelled yet, so this pins to
-- America/Phoenix: every current market (AZ, NV, CO, CA) is within an hour of
-- it, which is close enough for day bucketing and wrong by less than the
-- UTC drift it replaces. Revisit when markets.timezone exists.
CREATE OR REPLACE FUNCTION get_filtered_events(
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
    artist_names TEXT[]
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
               (SELECT ARRAY_AGG(a.name::text ORDER BY l.performance_order NULLS LAST, a.name)
                FROM lineups l JOIN artists a ON a.id = l.artist_id
                WHERE l.event_id = e.id),
               ARRAY[]::text[]
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
