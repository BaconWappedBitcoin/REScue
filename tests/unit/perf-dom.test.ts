import { afterEach, describe, expect, it, vi } from 'vitest';
import { addedMatching, burstTouches, ownQueryAll, ownQueryFirst } from '../../src/core/dom';
import { Decorations } from '../../src/layout/decorations';
import { NativeAdapter } from '../../src/layout/native/adapter';
import { ownBody, ownDetails } from '../../src/model/access';
import { parseComments } from '../../src/model/comment';
import { commentHidePersistor } from '../../src/modules/comments/commentHidePersistor';
import { forgetBackgrounds, pageBackground } from '../../src/modules/users/pageBackground';
import { mount, nestedCommentsHtml, type FixtureComment } from '../fixtures/pages';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  vi.restoreAllMocks();
});

const item = { id: 't1_a' };
const span = (cls: string) => {
  const s = document.createElement('span');
  s.className = cls;
  return s;
};

describe('Decorations: no-op calls and batches', () => {
  it('tells no one about calls that change nothing', () => {
    const deco = new Decorations();
    const seen: string[] = [];
    deco.onChange((id) => seen.push(id));
    deco.unhide(item, 'x'); // never hidden
    deco.collapseBody(item, false); // never collapsed
    deco.unmarkAuthor(item, 'c'); // never marked
    expect(seen).toEqual([]);
    deco.hide(item, 'x');
    deco.hide(item, 'x');
    deco.markAuthor(item, 'c');
    deco.markAuthor(item, 'c');
    deco.addClass(item, 'k');
    deco.addClass(item, 'k');
    deco.collapseBody(item, true);
    deco.collapseBody(item, true);
    expect(seen).toHaveLength(4);
    deco.unhide(item, 'other'); // a reason it does not have
    expect(seen).toHaveLength(4);
    deco.unhide(item);
    expect(seen).toHaveLength(5);
    expect(deco.hiddenReason(item.id)).toBeUndefined();
  });

  it('tells each changed item once at the end of a batch', () => {
    const deco = new Decorations();
    const seen: string[] = [];
    deco.onChange((id) => seen.push(id));
    const out = deco.batch(() => {
      deco.hide(item, 'x');
      deco.decorate(item, 'author', span('rescue-a'));
      deco.batch(() => deco.markAuthor({ id: 't1_b' }, 'c')); // nested: still one batch
      deco.decorate(item, 'tagline', span('rescue-b'));
      expect(seen).toEqual([]);
      return 7;
    });
    expect(out).toBe(7);
    expect(seen).toEqual(['t1_a', 't1_b']);
  });

  it('remembers only the items that left nodes behind across route changes', () => {
    const deco = new Decorations();
    deco.hide({ id: 't1_hidden' }, 'x');
    deco.decorate(item, 'author', span('rescue-a'));
    deco.clear();
    expect(deco.retiredCount()).toBe(1);
    // Decorated again with the same kind: the old node is replaced, nothing else is remembered.
    deco.decorate(item, 'author', span('rescue-a'));
    deco.clear();
    expect(deco.retiredCount()).toBe(1);
  });
});

describe('ownQueryAll / ownQueryFirst', () => {
  const tree: FixtureComment[] = [
    { id: 't1_a', depth: 0, author: 'a', body: 'A' },
    { id: 't1_b', depth: 1, author: 'b', body: 'B' },
    { id: 't1_c', depth: 2, author: 'c', body: 'C' },
    { id: 't1_d', depth: 0, author: 'd', body: 'D' },
  ];
  const naive = (root: Element, sel: string, owner: string) =>
    [...root.querySelectorAll(sel)].filter((n) => n.closest(owner) === root);

  it.each([false, true])(
    'answers as a filter over the whole subtree would (childrenFirst %s)',
    (cf) => {
      mount(`<div>${nestedCommentsHtml(tree, cf, true)}</div>`);
      for (const host of document.querySelectorAll('shreddit-comment')) {
        for (const sel of ['[slot="comment"]', 'details', 'p', 'summary']) {
          expect(ownQueryAll(host, sel, 'shreddit-comment')).toEqual(
            naive(host, sel, 'shreddit-comment'),
          );
          expect(ownQueryFirst(host, sel, 'shreddit-comment')).toBe(
            naive(host, sel, 'shreddit-comment')[0] ?? null,
          );
        }
        expect(ownBody(host)?.textContent).toBe(
          host.getAttribute('thingid')!.slice(3).toUpperCase(),
        );
      }
    },
  );

  it('never returns a reply’s collapse element', () => {
    mount(`<div>${nestedCommentsHtml(tree, true, true)}</div>`);
    const a = document.querySelector('[thingid="t1_a"]')!;
    const d = ownDetails(a)!;
    expect(d.closest('shreddit-comment')).toBe(a);
    expect(d.querySelector(':scope > summary')).not.toBeNull();
  });

  it('keeps the plain filter when the root is not an owner', () => {
    mount(`<section><shreddit-comment><p>x</p></shreddit-comment><p>y</p></section>`);
    const root = document.querySelector('section')!;
    expect(ownQueryAll(root, 'p', 'shreddit-comment')).toEqual([]);
  });
});

