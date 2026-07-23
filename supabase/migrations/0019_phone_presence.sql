-- Lets a signed-in user learn WHETHER they have a phone on file, without being
-- able to read the number itself.
--
-- profiles.phone is deliberately not in the client SELECT grant (0006) — the
-- owner can write it but not read it back, the same withholding the Spotify
-- tokens get. That protects the number from a `select=*`, but it also means the
-- account screen has no way to show "phone added" vs "add your phone", and
-- contact matching is gated on having one (get_contacts_on_dscovr refuses a
-- caller with no phone). Catching that refusal's error string to drive the UI
-- would be a bandaid; a boolean is the honest mechanism.
--
-- DEFINER so it can read the withheld column, but it returns only a boolean and
-- only ever about the caller's own row — never a number, never anyone else.
CREATE OR REPLACE FUNCTION current_user_has_phone()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND phone IS NOT NULL
    );
$$;

-- Signed-out callers get a plain false rather than an error: the account screen
-- can call it unconditionally.
REVOKE ALL ON FUNCTION current_user_has_phone() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_user_has_phone() TO anon, authenticated;
