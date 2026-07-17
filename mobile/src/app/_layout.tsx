import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/hooks/use-auth';
import { NowPlayingProvider } from '@/hooks/use-now-playing';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = useTheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
          </Stack>
        </NowPlayingProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
