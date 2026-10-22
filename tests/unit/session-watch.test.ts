/**
 * model/session.ts: when REScue may start before the page has finished (pageStartable), and how
 * the signed-in state is followed (watchSession) — which is what lets votes and saves through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionApi } from '../../src/core/actions';
import type { BridgeApi } from '../../src/core/types';
import { pageStartable, readSession, watchSession } from '../../src/model/session';
import type { Session } from '../../src/model/types';

const doc = (html: string): Document => {
  const d = document.implementation.createHTMLDocument('');
  d.body.innerHTML = html;
  return d;
};
const app = (state: string | null, inner: string) =>
  `<shreddit-app${state === null ? '' : ` user-logged-in="${state}"`}>${inner}</shreddit-app>`;
const HEADER = '<reddit-header-large></reddit-header-large>';
const FEED = '<shreddit-feed></shreddit-feed>';

describe('pageStartable', () => {
  it.each([
    ['signed out, header and feed in', app('false', HEADER + FEED)],
    [
      'signed in with the early current-user tag',
      app('true', `${HEADER}<rs-current-user display-name="alice"></rs-current-user>${FEED}`),
    ],
    [
      'signed in with the username toast',
      app(
        'true',
        `<after-login-toast-dispatcher username="alice"></after-login-toast-dispatcher>${HEADER}<shreddit-post></shreddit-post>`,
      ),
    ],
    [
      'a thread whose first comment is in',
      app('false', `${HEADER}<shreddit-comment></shreddit-comment>`),
    ],
  ])('is true when %s', (_n, html) => {
    expect(pageStartable(doc(html))).toBe(true);
  });

  it.each([
    ['no header yet', app('false', FEED)],
    ['no signed-in state yet', app(null, HEADER + FEED)],
    ['a signed-in state that is neither true nor false', app('maybe', HEADER + FEED)],
    ['signed in but the name not in yet', app('true', HEADER + FEED)],
    ['no post, comment or feed yet', app('false', HEADER)],
  ])('is false with %s', (_n, html) => {
    expect(pageStartable(doc(html))).toBe(false);
  });
});

/** Let the MutationObserver deliver what was queued. */
const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('watchSession', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
    document.body.innerHTML = '';
  });

  /** A signed-in page whose name comes from the early current-user tag. */
  const page = () => {
    document.body.innerHTML = app(
      'true',
      `${HEADER}<rs-current-user display-name="alice"></rs-current-user>${FEED}`,
    );
    document.body.insertAdjacentHTML('beforeend', '<div id="rescue-notices"></div>');
    const changes: Session[] = [];
    stop = watchSession((s) => changes.push(s));
    return {
      changes,
      user: document.querySelector('rs-current-user')!,
      feed: document.querySelector('shreddit-feed')!,
      header: document.querySelector('reddit-header-large')!,
    };
  };

  it('reports a sign-out in another tab (the header re-renders signed out)', async () => {
    const { changes, user } = page();
    document.querySelector('shreddit-app')!.setAttribute('user-logged-in', 'false');
    user.remove();
    await flush();
    expect(changes).toEqual([{ signedIn: false, username: null }]);
  });

  it('reports a change of account, and stays quiet when nothing changed', async () => {
    const { changes, user, header } = page();
    header.append(document.createElement('div'));
    await flush();
    expect(changes).toEqual([]);
    user.remove();
    const toast = document.createElement('after-login-toast-dispatcher');
    toast.setAttribute('username', 'bob');
    document.querySelector('shreddit-app')!.prepend(toast);
    await flush();
    expect(changes).toEqual([{ signedIn: true, username: 'bob' }]);
  });

  it('does not re-read the session for posts and comments coming in, nor REScue’s own UI', async () => {
    const { changes, user, feed, header } = page();
    // A change the observer does not watch: the session is only re-read on the next real change.
    user.setAttribute('display-name', 'carol');
    feed.append(
      document.createElement('shreddit-post'),
      document.createElement('shreddit-comment'),
    );
    const post = feed.querySelector('shreddit-post')!;
    post.append(document.createElement('span')); // inside a post
    const own = document.getElementById('rescue-notices')!;
    own.append(document.createElement('p')); // inside REScue's own overlay
    feed.firstElementChild!.remove();
    await flush();
    expect(changes).toEqual([]);
    header.append(document.createElement('div'));
    await flush();
    expect(changes).toEqual([{ signedIn: true, username: 'carol' }]);
  });

  it('stops watching once its stop function is called', async () => {
    const { changes } = page();
    stop!();
    document.querySelector('shreddit-app')!.setAttribute('user-logged-in', 'false');
    document.querySelector('rs-current-user')!.remove();
    await flush();
    expect(changes).toEqual([]);
  });

  it('gates votes and saves: after a sign-out they are refused before anything is pressed', async () => {
    const { user } = page();
    let session = readSession();
    stop?.();
    stop = watchSession((s) => (session = s));
    const request = vi.fn(async () => ({ ok: true, pressed: false }));
    const bridge = { ref: () => 'r1', request } as unknown as BridgeApi;
    const api = createActionApi({ bridge, session: () => session, sleep: async () => {} });
    const target = { id: 't3_a', source: document.createElement('shreddit-post') };
    await api.vote(target, 1);
    expect(request).toHaveBeenCalled();
    request.mockClear();

    document.querySelector('shreddit-app')!.setAttribute('user-logged-in', 'false');
    user.remove();
    await flush();
    expect(await api.vote(target, 1)).toEqual({ ok: false, reason: 'signed-out' });
    expect(await api.save(target, true)).toEqual({ ok: false, reason: 'signed-out' });
    expect(request).not.toHaveBeenCalled();
  });
});
