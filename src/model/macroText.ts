/**
 * Comment macro placeholders (RES commentTools macroPlaceholders): `{{name}}` in a macro's text is
 * replaced by a value from the page when the macro is inserted. The names are RES's. A name REScue
 * does not know stays exactly as typed; a known one with no value on this page becomes empty.
 * Ideas from RES lib/modules/commentTools.js (GPL-3.0, the RES contributors, commit 4defffc); the
 * code is new.
 */

export interface MacroVars {
  /** Author of the post or comment being replied to (no u/). */
  author?: string | null;
  /** Current subreddit (no r/). */
  subreddit?: string | null;
  /** The signed-in reader's username (no u/). */
  myUsername?: string | null;
  /** The page's address. */
  url?: string | null;
  /** Text currently selected on the page. */
  selected?: string | null;
  /** The time "now" and "today" describe (defaults to the current time). */
  now?: Date;
}

/** Every placeholder REScue fills in, for the option's description and tests. */
export const MACRO_PLACEHOLDERS = [
  'author',
  'subreddit',
  'my_username',
  'url',
  'selected',
  'selection',
  'escaped',
  'now',
  'today',
] as const;

/** Backslash-escape the characters Markdown would otherwise read as formatting. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|>~^<]/g, '\\$&');
}

/** Replace the known `{{placeholders}}` in `text`; unknown ones are left as typed. */
export function expandMacro(text: string, vars: MacroVars = {}): string {
  const now = vars.now ?? new Date();
  const selected = vars.selected ?? '';
  const values: Record<string, () => string> = {
    author: () => vars.author ?? '',
    subreddit: () => vars.subreddit ?? '',
    my_username: () => vars.myUsername ?? '',
    url: () => vars.url ?? '',
    selected: () => selected,
    selection: () => selected,
    escaped: () => escapeMarkdown(selected),
    now: () => now.toLocaleString(),
    today: () => now.toLocaleDateString(),
  };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    return Object.hasOwn(values, key) ? values[key]!() : whole;
  });
}
