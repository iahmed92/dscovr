// Username rules for sign-up.
//
// The provisioning trigger (migration 0006) already uniquifies collisions as a
// backstop, so nothing here is load-bearing for data integrity. It exists so a
// person picks their own handle and gets a clear error up front — instead of
// silently being handed `alice1` because `alice` was taken, or having their
// email address quietly become their public username.
//
// Kept pure so it can be unit-tested and reused.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Returns an error message, or null if the name is well-formed. */
export function validateUsername(raw: string): string | null {
  const name = raw.trim();
  if (name.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `Username must be ${USERNAME_MAX} characters or fewer.`;
  // Letters, numbers, underscore — no spaces, no @, so it never looks like an
  // email and is safe in a share URL or an @mention later.
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return 'Use only letters, numbers, and underscores.';
  }
  return null;
}
