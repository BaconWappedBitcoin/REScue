import { describe, expect, it, vi } from 'vitest';
import { ensureRunning, isRedditPage } from '../../src/core/startupCheck';

describe('startup check', () => {
  it('knows Reddit pages REScue runs on', () => {
    expect(isRedditPage('https://www.reddit.com/r/x/comments/1/a/')).toBe(true);
    expect(isRedditPage('https://sh.reddit.com/')).toBe(true);
    expect(isRedditPage('https://reddit.com/')).toBe(true);
    expect(isRedditPage('https://old.reddit.com/')).toBe(false);
    expect(isRedditPage('https://www.reddit.com/media?url=x')).toBe(false);
    expect(isRedditPage('https://example.com/')).toBe(false);
    expect(isRedditPage(undefined)).toBe(false);
  });
  it('leaves a tab alone when REScue answers', async () => {
    const inject = vi.fn(async () => {});
    expect(await ensureRunning(1, { ping: async () => true, inject })).toBe(false);
    expect(inject).not.toHaveBeenCalled();
  });
  it('starts REScue when nothing answers', async () => {
    const inject = vi.fn(async () => {});
    expect(
      await ensureRunning(1, { ping: () => Promise.reject(new Error('no receiver')), inject }),
    ).toBe(true);
    expect(inject).toHaveBeenCalledWith(1);
  });
});
