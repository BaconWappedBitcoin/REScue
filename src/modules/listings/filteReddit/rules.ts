/**
 * filteReddit rule matching. Semantics ported from RES lib/modules/filteReddit.js
 * (getStringMatchConditions) and lib/modules/filteReddit/Case.js (PatternCase.build) — GPL-3.0,
 * Copyright (C) the Reddit Enhancement Suite contributors, commit 4defffc:
 *  - `/body/flags` is a regular expression; anything else is plain text, case-insensitive;
 *  - keyword and flair match anywhere in the text; subreddit, domain and user match exactly;
 *  - "only"/"except" scopes take a subreddit list matched against the post's subreddit, and against
 *    the page being browsed for the pseudo-subreddits all and popular.
 */
import type { Post, PostType } from '../../../model/types';
import { browseConditions, compileBrowse, type BrowseEnv } from './browseConditions';
import { checkExpression, type Test } from './conditions';
import { parsePattern, type ParsedPattern } from './pattern';
import { checkPostCondition, compilePostCondition, type PostEnv } from './postConditions';

/**
 * Beyond RES's text rules, these follow RES postCases (Score, CommentCount, PostType, IsSpoiler,
 * UserTag). "score-below N" hides posts whose score is under N; "score-above N" those over N (the
 * same for comments, but a comment whose score is hidden or not yet known is never matched).
 * "locked" reads the post's own `locked` attribute (verified 2026-10-15). Not offered: visited (it
 * needs the browser history, which REScue does not read).
 */
export type RuleType =
  | 'keyword'
  | 'subreddit'
  | 'domain'
  | 'user'
  | 'flair'
  | 'nsfw'
  | 'score-below'
  | 'score-above'
  | 'comments-below'
  | 'comments-above'
  | 'post-type'
  | 'spoiler'
  | 'locked'
  | 'user-tag'
  | 'custom';
export type RuleScope = 'everywhere' | 'only' | 'except';
export const RULE_TYPES: RuleType[] = [
  'keyword',
  'subreddit',
  'domain',
  'user',
  'flair',
  'nsfw',
  'score-below',
  'score-above',
  'comments-below',
  'comments-above',
  'post-type',
  'spoiler',
  'locked',
  'user-tag',
  'custom',
];
export const RULE_SCOPES: RuleScope[] = ['everywhere', 'only', 'except'];

/** Rule types that match with no pattern at all. */
const NO_PATTERN: ReadonlySet<RuleType> = new Set(['nsfw', 'spoiler', 'locked']);
/** The pattern is optional: blank means any value. */
const OPTIONAL_PATTERN: ReadonlySet<RuleType> = new Set(['user-tag']);
const NUMERIC: ReadonlySet<RuleType> = new Set([
  'score-below',
  'score-above',
  'comments-below',
  'comments-above',
]);
export const POST_TYPE_CHOICES: readonly PostType[] = [
  'text',
  'link',
  'image',
  'video',
  'gallery',
  'crosspost',
];
/** Does a rule of this type need a pattern before it can apply? */
export const needsPattern = (t: RuleType): boolean =>
  !NO_PATTERN.has(t) && !OPTIONAL_PATTERN.has(t);

/** As stored in the filteReddit `rules` table option. */
export interface FilterRule {
  type: RuleType;
  pattern: string;
  scope: RuleScope;
  /** Comma-separated subreddit names for "only"/"except". */
  subreddits: string;
  enabled: boolean;
  /** Optional customToggles switch name; the rule applies only while it is on. */
  toggle: string;
  /** Optional "only when browsing" condition (browseConditions.ts); blank = always. */
  when?: string;
}

export interface CompiledRule {
  source: FilterRule;
  regex: RegExp | null;
  subs: Set<string>;
  /** The threshold of the score / comment-count types. */
  num: number | null;
  /** A custom rule's compiled expression (postConditions.ts). */
  custom?: Test<Post, PostEnv>;
  /** The compiled "only when browsing" condition. */
  when?: Test<unknown, BrowseEnv>;
}

