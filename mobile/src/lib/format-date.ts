// `new Date('2026-07-17')` parses as UTC midnight, which can display as the
// previous day in negative-UTC-offset timezones. Build the Date from its
// parts instead so it's always the local calendar date it's meant to be.
export function formatEventDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Heading for a day group in the feed timeline: "Today" / "Tomorrow" for the
// near days, otherwise "Fri, Jul 17". Parsed from parts for the same reason as
// formatEventDate — event_date is a bare calendar date with no timezone.
export function formatSectionDate(dateStr: string): string {
  const today = todayLocalDateString();
  if (dateStr === today) return 'Today';

  const [ty, tm, td] = today.split('-').map(Number);
  const tomorrow = new Date(ty, tm - 1, td + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  if (dateStr === tomorrowStr) return 'Tomorrow';

  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Today as a 'YYYY-MM-DD' string in local time, for comparing against
// event_date (which is a bare calendar date). Built from parts, not
// toISOString(), which is UTC and would flip the day near midnight — the same
// pitfall the ingestion scripts guard against.
export function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// doors_time is a Postgres TIME string ("20:00:00") — a plain wall-clock
// time with no date/timezone attached, so it's parsed as parts too rather
// than routed through Date parsing.
export function formatEventTime(timeStr: string): string {
  const [hourStr, minuteStr] = timeStr.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}
