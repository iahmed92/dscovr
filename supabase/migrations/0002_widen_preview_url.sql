-- Already applied live: Deezer's signed preview URLs exceed VARCHAR(255).
ALTER TABLE artists ALTER COLUMN spotify_preview_url TYPE TEXT;
