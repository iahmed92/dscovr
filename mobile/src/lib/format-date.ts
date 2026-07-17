// `new Date('2026-07-17')` parses as UTC midnight, which can display as the
// previous day in negative-UTC-offset timezones. Build the Date from its
// parts instead so it's always the local calendar date it's meant to be.
export function formatEventDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
