import type { ModuleDefinition } from '../../src/core/types';
/** Comment tools UI parity (ui-parity batch 5b): navigator, showParent, hide-children. */
import { afterEach, describe, expect, it } from 'vitest';
import { commentNavigator } from '../../src/modules/comments/commentNavigator';
import { hideChildComments } from '../../src/modules/comments/hideChildComments';
import {
  answeredByOp,
  hasImage,
  hasVideo,
  matchesCategory,
  positionLabel,
  type NavSets,
} from '../../src/modules/comments/navigatorFilters';
import { readComments } from '../../src/modules/comments/readComments';
import { closeReadStore, isReadComment } from '../../src/modules/comments/readTracking';
import { parentChain, showParent } from '../../src/modules/comments/showParent';
import type { Comment } from '../../src/model/types';
import { mount, nestedThreadHtml, threadComments, type FixtureComment } from '../fixtures/pages';
import { bootModules as baseBoot, own, tick, type BootOptions } from './module-harness';

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

afterEach(() => {
  closeReadStore();
  document.body.innerHTML = '';
});

const route = { kind: 'thread', path: '/r/Layoffs/comments/text1/x', postId: 't3_text1' };
const el = (id: string) => document.querySelector(`shreddit-comment[thingid="${id}"]`)!;
const hiddenBy = (id: string) => el(id).getAttribute('data-rescue-hidden');
const press = (m: { keys: { handle(e: KeyboardEvent): void } }, key: string, shift = false) =>
  m.keys.handle(new KeyboardEvent('keydown', { key, shiftKey: shift, cancelable: true }));

const baseComment = (over: Partial<Comment> = {}): Comment => ({
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
  friends: new Set(),
  tagged: new Set(),
  popularScore: 100,
  isNew: () => false,
  ...over,
});

describe('navigator categories and position', () => {
  it('all, me, answered, image and video categories', () => {
    expect(matchesCategory(baseComment(), 'all', sets())).toBe(true);
    expect(
      matchesCategory(baseComment({ author: 'Me_Reader' }), 'me', sets({ me: 'me_reader' })),
    ).toBe(true);
    expect(matchesCategory(baseComment({ author: 'x' }), 'me', sets({ me: 'me_reader' }))).toBe(
      false,
    );
    expect(matchesCategory(baseComment(), 'me', sets())).toBe(false); // signed out
    const answered = answeredByOp([
      { parentId: 't1_q', isOp: true },
      { parentId: 't1_r', isOp: false },
      { parentId: null, isOp: true },
    ]);
    expect([...answered]).toEqual(['t1_q']);
    expect(matchesCategory(baseComment({ id: 't1_q' }), 'answered', sets({ answered }))).toBe(true);
    expect(matchesCategory(baseComment({ id: 't1_r' }), 'answered', sets({ answered }))).toBe(
      false,
    );
    expect(hasImage('<a href="https://i.imgur.com/x.png">pic</a>')).toBe(true);
    expect(hasImage('<a href="https://example.com/clip.mp4">v</a>')).toBe(false);
    expect(hasVideo('<a href="https://example.com/clip.mp4">v</a>')).toBe(true);
    expect(hasVideo('<a href="https://v.redd.it/abc">v</a>')).toBe(true);
    expect(hasVideo('<img src="https://i.redd.it/a.jpg">')).toBe(false);
    expect(
      matchesCategory(baseComment({ bodyHtml: '<img src="https://x/y.png">' }), 'video', sets()),
    ).toBe(false);
  });

  it('the position reads n/total, with ~ when the reader has moved on, and none when empty', () => {
    expect(positionLabel([], null, null)).toBe('none');
    expect(positionLabel(['a', 'b', 'c'], null, null)).toBe('0/3');
    expect(positionLabel(['a', 'b', 'c'], 'b', 'b')).toBe('2/3');
    expect(positionLabel(['a', 'b', 'c'], 'b', 'z')).toBe('~2/3');
  });

  it('a comment counts as read only with a record and a date at or before the visit', () => {
    const rec = { lastVisit: 100, commentCountAtVisit: 1 };
    expect(isReadComment(rec, new Date(100))).toBe(true);
    expect(isReadComment(rec, new Date(101))).toBe(false);
    expect(isReadComment(rec, null)).toBe(false);
    expect(isReadComment(undefined, new Date(1))).toBe(false);
  });
});

