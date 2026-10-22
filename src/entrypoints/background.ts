/**
 * Background: storage migrations at startup, settings broadcast, backup export/import, sync
 * mirroring, and module-health collection (contracts/messaging.md).
 */
import { BACKUP_KEYS, buildBackup, parseBackup } from '../core/backup';
import { MIGRATIONS, runMigrations, type StoredData } from '../core/storage/migrations';
import { normalizeProfile } from '../core/settings';
import {
  chunkForSync,
  decideSyncRestore,
  fnv1a,
  staleChunkKeys,
  unchunkFromSync,
} from '../core/storage/sync';
import { ensureRunning, isRedditPage, PING } from '../core/startupCheck';
import { readBundledJson } from '../core/net';
import { pruneRead, pruneOlderThan, type ReadRecord } from '../core/storage/prune';
import {
  createMediaBlocker,
  MEDIA_PERMISSIONS,
  type BlockApi,
  type DnrLike,
} from '../core/mediaBlock';

export type BackgroundMessage =
  | { type: 'settings.changed' }
  | { type: 'media.blocking'; action: 'status' | 'ask' | 'allowTab' }
  | { type: 'backup.export'; includeRead: boolean }
  | { type: 'backup.import'; json: string; mode: 'replace' | 'merge' }
  | {
      type: 'health.report';
      report: Array<{ id: string; status: string; failingContracts: string[] }>;
    }
  | { type: 'health.get' }
  | { type: 'neutrality.data' }
  | { type: 'tabs.open'; urls: string[]; active: boolean }
  | { type: 'sync.status' }
  | { type: 'sync.apply' }
  | { type: 'sync.keep' };

const REDDIT_TABS = ['*://www.reddit.com/*', '*://reddit.com/*', '*://sh.reddit.com/*'];
const HIDDEN_POSTS_MAX_AGE_MS = 90 * 86_400_000;

