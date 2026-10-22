import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { BACKUP_KEYS, buildBackup } from '../../src/core/backup';
import {
  DebouncedWriter,
  LocalStore,
  STORAGE_KEYS,
  removeStored,
} from '../../src/core/storage/store';
import {
  LEGACY_SUBS_KEY,
  SUBS_KEY,
  migrateLegacySubs,
} from '../../src/modules/comments/subscriptionPoller';

beforeEach(() => fakeBrowser.reset());
afterEach(() => vi.useRealTimers());

describe('debounced writer after a failed write', () => {
  it('keeps writing after one set rejects, retrying the failed batch (newest value wins)', async () => {
    const calls: Array<Record<string, unknown>> = [];
    let fail = true;
    const set = vi.fn(async (items: Record<string, unknown>) => {
      calls.push(items);
      if (fail) throw new Error('quota');
    });
    const onError = vi.fn();
    const w = new DebouncedWriter(set, 250, onError);
    w.write('a', 1);
    w.write('b', 1);
    await expect(w.flush()).rejects.toThrow('quota');
    fail = false;
    w.write('b', 2);
    await w.flush();
    expect(calls.at(-1)).toEqual({ a: 1, b: 2 });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('reports a failure streak once, and again after a success', async () => {
    let fail = true;
    const onError = vi.fn();
    const w = new DebouncedWriter(
      async () => {
        if (fail) throw new Error('nope');
      },
      250,
      onError,
    );
    w.write('a', 1);
    await w.flush().catch(() => {});
    w.write('a', 2);
    await w.flush().catch(() => {});
    expect(onError).toHaveBeenCalledOnce();
    fail = false;
    await w.flush();
    fail = true;
    w.write('a', 3);
    await w.flush().catch(() => {});
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('a timer flush that fails does not leave an unhandled rejection and is retried later', async () => {
    vi.useFakeTimers();
    let fail = true;
    const seen: Array<Record<string, unknown>> = [];
    const w = new DebouncedWriter(async (items) => {
      seen.push(items);
      if (fail) throw new Error('x');
    }, 250);
    w.write('k', 1);
    await vi.advanceTimersByTimeAsync(300);
    fail = false;
    w.write('j', 2);
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.at(-1)).toEqual({ k: 1, j: 2 });
  });

  it('a value written while a batch is in flight is still read back', async () => {
    let release!: () => void;
    const w = new DebouncedWriter(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
      250,
    );
    w.write('a', 1);
    const done = w.flush();
    await Promise.resolve();
    expect(w.peek('a')).toEqual({ has: true, value: 1 });
    release();
    await done;
  });
});

describe('LocalStore scoped writes', () => {
  it('two keys set back to back on one namespace both survive', async () => {
    const store = new LocalStore();
    const s = store.scoped('subredditManager');
    s.set('visits', { a: 1 });
    s.set('accounts', { b: 2 });
    expect(await s.get('visits')).toEqual({ a: 1 });
    await store.flush();
    const got = await fakeBrowser.storage.local.get('mod:subredditManager');
    expect(got['mod:subredditManager']).toEqual({ visits: { a: 1 }, accounts: { b: 2 } });
  });

  it('reports a failed write through the owner callback', async () => {
    const onError = vi.fn();
    const store = new LocalStore(onError);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('full'));
    store.set('userTags', { x: 1 });
    await store.flush().catch(() => {});
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'full' }));
    await store.flush();
    expect((await fakeBrowser.storage.local.get('userTags')).userTags).toEqual({ x: 1 });
  });
});

describe('removeStored', () => {
  it('drops pending writes to the removed keys so they are not recreated', async () => {
    const store = new LocalStore();
    await fakeBrowser.storage.local.set({ read: { t1: 1 }, userTags: { u: 1 } });
    store.set('read', { t2: 2 });
    store.set('userTags', { u: 2 });
    await removeStored([STORAGE_KEYS.read]);
    await store.flush();
    const all = await fakeBrowser.storage.local.get(null);
    expect(all.read).toBeUndefined();
    expect(all.userTags).toEqual({ u: 2 });
  });
});

describe('thread subscriptions key', () => {
  it('is a shared storage key and part of the backup', () => {
    expect(STORAGE_KEYS.threadSubscriptions).toBe(SUBS_KEY);
    expect(BACKUP_KEYS).toContain('threadSubscriptions');
    const b = buildBackup({ threadSubscriptions: { t3_a: { id: 't3_a' } } }, '1.0.0', false);
    expect(b.data.threadSubscriptions).toEqual({ t3_a: { id: 't3_a' } });
  });

  it('moves the old raw key to the new one once and deletes the old one', async () => {
    const subs = { t3_a: { id: 't3_a' } };
    await fakeBrowser.storage.local.set({ [LEGACY_SUBS_KEY]: subs });
    await migrateLegacySubs();
    let all = await fakeBrowser.storage.local.get(null);
    expect(all[SUBS_KEY]).toEqual(subs);
    expect(LEGACY_SUBS_KEY in all).toBe(false);
    // A second run changes nothing (the new key is not overwritten).
    await fakeBrowser.storage.local.set({ [LEGACY_SUBS_KEY]: { t3_b: {} } });
    await fakeBrowser.storage.local.set({ [SUBS_KEY]: { t3_c: {} } });
    await migrateLegacySubs();
    all = await fakeBrowser.storage.local.get(null);
    expect(all[SUBS_KEY]).toEqual({ t3_c: {}, t3_b: {} });
    expect(LEGACY_SUBS_KEY in all).toBe(false);
  });
});