describe('commentNavigator widget (parity)', () => {
  const widget = () => document.querySelector<HTMLElement>('.rescue-comment-nav')!;
  const pick = (value: string) => {
    const select = widget().querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const click = (cls: string) => widget().querySelector<HTMLButtonElement>(cls)!.click();
  const pos = () => widget().querySelector('.rescue-nav-count')!.textContent;
  const selected = (m: { selection: { current(): { id: string } | null } }) =>
    m.selection.current()?.id;

  it('shows 1/3, 2/3 as it steps, and clicking the position jumps back to the last match', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([readComments, commentNavigator], { route });
    m.flush();
    await tick();
    pick('op');
    expect(pos()).toBe('0/3');
    click('.rescue-nav-next');
    await tick();
    expect(pos()).toBe('1/3');
    click('.rescue-nav-next');
    await tick();
    expect(pos()).toBe('2/3');
    m.selection.select('t1_c10'); // not a match: the reader moved elsewhere
    expect(pos()).toBe('~2/3');
    click('.rescue-nav-count');
    expect(selected(m)).toBe('t1_c5');
    expect(pos()).toBe('2/3');
    m.dispose();
  });

  it('close hides the widget and N brings it back (and closes it again)', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([readComments, commentNavigator], { route });
    m.flush();
    await tick();
    expect(widget().hidden).toBe(false);
    click('.rescue-nav-close');
    expect(widget().hidden).toBe(true);
    press(m, 'N', true);
    expect(widget().hidden).toBe(false);
    press(m, 'N', true);
    expect(widget().hidden).toBe(true);
    m.dispose();
  });

  it('can start closed, and Shift+down steps and opens it only when the option says so', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([readComments, commentNavigator], {
      route,
      options: { commentNavigator: { showByDefault: false } },
    });
    m.flush();
    await tick();
    expect(widget().hidden).toBe(true);
    press(m, 'ArrowDown', true);
    await tick();
    expect(selected(m)).toBe('t1_c1'); // OP, first
    expect(widget().hidden).toBe(true); // "open on keyboard move" is off
    press(m, 'ArrowDown', true);
    await tick();
    expect(selected(m)).toBe('t1_c5');
    press(m, 'ArrowUp', true);
    await tick();
    expect(selected(m)).toBe('t1_c1');
    m.dispose();

    mount(nestedThreadHtml());
    const open = await bootModules([readComments, commentNavigator], {
      route,
      options: { commentNavigator: { showByDefault: false, showOnKeyboardMove: true } },
    });
    open.flush();
    await tick();
    press(open, 'ArrowDown', true);
    await tick();
    expect(widget().hidden).toBe(false);
    open.dispose();
  });

  it('keys do nothing outside threads', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([readComments, commentNavigator], { route });
    m.flush();
    m.goTo({ kind: 'all', path: '/r/all' });
    expect(m.keys.run('toggleCommentNavigator')).toBe(false);
    expect(m.keys.run('commentNavigatorDown')).toBe(false);
    m.dispose();
  });

  it('steps through my own comments, answered questions, and all comments', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([readComments, commentNavigator], { route, username: 'User3' });
    m.flush();
    await tick();
    pick('me');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c3'); // the only comment by user3
    expect(pos()).toBe('1/1');

    pick('answered'); // OP replied to c0, c4 and c8
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c4');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c8');

    pick('all');
    m.selection.select('t1_c0');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c1');
    expect(pos()).toBe('2/12');
    m.dispose();
  });

  it('separates images from videos', async () => {
    const comments: FixtureComment[] = threadComments().map((c, i) => ({
      ...c,
      ...(i === 2 ? { bodyHtml: '<p><img src="https://i.redd.it/a.jpg"></p>' } : {}),
      ...(i === 6 ? { bodyHtml: '<p><a href="https://v.redd.it/xyz">clip</a></p>' } : {}),
    }));
    mount(nestedThreadHtml(comments));
    const m = await bootModules([readComments, commentNavigator], { route });
    m.flush();
    await tick();
    pick('image');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c2');
    pick('video');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c6');
    m.dispose();
  });

  it('skip read leaves out comments that were there at the previous visit', async () => {
    const T = Date.now();
    const HOUR = 3_600_000;
    const comments = threadComments().map((c, i) => ({
      ...c,
      created: new Date(T - (i === 0 || i === 2 ? HOUR / 2 : 3 * HOUR)).toISOString(),
    }));
    mount(nestedThreadHtml(comments));
    const stored = { read: { t3_text1: { lastVisit: T - HOUR, commentCountAtVisit: 1100 } } };
    const m = await bootModules([readComments, commentNavigator], { route, stored });
    m.flush();
    await tick();
    pick('all');
    const box = widget().querySelector<HTMLInputElement>('.rescue-nav-skip-read')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(pos()).toBe('0/2');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c0');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c2');
    click('.rescue-nav-next');
    await tick();
    expect(selected(m)).toBe('t1_c0'); // wrapped over the read ones
    m.dispose();
  });
});

