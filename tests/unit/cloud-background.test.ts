/**
 * Cloud sync wiring in the background (src/core/cloudSync/service.ts through background.ts):
 * the status a console sees, and the auth steps refused to anything but an extension page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { STATE_KEY } from '../../src/core/cloudSync/engine';
import { TOKENS_KEY } from '../../src/core/cloudSync/tokens';
import background from '../../src/entrypoints/background';

function boot(): (msg: unknown, sender?: object) => Promise<unknown> {
  fakeBrowser.reset();
  const b = fakeBrowser as unknown as Record<string, Record<string, unknown>>;
  const event = { addListener: () => undefined };
  b.permissions = { onAdded: event, onRemoved: event, contains: async () => false };
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([] as never);
  background.main();
  return async (msg, sender = {}) =>
    (await fakeBrowser.runtime.onMessage.trigger(msg, sender as never, () => undefined))[0];
}

let send: ReturnType<typeof boot>;
beforeEach(() => {
  send = boot();
});

describe('background cloudSync messages', () => {
  it('reports "off" with no provider offered while the client ids are empty', async () => {
    expect(await send({ type: 'cloudSync.status' })).toEqual({
      ok: true,
      available: [],
      status: 'off',
      includeTags: true,
    });
  });

  it('never puts a token in a status answer', async () => {
    await fakeBrowser.storage.local.set({
      [TOKENS_KEY]: { provider: 'dropbox', accessToken: 'SECRET-T', expiresAt: 0 },
      [STATE_KEY]: { provider: 'dropbox', device: 'd', status: 'ok', lastSyncedAt: 5 },
    });
    const st = await send({ type: 'cloudSync.status' });
    expect(JSON.stringify(st)).not.toContain('SECRET-T');
    expect(st).toMatchObject({ provider: 'dropbox', label: 'Dropbox', lastSyncedAt: 5 });
  });

  it('refuses the auth steps from a content script on Reddit', async () => {
    const reddit = { url: 'https://www.reddit.com/r/aww/', tab: { id: 3 } };
    expect(await send({ type: 'cloudSync.beginAuth', provider: 'google' }, reddit)).toEqual({
      ok: false,
      error: 'refused',
    });
    expect(
      await send(
        { type: 'cloudSync.finishAuth', responseUrl: 'https://x.chromiumapp.org/' },
        reddit,
      ),
    ).toEqual({ ok: false, error: 'refused' });
  });

  it('will not open the connect window for a provider that is not offered', async () => {
    const res = (await send({ type: 'cloudSync.openConnect', provider: 'google' })) as {
      ok: boolean;
    };
    expect(res.ok).toBe(false);
  });

  it('schedules the 15-minute check', async () => {
    const alarm = await fakeBrowser.alarms.get('rescue-cloud-sync');
    expect(alarm?.periodInMinutes).toBe(15);
  });

  it('disconnect forgets the tokens', async () => {
    await fakeBrowser.storage.local.set({
      [TOKENS_KEY]: { provider: 'onedrive', accessToken: 'T', expiresAt: 0 },
      [STATE_KEY]: { provider: 'onedrive', device: 'd', status: 'ok' },
    });
    const st = await send({ type: 'cloudSync.disconnect' });
    expect(st).toMatchObject({ ok: true, status: 'off' });
    expect(await fakeBrowser.storage.local.get(TOKENS_KEY)).toEqual({});
  });
});
