/** Comment tools UI parity, part 2 (ui-parity batch 5b): save-RES, read comments, singleClick. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readComments } from '../../src/modules/comments/readComments';
import { closeReadStore } from '../../src/modules/comments/readTracking';
import { saveComments } from '../../src/modules/comments/saveComments';
import { singleClick, singleClickTargets } from '../../src/modules/listings/browsing';
import type { Post } from '../../src/model/types';
import { listingHtml, mount, nestedThreadHtml, threadComments } from '../fixtures/pages';
import { bootModules, own, tick } from './module-harness';

vi.mock('../../src/core/tabs', async (orig) => ({
  ...(await orig<typeof import('../../src/core/tabs')>()),
  openTabs: vi.fn(),
}));
const { openTabs } = await import('../../src/core/tabs');

afterEach(() => {
  closeReadStore();
  document.body.innerHTML = '';
  vi.mocked(openTabs).mockClear();
});

const RD = (path: string) => new URL(path, location.origin).href;
const route = { kind: 'thread', path: '/r/Layoffs/comments/text1/x', postId: 't3_text1' };
const el = (id: string) => document.querySelector(`shreddit-comment[thingid="${id}"]`)!;
const hiddenBy = (id: string) => el(id).getAttribute('data-rescue-hidden');

describe('saveComments (parity)', () => {
  const saveBtn = (id: string) => own(el(id), '.rescue-save-comment') as HTMLButtonElement;

  it('explains save versus save-RES once, the first time something is saved', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([saveComments], { route });
    m.flush();
    saveBtn('t1_c1').click();
    await tick();
    await tick();
    expect(m.notices).toHaveLength(1);
    expect(m.notices[0]!.opts?.id).toBe('saveRES-explainer');
    expect(m.notices[0]!.message).toContain('save-RES');
    expect(m.notices[0]!.message).toContain('Reddit’s own');
    expect(m.moduleStore.saveComments).toEqual({ explainerShown: true });
    saveBtn('t1_c1').click(); // unsave
    saveBtn('t1_c1').click(); // save again
    await tick();
    await tick();
    expect(m.notices).toHaveLength(1);
    m.dispose();
  });

  it('does not repeat the explainer on a later page once it was shown', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([saveComments], { route });
    m.moduleStore.saveComments = { explainerShown: true };
    m.flush();
    saveBtn('t1_c2').click();
    await tick();
    await tick();
    expect(m.notices).toHaveLength(0);
    m.dispose();
  });

  it('lists “saved N ago” and an unsave-RES button', async () => {
    mount(nestedThreadHtml());
    const stored = {
      savedComments: {
        t1_c0: {
          commentId: 't1_c0',
          permalink: '/r/Layoffs/comments/text1/got_laid_off/c0/',
          author: 'x',
          subreddit: 'Layoffs',
          bodyText: 'kept',
          savedAt: Date.now() - 3 * 3_600_000 - 5000,
        },
      },
    };
    const m = await bootModules([saveComments], { route, stored });
    m.flush();
    m.menu('savedComments');
    const panel = document.getElementById('rescue-saved-comments')!;
    expect(panel.textContent).toContain('saved 3 hours ago');
    expect(panel.querySelector('.rescue-saved-remove')!.textContent).toBe('unsave-RES');
    m.dispose();
  });
});

describe('readComments hide read (parity)', () => {
  const T = Date.now();
  const HOUR = 3_600_000;
  const comments = () =>
    threadComments().map((c, i) => ({
      ...c,
      created: new Date(T - (i === 0 || i === 2 ? HOUR / 2 : 3 * HOUR)).toISOString(),
    }));
  const stored = { read: { t3_text1: { lastVisit: T - HOUR, commentCountAtVisit: 1100 } } };

  it('offers to hide read comments on a revisit, keeping those with new replies, and to unhide them', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments], { route, stored });
    m.flush();
    await tick();
    expect(m.notices).toHaveLength(1);
    const offer = m.notices[0]!;
    expect(offer.opts?.actions?.map((a) => a.label)).toEqual(['Hide read comments']);
    // c0 and c2 are new, c1 sits between them: those stay; every other comment was read.
    expect(document.querySelectorAll('[data-rescue-hidden]')).toHaveLength(0);

    offer.opts!.actions![0]!.run();
    for (const id of [
      't1_c3',
      't1_c4',
      't1_c5',
      't1_c6',
      't1_c7',
      't1_c8',
      't1_c9',
      't1_c10',
      't1_c11',
    ])
      expect(hiddenBy(id)).toBe('readComments');
    for (const id of ['t1_c0', 't1_c1', 't1_c2']) expect(hiddenBy(id)).toBeNull();
    const follow = m.notices[1]!;
    expect(follow.message).toBe('Hid 9 previously read comments.');
    expect(follow.opts?.actions?.map((a) => a.label)).toEqual(['Unhide']);

    follow.opts!.actions![0]!.run();
    expect(document.querySelectorAll('[data-rescue-hidden]')).toHaveLength(0);
    m.dispose();
  });

  it('offers nothing on a first visit', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments], { route });
    m.flush();
    await tick();
    expect(m.notices).toHaveLength(0);
    m.dispose();
  });
});

describe('singleClick (parity)', () => {
  const post = (over: Partial<Post> = {}): Post =>
    ({
      kind: 'post',
      id: 't3_a',
      permalink: '/r/aww/comments/a/b/',
      url: 'https://example.com/x',
      subreddit: 'aww',
      ...over,
    }) as Post;
  const on = { commentsFirst: true, hideLEC: false, openFrontpage: false };

  it('orders the tabs, labels text posts [l=c], and hides it unless asked', () => {
    expect(singleClickTargets(post(), on)).toEqual({
      urls: [RD('/r/aww/comments/a/b/'), 'https://example.com/x'],
      label: '[l+c]',
    });
    expect(singleClickTargets(post(), { ...on, commentsFirst: false })!.urls[0]).toBe(
      'https://example.com/x',
    );
    const text = post({ url: null });
    expect(singleClickTargets(text, { ...on, hideLEC: true })).toBeNull();
    expect(singleClickTargets(text, on)).toEqual({
      urls: [RD('/r/aww/comments/a/b/')],
      label: '[l=c]',
    });
    expect(singleClickTargets(text, { ...on, openFrontpage: true })).toEqual({
      urls: [RD('/r/aww/'), RD('/r/aww/comments/a/b/')],
      label: '[l+c]',
    });
    // The front page is only part of [l=c], so it never applies while [l=c] is hidden.
    expect(singleClickTargets(text, { ...on, hideLEC: true, openFrontpage: true })).toBeNull();
  });

  const control = (id: string) =>
    document.querySelector<HTMLAnchorElement>(`shreddit-post#${id} a.rescue-single-click`);

  it('shows [l=c] on text posts when hideLEC is off, and opens just the comments', async () => {
    mount(listingHtml());
    const hidden = await bootModules([singleClick], { route: { kind: 'all', path: '/r/all' } });
    hidden.flush();
    expect(control('t3_text1')).toBeNull();
    hidden.dispose();
    document.body.innerHTML = '';

    mount(listingHtml());
    const m = await bootModules([singleClick], {
      route: { kind: 'all', path: '/r/all' },
      options: { singleClick: { hideLEC: false } },
    });
    m.flush();
    const lc = control('t3_text1')!;
    expect(lc.textContent).toBe('[l=c]');
    lc.click();
    expect(openTabs).toHaveBeenLastCalledWith(
      [RD('/r/Layoffs/comments/text1/got_laid_off/')],
      true,
    );
    m.dispose();
  });

  it('opens comments first by default, link first by option, and background on ctrl or middle click', async () => {
    mount(listingHtml());
    const m = await bootModules([singleClick], { route: { kind: 'all', path: '/r/all' } });
    m.flush();
    const lc = control('t3_link1')!;
    lc.click();
    expect(openTabs).toHaveBeenLastCalledWith(
      [RD('/r/nottheonion/comments/link1/nasa/'), 'https://example.co.uk/nasa'],
      true,
    );
    lc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(vi.mocked(openTabs).mock.lastCall![1]).toBe(false);
    const aux = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
    lc.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
    expect(vi.mocked(openTabs).mock.calls).toHaveLength(3);
    expect(vi.mocked(openTabs).mock.lastCall![1]).toBe(false);
    m.dispose();
    document.body.innerHTML = '';

    mount(listingHtml());
    const linkFirst = await bootModules([singleClick], {
      route: { kind: 'all', path: '/r/all' },
      options: { singleClick: { commentsFirst: false } },
    });
    linkFirst.flush();
    control('t3_link1')!.click();
    expect(vi.mocked(openTabs).mock.lastCall![0][0]).toBe('https://example.co.uk/nasa');
    linkFirst.dispose();
  });
});
