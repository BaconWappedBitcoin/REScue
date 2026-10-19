/**
 * Text patterns shared by every filteReddit rule: `/body/flags` is a regular expression, anything
 * else is plain text matched without regard to case (RES utils/string.js regexRegex and
 * Case.js PatternCase.build, GPL-3.0, the RES contributors).
 */

/** RES utils/string.js regexRegex. */
const REGEX_SYNTAX = /^\/(.*)\/([sgimu]+)?$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type ParsedPattern =
  { ok: true; regex: RegExp; isRegex: boolean } | { ok: false; error: string };

export function parsePattern(pattern: string, fullMatch: boolean): ParsedPattern {
  const re = REGEX_SYNTAX.exec(pattern);
  if (re) {
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
