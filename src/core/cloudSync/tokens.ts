/**
 * Where the cloud sync's OAuth tokens live: storage.local, one key, nowhere else. Never
 * storage.sync, never a backup (BACKUP_KEYS does not list it), never a log line or a notice.
 */
import type { CloudProviderId, CloudTokens } from './types';

export const TOKENS_KEY = 'cloudSyncAuth';

export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}

const PROVIDERS: readonly CloudProviderId[] = ['google', 'dropbox', 'onedrive'];

/** Stored tokens, or null when absent or not well formed. */
export async function loadTokens(area: KeyValueArea): Promise<CloudTokens | null> {
  const raw = (await area.get(TOKENS_KEY))[TOKENS_KEY] as Partial<CloudTokens> | undefined;
  if (
    !raw ||
    typeof raw.accessToken !== 'string' ||
    !PROVIDERS.includes(raw.provider as CloudProviderId)
  )
    return null;
  return {
    provider: raw.provider as CloudProviderId,
    accessToken: raw.accessToken,
    ...(typeof raw.refreshToken === 'string' ? { refreshToken: raw.refreshToken } : {}),
    expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : 0,
  };
}

export async function saveTokens(area: KeyValueArea, tokens: CloudTokens): Promise<void> {
  await area.set({ [TOKENS_KEY]: tokens });
}

export async function clearTokens(area: KeyValueArea): Promise<void> {
  await area.remove(TOKENS_KEY);
}

/**
 * A message safe to show or log: any token value is replaced, and so is anything that looks like
 * a bearer token or an OAuth parameter, in case a library or provider echoed one.
 */
export function redact(message: string, tokens?: CloudTokens | null): string {
  let out = message;
  for (const t of [tokens?.accessToken, tokens?.refreshToken])
    if (t && t.length >= 8) out = out.split(t).join('[token]');
  return out
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [token]')
    .replace(/\b(access_token|refresh_token|code|code_verifier|id_token)=[^&\s#]+/gi, '$1=[token]');
}
