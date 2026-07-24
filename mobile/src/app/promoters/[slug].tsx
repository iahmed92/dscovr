import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { usePromoter } from '@/hooks/use-promoter';
import { useTheme } from '@/hooks/use-theme';
import { formatEventDate, formatEventTime } from '@/lib/format-date';
import { recordPromoterView } from '@/lib/promoter-tracking';

// No dedicated business inbox exists yet — this is the one real, working
// address in the project (the operator's own). Swap for a real
// partnerships/support address before this page goes out in real outreach;
// tracked as a known placeholder, not a guess dressed up as infrastructure.
const CONTACT_EMAIL = process.env.EXPO_PUBLIC_CONTACT_EMAIL ?? 'isahmed92@gmail.com';

export default function PromoterProfileScreen() {
  const { slug, ref: outreachRef } = useLocalSearchParams<{ slug: string; ref?: string }>();
  const theme = useTheme();

  const { promoter, events, market, loading, error } = usePromoter(slug ?? null);

  // Exactly one view per mount of an actual, visible promoter (criterion 4) —
  // guarded by a ref rather than a dependency array, so a re-render from
  // unrelated state changes (theme, etc.) can never fire a second insert for
  // the same visit.
  const recorded = useRef(false);
  useEffect(() => {
    if (promoter && !recorded.current) {
      recorded.current = true;
      recordPromoterView(promoter.id, outreachRef ?? null);
    }
  }, [promoter, outreachRef]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  // KNOWN, ACCEPTED LIMITATION — read before "fixing" this:
  //
  // A real per-URL HTTP 404 is not achievable in this app's current rendering
  // mode. Checked at the source, not assumed: web.output is "static" in
  // app.json, and grepping expo-router's actual export pipelines
  // (internal/static.js, the static web exporter, and rsc/exports.js, the
  // server/RSC pipeline) for generateStaticParams / loader / generateMetadata
  // — the route-level hooks that WOULD make build-time-per-param rendering or
  // a real 404 possible — returns zero matches in either. Those names exist
  // only as forward-declared TYPES on expo-router's Route shape in this
  // version; nothing in the actual build consumes them. Confirmed empirically
  // too: curling a live dynamic route today returns HTTP 200 with an empty
  // shell for ANY param, valid or not — every dynamic route in this app
  // already works this way, not just this one.
  //
  // So this is the deliberate fallback, not an oversight: check status
  // CLIENT-SIDE and render a visible, honest not-found message once the data
  // resolves, rather than a silent blank or broken shell. `promoter.status`
  // is checked explicitly below even though RLS should already make a draft
  // row unreachable (the query returns no row at all) — this is defense in
  // depth, not the primary mechanism: if a future migration ever loosens the
  // RLS policy or the column grant by accident, this check still catches it
  // instead of quietly rendering draft data.
  //
  // Real, standing consequences of this limitation — not bugs, don't
  // "fix" them by reaching for a build-time static-page generator without a
  // deliberate decision to change rendering mode first:
  //   1. `curl` and any non-JS-executing crawler still see HTTP 200 + an
  //      empty shell for a draft or nonexistent slug — the check below only
  //      ever runs after JS hydrates.
  //   2. The exact same fact cuts the other way for PUBLISHED pages too:
  //      iMessage, WhatsApp, Slack and similar link-preview fetchers also
  //      don't execute JS, so a promoter link texted to someone previews as a
  //      generic shell — not their name or events — even though the page is
  //      genuinely live. This is the same non-JS-fetcher reality that
  //      promoter-tracking.ts's ua_class classification exists to detect on
  //      the way IN; here it's the same fact biting on the way OUT. If this
  //      makes the "promoter's own page as a sales text" pitch feel flatter
  //      than expected once real links go out, the fix is adopting an
  //      SSR-capable rendering mode — a deliberate infra decision to make on
  //      its own terms, not a patch to back into from here.
  if (error || !promoter || (promoter.status !== 'published' && promoter.status !== 'claimed')) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="textSecondary">
          {error ?? "This page doesn't exist."}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.body}>
            <ThemedText style={styles.title}>{promoter.ingested_name}</ThemedText>
            {market && (
              <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>{market.name}</ThemedText>
            )}

            {/* Honest and unambiguous, per the brief — no "unclaimed" language
                on a profile that's already been claimed. */}
            {promoter.status === 'published' && (
              <View style={[styles.claimBanner, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText type="smallBold">This profile hasn&apos;t been claimed yet</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.claimCopy}>
                  These are {promoter.ingested_name}&apos;s events, aggregated automatically. If this is
                  your brand, claim it to add your own details.
                </ThemedText>
                <TouchableOpacity
                  onPress={() =>
                    Linking.openURL(
                      `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Claiming ${promoter.ingested_name} on DSCOVR`)}`
                    )
                  }
                  style={[styles.claimButton, { backgroundColor: theme.text }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    Is this you? Claim this profile
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.eventsSection}>
              <ThemedText style={styles.sectionHeading}>Upcoming events</ThemedText>
              {events.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No upcoming events right now.
                </ThemedText>
              ) : (
                events.map((event) => (
                  <Link key={event.id} href={`/event/${event.id}`} asChild>
                    <TouchableOpacity
                      style={[styles.eventRow, { borderColor: theme.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${event.title}`}>
                      <ThemedText type="default" numberOfLines={1}>
                        {event.title}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatEventDate(event.event_date)}
                        {event.doors_time ? ` · ${formatEventTime(event.doors_time)}` : ''}
                        {event.venues?.name ? ` · ${event.venues.name}` : ''}
                      </ThemedText>
                      {event.ticket_url && (
                        <ThemedText type="small" style={styles.ticketLink}>
                          Get Tickets ↗
                        </ThemedText>
                      )}
                    </TouchableOpacity>
                  </Link>
                ))
              )}
            </View>
          </View>

          <View style={[styles.footer, { borderColor: theme.border }]}>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(
                  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Remove ${promoter.ingested_name} from DSCOVR`)}`
                )
              }>
              <ThemedText type="small" themeColor="textSecondary">
                Request removal
              </ThemedText>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  content: {
    paddingBottom: Spacing.six,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  title: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
  },
  claimBanner: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    gap: Spacing.one,
  },
  claimCopy: {
    lineHeight: 18,
  },
  claimButton: {
    marginTop: Spacing.one,
    paddingVertical: Spacing.two + 2,
    borderRadius: 12,
    alignItems: 'center',
  },
  eventsSection: {
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
  sectionHeading: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  eventRow: {
    padding: Spacing.three - 2,
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
  },
  ticketLink: {
    color: '#FF3B7F',
    fontWeight: '500',
    marginTop: 2,
  },
  footer: {
    marginTop: Spacing.four,
    marginHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    alignItems: 'center',
  },
});
