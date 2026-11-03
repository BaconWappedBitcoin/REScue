/** Shared types for the opt-in cloud sync (one small JSON file in the user's own storage). */
import type { CloudProviderId } from '../../contracts/cloud';

export type { CloudProviderId };

export const isProviderId = (v: unknown): v is CloudProviderId =>
  v === 'google' || v === 'dropbox' || v === 'onedrive';

/** OAuth tokens for the connected provider. Kept ONLY in storage.local (tokens.ts). */
export interface CloudTokens {
  provider: CloudProviderId;
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch; 0 when the provider did not say. */
  expiresAt: number;
}

/** The fetch the providers use: src/core/net.ts cloudFetch, already bound to the allow-list. */
export type CloudHttp = (url: string, init: RequestInit) => Promise<Response>;

/** What a provider needs to start an authorization in the browser's auth window. */
export interface AuthRequest {
  redirectUri: string;
  state: string;
  /** PKCE S256 challenge (unused by providers that use the token flow). */
  challenge: string;
  /** Ask for no user interaction (prompt=none) when the provider supports it. */
  silent: boolean;
}

export interface AuthResult {
  /** The URL the auth window was redirected to (holds the code or token, and `state`). */
  responseUrl: string;
  redirectUri: string;
  verifier: string;
}

/**
 * One storage provider. Providers are stateless: everything they need comes in as arguments,
 * every request goes through `http`, and tokens travel only in headers or request bodies.
 */
export interface CloudProvider {
  id: CloudProviderId;
  label: string;
  /** Origin patterns asked for as optional host permissions when connecting. */
  origins: readonly string[];
  /** Offered only when the owner filled in its client id (config.ts). */
  configured(): boolean;
  /** Can a silent (prompt=none) re-authorization replace a missing or expired refresh token? */
  silentReauth: boolean;
  authorizeUrl(req: AuthRequest): string;
  /** Turn the auth window's answer into tokens (after `state` was checked by the caller). */
  finishAuthorize(res: AuthResult, http: CloudHttp, now: number): Promise<CloudTokens>;
  /** New tokens from the refresh token; throws AuthNeededError when there is none. */
  refresh(tokens: CloudTokens, http: CloudHttp, now: number): Promise<CloudTokens>;
  /** The file's text, or null when it does not exist yet. */
  read(accessToken: string, http: CloudHttp): Promise<string | null>;
  write(accessToken: string, text: string, http: CloudHttp): Promise<void>;
  revoke?(tokens: CloudTokens, http: CloudHttp): Promise<void>;
}

/** An HTTP failure from a provider. The message never holds a token or a response body. */
export class CloudHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
    what: string,
  ) {
    super(`${what}: HTTP ${status}`);
    this.name = 'CloudHttpError';
  }
}

/** The provider needs the user to connect again (no refresh token, refresh refused, denied). */
export class AuthNeededError extends Error {
  constructor(message = 'the storage provider asks you to connect again') {
    super(message);
    this.name = 'AuthNeededError';
  }
}

/** Retry-After as milliseconds (seconds or an HTTP date), or undefined. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/** Throw a CloudHttpError for a non-2xx answer. */
export async function expectOk(res: Response, what: string, now = Date.now()): Promise<Response> {
  if (res.ok) return res;
  throw new CloudHttpError(res.status, retryAfterMs(res.headers.get('retry-after'), now), what);
}

/** Read an OAuth token endpoint answer into CloudTokens (keeps the old refresh token if none). */
export async function tokensFrom(
  res: Response,
  provider: CloudProviderId,
  now: number,
  previousRefresh?: string,
): Promise<CloudTokens> {
  if (res.status === 400 || res.status === 401)
    throw new AuthNeededError('the storage provider did not accept the sign-in');
  await expectOk(res, 'token request', now);
  const body = (await res.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== 'string' || !body.access_token)
    throw new AuthNeededError('the storage provider sent no access token');
  const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : previousRefresh;
  const secs = Number(body.expires_in);
  return {
    provider,
    accessToken: body.access_token,
    ...(refresh ? { refreshToken: refresh } : {}),
    expiresAt: Number.isFinite(secs) && secs > 0 ? now + secs * 1000 : 0,
  };
}

/** Parameters from a redirect URL's query and fragment (the fragment wins). */
export function redirectParams(responseUrl: string): URLSearchParams {
  const u = new URL(responseUrl);
  const out = new URLSearchParams(u.search);
  for (const [k, v] of new URLSearchParams(u.hash.replace(/^#/, ''))) out.set(k, v);
  return out;
}

export const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});
