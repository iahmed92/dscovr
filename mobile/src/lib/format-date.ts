// `new Date('2026-07-17')` parses as UTC midnight, which can display as the
// previous day in negative-UTC-offset timezones. Build the Date from its
// parts instead so it's always the local calendar date it's meant to be.
export function formatEventDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
