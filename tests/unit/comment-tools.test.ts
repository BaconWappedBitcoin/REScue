import { afterEach, describe, expect, it, vi } from 'vitest';
import { filteReddit } from '../../src/modules/listings/filteReddit';
import {
  APPLY_GRACE_MS,
  commentHidePersistor,
  sanitizeCollapsed,
  withCollapsed,
} from '../../src/modules/comments/commentHidePersistor';
import { hideChildComments } from '../../src/modules/comments/hideChildComments';
import { sanitizeSaved } from '../../src/modules/comments/savedStore';
import { saveComments } from '../../src/modules/comments/saveComments';
import { showParent } from '../../src/modules/comments/showParent';
import { mount, nestedThreadHtml } from '../fixtures/pages';
import { bootModules, own, tick } from './module-harness';

const route = { kind: 'thread', path: '/r/Layoffs/comments/text1/x', postId: 't3_text1' };
const el = (id: string) => document.querySelector(`shreddit-comment[thingid="${id}"]`)!;
const hiddenBy = (id: string) => el(id).getAttribute('data-rescue-hidden');
const toggleOf = (id: string) => own(el(id), '.rescue-hide-children') as HTMLButtonElement;

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// Depths: c0(0) c1(1) c2(2) c3(1) c4(0) c5(1) c6(0) c7(0) c8(1) c9(2) c10(3) c11(0)
describe('hideChildComments', () => {
  it('hides only the direct replies of a top-level comment, and shows them again', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([hideChildComments], { route });
    m.flush();
    const toggle = toggleOf('t1_c0');
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe('hide child comments');

    toggle.click();
    expect(hiddenBy('t1_c1')).toBe('hideChildComments');
    expect(hiddenBy('t1_c3')).toBe('hideChildComments');
    expect(hiddenBy('t1_c2')).toBeNull(); // below c1: goes with it because Reddit nests replies
    expect(hiddenBy('t1_c0')).toBeNull(); // the comment itself stays
    expect(hiddenBy('t1_c4')).toBeNull(); // another thread
    expect(toggle.textContent).toBe('show 3 child comments');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(hiddenBy('t1_c1')).toBeNull();
    expect(toggle.textContent).toBe('hide child comments');
    m.dispose();
  });

  it('offers no control on a comment without replies, and none on a reply when nested is off', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([hideChildComments], {
      route,
      options: { hideChildComments: { nested: false } },
    });
    m.flush();
    expect(toggleOf('t1_c6')).toBeNull();
    expect(own(el('t1_c1'), '.rescue-hide-children')).toBeNull();
    m.dispose();
  });

  it('the strip button hides and shows every top-level comment’s replies', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([hideChildComments], { route });
    m.flush();
    expect(document.querySelector('.rescue-hide-all-replies')).toBeNull(); // not in the strip
    expect(m.menuText('hideAllReplies')).toBe('Hide all replies');
    m.menu('hideAllReplies');
    for (const id of ['t1_c1', 't1_c3', 't1_c5', 't1_c8'])
      expect(hiddenBy(id)).toBe('hideChildComments');
    expect(m.menuText('hideAllReplies')).toBe('Show all replies');
    m.menu('hideAllReplies');
    expect(hiddenBy('t1_c8')).toBeNull();
    m.dispose();
  });

  it('can start hidden, and hides replies that load later', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([hideChildComments], {
      route,
      options: { hideChildComments: { startHidden: true } },
    });
    m.flush();
    expect(hiddenBy('t1_c1')).toBe('hideChildComments');
    el('t1_c6').insertAdjacentHTML(
      'beforeend',
      '<shreddit-comment thingid="t1_late" postid="t3_text1" author="x" depth="1" score="1" created="2026-10-15T11:00:00.000Z"><div slot="commentMeta"></div><div slot="comment"><p>late</p></div></shreddit-comment>',
    );
    m.flush();
    expect(hiddenBy('t1_late')).toBe('hideChildComments');
    m.dispose();
  });

  it('does not change the filter notice, which counts only the posts it filtered', async () => {
    mount(nestedThreadHtml());
    const rules = [
      {
        type: 'keyword',
        pattern: 'laid',
        scope: 'everywhere',
        subreddits: '',
        enabled: true,
        toggle: '',
      },
    ];
    const m = await bootModules([filteReddit, hideChildComments], {
      route,
      options: { filteReddit: { rules } },
    });
    m.flush();
    toggleOf('t1_c0').click();
    expect(document.querySelector('.rescue-filter-banner')!.textContent).toContain(
      '1 post filtered',
    );
    m.dispose();
  });
});

