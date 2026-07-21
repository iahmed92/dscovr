// Unit test for share-link construction. Runs the real source directly via
// Node's type stripping:
//
//   node --experimental-strip-types src/lib/share-links.test.mts
//
// (also wired as `npm run test:share` in mobile/package.json)
//
// Worth testing because these URLs are only ever exercised on a real phone,
// where a silently-dropped message body looks like "the button did nothing".
import { eventShareUrl, inviteMessage, smsInviteUrl } from './share-links.ts';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

console.log('--- eventShareUrl ---');
check('signed in carries the referrer',
  eventShareUrl(42, 'abc-123') === 'https://www.dscovr.live/e/42?invited_by=abc-123',
  eventShareUrl(42, 'abc-123'));
check('signed out still produces a working link',
  eventShareUrl(42, null) === 'https://www.dscovr.live/e/42',
  eventShareUrl(42, null));
check('referrer is escaped', !eventShareUrl(42, 'a&b=c').includes('a&b=c'),
  eventShareUrl(42, 'a&b=c'));

console.log('\n--- smsInviteUrl ---');
// The separator differs per platform and getting it wrong drops the body.
check('android uses ?body=', smsInviteUrl('hi', false) === 'sms:?body=hi', smsInviteUrl('hi', false));
check('ios uses &body=', smsInviteUrl('hi', true) === 'sms:&body=hi', smsInviteUrl('hi', true));
check('no recipient is prefilled',
  !smsInviteUrl('hi', false).includes('sms:1') && smsInviteUrl('hi', false).startsWith('sms:?'));

// An unescaped & or # ends the body early, silently truncating the invite.
const tricky = smsInviteUrl('Beats & Bass #1 https://www.dscovr.live/e/7?invited_by=x', false);
check('ampersand in the message is escaped', !tricky.slice(5).includes('&'), tricky);
check('hash in the message is escaped', !tricky.includes('#'), tricky);
check('the link survives encoding', decodeURIComponent(tricky).includes('/e/7?invited_by=x'), tricky);

console.log('\n--- inviteMessage ---');
const msg = inviteMessage('Gareth Emery', eventShareUrl(7, 'u1'));
check('names the event', msg.startsWith('Gareth Emery'), msg);
check('ends with the link', msg.endsWith('https://www.dscovr.live/e/7?invited_by=u1'), msg);
// SMS segments at 160 GSM-7 chars; longer just costs the sender an extra
// segment, but a bloated invite reads as spam.
check('stays inside one SMS segment for a typical title', msg.length <= 160, `len=${msg.length}`);

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures ? 1 : 0);
