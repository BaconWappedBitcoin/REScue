import { afterEach, describe, expect, it, vi } from 'vitest';
import { hideLinks } from '../../src/modules/listings/hideLinks';
import { autoHide } from '../../src/modules/listings/autoHide';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const post = () => ({ id: 't3_a', source: document.createElement('shreddit-post') });

function ctxOf(options: Record<string, unknown>, hide = vi.fn(async () => ({ ok: true as const }))) {
  const decorated: HTMLElement[] = [];
  const ctx = {
    options,
    actions: { hide },
    ui: { decorate: (_p: unknown, _slot: string, el: HTMLElement) => void decorated.push(el) },
    notices: { show: vi.fn() },
  };
  return { ctx, decorated, hide };
}

describe('hideLinks', () => {
  it('adds nothing while fixHideLinks is off', () => {
    const t = ctxOf({ fixHideLinks: false });
    hideLinks.onItems!({ posts: [post()], comments: [] } as never, t.ctx as never);
    expect(t.decorated).toEqual([]);
  });

  it('hide at once presses Reddit’s hide when clicked', () => {
    const t = ctxOf({ fixHideLinks: true, hideLinkInstant: true, hideLinkFadeDelay: 5000 });
    hideLinks.onItems!({ posts: [post()], comments: [] } as never, t.ctx as never);
    expect(t.decorated).toHaveLength(1);
    t.decorated[0]!.click();
    expect(t.hide).toHaveBeenCalledTimes(1);
  });

  it('otherwise hides only after the fade delay', () => {
    vi.useFakeTimers();
    const t = ctxOf({ fixHideLinks: true, hideLinkInstant: false, hideLinkFadeDelay: 3000 });
    hideLinks.onItems!({ posts: [post()], comments: [] } as never, t.ctx as never);
    t.decorated[0]!.click();
    vi.advanceTimersByTime(2999);
    expect(t.hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(t.hide).toHaveBeenCalledTimes(1);
    hideLinks.dispose!();
  });
});

describe('autoHide option', () => {
  it('declares hideOnReddit, off by default', () => {
    expect(autoHide.options.hideOnReddit).toMatchObject({ type: 'boolean', default: false });
  });
});
