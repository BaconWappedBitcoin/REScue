import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyDispatcher } from '../../src/core/keys';
import { Selection } from '../../src/layout/native/selection';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import type { Comment, Post } from '../../src/model/types';
import { buildCommands } from '../../src/modules/listings/keyboardNav/commands';
import type { NavEnv } from '../../src/modules/listings/keyboardNav/env';
import { MODMAIL_URL } from '../../src/modules/listings/keyboardNav/goCommands';
import { listingHtml, mount, nestedThreadHtml, threadComments } from '../fixtures/pages';

const batch = (o: { posts?: Post[]; comments?: Comment[] }) => ({
  posts: o.posts ?? [],
  comments: o.comments ?? [],
  profileComments: [],
});
const posts = (): Post[] =>
  [...document.querySelectorAll('shreddit-post')]
    .map((el) => parsePost(el))
    .filter((p): p is Post => !!p);
const idOf = (s: Selection) => s.current()?.id ?? null;
const path = (u: string | undefined) => new URL(u!).pathname;

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('command table additions', () => {
  let sel: Selection;
  let keys: KeyDispatcher;
  let opened: Array<{ urls: string[]; active: boolean }>;
  let assigned: string[];
  let notices: string[];
  let prefs: ReturnType<NavEnv['linkNumbers']>;
  let kind: 'thread' | 'front';

  const press = (init: KeyboardEventInit) =>
    keys.handle(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  beforeEach(() => {
    sel = new Selection();
    keys = new KeyDispatcher();
    opened = [];
    assigned = [];
    notices = [];
    prefs = { enabled: true, keys: 'digit', newTab: true };
    kind = 'front';
    vi.stubGlobal('location', {
      ...window.location,
      origin: 'https://www.reddit.com',
      assign: (u: string) => assigned.push(u),
    });
    const env: NavEnv = {
      ctx: {
        session: { signedIn: true, username: 'me_the_reader' },
        notices: { show: (m: string) => notices.push(m), dismiss: () => {} },
      } as never,
      sel: () => sel,
      route: () => ({ kind, path: '/', subreddit: 'programming' }),
      inNewTab: () => false,
      linkNumbers: () => prefs,
      openTabs: (urls, active) => opened.push({ urls, active }),
      toggleHelp: () => {},
      helpOpen: () => false,
      closeHelp: () => {},
    };
    for (const c of buildCommands(env)) keys.register(c);
  });
  afterEach(() => sel.reset());

  const selectPost = (id: string) => {
    mount(listingHtml());
    sel.track(batch({ posts: posts() }));
    sel.select(id);
  };

  it('registers no key twice in one context, including the new ones', () => {
    expect(keys.conflicts()).toEqual({});
  });

  it('has the RES default keys for the new commands', () => {
    const byId = Object.fromEntries(keys.list().map((c) => [c.id, c.keys]));
    expect(byId.undoMove).toEqual(['ctrl+z']);
    expect(byId.moveDownParentSibling).toEqual(['alt+j']);
    expect(byId.followCommentsNewTab).toEqual(['shift+c']);
    expect(byId.followSubredditNewTab).toEqual(['shift+r']);
    expect(byId.followProfileNewTab).toEqual(['shift+u']);
    expect(byId.copyPermalink).toEqual(['y']);
    expect(byId.copyLink).toEqual(['shift+y']);
    expect(byId.focusSearch).toEqual(['alt+/']);
    expect(byId.modmail).toEqual(['g m']);
    expect(byId.modmailNewTab).toEqual(['g shift+m']);
    expect(byId.randomSubreddit).toEqual(['g alt+y']);
    expect(byId.inboxNewTab).toEqual(['g shift+i']);
    expect(byId.profileNewTab).toEqual(['g shift+u']);
    expect(byId.openLink1).toEqual(['1', 'alt+1']);
    expect(byId.openLink10).toEqual(['0', 'alt+0']);
  });

  it('Ctrl+Z goes back to the previously selected item', () => {
    selectPost('t3_text1');
    sel.move(1);
    const second = idOf(sel);
    press({ key: 'z', ctrlKey: true });
    expect(idOf(sel)).toBe('t3_text1');
    expect(second).not.toBe('t3_text1');
  });

  it('Alt+J, in a thread, skips to the parent’s next sibling', () => {
    mount(nestedThreadHtml());
    sel.track(batch({ comments: parseComments(document, null) }));
    sel.select('t1_c2');
    press({ key: 'j', code: 'KeyJ', altKey: true });
    expect(idOf(sel)).toBe('t1_c2');
    kind = 'thread';
    press({ key: 'j', code: 'KeyJ', altKey: true });
    expect(idOf(sel)).toBe('t1_c3');
  });

  it('Shift+C, Shift+R and Shift+U open comments, subreddit and user in new tabs', () => {
    selectPost('t3_link1');
    press({ key: 'C', shiftKey: true });
    press({ key: 'R', shiftKey: true });
    press({ key: 'U', shiftKey: true });
    expect(opened.map((o) => path(o.urls[0]))).toEqual([
      '/r/nottheonion/comments/link1/nasa/',
      '/r/nottheonion/',
      '/user/kleudorian/',
    ]);
    expect(opened.every((o) => o.active && o.urls.length === 1)).toBe(true);
    expect(assigned).toEqual([]);
  });

  it('r and u still go to the page in this tab', () => {
    selectPost('t3_link1');
    press({ key: 'r' });
    press({ key: 'u' });
    expect(assigned.map((u) => path(u))).toEqual(['/r/nottheonion/', '/user/kleudorian/']);
  });

  describe('copying', () => {
    let written: string[];
    beforeEach(() => {
      written = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (t: string) => void written.push(t) },
      });
    });

    it('y copies the permalink and says so; Shift+Y copies the link URL', async () => {
      selectPost('t3_link1');
      press({ key: 'y' });
      await vi.waitFor(() => expect(notices).toEqual(['Copied the permalink.']));
      expect(path(written[0])).toBe('/r/nottheonion/comments/link1/nasa/');
      press({ key: 'Y', shiftKey: true });
      await vi.waitFor(() => expect(written).toHaveLength(2));
      expect(written[1]).toBe('https://example.co.uk/nasa');
      expect(notices[1]).toBe('Copied the link.');
    });

    it('says when copying fails, and does nothing without a selection', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => Promise.reject(new Error('denied')) },
      });
      selectPost('t3_link1');
      press({ key: 'y' });
      await vi.waitFor(() => expect(notices).toEqual(['REScue could not copy the permalink.']));
      sel.clear();
      press({ key: 'y' });
      expect(notices).toHaveLength(1);
    });
  });

  describe('go mode extras', () => {
    const go = (...chords: KeyboardEventInit[]) => chords.forEach(press);
    it('g m is modmail and g shift+m opens it in a new tab', () => {
      go({ key: 'g' }, { key: 'm' });
      expect(assigned).toEqual([MODMAIL_URL]);
      go({ key: 'g' }, { key: 'M', shiftKey: true });
      expect(opened.map((o) => o.urls[0])).toEqual([MODMAIL_URL]);
    });
    it('g alt+y is a random subreddit', () => {
      go({ key: 'g' }, { key: 'Â¥', code: 'KeyY', altKey: true });
      expect(assigned).toEqual(['/r/random/']);
    });
    it('has new-tab variants for inbox and your profile', () => {
      go({ key: 'g' }, { key: 'I', shiftKey: true });
      go({ key: 'g' }, { key: 'U', shiftKey: true });
      expect(opened.map((o) => path(o.urls[0]))).toEqual([
        '/message/inbox/',
        '/user/me_the_reader/',
      ]);
    });
    it('g a and g alt+a go nowhere (Reddit now redirects r/all home)', () => {
      go({ key: 'g' }, { key: 'a', code: 'KeyA', altKey: true });
      go({ key: 'g' }, { key: 'a' });
      expect(assigned).toEqual([]);
    });
  });

  it('Alt+/ focuses Reddit’s search box', () => {
    document.body.innerHTML = '<form><input name="q"></form>';
    const q = document.querySelector('input[name="q"]')!;
    q.getBoundingClientRect = () => ({ width: 200, height: 30 }) as DOMRect;
    press({ key: '/', code: 'Slash', altKey: true });
    expect(document.activeElement).toBe(q);
  });

  describe('Enter on a comment', () => {
    beforeEach(() => {
      kind = 'thread';
      mount(nestedThreadHtml(threadComments(), false, true));
      sel.track(batch({ comments: parseComments(document, null) }));
      sel.select('t1_c1');
    });
    const details = () =>
      [...document.querySelectorAll('shreddit-comment')]
        .find((c) => c.getAttribute('thingid') === 't1_c1')!
        .querySelector('details') as HTMLDetailsElement;

    it('collapses it, and expands it again', async () => {
      expect(details().open).toBe(true);
      press({ key: 'Enter' });
      await vi.waitFor(() => expect(details().open).toBe(false));
      press({ key: 'Enter' });
      await vi.waitFor(() => expect(details().open).toBe(true));
    });

    it('leaves Enter on a focused control to that control', () => {
      const summary = details().querySelector('summary')!;
      const ev = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      summary.addEventListener('keydown', (e) => keys.handle(e as KeyboardEvent), { once: true });
      summary.dispatchEvent(ev);
      expect(details().open).toBe(true);
      expect(ev.defaultPrevented).toBe(false);
    });

    it('still follows the link on a post', () => {
      selectPost('t3_link1');
      press({ key: 'Enter' });
      expect(assigned).toEqual(['https://example.co.uk/nasa']);
    });
  });

  describe('opening numbered links', () => {
    beforeEach(() => {
      kind = 'thread';
      const cs = threadComments();
      cs[0]!.bodyHtml = '<p><a href="https://a.example/1">one</a> <a href="/r/foo">two</a></p>';
      mount(nestedThreadHtml(cs));
      sel.track(batch({ comments: parseComments(document, null) }));
      sel.select('t1_c0');
    });

    it('a number key opens that link in a new tab by default', () => {
      press({ key: '2' });
      expect(opened).toHaveLength(1);
      expect(path(opened[0]!.urls[0])).toBe('/r/foo');
      press({ key: '1' });
      expect(opened[1]!.urls).toEqual(['https://a.example/1']);
    });

    it('lets a key through when there is no such link, nothing selected, or numbers are off', () => {
      const ev = new KeyboardEvent('keydown', { key: '5', cancelable: true });
      keys.handle(ev);
      expect(ev.defaultPrevented).toBe(false);
      prefs = { ...prefs, enabled: false };
      const off = new KeyboardEvent('keydown', { key: '1', cancelable: true });
      keys.handle(off);
      expect(off.defaultPrevented).toBe(false);
      expect(opened).toEqual([]);
      prefs = { ...prefs, enabled: true };
      sel.clear();
      const none = new KeyboardEvent('keydown', { key: '1', cancelable: true });
      keys.handle(none);
      expect(none.defaultPrevented).toBe(false);
    });

    it('opens in this tab when the option says so, and Alt+number does the opposite', () => {
      prefs = { ...prefs, newTab: false };
      press({ key: '1' });
      expect(assigned).toEqual(['https://a.example/1']);
      press({ key: '2', code: 'Digit2', altKey: true });
      expect(opened.map((o) => path(o.urls[0]))).toEqual(['/r/foo']);
    });

    it('in Alt mode plain digits stay free and Alt+number opens the link', () => {
      prefs = { ...prefs, keys: 'alt' };
      const plain = new KeyboardEvent('keydown', { key: '1', cancelable: true });
      keys.handle(plain);
      expect(plain.defaultPrevented).toBe(false);
      expect(opened).toEqual([]);
      press({ key: 'Â¡', code: 'Digit1', altKey: true });
      expect(opened.map((o) => o.urls[0])).toEqual(['https://a.example/1']);
    });
  });
});
