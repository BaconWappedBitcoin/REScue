/**
 * Text patterns shared by every filteReddit rule: `/body/flags` is a regular expression, anything
 * else is plain text matched without regard to case (RES utils/string.js regexRegex and
 * Case.js PatternCase.build, GPL-3.0, the RES contributors).
 *
 * A regular expression runs on the text of every post and comment on the page, and one can come
 * from an imported backup, so two kinds are refused: very long ones, and ones that repeat a group
 * that already repeats (such as `(a+)+`), which can take minutes on one long line and freeze the
 * page.
 */

/** RES utils/string.js regexRegex. */
const REGEX_SYNTAX = /^\/(.*)\/([sgimu]+)?$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The longest `/regex/` pattern accepted, slashes and flags included. */
export const MAX_REGEX_LENGTH = 300;

/** An unbounded repeat: +, * or {n,} / {n,m}. */
const REPEAT = /[+*]|\{\d+,\d*\}/;
const STARTS_WITH_REPEAT = /^(?:[+*]|\{\d+,\d*\})/;
/** Stands for a group whose content repeats, once that group has been folded away. */
const REPEATING = '\u0001';

/**
 * Does the expression repeat a group whose content already repeats, as in `(a+)+`, `(x*)*`,
 * `((ab)+c)+` or `(?:a{2,})+`? Escapes and character classes are blanked first, then the
 * innermost groups are folded one at a time. A rough check on purpose; it errs towards refusing.
 */
export function hasNestedRepeat(source: string): boolean {
  let s = source.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x');
  for (let guard = 0; guard < MAX_REGEX_LENGTH; guard++) {
    const m = /\(([^()]*)\)/.exec(s);
    if (!m) return false;
    const inner = m[1]!.replace(/^\?(?:[:=!]|<[=!]|<[^>]*>)/, '');
    const repeats = REPEAT.test(inner) || inner.includes(REPEATING);
    const after = s.slice(m.index + m[0].length);
    if (repeats && STARTS_WITH_REPEAT.test(after)) return true;
    s = s.slice(0, m.index) + (repeats ? REPEATING : 'x') + after;
  }
  return true;
}

export type ParsedPattern =
  { ok: true; regex: RegExp; isRegex: boolean } | { ok: false; error: string };

export function parsePattern(pattern: string, fullMatch: boolean): ParsedPattern {
  const re = REGEX_SYNTAX.exec(pattern);
  if (re) {
    if (pattern.length > MAX_REGEX_LENGTH) {
      return {
        ok: false,
        error: `A regular expression may be at most ${MAX_REGEX_LENGTH} characters, because it runs on the text of every post; this one has ${pattern.length}.`,
      };
    }
    if (hasNestedRepeat(re[1]!)) {
      return {
        ok: false,
        error: `“${pattern}” repeats a group that already repeats (such as (a+)+), which can freeze the page on long text. Write it without the nested repeat.`,
      };
    }
    try {
      // The global flag would make .test() stateful; it adds nothing to a yes/no match.
      return { ok: true, isRegex: true, regex: new RegExp(re[1]!, (re[2] ?? '').replace('g', '')) };
    } catch (err) {
      return {
        ok: false,
        error: `“${pattern}” is not a valid regular expression (${(err as Error).message}).`,
      };
    }
  }
  const body = escape(pattern.trim());
  return { ok: true, isRegex: false, regex: new RegExp(fullMatch ? `^(${body})$` : body, 'i') };
}
