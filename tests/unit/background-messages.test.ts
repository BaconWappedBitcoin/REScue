import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { BACKUP_KEYS, buildBackup } from '../../src/core/backup';
import { chunkForSync, fnv1a } from '../../src/core/storage/sync';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/storage/migrations';
import background from '../../src/entrypoints/background';

/** Keys the backup format never holds: an import must leave them alone. */
const PRIVATE = {
  collapsed: { t1_a: true },
  hiddenPosts: { t3_h: 1 },
  'mod:subredditManager': { visits: { pics: 3 } },
  syncState: { knownHash: 'abc' },
};

const sendMessage = vi.fn(async () => undefined);
const created: Array<{ url?: string; active?: boolean; index?: number }> = [];

/** Start the background against the fake browser; returns the onMessage reply for a message. */
function boot(): (msg: unknown, sender?: object) => Promise<unknown> {
  fakeBrowser.reset();
  sendMessage.mockClear();
  created.length = 0;
  const b = fakeBrowser as unknown as Record<string, Record<string, unknown>>;
  // APIs the fake leaves unimplemented: listeners only, nothing in these tests fires them.
  const event = { addListener: () => undefined };
  b.permissions = { onAdded: event, onRemoved: event, contains: async () => false };
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 7 }] as never);
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(sendMessage as never);
  vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async (p: (typeof created)[0]) => {
    created.push(p);
    return {};
  }) as never);
  background.main();
  return async (msg, sender = {}) =>
    (await fakeBrowser.runtime.onMessage.trigger(msg, sender as never, () => undefined))[0];
}

const local = () => fakeBrowser.storage.local.get(null);
const backupJson = (data: Record<string, unknown>, extra: object = {}) =>
  JSON.stringify({ ...buildBackup(data, '1', true), ...extra });

let send: ReturnType<typeof boot>;
beforeEach(() => {
  send = boot();
});

describe('background backup.import', () => {
  const stored = {
    schema: { version: CURRENT_SCHEMA_VERSION },
    settings: { syncEnabled: false, modules: { a: { enabled: true } } },
    userTags: { alice: { text: 'old' } },
    read: { t3_r: { lastVisit: 1, commentCountAtVisit: 0 } },
    ...PRIVATE,
  };

  it('merge adds the backup to what is there and keeps everything else', async () => {
    await fakeBrowser.storage.local.set(stored);
    const json = backupJson({ userTags: { bob: { text: 'new' } } });
    expect(await send({ type: 'backup.import', json, mode: 'merge' })).toEqual({ ok: true });
    const all = await local();
    expect(all.userTags).toEqual({ alice: { text: 'old' }, bob: { text: 'new' } });
    expect(all.settings).toEqual(stored.settings);
    expect(all.read).toEqual(stored.read);
    for (const [k, v] of Object.entries(PRIVATE)) expect(all[k]).toEqual(v);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'settings.changed' });
  });

  it('replace swaps the backup keys and keeps keys a backup never holds', async () => {
    await fakeBrowser.storage.local.set(stored);
    const json = backupJson({ settings: { syncEnabled: true }, userTags: { bob: {} } });
    expect(await send({ type: 'backup.import', json, mode: 'replace' })).toEqual({ ok: true });
    const all = await local();
    expect(all.settings).toEqual({ syncEnabled: true });
    expect(all.userTags).toEqual({ bob: {} });
    // A backup key this file does not carry is the backup's to replace: it goes.
    expect(all).not.toHaveProperty('read');
    for (const [k, v] of Object.entries(PRIVATE)) expect(all[k]).toEqual(v);
    expect(all.schema).toEqual({ version: CURRENT_SCHEMA_VERSION });
  });

  it('replace loses nothing when the write fails', async () => {
    await fakeBrowser.storage.local.set(stored);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));
    const json = backupJson({ userTags: { bob: {} } });
    const res = (await send({ type: 'backup.import', json, mode: 'replace' })) as {
      ok: boolean;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/quota/);
    expect(await local()).toEqual(stored);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('only ever removes backup keys', async () => {
    await fakeBrowser.storage.local.set(stored);
    const remove = vi.spyOn(fakeBrowser.storage.local, 'remove');
    const clear = vi.spyOn(fakeBrowser.storage.local, 'clear');
    await send({ type: 'backup.import', json: backupJson({}), mode: 'replace' });
    expect(clear).not.toHaveBeenCalled();
    const removed = remove.mock.calls.flatMap((c) => [c[0]].flat());
    expect(removed.length).toBeGreaterThan(0);
    for (const k of removed) expect(BACKUP_KEYS).toContain(k);
  });

  it('answers a bad file with the parser’s error and writes nothing', async () => {
    await fakeBrowser.storage.local.set(stored);
    const res = await send({ type: 'backup.import', json: '{nope', mode: 'replace' });
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/invalid JSON/) });
    expect(await local()).toEqual(stored);
  });
});

