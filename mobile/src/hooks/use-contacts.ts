import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/lib/supabase';

export type ContactMatch = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

// Splits a pasted blob of numbers into individual entries. People paste from
// Notes or a group text, so newlines, commas and semicolons all separate. Each
// entry is normalized server-side by normalize_phone, so we keep the raw text
// and only drop anything with no digits at all.
export function splitNumbers(blob: string): string[] {
  return blob
    .split(/[\n,;]+/)
    .map((n) => n.trim())
    .filter((n) => /\d/.test(n));
}

// At least 10 digits, matching normalize_phone's RIGHT(...,10). Anything
// shorter can't be a US number and would save junk that never matches.
export function looksLikePhone(raw: string): boolean {
  return (raw.match(/\d/g) ?? []).length >= 10;
}

// Phone-based friend finding, over the RPCs from 0018/0019.
//
// The owner can't read their own number back (SELECT on profiles.phone is
// revoked), so "do I have a phone on file" comes from current_user_has_phone,
// a boolean that never exposes the value.
export function useContacts() {
  const { userId } = useAuth();
  const [hasPhone, setHasPhone] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    if (userId === null) {
      setHasPhone(null);
      return;
    }
    const { data } = await supabase.rpc('current_user_has_phone');
    setHasPhone(data === true);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Store the caller's own number so others can find them. Returns an error
  // string or null.
  const savePhone = useCallback(
    async (raw: string): Promise<string | null> => {
      if (userId === null) return 'Sign in first.';
      if (!looksLikePhone(raw)) return 'Enter a full phone number.';
      const { error } = await supabase.from('profiles').update({ phone: raw.trim() }).eq('id', userId);
      if (error) return error.message;
      await reload();
      return null;
    },
    [userId, reload]
  );

  // Look up which of the given numbers belong to DSCOVR users. The RPC caps the
  // batch and refuses a caller with no phone of their own, so this surfaces that
  // as a friendly message rather than a raw Postgres error.
  const findContacts = useCallback(
    async (numbers: string[]): Promise<{ matches: ContactMatch[]; error: string | null }> => {
      if (numbers.length === 0) return { matches: [], error: null };
      const { data, error } = await supabase.rpc('get_contacts_on_dscovr', { phone_numbers: numbers });
      if (error) {
        const msg = /add a phone number/i.test(error.message)
          ? 'Add your own number first so matching is allowed.'
          : /too many/i.test(error.message)
            ? 'That’s too many numbers at once (max 500).'
            : error.message;
        return { matches: [], error: msg };
      }
      return { matches: (data ?? []) as ContactMatch[], error: null };
    },
    []
  );

  return { hasPhone, savePhone, findContacts, reload };
}
