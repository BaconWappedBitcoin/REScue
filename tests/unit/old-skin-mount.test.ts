// The Old Reddit look's rows on a thread's comments: they settle (a comment without a head is not
// remounted forever), share one vote observer, run their words through one listener per row, find
// the comment's own action row without reading its replies, and skip the page-wide work in a
// flush of comments alone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../../src/core/settings';
import type { ModuleContext, Route } from '../../src/core/types';
import { ownActionRow, ownMatches } from '../../src/model/commentRow';
import { ownQueryAll } from '../../src/core/dom';
import { C } from '../../src/contracts/reddit';
import { MODULES } from '../../src/modules';
import { CommentView } from '../../src/modules/appearance/oldSkin/comment';
import { HighlightRows } from '../../src/modules/appearance/oldSkin/highlights';
import { SkinMount } from '../../src/modules/appearance/oldSkin/mount';
import { PageName } from '../../src/modules/appearance/oldSkin/pageName';
import { PostView } from '../../src/modules/appearance/oldSkin/post';
import { createActionApi } from '../../src/core/actions';
import type { BridgeApi } from '../../src/core/types';
import {
  addCommentRow,
  nestedCommentsHtml,
  POSTS,
  postHtml,
  type FixtureComment,
} from '../fixtures/pages';

const THREAD = { kind: 'thread', path: '/r/x/comments/p/t/', subreddit: 'x' } as Route;

function ctxFor(actions: Record<string, unknown> = {}) {
  const profile = defaultProfile();
  const settings = { profile: vi.fn(() => profile), definitions: () => MODULES };
  const ctx = {
    session: { signedIn: true, username: 'me' },
    options: {},
    settings,
    actions,
    notices: { show: vi.fn() },
  } as unknown as ModuleContext;
  return { ctx, settings };
}

const three: FixtureComment[] = [
  { id: 't1_a', depth: 0, author: 'x', body: 'a' },
  { id: 't1_b', depth: 1, author: 'y', body: 'b' },
  { id: 't1_c', depth: 0, author: 'z', body: 'c' },
];

/** A thread of comments with their action rows; `head`: Reddit's `details > summary` head line. */
function thread(head: boolean, comments = three): Element[] {
  document.body.innerHTML = `<shreddit-app><main id="main-content"><shreddit-comment-tree>${nestedCommentsHtml(comments, false, head)}</shreddit-comment-tree></main></shreddit-app>`;
  const hosts = [...document.querySelectorAll('shreddit-comment')];
  for (const h of hosts) addCommentRow(h, { score: 3 });
  return hosts;
}

let mount: SkinMount | null = null;

