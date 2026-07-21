import { makeRedirectUri } from 'expo-auth-session';
import { Platform } from 'react-native';

// Only the client ID reaches the app — PKCE needs no secret, so the secret in
// the root .env stays with the pipeline and never enters the bundle.
export const SPOTIFY_CLIENT_ID = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID;

// Read-only: the top artists that build the taste profile. Nothing here writes
// to the user's Spotify.
export const SPOTIFY_SCOPES = ['user-top-read'];

export const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

// Native resolves to dscovr://spotify-callback (the app's scheme); web resolves
// to <origin>/spotify-callback. Whatever this returns must be registered
// verbatim in the Spotify dashboard, so the connect screen also surfaces it.
export function spotifyRedirectUri(): string {
  return makeRedirectUri({ scheme: 'dscovr', path: 'spotify-callback' });
}

/**
 * Whether PKCE can be performed here at all.
 *
 * The code challenge is a SHA-256, which on web means WebCrypto — and browsers
 * only expose `crypto.subtle` on a secure origin (https, or localhost). Over
 * plain http on a LAN address it is simply absent, and expo-auth-session
 * hashes during render, so an unguarded useAuthRequest throws before the
 * screen paints and takes the whole account tab down with it.
 *
 * Native always has it. This is a web-only hazard, and it shows up the moment
 * anyone opens the dev server from their phone via http://192.168.x.x.
 */
export function canUsePKCE(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}
