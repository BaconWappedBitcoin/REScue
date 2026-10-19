import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chordOf, KeyDispatcher } from '../../src/core/keys';
import { Selection } from '../../src/layout/native/selection';
import { SelectionHistory } from '../../src/layout/native/selectionHistory';
import { safeColor, scrollDelta } from '../../src/layout/native/selectionView';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import type { Comment, Post } from '../../src/model/types';
import { keyboardActions } from '../../src/modules/actions/keyboardActions';
import { helpSections } from '../../src/modules/listings/keyboardNav/help';
import {
  badgeSpot,
  digitOf,
  indexOfDigit,
  LinkNumberOverlay,
  numberedLinks,
} from '../../src/modules/listings/keyboardNav/linkNumbers';
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

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SelectionHistory', () => {
  it('pops the most recent entry that is still wanted, dropping the rest', () => {
    const h = new SelectionHistory<number>();
    [1, 2, 3].forEach((n) => h.push(n));
    expect(h.pop((n) => n !== 3)).toBe(2);
    expect(h.size).toBe(1);
    expect(h.pop(() => false)).toBeUndefined();
    expect(h.size).toBe(0);
  });

  it('does not repeat the same entry back to back and is capped', () => {
    const h = new SelectionHistory<number>(3);
    [1, 1, 2, 3, 4].forEach((n) => h.push(n));
    expect(h.size).toBe(3);
    expect(h.pop(() => true)).toBe(4);
    expect(h.pop(() => true)).toBe(3);
    expect(h.pop(() => true)).toBe(2);
  });
});

describe('selection: undo, parent sibling, closest in view', () => {
  let sel: Selection;
  beforeEach(() => {
    sel = new Selection();
  });
  afterEach(() => sel.reset());

  it('undoes moves one step at a time, back to nothing', () => {
    mount(listingHtml());
    const ps = posts();
    sel.track(batch({ posts: ps }));
    sel.select(0);
    sel.move(1);
    sel.move(1);
    expect(idOf(sel)).toBe(ps[2]!.id);
    expect(sel.undo()).toBe(true);
    expect(idOf(sel)).toBe(ps[1]!.id);
    expect(sel.undo()).toBe(true);
    expect(idOf(sel)).toBe(ps[0]!.id);
    expect(sel.undo()).toBe(false);
    expect(idOf(sel)).toBe(ps[0]!.id);
  });

  it('returns to the item that was selected before Escape cleared it', () => {
    mount(listingHtml());
    const ps = posts();
    sel.track(batch({ posts: ps }));
    sel.select(1);
    sel.clear();
    expect(sel.undo()).toBe(true);
    expect(idOf(sel)).toBe(ps[1]!.id);
  });

  it('skips remembered items that were hidden or removed meanwhile', () => {
    mount(listingHtml());
    const ps = posts();
    sel.track(batch({ posts: ps }));
    sel.select(0);
    sel.select(1);
    sel.select(2);
    ps[1]!.source.closest('article')!.setAttribute('hidden', '');
    expect(sel.undo()).toBe(true);
    expect(idOf(sel)).toBe(ps[0]!.id);
  });

  it('forgets the history on a route change', () => {
    mount(listingHtml());
    sel.track(batch({ posts: posts() }));
    sel.select(0);
    sel.select(1);
    expect(sel.historySize()).toBe(1);
    sel.reset();
    expect(sel.historySize()).toBe(0);
  });

  describe('the jump scroll style (nonLinearScrollStyle)', () => {
    const rectAt = (top: number) =>
      ({ left: 0, right: 600, top, bottom: top + 100, width: 600, height: 100 }) as DOMRect;
    const scrolls = () => {
      const by = vi.fn();
      vi.stubGlobal('scrollBy', by);
      window.scrollBy = by as never;
      return by;
    };
    beforeEach(() => {
      mount(nestedThreadHtml());
      sel.track(batch({ comments: parseComments(document, null) }));
      // Every comment sits well below the window, so any scrolling style would move the page.
      for (const el of document.querySelectorAll('shreddit-comment'))
        el.getBoundingClientRect = () => rectAt(5000);
    });

    it('uses the jump style for sibling, thread, parent and undo, and the normal style for j/k', () => {
      const by = scrolls();
      sel.configure({ scrollStyle: 'directional', nonLinearScrollStyle: 'none' });
      sel.select('t1_c0', { scroll: false });
      sel.moveSibling(1);
      sel.moveThread(1);
      sel.toTop();
      sel.parent();
      sel.undo();
      expect(by).not.toHaveBeenCalled();
      sel.move(1); // one step: the normal style still scrolls
      expect(by).toHaveBeenCalled();
    });

    it('keeps one style for every move when set to "same"', () => {
      const by = scrolls();
      sel.configure({ scrollStyle: 'directional', nonLinearScrollStyle: 'same' });
      sel.select('t1_c0', { scroll: false });
      sel.moveThread(1);
      expect(by).toHaveBeenCalled();
    });
  });

  describe('moveParentSibling (Alt+J)', () => {
    // depths: c0:0 c1:1 c2:2 c3:1 c4:0 c5:1 c6:0 c7:0 c8:1 c9:2 c10:3 c11:0
    beforeEach(() => {
      mount(nestedThreadHtml());
      sel.track(batch({ comments: parseComments(document, null) }));
    });

    it('goes to the next comment at the parent’s level', () => {
      sel.select('t1_c2');
      expect(sel.moveParentSibling()).toBe(true);
      expect(idOf(sel)).toBe('t1_c3');
      expect(sel.moveParentSibling()).toBe(true);
      expect(idOf(sel)).toBe('t1_c4');
    });

    it('moves to the next thread from a top-level comment', () => {
      sel.select('t1_c0');
      expect(sel.moveParentSibling()).toBe(true);
      expect(idOf(sel)).toBe('t1_c4');
    });

    it('stays put when the parent has no later sibling', () => {
      sel.select('t1_c9');
      expect(sel.moveParentSibling()).toBe(false);
      expect(idOf(sel)).toBe('t1_c9');
    });
  });

  it('selects the first item whose top is clear of the header', () => {
    mount(listingHtml());
    const ps = posts();
    const tops = [10, 120, 500];
    ps.slice(0, 3).forEach((p, i) => {
      const wrapper = p.source.closest('article')!;
      wrapper.getBoundingClientRect = () =>
        ({
          left: 0,
          right: 600,
          top: tops[i]!,
          bottom: tops[i]! + 300,
          width: 600,
          height: 300,
        }) as DOMRect;
    });
    sel.track(batch({ posts: ps }));
    expect(sel.selectClosestInView()).toBe(true);
    expect(idOf(sel)).toBe(ps[1]!.id);
  });
});

