import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionApi, type ActionTarget } from '../../src/core/actions';
import type { BridgeRequest, BridgeResponse } from '../../src/core/bridge-protocol';
import { KeyDispatcher } from '../../src/core/keys';
import type { BridgeApi } from '../../src/core/types';
import { Selection } from '../../src/layout/native/selection';
import { parseComments } from '../../src/model/comment';
import { commentScoreOf, ownActionRow, watchCommentRows } from '../../src/model/commentRow';
import { parsePost } from '../../src/model/post';
import { keyboardActions } from '../../src/modules/actions/keyboardActions';
import { parseStops, scoreColor, validateStopRow } from '../../src/modules/actions/scoreColor';
import { scoreLabel, voteEnhancements } from '../../src/modules/actions/voteEnhancements';
import {
  compileCommentRules,
  matchComment,
  validateCommentRule,
  type CommentRule,
} from '../../src/modules/listings/filteReddit/commentRules';
import {
  compileRules,
  matchPost,
  type FilterRule,
} from '../../src/modules/listings/filteReddit/rules';
import { buildCommands, type NavEnv } from '../../src/modules/listings/keyboardNav/commands';
import { attachVoteCounter } from '../../src/modules/users/voteCounter';
import { listingHtml, mount, nestedThreadHtml, threadComments } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** Give a comment element Reddit's action row, optionally with an open root holding vote buttons. */
function addRow(
  host: Element,
  attrs: Record<string, string> = {},
  buttons?: { up?: boolean; down?: boolean },
): Element {
  const row = document.createElement('shreddit-comment-action-row');
  row.setAttribute('slot', 'actionRow');
  for (const [k, v] of Object.entries(attrs)) row.setAttribute(k, v);
  if (buttons) {
    const root = row.attachShadow({ mode: 'open' });
    root.innerHTML = `<button upvote aria-pressed="${!!buttons.up}"></button><button downvote aria-pressed="${!!buttons.down}"></button>`;
  }
  host.appendChild(row);
  return row;
}

const commentEls = (): Element[] => [...document.querySelectorAll('shreddit-comment')];

// ---- ActionApi: comments --------------------------------------------------------------------

/**
 * A comment's controls behind the bridge. `aria` is what the buttons read, `row` what the action
 * row's vote-state attribute reads (null: no known value); after a click the row follows the
 * buttons `rowLag` state reads later.
 */
function commentBridge(o: {
  aria?: -1 | 0 | 1;
  row?: -1 | 0 | 1 | null;
  rowLag?: number;
  rowNever?: boolean;
  focused?: boolean;
  clickError?: string;
  composerError?: string;
}) {
  let aria = o.aria ?? 0;
  let row: -1 | 0 | 1 | null = o.row === undefined ? aria : o.row;
  let lag = -1;
  const requests: BridgeRequest[] = [];
  const bridge: BridgeApi = {
    ref: () => 'c1',
    async request(body): Promise<BridgeResponse> {
      requests.push(body);
      if (body.op === 'native.click') {
        if (o.clickError) return { ok: false, error: o.clickError };
        if (body.control === 'upvote' || body.control === 'downvote') {
          const target = body.control === 'upvote' ? 1 : -1;
          aria = aria === target ? 0 : target;
          lag = o.rowLag ?? 0;
        }
        return { ok: true };
      }
      if (body.op === 'native.state') {
        if (lag === 0 && !o.rowNever && row !== null) row = aria;
        if (lag > 0) lag--;
        const pressed = body.control === 'upvote' ? aria === 1 : aria === -1;
        return { ok: true, pressed, voteState: row };
      }
      if (body.op === 'composer.focus') {
        if (o.composerError) return { ok: false, error: o.composerError };
        return { ok: true, focused: o.focused ?? true };
      }
      return { ok: false, error: 'unsupported' };
    },
  };
  return { bridge, requests };
}

