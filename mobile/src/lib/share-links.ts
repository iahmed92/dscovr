// Building the links people send each other.
//
// Kept pure and platform-free so the URL rules can be unit-tested without a
// device — see share-links.test.mts. Nothing here touches Platform or window;
// callers pass in what they know.

// Public origin for share links. Native has no window.location, and a link
// built from localhost is useless in a text message, so the production host is
// hardcoded rather than inferred.
export const SHARE_ORIGIN = 'https://www.dscovr.live';

/** The short referral link for an event, carrying the referrer when signed in. */
export function eventShareUrl(eventId: number, userId: string | null): string {
  const base = `${SHARE_ORIGIN}/e/${eventId}`;
  return userId ? `${base}?invited_by=${encodeURIComponent(userId)}` : base;
}

/**
 * An `sms:` link that opens the sender's own messaging app with the invite
 * pre-typed and no recipient, so they pick who to text.
 *
 * This is the whole reason we don't need an SMS provider: the message is sent
 * by the user's phone on their own plan, from their own number. It costs us
 * nothing, and a text from a friend's real number gets opened where a shortcode
 * from an unknown sender does not.
 *
 * The separator is the trap. Android follows RFC 5724 and wants `?body=`;
 * iOS parses `&body=` and drops the body entirely when given `?`. There is no
 * spelling that works on both, so the platform has to be passed in.
 */
export function smsInviteUrl(message: string, isIOS: boolean): string {
  // encodeURIComponent leaves ' unescaped, which is fine in a query value, but
  // & and # would truncate the body at the messaging app.
  return `sms:${isIOS ? '&' : '?'}body=${encodeURIComponent(message)}`;
}

/** The text of the invite itself. Short — it's going into a text message. */
export function inviteMessage(eventTitle: string, url: string): string {
  return `${eventTitle} — who's coming? ${url}`;
}
