import { todayLocalDateString } from '@/lib/format-date';
import { Timeframe } from '@/lib/types';

// Human labels for the timeframe filter that show the ACTUAL dates each option
// covers — "This weekend" alone is confusing when you're planning a trip and
// need to know it means Jul 25–27. It also corrects two labels that were plain
// wrong: the filter's "this_week"/"next_month" are rolling next-7/next-30-day
// windows, not the calendar week or month.
//
// The date math mirrors timeframe_window() in migration 0008 exactly, so the
// label can never claim a window the server doesn't actually return. Computed
// from the local calendar date (built from parts, never Date-parsed off a
// string) for the same timezone reason the rest of format-date guards against.

function localToday(): Date {
  const [y, m, d] = todayLocalDateString().split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, n: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

function monthDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// "Jul 25–27" within a month, "Jul 31 – Aug 2" across one.
function rangeLabel(start: Date, end: Date): string {
  if (start.getTime() === end.getTime()) return monthDay(start);
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}–${end.getDate()}`;
  }
  return `${monthDay(start)} – ${monthDay(end)}`;
}

export function timeframeLabel(tf: Timeframe): string {
  const today = localToday();
  const dow = today.getDay(); // 0=Sun..6=Sat — same convention as Postgres DOW

  switch (tf) {
    case 'all':
      return 'Anytime';
    case 'today':
      return `Today · ${monthDay(today)}`;
    case 'this_week':
      return `Next 7 days · thru ${monthDay(addDays(today, 7))}`;
    case 'next_month':
      return `Next 30 days · thru ${monthDay(addDays(today, 30))}`;
    case 'this_weekend': {
      let start: Date;
      let end: Date;
      if (dow === 0) {
        start = today; // Sunday — the tail of this weekend
        end = today;
      } else if (dow === 6) {
        start = today; // Saturday
        end = addDays(today, 1);
      } else {
        start = addDays(today, 5 - dow); // upcoming Friday
        end = addDays(start, 2); // through Sunday
      }
      return `This weekend · ${rangeLabel(start, end)}`;
    }
  }
}
