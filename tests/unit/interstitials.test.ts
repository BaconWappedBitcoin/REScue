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

  it('stops watching once switched off', async () => {
    document.body.innerHTML = '<main></main>';
    const h = await bootModules([interstitials], { route: { kind: 'subreddit', path: '/r/a' } });
    interstitials.dispose?.();
    document.body.insertAdjacentHTML('beforeend', AGE_GATE);
    await h.tick();
    expect(ageNotices(h)).toBe(0);
  });
});
