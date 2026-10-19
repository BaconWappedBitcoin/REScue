import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionApi, type ActionTarget } from '../../src/core/actions';
import type { BridgeRequest, BridgeResponse } from '../../src/core/bridge-protocol';
import { KeyDispatcher } from '../../src/core/keys';
import type { BridgeApi } from '../../src/core/types';
import { Selection } from '../../src/layout/native/selection';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import type { Comment, Post } from '../../src/model/types';
import { keyboardActions } from '../../src/modules/actions/keyboardActions';
import {
  addCommentOverflowMenu,
  addPostOverflowMenu,
  listingHtml,
  mount,
  nestedThreadHtml,
  threadComments,
} from '../fixtures/pages';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ---- ActionApi: save / hide through the item's own menu --------------------------------------

/**
 * A stand-in for Reddit's menu behind the bridge. `saved` / `hidden` are the row's current text;
 * a menu.item click flips a save and sets a hide (unless `confirm: false` simulates Reddit ignoring
 * it). `rowState: null` makes the row unreadable, `rowError` fails the op outright.
 */
function menuBridge(
  o: {
    saved?: boolean;
    hidden?: boolean;
    rowState?: 'on' | 'off' | null;
    rowError?: string;
    confirm?: boolean;
  } = {},
) {
  let saved = o.saved ?? false;
  let hidden = o.hidden ?? false;
  const requests: BridgeRequest[] = [];
  const bridge: BridgeApi = {
    ref: () => 'r1',
    async request(body): Promise<BridgeResponse> {
      requests.push(body);
      if (body.op !== 'menu.item' && body.op !== 'menu.state') {
        return { ok: false, error: 'unsupported' };
      }
      if (o.rowError) return { ok: false, error: o.rowError };
      const on = body.item === 'save' ? saved : hidden;
      const itemState = o.rowState !== undefined ? o.rowState : on ? 'on' : 'off';
      if (itemState === null) return { ok: false, error: 'unreadable' };
      if (body.op === 'menu.item' && o.confirm !== false) {
        if (body.item === 'save') saved = !saved;
        else hidden = true;
      }
      return {
        ok: true,
        itemState,
        itemText: body.item === 'save' ? (on ? 'Unsave' : 'Save') : on ? 'Unhide' : 'Hide',
      };
    },
  };
  return { bridge, requests, state: () => ({ saved, hidden }) };
}

const post = (): ActionTarget => ({ id: 't3_x', source: document.createElement('shreddit-post') });
const comment = (): ActionTarget => ({
  id: 't1_c0',
  source: document.createElement('shreddit-comment'),
});
const signedIn = () => ({ signedIn: true, username: 'me' });
const fast = { sleep: () => Promise.resolve(), pollMs: 10, confirmMs: 50 };
const clicks = (reqs: BridgeRequest[]) => reqs.filter((r) => r.op === 'menu.item').length;

describe('ActionApi: save and hide', () => {
  it('saves a post by reading its menu row and clicking it, then confirming the Unsave text', async () => {
    const f = menuBridge({ saved: false });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.save(post(), true)).toEqual({ ok: true });
    expect(clicks(f.requests)).toBe(1);
    expect(f.requests[0]).toMatchObject({ op: 'menu.state', menu: 'post', item: 'save' });
    expect(f.state().saved).toBe(true);
  });

  it('does not click when the row already reads the wanted state', async () => {
    const f = menuBridge({ saved: true });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.save(post(), true)).toEqual({ ok: true });
    expect(clicks(f.requests)).toBe(0);
  });

  it('unsaves: the same call with on=false clicks the Unsave row back to Save', async () => {
    const f = menuBridge({ saved: true });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.save(post(), false)).toEqual({ ok: true });
    expect(clicks(f.requests)).toBe(1);
    expect(f.state().saved).toBe(false);
  });

  it('saves a comment through the comment menu', async () => {
    const f = menuBridge({ saved: false });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.save(comment(), true)).toEqual({ ok: true });
    expect(f.requests[0]).toMatchObject({ menu: 'comment', item: 'save' });
  });

  it('hides a post: it reads the Hide row, clicks, and confirms against the post leaving', async () => {
    const f = menuBridge({ hidden: false });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.hide(post(), true)).toEqual({ ok: true });
    expect(f.requests[0]).toMatchObject({ op: 'menu.state', menu: 'post', item: 'hide' });
    expect(f.state().hidden).toBe(true);
  });

  it('never hides a comment (Reddit has no Hide there)', async () => {
    const f = menuBridge({});
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.hide(comment(), true)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(f.requests).toEqual([]);
  });

  it('is not-found (clicking nothing) when the row is unreadable or missing', async () => {
    const unreadable = menuBridge({ rowState: null });
    const api = createActionApi({ bridge: unreadable.bridge, session: signedIn, ...fast });
    expect(await api.save(post(), true)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(clicks(unreadable.requests)).toBe(0);

    const missing = menuBridge({ rowError: 'not-found' });
    const api2 = createActionApi({ bridge: missing.bridge, session: signedIn, ...fast });
    expect(await api2.hide(post(), true)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(clicks(missing.requests)).toBe(0);
  });

  it('times out when Reddit never applies the click', async () => {
    const f = menuBridge({ saved: false, confirm: false });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.save(post(), true)).toMatchObject({ ok: false, reason: 'timeout' });
    expect(clicks(f.requests)).toBe(1);
  });

  it('signed out: asks the bridge for nothing', async () => {
    const f = menuBridge({});
    const api = createActionApi({
      bridge: f.bridge,
      session: () => ({ signedIn: false, username: null }),
    });
    expect(await api.save(post(), true)).toEqual({ ok: false, reason: 'signed-out' });
    expect(await api.hide(post(), true)).toEqual({ ok: false, reason: 'signed-out' });
    expect(await api.saveState(post())).toBeNull();
    expect(await api.hideState(post())).toBeNull();
    expect(f.requests).toEqual([]);
  });

  it('reads the saved / hidden state for the key toggles', async () => {
    const f = menuBridge({ saved: true, hidden: false });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.saveState(post())).toBe('on');
    expect(await api.hideState(post())).toBe('off');
    expect(await api.hideState(comment())).toBeNull();
  });
});