describe('showParent chain (parity)', () => {
  const hoverOpts = { showParent: { hoverDelay: 0 } };
  const open = async (m: Awaited<ReturnType<typeof bootModules>>, id: string) => {
    (own(el(id), '.rescue-show-parent') as HTMLButtonElement).dispatchEvent(
      new MouseEvent('mouseenter'),
    );
    for (let i = 0; i < 6 && !document.querySelector('.rescue-parent-chain'); i++) await tick();
    void m;
  };

  it('lists every parent, nearest first below the link, each with goto comment', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([showParent], { route, options: hoverOpts });
    m.flush();
    await open(m, 't1_c2'); // c2 -> c1 -> c0
    const entries = [...document.querySelectorAll('.rescue-hover .rescue-parent-preview')];
    expect(entries.map((e) => e.querySelector('strong')!.textContent)).toEqual([
      'u/rockpaperblr', // c1
      'u/user0', // c0
    ]);
    expect(entries[0]!.textContent).toContain('comment 1 body');
    expect(entries[1]!.textContent).toContain('comment 0 body');
    expect(document.querySelectorAll('.rescue-parent-arrow')).toHaveLength(1);
    const goto = document.querySelectorAll<HTMLButtonElement>('.rescue-parent-goto');
    expect(goto).toHaveLength(2);
    goto[1]!.click();
    expect(m.selection.current()?.id).toBe('t1_c0');
    expect(document.querySelector('.rescue-hover')).toBeNull();
    m.dispose();
  });

  it('puts the topmost parent first when the popup opens above', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([showParent], {
      route,
      options: { showParent: { hoverDelay: 0, direction: 'up' } },
    });
    m.flush();
    await open(m, 't1_c2');
    const names = [...document.querySelectorAll('.rescue-hover .rescue-parent-preview strong')].map(
      (e) => e.textContent,
    );
    expect(names).toEqual(['u/user0', 'u/rockpaperblr']);
    m.dispose();
  });

  it('parentChain stops at the top and never loops', () => {
    const a = baseComment({ id: 'a', parentId: 'b' });
    const b = baseComment({ id: 'b', parentId: 'a' });
    expect(
      parentChain(
        a,
        new Map([
          ['a', a],
          ['b', b],
        ]),
      ).map((c) => c.id),
    ).toEqual(['b']);
  });

  it('Shift+P opens the popup for the selected reply, and only then', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([showParent], { route, options: hoverOpts });
    m.flush();
    expect(m.keys.run('showParent')).toBe(false); // nothing selected
    m.selection.select('t1_c0');
    expect(m.keys.run('showParent')).toBe(false); // top-level: no parent
    m.selection.select('t1_c2');
    press(m, 'P', true);
    for (let i = 0; i < 6 && !document.querySelector('.rescue-parent-chain'); i++) await tick();
    expect(document.querySelectorAll('.rescue-hover .rescue-parent-preview')).toHaveLength(2);
    m.dispose();
  });
});

describe('hideChildComments (parity)', () => {
  it('nested comments get a control too, hiding their direct replies', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([hideChildComments], { route });
    m.flush();
    const toggle = own(el('t1_c1'), '.rescue-hide-children') as HTMLButtonElement; // c1 has c2
    expect(toggle.hidden).toBe(false);
    toggle.click();
    expect(hiddenBy('t1_c2')).toBe('hideChildComments');
    expect(hiddenBy('t1_c1')).toBeNull();
    expect(hiddenBy('t1_c3')).toBeNull(); // c1's sibling
    m.dispose();
  });

  it('the strip button leaves nested replies alone unless hideNested is on', async () => {
    mount(nestedThreadHtml());
    const plain = await bootModules([hideChildComments], { route });
    plain.flush();
    plain.menu('hideAllReplies');
    expect(hiddenBy('t1_c1')).toBe('hideChildComments');
    expect(hiddenBy('t1_c2')).toBeNull();
    plain.dispose();
    document.body.innerHTML = '';

    mount(nestedThreadHtml());
    const deep = await bootModules([hideChildComments], {
      route,
      options: { hideChildComments: { hideNested: true } },
    });
    deep.flush();
    deep.menu('hideAllReplies');
    for (const id of ['t1_c1', 't1_c2', 't1_c9', 't1_c10'])
      expect(hiddenBy(id)).toBe('hideChildComments');
    deep.dispose();
  });

  it('C toggles the selected comment’s replies and Shift+C every reply, in a thread only', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([hideChildComments], { route });
    m.flush();
    expect(m.keys.run('toggleChildren')).toBe(false); // nothing selected
    m.selection.select('t1_c0');
    press(m, 'c');
    expect(hiddenBy('t1_c1')).toBe('hideChildComments');
    expect(hiddenBy('t1_c3')).toBe('hideChildComments');
    press(m, 'c');
    expect(hiddenBy('t1_c1')).toBeNull();
    press(m, 'C', true);
    expect(hiddenBy('t1_c5')).toBe('hideChildComments');
    press(m, 'C', true);
    expect(hiddenBy('t1_c5')).toBeNull();
    m.goTo({ kind: 'all', path: '/r/all' });
    expect(m.keys.run('toggleChildren')).toBe(false);
    expect(m.keys.run('toggleAllChildren')).toBe(false);
    m.dispose();
  });
});
