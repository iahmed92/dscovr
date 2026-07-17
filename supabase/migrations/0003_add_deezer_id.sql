-- Resolve-on-demand Vibe Check: store the stable Deezer artist ID instead of
-- relying on cached preview URLs, which are signed and expire within hours.
-- spotify_id already exists and is stable; spotify_preview_url is left in
-- place as a non-authoritative last-known-good value, superseded by the
-- vibecheck Edge Function at read time.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS deezer_id VARCHAR(50);
