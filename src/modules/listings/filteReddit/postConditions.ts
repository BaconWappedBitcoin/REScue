/**
 * The conditions a custom post filter can use: RES filteReddit post cases (CommentCount,
 * CommentsOpened, Domain, Expando, IsLocked, IsNSFW, IsSpoiler, LinkFlair, NewCommentCount,
 * PostAfter, PostAge, PostTitle, PostType, Score, Selector, Subreddit, UserAttr, UserTag,
 * UserVoteWeight, Username, VoteType; lib/modules/filteReddit/postCases, GPL-3.0, the RES
 * contributors) plus the browse conditions. Not offered: visited (needs the browser history) and
 * the author's flair (not a verified Reddit contract).
 */
import { C } from '../../../contracts/reddit';
import { POST_TYPES, type Post } from '../../../model/types';
import type { ReadRecord } from '../../../core/storage/prune';
import { newCommentCount } from '../../comments/readTracking';
import { browseConditions, parseWhen, type BrowseEnv } from './browseConditions';
import {
  checkExpression,
  compileExpression,
  compare,
  flag,
  numeric,
  textMatch,
  type ConditionTable,
  type Compiled,
} from './conditions';

/** What post conditions can look at besides the post itself. */
export interface PostEnv extends BrowseEnv {
  /** The user-tag text for an author (lower-cased name), or undefined. */
  userTag(author: string): string | undefined;
  /** The up and down votes the reader gave an author (lower-cased name). */
  votes(author: string): { up: number; down: number } | undefined;
  friends: ReadonlySet<string>;
  ignored(author: string): boolean;
  /** Read tracking (readComments), null when that module is off. */
  readPrior(postId: string): ReadRecord | undefined | null;
}

const UNIT_MS: Record<string, number> = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 };
const AGE = /^(\d{1,6})([mhdw]?)$/i;

const ATTRS = ['friend', 'me', 'tagged', 'ignored'] as const;
const POST_TYPE_CHOICES = POST_TYPES;
const TYPE_CHOICES: readonly string[] = POST_TYPES;

/** My vote on the post: read from the buttons in the post's open shadow root, null when unreadable. */
export function voteOnPost(post: Post): 'up' | 'down' | 'none' | null {
  const root = (post.source as HTMLElement).shadowRoot;
  if (!root) return null;
  const up = root.querySelector(C.native.upvote)?.getAttribute(C.native.voteState);
  const down = root.querySelector(C.native.downvote)?.getAttribute(C.native.voteState);
  if (up === null || up === undefined || down === null || down === undefined) return null;
  return up === 'true' ? 'up' : down === 'true' ? 'down' : 'none';
}

const dateAtom = (help: string, after: boolean) => ({
  help,
  check: (c: { op: string; value: string }) =>
    c.op === ':' && parseWhen(c.value) !== null
      ? null
      : 'write it as a date, e.g. 2026-03-01 or 2026-03-01T14:30.',
  build: (c: { value: string }) => {
    const at = parseWhen(c.value)!;
    return (p: Post) =>
      !!p.created && (after ? p.created.getTime() >= at : p.created.getTime() < at);
  },
});

