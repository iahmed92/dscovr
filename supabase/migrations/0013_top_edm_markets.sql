-- Expand from 4 markets to the metros where dance music actually happens.
--
-- Deliberately not every state: ~35 of them would return an empty feed, and a
-- picker full of dead entries reads as broken. These are the US metros with a
-- real EDM/dance scene, grouped by state in the client so the picker still has
-- the state -> city shape.
--
-- `cities` matters in multi-metro states. Ingestion queries Ticketmaster by
-- stateCode, so without a city filter the Texas market would pull Austin,
-- Dallas and Houston into whichever row ran first. States with a single
-- dominant scene leave it NULL and take the whole state — which is exactly how
-- phoenix-tucson already picks up both cities.

INSERT INTO markets (slug, name, state, cities, is_active) VALUES
    -- California: three distinct scenes, so each is city-scoped.
    ('san-francisco', 'San Francisco', 'CA',
      ARRAY['San Francisco','Oakland','Berkeley','San Jose','Santa Clara','Mountain View'], true),
    ('san-diego', 'San Diego', 'CA',
      ARRAY['San Diego','Chula Vista','Del Mar','Oceanside'], true),

    -- Texas: three metros, all scoped.
    ('austin', 'Austin', 'TX', ARRAY['Austin','Round Rock','Cedar Park'], true),
    ('dallas', 'Dallas', 'TX', ARRAY['Dallas','Fort Worth','Irving','Arlington','Grand Prairie'], true),
    ('houston', 'Houston', 'TX', ARRAY['Houston','Sugar Land','The Woodlands'], true),

    -- Florida: Miami is the anchor, Orlando and Tampa are their own scenes.
    ('miami', 'Miami', 'FL',
      ARRAY['Miami','Miami Beach','Fort Lauderdale','Hollywood','Doral','Homestead'], true),
    ('orlando', 'Orlando', 'FL', ARRAY['Orlando','Kissimmee','Winter Park'], true),
    ('tampa', 'Tampa', 'FL', ARRAY['Tampa','St. Petersburg','Ybor City','Clearwater'], true),

    -- New York: the city, not the state.
    ('new-york-city', 'New York City', 'NY',
      ARRAY['New York','Brooklyn','Queens','Bronx','Manhattan'], true),

    -- Single-scene states: no city filter, take the state.
    ('chicago', 'Chicago', 'IL', NULL, true),
    ('seattle', 'Seattle', 'WA', NULL, true),
    ('portland', 'Portland', 'OR', NULL, true),
    ('atlanta', 'Atlanta', 'GA', NULL, true),
    ('detroit', 'Detroit', 'MI', NULL, true),
    ('boston', 'Boston', 'MA', NULL, true),
    ('philadelphia', 'Philadelphia', 'PA', NULL, true),
    ('washington-dc', 'Washington DC', 'DC', NULL, true),
    ('nashville', 'Nashville', 'TN', NULL, true),
    ('new-orleans', 'New Orleans', 'LA', NULL, true),
    ('salt-lake-city', 'Salt Lake City', 'UT', NULL, true),
    ('minneapolis', 'Minneapolis', 'MN', NULL, true),
    ('kansas-city', 'Kansas City', 'MO', NULL, true)
ON CONFLICT (slug) DO NOTHING;