// ---- keyboard: s / Ctrl+S / h ----------------------------------------------------------------

const batch = (o: { posts?: Post[]; comments?: Comment[] }) => ({
  posts: o.posts ?? [],
  comments: o.comments ?? [],
  profileComments: [],
});
const posts = (): Post[] =>
  [...document.querySelectorAll('shreddit-post')]
    .map((el) => parsePost(el))
    .filter((p): p is Post => !!p);

describe('keyboard save / hide', () => {
  function setup(o: { onHideMoveDown?: boolean; signedIn?: boolean } = {}) {
    mount(listingHtml());
    const sel = new Selection();
    sel.track(batch({ posts: posts() }));
    sel.select(0);
    const keys = new KeyDispatcher();
    const saved: string[] = [];
    const save = vi.fn(async (_t: unknown, on: boolean) => {
      saved.push(on ? 'on' : 'off');
      return { ok: true as const };
    });
    const hide = vi.fn(async (_t: unknown) => ({ ok: true as const }));
    const shown: string[] = [];
    const ctx = {
      options: { onHideMoveDown: o.onHideMoveDown ?? true },
      session: { signedIn: o.signedIn ?? true, username: 'me' },
      ui: { selection: () => sel },
      keys: { register: (c: never) => keys.register(c) },
      actions: {
        saveState: async () => 'off',
        save,
        hide,
        voteState: async () => 0,
        vote: async () => ({ ok: true as const }),
      },
      notices: { show: (m: string) => void shown.push(m), dismiss: () => {} },
    };
    keyboardActions.init!(ctx as never);
    const press = (init: KeyboardEventInit) =>
      keys.handle(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    return { sel, keys, save, hide, saved, shown, press };
  }

  it('s saves the selected post, and again unsaves it', async () => {
    const t = setup();
    t.press({ key: 's' });
    await vi.waitFor(() => expect(t.save).toHaveBeenCalledTimes(1));
    expect(t.save.mock.calls[0]![1]).toBe(true);
    expect(t.shown).toEqual([]);
    t.sel.reset();
  });

  it('s asks for the opposite of what Reddit already shows', async () => {
    mount(listingHtml());
    const sel = new Selection();
    sel.track(batch({ posts: posts() }));
    sel.select(0);
    const keys = new KeyDispatcher();
    const save = vi.fn(async (_t: unknown, _on: boolean) => ({ ok: true as const }));
    const ctx = {
      options: { onHideMoveDown: true },
      session: { signedIn: true, username: 'me' },
      ui: { selection: () => sel },
      keys: { register: (c: never) => keys.register(c) },
      actions: { saveState: async () => 'on', save, voteState: async () => 0, vote: async () => ({ ok: true }) },
      notices: { show: () => {}, dismiss: () => {} },
    };
    keyboardActions.init!(ctx as never);
    keys.handle(new KeyboardEvent('keydown', { key: 's' }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![1]).toBe(false);
    sel.reset();
  });

  it('h hides the selected post and moves to the next when onHideMoveDown is on', async () => {
    const t = setup({ onHideMoveDown: true });
    const first = t.sel.current()!.id;
    t.press({ key: 'h' });
    await vi.waitFor(() => expect(t.hide).toHaveBeenCalledTimes(1));
    expect(t.sel.current()!.id).not.toBe(first);
    t.sel.reset();
  });

  it('h stays on the post when onHideMoveDown is off, and moves back when the hide fails', async () => {
    const off = setup({ onHideMoveDown: false });
    const first = off.sel.current()!.id;
    off.press({ key: 'h' });
    await vi.waitFor(() => expect(off.hide).toHaveBeenCalledTimes(1));
    expect(off.sel.current()!.id).toBe(first);
    off.sel.reset();

    document.body.innerHTML = '';
    const failing = setup({ onHideMoveDown: true });
    failing.hide.mockResolvedValueOnce({ ok: false, reason: 'timeout' } as never);
    const start = failing.sel.current()!.id;
    failing.press({ key: 'h' });
    await vi.waitFor(() => expect(failing.hide).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(failing.sel.current()!.id).toBe(start));
    expect(failing.shown).toContain('Reddit did not confirm the hide; it may not have gone through.');
    failing.sel.reset();
  });

  it('Ctrl+S saves the selected comment; the plain s key does not', async () => {
    mount(nestedThreadHtml(threadComments()));
    const sel = new Selection();
    sel.track(batch({ comments: parseComments(document, null) }));
    sel.select('t1_c0');
    const keys = new KeyDispatcher();
    const save = vi.fn(async () => ({ ok: true as const }));
    const ctx = {
      options: { onHideMoveDown: true },
      session: { signedIn: true, username: 'me' },
      ui: { selection: () => sel },
      keys: { register: (c: never) => keys.register(c) },
      actions: { saveState: async () => 'off', save, voteState: async () => 0, vote: async () => ({ ok: true }) },
      notices: { show: () => {}, dismiss: () => {} },
    };
    keyboardActions.init!(ctx as never);
    keys.handle(new KeyboardEvent('keydown', { key: 's' }));
    await Promise.resolve();
    expect(save).not.toHaveBeenCalled(); // a post-only key
    keys.handle(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    sel.reset();
  });

  it('signed out: says to sign in and presses nothing', async () => {
    const t = setup({ signedIn: false });
    t.save.mockResolvedValueOnce({ ok: false, reason: 'signed-out' } as never);
    t.press({ key: 's' });
    await vi.waitFor(() => expect(t.shown).toContain('Sign in to Reddit to save this.'));
    t.hide.mockResolvedValueOnce({ ok: false, reason: 'signed-out' } as never);
    t.press({ key: 'h' });
    await vi.waitFor(() => expect(t.shown).toContain('Sign in to Reddit to hide this.'));
    t.sel.reset();
  });

  it('the new keys do not clash with the navigation commands', () => {
    const t = setup();
    expect(t.keys.conflicts()).toEqual({});
    const byId = Object.fromEntries(t.keys.list().map((c) => [c.id, c.keys]));
    expect(byId.savePost).toEqual(['s']);
    expect(byId.saveComment).toEqual(['ctrl+s']);
    expect(byId.hide).toEqual(['h']);
    t.sel.reset();
  });
});

// ---- the fixture menus are honest on their own -----------------------------------------------

describe('overflow menu fixtures', () => {
  it('a post menu flips Save/Unsave and removes the post on Hide', () => {
    mount(listingHtml());
    const first = document.querySelector('shreddit-post')!;
    const clicked: string[] = [];
    addPostOverflowMenu(first, { onItem: (t) => clicked.push(t) });
    const rows = () =>
      [...first.querySelector('shreddit-post-overflow-menu')!.shadowRoot!.querySelectorAll('li')].map(
        (n) => n.textContent,
      );
    const row = (text: string) =>
      [...first.querySelector('shreddit-post-overflow-menu')!.shadowRoot!.querySelectorAll('li')].find(
        (n) => n.textContent === text,
      ) as HTMLElement;
    row('Save').click();
    expect(rows()).toContain('Unsave');
    row('Unsave').click();
    expect(rows()).toContain('Save');
    row('Hide').click();
    expect(document.body.contains(first)).toBe(false);
    expect(clicked).toEqual(['Save', 'Unsave', 'Hide']);
  });

  it('a comment menu flips Save/Unsave and offers Edit only when editable', () => {
    mount(nestedThreadHtml(threadComments()));
    const host = document.querySelector('shreddit-comment')!;
    const row = document.createElement('shreddit-comment-action-row');
    row.setAttribute('slot', 'actionRow');
    host.appendChild(row);
    addCommentOverflowMenu(row, { editable: true });
    const menu = row.querySelector('shreddit-overflow-menu')!;
    const items = () => [...menu.shadowRoot!.querySelectorAll('[role="menuitem"]')];
    expect(items().map((n) => n.textContent)).toContain('Edit comment');
    const save = items().find((n) => n.textContent === 'Save') as HTMLElement;
    save.click();
    expect(items().map((n) => n.textContent)).toContain('Unsave');
  });
});
