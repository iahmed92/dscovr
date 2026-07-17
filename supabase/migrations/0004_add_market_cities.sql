-- Multi-metro state support: a market can optionally restrict itself to a
-- list of specific cities within its state (e.g. an LA market would set
-- cities to ['Los Angeles', 'Hollywood', 'Anaheim', ...] so it doesn't also
-- pull in San Francisco/San Diego/Sacramento events from a CA stateCode
-- query). NULL/empty means "no city filter" — the existing single-metro
-- markets (phoenix-tucson, denver, las-vegas) don't need this and keep
-- working exactly as before.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS cities TEXT[];
