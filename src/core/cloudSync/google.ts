/**
 * Google Drive: one file in the hidden application data folder (scope drive.appdata).
 *
 * Why the token flow and not code + PKCE: an extension's redirect URI
 * (https://<id>.chromiumapp.org/ or Firefox's identity URL) can only be registered on a Google
 * "Web application" OAuth client, and Google requires that client type's client SECRET to redeem
 * a code or a refresh token. An extension cannot keep a secret, so REScue asks for an access token
 * directly (response_type=token, about one hour) and, when it expires, asks again silently
 * (prompt=none, non-interactive auth window) using the user's Google session. If that is not
 * possible (signed out of Google, access removed), the settings console shows "reconnect".
 * Endpoints: src/contracts/cloud.ts GOOGLE (with the documentation pages).
 */
import { CLOUD_FILE_NAME, CLOUD_PROVIDER_LABELS, GOOGLE } from '../../contracts/cloud';
import { GOOGLE_CLIENT_ID } from './config';
import {
  AuthNeededError,
  expectOk,
  form,
  redirectParams,
  type CloudHttp,
  type CloudProvider,
} from './types';

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function findFileId(token: string, http: CloudHttp): Promise<string | null> {
  const q = new URLSearchParams({
    spaces: GOOGLE.appFolder,
    q: `name = '${CLOUD_FILE_NAME}' and trashed = false`,
    fields: 'files(id,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '1',
  });
  const res = await expectOk(
    await http(`${GOOGLE.files}?${q}`, { method: 'GET', headers: bearer(token) }),
    'Google Drive list',
  );
  const body = (await res.json()) as { files?: Array<{ id?: unknown }> };
  const id = body.files?.[0]?.id;
  return typeof id === 'string' && /^[\w-]+$/.test(id) ? id : null;
}

export function createGoogleProvider(clientId: string = GOOGLE_CLIENT_ID): CloudProvider {
  return {
    id: 'google',
    label: CLOUD_PROVIDER_LABELS.google,
    origins: GOOGLE.origins,
    configured: () => clientId !== '',
    silentReauth: true,

    authorizeUrl({ redirectUri, state, silent }) {
      const p = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'token',
        scope: GOOGLE.scope,
        state,
        include_granted_scopes: 'true',
      });
      if (silent) p.set('prompt', 'none');
      return `${GOOGLE.authorize}?${p}`;
    },

    async finishAuthorize({ responseUrl }, _http, now) {
      const p = redirectParams(responseUrl);
      if (p.get('error')) throw new AuthNeededError('Google did not give access');
      const token = p.get('access_token');
      if (!token) throw new AuthNeededError('Google sent no access token');
      const granted = (p.get('scope') ?? GOOGLE.scope).split(' ');
      if (!granted.includes(GOOGLE.scope))
        throw new AuthNeededError('Google did not give access to the app data folder');
      const secs = Number(p.get('expires_in'));
      return {
        provider: 'google',
        accessToken: token,
        expiresAt: Number.isFinite(secs) && secs > 0 ? now + secs * 1000 : now + 3_000_000,
      };
    },

    async refresh() {
      // No refresh token in the token flow: the engine re-authorizes silently instead.
      throw new AuthNeededError('Google access expired');
    },

    async read(token, http) {
      const id = await findFileId(token, http);
      if (!id) return null;
      const res = await expectOk(
        await http(`${GOOGLE.files}/${id}?alt=media`, { method: 'GET', headers: bearer(token) }),
        'Google Drive download',
      );
      return res.text();
    },

    async write(token, text, http) {
      const id = await findFileId(token, http);
      if (id) {
        await expectOk(
          await http(`${GOOGLE.upload}/${id}?uploadType=media`, {
            method: 'PATCH',
            headers: { ...bearer(token), 'Content-Type': 'application/json; charset=UTF-8' },
            body: text,
          }),
          'Google Drive update',
        );
        return;
      }
      const boundary = `rescue-${Math.random().toString(36).slice(2)}`;
      const meta = JSON.stringify({ name: CLOUD_FILE_NAME, parents: [GOOGLE.appFolder] });
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n` +
        `--${boundary}--`;
      await expectOk(
        await http(`${GOOGLE.upload}?uploadType=multipart`, {
          method: 'POST',
          headers: { ...bearer(token), 'Content-Type': `multipart/related; boundary=${boundary}` },
          body,
        }),
        'Google Drive create',
      );
    },

    async revoke(tokens, http) {
      await http(GOOGLE.revoke, form({ token: tokens.accessToken }));
    },
  };
}
