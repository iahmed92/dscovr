import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

type Mode = 'sign_in' | 'sign_up';

export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignUp = mode === 'sign_up';

  async function submit() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);

    const { error: authError } = isSignUp
      ? await signUp(trimmedEmail, password)
      : await signIn(trimmedEmail, password);

    setSubmitting(false);

    if (authError) {
      setError(authError);
      return;
    }

    // With email confirmation enabled, signUp returns no session — the user has
    // to confirm first, so closing the modal would drop them back out still
    // signed out and confused. Tell them to check their mail instead. Sign in
    // (and sign up with confirmation disabled) yields a session immediately and
    // the auth listener flips state, so just dismiss.
    if (isSignUp) {
      setNotice('Check your email to confirm your account, then sign in.');
      setMode('sign_in');
      setPassword('');
      return;
    }

    router.back();
  }

  return (
    <ThemedView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <View style={styles.body}>
            <ThemedText type="subtitle">{isSignUp ? 'Create account' : 'Welcome back'}</ThemedText>
            <ThemedText themeColor="textSecondary">
              {isSignUp
                ? 'Save shows to your rave resume and get picks tuned to your taste.'
                : 'Sign in to track the shows you’re hitting.'}
            </ThemedText>

            <View style={styles.fields}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                secureTextEntry
                onSubmitEditing={submit}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </View>

            {error && (
              <ThemedText type="small" style={{ color: '#FF3B7F' }}>
                {error}
              </ThemedText>
            )}
            {notice && (
              <ThemedText type="small" themeColor="textSecondary">
                {notice}
              </ThemedText>
            )}

            <TouchableOpacity
              onPress={submit}
              disabled={submitting}
              style={[styles.submit, { backgroundColor: theme.text, opacity: submitting ? 0.6 : 1 }]}>
              {submitting ? (
                <ActivityIndicator color={theme.background} />
              ) : (
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  {isSignUp ? 'Create account' : 'Sign in'}
                </ThemedText>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setMode(isSignUp ? 'sign_in' : 'sign_up');
                setError(null);
                setNotice(null);
              }}
              style={styles.switchMode}>
              <ThemedText type="small" themeColor="textSecondary">
                {isSignUp ? 'Already have an account? ' : 'New here? '}
                <ThemedText type="smallBold">{isSignUp ? 'Sign in' : 'Create one'}</ThemedText>
              </ThemedText>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  body: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    justifyContent: 'center',
  },
  fields: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  submit: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  switchMode: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
});