afterEach(() => {
  mount?.stop();
  mount = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the comment rows settle', () => {
  it('does not remount a comment without a head line after an outside change (was ~20 a second)', async () => {
    vi.useFakeTimers();
    const hosts = thread(false);
    const mounts = vi.spyOn(CommentView, 'mount');
    mount = new SkinMount(ctxFor().ctx, THREAD);
    mount.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(mounts).toHaveBeenCalledTimes(3);
    hosts[0]!.querySelector('[slot="comment"]')!.append(document.createElement('span'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(mounts).toHaveBeenCalledTimes(3);
    // Such a comment keeps the vote column and the link row; it has no head for the points.
    expect(hosts[0]!.querySelector(':scope > .rescue-ovote')).not.toBeNull();
    expect(hosts[0]!.querySelector('.rescue-ocl')).not.toBeNull();
    expect(hosts[0]!.querySelector('.rescue-opts')).toBeNull();
  });

  it('remounts a comment whose pieces Reddit took away, once', async () => {
    vi.useFakeTimers();
    const hosts = thread(true);
    const mounts = vi.spyOn(CommentView, 'mount');
    mount = new SkinMount(ctxFor().ctx, THREAD);
    mount.start();
    await vi.advanceTimersByTimeAsync(200);
    hosts[2]!.querySelector('.rescue-ocl')!.remove();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mounts).toHaveBeenCalledTimes(4);
    expect(hosts[2]!.querySelector('.rescue-ocl')).not.toBeNull();
    expect(hosts[2]!.querySelector('.rescue-opts')!.textContent).toMatch(/^3 points /);
  });
});

describe('votes', () => {
  it('follow Reddit’s own buttons live through one observer for every comment', async () => {
    vi.useFakeTimers();
    const made = vi.spyOn(globalThis, 'MutationObserver');
    const hosts = thread(true);
    mount = new SkinMount(ctxFor().ctx, THREAD);
    mount.start();
    await vi.advanceTimersByTimeAsync(200);
    // The skin's own observer, the rows watcher and ONE for all vote boxes.
    expect(made).toHaveBeenCalledTimes(3);
    const press = (h: Element, dir: 'upvote' | 'downvote') =>
      ownActionRow(h)!
        .shadowRoot!.querySelector(`button[${dir}]`)!
        .setAttribute('aria-pressed', 'true');
    const box = (h: Element) => h.querySelector(':scope > .rescue-ovote')!;
    press(hosts[1]!, 'upvote');
    press(hosts[2]!, 'downvote');
    await vi.advanceTimersByTimeAsync(0);
    expect(box(hosts[0]!).getAttribute('data-vote')).toBe('none');
    expect(box(hosts[1]!).getAttribute('data-vote')).toBe('up');
    expect(box(hosts[1]!).querySelector('.rescue-onum')!.textContent).toBe('4');
    expect(box(hosts[2]!).getAttribute('data-vote')).toBe('down');
    // A comment Reddit removes stops being followed; the others still are.
    hosts[2]!.remove();
    await vi.advanceTimersByTimeAsync(200);
    press(hosts[0]!, 'upvote');
    await vi.advanceTimersByTimeAsync(0);
    expect(box(hosts[0]!).getAttribute('data-vote')).toBe('up');
  });
});

describe('the link row', () => {
  it('runs a plain click on a word through Reddit’s control and keeps it from Reddit’s card', async () => {
    const startReply = vi.fn(async () => ({ ok: true }));
    const [host] = thread(true, [{ id: 't1_a', depth: 0, author: 'x', body: 'a' }]);
    CommentView.mount(host!, ctxFor({ startReply }).ctx);
    const card = vi.fn();
    host!.addEventListener('click', card);
    const reply = [...host!.querySelectorAll('.rescue-ocl button')].find(
      (b) => b.textContent === 'reply',
    ) as HTMLButtonElement;
    reply.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(startReply).not.toHaveBeenCalled();
    reply.click();
    expect(startReply).toHaveBeenCalledTimes(1);
    expect(startReply).toHaveBeenCalledWith({ id: 't1_a', source: host });
    expect(card).not.toHaveBeenCalled();
    // A click beside the words is Reddit's to handle, as before.
    host!.querySelector('.rescue-ocl')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(card).toHaveBeenCalledTimes(1);
  });

  it('shows an edit Reddit draws after the rows were mounted', () => {
    const [host] = thread(true, [{ id: 't1_a', depth: 0, author: 'x', body: 'a' }]);
    const view = CommentView.mount(host!, ctxFor().ctx)!;
    const mark = host!.querySelector<HTMLElement>('.rescue-oedited')!;
    expect(mark.hidden).toBe(true);
    host!
      .querySelector(':scope > details > summary > [slot="commentMeta"]')!
      .insertAdjacentHTML(
        'beforeend',
        '<span>Edited <faceplate-timeago ts="2026-10-17T10:00:00.000Z"></faceplate-timeago></span>',
      );
    view.render();
    expect(mark.hidden).toBe(false);
    expect(mark.textContent).toBe('*');
  });
});

describe('the comment’s own parts', () => {
  it('are found without stepping into replies, the same as ownQueryAll', () => {
    const hosts = thread(true);
    for (const h of hosts) {
      expect(ownActionRow(h)).toBe(ownQueryAll(h, C.commentActions.row, C.comment)[0] ?? null);
      expect(ownMatches(h, C.edited.meta)).toEqual(ownQueryAll(h, C.edited.meta, C.comment));
      expect(ownMatches(h, 'p')).toEqual(ownQueryAll(h, 'p', C.comment));
    }
    expect(ownActionRow(hosts[0]!)!.closest(C.comment)).toBe(hosts[0]);
  });
});

describe('a flush of comments alone', () => {
  it('skips the page-wide pieces, and reads the settings once per settings change', async () => {
    vi.useFakeTimers();
    const hosts = thread(true);
    const { ctx, settings } = ctxFor();
    const highlights = vi.spyOn(HighlightRows.prototype, 'sync');
    const pageName = vi.spyOn(PageName.prototype, 'sync');
    mount = new SkinMount(ctx, THREAD);
    mount.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(highlights).toHaveBeenCalledTimes(1);
    expect(pageName).toHaveBeenCalledTimes(1);
    const reads = settings.profile.mock.calls.length;
    for (const h of hosts) h.setAttribute('score', '9');
    await vi.advanceTimersByTimeAsync(200);
    expect(highlights).toHaveBeenCalledTimes(1);
    expect(pageName).toHaveBeenCalledTimes(1);
    expect(settings.profile.mock.calls.length).toBe(reads);
    mount.settingsChanged();
    mount.setRoute(THREAD);
    await vi.advanceTimersByTimeAsync(200);
    expect(highlights).toHaveBeenCalledTimes(2);
    expect(settings.profile.mock.calls.length).toBeGreaterThan(reads);
  });
});

/** A feed post in Reddit's live shape: vote buttons in its open shadow root that flip 60 ms after a click. */
function feedPost(media = ''): { host: Element; presses: string[] } {
  document.body.innerHTML = `<shreddit-app><main id="main-content"><shreddit-feed>${postHtml(POSTS[0]!)}</shreddit-feed></main></shreddit-app>`;
  const host = document.querySelector('shreddit-post')!;
  host.insertAdjacentHTML('beforeend', media);
  const sr = host.attachShadow({ mode: 'open' });
  sr.innerHTML =
    '<slot></slot><button upvote aria-pressed="false"></button><button downvote aria-pressed="false"></button>';
  const presses: string[] = [];
  for (const b of sr.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      presses.push(`${b.hasAttribute('upvote') ? 'up' : 'down'}-${on ? 'on' : 'off'}`);
      setTimeout(() => {
        for (const o of sr.querySelectorAll('button')) o.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', String(on));
      }, 60);
    });
  }
  return { host, presses };
}

