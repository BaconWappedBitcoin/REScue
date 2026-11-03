/**
 * Background wiring for cloud sync: messages from the settings console and the connect page,
 * the 15-minute alarm, the debounced push after a local change, and the auth window. Kept out of
 * entrypoints/background.ts, which only forwards `cloudSync.*` messages here.
 */
import { browser } from 'wxt/browser';
import { createCloudSync, loadState, type CloudSync } from './engine';
import { CLOUD_PERIOD_MINUTES } from './config';
import { randomId, randomVerifier, s256Challenge } from './pkce';
import { allProviders, cloudHttp, isProviderId } from './providers';
import { redact } from './tokens';
import { redirectParams, type CloudProvider, type CloudProviderId } from './types';

export type CloudSyncMessage =
  | { type: 'cloudSync.status' }
  | { type: 'cloudSync.openConnect'; provider: CloudProviderId }
  | { type: 'cloudSync.beginAuth'; provider: CloudProviderId }
  | { type: 'cloudSync.finishAuth'; responseUrl: string }
  | { type: 'cloudSync.syncNow' }
  | { type: 'cloudSync.disconnect' }
  | { type: 'cloudSync.restorePrevious' }
  | { type: 'cloudSync.setTags'; on: boolean };

/** What the settings console sees. Never holds a token. */
export interface CloudSyncStatus {
  ok: true;
  available: Array<{ id: CloudProviderId; label: string }>;
  provider?: CloudProviderId;
  label?: string;
  status: 'off' | 'ok' | 'error' | 'reconnect';
  error?: string;
  lastSyncedAt?: number;
  includeTags: boolean;
  previousAt?: number;
}

const ALARM = 'rescue-cloud-sync';
const PENDING_KEY = 'cloudSyncPendingAuth';
const PENDING_MAX_AGE_MS = 15 * 60_000;

interface PendingAuth {
  provider: CloudProviderId;
  state: string;
  verifier: string;
  redirectUri: string;
  at: number;
}

interface IdentityLike {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { url: string; interactive?: boolean }): Promise<string | undefined>;
}

const identity = (): IdentityLike | undefined =>
  (browser as unknown as { identity?: IdentityLike }).identity;

/** Short-lived auth values: session storage where the browser has it (they survive a sleeping
 * service worker but not a browser restart), else this context's memory. */
let memoryPending: PendingAuth | undefined;
const sessionArea = () =>
  (browser.storage as unknown as { session?: typeof browser.storage.local }).session;

async function savePending(p: PendingAuth | undefined): Promise<void> {
  const area = sessionArea();
  if (!area) {
    memoryPending = p;
    return;
  }
  if (p) await area.set({ [PENDING_KEY]: p });
  else await area.remove(PENDING_KEY);
}

async function loadPending(): Promise<PendingAuth | undefined> {
  const area = sessionArea();
  if (!area) return memoryPending;
  return (await area.get(PENDING_KEY))[PENDING_KEY] as PendingAuth | undefined;
}

/** Only REScue's own extension pages may run the auth steps (not a content script). */
function fromExtensionPage(sender: { url?: string }): boolean {
  const base = browser.runtime.getURL('/' as never);
  return typeof sender.url === 'string' && sender.url.startsWith(base);
}