describe('background tabs.open', () => {
  it('opens at most two http(s) addresses next to the sender, the first one active', async () => {
    const urls = [
      'javascript:alert(1)',
      'https://www.reddit.com/r/a/comments/1/x/',
      42,
      'data:text/html,hi',
      'HTTP://example.com/link',
      'https://third.example/',
    ];
    expect(await send({ type: 'tabs.open', urls, active: true }, { tab: { index: 4 } })).toEqual({
      ok: true,
    });
    expect(created).toEqual([
      { url: 'https://www.reddit.com/r/a/comments/1/x/', active: true, index: 5 },
      { url: 'HTTP://example.com/link', active: false, index: 6 },
    ]);
  });

  it('opens nothing for a request that is not a list, and no index without a sender tab', async () => {
    await send({ type: 'tabs.open', urls: 'https://x.example/', active: false });
    expect(created).toEqual([]);
    await send({ type: 'tabs.open', urls: ['https://x.example/'], active: false });
    expect(created).toEqual([{ url: 'https://x.example/', active: false }]);
  });
});

describe('background sync apply / keep', () => {
  const remote = { syncEnabled: true, modules: { b: { enabled: false } } };

  it('sync.apply writes the synced profile, keeps the old one, and broadcasts', async () => {
    const previous = { syncEnabled: true, modules: {} };
    await fakeBrowser.storage.local.set({ settings: previous, syncState: { pendingHash: 'p' } });
    await fakeBrowser.storage.sync.set(chunkForSync(remote));
    expect(await send({ type: 'sync.apply' })).toEqual({ ok: true });
    const all = await local();
    expect((all.settings as { modules: object }).modules).toMatchObject(remote.modules);
    expect((all.settings as { syncEnabled: boolean }).syncEnabled).toBe(true);
    expect((all.settingsBeforeSync as { previous: unknown }).previous).toEqual(previous);
    expect(all.syncState).toEqual({ knownHash: fnv1a(JSON.stringify(remote)) });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'settings.changed' });
  });

  it('sync.apply with no complete synced copy changes nothing', async () => {
    await fakeBrowser.storage.local.set({ settings: { syncEnabled: true } });
    expect(await send({ type: 'sync.apply' })).toEqual({ ok: false });
    expect((await local()).settings).toEqual({ syncEnabled: true });
  });

  it('sync.keep marks the waiting copy as known and clears it', async () => {
    await fakeBrowser.storage.local.set({ syncState: { knownHash: 'old', pendingHash: 'new' } });
    expect(await send({ type: 'sync.status' })).toEqual({ ok: true, pending: true });
    expect(await send({ type: 'sync.keep' })).toEqual({ ok: true });
    expect((await local()).syncState).toEqual({ knownHash: 'new' });
    expect(await send({ type: 'sync.status' })).toEqual({ ok: true, pending: false });
  });

  it('sync.keep with nothing waiting keeps the known copy', async () => {
    await fakeBrowser.storage.local.set({ syncState: { knownHash: 'old' } });
    await send({ type: 'sync.keep' });
    expect((await local()).syncState).toEqual({ knownHash: 'old' });
  });
});
