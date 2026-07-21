-- promoters was the one table in 0001 that got RLS enabled without a matching
-- SELECT policy, so it has been unreadable to the app since day one — 11 rows
-- (Relentless Beats, Insomniac Presents, Live Nation…) that no client could
-- see, even though 66% of events carry a promoter_id.
--
-- Public read like the rest of the catalogue. The commercially sensitive part
-- is the click rollup, which stays service-role only; a promoter's name is
-- printed on the flyer.
CREATE POLICY "Allow public read access to promoters" ON promoters
    FOR SELECT TO anon, authenticated USING (true);

-- stripe_customer_id and owner_id are billing/ownership fields, not catalogue
-- data. Same lesson as profiles in 0006: RLS is row-level, so the table grant
-- has to be revoked before the readable columns are handed back.
REVOKE SELECT ON promoters FROM anon, authenticated;
GRANT SELECT (id, name, website, logo_url, is_verified) ON promoters TO anon, authenticated;
