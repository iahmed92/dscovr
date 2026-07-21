// Resolves each artist's most recent Mixcloud set into artists.mixcloud_url.
//
// Why Mixcloud and not SoundCloud: SoundCloud closed public API registration
// years ago, which is why soundcloud_url was only ever a search link. Mixcloud's
// API is open and needs no key.
//
// Matching is deliberately strict — the artist's own *account* is resolved by
// normalized name, then their latest upload is taken. A title search returns
// something for everyone and is wrong about half the time (searching
// "Rich Dietz" surfaces a Dua Lipa cardio mix), and this project already learned
// what bad fuzzy matches cost when "Donk" resolved to Beyoncé. Expect ~29%
// coverage; the client falls back to a labelled YouTube search for the rest.
//
//   node mixcloud-sets.js

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { normalizeArtistName } from './spotify-vibe-check.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REQUEST_DELAY_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Mixcloud ${res.status} for ${url}`);
  return res.json();
}

// The artist's own account, or null. Same normalization as the Spotify matcher
// so "Ben UFO (UK)" and "Tycho DJ Set" resolve like they do there.
async function findAccount(name) {
  const url = `https://api.mixcloud.com/search/?q=${encodeURIComponent(name)}&type=user&limit=5`;
  const data = await getJson(url);
  const target = normalizeArtistName(name);
  const match = (data.data ?? []).find((u) => normalizeArtistName(u.name ?? '') === target);
  return match?.key ?? null;
}

async function latestSetUrl(accountKey) {
  const data = await getJson(`https://api.mixcloud.com${accountKey}cloudcasts/?limit=1`);
  return data.data?.[0]?.url ?? null;
}

async function main() {
  console.log('Resolving Mixcloud sets...');

  const { data: artists, error } = await supabase
    .from('artists')
    .select('id, name')
    .is('mixcloud_url', null);
  if (error) throw new Error(`Failed to load artists: ${error.message}`);

  console.log(`${artists.length} artist(s) without a Mixcloud set.`);
  let resolved = 0;

  for (const artist of artists) {
    try {
      const account = await findAccount(artist.name);
      if (account) {
        const url = await latestSetUrl(account);
        if (url) {
          const { error: updateError } = await supabase
            .from('artists')
            .update({ mixcloud_url: url })
            .eq('id', artist.id);
          if (updateError) throw new Error(updateError.message);
          resolved++;
          console.log(`  "${artist.name}" -> ${url}`);
        } else {
          console.log(`  "${artist.name}" -> account found, no uploads`);
        }
      }
    } catch (err) {
      console.warn(`  "${artist.name}" failed: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`Done. Resolved ${resolved}/${artists.length}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
