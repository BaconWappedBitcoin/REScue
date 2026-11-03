/**
 * Each cloud provider's request shapes against a mocked HTTP: addresses, methods, headers and
 * bodies, and where the token goes (a header or a request body, never a URL).
 */
import { describe, expect, it, vi } from 'vitest';
import { createDropboxProvider, headerSafeJson } from '../../src/core/cloudSync/dropbox';
import { createGoogleProvider } from '../../src/core/cloudSync/google';
import { createOneDriveProvider } from '../../src/core/cloudSync/onedrive';
import { AuthNeededError, CloudHttpError, type CloudHttp } from '../../src/core/cloudSync/types';

type Call = { url: string; init: RequestInit };

/** An HTTP mock answering from a queue; records every call. */
function mockHttp(...answers: Array<Response | (() => Response)>) {
  const calls: Call[] = [];
  const http: CloudHttp = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (!a) throw new Error(`unexpected request to ${url}`);
    return typeof a === 'function' ? a() : a;
  });
  return { http, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);
const REDIRECT = 'https://abcdef.chromiumapp.org/';
const TOKEN = 'tok-ACCESS-123';

/** No call puts the token in its address, and none asks for cookies. */
function expectTokenOnlyInHeadersOrBody(calls: Call[], ...tokens: string[]) {
  for (const c of calls) {
    for (const t of tokens) expect(c.url).not.toContain(t);
    expect(c.init.credentials).toBeUndefined();
  }
}

