// Unit test for the taste-mapping logic. Runs the real source directly via
// Node's type stripping:
//
//   node --experimental-strip-types src/lib/spotify-taste.test.mts
//
// (also wired as `npm run test:taste` in mobile/package.json)
import { buildTasteProfile, normalizeArtistName, type SpotifyArtist } from './spotify-taste.ts';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

console.log('--- normalizeArtistName ---');
// Same decoration-stripping the pipeline relies on.
check('strips (UK) region tag', normalizeArtistName('Ben UFO (UK)') === normalizeArtistName('Ben UFO'));
check('strips DJ Set billing', normalizeArtistName('Tycho DJ Set') === normalizeArtistName('Tycho'));
check('strips leading The', normalizeArtistName('The Crystal Method') === normalizeArtistName('Crystal Method'));
check('folds diacritics', normalizeArtistName('Felix Mün') === normalizeArtistName('Felix Mun'));
check('& becomes and', normalizeArtistName('Above & Beyond') === normalizeArtistName('Above and Beyond'));
check('distinct artists stay distinct', normalizeArtistName('Kacey') !== normalizeArtistName('Kacey Musgraves'));

console.log('\n--- buildTasteProfile ---');
const roster = new Map<string, number>([
  [normalizeArtistName('Dirt Monkey'), 42],
  [normalizeArtistName('Tycho'), 7],
  // Note: "Kaskade" is on our roster; the user's top artists include it.
  [normalizeArtistName('Kaskade'), 99],
]);

const top: SpotifyArtist[] = [
  { id: 's1', name: 'Dirt Monkey', genres: ['dubstep', 'riddim'] },
  { id: 's2', name: 'Tycho DJ Set', genres: ['chillwave', 'downtempo'] }, // billing suffix
  { id: 's3', name: 'Kaskade', genres: ['progressive house', 'edm'] },
  { id: 's4', name: 'Some Local DJ', genres: ['dubstep'] }, // not on roster
  { id: 's5', name: 'No Genre Artist', genres: [] }, // contributes nothing
];

const profile = buildTasteProfile(top, roster);

check('matches roster artists by normalized name (Dirt Monkey, Tycho, Kaskade)',
  [42, 7, 99].every((id) => profile.favoriteArtistIds.includes(id)),
  JSON.stringify(profile.favoriteArtistIds));
check('does not invent ids for unmatched artists', profile.favoriteArtistIds.length === 3);
check('reports the unmatched artist', profile.unmatchedArtistNames.includes('Some Local DJ'));
check('matches through the DJ Set suffix', profile.favoriteArtistIds.includes(7));

const dubstep = profile.favoriteGenres.find((g) => g.genre === 'dubstep');
check('genre affinity is frequency across top artists (dubstep played by 2)',
  dubstep?.affinity_score === 2, JSON.stringify(dubstep));
check('single-artist genre has affinity 1',
  profile.favoriteGenres.find((g) => g.genre === 'riddim')?.affinity_score === 1);
check('genres are sorted by affinity desc', profile.favoriteGenres[0].genre === 'dubstep',
  JSON.stringify(profile.favoriteGenres.map((g) => g.genre)));
check('empty genre list contributes nothing', !profile.favoriteGenres.some((g) => g.genre === ''));

console.log('\n--- edge cases ---');
const empty = buildTasteProfile([], new Map());
check('empty input yields empty profile',
  empty.favoriteGenres.length === 0 && empty.favoriteArtistIds.length === 0);

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures ? 1 : 0);
