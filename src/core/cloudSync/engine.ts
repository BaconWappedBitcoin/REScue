/**
 * The cloud sync algorithm, provider-agnostic. Clock, HTTP, storage and the "settings changed"
 * broadcast are injected, so tests drive it without a browser.
 *
 * One run: read the cloud file; if it is newer than the copy this device last applied or wrote,
 * comes from another device and differs, apply it (keeping this device's profile as
 * `previous`, one level of undo) — unless this device changed its settings later (last writer
 * wins by time). Then write the cloud file when this device's content differs from the last one
 * synced. Nothing is written when nothing changed (content hash). 429/5xx back off (Retry-After
 * respected); a 401 gets one token refresh, then the user is asked to reconnect.
 */
import { normalizeProfile, type SettingsProfile } from '../settings';
import {
  CLOUD_BACKOFF_BASE_MS,
  CLOUD_BACKOFF_MAX_MS,
  CLOUD_DEBOUNCE_MS,
  CLOUD_TOKEN_SLACK_MS,
} from './config';
import {
  buildCloudFile,
  CloudTooLargeError,
  contentHash,
  parseCloudFile,
  type CloudContent,
  type CloudFile,
} from './file';
import { randomId } from './pkce';
import { clearTokens, loadTokens, redact, saveTokens, type KeyValueArea } from './tokens';
import {
  AuthNeededError,
  CloudHttpError,
  type CloudHttp,
  type CloudProvider,
  type CloudProviderId,
  type CloudTokens,
} from './types';

export const STATE_KEY = 'cloudSync';

export type CloudStatus = 'off' | 'ok' | 'error' | 'reconnect';

export interface CloudSyncState {
  provider?: CloudProviderId;
  /** Random id of this install, written into the files it uploads. */
  device: string;
  includeTags: boolean;
  /** `updatedAt` of the cloud copy this device last applied or wrote. */
  lastAppliedAt: number;
  /** Content hash at that moment. */
  lastHash?: string;
  /** When this device's synced content last changed (settings or tags). */
  localChangedAt: number;
  lastSyncedAt?: number;
  status: CloudStatus;
  error?: string;
  failures: number;
  backoffUntil?: number;
  /** This device's content before the last cloud copy was applied (one level of undo). */
  previous?: { at: number; settings: SettingsProfile; tags?: Record<string, unknown> };
}