export const postConditions: ConditionTable<Post, PostEnv> = {
  ...browseConditions,
  keyword: textMatch('the title contains text or matches /regex/', false, (p) => p.title),
  subreddit: textMatch(
    'the post is in this subreddit (exact name, or /regex/)',
    true,
    (p) => p.subreddit,
  ),
  domain: textMatch('the link domain (exact, or /regex/); text posts have none', true, (p) =>
    p.type === 'text' ? null : p.domain,
  ),
  user: textMatch('the author (exact name, or /regex/)', true, (p) => p.author),
  flair: textMatch(
    'the post flair text contains text or matches /regex/',
    false,
    (p) => p.flair?.text ?? null,
  ),
  nsfw: flag('the post is marked NSFW', (p) => p.nsfw),
  spoiler: flag('the post is marked spoiler', (p) => p.spoiler),
  locked: flag('the post is locked', (p) => p.locked === true),
  score: numeric('score, e.g. score>100 (hidden scores never match)', (p) => p.score),
  comments: numeric('number of comments, e.g. comments<5', (p) => p.commentCount),
  newcomments: numeric('comments added since your last visit (needs “Read comments”)', (p, e) => {
    const prior = e.readPrior(p.id);
    return prior ? newCommentCount(prior, p.commentCount) : null;
  }),
  type: {
    help: `post type (${POST_TYPE_CHOICES.join(', ')}), also written expando:`,
    check: (c) =>
      c.op === ':' && TYPE_CHOICES.includes(c.value.trim().toLowerCase())
        ? null
        : `choose one of ${POST_TYPE_CHOICES.join(', ')}.`,
    build: (c) => (p) => p.type === c.value.trim().toLowerCase(),
  },
  expando: {
    help: 'same as type:',
    check: (c) =>
      c.op === ':' && TYPE_CHOICES.includes(c.value.trim().toLowerCase())
        ? null
        : `choose one of ${POST_TYPE_CHOICES.join(', ')}.`,
    build: (c) => (p) => p.type === c.value.trim().toLowerCase(),
  },
  usertag: textMatch(
    'the author has a tag from you (optionally containing text or /regex/)',
    false,
    (p, e) => (p.author ? (e.userTag(p.author.toLowerCase()) ?? null) : null),
    true,
  ),
  opened: flag('you have opened this post’s comments before (needs “Read comments”)', (p, e) => {
    const prior = e.readPrior(p.id);
    return !!prior;
  }),
  age: {
    help: 'age of the post, e.g. age>12h, age<3d (units m, h, d, w; no unit = hours)',
    check: (c) =>
      c.op && c.op !== ':' && AGE.test(c.value.trim())
        ? null
        : 'write it as age>12h (units m, h, d, w).',
    build: (c) => {
      const m = AGE.exec(c.value.trim())!;
      const ms = Number(m[1]) * UNIT_MS[(m[2] || 'h').toLowerCase()]!;
      return (p, e) => !!p.created && compare(c.op, e.now - p.created.getTime(), ms);
    },
  },
  after: dateAtom('posted on or after a date: after:2026-03-01', true),
  before: dateAtom('posted before a date: before:2026-03-01', false),
  selector: {
    help: 'the post element matches a CSS selector: selector:"[flair]"',
    check: (c) => {
      if (c.op !== ':' || !c.value.trim()) return 'write it as selector:"css".';
      try {
        document.createElement('div').matches(c.value);
        return null;
      } catch {
        return 'that is not a valid CSS selector.';
      }
    },
    build: (c) => (p) => {
      try {
        return p.source.matches(c.value);
      } catch {
        return false;
      }
    },
  },
  vote: {
    help: 'your vote on the post: vote:up, vote:down or vote:none (read when the post is evaluated)',
    check: (c) =>
      c.op === ':' && ['up', 'down', 'none'].includes(c.value.trim().toLowerCase())
        ? null
        : 'use vote:up, vote:down or vote:none.',
    build: (c) => (p) => voteOnPost(p) === c.value.trim().toLowerCase(),
  },
  voteweight: numeric(
    'your net votes (up minus down) on the author, e.g. voteweight<-2',
    (p, e) => {
      const v = p.author ? e.votes(p.author.toLowerCase()) : undefined;
      return v ? v.up - v.down : null;
    },
  ),
  attr: {
    help: `the author is ${ATTRS.join(', ')}`,
    check: (c) =>
      c.op === ':' && (ATTRS as readonly string[]).includes(c.value.trim().toLowerCase())
        ? null
        : `use attr:${ATTRS.join(' / attr:')}. (Moderator, admin and OP status are not shown on posts.)`,
    build: (c) => {
      const what = c.value.trim().toLowerCase();
      return (p, e) => {
        const a = p.author?.toLowerCase();
        if (!a) return false;
        if (what === 'friend') return e.friends.has(a);
        if (what === 'me') return e.me?.toLowerCase() === a;
        if (what === 'ignored') return e.ignored(a);
        return e.userTag(a) !== undefined;
      };
    },
  },
};

export const compilePostCondition = (text: string): Compiled<Post, PostEnv> =>
  compileExpression(text, postConditions);
export const checkPostCondition = (text: string): string | null =>
  checkExpression(text, postConditions);

export const POST_CONDITION_HELP = Object.entries(postConditions)
  .map(([k, v]) => `${k}: ${v.help}`)
  .join('\n');