/** The real action API over a stand-in bridge that presses and reads the post's own buttons. */
function votingCtx(host: Element) {
  const button = (control: string) =>
    host.shadowRoot!.querySelector<HTMLElement>(`button[${control}]`);
  const bridge = {
    ref: () => 'r1',
    request: async (req: { op: string; control: string }) => {
      const b = button(req.control);
      if (!b) return { ok: false, error: 'not-found' };
      if (req.op === 'native.click') b.click();
      return { ok: true, pressed: b.getAttribute('aria-pressed') === 'true' };
    },
  } as unknown as BridgeApi;
  const actions = createActionApi({ bridge, session: () => ({ signedIn: true, username: 'me' }) });
  return ctxFor(actions as unknown as Record<string, unknown>).ctx;
}

describe('the post’s vote column', () => {
  it('does not drop a click made while the vote before it is being confirmed', async () => {
    vi.useFakeTimers();
    const { host, presses } = feedPost();
    const view = PostView.mount(host, votingCtx(host), () => THREAD)!;
    const col = host.querySelector('.rescue-ovote')!;
    const click = (cls: string) => col.querySelector<HTMLElement>(cls)!.click();

    click('.rescue-oup');
    await vi.advanceTimersByTimeAsync(70); // Reddit's button shows it; the confirmation is still due
    expect(col.getAttribute('data-vote')).toBe('up');
    expect(col.getAttribute('aria-busy')).toBe('true');
    click('.rescue-oup'); // the same arrow clears it: used to be dropped while busy
    await vi.advanceTimersByTimeAsync(1000);
    expect(presses).toEqual(['up-on', 'up-off']);
    expect(col.getAttribute('data-vote')).toBe('none');

    click('.rescue-oup');
    await vi.advanceTimersByTimeAsync(1000);
    click('.rescue-oup');
    await vi.advanceTimersByTimeAsync(70); // cleared on Reddit's buttons, confirmation still due
    expect(col.getAttribute('data-vote')).toBe('none');
    click('.rescue-odown'); // the flaky browser test's step: "received none"
    await vi.advanceTimersByTimeAsync(1000);
    expect(presses.slice(2)).toEqual(['up-on', 'up-off', 'down-on']);
    expect(col.getAttribute('data-vote')).toBe('down');
    view.dispose();
  });
});

describe('a gallery post in a feed', () => {
  it('shows the gallery’s first picture as its thumbnail, not the strip of all of them', () => {
    const { host } = feedPost(
      '<div slot="post-media-container"><gallery-carousel><ul>' +
        '<li><img src="https://preview.redd.it/first.jpg"></li>' +
        '<li><img src="https://preview.redd.it/second.jpg"></li>' +
        '<li><img data-lazy-src="https://preview.redd.it/third.jpg"></li></ul></gallery-carousel></div>',
    );
    const view = PostView.mount(host, ctxFor().ctx, () => THREAD)!;
    const thumb = host.querySelector<HTMLElement>(':scope > .rescue-oth')!;
    expect(thumb.getAttribute('data-kind')).toBe('img');
    expect(thumb.style.getPropertyValue('--os-thumb')).toBe(
      'url("https://preview.redd.it/first.jpg")',
    );
    view.dispose();
  });

  it('takes a first picture Reddit has not loaded yet from its lazy address', () => {
    const { host } = feedPost(
      '<div slot="post-media-container"><gallery-carousel><ul>' +
        '<li><img data-lazy-src="https://preview.redd.it/lazy.jpg"></li>' +
        '<li><img src="https://preview.redd.it/second.jpg"></li></ul></gallery-carousel></div>',
    );
    const view = PostView.mount(host, ctxFor().ctx, () => THREAD)!;
    const thumb = host.querySelector<HTMLElement>(':scope > .rescue-oth')!;
    expect(thumb.style.getPropertyValue('--os-thumb')).toBe(
      'url("https://preview.redd.it/lazy.jpg")',
    );
    view.dispose();
  });
});
