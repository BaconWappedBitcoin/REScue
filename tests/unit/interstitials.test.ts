import { afterEach, describe, expect, it, vi } from 'vitest';
import { interstitials } from '../../src/modules/listings/interstitials';
import { bootModules } from './module-harness';

const AGE_GATE = '<div class="configured-xpromo-modal"><button>Yes, I am over 18</button></div>';
const ageNotices = (h: Awaited<ReturnType<typeof bootModules>>) =>
  h.notices.filter((n) => n.opts?.id === 'age-gate').length;

afterEach(() => {
  interstitials.dispose?.();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('interstitials', () => {
  it('finds an 18+ prompt reached by in-page navigation long after the page loaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    document.body.innerHTML = '<main></main>';
    const h = await bootModules([interstitials], { route: { kind: 'subreddit', path: '/r/a' } });
    vi.advanceTimersByTime(120_000);
    document.body.insertAdjacentHTML('beforeend', AGE_GATE);
    h.goTo({ kind: 'subreddit', path: '/r/b' });
    expect(ageNotices(h)).toBe(1);
  });

  it('explains a second 18+ prompt after navigating on', async () => {
    document.body.innerHTML = AGE_GATE;
    const h = await bootModules([interstitials], { route: { kind: 'subreddit', path: '/r/a' } });
    expect(ageNotices(h)).toBe(1);
    h.goTo({ kind: 'subreddit', path: '/r/b' });
    expect(ageNotices(h)).toBe(2);
  });

  describe('login wall', () => {
    const WALL =
      '<desktop-dynamic-upsell-modal id="w"><p>Log in to keep reading</p></desktop-dynamic-upsell-modal>';
    const on = { interstitials: { removeLoginWall: true } };
    const wall = () => document.getElementById('w');

    it('removes the reading wall when the option is on', async () => {
      document.body.innerHTML = `<main></main>${WALL}`;
      await bootModules([interstitials], {
        route: { kind: 'subreddit', path: '/r/a' },
        options: on,
      });
      expect(wall()).toBeNull();
    });

    it('leaves the pop-up alone once the reader presses Reddit’s own Log In, even after the address changes', async () => {
      document.body.innerHTML =
        '<header><a id="login-button" href="/login/"><span>Log In</span></a></header><main></main>';
      const h = await bootModules([interstitials], {
        route: { kind: 'subreddit', path: '/r/a' },
        options: on,
      });
      document
        .querySelector('#login-button span')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      document.body.insertAdjacentHTML('beforeend', WALL);
      await h.tick();
      await new Promise((r) => setTimeout(r, 150));
      expect(wall()).not.toBeNull();
      h.goTo({ kind: 'subreddit', path: '/login' });
      await new Promise((r) => setTimeout(r, 150));
      expect(wall()).not.toBeNull();
    });

    it('a button reading "Sign Up" counts too; other clicks do not', async () => {
      document.body.innerHTML =
        '<button id="other">Join</button><button id="su">Sign Up</button><main></main>';
      const h = await bootModules([interstitials], {
        route: { kind: 'subreddit', path: '/r/a' },
        options: on,
      });
      document.getElementById('other')!.click();
      document.body.insertAdjacentHTML('beforeend', WALL);
      await new Promise((r) => setTimeout(r, 150));
      expect(wall()).toBeNull();
      document.getElementById('su')!.click();
      document.body.insertAdjacentHTML('beforeend', WALL);
      await h.tick();
      await new Promise((r) => setTimeout(r, 150));
      expect(wall()).not.toBeNull();
    });

    it('never removes a pop-up that holds a log-in form, even in its shadow root', async () => {
      document.body.innerHTML =
        '<main></main><desktop-dynamic-upsell-modal id="w"></desktop-dynamic-upsell-modal>';
      wall()!.attachShadow({ mode: 'open' }).innerHTML =
        '<form><input name="username"><input type="password"></form>';
      await bootModules([interstitials], {
        route: { kind: 'subreddit', path: '/r/a' },
        options: on,
      });
      expect(wall()).not.toBeNull();
    });
  });

  it('stops watching once switched off', async () => {
    document.body.innerHTML = '<main></main>';
    const h = await bootModules([interstitials], { route: { kind: 'subreddit', path: '/r/a' } });
    interstitials.dispose?.();
    document.body.insertAdjacentHTML('beforeend', AGE_GATE);
    await h.tick();
    expect(ageNotices(h)).toBe(0);
  });
});
