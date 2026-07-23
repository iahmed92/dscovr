// Unit test for the Spotify retry policy. Runs the real source directly via
// Node's type stripping:
//
//   node --experimental-strip-types src/lib/spotify-retry.test.mts
//
// (also wired as `npm run test:retry` in mobile/package.json)
//
// Worth testing because the branch that matters — a 429 under load — is the one
// that's hardest to reproduce by hand, and getting it wrong means either
// hammering Spotify or freezing the connect button.
import { MAX_WAIT_MS, retryDelayMs, spotifyErrorMessage } from './spotify-retry.ts';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

console.log('--- retryDelayMs: what is retryable ---');
check('a bad token (401) is not retried', retryDelayMs(401, null, 1) === null);
check('a 403 is not retried', retryDelayMs(403, null, 1) === null);
check('a 400 is not retried', retryDelayMs(400, null, 1) === null);
check('a 429 is retried', retryDelayMs(429, null, 1) !== null);
check('a 500 is retried', retryDelayMs(500, null, 1) !== null);
check('a 503 is retried', retryDelayMs(503, null, 1) !== null);

console.log('\n--- retryDelayMs: Retry-After is honored, within reason ---');
check('honors a short Retry-After (2s → 2000ms)', retryDelayMs(429, '2', 1) === 2000);
check('honors Retry-After 0', retryDelayMs(429, '0', 1) === 0);
check('gives up when Retry-After is too long to block on',
  retryDelayMs(429, '30', 1) === null, String(retryDelayMs(429, '30', 1)));
check('ignores a garbage Retry-After and falls back to backoff',
  retryDelayMs(429, 'soon', 1) === 500, String(retryDelayMs(429, 'soon', 1)));

console.log('\n--- retryDelayMs: backoff + attempt cap ---');
check('first backoff is 500ms', retryDelayMs(500, null, 1) === 500);
check('second backoff is 1000ms', retryDelayMs(500, null, 2) === 1000);
check('stops after the attempt cap', retryDelayMs(429, null, 3) === null);
check('never waits longer than the cap', (retryDelayMs(500, null, 2) ?? 0) <= MAX_WAIT_MS);

console.log('\n--- spotifyErrorMessage ---');
check('429 message mentions trying again', /again/i.test(spotifyErrorMessage(429)));
check('401 message names authorization', /authoriz/i.test(spotifyErrorMessage(401)));
check('unknown status still gives a usable message', spotifyErrorMessage(502).length > 0);

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures ? 1 : 0);
