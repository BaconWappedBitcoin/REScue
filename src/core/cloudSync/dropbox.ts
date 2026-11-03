/**
 * Dropbox: one file in the app's own folder (an "App folder" app sees only /Apps/<app name>/).
 * Authorization code + PKCE (S256) with token_access_type=offline, so a refresh token is issued to
 * this public client without any secret. Endpoints: src/contracts/cloud.ts DROPBOX.
 */
import { CLOUD_PROVIDER_LABELS, DROPBOX } from '../../contracts/cloud';
import { DROPBOX_APP_KEY } from './config';
import {
  AuthNeededError,
  CloudHttpError,
  expectOk,
  form,
  redirectParams,
  retryAfterMs,
  tokensFrom,
  type CloudProvider,
} from './types';

/** JSON for the Dropbox-API-Arg header: characters 0x7F and above as \uXXXX (header-safe). */
export function headerSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function createDropboxProvider(appKey: string = DROPBOX_APP_KEY): CloudProvider {
  return {
    id: 'dropbox',
    label: CLOUD_PROVIDER_LABELS.dropbox,
    origins: DROPBOX.origins,
    configured: () => appKey !== '',
    silentReauth: false,

    authorizeUrl({ redirectUri, state, challenge }) {
      const p = new URLSearchParams({
        client_id: appKey,
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        token_access_type: 'offline',
      });
      return `${DROPBOX.authorize}?${p}`;
    },

    async finishAuthorize({ responseUrl, redirectUri, verifier }, http, now) {
      const p = redirectParams(responseUrl);
      const code = p.get('code');
      if (p.get('error') || !code) throw new AuthNeededError('Dropbox did not give access');
      const res = await http(
        DROPBOX.token,
        form({
          code,
          grant_type: 'authorization_code',
          code_verifier: verifier,
          client_id: appKey,
          redirect_uri: redirectUri,
        }),
      );
      return tokensFrom(res, 'dropbox', now);
    },

    async refresh(tokens, http, now) {
      if (!tokens.refreshToken) throw new AuthNeededError();
      const res = await http(
        DROPBOX.token,
        form({
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          client_id: appKey,
        }),
      );
      return tokensFrom(res, 'dropbox', now, tokens.refreshToken);
    },

    async read(token, http) {
      const res = await http(DROPBOX.download, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Dropbox-API-Arg': headerSafeJson({ path: DROPBOX.path }),
        },
      });
      if (res.status === 409) {
        // An endpoint-specific error; path/not_found means the file is not there yet.
        const body = (await res.json().catch(() => ({}))) as { error_summary?: unknown };
        if (String(body.error_summary ?? '').startsWith('path/not_found')) return null;
        throw new CloudHttpError(
          409,
          retryAfterMs(res.headers.get('retry-after'), Date.now()),
          'Dropbox download',
        );
      }
      await expectOk(res, 'Dropbox download');
      return res.text();
    },

    async write(token, text, http) {
      await expectOk(
        await http(DROPBOX.upload, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': headerSafeJson({
              path: DROPBOX.path,
              mode: 'overwrite',
              mute: true,
            }),
          },
          body: text,
        }),
        'Dropbox upload',
      );
    },

    async revoke(tokens, http) {
      await http(DROPBOX.revoke, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
    },
  };
}
