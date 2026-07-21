import { Redirect, useLocalSearchParams } from 'expo-router';

// Short share route: dscovr.live/e/123?invited_by=<uuid>
//
// Exists so an invite link is short enough to paste into a text message. It
// records nothing itself — it forwards to the canonical event screen, carrying
// the referrer through so the destination can act on it. Keeping the redirect
// dumb means a malformed or spoofed invited_by can't do anything here.
export default function ShareRedirect() {
  const { id, invited_by: invitedBy } = useLocalSearchParams<{
    id: string;
    invited_by?: string;
  }>();

  return (
    <Redirect
      href={{
        pathname: '/event/[id]',
        params: invitedBy ? { id: String(id), invited_by: String(invitedBy) } : { id: String(id) },
      }}
    />
  );
}
