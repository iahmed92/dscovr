import { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

type AuthResult = { error: string | null };

// Where the confirmation email link sends a user after they verify. Supabase's
// default is the project's Site URL, which ships as localhost:3000 — so without
// this a real user's confirmation link drops them on a dead localhost page
// instead of the app. We send them to the account tab, signed in.
//
// On web we use the current origin, so a link created from localhost during dev
// returns to localhost and one from dscovr.live returns to dscovr.live. Native
// has no origin, so it falls back to production. Every origin used here must be
// listed in Supabase Auth's Redirect URLs allowlist, or Supabase ignores it and
// falls back to the Site URL.
const PROD_ORIGIN = 'https://www.dscovr.live';
function emailRedirectUrl(): string {
  const origin =
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : PROD_ORIGIN;
  return `${origin}/explore`;
}

type AuthState = {
  session: Session | null;
  // Convenience — every caller that wants the id would otherwise reach through
  // session?.user?.id and re-null-check.
  userId: string | null;
  // True only until the initial getSession resolves. Gates redirects so a
  // signed-in user isn't flashed the sign-in screen on cold start while the
  // persisted session is still loading from storage.
  initializing: boolean;
  signUp: (email: string, password: string, username: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;

    // Load the persisted session once on mount...
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
    });

    // ...then let the listener own every subsequent change (sign in/out, token
    // refresh, another tab signing out). Its first synchronous callback and the
    // getSession above can race, but both write the same value, so last-write
    // wins harmlessly.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      userId: session?.user?.id ?? null,
      initializing,
      async signUp(email, password, username) {
        // username rides along as user metadata; the provisioning trigger reads
        // raw_user_meta_data->>'username' and prefers it over the email prefix.
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: username.trim() },
            emailRedirectTo: emailRedirectUrl(),
          },
        });
        return { error: error?.message ?? null };
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message ?? null };
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, initializing]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