describe('commentHidePersistor', () => {
  const thread = () => mount(nestedThreadHtml(undefined, false, true));
  const details = (id: string) =>
    [...el(id).querySelectorAll('details')].find(
      (d) => d.closest('shreddit-comment') === el(id) && d.querySelector(':scope > summary'),
    ) as HTMLDetailsElement;
  /** What the browser does when the reader clicks the summary: flip `open`, then fire `toggle`. */
  const flip = (id: string, open: boolean) => {
    const d = details(id);
    d.open = open;
    d.dispatchEvent(new Event('toggle'));
  };
  const settle = () => new Promise((r) => setTimeout(r, 80));

  it('keeps the collapsed map bounded, newest last', () => {
    let map = withCollapsed({}, 't1_a', true, 3);
    map = withCollapsed(map, 't1_b', true, 3);
    map = withCollapsed(map, 't1_c', true, 3);
    map = withCollapsed(map, 't1_d', true, 3);
    expect(Object.keys(map)).toEqual(['t1_b', 't1_c', 't1_d']);
    expect(Object.keys(withCollapsed(map, 't1_c', false, 3))).toEqual(['t1_b', 't1_d']);
    expect(sanitizeCollapsed({ t1_ok: 1, bad: 1, 't1_x y': 1, t1_n: 'yes' })).toEqual({
      t1_ok: 1,
      t1_n: 1,
    });
  });

  it('finds a comment’s own collapse element, not a reply’s', () => {
    thread();
    expect(details('t1_c0')).not.toBe(details('t1_c1'));
    expect(details('t1_c0').closest('shreddit-comment')).toBe(el('t1_c0'));
    expect(details('t1_c0').querySelector(':scope > summary [slot="commentMeta"]')).not.toBeNull();
  });

  it('remembers what the reader collapses and forgets what they re-open', async () => {
    thread();
    const m = await bootModules([commentHidePersistor], { route });
    m.flush();
    flip('t1_c2', false);
    await tick();
    await tick();
    expect(m.store.collapsed).toEqual({ t1_c2: 1 });
    flip('t1_c2', true);
    await tick();
    await tick();
    expect(m.store.collapsed).toEqual({});
    m.dispose();
  });

  it('does not store comments Reddit itself pre-collapsed', async () => {
    thread();
    details('t1_c4').open = false;
    const m = await bootModules([commentHidePersistor], { route });
    m.flush();
    await settle();
    expect(m.store.collapsed).toBeUndefined();
    m.dispose();
  });

  it('collapses a remembered comment on a revisit by closing its details', async () => {
    thread();
    const m = await bootModules([commentHidePersistor], {
      route,
      stored: { collapsed: { t1_c3: 1 } },
    });
    m.flush();
    await settle();
    expect(details('t1_c3').open).toBe(false);
    expect(details('t1_c2').open).toBe(true);
    expect(m.store.collapsed).toEqual({ t1_c3: 1 });
    m.dispose();
  });

  it('a re-open right after REScue collapsed it is Reddit, not the reader; later it is the reader', async () => {
    thread();
    const m = await bootModules([commentHidePersistor], {
      route,
      stored: { collapsed: { t1_c3: 1 } },
    });
    m.flush();
    await settle();
    flip('t1_c3', true); // Reddit re-renders it open straight away
    await tick();
    await tick();
    expect(m.store.collapsed).toEqual({ t1_c3: 1 });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + APPLY_GRACE_MS + 1000);
    flip('t1_c3', false);
    await tick();
    flip('t1_c3', true);
    await tick();
    await tick();
    expect(m.store.collapsed).toEqual({});
    m.dispose();
  });

  it('falls back to clicking Reddit’s own summary when closing the details has no effect', async () => {
    thread();
    const d = details('t1_c3');
    const summary = d.querySelector(':scope > summary') as HTMLElement;
    let open = true;
    Object.defineProperty(d, 'open', { get: () => open, set: () => {} }); // Reddit ignores it
    const clicked: EventTarget[] = [];
    summary.addEventListener('click', (e) => {
      clicked.push(e.target!);
      open = false;
    });
    const m = await bootModules([commentHidePersistor], {
      route,
      stored: { collapsed: { t1_c3: 1 } },
    });
    m.flush();
    await settle();
    expect(clicked).toEqual([summary]); // on the summary itself, never on our buttons inside it
    expect(open).toBe(false);
    m.dispose();
  });

  it('does nothing harmful when neither closing nor clicking works', async () => {
    thread();
    const d = details('t1_c3');
    Object.defineProperty(d, 'open', { get: () => true, set: () => {} });
    const m = await bootModules([commentHidePersistor], {
      route,
      stored: { collapsed: { t1_c3: 1 } },
    });
    m.flush();
    await settle();
    expect(m.store.collapsed).toEqual({ t1_c3: 1 });
    expect(el('t1_c3').getAttribute('data-rescue-hidden')).toBeNull();
    m.dispose();
  });
});

