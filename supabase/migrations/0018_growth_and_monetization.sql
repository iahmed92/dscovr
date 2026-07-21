-- Growth and monetization groundwork: contact matching, batched social proof,
-- VIP lead capture, and internal demand analytics.

-- ---------------------------------------------------------------------------
-- Batched social proof
-- ---------------------------------------------------------------------------

-- friends_going() answers one event. The feed needs avatar stacks on every
-- card, and calling it per card is an N+1 round trip per scroll. This answers
-- a page of events in one call.
--
-- Same privacy shape as friends_going: DEFINER so it can see past
-- event_attendance's owner-only RLS, but gated on the caller's accepted
-- friendships, so it can only ever surface friends — never a stranger's plans.
CREATE OR REPLACE FUNCTION friends_going_batch(target_event_ids INT[])
RETURNS TABLE (event_id INT, id UUID, username TEXT, avatar_url TEXT, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT ea.event_id, p.id, p.username, p.avatar_url, ea.status
    FROM event_attendance ea
    JOIN profiles p ON p.id = ea.user_id
    WHERE ea.event_id = ANY (target_event_ids)
      AND ea.user_id IN (
          SELECT friend_of(f, auth.uid())
          FROM friendships f
          WHERE f.status = 'accepted'
            AND (f.user_id_1 = auth.uid() OR f.user_id_2 = auth.uid())
      )
    ORDER BY ea.event_id, p.username;
$$;

-- ---------------------------------------------------------------------------
-- Contact matching
-- ---------------------------------------------------------------------------

-- Digits only, so '(602) 555-0147', '+1 602-555-0147' and '6025550147' all
-- compare equal. Trailing 10 digits ignores the country code, which is right
-- for a US-only product and would need revisiting before international.
CREATE OR REPLACE FUNCTION normalize_phone(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(RIGHT(regexp_replace(COALESCE(raw, ''), '[^0-9]', '', 'g'), 10), '');
$$;

CREATE INDEX IF NOT EXISTS profiles_normalized_phone_idx
    ON profiles (normalize_phone(phone)) WHERE phone IS NOT NULL;

-- "Which of my contacts are already here?"
--
-- This is a phone-enumeration surface and it is treated as one. An unguarded
-- version of this function is how large platforms have leaked their entire user
-- base: the caller supplies numbers and learns which exist, so brute-forcing a
-- range enumerates users. Hashing the input does NOT fix that — the number
-- space is small enough to hash exhaustively — so the defence has to be access
-- control and rate limiting instead.
--
-- Guards:
--   * authenticated callers only
--   * the caller must have a phone on their own profile, so enumeration
--     requires burning a verified identity rather than an anonymous key
--   * batch capped, so a single call can't sweep a range
--   * returns id/username/avatar only — never a phone, never a confirmation of
--     a number that isn't already the caller's contact
--
-- Residual risk, stated plainly: a determined verified user can still probe
-- 500 numbers per call. Add per-user rate limiting before this is public.
CREATE OR REPLACE FUNCTION get_contacts_on_dscovr(phone_numbers TEXT[])
RETURNS TABLE (id UUID, username TEXT, avatar_url TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    me UUID := auth.uid();
    caller_phone TEXT;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;

    SELECT normalize_phone(p.phone) INTO caller_phone FROM profiles p WHERE p.id = me;
    IF caller_phone IS NULL THEN
        RAISE EXCEPTION 'add a phone number to your profile before matching contacts';
    END IF;

    IF array_length(phone_numbers, 1) > 500 THEN
        RAISE EXCEPTION 'too many numbers in one request (max 500)';
    END IF;

    RETURN QUERY
    SELECT p.id, p.username, p.avatar_url
    FROM profiles p
    WHERE p.phone IS NOT NULL
      AND p.id <> me
      AND normalize_phone(p.phone) IN (
          SELECT normalize_phone(n) FROM unnest(phone_numbers) AS n
      );
END;
$$;

-- ---------------------------------------------------------------------------
-- VIP / table service leads
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vip_inquiries (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    phone TEXT,
    group_size INT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT vip_inquiries_status_check CHECK (status IN ('pending', 'contacted', 'booked', 'closed')),
    CONSTRAINT vip_inquiries_group_size_check CHECK (group_size IS NULL OR group_size BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS vip_inquiries_event_idx ON vip_inquiries (event_id);
CREATE INDEX IF NOT EXISTS vip_inquiries_status_idx ON vip_inquiries (status);

ALTER TABLE vip_inquiries ENABLE ROW LEVEL SECURITY;

-- A lead carries a phone number, so it is treated like the profile phone: the
-- submitter may create one and read their own back, and nobody else can read
-- any of it. Sales works the queue as the service role.
CREATE POLICY "Users can submit a VIP inquiry" ON vip_inquiries
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can see their own inquiries" ON vip_inquiries
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON vip_inquiries FROM anon, authenticated;
GRANT INSERT (event_id, user_id, phone, group_size) ON vip_inquiries TO authenticated;
GRANT SELECT (id, event_id, user_id, group_size, status, created_at) ON vip_inquiries TO authenticated;
GRANT USAGE ON SEQUENCE vip_inquiries_id_seq TO authenticated;

-- ---------------------------------------------------------------------------
-- Demand analytics (internal)
-- ---------------------------------------------------------------------------

-- Which genres have an audience in which market, for deciding where to expand
-- and what to book.
--
-- A user has no stored home market, so the market is inferred from where they
-- have actually marked attendance — the honest join, and it means the view only
-- describes users who have engaged with a market rather than guessing.
--
-- Cells below 5 users are suppressed. Without that, a market with two users
-- turns an "aggregate" into a description of identifiable individuals' taste.
--
-- NOTE: genre affinity is derived from Spotify data. Using this internally to
-- decide bookings is ordinary product analytics. Selling or handing it to
-- promoters is a different act and likely conflicts with Spotify's developer
-- terms, which restrict transferring Spotify-derived data to third parties.
-- Get that cleared before it becomes a product.
CREATE OR REPLACE VIEW promoter_market_demand WITH (security_invoker = true) AS
SELECT m.slug AS market,
       m.name AS market_name,
       lower(ufg.genre) AS genre,
       count(DISTINCT ufg.user_id) AS users,
       sum(ufg.affinity_score) AS total_affinity,
       round(avg(ufg.affinity_score), 2) AS avg_affinity
FROM user_favorite_genres ufg
JOIN event_attendance ea ON ea.user_id = ufg.user_id
JOIN events e ON e.id = ea.event_id
JOIN venues v ON v.id = e.venue_id
JOIN markets m ON m.id = v.market_id
GROUP BY m.slug, m.name, lower(ufg.genre)
HAVING count(DISTINCT ufg.user_id) >= 5;
