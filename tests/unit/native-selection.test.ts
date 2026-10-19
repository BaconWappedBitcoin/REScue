import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Selection } from '../../src/layout/native/selection';
import { areaOf, BOX_ID } from '../../src/layout/native/selectionView';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import type { Comment, Post } from '../../src/model/types';
import { listingHtml, mount, nestedThreadHtml, postHtml, POSTS } from '../fixtures/pages';

const posts = (): Post[] =>
  [...document.querySelectorAll('shreddit-post')]
    .map((el) => parsePost(el))
    .filter((p): p is Post => !!p);
const comments = (): Comment[] => parseComments(document, null);
const batch = (o: { posts?: Post[]; comments?: Comment[] }) => ({
  posts: o.posts ?? [],
  comments: o.comments ?? [],
  profileComments: [],
});
const idOf = (s: Selection) => s.current()?.id ?? null;

function hide(el: Element) {
  (el as HTMLElement).style.setProperty('display', 'none', 'important');
}

let sel: Selection;
beforeEach(() => {
  sel = new Selection();
});
afterEach(() => {
  sel.reset();
  document.body.innerHTML = '';
});

describe('listing selection', () => {
  beforeEach(() => mount(listingHtml()));

  it('lists posts in document order whatever order they were tracked in', () => {
    const ps = posts();
    sel.track(batch({ posts: [...ps].reverse() }));
    expect(sel.list().map((i) => i.id)).toEqual(ps.map((p) => p.id));
  });

  it('moves with move(+1/-1), stops at the ends, and marks the host', () => {
    const ps = posts();
    sel.track(batch({ posts: ps }));
    expect(sel.move(1)).toBe(true);
    expect(idOf(sel)).toBe(ps[0]!.id);
    expect(ps[0]!.source.hasAttribute('data-rescue-selected')).toBe(true);
    expect(sel.move(-1)).toBe(false);
    sel.move(1);
    expect(idOf(sel)).toBe(ps[1]!.id);
    expect(ps[0]!.source.hasAttribute('data-rescue-selected')).toBe(false);
    expect(ps[1]!.source.hasAttribute('data-rescue-selected')).toBe(true);
    sel.edge('last');
    expect(idOf(sel)).toBe(ps[ps.length - 1]!.id);
    expect(sel.move(1)).toBe(false);
    expect(sel.model()).toBe(ps[ps.length - 1]);
  });

  it('skips posts whose wrapper is hidden', () => {
    const ps = posts();
    sel.track(batch({ posts: ps }));
    hide(ps[1]!.source.closest('article')!);
    sel.select(ps[0]!.id);
    sel.move(1);
    expect(idOf(sel)).toBe(ps[2]!.id);
    sel.move(-1);
    expect(idOf(sel)).toBe(ps[0]!.id);
    expect(sel.list().map((i) => i.id)).not.toContain(ps[1]!.id);
    expect(sel.select(ps[1]!.id)).toBe(false);
  });

  it('appends posts Reddit loads later, and the selection continues onto them', () => {
    const ps = posts();
    sel.track(batch({ posts: ps }));
    sel.edge('last');
    expect(sel.move(1)).toBe(false);

    const more = { ...POSTS[0]!, id: 't3_more1', permalink: '/r/x/comments/more1/x/' };
    document.querySelector('shreddit-feed')!.insertAdjacentHTML('beforeend', postHtml(more));
    const added = posts().filter((p) => p.id === 't3_more1');
    sel.track(batch({ posts: added }));
    expect(sel.move(1)).toBe(true);
    expect(idOf(sel)).toBe('t3_more1');
    // The same item arriving twice is not listed twice.
    sel.track(batch({ posts: added }));
    expect(sel.list().filter((i) => i.id === 't3_more1')).toHaveLength(1);
  });

  it('selects by index and by id, and clears', () => {
    const ps = posts();
    sel.track(batch({ posts: ps }));
    expect(sel.select(2)).toBe(true);
    expect(idOf(sel)).toBe(ps[2]!.id);
    expect(sel.select(999)).toBe(false);
    expect(sel.select('t3_nope')).toBe(false);
    sel.clear();
    expect(sel.current()).toBeNull();
    expect(document.querySelector('[data-rescue-selected]')).toBeNull();
  });

  it('loses the selection when its element leaves the page, and resets on a route change', () => {
    const ps = posts();
    sel.track(batch({ posts: ps }));
    sel.select(0);
    ps[0]!.source.closest('article')!.remove();
    expect(sel.current()).toBeNull();
    sel.select(1);
    sel.reset();
    expect(sel.list()).toEqual([]);
    expect(sel.current()).toBeNull();
    expect(document.getElementById(BOX_ID)).toBeNull();
  });

  it('notifies listeners of selection changes', () => {
    sel.track(batch({ posts: posts() }));
    const seen: Array<string | null> = [];
    const off = sel.onChange((i) => seen.push(i?.id ?? null));
    sel.select(0);
    sel.clear();
    off();
    sel.select(1);
    expect(seen).toEqual([POSTS[0]!.id, null]);
  });

  it('selects the item an event happened in, without scrolling', () => {
    const ps = posts();
    sel.track(batch({ posts: ps }));
    const target = ps[2]!.source.querySelector('a')!;
    const scroll = vi.spyOn(window, 'scrollBy');
    let e: Event | undefined;
    target.addEventListener('click', (ev) => (e = ev), { once: true });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(sel.selectFromEvent(e!)).toBe(true);
    expect(idOf(sel)).toBe(ps[2]!.id);
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });
});

