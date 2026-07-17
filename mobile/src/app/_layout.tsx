import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/hooks/use-auth';
import { NowPlayingProvider } from '@/hooks/use-now-playing';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();

  // Pinned to dark to match the app's committed Luma aesthetic (see use-theme).
  return (
    <ThemeProvider value={DarkTheme}>
      <AuthProvider>
        <NowPlayingProvider>
          <AnimatedSplashOverlay />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.background },
              headerTintColor: theme.text,
              headerShadowVisible: false,
            }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="event/[id]"
              options={{ title: '', headerBackTitle: 'Back', presentation: 'card' }}
            />
            <Stack.Screen
              name="sign-in"
              options={{ title: 'Sign in', presentation: 'modal' }}
            />
            <Stack.Screen
              name="for-you"
              options={{ title: 'For you', headerBackTitle: 'Back' }}
            />
            <Stack.Screen name="spotify-callback" options={{ headerShown: false }} />
            <Stack.Screen name="friends" options={{ title: 'Friends', headerBackTitle: 'Back' }} />
          </Stack>
        </NowPlayingProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
