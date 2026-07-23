// Retry policy for the one Spotify API call the app makes (the top-artists
// import at connect time).
//
// Spotify's rate limit is per-app in a rolling 30-second window, so the risk
// isn't the number of linked users — a linked user makes no ongoing calls — but
// an onboarding spike: many people connecting at once. Without a policy, the
// first thing a rate limit does is turn a wave of new users' connects into a
// wave of raw errors.
//
// The decision is kept pure and separate from the fetch so it can be unit
// tested (see spotify-retry.test.mts) — a live 429 is hard to reproduce.

export const MAX_ATTEMPTS = 3;
// A connect is a foreground action; we won't freeze the UI waiting on a long
// server-suggested backoff. If Spotify asks for longer than this, we stop and
// tell the user to try again shortly instead of hanging.
export const MAX_WAIT_MS = 4000;

/**
 * How long to wait before retrying a failed Spotify request, or null to stop
 * (out of attempts, not retryable, or the wait would be too long to block on).
 *
 * @param status       HTTP status of the failed response
 * @param retryAfter   value of the Retry-After header, if any (seconds)
 * @param attempt      how many attempts have been made so far (1 = just failed once)
 */
export function retryDelayMs(status: number, retryAfter: string | null, attempt: number): number | null {
  if (attempt >= MAX_ATTEMPTS) return null;

  const rateLimited = status === 429;
  const transient = status >= 500 && status < 600;
  // 4xx other than 429 (a bad or expired token, a bad request) won't fix itself
  // on retry — fail fast.
  if (!rateLimited && !transient) return null;

  if (rateLimited && retryAfter != null) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) {
      const ms = secs * 1000;
      return ms <= MAX_WAIT_MS ? ms : null;
    }
  }

  // Exponential backoff when the server didn't tell us how long: 500ms, 1000ms.
  return Math.min(500 * 2 ** (attempt - 1), MAX_WAIT_MS);
}

/** A message worth showing the user for a Spotify failure we gave up on. */
export function spotifyErrorMessage(status: number): string {
  if (status === 429) return 'Spotify is busy right now — try connecting again in a moment.';
  if (status === 401 || status === 403) return 'Spotify authorization failed — try connecting again.';
  return `Couldn’t reach Spotify (${status}). Try again in a moment.`;
}