describe('showParent', () => {
  const hoverOpts = { showParent: { hoverDelay: 0 } };

  it('adds the control only to replies, whose popup shows the parent’s author and a copy of its body', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([showParent], { route, options: hoverOpts });
    m.flush();
    expect(own(el('t1_c0'), '.rescue-show-parent')).toBeNull();
    const btn = own(el('t1_c2'), '.rescue-show-parent') as HTMLButtonElement;
    expect(btn.textContent).toBe('↑ parent');

    btn.dispatchEvent(new MouseEvent('mouseenter'));
    for (let i = 0; i < 5 && !document.querySelector('.rescue-parent-preview'); i++) await tick();
    const preview = document.querySelector('.rescue-hover .rescue-parent-preview')!;
    expect(preview.textContent).toContain('u/rockpaperblr'); // c1's author
    expect(preview.textContent).toContain('comment 1 body');
    const original = own(el('t1_c1'), '[slot="comment"]')!;
    const copy = preview.querySelector('p')!;
    expect(copy).not.toBe(original.querySelector('p'));
    expect(copy.hasAttribute('slot')).toBe(false);
    m.dispose();
    expect(document.querySelector('.rescue-hover')).toBeNull();
  });

  it('clicking jumps to the parent through the selection', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([showParent], { route, options: hoverOpts });
    m.flush();
    (own(el('t1_c2'), '.rescue-show-parent') as HTMLButtonElement).click();
    expect(m.selection.current()?.id).toBe('t1_c1');
    m.dispose();
  });
});

describe('saveComments', () => {
  const saveBtn = (id: string) => own(el(id), '.rescue-save-comment') as HTMLButtonElement;

  it('saves a text snapshot, lists it, and removes it', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([saveComments], { route });
    m.flush();
    expect(m.menuText('savedComments')).toBe('Saved comments');
    saveBtn('t1_c1').click();
    await tick();
    await tick();
    const saved = m.store.savedComments as Record<string, Record<string, unknown>>;
    expect(Object.keys(saved)).toEqual(['t1_c1']);
    expect(saved.t1_c1).toMatchObject({
      commentId: 't1_c1',
      author: 'rockpaperblr',
      subreddit: 'Layoffs',
      bodyText: 'comment 1 body',
    });
    expect(saved.t1_c1!.permalink).toBe('/r/Layoffs/comments/text1/got_laid_off/c1/');
    expect(saved.t1_c1!.bodyHtml).toBeUndefined(); // text only
    expect(saveBtn('t1_c1').textContent).toBe('saved-RES');
    expect(m.menuText('savedComments')).toBe('Saved comments (1)');

    m.menu('savedComments');
    const panel = document.getElementById('rescue-saved-comments')!;
    expect(panel.querySelectorAll('.rescue-saved-item')).toHaveLength(1);
    expect(panel.textContent).toContain('comment 1 body');
    expect(panel.querySelector<HTMLAnchorElement>('a.rescue-saved-open')!.href).toContain(
      '/r/Layoffs/comments/text1/got_laid_off/c1/',
    );
    panel.querySelector<HTMLButtonElement>('.rescue-saved-remove')!.click();
    await tick();
    await tick();
    expect(m.store.savedComments).toEqual({});
    expect(document.querySelector('.rescue-saved-empty')).not.toBeNull();
    expect(saveBtn('t1_c1').textContent).toBe('save-RES');
    m.dispose();
    expect(document.getElementById('rescue-saved-comments')).toBeNull();
  });

  it('shows earlier saves as saved, and renders saved text as text, never markup', async () => {
    mount(nestedThreadHtml());
    const stored = {
      savedComments: {
        t1_c0: {
          commentId: 't1_c0',
          permalink: 'javascript:alert(1)',
          author: 'x',
          subreddit: 'Layoffs',
          bodyText: '<img src=x onerror=alert(1)>',
          savedAt: 1,
        },
      },
    };
    const m = await bootModules([saveComments], { route, stored });
    m.flush();
    expect(saveBtn('t1_c0').textContent).toBe('saved-RES');
    m.menu('savedComments');
    const panel = document.getElementById('rescue-saved-comments')!;
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel.querySelector('a.rescue-saved-open')).toBeNull(); // unsafe link is not offered
    m.dispose();
  });

  it('drops malformed saved entries', () => {
    expect(sanitizeSaved({ t1_a: 'junk', t1_b: { author: 5, bodyText: 'ok' } })).toEqual({
      t1_b: {
        commentId: 't1_b',
        permalink: '',
        author: '',
        subreddit: '',
        bodyText: 'ok',
        savedAt: 0,
      },
    });
  });
});