export interface EngineDeps {
  now(): number;
  http: CloudHttp;
  local: KeyValueArea;
  providers: Partial<Record<CloudProviderId, CloudProvider>>;
  /** A non-interactive re-authorization (prompt=none); rejects when the user must act. */
  silentAuth?(provider: CloudProvider): Promise<CloudTokens>;
  /** After settings or tags were written from the cloud (tell open tabs). */
  onApplied(): Promise<void>;
  /** Errors are reported here, already redacted. */
  log?(message: string): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export type RunResult = 'pulled' | 'pushed' | 'none' | 'skipped' | 'failed';

export async function loadState(local: KeyValueArea): Promise<CloudSyncState> {
  const raw = ((await local.get(STATE_KEY))[STATE_KEY] ?? {}) as Partial<CloudSyncState>;
  return {
    status: 'off',
    failures: 0,
    lastAppliedAt: 0,
    localChangedAt: 0,
    includeTags: true,
    ...raw,
    device: typeof raw.device === 'string' && raw.device ? raw.device : randomId(),
  };
}

async function saveState(local: KeyValueArea, state: CloudSyncState): Promise<void> {
  const clean = { ...state } as Record<string, unknown>;
  for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
  await local.set({ [STATE_KEY]: clean });
}

async function readLocal(local: KeyValueArea): Promise<CloudContent> {
  const got = await local.get('settings');
  const tags = (await local.get('userTags')).userTags;
  return {
    settings: normalizeProfile(got.settings),
    ...(tags && typeof tags === 'object' ? { tags: tags as Record<string, unknown> } : {}),
  };
}

export function createCloudSync(deps: EngineDeps) {
  let queue: Promise<unknown> = Promise.resolve();
  let timer: unknown;
  const setT = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  /** One operation at a time: runs never overlap with each other or with connect/disconnect. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function renew(provider: CloudProvider, tokens: CloudTokens): Promise<CloudTokens> {
    let next: CloudTokens;
    try {
      next = await provider.refresh(tokens, deps.http, deps.now());
    } catch (err) {
      if (!(err instanceof AuthNeededError) || !provider.silentReauth || !deps.silentAuth)
        throw err instanceof CloudHttpError && err.status === 401 ? new AuthNeededError() : err;
      try {
        next = await deps.silentAuth(provider);
      } catch {
        throw new AuthNeededError();
      }
    }
    await saveTokens(deps.local, next);
    return next;
  }

  /** Run `fn` with a valid access token: refresh when expiring, and once after a 401. */
  async function withAuth<T>(
    provider: CloudProvider,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    let tokens = await loadTokens(deps.local);
    if (!tokens || tokens.provider !== provider.id) throw new AuthNeededError();
    let renewed = false;
    if (tokens.expiresAt && tokens.expiresAt - CLOUD_TOKEN_SLACK_MS <= deps.now()) {
      tokens = await renew(provider, tokens);
      renewed = true;
    }
    try {
      return await fn(tokens.accessToken);
    } catch (err) {
      if (!(err instanceof CloudHttpError) || err.status !== 401) throw err;
      if (renewed) throw new AuthNeededError();
      tokens = await renew(provider, tokens);
      try {
        return await fn(tokens.accessToken);
      } catch (again) {
        if (again instanceof CloudHttpError && again.status === 401) throw new AuthNeededError();
        throw again;
      }
    }
  }

  async function runOnce(): Promise<RunResult> {
    const state = await loadState(deps.local);
    const provider = state.provider ? deps.providers[state.provider] : undefined;
    if (!provider || state.status === 'off') return 'skipped';
    if (state.status === 'reconnect') return 'skipped';
    const now = deps.now();
    if (state.backoffUntil && now < state.backoffUntil) return 'skipped';
    try {
      const result = await withAuth(provider, (token) => exchange(provider, token, state));
      Object.assign(state, {
        status: 'ok',
        error: undefined,
        failures: 0,
        backoffUntil: undefined,
        lastSyncedAt: deps.now(),
      });
      await saveState(deps.local, state);
      return result;
    } catch (err) {
      const tokens = await loadTokens(deps.local).catch(() => null);
      const msg = redact(err instanceof Error ? err.message : String(err), tokens);
      state.failures += 1;
      if (err instanceof AuthNeededError) {
        state.status = 'reconnect';
        state.error = 'Your storage provider asks you to connect again.';
      } else if (err instanceof CloudHttpError && (err.status === 429 || err.status >= 500)) {
        const wait =
          err.retryAfterMs ??
          Math.min(CLOUD_BACKOFF_BASE_MS * 2 ** (state.failures - 1), CLOUD_BACKOFF_MAX_MS);
        state.backoffUntil = deps.now() + wait;
        state.status = 'error';
        state.error = 'The storage provider is busy; REScue will try again later.';
      } else {
        state.status = 'error';
        state.error = err instanceof CloudTooLargeError ? err.message : msg;
      }
      deps.log?.(`[REScue] cloud sync: ${msg}`);
      await saveState(deps.local, state);
      return 'failed';
    }
  }

  /** Pull, then push; mutates `state` (saved by the caller). */
  async function exchange(
    provider: CloudProvider,
    token: string,
    state: CloudSyncState,
  ): Promise<RunResult> {
    const local = await readLocal(deps.local);
    const localHash = contentHash(local, state.includeTags);
    const text = await provider.read(token, deps.http);
    let remote: CloudFile | null = null;
    if (text !== null) {
      const parsed = parseCloudFile(text);
      // A damaged or too-new cloud file is left alone (not overwritten) and reported.
      if (!parsed.ok) throw new Error(parsed.error);
      remote = parsed.file;
    }
    const remoteHash = remote ? contentHash(remote, state.includeTags) : null;
    const localDirty = localHash !== state.lastHash;

    if (remote && remoteHash === localHash) {
      state.lastAppliedAt = Math.max(state.lastAppliedAt, remote.updatedAt);
      state.lastHash = localHash;
      return 'none';
    }
    const remoteNewer =
      !!remote && remote.device !== state.device && remote.updatedAt > state.lastAppliedAt;
    if (remote && remoteNewer && (!localDirty || remote.updatedAt >= state.localChangedAt)) {
      await apply(remote, local, state);
      state.lastAppliedAt = remote.updatedAt;
      state.lastHash = contentHash(await readLocal(deps.local), state.includeTags);
      return 'pulled';
    }
    if (remote && !localDirty) return 'none';

    const updatedAt = Math.max(deps.now(), (remote?.updatedAt ?? 0) + 1);
    const out = buildCloudFile({ ...local, updatedAt, device: state.device }, state.includeTags);
    await provider.write(token, out, deps.http);
    state.lastAppliedAt = updatedAt;
    state.lastHash = localHash;
    return 'pushed';
  }

  async function apply(remote: CloudFile, local: CloudContent, state: CloudSyncState) {
    state.previous = {
      at: deps.now(),
      settings: local.settings,
      ...(state.includeTags && local.tags ? { tags: local.tags } : {}),
    };
    // Saved before the overwrite, so a failed write below still leaves the undo copy.
    await saveState(deps.local, state);
    const items: Record<string, unknown> = {
      // This browser's own storage.sync switch stays as it is.
      settings: { ...remote.settings, syncEnabled: local.settings.syncEnabled },
    };
    if (state.includeTags && remote.tags) items.userTags = remote.tags;
    await deps.local.set(items);
    await deps.onApplied();
  }

  return {
    /** A sync run now (scheduled, or "sync now"); skipped while backing off or disconnected. */
    syncNow: () => serial(() => runOnce()),

    /** Settings or tags changed on this device: remember when, and sync after a quiet pause. */
    localChanged(): Promise<void> {
      return serial(async () => {
        const state = await loadState(deps.local);
        if (!state.provider) return;
        state.localChangedAt = deps.now();
        await saveState(deps.local, state);
        if (timer !== undefined) clearT(timer);
        timer = setT(() => {
          timer = undefined;
          void serial(() => runOnce()).catch(() => {});
        }, CLOUD_DEBOUNCE_MS);
      });
    },

    /** Store new tokens and sync. A device joining adopts an existing cloud copy. */
    connect(tokens: CloudTokens): Promise<RunResult> {
      return serial(async () => {
        const state = await loadState(deps.local);
        await saveTokens(deps.local, tokens);
        const switched = state.provider !== tokens.provider;
        Object.assign(state, {
          provider: tokens.provider,
          status: 'ok',
          error: undefined,
          failures: 0,
          backoffUntil: undefined,
          ...(switched ? { lastAppliedAt: 0, lastHash: undefined, localChangedAt: 0 } : {}),
        });
        await saveState(deps.local, state);
        return runOnce();
      });
    },

    /** Forget the tokens (revoked first where the provider allows). The cloud file stays. */
    disconnect(): Promise<void> {
      return serial(async () => {
        const state = await loadState(deps.local);
        const tokens = await loadTokens(deps.local);
        const provider = tokens ? deps.providers[tokens.provider] : undefined;
        if (tokens && provider?.revoke) await provider.revoke(tokens, deps.http).catch(() => {});
        await clearTokens(deps.local);
        Object.assign(state, {
          provider: undefined,
          status: 'off',
          error: undefined,
          failures: 0,
          backoffUntil: undefined,
          lastAppliedAt: 0,
          lastHash: undefined,
          localChangedAt: 0,
        });
        await saveState(deps.local, state);
      });
    },

    /** Put back the profile (and tags) the last cloud copy replaced, then sync it out. */
    restorePrevious(): Promise<boolean> {
      return serial(async () => {
        const state = await loadState(deps.local);
        if (!state.previous) return false;
        const current = await readLocal(deps.local);
        const items: Record<string, unknown> = {
          settings: { ...state.previous.settings, syncEnabled: current.settings.syncEnabled },
        };
        if (state.previous.tags) items.userTags = state.previous.tags;
        await deps.local.set(items);
        state.previous = undefined;
        state.localChangedAt = deps.now();
        await saveState(deps.local, state);
        await deps.onApplied();
        if (state.provider) await runOnce();
        return true;
      });
    },

    setIncludeTags(on: boolean): Promise<void> {
      return serial(async () => {
        const state = await loadState(deps.local);
        state.includeTags = on;
        state.localChangedAt = deps.now();
        await saveState(deps.local, state);
      });
    },

    state: () => loadState(deps.local),
  };
}

export type CloudSync = ReturnType<typeof createCloudSync>;
