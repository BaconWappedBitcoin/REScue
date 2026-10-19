/**
 * The comment navigator's "custom" category and its "popular" conditions (RES commentNavigator
 * `custom` / `popularConditions`, GPL-3.0, the RES contributors): a condition written with the
 * same words as a filteReddit custom comment filter, turned into a yes/no test on a comment.
 * RES keeps these as a JSON condition tree; here they are one line of text.
 */
import { commentScoreOf } from '../../model/commentRow';
import { ownBody } from '../../model/access';
import type { Comment } from '../../model/types';
import type { ReadRecord } from '../../core/storage/prune';
import type { ModuleContext } from '../../core/types';
import { customToggleOn } from '../core/presets';
import {
  compileCommentCondition,
  type CommentEnv,
  type CommentFacts,
} from '../listings/filteReddit/commentConditions';
import type { UserTags } from '../users/tagStore';

export interface ConditionInput {
  ctx: ModuleContext;
  /** Lower-cased friend names (the "highlight" list). */
  friends: ReadonlySet<string>;
  tags: UserTags;
  /** The thread's record from before this view; null when read tracking is off. */
  prior: ReadRecord | undefined | null;
}

export type CommentTest = (c: Comment) => boolean;

export function commentFacts(c: Comment): CommentFacts {
  return {
    author: c.author,
    depth: c.depth,
    body: ownBody(c.source)?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    score: c.score ?? commentScoreOf(c.source),
    isOp: c.isOp,
    distinguished: c.distinguished,
    created: c.created,
  };
}

/** The environment a comment condition runs in, as of now. */
export function commentEnv(input: ConditionInput): CommentEnv {
  const { ctx, tags } = input;
  const profile = ctx.settings.profile();
  return {
    route: ctx.route,
    location: `${location.pathname}${location.search}`,
    me: ctx.session.username ?? null,
    now: Date.now(),
    toggleOn: (name) => customToggleOn(profile, name),
    friends: input.friends,
    userTag: (author) => tags[author]?.text || undefined,
    ignored: (author) => tags[author]?.ignored === true,
    readPrior: input.prior,
  };
}

/**
 * `text` as a test on comments. Null when the text is blank (nothing set), an error message when
 * it does not parse.
 */
export function conditionTest(
  text: string,
  input: ConditionInput,
): { test: CommentTest } | { error: string } | null {
  const t = text.trim();
  if (!t) return null;
  const compiled = compileCommentCondition(t);
  if (!compiled.ok) return { error: compiled.error };
  const env = commentEnv(input);
  return { test: (c) => compiled.test(commentFacts(c), env) };
}