export default defineBackground(() => {
  const health = new Map<number, unknown>();

  async function migrateAndPrune(): Promise<void> {
    const all = (await browser.storage.local.get(null)) as StoredData;
    const result = runMigrations(all, MIGRATIONS);
    if (!result.ok) {
      console.error('[REScue] storage migration failed; data left untouched:', result.error);
      return;
    }
    const data = { ...result.data };
    if (data.read) data.read = pruneRead(data.read as Record<string, ReadRecord>);
    if (data.hiddenPosts)
      data.hiddenPosts = pruneOlderThan(
        data.hiddenPosts as Record<string, number>,
        HIDDEN_POSTS_MAX_AGE_MS,
      );
    if (!data.schema) data.schema = { version: 1 };
    await browser.storage.local.set(data);
  }

  async function mirrorSettingsToSync(): Promise<void> {
    const { settings } = await browser.storage.local.get('settings');
    if (!settings || (settings as { syncEnabled?: boolean }).syncEnabled !== true) return;
    const items = chunkForSync(settings);
    const existing = await browser.storage.sync.get(null);
    // What this device writes is not a change to ask about when the sync event comes back.
    await setSyncState({ knownHash: fnv1a(JSON.stringify(settings)), pendingHash: undefined });
    await browser.storage.sync.set(items);
    const stale = staleChunkKeys(existing, items);
    if (stale.length) await browser.storage.sync.remove(stale);
  }

  interface SyncState {
    /** Hash of the last synced copy this device wrote, applied or declined. */
    knownHash?: string;
    /** Hash of a synced copy waiting for the reader's answer. */
    pendingHash?: string;
  }

  async function syncState(): Promise<SyncState> {
    return ((await browser.storage.local.get('syncState')).syncState ?? {}) as SyncState;
  }

  async function setSyncState(patch: SyncState): Promise<void> {
    const next = { ...(await syncState()), ...patch };
    for (const k of Object.keys(next) as Array<keyof SyncState>)
      if (next[k] === undefined) delete next[k];
    await browser.storage.local.set({ syncState: next });
  }

  /** The synced settings profile and its hash, or null when the set is incomplete or damaged. */
  async function readSynced(): Promise<{ profile: unknown; hash: string } | null> {
    const profile = unchunkFromSync(await browser.storage.sync.get(null));
    return profile ? { profile, hash: fnv1a(JSON.stringify(profile)) } : null;
  }

  async function applySynced(synced: { profile: unknown; hash: string }): Promise<void> {
    const next = { ...normalizeProfile(synced.profile), syncEnabled: true };
    // Keep this device's settings as they were, so a bad synced copy can be undone by hand.
    const { settings: previous } = await browser.storage.local.get('settings');
    if (previous)
      await browser.storage.local.set({ settingsBeforeSync: { at: Date.now(), previous } });
    await browser.storage.local.set({ settings: next });
    await setSyncState({ knownHash: synced.hash, pendingHash: undefined });
    await broadcastSettingsChanged();
  }

  /**
   * Settings sync, the other way (RES automaticRestore): when another device changed the synced
   * copy, apply it, or keep it waiting until the reader agrees (backupAndRestore's
   * warnBeforeAutomaticRestore, on by default).
   */
  async function pullSettingsFromSync(): Promise<void> {
    const { settings } = await browser.storage.local.get('settings');
    const local = settings as
      | {
          syncEnabled?: boolean;
          modules?: Record<string, { options?: Record<string, unknown> }>;
        }
      | undefined;
    if (!local || local.syncEnabled !== true) return;
    const synced = await readSynced();
    const state = await syncState();
    const decision = decideSyncRestore({
      syncEnabled: true,
      localHash: fnv1a(JSON.stringify(local)),
      remoteHash: synced?.hash ?? null,
      knownHash: state.knownHash,
      warn: local.modules?.backupAndRestore?.options?.warnBeforeAutomaticRestore !== false,
    });
    if (!synced || decision === 'ignore') return;
    if (decision === 'apply') return applySynced(synced);
    if (state.pendingHash === synced.hash) return;
    await setSyncState({ pendingHash: synced.hash });
    const tabs = await browser.tabs.query({ url: REDDIT_TABS });
    for (const t of tabs)
      if (t.id !== undefined)
        browser.tabs.sendMessage(t.id, { type: 'sync.pending' }).catch(() => {});
  }

  let pullTimer: ReturnType<typeof setTimeout> | undefined;
  const pullSoon = (): void => {
    // A settings profile arrives as several chunks, each its own change event: wait for the last.
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => void pullSettingsFromSync().catch(() => {}), 1500);
  };
  browser.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') pullSoon();
  });

  async function broadcastSettingsChanged(): Promise<void> {
    const tabs = await browser.tabs.query({ url: REDDIT_TABS });
    for (const t of tabs)
      if (t.id !== undefined)
        browser.tabs.sendMessage(t.id, { type: 'settings.changed' }).catch(() => {});
  }

  // Opt-in media download blocking (inlineMedia). The rules exist only while the user has asked for
  // them and granted the optional permission; the optional API is absent until then.
  /** The parsed neutrality score file, read once (neutralityFilter asks from every tab). */
  let neutrality: Promise<unknown> | null = null;
  let permissionWindow: number | undefined;
  const blockApi: BlockApi = {
    readSettings: async () => (await browser.storage.local.get('settings')).settings,
    hasPermission: () => browser.permissions.contains(MEDIA_PERMISSIONS),
    dnr: () => (browser as unknown as { declarativeNetRequest?: DnrLike }).declarativeNetRequest,
    async openPermissionPage() {
      if (permissionWindow !== undefined) {
        try {
          await browser.windows.update(permissionWindow, { focused: true });
          return;
        } catch {
          permissionWindow = undefined; // it was closed
        }
      }
      const win = await browser.windows.create({
        url: browser.runtime.getURL('/media-permission.html' as never),
        type: 'popup',
        width: 480,
        height: 380,
      });
      permissionWindow = win?.id;
    },
  };
  const blocker = createMediaBlocker(blockApi);
  const reconcileBlocking = () => void blocker.reconcile().catch(() => {});

  browser.runtime.onInstalled.addListener(() => {
    void migrateAndPrune();
    reconcileBlocking();
  });
  browser.runtime.onStartup.addListener(() => {
    void migrateAndPrune();
    reconcileBlocking();
    pullSoon();
  });
  browser.permissions?.onAdded?.addListener(reconcileBlocking);
  browser.permissions?.onRemoved?.addListener(reconcileBlocking);

  browser.runtime.onMessage.addListener((raw: unknown, sender) => {
    const msg = raw as BackgroundMessage;
    switch (msg?.type) {
      case 'settings.changed':
        reconcileBlocking();
        return Promise.all([broadcastSettingsChanged(), mirrorSettingsToSync()]).then(() => ({
          ok: true,
        }));
      case 'media.blocking': {
        const tab = sender.tab?.id;
        const run =
          msg.action === 'ask'
            ? blocker.ask()
            : msg.action === 'allowTab' && tab !== undefined
              ? blocker.allowTab(tab).then((ok) => (ok ? ('active' as const) : blocker.reconcile()))
              : blocker.reconcile();
        return run
          .then((state) => ({ ok: true, state }))
          .catch(() => ({ ok: false, state: 'off' as const }));
      }
      case 'backup.export':
        return browser.storage.local.get(null).then((all) => ({
          ok: true,
          file: buildBackup(
            all as StoredData,
            browser.runtime.getManifest().version,
            msg.includeRead,
          ),
        }));
      case 'backup.import':
        return browser.storage.local.get(null).then(async (all) => {
          const r = parseBackup(msg.json, all as StoredData, msg.mode);
          if (!r.ok) return r;
          // Write first, so a failed write loses nothing. Replace then removes only what the
          // backup format owns and this file does not carry; keys a backup never holds
          // (collapsed, hiddenPosts, mod:*, syncState, ...) are not the backup's to remove.
          try {
            await browser.storage.local.set(r.data);
          } catch (err) {
            return { ok: false, error: `Could not save the backup: ${String(err)}` };
          }
          if (msg.mode === 'replace') {
            const absent = BACKUP_KEYS.filter((k) => !(k in r.data));
            if (absent.length) await browser.storage.local.remove(absent);
          }
          await broadcastSettingsChanged();
          return { ok: true };
        });
      case 'sync.status':
        return syncState().then((st) => ({ ok: true, pending: st.pendingHash !== undefined }));
      case 'sync.apply':
        return readSynced().then(async (synced) => {
          if (synced) await applySynced(synced);
          return { ok: !!synced };
        });
      case 'sync.keep':
        return syncState().then(async (st) => {
          await setSyncState({ knownHash: st.pendingHash ?? st.knownHash, pendingHash: undefined });
          return { ok: true };
        });
      case 'health.report':
        if (sender.tab?.id !== undefined) health.set(sender.tab.id, msg.report);
        return Promise.resolve({ ok: true });
      case 'tabs.open': {
        // At most two http(s) URLs per request (link + comments); anything else is refused.
        const urls = (Array.isArray(msg.urls) ? msg.urls : [])
          .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
          .slice(0, 2);
        const index = sender.tab?.index;
        return Promise.all(
          urls.map((url, i) =>
            browser.tabs.create({
              url,
              active: msg.active && i === 0,
              ...(index !== undefined ? { index: index + 1 + i } : {}),
            }),
          ),
        ).then(() => ({ ok: true }));
      }
      case 'health.get':
        return Promise.resolve({ ok: true, reports: Object.fromEntries(health) });
      case 'neutrality.data':
        // The score file is not in the page script; it is read from the extension only on request,
        // once per background lifetime (every tab asks for the same 465 KB).
        neutrality ??= readBundledJson('neutrality-scores.json').catch((err: unknown) => {
          neutrality = null; // try again on the next request
          throw err;
        });
        return neutrality.then((data) => ({ ok: true, data })).catch(() => ({ ok: false }));
      default:
        return undefined;
    }
  });

  // A Reddit page that loaded without REScue gets it started here (core/startupCheck).
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== 'complete' || !isRedditPage(tab.url)) return;
    void ensureRunning(tabId, {
      ping: (id) => browser.tabs.sendMessage(id, { type: PING }),
      inject: async (id) => {
        await browser.scripting.executeScript({
          target: { tabId: id },
          world: 'MAIN',
          files: ['/content-scripts/bridge.js'],
        });
        await browser.scripting.executeScript({
          target: { tabId: id },
          files: ['/content-scripts/content.js'],
        });
      },
    });
  });

  browser.tabs.onRemoved.addListener((id) => {
    health.delete(id);
    void blocker.forgetTab(id).catch(() => {});
  });
  browser.windows?.onRemoved?.addListener((id) => {
    if (id === permissionWindow) permissionWindow = undefined;
  });
});
