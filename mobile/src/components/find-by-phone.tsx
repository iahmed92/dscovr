import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ContactMatch, splitNumbers, useContacts } from '@/hooks/use-contacts';
import { SendResult } from '@/hooks/use-friends';
import { useTheme } from '@/hooks/use-theme';

type AddState = 'idle' | 'sending' | 'sent' | 'friends' | 'error';

/**
 * Find friends by phone number.
 *
 * On the web there is no contacts API, so this is the honest version of contact
 * matching: paste the numbers you have and see who's already on DSCOVR. The
 * heavy lifting — normalizing formats, the enumeration guards — lives in
 * get_contacts_on_dscovr; this is just the surface.
 *
 * Matching is gated on the caller having their own number on file (both by the
 * RPC and here), which is also what lets other people find *them* — so the
 * "add your number" step isn't busywork, it's the reciprocal half of the
 * feature.
 */
export function FindByPhone({
  sendRequest,
}: {
  sendRequest: (username: string) => Promise<{ result: SendResult | null; error: string | null }>;
}) {
  const theme = useTheme();
  const { hasPhone, savePhone, findContacts } = useContacts();

  const [phone, setPhone] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);

  const [blob, setBlob] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [matches, setMatches] = useState<ContactMatch[]>([]);
  const [addState, setAddState] = useState<Record<string, AddState>>({});

  async function onSavePhone() {
    setSavingPhone(true);
    setPhoneMsg(null);
    const err = await savePhone(phone);
    setSavingPhone(false);
    if (err) {
      setPhoneMsg(err);
    } else {
      setPhoneMsg('Saved — friends who have your number can find you now.');
      setPhone('');
    }
  }

  async function onSearch() {
    const numbers = splitNumbers(blob);
    if (numbers.length === 0) return;
    setSearching(true);
    setSearchMsg(null);
    setMatches([]);
    const { matches: found, error } = await findContacts(numbers);
    setSearching(false);
    if (error) {
      setSearchMsg(error);
      return;
    }
    setMatches(found);
    setSearchMsg(
      found.length === 0
        ? `No matches among ${numbers.length} number${numbers.length === 1 ? '' : 's'} yet.`
        : null
    );
  }

  async function onAdd(match: ContactMatch) {
    if (!match.username) return;
    setAddState((s) => ({ ...s, [match.id]: 'sending' }));
    const { result, error } = await sendRequest(match.username);
    setAddState((s) => ({
      ...s,
      [match.id]: error
        ? 'error'
        : result === 'accepted' || result === 'already_friends'
          ? 'friends'
          : 'sent',
    }));
  }

  return (
    <View style={styles.container}>
      <ThemedText style={styles.sectionLabel} themeColor="textSecondary">
        FIND FRIENDS BY PHONE
      </ThemedText>

      {/* Your own number — the reciprocal half. */}
      {hasPhone ? (
        <ThemedText type="small" themeColor="textSecondary">
          Your number is saved. Friends who have it can find you.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Add your number so friends can find you — and to search for theirs.
          </ThemedText>
          <View style={styles.row}>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="Your phone number"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              autoComplete="tel"
              onSubmitEditing={onSavePhone}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <TouchableOpacity
              onPress={onSavePhone}
              disabled={savingPhone || !phone.trim()}
              accessibilityRole="button"
              accessibilityLabel="Save your phone number"
              style={[styles.button, { backgroundColor: theme.text, opacity: savingPhone || !phone.trim() ? 0.5 : 1 }]}>
              {savingPhone ? (
                <ActivityIndicator color={theme.background} size="small" />
              ) : (
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  Save
                </ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
      {phoneMsg && (
        <ThemedText type="small" themeColor="textSecondary">
          {phoneMsg}
        </ThemedText>
      )}

      {/* Search — paste numbers, see who's here. */}
      <TextInput
        value={blob}
        onChangeText={setBlob}
        placeholder="Paste phone numbers to check (one per line)"
        placeholderTextColor={theme.textSecondary}
        multiline
        keyboardType="phone-pad"
        style={[
          styles.input,
          styles.multiline,
          { color: theme.text, backgroundColor: theme.backgroundElement },
        ]}
      />
      <TouchableOpacity
        onPress={onSearch}
        disabled={searching || blob.trim().length === 0}
        accessibilityRole="button"
        accessibilityLabel="Find contacts on DSCOVR"
        style={[
          styles.searchButton,
          { borderColor: theme.border, opacity: searching || blob.trim().length === 0 ? 0.5 : 1 },
        ]}>
        {searching ? (
          <ActivityIndicator size="small" />
        ) : (
          <ThemedText type="smallBold">Find contacts</ThemedText>
        )}
      </TouchableOpacity>

      {searchMsg && (
        <ThemedText type="small" themeColor="textSecondary">
          {searchMsg}
        </ThemedText>
      )}

      {matches.map((m) => {
        const state = addState[m.id] ?? 'idle';
        return (
          <View key={m.id} style={styles.matchRow}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {(m.username ?? '?').charAt(0).toUpperCase()}
              </ThemedText>
            </View>
            <ThemedText type="default" style={styles.matchName} numberOfLines={1}>
              {m.username ?? '—'}
            </ThemedText>
            {state === 'sent' || state === 'friends' ? (
              <ThemedText type="small" themeColor="textSecondary">
                {state === 'friends' ? 'Friends' : 'Requested'}
              </ThemedText>
            ) : (
              <TouchableOpacity
                onPress={() => onAdd(m)}
                disabled={state === 'sending'}
                accessibilityRole="button"
                accessibilityLabel={`Add ${m.username}`}
                style={[styles.pill, { backgroundColor: theme.text, opacity: state === 'sending' ? 0.5 : 1 }]}>
                {state === 'sending' ? (
                  <ActivityIndicator color={theme.background} size="small" />
                ) : (
                  <ThemedText type="small" style={{ color: theme.background }}>
                    {state === 'error' ? 'Retry' : 'Add'}
                  </ThemedText>
                )}
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  sectionLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  button: {
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  searchButton: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    alignItems: 'center',
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchName: {
    flex: 1,
  },
  pill: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
});
