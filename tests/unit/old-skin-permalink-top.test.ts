import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  holdTop,
  isCommentLink,
  releaseTop,
} from '../../src/modules/appearance/oldSkin/permalinkTop';

/** A window stand-in whose scroll position the test sets, with real listeners. */
function fakeWindow() {
  const target = new EventTarget();
  const w = {
    scrollY: 0,
    scrollTo: vi.fn((_x: number, y: number) => {
      w.scrollY = y;
    }),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    reddit(y: number) {
      w.scrollY = y;
      target.dispatchEvent(new Event('scroll'));
    },
    reader(type: string) {
      target.dispatchEvent(new Event(type));
    },
  };
  return w;
}

afterEach(() => {
  releaseTop();
  vi.useRealTimers();
});

describe('comment links open at the top (old look)', () => {
  it('knows a single comment’s permalink from a thread', () => {
    expect(isCommentLink('/r/vibecoding/comments/1wrmzzx/comment/pcx8amn/')).toBe(true);
    expect(isCommentLink('/r/vibecoding/comments/1wrmzzx/some_title/pcx8amn/')).toBe(true);
    expect(isCommentLink('/r/vibecoding/comments/1wrmzzx/some_title/')).toBe(false);
    expect(isCommentLink('/r/vibecoding/comments/1wrmzzx/')).toBe(false);
  });

  it('undoes Reddit’s jump to the comment until the reader scrolls themselves', () => {
    const w = fakeWindow();
    holdTop('/r/x/comments/abc/comment/def/', w as unknown as Window);
    w.reddit(587);
    expect(w.scrollY).toBe(0);
    w.reader('wheel');
    w.reddit(300);
    expect(w.scrollY).toBe(300);
  });

  it('lets go after a few seconds, and never holds an ordinary thread', () => {
    vi.useFakeTimers();
    const w = fakeWindow();
    holdTop('/r/x/comments/abc/comment/def/', w as unknown as Window);
    vi.advanceTimersByTime(5000);
    w.reddit(400);
    expect(w.scrollY).toBe(400);
    const plain = fakeWindow();
    holdTop('/r/x/comments/abc/title/', plain as unknown as Window);
    plain.reddit(400);
    expect(plain.scrollY).toBe(400);
  });
});
