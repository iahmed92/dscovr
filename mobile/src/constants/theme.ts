/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Luma-inspired dark palette: near-black canvas, a single step up for cards,
// crisp off-white text, muted gray for secondary. `border` is the hairline that
// replaces shadows and heavy borders throughout. The app is pinned to dark (see
// use-theme.ts), so `light` is kept only to satisfy the type — it mirrors the
// same tokens for the day someone re-enables theme switching.
export const Colors = {
  light: {
    text: '#111111',
    background: '#ffffff',
    backgroundElement: '#F7F7F8',
    backgroundSelected: '#ECECEE',
    textSecondary: '#6B6B6B',
    border: 'rgba(0, 0, 0, 0.08)',
  },
  dark: {
    text: '#EDEDED',
    background: '#0A0A0A',
    backgroundElement: '#141414',
    backgroundSelected: '#1F1F1F',
    textSecondary: '#8F8F8F',
    border: 'rgba(255, 255, 255, 0.08)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
