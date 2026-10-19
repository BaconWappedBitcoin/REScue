import { afterEach, describe, expect, it } from 'vitest';
import { READ_MAX_AGE_MS, READ_MAX_THREADS } from '../../src/core/storage/prune';
import { newCommentCount } from '../../src/modules/comments/newCommentCount';
import { readComments } from '../../src/modules/comments/readComments';
import {
  ReadStore,
  closeReadStore,
  isNewComment,
  newCommentCount as countNew,
  recordVisit,
  sanitizeRead,
} from '../../src/modules/comments/readTracking';
import {
  listingHtml,
  mount,
  nestedThreadHtml,
  threadComments,
  type FixtureComment,
} from '../fixtures/pages';
import { bootModules, own, tick } from './module-harness';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

describe('read records', () => {
  it('keeps only well-formed records', () => {
    const r = sanitizeRead({
      t3_a: { lastVisit: 5, commentCountAtVisit: 7.9 },
      t3_b: { lastVisit: 'x', commentCountAtVisit: 1 },
      t3_c: { lastVisit: 9 },
      t3_d: 'junk',
    });
    expect(r).toEqual({
      t3_a: { lastVisit: 5, commentCountAtVisit: 7 },
      t3_c: { lastVisit: 9, commentCountAtVisit: 0 },
    });
    expect(sanitizeRead(null)).toEqual({});
  });

  it('records a visit and drops records older than 90 days', () => {
    const old = { lastVisit: NOW - READ_MAX_AGE_MS - 1, commentCountAtVisit: 3 };
    const fresh = { lastVisit: NOW - HOUR, commentCountAtVisit: 4 };
    const next = recordVisit({ t3_old: old, t3_fresh: fresh }, 't3_new', 12, NOW);
    expect(next).toEqual({
      t3_fresh: fresh,
      t3_new: { lastVisit: NOW, commentCountAtVisit: 12 },
    });
  });

  it('keeps the newest 50,000 threads when there are more', () => {
    const many: Record<string, { lastVisit: number; commentCountAtVisit: number }> = {};
    for (let i = 0; i < READ_MAX_THREADS; i++)
      many[`t3_${i}`] = { lastVisit: NOW - 1000 - i, commentCountAtVisit: 1 };
    const next = recordVisit(many, 't3_latest', 1, NOW);
    expect(Object.keys(next)).toHaveLength(READ_MAX_THREADS);
    expect(next.t3_latest).toBeDefined();
    expect(next[`t3_${READ_MAX_THREADS - 1}`]).toBeUndefined(); // the oldest went
    expect(next.t3_0).toBeDefined();
  });
});

describe('new-comment computation', () => {
  const rec = { lastVisit: NOW, commentCountAtVisit: 10 };

  it('counts comments gained since the visit, never negative', () => {
    expect(countNew(rec, 25)).toBe(15);
    expect(countNew(rec, 10)).toBe(0);
    expect(countNew(rec, 4)).toBe(0); // comments were deleted
    expect(countNew(undefined, 25)).toBe(0); // never visited: nothing is "new"
  });

  it('treats a comment as new only if created after the visit', () => {
    expect(isNewComment(rec, new Date(NOW + 1))).toBe(true);
    expect(isNewComment(rec, new Date(NOW))).toBe(false);
    expect(isNewComment(rec, new Date(NOW - 1))).toBe(false);
    expect(isNewComment(rec, null)).toBe(false);
    expect(isNewComment(undefined, new Date(NOW + 1))).toBe(false);
  });
});

describe('ReadStore', () => {
  const mk = (initial: unknown, now = NOW) => {
    const mem: Record<string, unknown> = { read: initial };
    const data = {
      get: async (k: string) => mem[k],
      set: (k: string, v: unknown) => void (mem[k] = v),
    };
    return { mem, store: new ReadStore(data as never, () => now) };
  };

  it('keeps the previous record visible while this visit is recorded', async () => {
    const { mem, store } = mk({ t3_a: { lastVisit: NOW - HOUR, commentCountAtVisit: 5 } });
    await store.load();
    await store.visit('t3_a', 9);
    expect(store.prior('t3_a')).toEqual({ lastVisit: NOW - HOUR, commentCountAtVisit: 5 });
    expect((mem.read as Record<string, unknown>).t3_a).toEqual({
      lastVisit: NOW,
      commentCountAtVisit: 9,
    });
    store.newView();
    expect(store.prior('t3_a')).toEqual({ lastVisit: NOW, commentCountAtVisit: 9 });
  });

  it('records a thread once per view and merges with what storage holds', async () => {
    const { mem, store } = mk({});
    await store.load();
    mem.read = { t3_other: { lastVisit: NOW - 5, commentCountAtVisit: 1 } }; // another tab wrote
    await store.visit('t3_a', 3);
    await store.visit('t3_a', 99);
    const read = mem.read as Record<string, { commentCountAtVisit: number }>;
    expect(Object.keys(read).sort()).toEqual(['t3_a', 't3_other']);
    expect(read.t3_a!.commentCountAtVisit).toBe(3);
    expect(store.hasRead('t3_a')).toBe(false); // the "before" does not include this visit
  });
});