describe('scroll styles', () => {
  const box = (top: number, bottom: number) => ({ left: 0, right: 100, top, bottom });
  it('directional scrolls only as far as needed', () => {
    expect(scrollDelta(box(200, 300), 800, 'directional')).toBe(0);
    expect(scrollDelta(box(10, 100), 800, 'directional')).toBe(10 - 72);
    expect(scrollDelta(box(700, 900), 800, 'directional')).toBe(900 - 784);
  });
  it('top puts the item under the header whatever its place', () => {
    expect(scrollDelta(box(300, 400), 800, 'top')).toBe(300 - 72);
  });
  it('middle centres an item that fits and top-aligns one that does not', () => {
    expect(scrollDelta(box(100, 200), 800, 'middle')).toBe(150 - 400);
    expect(scrollDelta(box(100, 2000), 800, 'middle')).toBe(100 - 72);
  });
  it('page leaves a fully visible item alone and top-aligns an off-screen one', () => {
    expect(scrollDelta(box(200, 300), 800, 'page')).toBe(0);
    expect(scrollDelta(box(790, 900), 800, 'page')).toBe(790 - 72);
  });
  it('legacy leaves a fully visible item alone and top-aligns anything else', () => {
    expect(scrollDelta(box(200, 300), 800, 'legacy')).toBe(0);
    expect(scrollDelta(box(790, 900), 800, 'legacy')).toBe(790 - 72);
    expect(scrollDelta(box(10, 100), 800, 'legacy')).toBe(10 - 72);
  });
  it('adopt puts the item where the previous one was, and falls back without one', () => {
    expect(scrollDelta(box(500, 600), 800, 'adopt', 200)).toBe(300);
    // The previous item was above the window: show the new one's top.
    expect(scrollDelta(box(500, 600), 800, 'adopt', -100)).toBe(500 - -100 + -100);
    // Below the window: keep at least its top 60px on screen.
    expect(scrollDelta(box(900, 1000), 800, 'adopt', 790)).toBe(900 - 790 + (790 - 800 + 60));
    expect(scrollDelta(box(10, 100), 800, 'adopt')).toBe(10 - 72);
  });
  it('none never scrolls', () => {
    expect(scrollDelta(box(5000, 5100), 800, 'none')).toBe(0);
  });
  it('only lets plain hex colours into the outline style', () => {
    expect(safeColor('#12ab9F')).toBe('#12ab9F');
    expect(safeColor('red; background:url(x)')).toBe('#ff4500');
    expect(safeColor(5)).toBe('#ff4500');
  });
});