describe('thread selection', () => {
  // Depths: c0:0 c1:1 c2:2 c3:1 c4:0 c5:1 c6:0 c7:0 c8:1 c9:2 c10:3 c11:0
  beforeEach(() => {
    mount(nestedThreadHtml());
    sel.track(batch({ posts: posts(), comments: comments() }));
  });

  const at = (n: number) => sel.select(`t1_c${n}`);
  const now = () => idOf(sel);

  it('lists the post first, then the comments in document order', () => {
    const ids = sel.list().map((i) => i.id);
    expect(ids[0]).toBe('t3_text1');
    expect(ids.slice(1)).toEqual(Array.from({ length: 12 }, (_, i) => `t1_c${i}`));
    sel.select(0);
    sel.move(1);
    expect(now()).toBe('t1_c0');
  });

  it('moves to the next / previous comment at the same depth within the parent', () => {
    at(1);
    sel.moveSibling(1);
    expect(now()).toBe('t1_c3'); // skips c2, the reply to c1
    expect(sel.moveSibling(1)).toBe(false); // c4 belongs to another parent
    expect(now()).toBe('t1_c3');
    sel.moveSibling(-1);
    expect(now()).toBe('t1_c1');
    expect(sel.moveSibling(-1)).toBe(false);
  });

  it('moves between top-level threads with sibling moves on top-level comments', () => {
    at(0);
    sel.moveSibling(1);
    expect(now()).toBe('t1_c4');
    sel.moveSibling(1);
    expect(now()).toBe('t1_c6');
    sel.moveSibling(-1);
    expect(now()).toBe('t1_c4');
    at(5);
    expect(sel.moveSibling(1)).toBe(false); // last reply of c4
  });

  it('moveThread jumps to the next/previous top-level comment from anywhere in a thread', () => {
    at(10);
    sel.moveThread(1);
    expect(now()).toBe('t1_c11');
    at(10);
    sel.moveThread(-1);
    expect(now()).toBe('t1_c6'); // before c7, the thread c10 is in
    at(2);
    sel.moveThread(1);
    expect(now()).toBe('t1_c4');
  });

  it('goes to the parent comment and to the top of a thread', () => {
    at(10);
    sel.parent();
    expect(now()).toBe('t1_c9');
    sel.parent();
    expect(now()).toBe('t1_c8');
    sel.toTop();
    expect(now()).toBe('t1_c7');
    expect(sel.parent()).toBe(false);
    expect(sel.toTop()).toBe(false);
  });

  it('skips hidden comments', () => {
    hide(document.querySelector('shreddit-comment[thingid="t1_c4"]')!);
    at(0);
    sel.moveSibling(1);
    expect(now()).toBe('t1_c6');
    // c4's replies sit inside it, so they are hidden with it.
    at(3);
    sel.move(1);
    expect(now()).toBe('t1_c6');
  });

  it('moves with shift on the thread post as a plain move', () => {
    sel.select('t3_text1');
    sel.moveSibling(1);
    expect(now()).toBe('t1_c0');
  });
});