export function setupCloudSync(onApplied: () => Promise<void>) {
  const providers = allProviders();
  const sync: CloudSync = createCloudSync({
    now: () => Date.now(),
    http: cloudHttp,
    local: browser.storage.local,
    providers,
    onApplied,
    log: (m) => console.warn(m),
    silentAuth: async (provider) => {
      const id = identity();
      if (!id) throw new Error('no identity API');
      const req = await prepare(provider, true);
      const responseUrl = await id.launchWebAuthFlow({ url: req.url, interactive: false });
      if (!responseUrl) throw new Error('no answer');
      return finish(provider, req.pending, responseUrl);
    },
  });

  async function prepare(provider: CloudProvider, silent: boolean) {
    const id = identity();
    if (!id) throw new Error('This browser did not give REScue the identity permission.');
    const pending: PendingAuth = {
      provider: provider.id,
      state: randomId(),
      verifier: randomVerifier(),
      redirectUri: id.getRedirectURL(),
      at: Date.now(),
    };
    const url = provider.authorizeUrl({
      redirectUri: pending.redirectUri,
      state: pending.state,
      challenge: await s256Challenge(pending.verifier),
      silent,
    });
    return { url, pending };
  }

  function finish(provider: CloudProvider, pending: PendingAuth, responseUrl: string) {
    const answer = new URL(responseUrl);
    const expected = new URL(pending.redirectUri);
    if (answer.origin !== expected.origin) throw new Error('unexpected sign-in answer');
    if (redirectParams(responseUrl).get('state') !== pending.state)
      throw new Error('the sign-in answer did not match this request');
    return provider.finishAuthorize(
      { responseUrl, redirectUri: pending.redirectUri, verifier: pending.verifier },
      cloudHttp,
      Date.now(),
    );
  }

  async function status(): Promise<CloudSyncStatus> {
    const st = await loadState(browser.storage.local);
    const provider = st.provider ? providers[st.provider] : undefined;
    return {
      ok: true,
      available: Object.values(providers)
        .filter((p) => p.configured())
        .map((p) => ({ id: p.id, label: p.label })),
      ...(provider ? { provider: provider.id, label: provider.label } : {}),
      status: provider ? st.status : 'off',
      ...(st.error ? { error: st.error } : {}),
      ...(st.lastSyncedAt ? { lastSyncedAt: st.lastSyncedAt } : {}),
      includeTags: st.includeTags,
      ...(st.previous ? { previousAt: st.previous.at } : {}),
    };
  }

  let connectWindow: number | undefined;
  async function openConnect(id: CloudProviderId): Promise<void> {
    if (connectWindow !== undefined) await browser.windows.remove(connectWindow).catch(() => {});
    const win = await browser.windows.create({
      url: browser.runtime.getURL(`/cloud-connect.html?provider=${id}` as never),
      type: 'popup',
      width: 520,
      height: 520,
    });
    connectWindow = win?.id;
  }

  const fail = (err: unknown) => ({
    ok: false as const,
    error: err instanceof Error ? redact(err.message) : 'Something went wrong.',
  });

  async function handle(msg: CloudSyncMessage, sender: { url?: string }): Promise<unknown> {
    switch (msg.type) {
      case 'cloudSync.status':
        return status();
      case 'cloudSync.openConnect': {
        const p = isProviderId(msg.provider) ? providers[msg.provider] : undefined;
        if (!p?.configured()) return { ok: false, error: 'That storage provider is not offered.' };
        await openConnect(p.id);
        return { ok: true };
      }
      case 'cloudSync.beginAuth': {
        const p = isProviderId(msg.provider) ? providers[msg.provider] : undefined;
        if (!fromExtensionPage(sender) || !p?.configured()) return { ok: false, error: 'refused' };
        const { url, pending } = await prepare(p, false);
        await savePending(pending);
        return { ok: true, url };
      }
      case 'cloudSync.finishAuth': {
        if (!fromExtensionPage(sender) || typeof msg.responseUrl !== 'string')
          return { ok: false, error: 'refused' };
        const pending = await loadPending();
        await savePending(undefined); // one use only
        if (!pending || Date.now() - pending.at > PENDING_MAX_AGE_MS)
          return { ok: false, error: 'The sign-in took too long. Please try again.' };
        const tokens = await finish(providers[pending.provider], pending, msg.responseUrl);
        await sync.connect(tokens);
        return status();
      }
      case 'cloudSync.syncNow':
        await sync.syncNow();
        return status();
      case 'cloudSync.disconnect':
        await sync.disconnect();
        return status();
      case 'cloudSync.restorePrevious':
        await sync.restorePrevious();
        return status();
      case 'cloudSync.setTags':
        await sync.setIncludeTags(msg.on === true);
        await sync.syncNow();
        return status();
    }
  }

  browser.alarms?.create(ALARM, { periodInMinutes: CLOUD_PERIOD_MINUTES });
  browser.alarms?.onAlarm.addListener((a) => {
    if (a.name === ALARM) void sync.syncNow().catch(() => {});
  });
  browser.runtime.onStartup.addListener(() => void sync.syncNow().catch(() => {}));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('settings' in changes || 'userTags' in changes))
      void sync.localChanged().catch(() => {});
  });
  browser.windows?.onRemoved?.addListener((id) => {
    if (id === connectWindow) connectWindow = undefined;
  });

  return {
    /** Handle a `cloudSync.*` message; anything else is not ours (undefined). */
    onMessage(raw: unknown, sender: { url?: string }): Promise<unknown> | undefined {
      const msg = raw as CloudSyncMessage | undefined;
      if (typeof msg?.type !== 'string' || !msg.type.startsWith('cloudSync.')) return undefined;
      return handle(msg, sender).catch(fail);
    },
    /** Is cloud sync connected? Then it, not the browser's own sync, decides the settings. */
    active: async () => !!(await loadState(browser.storage.local)).provider,
  };
}
