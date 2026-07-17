-- User accounts, the social graph, and attendance history.
--
-- Everything user-facing hangs off Supabase's managed auth.users: we never
-- store credentials ourselves, and public.profiles is the joinable mirror that
-- the rest of the schema can safely reference.

-- CREATE TYPE has no IF NOT EXISTS; the DO block keeps this migration
-- re-runnable like the rest of the history.
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('concert_goer', 'promoter', 'venue_manager', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    full_name TEXT,
    -- Carried for the SMS OTP / contact-sync work. Both this and the Spotify
    -- tokens below are column-revoked from clients at the bottom of this file.
    phone VARCHAR(20) UNIQUE,
    avatar_url TEXT,
    role user_role NOT NULL DEFAULT 'concert_goer',
    spotify_access_token TEXT,
    spotify_refresh_token TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Auto-provision a profile for every new auth user
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER because the trigger fires as the auth service, which has no
-- rights on public.profiles. search_path is pinned so a mutable search_path
-- can't be used to hijack the definer's privileges.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    base_username TEXT;
    candidate TEXT;
    suffix INT := 0;
BEGIN
    -- Metadata first, then phone, then the email prefix.
    base_username := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data ->> 'username'), ''),
        NULLIF(TRIM(NEW.phone), ''),
        NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), '')
    );

    -- A user can sign up with neither a username, a phone, nor an email
    -- (anonymous sign-ins), and username is UNIQUE — so fall back to the uid
    -- rather than inserting a NULL that later collides.
    IF base_username IS NULL THEN
        base_username := 'raver_' || substr(NEW.id::text, 1, 8);
    END IF;

    -- username is UNIQUE and two users can easily share an email prefix
    -- (john@gmail / john@yahoo). An unhandled unique violation here would
    -- abort the auth.users insert and break signup entirely, so uniquify.
    candidate := base_username;
    WHILE EXISTS (SELECT 1 FROM profiles WHERE username = candidate) LOOP
        suffix := suffix + 1;
        candidate := base_username || suffix::text;
    END LOOP;

    INSERT INTO profiles (id, username, full_name, phone, avatar_url)
    VALUES (
        NEW.id,
        candidate,
        NULLIF(TRIM(NEW.raw_user_meta_data ->> 'full_name'), ''),
        NULLIF(TRIM(NEW.phone), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data ->> 'avatar_url'), '')
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- Social graph
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    user_id_1 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id_2 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'accepted',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT friendship_not_self CHECK (user_id_1 <> user_id_2)
);

-- A friendship is undirected, but the rows are ordered pairs: (a,b) and (b,a)
-- describe the same edge. Keying the index on the sorted pair is what makes
-- the duplicate impossible regardless of who sent the request.
CREATE UNIQUE INDEX IF NOT EXISTS friendships_unique_pair
    ON friendships (LEAST(user_id_1, user_id_2), GREATEST(user_id_1, user_id_2));

CREATE INDEX IF NOT EXISTS friendships_user_id_1_idx ON friendships (user_id_1);
CREATE INDEX IF NOT EXISTS friendships_user_id_2_idx ON friendships (user_id_2);

-- ---------------------------------------------------------------------------
-- Attendance ("going" = upcoming plan, "attended" = the rave resume)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS event_attendance (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'going',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT event_attendance_unique_user_event UNIQUE (user_id, event_id),
    CONSTRAINT event_attendance_status_check CHECK (status IN ('going', 'attended', 'interested'))
);

CREATE INDEX IF NOT EXISTS event_attendance_user_idx ON event_attendance (user_id);
CREATE INDEX IF NOT EXISTS event_attendance_event_idx ON event_attendance (event_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are publicly readable" ON profiles
    FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Either side of the edge may read or delete it; only the sender may create it.
CREATE POLICY "Users can view their own friendships" ON friendships
    FOR SELECT TO authenticated USING (auth.uid() = user_id_1 OR auth.uid() = user_id_2);

CREATE POLICY "Users can create friendships they are part of" ON friendships
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id_1);

CREATE POLICY "Users can update their own friendships" ON friendships
    FOR UPDATE TO authenticated USING (auth.uid() = user_id_1 OR auth.uid() = user_id_2);

CREATE POLICY "Users can delete their own friendships" ON friendships
    FOR DELETE TO authenticated USING (auth.uid() = user_id_1 OR auth.uid() = user_id_2);

CREATE POLICY "Users can view their own attendance" ON event_attendance
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can log their own attendance" ON event_attendance
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own attendance" ON event_attendance
    FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own attendance" ON event_attendance
    FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Column privileges
-- ---------------------------------------------------------------------------

-- RLS is row-level only: the "publicly readable" policy above would otherwise
-- hand every caller each user's OAuth tokens and phone number. Postgres has no
-- column-level RLS, so privileges are the lever.
--
-- Order matters, and not in the obvious way. Supabase's default privileges
-- grant ALL on every new public table to the API roles, and Postgres will not
-- let a column-level REVOKE override a table-level grant that implies it — so
-- revoking the columns alone is decorative and the tokens stay readable. The
-- table-level grant has to go first, then the safe columns are added back.
-- (Regression-tested in supabase/tests/migrations.test.mjs.)
REVOKE SELECT, INSERT, UPDATE ON profiles FROM anon, authenticated;

GRANT SELECT (id, username, full_name, avatar_url, role, created_at)
    ON profiles TO anon, authenticated;

-- Provisioning is the trigger's job; this is a fallback for a client creating
-- its own row. role is withheld so a user cannot sign up as an admin.
GRANT INSERT (id, username, full_name, phone, avatar_url)
    ON profiles TO authenticated;

-- role is deliberately absent here too: the UPDATE policy above scopes a user
-- to their own row, which without this would let anyone promote themselves to
-- admin. Role changes go through the service role.
--
-- The tokens are writable but not readable by the owner: refresh flows belong
-- server-side in an edge function holding the service role, so the client
-- never needs to read them back.
GRANT UPDATE (username, full_name, phone, avatar_url, spotify_access_token, spotify_refresh_token)
    ON profiles TO authenticated;