describe('selection outline area', () => {
  const rect = (top: number, bottom: number, left = 10, right = 710) =>
    ({ top, bottom, left, right, width: right - left, height: bottom - top }) as DOMRect;
  const stub = (el: Element, r: DOMRect) =>
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);

  beforeEach(() => {
    mount(nestedThreadHtml());
    sel.track(batch({ posts: posts(), comments: comments() }));
  });

  it("covers a comment's own meta row and body, not its replies", () => {
    sel.select('t1_c0');
    const host = sel.current()!.host;
    stub(host, rect(100, 600)); // the whole thread, replies included
    stub(host.querySelector('[slot="commentMeta"]')!, rect(100, 120));
    stub(host.querySelector(':scope > [slot="comment"]')!, rect(120, 170));
    expect(areaOf(sel.current()!)).toMatchObject({ top: 100, bottom: 170, left: 10, right: 710 });
  });

  it('ignores a nested reply’s body when measuring the parent', () => {
    sel.select('t1_c0');
    const host = sel.current()!.host;
    stub(host, rect(100, 600));
    stub(host.querySelector('[slot="commentMeta"]')!, rect(100, 120));
    // The first [slot=comment] match inside the parent is its own; make its body collapsed.
    stub(host.querySelector(':scope > [slot="comment"]')!, rect(0, 0, 0, 0));
    const reply = host.querySelector('shreddit-comment shreddit-comment [slot="comment"]')!;
    stub(reply, rect(300, 340));
    expect(areaOf(sel.current()!)).toMatchObject({ top: 100, bottom: 120 });
  });

  it('stops at a collapsed comment’s own edge even when its hidden body still measures full height (Firefox)', () => {
    sel.select('t1_c0');
    const host = sel.current()!.host;
    stub(host, rect(100, 120)); // collapsed: only the head line is left
    stub(host.querySelector('[slot="commentMeta"]')!, rect(100, 118));
    stub(host.querySelector(':scope > [slot="comment"]')!, rect(118, 371)); // still laid out
    expect(areaOf(sel.current()!)).toMatchObject({ top: 100, bottom: 120 });
  });

  it('falls back to the first lines of the host when nothing else can be measured', () => {
    sel.select('t1_c0');
    const host = sel.current()!.host;
    stub(host, rect(100, 600));
    stub(host.querySelector('[slot="commentMeta"]')!, rect(0, 0, 0, 0));
    stub(host.querySelector(':scope > [slot="comment"]')!, rect(0, 0, 0, 0));
    const area = areaOf(sel.current()!)!;
    expect(area.top).toBe(100);
    expect(area.bottom).toBeGreaterThan(100);
    expect(area.bottom).toBeLessThan(200);
  });

  it('covers a post’s whole card and positions the box over it', () => {
    sel.select('t3_text1');
    const wrapper = sel.current()!.wrapper;
    expect(wrapper.tagName).not.toBe('SHREDDIT-POST'.toLowerCase());
    stub(wrapper, rect(50, 250));
    sel.select('t3_text1'); // repaint with the stubbed rect
    const box = document.getElementById(BOX_ID)!;
    expect(box.className).toContain('rescue-overlay');
    expect(box.style.top).toBe('50px');
    expect(box.style.height).toBe('200px');
    expect(box.style.display).toBe('block');
  });
});