describe('Google Drive (appDataFolder, token flow)', () => {
  const g = createGoogleProvider('client-123');

  it('is offered only with a client id', () => {
    expect(createGoogleProvider('').configured()).toBe(false);
    expect(g.configured()).toBe(true);
  });

  it('asks for an access token for the app data scope, silently when asked', () => {
    const url = new URL(
      g.authorizeUrl({ redirectUri: REDIRECT, state: 'st', challenge: 'ch', silent: true }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    expect(p.get('client_id')).toBe('client-123');
    expect(p.get('response_type')).toBe('token');
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
    expect(p.get('redirect_uri')).toBe(REDIRECT);
    expect(p.get('state')).toBe('st');
    expect(p.get('prompt')).toBe('none');
    const interactive = new URL(
      g.authorizeUrl({ redirectUri: REDIRECT, state: 's', challenge: 'c', silent: false }),
    );
    expect(interactive.searchParams.has('prompt')).toBe(false);
  });

  it('reads the token from the redirect fragment; an error means reconnect', async () => {
    const { http, calls } = mockHttp();
    const t = await g.finishAuthorize(
      {
        responseUrl: `${REDIRECT}#access_token=${TOKEN}&expires_in=3599&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.appdata&state=st`,
        redirectUri: REDIRECT,
        verifier: 'v',
      },
      http,
      1000,
    );
    expect(t).toEqual({ provider: 'google', accessToken: TOKEN, expiresAt: 1000 + 3599_000 });
    expect(calls).toHaveLength(0);
    await expect(
      g.finishAuthorize(
        { responseUrl: `${REDIRECT}#error=access_denied`, redirectUri: REDIRECT, verifier: 'v' },
        http,
        0,
      ),
    ).rejects.toBeInstanceOf(AuthNeededError);
    await expect(g.refresh(t, http, 0)).rejects.toBeInstanceOf(AuthNeededError);
  });

  it('read lists the app data folder by name, then downloads the file', async () => {
    const { http, calls } = mockHttp(json({ files: [{ id: 'file_1' }] }), new Response('{"x":1}'));
    expect(await g.read(TOKEN, http)).toBe('{"x":1}');
    const list = new URL(calls[0]!.url);
    expect(list.origin + list.pathname).toBe('https://www.googleapis.com/drive/v3/files');
    expect(list.searchParams.get('spaces')).toBe('appDataFolder');
    expect(list.searchParams.get('q')).toContain("name = 'rescue-sync.json'");
    expect(calls[1]!.url).toBe('https://www.googleapis.com/drive/v3/files/file_1?alt=media');
    for (const c of calls) expect(header(c, 'authorization')).toBe(`Bearer ${TOKEN}`);
    expectTokenOnlyInHeadersOrBody(calls, TOKEN);
  });

  it('read answers null when the folder has no file', async () => {
    const { http } = mockHttp(json({ files: [] }));
    expect(await g.read(TOKEN, http)).toBeNull();
  });

  it('write creates the file in appDataFolder (multipart), or updates it (media)', async () => {
    const create = mockHttp(json({ files: [] }), json({ id: 'new' }));
    await g.write(TOKEN, '{"a":1}', create.http);
    const post = create.calls[1]!;
    expect(post.url).toBe('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
    expect(post.init.method).toBe('POST');
    expect(header(post, 'content-type')).toMatch(/^multipart\/related; boundary=/);
    expect(String(post.init.body)).toContain('"parents":["appDataFolder"]');
    expect(String(post.init.body)).toContain('{"a":1}');

    const update = mockHttp(json({ files: [{ id: 'f9' }] }), json({ id: 'f9' }));
    await g.write(TOKEN, '{"a":2}', update.http);
    const patch = update.calls[1]!;
    expect(patch.url).toBe('https://www.googleapis.com/upload/drive/v3/files/f9?uploadType=media');
    expect(patch.init.method).toBe('PATCH');
    expect(patch.init.body).toBe('{"a":2}');
    expectTokenOnlyInHeadersOrBody([...create.calls, ...update.calls], TOKEN);
  });

  it('revoke sends the token in a form body, not the address', async () => {
    const { http, calls } = mockHttp(new Response(''));
    await g.revoke!({ provider: 'google', accessToken: TOKEN, expiresAt: 0 }, http);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(calls[0]!.init.method).toBe('POST');
    expect(String(calls[0]!.init.body)).toBe(`token=${TOKEN}`);
  });

  it('turns 429 into an HTTP error with Retry-After', async () => {
    const { http } = mockHttp(json({}, 429, { 'Retry-After': '7' }));
    const err = await g.read(TOKEN, http).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudHttpError);
    expect((err as CloudHttpError).retryAfterMs).toBe(7000);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe('Dropbox (App folder, code + PKCE, offline)', () => {
  const d = createDropboxProvider('appkey');

  it('builds the authorize address with PKCE S256 and offline access', () => {
    const url = new URL(
      d.authorizeUrl({ redirectUri: REDIRECT, state: 'st', challenge: 'CH', silent: false }),
    );
    expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
    const p = url.searchParams;
    expect(Object.fromEntries(p)).toEqual({
      client_id: 'appkey',
      response_type: 'code',
      redirect_uri: REDIRECT,
      state: 'st',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
      token_access_type: 'offline',
    });
  });

  it('redeems the code with the verifier and no secret, in a form body', async () => {
    const { http, calls } = mockHttp(
      json({ access_token: TOKEN, refresh_token: 'REF-1', expires_in: 14400 }),
    );
    const t = await d.finishAuthorize(
      { responseUrl: `${REDIRECT}?code=CODE-1&state=st`, redirectUri: REDIRECT, verifier: 'VER' },
      http,
      0,
    );
    expect(t).toEqual({
      provider: 'dropbox',
      accessToken: TOKEN,
      refreshToken: 'REF-1',
      expiresAt: 14_400_000,
    });
    const c = calls[0]!;
    expect(c.url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(header(c, 'content-type')).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(String(c.init.body));
    expect(Object.fromEntries(body)).toEqual({
      code: 'CODE-1',
      grant_type: 'authorization_code',
      code_verifier: 'VER',
      client_id: 'appkey',
      redirect_uri: REDIRECT,
    });
    expect(body.has('client_secret')).toBe(false);
    expectTokenOnlyInHeadersOrBody(calls, 'CODE-1', 'VER');
  });

  it('refreshes with the refresh token in the body and keeps it', async () => {
    const { http, calls } = mockHttp(json({ access_token: 'NEW', expires_in: 100 }));
    const t = await d.refresh(
      { provider: 'dropbox', accessToken: 'old', refreshToken: 'REF-1', expiresAt: 0 },
      http,
      0,
    );
    expect(t.refreshToken).toBe('REF-1');
    expect(t.accessToken).toBe('NEW');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'REF-1',
      client_id: 'appkey',
    });
    expectTokenOnlyInHeadersOrBody(calls, 'REF-1');
    const refused = mockHttp(json({ error: 'invalid_grant' }, 400));
    await expect(
      d.refresh(
        { provider: 'dropbox', accessToken: 'o', refreshToken: 'R', expiresAt: 0 },
        refused.http,
        0,
      ),
    ).rejects.toBeInstanceOf(AuthNeededError);
  });

  it('downloads and uploads through the content host with Dropbox-API-Arg', async () => {
    const { http, calls } = mockHttp(new Response('{"f":1}'), json({ name: 'rescue-sync.json' }));
    expect(await d.read(TOKEN, http)).toBe('{"f":1}');
    await d.write(TOKEN, '{"f":2}', http);
    const [down, up] = calls as [Call, Call];
    expect(down.url).toBe('https://content.dropboxapi.com/2/files/download');
    expect(down.init.method).toBe('POST');
    expect(down.init.body).toBeUndefined();
    expect(JSON.parse(header(down, 'dropbox-api-arg')!)).toEqual({ path: '/rescue-sync.json' });
    expect(up.url).toBe('https://content.dropboxapi.com/2/files/upload');
    expect(header(up, 'content-type')).toBe('application/octet-stream');
    expect(JSON.parse(header(up, 'dropbox-api-arg')!)).toEqual({
      path: '/rescue-sync.json',
      mode: 'overwrite',
      mute: true,
    });
    expect(up.init.body).toBe('{"f":2}');
    for (const c of calls) expect(header(c, 'authorization')).toBe(`Bearer ${TOKEN}`);
    expectTokenOnlyInHeadersOrBody(calls, TOKEN);
  });

  it('a missing file (409 path/not_found) reads as null; other 409s fail', async () => {
    const missing = mockHttp(json({ error_summary: 'path/not_found/..' }, 409));
    expect(await d.read(TOKEN, missing.http)).toBeNull();
    const other = mockHttp(json({ error_summary: 'path/restricted_content/' }, 409));
    await expect(d.read(TOKEN, other.http)).rejects.toBeInstanceOf(CloudHttpError);
  });

  it('header-safe JSON escapes non-ASCII', () => {
    expect(headerSafeJson({ path: '/é' })).toBe('{"path":"/\\u00e9"}');
  });

  it('revokes with the token in the Authorization header', async () => {
    const { http, calls } = mockHttp(new Response('null'));
    await d.revoke!({ provider: 'dropbox', accessToken: TOKEN, expiresAt: 0 }, http);
    expect(calls[0]!.url).toBe('https://api.dropboxapi.com/2/auth/token/revoke');
    expect(header(calls[0]!, 'authorization')).toBe(`Bearer ${TOKEN}`);
  });
});

describe('OneDrive (Graph approot, code + PKCE)', () => {
  const o = createOneDriveProvider('ms-client');

  it('builds the authorize address for the app folder with offline access', () => {
    const url = new URL(
      o.authorizeUrl({ redirectUri: REDIRECT, state: 'st', challenge: 'CH', silent: true }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    const p = url.searchParams;
    expect(p.get('scope')).toBe('Files.ReadWrite.AppFolder offline_access');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe('CH');
    expect(p.get('response_type')).toBe('code');
    expect(p.get('prompt')).toBe('none');
  });

  it('redeems the code as a public client (no secret)', async () => {
    const { http, calls } = mockHttp(
      json({ access_token: TOKEN, refresh_token: 'R1', expires_in: 3600 }),
    );
    await o.finishAuthorize(
      { responseUrl: `${REDIRECT}?code=C1&state=st`, redirectUri: REDIRECT, verifier: 'VER' },
      http,
      0,
    );
    expect(calls[0]!.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    const body = Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)));
    expect(body).toEqual({
      client_id: 'ms-client',
      scope: 'Files.ReadWrite.AppFolder offline_access',
      code: 'C1',
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
      code_verifier: 'VER',
    });
  });

  it('keeps a rotated refresh token', async () => {
    const { http } = mockHttp(json({ access_token: 'A2', refresh_token: 'R2', expires_in: 10 }));
    const t = await o.refresh(
      { provider: 'onedrive', accessToken: 'A1', refreshToken: 'R1', expiresAt: 0 },
      http,
      0,
    );
    expect(t.refreshToken).toBe('R2');
  });

  it('reads through the download URL without the token; 404 is "no file yet"', async () => {
    const dl = 'https://abc.files.1drv.com/y4m-download';
    const { http, calls } = mockHttp(
      json({ id: 'i', '@microsoft.graph.downloadUrl': dl }),
      new Response('{"o":1}'),
    );
    expect(await o.read(TOKEN, http)).toBe('{"o":1}');
    expect(calls[0]!.url).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/special/approot:/rescue-sync.json?select=id,@microsoft.graph.downloadUrl',
    );
    expect(header(calls[0]!, 'authorization')).toBe(`Bearer ${TOKEN}`);
    expect(calls[1]!.url).toBe(dl);
    expect(header(calls[1]!, 'authorization')).toBeNull();
    const none = mockHttp(json({ error: { code: 'itemNotFound' } }, 404));
    expect(await o.read(TOKEN, none.http)).toBeNull();
    expectTokenOnlyInHeadersOrBody(calls, TOKEN);
  });

  it('writes with PUT to approot:/rescue-sync.json:/content', async () => {
    const { http, calls } = mockHttp(json({ id: 'i' }, 201));
    await o.write(TOKEN, '{"o":2}', http);
    expect(calls[0]!.url).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/special/approot:/rescue-sync.json:/content',
    );
    expect(calls[0]!.init.method).toBe('PUT');
    expect(header(calls[0]!, 'content-type')).toBe('text/plain');
    expect(calls[0]!.init.body).toBe('{"o":2}');
  });
});
