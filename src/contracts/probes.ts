/**
 * Live-verify probes: for each contract key, which page type to visit and what to expect.
 * Consumed by tests/live/verify-contracts.ts (Principle VI). Kept beside reddit.ts so a contract
 * change and its probe change land together.
 */
import { C } from './reddit';

export type ProbePage = 'listing' | 'thread' | 'profile' | 'hover-user' | 'hover-community';

export interface LiveProbe {
  key: string;
  page: ProbePage;
  /** Runs in the page; returns hits/total for the contract. total 0 means "not applicable here". */
  selector: string;
  /** Minimum fraction of `selector` matches that must satisfy `check`. */
  minRate: number;
  /** Attribute names that must be present on each matched element, if any. */
  attrs?: readonly string[];
}

export const PROBES: LiveProbe[] = [
  { key: 'app', page: 'listing', selector: C.app, minRate: 1 },
  { key: 'post', page: 'listing', selector: C.post, minRate: 1 },
  {
    key: 'post.attrs',
    page: 'listing',
    selector: C.post,
    minRate: 0.95,
    attrs: [C.postAttr.id, C.postAttr.title, C.postAttr.permalink],
  },
  { key: 'feed.partial', page: 'listing', selector: C.feedPartial, minRate: 1 },
  { key: 'commentTree', page: 'thread', selector: C.commentTree, minRate: 1 },
  {
    key: 'comment.attrs',
    page: 'thread',
    selector: C.comment,
    minRate: 0.95,
    attrs: [C.commentAttr.id, C.commentAttr.depth, C.commentAttr.author],
  },
  { key: 'comment.body', page: 'thread', selector: `${C.comment} ${C.commentBody}`, minRate: 1 },
  // Not every thread has a picture in a comment: 0 matches is "n/a", any match must be a figure.
  {
    key: 'comment.mediaFigure',
    page: 'thread',
    selector: `${C.comment} ${C.commentBody} ${C.commentMedia.figure}`,
    minRate: 1,
  },
  {
    key: 'comment.distinguished',
    page: 'thread',
    selector: C.comment,
    minRate: 0,
    attrs: [C.commentDistinguished.moderator],
  },
  // --- comment actions and post flags (R20). Rows hydrate lazily, so only some carry attributes. ---
  {
    key: 'comment.actionRow',
    page: 'thread',
    selector: C.commentActions.row,
    minRate: 0.2,
    attrs: [C.commentActions.voteStateAttr, C.commentActions.scoreAttr, C.commentActions.idAttr],
  },
  {
    key: 'comment.reply',
    page: 'thread',
    selector: `${C.commentActions.row} ${C.commentActions.replyButton}`,
    minRate: 0,
  },
  {
    key: 'comment.overflowMenu',
    page: 'thread',
    selector: `${C.commentActions.row} ${C.commentActions.overflowMenu}`,
    minRate: 0,
  },
  // A post carries its overflow menu (the Save / Hide rows open from it). Reported, never failed:
  // the menu is present but its rows only hydrate when it is opened.
  {
    key: 'post.saveHideMenu',
    page: 'listing',
    selector: `${C.post} ${C.saveHide.postMenu}`,
    minRate: 0,
  },
  {
    key: 'post.locked',
    page: 'listing',
    selector: C.post,
    minRate: 0,
    attrs: [C.postFlagAttrs.locked],
  },
  {
    key: 'post.stickied',
    page: 'listing',
    selector: C.post,
    minRate: 0,
    attrs: [C.postFlagAttrs.stickied],
  },
  // --- promoted slots (R21). Ads come and go, so these are reported (minRate 0), never failed. ---
  {
    key: 'promoted.post',
    page: 'listing',
    selector: C.promoted.post,
    minRate: 0,
    attrs: ['promoted'],
  },
  { key: 'promoted.comment', page: 'thread', selector: C.promoted.comment, minRate: 0 },
  { key: 'promoted.sidebar', page: 'listing', selector: C.promoted.sidebar, minRate: 0 },
  {
    key: 'promoted.label',
    page: 'listing',
    selector: `${C.promoted.post} ${C.promoted.label.scope} ${C.promoted.label.className}`,
    minRate: 0,
  },
  {
    key: 'post.authorLink',
    page: 'listing',
    selector: `${C.post} ${C.postAuthorLink}`,
    minRate: 1,
  },
  {
    key: 'post.slots',
    page: 'listing',
    selector: `${C.post} [slot="${C.slots.postCredit}"], ${C.post} [slot="${C.slots.postTitle}"]`,
    minRate: 1,
  },
  {
    key: 'comment.authorLink',
    page: 'thread',
    selector: `${C.comment} [slot="${C.slots.commentMeta}"] ${C.commentAuthorLink}`,
    minRate: 1,
  },
  {
    key: 'comment.slots',
    page: 'thread',
    selector: `${C.comment} [slot="${C.slots.commentMeta}"]`,
    minRate: 1,
  },
  { key: 'hover.user.card', page: 'hover-user', selector: C.hover.userCard, minRate: 1 },
  { key: 'hover.user.cakeDay', page: 'hover-user', selector: C.hover.cakeDay, minRate: 1 },
  { key: 'hover.user.karma', page: 'hover-user', selector: C.hover.karma, minRate: 1 },
  {
    key: 'hover.community.activeCount',
    page: 'hover-community',
    selector: C.hover.communityActive,
    minRate: 1,
  },
];
