/**
 * Condition expressions: RES filteReddit "custom filters" (customFiltersP / customFiltersC) and the
 * comment navigator's custom / popular categories, written as one line of text instead of RES's
 * JSON condition tree. Semantics follow RES lib/modules/filteReddit.js and filteReddit/Case.js
 * (GPL-3.0, the RES contributors); the grammar and the code are new.
 *
 *   expression := term ("or" term)*          lowest precedence
 *   term       := factor ("and" factor)*
 *   factor     := "not" factor | "(" expression ")" | condition
 *   condition  := name | name:value | name<number | name>number | name<=number | name>=number | name=number
 *
 * A value containing spaces or parentheses is wrapped in double quotes: keyword:"hello world".
 * This file is the grammar only; the condition names live in postConditions.ts and
 * commentConditions.ts, the ones about where and when you are browsing in browseConditions.ts.
 */
import { parsePattern } from './pattern';

export type Op = '<' | '>' | '<=' | '>=' | '=' | ':';

export interface Condition {
  name: string;
  /** '' when the condition was written as a bare name. */
  op: Op | '';
  value: string;
}

export type Test<S, E> = (subject: S, env: E) => boolean;

export interface ConditionSpec<S, E> {
  /** One-line description for help text. */
  help: string;
  /** A message when this use of the condition is wrong, else null. */
  check(c: Condition): string | null;
  /** Builds the test; only called after check() passed. */
  build(c: Condition): Test<S, E>;
}
export type ConditionTable<S, E> = Record<string, ConditionSpec<S, E>>;

export type Compiled<S, E> = { ok: true; test: Test<S, E> } | { ok: false; error: string };

type Token = { kind: '(' } | { kind: ')' } | { kind: 'word'; text: string; quoted: boolean };

function tokenize(text: string): Token[] | string {
  const out: Token[] = [];
  let cur = '';
  let quoted = false;
  let inQuote = false;
  let has = false;
  const flush = () => {
    if (has) out.push({ kind: 'word', text: cur, quoted });
    cur = '';
    quoted = false;
    has = false;
  };
  for (const ch of text) {
    if (inQuote) {
      if (ch === '"') inQuote = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuote = true;
      quoted = true;
      has = true;
    } else if (ch === '(' || ch === ')') {
      flush();
      out.push({ kind: ch });
    } else if (/\s/.test(ch)) flush();
    else {
      cur += ch;
      has = true;
    }
  }
  if (inQuote) return 'A double quote is not closed.';
  flush();
  return out;
}

const CONDITION = /^([A-Za-z][A-Za-z0-9-]*)(?:(<=|>=|<|>|=|:)([\s\S]*))?$/;

function parseCondition(raw: string): Condition | string {
  const m = CONDITION.exec(raw);
  if (!m) return `“${raw}” is not a condition.`;
  return { name: m[1]!.toLowerCase(), op: (m[2] ?? '') as Op | '', value: m[3] ?? '' };
}

