-- Baseline schema, already applied live in Supabase. Checked into git here
-- purely for version history / reproducibility going forward.

CREATE TABLE IF NOT EXISTS markets (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS promoters (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    website VARCHAR(255),
    logo_url VARCHAR(255),
    stripe_customer_id VARCHAR(255),
    is_verified BOOLEAN DEFAULT false,
    owner_id UUID
);

CREATE TABLE IF NOT EXISTS venues (
    id SERIAL PRIMARY KEY,
    market_id INT REFERENCES markets(id) ON DELETE SET NULL,
    name VARCHAR(150) UNIQUE NOT NULL,
    address VARCHAR(255),
    city VARCHAR(100),
    latitude DECIMAL(9,6),
    longitude DECIMAL(9,6),
    website VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS artists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) UNIQUE NOT NULL,
    spotify_id VARCHAR(100),
    spotify_preview_url VARCHAR(255),
    genre_tags VARCHAR(50)[],
    underground_score INT DEFAULT 5
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    venue_id INT REFERENCES venues(id) ON DELETE CASCADE,
    promoter_id INT REFERENCES promoters(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    doors_time TIME,
    ticket_url TEXT,
    flyer_url TEXT,
    is_featured BOOLEAN DEFAULT false,
    source_type VARCHAR(50) DEFAULT 'curated',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_venue_title_date UNIQUE (venue_id, title, event_date)
);

CREATE TABLE IF NOT EXISTS lineups (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    artist_id INT REFERENCES artists(id) ON DELETE CASCADE,
    performance_order INT,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_event_artist UNIQUE (event_id, artist_id)
);

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to markets" ON markets FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public read access to venues" ON venues FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public read access to artists" ON artists FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public read access to events" ON events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public read access to lineups" ON lineups FOR SELECT TO anon, authenticated USING (true);
