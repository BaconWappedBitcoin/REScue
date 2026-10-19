/**
 * RES backup importer, filter half (T119): turns the `RESoptions.filteReddit` tables of an RES
 * backup into REScue filter rules, and holds the small helpers both halves use. See resImport.ts
 * for the file formats this follows.
 *
 * Shapes follow RES lib/modules/filteReddit.js (module.options, getStringMatchConditions; GPL-3.0,
 * Copyright (C) the RES contributors, commit 4defffc12235b86b50e458d9f3565c96376609ec); the code
 * is new.
 */
import {
  validateRule,
  type FilterRule,
  type RuleScope,
  type RuleType,
} from '../listings/filteReddit/rules';

export type Json = Record<string, unknown>;
export type ImportMode = 'merge' | 'replace';

const MAX_PATTERN = 500;

export const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
/** Own property only, so a crafted `__proto__` or `constructor` key is never followed. */
export const own = (o: Json, k: string): unknown =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
/** Untrusted text made safe to show in a message. */
export const shown = (s: unknown, max = 40): string =>
  Array.from(String(s), (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .trim()
    .slice(0, max);

/** filteReddit.js table options that become a REScue rule type, with their cell layout. */
const TABLES: Array<{ key: string; type: RuleType; scoped: boolean }> = [
  { key: 'keywords', type: 'keyword', scoped: true },
  { key: 'subreddits', type: 'subreddit', scoped: false },
  { key: 'domains', type: 'domain', scoped: true },
  { key: 'flair', type: 'flair', scoped: true },
  { key: 'users', type: 'user', scoped: false },
];
const SCOPES: Record<string, RuleScope> = {
  everywhere: 'everywhere',
  exclude: 'except',
  include: 'only',
};

function optionValue(storage: Json, key: string): unknown {
  const opts = own(storage, 'RESoptions.filteReddit');
  const option = isObj(opts) ? own(opts, key) : undefined;
  return isObj(option) ? own(option, 'value') : undefined;
}

const rowsOf = (storage: Json, key: string): unknown[] => {
  const v = optionValue(storage, key);
  return Array.isArray(v) ? v : [];
};

function cell(row: unknown, i: number): string {
  if (!Array.isArray(row)) return '';
  const v = row[i] as unknown;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(',');
  return typeof v === 'string' ? v.trim() : '';
}

const subNames = (csv: string): string =>
  csv
    .split(',')
    .map((s) => s.trim().replace(/^\/?r\//i, ''))
    .filter(Boolean)
    .join(',');

/** `/r/name` and `/u/name` as people typed them become the bare name REScue matches against. */
function bareName(type: RuleType, pattern: string): string {
  const m =
    type === 'subreddit'
      ? /^\/?r\/([A-Za-z0-9_]{2,21})\/?$/i.exec(pattern)
      : type === 'user'
        ? /^\/?u(?:ser)?\/([A-Za-z0-9_-]{3,20})\/?$/i.exec(pattern)
        : null;
  return m ? m[1]! : pattern;
}

export interface FilterConversion {
  rules: FilterRule[];
  /** RES's "filter all NSFW posts" switch, when the file has it. */
  hideNsfw: boolean | undefined;
  found: number;
  skipped: string[];
}

export function convertFilters(storage: Json): FilterConversion {
  const rules: FilterRule[] = [];
  const skipped: string[] = [];
  let found = 0;

  for (const { key, type, scoped } of TABLES) {
    for (const row of rowsOf(storage, key)) {
      const pattern = bareName(type, cell(row, 0));
      if (!pattern) continue; // a blank row RES kept for its editor
      found++;
      const label = `${type} filter “${shown(pattern)}”`;
      if (pattern.length > MAX_PATTERN) {
        skipped.push(`${label}: pattern is longer than ${MAX_PATTERN} characters`);
        continue;
      }
      if (type === 'keyword' && cell(row, 3)) {
        skipped.push(`${label}: its “unless” keyword has no equivalent`);
        continue;
      }
      const applyTo = scoped ? cell(row, 1) || 'everywhere' : 'everywhere';
      const scope = Object.prototype.hasOwnProperty.call(SCOPES, applyTo)
        ? SCOPES[applyTo]
        : undefined;
      if (!scope) {
        skipped.push(`${label}: unknown scope “${shown(applyTo, 20)}”`);
        continue;
      }
      const rule: FilterRule = {
        type,
        pattern,
        scope,
        subreddits: scoped ? subNames(cell(row, 2)) : '',
        enabled: true,
        toggle: '',
      };
      const problem = validateRule(rule);
      if (problem) skipped.push(`${label}: ${problem}`);
      else rules.push(rule);
    }
  }

  // Options with no REScue counterpart are listed, not dropped silently.
  for (const row of rowsOf(storage, 'comments')) {
    const pattern = cell(row, 0);
    if (!pattern) continue;
    found++;
    skipped.push(`comment filter “${shown(pattern)}”: REScue filters posts only`);
  }
  for (const key of ['customFiltersP', 'customFiltersC']) {
    for (const item of rowsOf(storage, key)) {
      found++;
      const opts = isObj(item) ? own(item, 'opts') : undefined;
      const name = isObj(opts) ? shown(own(opts, 'name') ?? '') : '';
      skipped.push(
        `custom filter${name ? ` “${name}”` : ''}: the filter builder has no equivalent`,
      );
    }
  }
  for (const row of rowsOf(storage, 'allowNSFW')) {
    const subs = cell(row, 0);
    if (!subs) continue;
    found++;
    skipped.push(`NSFW exception for “${shown(subs)}”: no equivalent`);
  }

  const nsfw = optionValue(storage, 'NSFWfilter');
  return { rules, hideNsfw: typeof nsfw === 'boolean' ? nsfw : undefined, found, skipped };
}

const ruleKey = (r: FilterRule): string =>
  [r.type, r.pattern.trim().toLowerCase(), r.scope, subNames(r.subreddits).toLowerCase()].join(
    '\n',
  );

export function mergeRules(existing: FilterRule[], incoming: FilterRule[], mode: ImportMode) {
  // Replace never empties the list: a file without usable filters leaves yours alone.
  const out: FilterRule[] = mode === 'replace' && incoming.length ? [] : [...existing];
  const seen = new Set(out.map(ruleKey));
  let added = 0;
  let duplicates = 0;
  for (const r of incoming) {
    const k = ruleKey(r);
    if (seen.has(k)) {
      duplicates++;
      continue;
    }
    seen.add(k);
    out.push(r);
    added++;
  }
  return { rules: out, added, duplicates };
}