describe('mutation helpers', () => {
  it('find matches among added nodes only, and notice removals', async () => {
    mount('<div id="root"><i class="t"></i></div>');
    const root = document.getElementById('root')!;
    const records: MutationRecord[] = [];
    const mo = new MutationObserver((r) => records.push(...r));
    mo.observe(root, { childList: true, subtree: true });
    root.insertAdjacentHTML('beforeend', '<b class="t"></b><u><i class="t"></i></u><em></em>');
    await new Promise((r) => setTimeout(r, 0));
    expect(addedMatching(records, '.t').map((e) => e.localName)).toEqual(['b', 'i']);
    records.length = 0;
    root.querySelector('em')!.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(burstTouches(records, '.t')).toBe(false);
    root.querySelector('u')!.remove();
    await new Promise((r) => setTimeout(r, 0));
    expect(burstTouches(records, '.t')).toBe(true);
    mo.disconnect();
  });
});

describe('NativeAdapter forgets items that left the page', () => {
  it('prunes disconnected items once the count has grown', () => {
    const many: FixtureComment[] = Array.from({ length: 1100 }, (_, i) => ({
      id: `t1_n${i}`,
      depth: 0,
      author: 'u',
      body: 'b',
    }));
    mount(`<div id="t">${nestedCommentsHtml(many.slice(0, 600))}</div>`);
    const adapter = new NativeAdapter(new Decorations());
    adapter.track({ posts: [], comments: parseComments(document, null), profileComments: [] });
    for (const el of [...document.querySelectorAll('shreddit-comment')].slice(0, 500)) el.remove();
    document
      .getElementById('t')!
      .insertAdjacentHTML('beforeend', nestedCommentsHtml(many.slice(600)));
    const fresh = parseComments(document, null).filter((c) => Number(c.id.slice(4)) >= 600);
    adapter.track({ posts: [], comments: fresh, profileComments: [] });
    expect(adapter.trackedCount()).toBe(600);
    adapter.stop();
  });
});

describe('commentHidePersistor', () => {
  it('does not look inside comments it has nothing remembered for', async () => {
    mount(
      `<div>${nestedCommentsHtml([{ id: 't1_a', depth: 0, author: 'a', body: 'A' }], false, true)}</div>`,
    );
    const ctx = { data: { get: async () => ({}), set: () => {} } } as never;
    await commentHidePersistor.init!(ctx);
    const comments = parseComments(document, null);
    const spy = vi.spyOn(Element.prototype, 'querySelectorAll');
    const one = vi.spyOn(Element.prototype, 'querySelector');
    commentHidePersistor.onItems!({ posts: [], comments, profileComments: [] }, ctx);
    expect(spy).not.toHaveBeenCalled();
    expect(one).not.toHaveBeenCalled();
    commentHidePersistor.dispose!();
  });
});

describe('pageBackground', () => {
  it('reads each element once per theme', () => {
    mount(
      '<div id="bg" style="background-color: rgb(1, 2, 3)"><p><span id="a"></span><span id="b"></span></p></div>',
    );
    forgetBackgrounds();
    const spy = vi.spyOn(window, 'getComputedStyle');
    expect(pageBackground(document.getElementById('a')!)).toBe('#010203');
    const first = spy.mock.calls.length;
    expect(pageBackground(document.getElementById('b')!)).toBe('#010203');
    expect(spy.mock.calls.length - first).toBe(1); // only #b itself; <p> and #bg are known
    document.documentElement.className = 'theme-dark';
    pageBackground(document.getElementById('b')!);
    expect(spy.mock.calls.length - first).toBeGreaterThan(1); // a theme change reads again
  });
});