describe('chords with Alt', () => {
  it('uses the physical key for Alt+letter, digit and slash', () => {
    const ev = (init: KeyboardEventInit) => chordOf(new KeyboardEvent('keydown', init));
    expect(ev({ key: 'Â¥', code: 'KeyY', altKey: true })).toBe('alt+y');
    expect(ev({ key: 'Â¡', code: 'Digit1', altKey: true })).toBe('alt+1');
    expect(ev({ key: '÷', code: 'Slash', altKey: true })).toBe('alt+/');
    expect(ev({ key: 'J', code: 'KeyJ', altKey: true, shiftKey: true })).toBe('alt+shift+j');
    expect(ev({ key: '1', code: 'Digit1' })).toBe('1');
  });
});

describe('link numbers', () => {
  const withLinks = () => {
    const cs = threadComments();
    cs[0]!.bodyHtml =
      '<p><a href="https://a.example/1">one</a> <a href="#x">jump</a> <a href="/r/foo">two</a> ' +
      '<a href="https://b.example/"><img src="x.png"></a> <a href="javascript:alert(1)">bad</a> ' +
      '<a href="https://c.example/"> </a></p>';
    cs[1]!.bodyHtml = '<p><a href="https://reply.example/">reply link</a></p>';
    return cs;
  };

  it('maps 1-9 and 0 to the first ten links', () => {
    expect([0, 1, 8, 9].map(digitOf)).toEqual(['1', '2', '9', '0']);
    expect(['1', '2', '9', '0'].map(indexOfDigit)).toEqual([0, 1, 8, 9]);
    expect(indexOfDigit('a')).toBeNull();
    expect(indexOfDigit('10')).toBeNull();
  });

  it('numbers real links in the item’s own body only, never a reply’s', () => {
    mount(nestedThreadHtml(withLinks()));
    const sel = new Selection();
    sel.track(batch({ comments: parseComments(document, null) }));
    sel.select('t1_c0');
    expect(numberedLinks(sel.current()).map((a) => a.getAttribute('href'))).toEqual([
      'https://a.example/1',
      '/r/foo',
      'https://b.example/',
    ]);
    sel.select('t1_c1');
    expect(numberedLinks(sel.current()).map((a) => a.getAttribute('href'))).toEqual([
      'https://reply.example/',
    ]);
    expect(numberedLinks(null)).toEqual([]);
    sel.reset();
  });

  it('stops at ten links', () => {
    const cs = threadComments();
    cs[0]!.bodyHtml = Array.from(
      { length: 14 },
      (_, i) => `<a href="https://x.example/${i}">l${i}</a>`,
    ).join(' ');
    mount(nestedThreadHtml(cs));
    const sel = new Selection();
    sel.track(batch({ comments: parseComments(document, null) }));
    sel.select('t1_c0');
    expect(numberedLinks(sel.current())).toHaveLength(10);
    sel.reset();
  });

  it('puts a badge after the link’s last line, or before its first', () => {
    const r = (left: number, right: number, top: number) => ({
      left,
      right,
      top,
      bottom: top + 10,
    });
    const rects = [r(10, 50, 100), r(0, 30, 112)];
    expect(badgeSpot(rects, 'right')).toEqual({ x: 32, y: 112 });
    expect(badgeSpot(rects, 'left')).toEqual({ x: 8, y: 100 });
    expect(badgeSpot([], 'right')).toBeNull();
  });

  it('draws badges in a REScue layer, not in Reddit’s markup', () => {
    mount(nestedThreadHtml(withLinks()));
    const sel = new Selection();
    sel.track(batch({ comments: parseComments(document, null) }));
    sel.select('t1_c0');
    const links = numberedLinks(sel.current());
    links.forEach((a, i) => {
      a.getClientRects = () =>
        [
          { left: 10, right: 60, top: 100 + i * 20, bottom: 112 + i * 20, width: 50, height: 12 },
        ] as unknown as DOMRectList;
    });
    const before = document.querySelector('shreddit-comment')!.outerHTML;
    const overlay = new LinkNumberOverlay();
    overlay.show(links, 'right');
    expect(overlay.badges().map((b) => b.text)).toEqual(['[1]', '[2]', '[3]']);
    expect(overlay.badges().every((b) => !b.hidden)).toBe(true);
    const layer = document.getElementById('rescue-link-numbers')!;
    expect(layer.style.pointerEvents).toBe('none');
    expect(layer.closest('shreddit-comment')).toBeNull();
    expect(document.querySelector('shreddit-comment')!.outerHTML).toBe(before);
    overlay.show([], 'right');
    expect(document.getElementById('rescue-link-numbers')).toBeNull();
    overlay.hide();
    sel.reset();
  });
});

