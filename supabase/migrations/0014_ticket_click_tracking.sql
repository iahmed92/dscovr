-- Outbound ticket-click tracking.
--
-- The number you negotiate with. Charging a promoter per ticket sold requires
-- proving the sale came from here, and we can't see inside Ticketmaster's or a
-- promoter's checkout — so the honest first metric is clicks we demonstrably
-- sent, reconciled later against whatever they report.
--
-- Deliberately thin: event_id and an optional user. Market, promoter, source
-- and date all join off events, so storing them again would just create rows
-- that can drift.

CREATE TABLE IF NOT EXISTS ticket_clicks (
    id BIGSERIAL PRIMARY KEY,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    -- Null for signed-out visitors, who still click tickets and still count.
    -- SET NULL rather than CASCADE: a deleted account shouldn't erase the
    -- click history a promoter is being billed against.
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    clicked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_clicks_event_idx ON ticket_clicks (event_id);
CREATE INDEX IF NOT EXISTS ticket_clicks_clicked_at_idx ON ticket_clicks (clicked_at);

ALTER TABLE ticket_clicks ENABLE ROW LEVEL SECURITY;

-- Anyone may log a click, but only as themselves — without the WITH CHECK a
-- client could attribute clicks to another user.
CREATE POLICY "Anyone can log a ticket click" ON ticket_clicks
    FOR INSERT TO anon, authenticated
    WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- No SELECT policy on purpose. This is business data: who is going where is
-- exactly what shouldn't be readable by other clients, and the aggregate is
-- commercially sensitive. Reporting runs as the service role.
--
-- Supabase's default privileges grant ALL on new tables to the API roles, and
-- a policy can't narrow a table-level grant, so the grant is revoked first —
-- the same ordering profiles needed in 0006.
REVOKE ALL ON ticket_clicks FROM anon, authenticated;
GRANT INSERT (event_id, user_id) ON ticket_clicks TO anon, authenticated;
GRANT USAGE ON SEQUENCE ticket_clicks_id_seq TO anon, authenticated;

-- Reporting rollup. security_invoker so it inherits the caller's rights:
-- clients read nothing through it, the service role sees everything.
CREATE OR REPLACE VIEW ticket_click_stats WITH (security_invoker = true) AS
SELECT e.id AS event_id,
       e.title,
       e.event_date,
       e.source_type,
       m.slug AS market,
       p.name AS promoter,
       count(*) AS clicks,
       count(DISTINCT tc.user_id) FILTER (WHERE tc.user_id IS NOT NULL) AS signed_in_users,
       max(tc.clicked_at) AS last_click
FROM ticket_clicks tc
JOIN events e ON e.id = tc.event_id
JOIN venues v ON v.id = e.venue_id
JOIN markets m ON m.id = v.market_id
LEFT JOIN promoters p ON p.id = e.promoter_id
GROUP BY e.id, e.title, e.event_date, e.source_type, m.slug, p.name;
