/**
 * The conditions a custom comment filter (and the comment navigator's custom and popular
 * categories) can use: RES filteReddit comment cases (CommentContent, CommentLength, Depth,
 * IsDeleted, IsRead, Score, UserAttr, Username; lib/modules/filteReddit/commentCases, GPL-3.0, the
 * RES contributors) plus the browse conditions.
 */
import type { ReadRecord } from '../../../core/storage/prune';
import { isNewComment, isReadComment } from '../../comments/readTracking';
import { browseConditions, type BrowseEnv } from './browseConditions';
import {
  checkExpression,
  compare,
  compileExpression,
  flag,
  numeric,
  textMatch,
  type Compiled,
  type ConditionTable,
} from './conditions';

/** What a comment condition can look at. */
export interface CommentFacts {
  author: string | null;
  /** Reddit's depth: 0 for a top-level comment. */
  depth: number;
  /** The comment's own body text (not its replies). */
  body: string;
  /** The score, or null when hidden or not yet known. Omitted counts as unknown. */
  score?: number | null;
  isOp?: boolean;
  distinguished?: 'moderator' | 'admin' | null;
  created?: Date | null;
}

export interface CommentEnv extends BrowseEnv {
  friends: ReadonlySet<string>;
  userTag(author: string): string | undefined;
  ignored(author: string): boolean;
  /** The thread's record from before this page view; null when read tracking is off. */
  readPrior: ReadRecord | undefined | null;
}

const DELETED_BODY = /^\s*\[(?:deleted|removed)(?: by [^\]]{1,40})?\]\s*$/i;

/** Deleted by the author or removed by a moderator, as the page shows it. */
export const isDeleted = (f: Pick<CommentFacts, 'author' | 'body'>): boolean =>
  f.author === null || f.author === '[deleted]' || DELETED_BODY.test(f.body);

const ATTRS = ['mod', 'admin', 'op', 'friend', 'me', 'tagged', 'ignored'] as const;
const LENGTH = /^(\d{1,7})(w|words?|c|chars?|characters?)?$/i;

export const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export const commentConditions: ConditionTable<CommentFacts, CommentEnv> = {
  ...browseConditions,
  keyword: textMatch('the comment text contains text or matches /regex/', false, (c) => c.body),
  user: textMatch('the author (exact name, or /regex/)', true, (c) => c.author),
  deleted: flag('the comment was deleted or removed', (c) => isDeleted(c)),
  depth: numeric('nesting depth, 0 is top level: depth>=3', (c) => c.depth),
  score: numeric('score, e.g. score<-2 (hidden or not yet loaded scores never match)', (c) =>
    typeof c.score === 'number' ? c.score : null,
  ),
  length: {
    help: 'length of the text: length>200 (characters) or length>50w (words)',
    check: (c) =>
      c.op && c.op !== ':' && LENGTH.test(c.value.trim())
        ? null
        : 'write it as length>200 or length>50w (words).',
    build: (c) => {
      const m = LENGTH.exec(c.value.trim())!;
      const words = /^w/i.test(m[2] ?? '');
      const want = Number(m[1]);
      return (f) => compare(c.op, words ? wordCount(f.body) : f.body.length, want);
    },
  },
  read: flag(
    'the comment was already there at your previous visit (needs “Read comments”)',
    (c, e) => isReadComment(e.readPrior ?? undefined, c.created ?? null),
  ),
  new: flag('the comment is newer than your previous visit (needs “Read comments”)', (c, e) =>
    isNewComment(e.readPrior ?? undefined, c.created ?? null),
  ),
  attr: {
    help: `the author is ${ATTRS.join(', ')}`,
    check: (c) =>
      c.op === ':' && (ATTRS as readonly string[]).includes(c.value.trim().toLowerCase())
        ? null
        : `use attr:${ATTRS.join(' / attr:')}.`,
    build: (c) => {
      const what = c.value.trim().toLowerCase();
      return (f, e) => {
        if (what === 'mod') return f.distinguished === 'moderator';
        if (what === 'admin') return f.distinguished === 'admin';
        if (what === 'op') return f.isOp === true;
        const a = f.author?.toLowerCase();
        if (!a) return false;
        if (what === 'friend') return e.friends.has(a);
        if (what === 'me') return e.me?.toLowerCase() === a;
        if (what === 'ignored') return e.ignored(a);
        return e.userTag(a) !== undefined;
      };
    },
  },
};

export const compileCommentCondition = (text: string): Compiled<CommentFacts, CommentEnv> =>
  compileExpression(text, commentConditions);
export const checkCommentCondition = (text: string): string | null =>
  checkExpression(text, commentConditions);

export const COMMENT_CONDITION_HELP = Object.entries(commentConditions)
  .map(([k, v]) => `${k}: ${v.help}`)
  .join('\n');
