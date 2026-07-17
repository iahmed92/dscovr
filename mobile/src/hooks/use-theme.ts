/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';

// Pinned to dark: the Luma look is inherently a dark, minimalist-luxury
// aesthetic, so the app commits to it rather than following the device setting.
// To restore automatic light/dark switching, return Colors[useColorScheme()]
// (guarding 'unspecified') as before.
export function useTheme() {
  return Colors.dark;
}
