// Two-letter state codes to full names, for the market picker's group headers.
// Only the states we actually have markets in — this isn't a general reference.
export const STATE_NAMES: Record<string, string> = {
  AZ: 'Arizona',
  CA: 'California',
  CO: 'Colorado',
  DC: 'Washington DC',
  FL: 'Florida',
  GA: 'Georgia',
  IL: 'Illinois',
  LA: 'Louisiana',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MO: 'Missouri',
  NV: 'Nevada',
  NY: 'New York',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  WA: 'Washington',
};

export function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}