describe('help overlay', () => {
  const list = [
    { id: 'moveDown', title: 'Move down', keys: ['j'], section: 'Move' },
    { id: 'moveToParent', title: 'Parent', keys: ['p'], section: 'Move', context: 'comments' },
    { id: 'upvote', title: 'Upvote', keys: ['a'], section: 'Vote' },
    { id: 'openLink1', title: 'Open 1', keys: ['1', 'alt+1'], section: 'Link numbers' },
    { id: 'openLink2', title: 'Open 2', keys: ['2', 'alt+2'], section: 'Link numbers' },
    { id: 'frontPage', title: 'Front page', keys: ['g f'], section: 'Go to' },
    { id: 'cmdline', title: 'Command line', keys: ['.'] },
  ];

  it('groups keys by section in a fixed order and folds the link keys into one row', () => {
    const s = helpSections(list, {
      onComments: true,
      linkNumbers: { enabled: true, keys: 'digit' },
    });
    expect(s.map((x) => x.name)).toEqual(['Move', 'Link numbers', 'Go to', 'Vote', 'General']);
    expect(s[0]!.rows.map((r) => r.keys)).toEqual(['j', 'p']);
    expect(s[1]!.rows).toHaveLength(1);
    expect(s[1]!.rows[0]!.keys).toBe('1 – 9, 0, alt + 1 – 9, 0');
    expect(s[2]!.rows[0]!.keys).toBe('g then f');
  });

  it('shows only the Alt keys in Alt mode, and no link row when numbers are off', () => {
    const alt = helpSections(list, {
      onComments: false,
      linkNumbers: { enabled: true, keys: 'alt' },
    });
    expect(alt.find((x) => x.name === 'Link numbers')!.rows[0]!.keys).toBe('alt + 1 – 9, 0');
    const off = helpSections(list, {
      onComments: false,
      linkNumbers: { enabled: false, keys: 'digit' },
    });
    expect(off.find((x) => x.name === 'Link numbers')).toBeUndefined();
    expect(off.find((x) => x.name === 'Move')!.rows.map((r) => r.keys)).toEqual(['j']);
  });
});

describe('keyboard voting', () => {
  function setup(state: -1 | 0 | 1, moveDown = false) {
    mount(listingHtml());
    const sel = new Selection();
    sel.track(batch({ posts: posts() }));
    sel.select(0);
    const keys = new KeyDispatcher();
    const vote = vi.fn(async (_target: unknown, _dir: number) => ({ ok: true as const }));
    const ctx = {
      options: { moveDownAfterVote: moveDown },
      session: { signedIn: true, username: 'me' },
      ui: { selection: () => sel },
      keys: { register: (c: never) => keys.register(c) },
      actions: { voteState: async () => state, vote },
      notices: { show: () => {}, dismiss: () => {} },
    };
    keyboardActions.init!(ctx as never);
    const press = (init: KeyboardEventInit) =>
      keys.handle(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    return { sel, vote, press };
  }

  it('a and z toggle: the same key again clears the vote', async () => {
    const { vote, press } = setup(1);
    press({ key: 'a' });
    await vi.waitFor(() => expect(vote).toHaveBeenCalledTimes(1));
    expect(vote.mock.calls[0]![1]).toBe(0);
  });

  it('Shift+A and Shift+Z set the vote and never clear it', async () => {
    const { vote, press } = setup(1);
    press({ key: 'A', shiftKey: true });
    await vi.waitFor(() => expect(vote).toHaveBeenCalledTimes(1));
    expect(vote.mock.calls[0]![1]).toBe(1);
    press({ key: 'Z', shiftKey: true });
    await vi.waitFor(() => expect(vote).toHaveBeenCalledTimes(2));
    expect(vote.mock.calls[1]![1]).toBe(-1);
  });

  it('moves down after a confirmed vote only when the option is on', async () => {
    const off = setup(0, false);
    const first = idOf(off.sel);
    off.press({ key: 'a' });
    await vi.waitFor(() => expect(off.vote).toHaveBeenCalled());
    await Promise.resolve();
    expect(idOf(off.sel)).toBe(first);
    off.sel.reset();

    document.body.innerHTML = '';
    const on = setup(0, true);
    on.press({ key: 'a' });
    await vi.waitFor(() => expect(idOf(on.sel)).not.toBe(first));
    on.sel.reset();
  });
});
