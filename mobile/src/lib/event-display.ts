import { Artist, LineupSlot } from '@/lib/types';

const SOURCE_LABEL: Record<string, string> = {
  ticketmaster: 'Ticketmaster',
  relentless_beats: 'Relentless Beats',
  resident_advisor: 'Resident Advisor',
  curated: 'Curated',
};

// Falls back to the raw slug so a source added to the pipeline shows up as
// something rather than blank until it gets a label here.
export function sourceLabel(sourceType: string): string {
  return SOURCE_LABEL[sourceType] ?? sourceType;
}

// Both the feed (get_filtered_events) and the detail query already return the
// lineup in performance_order, so this only unwraps and drops empty slots.
//
// It deliberately does not re-sort. The old client-side sort keyed on
// `performance_order ?? 0`, which sorts unnumbered artists to the *front* —
// the opposite of the SQL's NULLS LAST — so the two disagreed about any lineup
// with a missing order. Ordering is the database's job.
export function lineupArtists(lineups: LineupSlot[]): Artist[] {
  return lineups
    .map((slot) => slot.artists)
    .filter((artist): artist is Artist => artist !== null);
}