/** Parse and build an expression against `table`. */
export function compileExpression<S, E>(text: string, table: ConditionTable<S, E>): Compiled<S, E> {
  const tokens = tokenize(text);
  if (typeof tokens === 'string') return { ok: false, error: tokens };
  if (!tokens.length) return { ok: false, error: 'Enter a condition.' };
  let at = 0;
  let error: string | null = null;
  const fail = (m: string): null => {
    error ??= m;
    return null;
  };
  const isWord = (w: string): boolean => {
    const t = tokens[at];
    return t?.kind === 'word' && !t.quoted && t.text.toLowerCase() === w;
  };

  const orExpr = (): Test<S, E> | null => {
    const first = andExpr();
    if (!first) return null;
    const parts = [first];
    while (isWord('or')) {
      at++;
      const next = andExpr();
      if (!next) return null;
      parts.push(next);
    }
    return parts.length === 1 ? first : (s, e) => parts.some((p) => p(s, e));
  };
  const andExpr = (): Test<S, E> | null => {
    const first = notExpr();
    if (!first) return null;
    const parts = [first];
    while (isWord('and')) {
      at++;
      const next = notExpr();
      if (!next) return null;
      parts.push(next);
    }
    return parts.length === 1 ? first : (s, e) => parts.every((p) => p(s, e));
  };
  const notExpr = (): Test<S, E> | null => {
    if (isWord('not')) {
      at++;
      const inner = notExpr();
      return inner ? (s, e) => !inner(s, e) : null;
    }
    return atom();
  };
  const atom = (): Test<S, E> | null => {
    const t = tokens[at];
    if (!t) return fail('The condition ends too soon: something must follow and / or / not.');
    if (t.kind === ')') return fail('There is a “)” without a matching “(”.');
    if (t.kind === '(') {
      at++;
      const inner = orExpr();
      if (!inner) return null;
      if (tokens[at]?.kind !== ')') return fail('There is a “(” without a matching “)”.');
      at++;
      return inner;
    }
    at++;
    if (!t.quoted && ['and', 'or'].includes(t.text.toLowerCase()))
      return fail(`“${t.text}” needs a condition on both sides.`);
    const parsed = parseCondition(t.text);
    if (typeof parsed === 'string') return fail(parsed);
    const spec = table[parsed.name];
    if (!spec) {
      return fail(`Unknown condition “${parsed.name}”. Known: ${Object.keys(table).join(', ')}.`);
    }
    const problem = spec.check(parsed);
    if (problem) return fail(`${parsed.name}: ${problem}`);
    return spec.build(parsed);
  };

  const result = orExpr();
  if (result && at < tokens.length && !error) {
    fail('Join conditions with and / or, for example: score<0 and comments>50.');
  }
  return result && !error
    ? { ok: true, test: result }
    : { ok: false, error: error ?? 'Not a valid condition.' };
}

/** The error for `text`, or null when it compiles. */
export function checkExpression<S, E>(text: string, table: ConditionTable<S, E>): string | null {
  const r = compileExpression(text, table);
  return r.ok ? null : r.error;
}

// --- helpers shared by the condition tables ------------------------------------------------------

export const compare = (op: Op | '', actual: number, wanted: number): boolean => {
  switch (op) {
    case '<':
      return actual < wanted;
    case '>':
      return actual > wanted;
    case '<=':
      return actual <= wanted;
    case '>=':
      return actual >= wanted;
    default:
      return actual === wanted;
  }
};

const NUMBER = /^-?\d{1,9}(?:\.\d+)?$/;

/** A condition written as name<op>number (or name:number). */
export function numeric<S, E>(
  help: string,
  get: (s: S, e: E) => number | null,
): ConditionSpec<S, E> {
  return {
    help,
    check: (c) =>
      c.op && NUMBER.test(c.value.trim())
        ? null
        : 'write it as a comparison with a number, e.g. >5.',
    build: (c) => {
      const want = Number(c.value.trim());
      return (s, e) => {
        const v = get(s, e);
        return v !== null && compare(c.op, v, want);
      };
    },
  };
}

/** A bare name that is true or false. */
export function flag<S, E>(help: string, get: (s: S, e: E) => boolean): ConditionSpec<S, E> {
  return { help, check: (c) => (c.op ? 'takes no value.' : null), build: () => get };
}

/** name:text, matched as plain text or /regex/ (exactly when `exact`). */
export function textMatch<S, E>(
  help: string,
  exact: boolean,
  get: (s: S, e: E) => string | null,
  optional = false,
): ConditionSpec<S, E> {
  return {
    help,
    check: (c) => {
      if (c.op !== ':' && c.op !== '') return 'write it as name:text.';
      if (!c.value) return optional ? null : 'needs a value after the colon.';
      const p = parsePattern(c.value, exact);
      return p.ok ? null : p.error;
    },
    build: (c) => {
      const p = c.value ? parsePattern(c.value, exact) : null;
      const regex = p && p.ok ? p.regex : null;
      return (s, e) => {
        const v = get(s, e);
        return v !== null && (!regex || regex.test(v));
      };
    },
  };
}