const comment: ActionTarget = { id: 't1_c0', source: document.createElement('shreddit-comment') };
const signedIn = () => ({ signedIn: true, username: 'me' });
const fast = { sleep: () => Promise.resolve(), pollMs: 10, confirmMs: 100 };

describe('ActionApi: comment votes', () => {
  it('confirms from aria-pressed while the row attribute lags', async () => {
    const f = commentBridge({ rowLag: 3 });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(comment, 1)).toEqual({ ok: true });
    const clicks = f.requests.filter((r) => r.op === 'native.click');
    expect(clicks).toEqual([{ op: 'native.click', ref: 'c1', control: 'upvote' }]);
  });

  it('is confirmed from the buttons even while the row attribute stays stale (seen live)', async () => {
    const f = commentBridge({ rowNever: true, row: 0 });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(comment, 1)).toEqual({ ok: true });
    // The stale row must not block clearing the vote again straight away.
    expect(await api.vote(comment, 0)).toEqual({ ok: true });
    const clicks = f.requests.filter((r) => r.op === 'native.click');
    expect(clicks.map((c) => (c as { control: string }).control)).toEqual(['upvote', 'upvote']);
  });

  it('confirms from aria-pressed alone when the row has no known vote-state', async () => {
    const f = commentBridge({ row: null });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(comment, -1)).toEqual({ ok: true });
  });

  it('voteState reads the buttons, and clearing presses the pressed one', async () => {
    const f = commentBridge({ aria: -1 });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.voteState(comment)).toBe(-1);
    expect(await api.vote(comment, 0)).toEqual({ ok: true });
    expect(f.requests).toContainEqual({ op: 'native.click', ref: 'c1', control: 'downvote' });
  });
});

