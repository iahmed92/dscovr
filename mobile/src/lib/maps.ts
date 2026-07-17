import { Venue } from '@/lib/types';

// Google's universal maps link works everywhere via Linking.openURL — opens
// the native Maps app on iOS/Android if installed, falls back to the web on
// desktop/browser. Simpler and more reliable than juggling maps:// (iOS)
// vs geo: (Android) URI schemes for an MVP.
export function mapsUrl(venue: Venue): string | null {
  if (venue.latitude !== null && venue.longitude !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`;
  }

  const query = [venue.address, venue.city].filter(Boolean).join(', ') || venue.name;
  if (!query) return null;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