const T = Date.now();
const iso = (msAgo: number) => new Date(T - msAgo).toISOString();
/** Visited 1 h ago; comments 0 and 2 were written since, the rest earlier. */
const comments = (): FixtureComment[] =>
  threadComments().map((c, i) => ({
    ...c,
    created: i === 0 || i === 2 ? iso(HOUR / 2) : iso(3 * HOUR),
    author: i === 2 ? 'me_the_reader' : c.author,
  }));

afterEach(() => {
  closeReadStore();
  document.body.innerHTML = '';
});

describe('readComments + newCommentCount in a thread', () => {
  const stored = { read: { t3_text1: { lastVisit: T - HOUR, commentCountAtVisit: 1100 } } };
  const route = {
    kind: 'thread',
    path: '/r/Layoffs/comments/text1/got_laid_off',
    postId: 't3_text1',
  };

  it('marks comments created since the last visit beside their author, then records the visit', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments, newCommentCount], {
      route,
      stored,
      username: 'me_the_reader',
    });
    m.flush();
    await tick();
    await tick();

    const marked = [...document.querySelectorAll('shreddit-comment')]
      .filter((c) => own(c, '.rescue-new-comment'))
      .map((c) => c.getAttribute('thingid'));
    // c2 is the reader's own comment: never marked.
    expect(marked).toEqual(['t1_c0']);
    const badge = document.querySelector('shreddit-comment[thingid="t1_c0"] .rescue-new-comment')!;
    expect(badge.previousElementSibling?.matches('a[href*="/user/"]')).toBe(true);
    expect(document.querySelector('.rescue-new-banner')?.textContent).toBe(
      '1 new comment since your last visit',
    );

    const read = m.store.read as Record<string, { lastVisit: number; commentCountAtVisit: number }>;
    expect(read.t3_text1!.commentCountAtVisit).toBe(1115);
    expect(read.t3_text1!.lastVisit).toBeGreaterThanOrEqual(T);
    m.dispose();
  });

  it('marks nothing on a first visit', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments, newCommentCount], { route });
    m.flush();
    await tick();
    expect(document.querySelectorAll('.rescue-new-comment')).toHaveLength(0);
    expect((m.store.read as Record<string, unknown>).t3_text1).toBeDefined();
    m.dispose();
  });

  it('shows no markers when markComments is off', async () => {
    mount(nestedThreadHtml(comments()));
    const m = await bootModules([readComments, newCommentCount], {
      route,
      stored,
      options: { newCommentCount: { markComments: false } },
    });
    m.flush();
    expect(document.querySelectorAll('.rescue-new-comment')).toHaveLength(0);
    m.dispose();
  });
});

describe('newCommentCount on a listing', () => {
  it('adds "(N new)" after the time only for posts that gained comments', async () => {
    mount(listingHtml());
    const stored = {
      read: {
        t3_text1: { lastVisit: T - HOUR, commentCountAtVisit: 1100 }, // 1115 now: 15 new
        t3_link1: { lastVisit: T - HOUR, commentCountAtVisit: 182 }, // unchanged
      },
    };
    const m = await bootModules([readComments, newCommentCount], {
      route: { kind: 'all', path: '/r/all' },
      stored,
    });
    m.flush();
    const tags = [...document.querySelectorAll('.rescue-new-count')];
    expect(tags.map((t) => t.textContent)).toEqual(['(15 new)']);
    const time = document.querySelector('shreddit-post#t3_text1 faceplate-timeago')!;
    expect(time.nextElementSibling).toBe(tags[0]);
    m.dispose();
  });

  it('does not record visits from a listing', async () => {
    mount(listingHtml());
    const m = await bootModules([readComments, newCommentCount], {
      route: { kind: 'all', path: '/r/all' },
    });
    m.flush();
    await tick();
    expect(m.store.read).toBeUndefined();
    m.dispose();
  });
});

describe('newCommentCount without readComments', () => {
  it('is switched off by the registry through dependsOn', () => {
    expect(newCommentCount.dependsOn).toEqual(['readComments']);
  });
});
