-- Friend graph operations and the "friends going" social proof.
--
-- The friendships table (0006) already carries the edges; this adds the verbs.
-- Mutations go through SECURITY DEFINER functions rather than direct table
-- writes for two reasons the table's RLS can't cover on its own:
--   1. Consent — the row-level UPDATE policy lets either party flip status, so a
--      requester could accept their own request. These functions enforce that
--      only the recipient accepts.
--   2. Privacy — event_attendance RLS restricts every user to their own rows,
--      so "which friends are going" is impossible as a plain query. friends_going
--      is DEFINER but only ever returns accepted friends' attendance.
--
-- Every function pins search_path and gates on auth.uid(), so a null caller
-- (anon) gets nothing rather than acting as the definer.

-- A friendship is an unordered pair stored as (user_id_1 = requester,
-- user_id_2 = recipient). Given the caller, this is "the other person".
CREATE OR REPLACE FUNCTION friend_of(f friendships, me UUID)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN f.user_id_1 = me THEN f.user_id_2 ELSE f.user_id_1 END;
$$;

-- ---------------------------------------------------------------------------
-- Mutations
-- ---------------------------------------------------------------------------

-- Returns a status string rather than raising for the normal "can't friend
-- them" cases, so the client can show a message instead of catching errors:
-- 'sent' | 'accepted' | 'already_friends' | 'already_pending' | 'self' |
-- 'not_found'. 'accepted' happens when they had already requested you — sending
-- back is the same as accepting.
CREATE OR REPLACE FUNCTION send_friend_request(target_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    me UUID := auth.uid();
    target UUID;
    existing friendships;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;

    SELECT id INTO target FROM profiles WHERE username = target_username;
    IF target IS NULL THEN
        RETURN 'not_found';
    END IF;
    IF target = me THEN
        RETURN 'self';
    END IF;

    -- One edge per pair regardless of direction (the unique index enforces it;
    -- this just resolves what to do about an edge that already exists).
    SELECT * INTO existing FROM friendships
    WHERE LEAST(user_id_1, user_id_2) = LEAST(me, target)
      AND GREATEST(user_id_1, user_id_2) = GREATEST(me, target);

    IF FOUND THEN
        IF existing.status = 'accepted' THEN
            RETURN 'already_friends';
        END IF;
        -- Pending. If they are the requester, sending back accepts it.
        IF existing.user_id_2 = me THEN
            UPDATE friendships SET status = 'accepted' WHERE id = existing.id;
            RETURN 'accepted';
        END IF;
        RETURN 'already_pending';
    END IF;

    INSERT INTO friendships (user_id_1, user_id_2, status) VALUES (me, target, 'pending');
    RETURN 'sent';
END;
$$;

-- Only the recipient (user_id_2) may act on a pending request. accept=true sets
-- it accepted; accept=false deletes it (decline). Raises if the caller isn't
-- the recipient of a pending request with that id.
CREATE OR REPLACE FUNCTION respond_to_friend_request(request_id INT, accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    me UUID := auth.uid();
    req friendships;
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;

    SELECT * INTO req FROM friendships WHERE id = request_id;
    IF NOT FOUND OR req.status <> 'pending' OR req.user_id_2 <> me THEN
        RAISE EXCEPTION 'no pending request to respond to';
    END IF;

    IF accept THEN
        UPDATE friendships SET status = 'accepted' WHERE id = request_id;
        RETURN 'accepted';
    ELSE
        DELETE FROM friendships WHERE id = request_id;
        RETURN 'declined';
    END IF;
END;
$$;

-- Removes the edge in either state (unfriend, or cancel a request you sent).
CREATE OR REPLACE FUNCTION remove_friend(other_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    me UUID := auth.uid();
BEGIN
    IF me IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;

    DELETE FROM friendships
    WHERE LEAST(user_id_1, user_id_2) = LEAST(me, other_user_id)
      AND GREATEST(user_id_1, user_id_2) = GREATEST(me, other_user_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Accepted friends' public profiles. SECURITY INVOKER: friendships RLS already
-- scopes the caller to their own edges, and profiles' public columns are
-- readable, so nothing here needs elevated rights.
CREATE OR REPLACE FUNCTION list_friends()
RETURNS TABLE (id UUID, username TEXT, full_name TEXT, avatar_url TEXT, friends_since TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
    SELECT p.id, p.username, p.full_name, p.avatar_url, f.created_at
    FROM friendships f
    JOIN profiles p ON p.id = friend_of(f, auth.uid())
    WHERE f.status = 'accepted' AND (f.user_id_1 = auth.uid() OR f.user_id_2 = auth.uid())
    ORDER BY p.username;
$$;

-- Pending requests the caller has received, with the requester's profile and the
-- friendship id to pass back to respond_to_friend_request.
CREATE OR REPLACE FUNCTION list_incoming_requests()
RETURNS TABLE (request_id INT, id UUID, username TEXT, full_name TEXT, avatar_url TEXT, requested_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
    SELECT f.id, p.id, p.username, p.full_name, p.avatar_url, f.created_at
    FROM friendships f
    JOIN profiles p ON p.id = f.user_id_1
    WHERE f.status = 'pending' AND f.user_id_2 = auth.uid()
    ORDER BY f.created_at DESC;
$$;

-- ---------------------------------------------------------------------------
-- Social proof
-- ---------------------------------------------------------------------------

-- The caller's accepted friends who are attending target_event_id. DEFINER so
-- it can see past event_attendance's owner-only RLS, but the friendship join
-- means it can only ever surface friends — never a stranger's plans, never
-- attendance for any other event.
CREATE OR REPLACE FUNCTION friends_going(target_event_id INT)
RETURNS TABLE (id UUID, username TEXT, full_name TEXT, avatar_url TEXT, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p.id, p.username, p.full_name, p.avatar_url, ea.status
    FROM event_attendance ea
    JOIN profiles p ON p.id = ea.user_id
    WHERE ea.event_id = target_event_id
      AND ea.user_id IN (
          SELECT friend_of(f, auth.uid())
          FROM friendships f
          WHERE f.status = 'accepted' AND (f.user_id_1 = auth.uid() OR f.user_id_2 = auth.uid())
      )
    ORDER BY p.username;
$$;
