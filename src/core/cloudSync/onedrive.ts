/**
 * OneDrive (Microsoft Graph): one file in the app's special folder `approot`
 * (Files.ReadWrite.AppFolder). Authorization code + PKCE (S256), public client, offline_access for
 * a refresh token. The redirect URI is registered as type `spa` (the token request from an
 * extension carries an Origin header), so Microsoft limits the refresh token to 24 hours; after
 * that the engine re-authorizes silently (prompt=none) and asks for "reconnect" only if that
 * fails. Endpoints: src/contracts/cloud.ts ONEDRIVE.
 */
import { CLOUD_PROVIDER_LABELS, ONEDRIVE } from '../../contracts/cloud';
import { MICROSOFT_CLIENT_ID } from './config';
import {
  AuthNeededError,
  expectOk,
  form,
  redirectParams,
  tokensFrom,
  type CloudProvider,
} from './types';

export function createOneDriveProvider(clientId: string = MICROSOFT_CLIENT_ID): CloudProvider {
  return {
    id: 'onedrive',
    label: CLOUD_PROVIDER_LABELS.onedrive,
    origins: ONEDRIVE.origins,
    configured: () => clientId !== '',
    silentReauth: true,

    authorizeUrl({ redirectUri, state, challenge, silent }) {
      const p = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: ONEDRIVE.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      });
      if (silent) p.set('prompt', 'none');
      return `${ONEDRIVE.authorize}?${p}`;
    },

    async finishAuthorize({ responseUrl, redirectUri, verifier }, http, now) {
      const p = redirectParams(responseUrl);
      const code = p.get('code');
      if (p.get('error') || !code) throw new AuthNeededError('Microsoft did not give access');
      const res = await http(
        ONEDRIVE.token,
        form({
          client_id: clientId,
          scope: ONEDRIVE.scope,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      );
      return tokensFrom(res, 'onedrive', now);
    },

    async refresh(tokens, http, now) {
      if (!tokens.refreshToken) throw new AuthNeededError();
      const res = await http(
        ONEDRIVE.token,
        form({
          client_id: clientId,
          scope: ONEDRIVE.scope,
          refresh_token: tokens.refreshToken,
          grant_type: 'refresh_token',
        }),
      );
      // Microsoft may rotate the refresh token: tokensFrom keeps the new one when sent.
      return tokensFrom(res, 'onedrive', now, tokens.refreshToken);
    },

    async read(token, http) {
      const meta = await http(`${ONEDRIVE.item}?select=id,@microsoft.graph.downloadUrl`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meta.status === 404) return null;
      await expectOk(meta, 'OneDrive file');
      const body = (await meta.json()) as { '@microsoft.graph.downloadUrl'?: unknown };
      const url = body['@microsoft.graph.downloadUrl'];
      if (typeof url !== 'string') return null;
      // Pre-authenticated: no Authorization header goes to the download host.
      const res = await expectOk(await http(url, { method: 'GET' }), 'OneDrive download');
      return res.text();
    },

    async write(token, text, http) {
      await expectOk(
        await http(ONEDRIVE.content, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
          body: text,
        }),
        'OneDrive upload',
      );
    },
  };
}
