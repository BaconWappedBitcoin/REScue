/**
 * Automatic night mode (nightMode): what counts as "night", and which theme the schedule wants.
 * Pure arithmetic on a clock — no DOM, no settings, no clock of its own — so the module that flips
 * the page can be tested against a fixed instant.
 *
 * RES set the theme in the reader's Reddit account; REScue never writes to the account (principle
 * V), so it works out the theme from the options and the reader's own clock and flips Reddit's
 * `theme-dark` class on <html> for this tab instead (src/modules/appearance/nightMode.ts).
 */

export type NightModeMode = 'none' | 'system' | 'time' | 'always' | 'never';

/** 'dark' / 'light', or null for "leave Reddit's own setting alone". */
export type WantedTheme = 'dark' | 'light' | null;

export const DEFAULT_START = '20:00';
export const DEFAULT_END = '06:00';

/**
 * "HH:MM" as minutes past midnight; an hour may be written without its leading zero (so RES's own
 * '6:00' reads as intended). Null for anything else, which is how a mistyped option falls back to
 * the default instead of leaving the page dark all day.
 */
export function parseHm(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parts = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!parts) return null;
  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** The instant's own time of day, in minutes past midnight, in the reader's time zone. */
export function minutesOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Is `date` inside the night window? A window that ends before it starts crosses midnight
 * (20:00 to 06:00 is dark until six in the morning). An empty window (start === end) is never
 * night, so a start and end that were filled in the same cannot darken the page at all.
 */
export function isNightAt(date: Date, start: number, end: number): boolean {
  if (start === end) return false;
  const now = minutesOf(date);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * The theme the options ask for at `now`, given what the operating system says. `start` and `end`
 * are the raw option values; one that is not a time falls back to the default. 'none' returns null,
 * which means REScue does not touch the page at all.
 */
export function wantedTheme(
  mode: NightModeMode,
  now: Date,
  start: string,
  end: string,
  systemDark: boolean,
): WantedTheme {
  switch (mode) {
    case 'always':
      return 'dark';
    case 'never':
      return 'light';
    case 'system':
      return systemDark ? 'dark' : 'light';
    case 'time': {
      // The defaults above are valid times, so the last 0 never stands in for one.
      const from = parseHm(start) ?? parseHm(DEFAULT_START) ?? 0;
      const to = parseHm(end) ?? parseHm(DEFAULT_END) ?? 0;
      return isNightAt(now, from, to) ? 'dark' : 'light';
    }
    default:
      return null;
  }
}
