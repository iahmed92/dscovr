-- Direct profile links for the artist detail view.
-- spotify_url is only populated once spotify_id is resolved (Vibe Check).
-- soundcloud_url has no reliable API-verified ID to key off, so it's always
-- a search-results link rather than a guaranteed direct profile match.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS spotify_url TEXT;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS soundcloud_url TEXT;
