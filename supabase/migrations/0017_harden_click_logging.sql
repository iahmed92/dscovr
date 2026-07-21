-- Harden ticket-click logging.
--
-- 0014 let clients INSERT directly. Two problems for a number we intend to
-- invoice on: the client supplied user_id (the WITH CHECK stopped impersonation
-- but not a flood of NULL-user rows), and nothing stopped the same tap being
-- recorded a thousand times. The anon key ships in the web bundle by design, so
-- "a script can POST in a loop" is not a hypothetical.
--
-- Direct insert is revoked. Clients call an RPC that stamps the user server-side
-- and collapses repeats, so the recorded number is something we can defend.

REVOKE INSERT ON ticket_clicks FROM anon, authenticated;
REVOKE USAGE ON SEQUENCE ticket_clicks_id_seq FROM anon, authenticated;

DROP POLICY IF EXISTS "Anyone can log a ticket click" ON ticket_clicks;

-- SECURITY DEFINER so it can write to a table clients can no longer touch.
-- user_id comes from auth.uid(), never from the caller, so attribution can't be
-- forged. The dedupe window collapses double-taps and refresh loops for a
-- signed-in user.
--
-- Honest limit: anonymous clicks still can't be deduplicated, because we
-- deliberately store nothing that identifies an anonymous visitor. A determined
-- script can still inflate the anonymous count, so signed_in_users is the
-- defensible figure and total clicks stays advisory until reconciled against a
-- promoter's own reporting.
CREATE OR REPLACE FUNCTION log_ticket_click(target_event_id INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    me UUID := auth.uid();
BEGIN
    -- Reject ids that aren't real events rather than accumulating orphans.
    IF NOT EXISTS (SELECT 1 FROM events WHERE id = target_event_id) THEN
        RETURN;
    END IF;

    IF me IS NOT NULL AND EXISTS (
        SELECT 1 FROM ticket_clicks
        WHERE event_id = target_event_id
          AND user_id = me
          AND clicked_at > now() - interval '30 minutes'
    ) THEN
        RETURN;
    END IF;

    INSERT INTO ticket_clicks (event_id, user_id) VALUES (target_event_id, me);
END;
$$;

-- Index supporting the dedupe lookup.
CREATE INDEX IF NOT EXISTS ticket_clicks_user_event_recent_idx
    ON ticket_clicks (user_id, event_id, clicked_at DESC);
