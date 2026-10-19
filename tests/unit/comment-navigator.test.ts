import type { ModuleDefinition } from '../../src/core/types';
import { afterEach, describe, expect, it } from 'vitest';
import { commentNavigator } from '../../src/modules/comments/commentNavigator';
import {
  hasMedia,
  matchesCategory,
  stepTarget,
  type NavSets,
} from '../../src/modules/comments/navigatorFilters';
import { readComments } from '../../src/modules/comments/readComments';
import { closeReadStore } from '../../src/modules/comments/readTracking';
import type { Comment } from '../../src/model/types';
import { mount, nestedThreadHtml, threadComments, type FixtureComment } from '../fixtures/pages';
import { bootModules as baseBoot, tick, type BootOptions } from './module-harness';

/** The navigator is closed by default; these tests exercise the open widget unless they say otherwise. */
const bootModules = (defs: ModuleDefinition[], opts: BootOptions = {}) =>
  baseBoot(defs, {
    ...opts,
    options: {
      ...opts.options,
      ...(defs.includes(commentNavigator)
        ? {
            commentNavigator: { showByDefault: true, ...opts.options?.commentNavigator },
          }
        : {}),
    },
  });

const comment = (over: Partial<Comment> = {}): Comment => ({
  kind: 'comment',
  id: 't1_x',
  postId: 't3_p',
  parentId: null,
  depth: 0,
  author: 'someone',
  isOp: false,
  distinguished: null,
  score: 1,
  created: new Date(1000),
  bodyHtml: '<p>hello</p>',
  permalink: null,
  source: document.createElement('div'),
  ...over,
});

const sets = (over: Partial<NavSets> = {}): NavSets => ({
  friends: new Set(['pal']),
  tagged: new Set(['marked']),
  popularScore: 100,
  isNew: () => false,
  ...over,
});

describe('comment navigator categories', () => {
  it('OP, moderator and admin follow the model flags', () => {
    expect(matchesCategory(comment({ isOp: true }), 'op', sets())).toBe(true);
    expect(matchesCategory(comment(), 'op', sets())).toBe(false);
    expect(matchesCategory(comment({ distinguished: 'moderator' }), 'moderator', sets())).toBe(
      true,
    );
    expect(matchesCategory(comment({ distinguished: 'moderator' }), 'admin', sets())).toBe(false);
    expect(matchesCategory(comment({ distinguished: 'admin' }), 'admin', sets())).toBe(true);
  });

  it('friends and tagged users match case-insensitively; a deleted author never does', () => {
    expect(matchesCategory(comment({ author: 'PAL' }), 'friend', sets())).toBe(true);
    expect(matchesCategory(comment({ author: 'Marked' }), 'tagged', sets())).toBe(true);
    expect(matchesCategory(comment({ author: 'other' }), 'friend', sets())).toBe(false);
    expect(matchesCategory(comment({ author: null }), 'friend', sets())).toBe(false);
  });

  it('popular needs a visible score at or above the threshold', () => {
    expect(matchesCategory(comment({ score: 100 }), 'popular', sets())).toBe(true);
    expect(matchesCategory(comment({ score: 99 }), 'popular', sets())).toBe(false);
    expect(matchesCategory(comment({ score: null }), 'popular', sets())).toBe(false);
    expect(matchesCategory(comment({ score: 5 }), 'popular', sets({ popularScore: 5 }))).toBe(true);
  });

  it('media recognises images and links to image or video hosts, not ordinary links', () => {
    expect(hasMedia('<p><img src="https://i.redd.it/a.jpg"></p>')).toBe(true);
    expect(hasMedia('<a href="https://i.imgur.com/x.png">pic</a>')).toBe(true);
    expect(hasMedia('<a href="https://example.com/clip.mp4?x=1&amp;y=2">v</a>')).toBe(true);
    expect(hasMedia('<a href="https://youtu.be/abc">v</a>')).toBe(true);
    expect(hasMedia('<a href="https://example.com/article">read</a>')).toBe(false);
    expect(hasMedia('<p>just text about imgur</p>')).toBe(false);
    expect(
      matchesCategory(comment({ bodyHtml: '<img src="https://x/y.png">' }), 'image', sets()),
    ).toBe(true);
  });

  it('new defers to the supplied check', () => {
    const fresh = comment({ id: 't1_fresh' });
    const s = sets({ isNew: (c) => c.id === 't1_fresh' });
    expect(matchesCategory(fresh, 'new', s)).toBe(true);
    expect(matchesCategory(comment(), 'new', s)).toBe(false);
  });
});

