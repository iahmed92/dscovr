// Committed counterpart to the gitignored, auto-generated expo-env.d.ts.
// That file pulls in Expo's ambient types (CSS module and `@/global.css`
// side-effect import declarations, EXPO_PUBLIC_* env typing), but it isn't in
// git, so a fresh clone or CI has nothing to satisfy those imports and tsc
// fails. This reference restores them without committing Expo's managed file.
/// <reference types="expo/types" />