export interface MatchContext {
  /** Subreddit of the page being browsed (including "all"/"popular"), if any. */
  subreddit: string | undefined;
  toggleOn(name: string): boolean;
  /** The tag text REScue holds for `author` (lower-cased), or undefined. */
  userTag?(author: string): string | undefined;
  /** What custom and "only when browsing" conditions look at; without it they never match. */
  env?: PostEnv;
}

const FULL_MATCH: ReadonlySet<RuleType> = new Set(['subreddit', 'domain', 'user']);

export { parsePattern, type ParsedPattern };

const subList = (s: string | undefined) =>
  new Set(
    String(s ?? '')
      .split(',')
      .map((x) =>
        x
          .trim()
          .replace(/^\/?r\//i, '')
          .toLowerCase(),
      )
      .filter(Boolean),
  );

/** Validation at input time: a message, or null when the rule is acceptable. */
export function validateRule(r: FilterRule): string | null {
  if (!RULE_TYPES.includes(r.type)) return `Unknown filter type “${String(r.type)}”.`;
  const pattern = String(r.pattern ?? '').trim();
  if (needsPattern(r.type) && !pattern) return 'Enter a pattern to match.';
  const when = String(r.when ?? '').trim();
  if (when) {
    const bad = checkExpression(when, browseConditions);
    if (bad) return `Only when browsing: ${bad}`;
  }
  if (r.type === 'custom') return pattern ? checkPostCondition(pattern) : null;
  const problem = validatePattern(r.type, pattern);
  if (problem) return problem;
  if (r.scope !== 'everywhere' && subList(r.subreddits).size === 0) {
    return `List at least one subreddit for “${r.scope === 'only' ? 'only in' : 'everywhere except'}”.`;
  }
  return null;
}

const INTEGER = /^-?\d{1,9}$/;

function validatePattern(type: RuleType, pattern: string): string | null {
  if (NO_PATTERN.has(type) || (OPTIONAL_PATTERN.has(type) && !pattern)) return null;
  if (NUMERIC.has(type)) return INTEGER.test(pattern) ? null : 'Enter a whole number.';
  if (type === 'post-type') {
    return (POST_TYPE_CHOICES as readonly string[]).includes(pattern.toLowerCase())
      ? null
      : `Post type must be one of: ${POST_TYPE_CHOICES.join(', ')}.`;
  }
  const p = parsePattern(pattern, FULL_MATCH.has(type));
  return p.ok ? null : p.error;
}

/** Is a stored rule row on? A missing `enabled` counts as on (as in RES and the inline menu). */
export const ruleOn = (r: { enabled?: unknown }): boolean => r.enabled !== false;

/** Compile stored rules; invalid ones are disabled and reported, blank new rows skipped silently. */
export function compileRules(rows: FilterRule[]): { rules: CompiledRule[]; errors: string[] } {
  const rules: CompiledRule[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    if (!r || !ruleOn(r)) continue;
    if (needsPattern(r.type) && !String(r.pattern ?? '').trim()) continue; // incomplete row
    const problem = validateRule(r);
    if (problem) {
      errors.push(problem);
      continue;
    }
    const pattern = String(r.pattern ?? '').trim();
    const textual =
      !NO_PATTERN.has(r.type) &&
      !NUMERIC.has(r.type) &&
      r.type !== 'post-type' &&
      r.type !== 'custom' &&
      pattern !== '';
    const custom = r.type === 'custom' ? compilePostCondition(pattern) : null;
    const when = String(r.when ?? '').trim();
    const browse = when ? compileBrowse(when) : null;
    const parsed = textual ? parsePattern(pattern, FULL_MATCH.has(r.type)) : null;
    rules.push({
      source: r,
      regex: parsed && parsed.ok ? parsed.regex : null,
      subs: subList(r.subreddits),
      num: NUMERIC.has(r.type) ? Number(pattern) : null,
      ...(custom && custom.ok ? { custom: custom.test } : {}),
      ...(browse && browse.ok ? { when: browse.test } : {}),
    });
  }
  return { rules, errors };
}

function inScope(rule: CompiledRule, post: Post, ctx: MatchContext): boolean {
  if (rule.source.scope === 'everywhere') return true;
  const page = ctx.subreddit?.toLowerCase();
  // A subreddit rule already names the post's subreddit, so its list can only mean the page being
  // browsed: "except r/x" hides r/x everywhere but on r/x itself (RES filterSubredditsFrom default).
  const byPost = rule.source.type !== 'subreddit' && rule.subs.has(post.subreddit.toLowerCase());
  const pageCounts = rule.source.type === 'subreddit' || page === 'all' || page === 'popular';
  const listed = byPost || (!!page && pageCounts && rule.subs.has(page));
  return rule.source.scope === 'only' ? listed : !listed;
}

function fieldOf(type: RuleType, post: Post): string | null {
  switch (type) {
    case 'keyword':
      return post.title;
    case 'subreddit':
      return post.subreddit;
    case 'domain':
      return post.type === 'text' ? null : post.domain;
    case 'user':
      return post.author;
    case 'flair':
      return post.flair?.text ?? null;
    default:
      return null;
  }
}

/** Does this one rule's condition hold for `post` (scope already checked)? */
function conditionHolds(rule: CompiledRule, post: Post, ctx: MatchContext): boolean {
  const t = rule.source.type;
  const n = rule.num ?? 0;
  switch (t) {
    case 'nsfw':
      return post.nsfw;
    case 'spoiler':
      return post.spoiler;
    case 'locked':
      return post.locked === true;
    case 'score-below':
      return post.score !== null && post.score < n;
    case 'score-above':
      return post.score !== null && post.score > n;
    case 'comments-below':
      return post.commentCount < n;
    case 'comments-above':
      return post.commentCount > n;
    case 'custom':
      return !!ctx.env && !!rule.custom?.(post, ctx.env);
    case 'post-type':
      return post.type === rule.source.pattern.trim().toLowerCase();
    case 'user-tag': {
      const tag = post.author ? ctx.userTag?.(post.author.toLowerCase()) : undefined;
      return tag !== undefined && (!rule.regex || rule.regex.test(tag));
    }
    default: {
      const value = fieldOf(t, post);
      return value !== null && !!rule.regex?.test(value);
    }
  }
}

/** The first rule that hides `post`, or null. */
export function matchPost(post: Post, rules: CompiledRule[], ctx: MatchContext): FilterRule | null {
  for (const rule of rules) {
    const r = rule.source;
    if (r.toggle && !ctx.toggleOn(r.toggle)) continue;
    if (!inScope(rule, post, ctx)) continue;
    if (rule.when && !(ctx.env && rule.when(undefined, ctx.env))) continue;
    if (conditionHolds(rule, post, ctx)) return r;
  }
  return null;
}

export function describeRule(r: FilterRule): string {
  switch (r.type) {
    case 'nsfw':
      return 'NSFW';
    case 'spoiler':
      return 'spoiler';
    case 'locked':
      return 'locked';
    case 'user-tag':
      return r.pattern.trim() ? `user tag: ${r.pattern}` : 'tagged user';
    default:
      return `${r.type}: ${r.pattern}`;
  }
}

/**
 * The rule behind "Hide all NSFW posts". `allow` is the NSFW allow-list table: in those
 * subreddits NSFW posts are left alone (scope "except").
 */
export function hideNsfwRule(allow: Array<Record<string, unknown>>): FilterRule {
  const subreddits = allow
    .map((r) =>
      String(r.subreddit ?? '')
        .trim()
        .replace(/^\/?r\//i, ''),
    )
    .filter(Boolean)
    .join(',');
  return {
    type: 'nsfw',
    pattern: '',
    scope: subreddits ? 'except' : 'everywhere',
    subreddits,
    enabled: true,
    toggle: '',
  };
}
