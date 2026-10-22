/**
 * filteReddit comment rules. Rule types follow RES lib/modules/filteReddit/commentCases (CommentContent,
 * Username via UserAttr, IsDeleted, Depth) — GPL-3.0, Copyright (C) the Reddit Enhancement Suite
 * contributors, commit 4defffc; the code is new. The action is collapse (the comment's own body;
 * replies stay) or hide (the whole comment element, so its replies go with it).
 *
 * Score rules (RES Score): "score-below N" / "score-above N". A comment's score is KNOWN only once
 * its action row has hydrated and says the score is not hidden (model/commentRow.ts, R20); an
 * unknown or hidden score (`null`) is never matched, so it is never filtered by score.
 */
import {
  checkCommentCondition,
  compileCommentCondition,
  isDeleted,
  type CommentEnv,
  type CommentFacts,
} from './commentConditions';
import { checkExpression, type Test } from './conditions';
import { browseConditions, compileBrowse, type BrowseEnv } from './browseConditions';
import { isLowEffort } from './lowEffort';
import { parsePattern } from './pattern';
import { ruleOn } from './rules';

export { isDeleted };
export type { CommentEnv, CommentFacts };

export type CommentRuleType =
  | 'keyword'
  | 'user'
  | 'deleted'
  | 'low-effort'
  | 'depth'
  | 'score-below'
  | 'score-above'
  | 'custom';
export type CommentAction = 'collapse' | 'hide';
export const COMMENT_RULE_TYPES: CommentRuleType[] = [
  'keyword',
  'user',
  'deleted',
  'low-effort',
  'depth',
  'score-below',
  'score-above',
  'custom',
];
export const COMMENT_ACTIONS: CommentAction[] = ['collapse', 'hide'];

/** As stored in the filteReddit `commentRules` table option. */
export interface CommentRule {
  type: CommentRuleType;
  /** keyword: text or /regex/flags; user: a name; depth: a whole number; deleted: unused. */
  pattern: string;
  action: CommentAction;
  enabled: boolean;
  /** Optional "only when browsing" condition (browseConditions.ts); blank = always. */
  when?: string;
}

export interface CompiledCommentRule {
  source: CommentRule;
  regex: RegExp | null;
  /** The number of a depth / score rule. */
  num: number;
  /** A custom rule's compiled expression. */
  custom?: Test<CommentFacts, CommentEnv>;
  /** The compiled "only when browsing" condition. */
  when?: Test<unknown, BrowseEnv>;
}

const needsPattern = (t: CommentRuleType): boolean => t !== 'deleted' && t !== 'low-effort';
const DEPTH = /^\d{1,3}$/;
const SCORE = /^-?\d{1,9}$/;
const isScoreRule = (t: CommentRuleType): boolean => t === 'score-below' || t === 'score-above';

/** Does this rule set need comment scores (so the page must be watched for action rows)? */
export const usesScores = (rules: CompiledCommentRule[]): boolean =>
  rules.some(
    (r) =>
      isScoreRule(r.source.type) ||
      (r.source.type === 'custom' && /\bscore\b/i.test(r.source.pattern)),
  );

export function validateCommentRule(r: CommentRule): string | null {
  if (!COMMENT_RULE_TYPES.includes(r.type)) return `Unknown comment filter “${String(r.type)}”.`;
  if (!COMMENT_ACTIONS.includes(r.action)) return 'Choose collapse or hide.';
  const pattern = r.pattern.trim();
  const when = String(r.when ?? '').trim();
  if (when) {
    const bad = checkExpression(when, browseConditions);
    if (bad) return `Only when browsing: ${bad}`;
  }
  if (!needsPattern(r.type)) return null;
  if (!pattern) return 'Enter a pattern to match.';
  if (r.type === 'custom') return checkCommentCondition(pattern);
  if (r.type === 'depth') {
    return DEPTH.test(pattern) ? null : 'Depth must be a whole number (0 is a top-level comment).';
  }
  if (isScoreRule(r.type)) return SCORE.test(pattern) ? null : 'Enter a whole number.';
  const p = parsePattern(pattern, r.type === 'user');
  return p.ok ? null : p.error;
}

/** Invalid rows are skipped and reported; incomplete rows are skipped silently. */
export function compileCommentRules(rows: CommentRule[]): {
  rules: CompiledCommentRule[];
  errors: string[];
} {
  const rules: CompiledCommentRule[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    if (!r || !ruleOn(r)) continue;
    const pattern = String(r.pattern ?? '').trim();
    if (needsPattern(r.type) && !pattern) continue;
    const problem = validateCommentRule({ ...r, pattern });
    if (problem) {
      errors.push(problem);
      continue;
    }
    const regex =
      r.type === 'keyword' || r.type === 'user'
        ? (() => {
            const p = parsePattern(pattern, r.type === 'user');
            return p.ok ? p.regex : null;
          })()
        : null;
    const numeric = r.type === 'depth' || isScoreRule(r.type);
    const custom = r.type === 'custom' ? compileCommentCondition(pattern) : null;
    const when = String(r.when ?? '').trim();
    const browse = when ? compileBrowse(when) : null;
    rules.push({
      source: r,
      regex,
      num: numeric ? Number(pattern) : 0,
      ...(custom && custom.ok ? { custom: custom.test } : {}),
      ...(browse && browse.ok ? { when: browse.test } : {}),
    });
  }
  return { rules, errors };
}

/** The first rule that applies to the comment, or null. */
export function matchComment(
  f: CommentFacts,
  rules: CompiledCommentRule[],
  env?: CommentEnv,
): CommentRule | null {
  for (const rule of rules) {
    if (rule.when && !(env && rule.when(undefined, env))) continue;
    if (conditionHolds(rule, f, env)) return rule.source;
  }
  return null;
}

function conditionHolds(rule: CompiledCommentRule, f: CommentFacts, env?: CommentEnv): boolean {
  switch (rule.source.type) {
    case 'custom':
      return !!env && !!rule.custom?.(f, env);
    case 'deleted':
      return isDeleted(f);
    case 'low-effort':
      return isLowEffort(f.body);
    case 'depth':
      return f.depth >= rule.num;
    case 'score-below':
      return typeof f.score === 'number' && f.score < rule.num;
    case 'score-above':
      return typeof f.score === 'number' && f.score > rule.num;
    case 'user':
      return !!f.author && !!rule.regex?.test(f.author);
    default:
      return !!rule.regex?.test(f.body);
  }
}

export const describeCommentRule = (r: CommentRule): string =>
  r.type === 'deleted'
    ? 'deleted comment'
    : r.type === 'low-effort'
      ? 'low-effort reply'
      : r.type === 'depth'
        ? `depth ${r.pattern.trim()} or deeper`
        : r.type === 'custom'
          ? `custom: ${r.pattern.trim()}`
          : r.type === 'score-below'
            ? `score below ${r.pattern.trim()}`
            : r.type === 'score-above'
              ? `score above ${r.pattern.trim()}`
              : `comment ${r.type}: ${r.pattern}`;
