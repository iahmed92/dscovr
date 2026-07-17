import { makeRedirectUri } from 'expo-auth-session';

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
