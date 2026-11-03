/**
 * The cloud sync engine with a fake provider, an in-memory storage.local and a controlled clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_DEBOUNCE_MS, CLOUD_MAX_BYTES } from '../../src/core/cloudSync/config';
import { createCloudSync, STATE_KEY, type EngineDeps } from '../../src/core/cloudSync/engine';
import { buildCloudFile, parseCloudFile } from '../../src/core/cloudSync/file';
import { TOKENS_KEY } from '../../src/core/cloudSync/tokens';
import {
  AuthNeededError,
  CloudHttpError,
  type CloudProvider,
  type CloudTokens,
} from '../../src/core/cloudSync/types';
import { defaultProfile, type SettingsProfile } from '../../src/core/settings';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/storage/migrations';

const ME = 'device-me';
const OTHER = 'device-other';
const SECRET = 'ACCESS-SECRET-xyz';

const profile = (opt: string, syncEnabled = false): SettingsProfile => ({
  ...defaultProfile(),
  modules: { m: { options: { o: opt } } },
  syncEnabled,
});

function memory(seed: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = structuredClone(seed);
  return {
    data,
    get: async (k: string) => (k in data ? { [k]: structuredClone(data[k]) } : {}),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    }),
    remove: async (k: string | string[]) => {
      for (const key of [k].flat()) delete data[key];
    },
  };
}

function fakeProvider() {
  const p = {
    file: null as string | null,
    readErrors: [] as unknown[],
    id: 'dropbox' as const,
    label: 'Dropbox',
    origins: [],
    configured: () => true,
    silentReauth: false,
    authorizeUrl: () => '',
    finishAuthorize: vi.fn(),
    refresh: vi.fn(async (t: CloudTokens): Promise<CloudTokens> => ({
      ...t,
      accessToken: 'REFRESHED',
    })),
    read: vi.fn(async (_token: string) => {
      const e = p.readErrors.shift();
      if (e) throw e;
      return p.file;
    }),
    write: vi.fn(async (_token: string, text: string) => {
      p.file = text;
    }),
  };
  return p;
}

let now = 1_000_000;
let provider: ReturnType<typeof fakeProvider>;
let local: ReturnType<typeof memory>;
let applied: ReturnType<typeof vi.fn<() => Promise<void>>>;
let log: ReturnType<typeof vi.fn<(m: string) => void>>;

function setup(extraState: Record<string, unknown> = {}, settings = profile('local')) {
  provider = fakeProvider();
  local = memory({
    settings,
    userTags: { alice: { text: 'mine' } },
    [TOKENS_KEY]: { provider: 'dropbox', accessToken: SECRET, refreshToken: 'R', expiresAt: 0 },
    [STATE_KEY]: {
      provider: 'dropbox',
      device: ME,
      status: 'ok',
      includeTags: true,
      lastAppliedAt: 0,
      localChangedAt: 0,
      failures: 0,
      ...extraState,
    },
  });
  applied = vi.fn(async () => {});
  log = vi.fn((_m: string) => {});
  const deps: EngineDeps = {
    now: () => now,
    http: vi.fn(),
    local,
    providers: { dropbox: provider as unknown as CloudProvider },
    onApplied: applied,
    log,
  };
  return createCloudSync(deps);
}

const remoteFile = (opt: string, updatedAt: number, device = OTHER, tags?: object) =>
  buildCloudFile(
    {
      settings: profile(opt),
      ...(tags ? { tags: tags as Record<string, unknown> } : {}),
      updatedAt,
      device,
    },
    true,
  );

const state = () => local.data[STATE_KEY] as Record<string, unknown>;
const settingsNow = () => local.data.settings as SettingsProfile;

beforeEach(() => {
  now = 1_000_000;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pull', () => {
  it('applies a newer copy from another device, keeps the old one as previous, tells tabs', async () => {
    const sync = setup({}, profile('local', true));
    provider.file = remoteFile('remote', 500, OTHER, { bob: { text: 'theirs' } });
    expect(await sync.syncNow()).toBe('pulled');
    expect(settingsNow().modules.m!.options!.o).toBe('remote');
    // This browser's own storage.sync switch is not taken from the cloud.
    expect(settingsNow().syncEnabled).toBe(true);
    expect(local.data.userTags).toEqual({ bob: { text: 'theirs' } });
    expect(applied).toHaveBeenCalledOnce();
    const prev = state().previous as { settings: SettingsProfile; tags: object };
    expect(prev.settings.modules.m!.options!.o).toBe('local');
    expect(prev.tags).toEqual({ alice: { text: 'mine' } });
    expect(provider.write).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ lastAppliedAt: 500, status: 'ok', lastSyncedAt: now });
  });

  it('ignores an older copy than the one last applied, and pushes local changes over it', async () => {
    const sync = setup({ lastAppliedAt: 900, lastHash: 'stale', localChangedAt: 950 });
    provider.file = remoteFile('remote', 800);
    expect(await sync.syncNow()).toBe('pushed');
    expect(settingsNow().modules.m!.options!.o).toBe('local');
    const written = parseCloudFile(provider.file!);
    expect(written.ok && written.file.device).toBe(ME);
    expect(written.ok && written.file.updatedAt).toBe(now);
  });

  it('does nothing when the cloud copy equals this device (no write, no apply)', async () => {
    const sync = setup();
    provider.file = remoteFile('local', 500, OTHER, { alice: { text: 'mine' } });
    expect(await sync.syncNow()).toBe('none');
    expect(provider.write).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    // A second run: still nothing written.
    expect(await sync.syncNow()).toBe('none');
    expect(provider.write).not.toHaveBeenCalled();
  });

  it('never applies its own device’s copy', async () => {
    const sync = setup({ lastHash: undefined });
    provider.file = remoteFile('remote', 5_000, ME);
    await sync.syncNow();
    expect(settingsNow().modules.m!.options!.o).toBe('local');
    expect(applied).not.toHaveBeenCalled();
  });

  it('last writer wins: a local change made after the cloud copy is pushed instead', async () => {
    const sync = setup({ lastAppliedAt: 100, lastHash: 'old', localChangedAt: 700 });
    provider.file = remoteFile('remote', 600);
    expect(await sync.syncNow()).toBe('pushed');
    expect(settingsNow().modules.m!.options!.o).toBe('local');
    const w = parseCloudFile(provider.file!);
    expect(w.ok && w.file.updatedAt).toBeGreaterThan(600);
  });

  it('a newer cloud copy beats an older local change', async () => {
    const sync = setup({ lastAppliedAt: 100, lastHash: 'old', localChangedAt: 300 });
    provider.file = remoteFile('remote', 600);
    expect(await sync.syncNow()).toBe('pulled');
  });

  it('rejects a damaged or hostile cloud file through the backup normalizers', async () => {
    const bad = [
      'not json',
      JSON.stringify({ format: 'other' }),
      JSON.stringify({ format: 'rescue-sync', formatVersion: 1, updatedAt: 5, device: OTHER }),
      JSON.stringify({
        format: 'rescue-sync',
        formatVersion: 1,
        updatedAt: 5,
        device: OTHER,
        settings: { modules: {} },
        tags: ['not', 'a', 'record'],
      }),
      JSON.stringify({
        format: 'rescue-sync',
        formatVersion: 1,
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        updatedAt: 5,
        device: OTHER,
        settings: {},
      }),
    ];
    for (const text of bad) {
      const sync = setup();
      provider.file = text;
      expect(await sync.syncNow()).toBe('failed');
      expect(settingsNow().modules.m!.options!.o).toBe('local');
      expect(provider.write).not.toHaveBeenCalled();
      expect(state().status).toBe('error');
    }
  });

  it('normalizes what it applies (unknown fields dropped, gaps filled)', () => {
    const parsed = parseCloudFile(
      JSON.stringify({
        format: 'rescue-sync',
        formatVersion: 1,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        updatedAt: 5,
        device: OTHER,
        settings: { modules: { a: { enabled: true } }, evil: '<script>' },
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.file.settings).toEqual({
        ...defaultProfile(),
        modules: { a: { enabled: true } },
      });
      expect(parsed.file.settings).not.toHaveProperty('evil');
    }
  });
});

describe('push', () => {
  it('writes the first copy when the cloud has none', async () => {
    const sync = setup();
    expect(await sync.syncNow()).toBe('pushed');
    const f = JSON.parse(provider.file!);
    expect(f).toMatchObject({
      format: 'rescue-sync',
      formatVersion: 1,
      updatedAt: now,
      device: ME,
      tags: { alice: { text: 'mine' } },
    });
    expect(f.settings.modules.m.options.o).toBe('local');
  });

  it('leaves tags out when "also sync user tags" is off', async () => {
    const sync = setup({ includeTags: false });
    await sync.syncNow();
    expect(JSON.parse(provider.file!)).not.toHaveProperty('tags');
  });

  it('refuses a file over the size cap with a clear error', async () => {
    const sync = setup();
    local.data.userTags = { big: { text: 'x'.repeat(CLOUD_MAX_BYTES) } };
    expect(await sync.syncNow()).toBe('failed');
    expect(provider.write).not.toHaveBeenCalled();
    expect(state().error).toMatch(/KB limit/);
  });
});

describe('errors', () => {
  it('backs off on 429 for Retry-After, then runs again', async () => {
    const sync = setup();
    provider.readErrors.push(new CloudHttpError(429, 120_000, 'Dropbox download'));
    expect(await sync.syncNow()).toBe('failed');
    expect(state()).toMatchObject({ status: 'error', backoffUntil: now + 120_000 });
    now += 60_000;
    expect(await sync.syncNow()).toBe('skipped');
    expect(provider.read).toHaveBeenCalledTimes(1);
    now += 61_000;
    expect(await sync.syncNow()).toBe('pushed');
    expect(state()).toMatchObject({ status: 'ok', failures: 0 });
    expect(state()).not.toHaveProperty('backoffUntil');
  });

  it('backs off exponentially on 5xx without Retry-After', async () => {
    const sync = setup();
    provider.readErrors.push(new CloudHttpError(503, undefined, 'x'));
    await sync.syncNow();
    expect(state().backoffUntil).toBe(now + 30_000);
  });

  it('401: refreshes once and retries with the new token', async () => {
    const sync = setup();
    provider.readErrors.push(new CloudHttpError(401, undefined, 'Dropbox download'));
    expect(await sync.syncNow()).toBe('pushed');
    expect(provider.refresh).toHaveBeenCalledOnce();
    expect(provider.read.mock.calls[1]![0]).toBe('REFRESHED');
    expect((local.data[TOKENS_KEY] as CloudTokens).accessToken).toBe('REFRESHED');
  });

  it('401 again after the refresh: stop and ask to reconnect', async () => {
    const sync = setup();
    provider.readErrors.push(
      new CloudHttpError(401, undefined, 'x'),
      new CloudHttpError(401, undefined, 'x'),
    );
    expect(await sync.syncNow()).toBe('failed');
    expect(state().status).toBe('reconnect');
    expect(provider.refresh).toHaveBeenCalledOnce();
    // Further scheduled runs do nothing until the user reconnects.
    expect(await sync.syncNow()).toBe('skipped');
  });

  it('a refused refresh means reconnect', async () => {
    const sync = setup();
    provider.refresh.mockRejectedValueOnce(new AuthNeededError());
    provider.readErrors.push(new CloudHttpError(401, undefined, 'x'));
    await sync.syncNow();
    expect(state().status).toBe('reconnect');
  });

  it('refreshes an expiring token before the request', async () => {
    const sync = setup();
    (local.data[TOKENS_KEY] as CloudTokens).expiresAt = now + 1000;
    await sync.syncNow();
    expect(provider.refresh).toHaveBeenCalledOnce();
    expect(provider.read.mock.calls[0]![0]).toBe('REFRESHED');
  });

  it('never logs or stores a token in an error', async () => {
    const sync = setup();
    provider.readErrors.push(new Error(`boom with ${SECRET} and Bearer ${SECRET}`));
    await sync.syncNow();
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(state())).not.toContain(SECRET);
  });
});

describe('debounce, previous, connect, disconnect', () => {
  it('waits 10 s after the last local change before syncing', async () => {
    vi.useFakeTimers();
    const sync = setup({ lastHash: 'x' });
    await sync.localChanged();
    await vi.advanceTimersByTimeAsync(CLOUD_DEBOUNCE_MS - 1000);
    await sync.localChanged();
    await vi.advanceTimersByTimeAsync(CLOUD_DEBOUNCE_MS - 1000);
    expect(provider.read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.read).toHaveBeenCalledOnce();
    expect(state().localChangedAt).toBe(now);
  });

  it('restores the previous profile and pushes it', async () => {
    const sync = setup();
    provider.file = remoteFile('remote', 500);
    await sync.syncNow();
    now += 10_000;
    expect(await sync.restorePrevious()).toBe(true);
    expect(settingsNow().modules.m!.options!.o).toBe('local');
    expect(local.data.userTags).toEqual({ alice: { text: 'mine' } });
    expect(state()).not.toHaveProperty('previous');
    const w = parseCloudFile(provider.file!);
    expect(w.ok && w.file.settings.modules.m!.options!.o).toBe('local');
    expect(await sync.restorePrevious()).toBe(false);
  });

  it('connect stores the tokens and a joining device adopts the cloud copy', async () => {
    const sync = setup({ provider: undefined, status: 'off' });
    delete local.data[TOKENS_KEY];
    provider.file = remoteFile('remote', 10);
    await sync.connect({ provider: 'dropbox', accessToken: 'NEW', expiresAt: 0 });
    expect(settingsNow().modules.m!.options!.o).toBe('remote');
    expect((local.data[TOKENS_KEY] as CloudTokens).accessToken).toBe('NEW');
  });

  it('disconnect forgets the tokens but leaves the cloud file', async () => {
    const sync = setup();
    provider.file = remoteFile('remote', 10);
    const revoke = vi.fn(async () => {});
    (provider as unknown as { revoke: typeof revoke }).revoke = revoke;
    await sync.disconnect();
    expect(local.data).not.toHaveProperty(TOKENS_KEY);
    expect(revoke).toHaveBeenCalledOnce();
    expect(provider.file).not.toBeNull();
    expect(state()).toMatchObject({ status: 'off', device: ME });
    expect(state()).not.toHaveProperty('provider');
    expect(await sync.syncNow()).toBe('skipped');
  });
});