describe('ActionApi: startReply / startEdit', () => {
  it('signed out: asks the bridge for nothing', async () => {
    const f = commentBridge({});
    const api = createActionApi({
      bridge: f.bridge,
      session: () => ({ signedIn: false, username: null }),
    });
    expect(await api.startReply(comment)).toEqual({ ok: false, reason: 'signed-out' });
    expect(await api.startEdit(comment)).toEqual({ ok: false, reason: 'signed-out' });
    expect(f.requests).toEqual([]);
  });

  it('reply: presses Reddit’s reply button, then succeeds only when the box has the focus', async () => {
    const f = commentBridge({});
    const api = createActionApi({ bridge: f.bridge, session: signedIn });
    expect(await api.startReply(comment)).toEqual({ ok: true });
    expect(f.requests.map((r) => r.op)).toEqual(['native.click', 'composer.focus']);
    expect(f.requests[0]).toMatchObject({ control: 'reply' });

    const blind = commentBridge({ focused: false });
    const r = await createActionApi({ bridge: blind.bridge, session: signedIn }).startReply(
      comment,
    );
    expect(r).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('edit: presses the Edit item; a comment that is not yours is rejected', async () => {
    const f = commentBridge({});
    const ok = await createActionApi({ bridge: f.bridge, session: signedIn }).startEdit(comment);
    expect(ok).toEqual({ ok: true });
    expect(f.requests[0]).toMatchObject({ op: 'native.click', control: 'edit' });

    const theirs = commentBridge({ clickError: 'not-editable' });
    expect(
      await createActionApi({ bridge: theirs.bridge, session: signedIn }).startEdit(comment),
    ).toMatchObject({ ok: false, reason: 'rejected', detail: 'not-editable' });
    expect(theirs.requests.map((r) => r.op)).toEqual(['native.click']);
  });

  it('a missing button or box is not-found', async () => {
    const none = commentBridge({ clickError: 'not-found' });
    expect(
      await createActionApi({ bridge: none.bridge, session: signedIn }).startReply(comment),
    ).toMatchObject({ ok: false, reason: 'not-found' });
    const noBox = commentBridge({ composerError: 'not-found' });
    expect(
      await createActionApi({ bridge: noBox.bridge, session: signedIn }).startReply(comment),
    ).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

// ---- keyboard: a / z / r / e on a comment ---------------------------------------------------

describe('keyboard actions on a comment', () => {
  function setup(opts: { selectPost?: boolean } = {}) {
    mount(nestedThreadHtml(threadComments()));
    const sel = new Selection();
    const comments = parseComments(document, 'rockpaperblr');
    sel.track({
      posts: opts.selectPost ? [parsePost(document.querySelector('shreddit-post')!)!] : [],
      comments,
      profileComments: [],
    });
    sel.select(0);
    const keys = new KeyDispatcher();
    const vote = vi.fn(async (_t: unknown, _d: number) => ({ ok: true as const }));
    const startReply = vi.fn(async (_t: unknown) => ({ ok: true as const }));
    const startEdit = vi.fn(
      async (
        _t: unknown,
      ): Promise<{ ok: true } | { ok: false; reason: 'rejected'; detail: string }> => ({
        ok: true,
      }),
    );
    const shown: string[] = [];
    const ctx = {
      options: { moveDownAfterVote: false },
      session: { signedIn: true, username: 'me' },
      ui: { selection: () => sel },
      keys: { register: (c: never) => keys.register(c) },
      actions: { voteState: async () => 0, vote, startReply, startEdit },
      notices: { show: (m: string) => void shown.push(m), dismiss: () => {} },
    };
    keyboardActions.init!(ctx as never);
    const press = (init: KeyboardEventInit) =>
      keys.handle(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    return { sel, comments, vote, startReply, startEdit, shown, press, keys };
  }

  it('a and z vote on the selected comment, with no “not possible” notice', async () => {
    const t = setup();
    t.press({ key: 'a' });
    await vi.waitFor(() => expect(t.vote).toHaveBeenCalledTimes(1));
    expect(t.vote.mock.calls[0]![0]).toMatchObject({ id: 't1_c0', source: t.comments[0]!.source });
    expect(t.vote.mock.calls[0]![1]).toBe(1);
    t.press({ key: 'Z', shiftKey: true });
    await vi.waitFor(() => expect(t.vote).toHaveBeenCalledTimes(2));
    expect(t.vote.mock.calls[1]![1]).toBe(-1);
    expect(t.shown).toEqual([]);
    t.sel.reset();
  });

  it('r replies and e edits the selected comment', async () => {
    const t = setup();
    t.press({ key: 'r' });
    await vi.waitFor(() => expect(t.startReply).toHaveBeenCalledTimes(1));
    t.press({ key: 'e' });
    await vi.waitFor(() => expect(t.startEdit).toHaveBeenCalledTimes(1));
    expect(t.startReply.mock.calls[0]![0]).toMatchObject({ id: 't1_c0' });
    expect(t.shown).toEqual([]);
    t.sel.reset();
  });

  it('r and e do nothing with a post selected, so r keeps its subreddit meaning', async () => {
    const t = setup({ selectPost: true });
    // The post is first in the selection order, then the comments.
    t.sel.select(0);
    expect(t.sel.current()?.kind).toBe('post');
    t.press({ key: 'r' });
    t.press({ key: 'e' });
    await tick();
    expect(t.startReply).not.toHaveBeenCalled();
    expect(t.startEdit).not.toHaveBeenCalled();
    t.sel.reset();
  });

  it('says what went wrong when the reply or edit could not start', async () => {
    const t = setup();
    t.startReply.mockResolvedValueOnce({ ok: false, reason: 'signed-out' } as never);
    t.press({ key: 'r' });
    await vi.waitFor(() => expect(t.shown).toContain('Sign in to Reddit to reply.'));
    t.startEdit.mockResolvedValueOnce({ ok: false, reason: 'rejected', detail: 'not-editable' });
    t.press({ key: 'e' });
    await vi.waitFor(() => expect(t.shown).toContain('You can only edit your own comments.'));
    t.sel.reset();
  });

  it('r and the subreddit command never claim the same selection', () => {
    const nav: NavEnv = {
      ctx: { session: { signedIn: true, username: 'me' } } as never,
      sel: () => sel,
      route: () => ({ kind: 'thread', path: '/' }),
      inNewTab: () => false,
      linkNumbers: () => ({ enabled: true, keys: 'digit', newTab: true }),
      openTabs: () => {},
      toggleHelp: () => {},
      helpOpen: () => false,
      closeHelp: () => {},
    };
    const t = setup();
    const sel = t.sel;
    const subreddit = buildCommands(nav).find((c) => c.id === 'followSubreddit')!;
    expect(subreddit.defaultKeys).toEqual(['r']);
    expect(sel.current()?.kind).toBe('comment');
    expect(subreddit.enabled!()).toBe(false);
    for (const c of buildCommands(nav)) t.keys.register(c);
    expect(t.keys.conflicts()).toEqual({}); // reply lives in the 'comments' context
    sel.reset();
  });
});

// ---- filters ------------------------------------------------------------------------------

const crule = (type: CommentRule['type'], pattern = '', action: CommentRule['action'] = 'hide') =>
  ({ type, pattern, action, enabled: true }) satisfies CommentRule;
const facts = (score: number | null | undefined) => ({
  author: 'a',
  depth: 0,
  body: 'text',
  ...(score === undefined ? {} : { score }),
});
const compiled = (r: CommentRule) => compileCommentRules([r]).rules;

describe('comment score rules', () => {
  it('score-below / score-above compare the score', () => {
    const below = compiled(crule('score-below', '5'));
    expect(matchComment(facts(4), below)).not.toBeNull();
    expect(matchComment(facts(5), below)).toBeNull();
    const above = compiled(crule('score-above', '100'));
    expect(matchComment(facts(101), above)).not.toBeNull();
    expect(matchComment(facts(100), above)).toBeNull();
    expect(matchComment(facts(-3), compiled(crule('score-below', '-2')))).not.toBeNull();
  });

  it('a hidden or unknown score is never filtered by score', () => {
    for (const type of ['score-below', 'score-above'] as const) {
      const rules = compiled(crule(type, '0'));
      expect(matchComment(facts(null), rules)).toBeNull();
      expect(matchComment(facts(undefined), rules)).toBeNull();
    }
  });

  it('needs a whole number', () => {
    expect(validateCommentRule(crule('score-below', 'ten'))).toMatch(/whole number/);
    expect(validateCommentRule(crule('score-above', '-12'))).toBeNull();
    expect(compileCommentRules([crule('score-below', '1.5')]).errors).toHaveLength(1);
  });
});

describe('post locked rule', () => {
  it('matches only posts carrying the locked attribute', () => {
    mount(listingHtml());
    const els = [...document.querySelectorAll('shreddit-post')];
    els[0]!.setAttribute('locked', '');
    els[1]!.setAttribute('locked', 'false');
    const [rule] = compileRules([
      {
        type: 'locked',
        pattern: '',
        scope: 'everywhere',
        subreddits: '',
        enabled: true,
        toggle: '',
      },
    ] satisfies FilterRule[]).rules;
    const ctx = { subreddit: undefined, toggleOn: () => true };
    expect(matchPost(parsePost(els[0]!)!, [rule!], ctx)).not.toBeNull();
    expect(matchPost(parsePost(els[1]!)!, [rule!], ctx)).toBeNull();
    expect(matchPost(parsePost(els[2]!)!, [rule!], ctx)).toBeNull();
    expect(parsePost(els[0]!)!.locked).toBe(true);
    expect(parsePost(els[2]!)!.stickied).toBe(false);
  });
});

// ---- the action row: scores ----------------------------------------------------------------

describe('commentScoreOf', () => {
  it('is unknown until the row is there, and for a hidden score', () => {
    mount(nestedThreadHtml(threadComments()));
    const [a, b, c] = commentEls();
    expect(commentScoreOf(a!)).toBeNull(); // no row yet: the comment's own "score" is not trusted
    addRow(a!, { score: '42', 'comment-id': 't1_c0' });
    expect(commentScoreOf(a!)).toBe(42);
    addRow(b!, { score: '1', 'is-score-hidden': '' });
    expect(commentScoreOf(b!)).toBeNull();
    addRow(c!, { score: '7', 'is-score-hidden': 'false', 'comment-id': 't1_c2' });
    expect(commentScoreOf(c!)).toBe(7);
  });

  it('only looks at the comment’s own row, never a nested reply’s', () => {
    mount(nestedThreadHtml(threadComments()));
    const [parent, child] = commentEls();
    expect(child!.closest('shreddit-comment')).toBe(child);
    expect(parent!.contains(child!)).toBe(true);
    const childRow = addRow(child!, { score: '9', 'comment-id': 't1_c1' });
    expect(ownActionRow(parent!)).toBeNull();
    expect(commentScoreOf(parent!)).toBeNull();
    expect(ownActionRow(child!)).toBe(childRow);
  });

  it('watchCommentRows reports a row that hydrates later', async () => {
    mount(nestedThreadHtml(threadComments()));
    const [a] = commentEls();
    const seen: Element[] = [];
    const stop = watchCommentRows((h) => seen.push(h));
    const row = addRow(a!);
    row.setAttribute('score', '5');
    await new Promise((r) => setTimeout(r, 120));
    expect(seen).toEqual([a]);
    stop();
  });
});

// ---- colours -----------------------------------------------------------------------------

describe('score colours', () => {
  const stops = parseStops([
    { score: '100', color: '#00ff00' },
    { score: '0', color: '#ff0000' },
    { score: 'x', color: '#000000' },
    { score: '5', color: 'red' },
  ]);

  it('keeps valid rows, sorted, and expands #rgb', () => {
    expect(stops.map((s) => s.score)).toEqual([0, 100]);
    expect(parseStops([{ score: '1', color: '#abc' }])[0]!.color).toBe('#aabbcc');
  });

  it('steps: the highest row at or below the score; none below the lowest', () => {
    expect(scoreColor(-1, stops, false)).toBeNull();
    expect(scoreColor(0, stops, false)).toBe('#ff0000');
    expect(scoreColor(99, stops, false)).toBe('#ff0000');
    expect(scoreColor(5000, stops, false)).toBe('#00ff00');
    expect(scoreColor(null, stops, false)).toBeNull();
  });

  it('interpolates between rows when asked', () => {
    expect(scoreColor(50, stops, true)).toBe('#808000');
    expect(scoreColor(100, stops, true)).toBe('#00ff00');
  });

  it('rejects bad rows at input', () => {
    expect(validateStopRow({ score: '', color: '' })).toBeNull();
    expect(validateStopRow({ score: 'a', color: '#fff' })).toMatch(/whole number/);
    expect(validateStopRow({ score: '1', color: 'blue' })).toMatch(/Colour/);
    expect(validateStopRow({ score: '1', color: '#123456' })).toBeNull();
  });
});

describe('voteEnhancements score chips', () => {
  const comboOptions = (o: Record<string, unknown>) => ({ voteEnhancements: o as never });

  it('are off by default', async () => {
    mount(listingHtml());
    const m = await bootModules([voteEnhancements], { route: { kind: 'all', path: '/r/all' } });
    m.flush();
    expect(document.querySelector('.rescue-score-chip')).toBeNull();
    m.dispose();
  });

  it('colour post scores as REScue-drawn chips, leaving Reddit’s number alone', async () => {
    mount(listingHtml());
    const post = document.querySelector('shreddit-post')!;
    post.setAttribute('score', '1500');
    const before = post.outerHTML;
    const m = await bootModules([voteEnhancements], {
      route: { kind: 'all', path: '/r/all' },
      options: comboOptions({ colorLinkScore: true }),
    });
    m.flush();
    const chip = post.querySelector<HTMLElement>('.rescue-score-chip')!;
    expect(chip.textContent).toBe(scoreLabel(1500));
    expect(chip.style.color).not.toBe('');
    expect(chip.title).toMatch(/^REScue: /);
    expect(post.getAttribute('score')).toBe('1500');
    expect(before).toContain('score="1500"');
    m.dispose();
  });

  it('comments: nothing until the row says the score is shown, nothing when it is hidden', async () => {
    mount(nestedThreadHtml(threadComments()));
    const [a, b, c] = commentEls();
    addRow(a!, { score: '30', 'comment-id': 't1_c0' });
    addRow(b!, { score: '1', 'is-score-hidden': '', 'comment-id': 't1_c1' });
    const m = await bootModules([voteEnhancements], {
      route: { kind: 'thread', path: '/r/x/comments/1/x/' },
      options: comboOptions({ colorCommentScore: true }),
    });
    m.flush();
    const chipOf = (el: Element) =>
      [...el.querySelectorAll<HTMLElement>('.rescue-score-chip')].filter(
        (n) => n.closest('shreddit-comment') === el && !n.hidden,
      );
    expect(chipOf(a!)).toHaveLength(1);
    expect(chipOf(a!)[0]!.textContent).toBe('30 pts');
    expect(chipOf(b!)).toHaveLength(0);
    expect(chipOf(c!)).toHaveLength(0);
    // The third comment's row hydrates later: its chip appears then.
    addRow(c!, { score: '12', 'comment-id': 't1_c2' });
    await vi.waitFor(() => expect(chipOf(c!)).toHaveLength(1), { timeout: 2000 });
    m.dispose();
  });
});

// ---- real clicks on comment arrows feed the vote counter --------------------------------------

describe('vote counter: comment arrows', () => {
  it('counts a click on a comment’s own arrow, not a nested reply’s host', async () => {
    mount(nestedThreadHtml(threadComments()));
    const [parent, child] = commentEls();
    const parentRow = addRow(parent!, { 'comment-id': 't1_c0' }, {});
    addRow(child!, { 'comment-id': 't1_c1' }, {});
    const up = parentRow.shadowRoot!.querySelector<HTMLElement>('button[upvote]')!;
    let state: -1 | 0 | 1 = 0;
    const apply = vi.fn();
    const stop = attachVoteCounter({
      itemFor: (el) =>
        el === parent
          ? { id: 't1_c0', author: 'target' }
          : el === child
            ? { id: 't1_c1', author: 'other' }
            : undefined,
      me: () => 'me',
      voteState: async () => state,
      apply,
      acceptUntrusted: true,
      confirmMs: 600,
      pollMs: 150,
      sleep: async () => {},
    });
    up.click();
    state = 1;
    for (let i = 0; i < 20; i++) await tick();
    expect(apply).toHaveBeenCalledExactlyOnceWith('target', 1, 0);
    stop();
  });

  it('ignores an arrow whose root belongs to some other element', async () => {
    mount('<div id="x"><div id="stray"></div></div>');
    const stray = document.getElementById('stray')!;
    const root = stray.attachShadow({ mode: 'open' });
    root.innerHTML = '<button upvote aria-pressed="false"></button>';
    const apply = vi.fn();
    const stop = attachVoteCounter({
      itemFor: (el) => (el.id === 'x' ? { id: 't1_x', author: 'target' } : undefined),
      me: () => 'me',
      voteState: async () => 1,
      apply,
      acceptUntrusted: true,
      sleep: async () => {},
    });
    root.querySelector<HTMLElement>('button')!.click();
    for (let i = 0; i < 10; i++) await tick();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });
});