describe('stepTarget', () => {
  const items = [
    { id: 'a', match: false },
    { id: 'b', match: true },
    { id: 'c', match: false },
    { id: 'd', match: true },
  ];

  it('steps to the next and previous match, wrapping at the ends', () => {
    expect(stepTarget(items, 'b', 1)).toBe('d');
    expect(stepTarget(items, 'd', 1)).toBe('b'); // wraps
    expect(stepTarget(items, 'd', -1)).toBe('b');
    expect(stepTarget(items, 'b', -1)).toBe('d'); // wraps
    expect(stepTarget(items, 'a', 1)).toBe('b');
    expect(stepTarget(items, 'c', -1)).toBe('b');
  });

  it('starts from the top (next) or the bottom (previous) when nothing relevant is selected', () => {
    expect(stepTarget(items, null, 1)).toBe('b');
    expect(stepTarget(items, null, -1)).toBe('d');
    expect(stepTarget(items, 't3_post', 1)).toBe('b');
  });

  it('returns null when nothing else matches', () => {
    expect(stepTarget([{ id: 'a', match: false }], null, 1)).toBeNull();
    expect(stepTarget([{ id: 'a', match: true }], 'a', 1)).toBeNull();
    expect(stepTarget([], null, 1)).toBeNull();
  });
});

afterEach(() => {
  closeReadStore();
  document.body.innerHTML = '';
});

describe('commentNavigator widget', () => {
  const route = { kind: 'thread', path: '/r/Layoffs/comments/text1/x', postId: 't3_text1' };
  // Thread author rockpaperblr is OP of c1, c5, c9; c10 is a moderator; c3 has a high score.
  const comments = (): FixtureComment[] =>
    threadComments().map((c, i) => ({
      ...c,
      ...(i === 10 ? { distinguished: 'moderator' as const } : {}),
      ...(i === 3 ? { score: 500 } : {}),
    }));
  const widget = () => document.querySelector<HTMLElement>('.rescue-comment-nav')!;
  const pick = (value: string) => {
    const select = widget().querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const click = (cls: string) => widget().querySelector<HTMLButtonElement>(cls)!.click();
  const selected = (m: { selection: { current(): { id: string } | null } }) =>
    m.selection.current()?.id;

  it('steps through OP comments by selecting them, in document order, wrapping around', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments, commentNavigator], { route });
    m.flush();
    await tick();
    expect(widget().hidden).toBe(false);
    expect(widget().querySelector('.rescue-nav-count')!.textContent).toBe('0/3');
    pick('op');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c1');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c5');
    click('.rescue-nav-next');
    await tick();
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c1'); // wrapped
    click('.rescue-nav-prev');
    await tick();
    expect(selected(m)).toBe('t1_c9');
    m.dispose();
  });

  it('jumps to moderators and popular comments, and says when nothing matches', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments, commentNavigator], { route });
    m.flush();
    await tick();
    pick('moderator');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c10');
    pick('popular');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c3');
    pick('admin');
    click('.rescue-nav-next');
    await tick();
    expect(widget().querySelector('.rescue-nav-count')!.textContent).toBe('none');
    expect(selected(m)).toBe('t1_c3'); // unchanged
    m.dispose();
  });

  it('is hidden outside threads and skips comments that are hidden', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments, commentNavigator], { route });
    m.flush();
    await tick();
    m.deco.hide({ id: 't1_c1' }, 'test');
    pick('op');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c5');
    m.goTo({ kind: 'all', path: '/r/all' });
    expect(widget().hidden).toBe(true);
    m.dispose();
  });
});
