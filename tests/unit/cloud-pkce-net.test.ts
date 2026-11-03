/**
 * Cloud sync building blocks: PKCE values, the narrow cloud gate in src/core/net.ts, and token
 * redaction. `fetch` is stubbed; a blocked address never reaches it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_API_HOSTS, ONEDRIVE } from '../../src/contracts/cloud';
import {
  base64url,
  randomId,
  randomVerifier,
  s256Challenge,
  VERIFIER_PATTERN,
} from '../../src/core/cloudSync/pkce';
import { loadTokens, redact, saveTokens, TOKENS_KEY } from '../../src/core/cloudSync/tokens';
import { BlockedRequestError, classifyCloud, cloudFetch, netFetch } from '../../src/core/net';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PKCE', () => {
  it('makes verifiers of 43..128 unreserved characters, different each time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const v = randomVerifier();
      expect(v).toMatch(VERIFIER_PATTERN);
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      seen.add(v);
    }
    expect(seen.size).toBe(50);
  });

  it('S256 challenge matches the RFC 7636 appendix B vector', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('base64url has no padding and no + or /', () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(randomId()).toMatch(/^[\w-]{22}$/);
  });
});

const gate = (contextProtocol: string) => ({
  hosts: CLOUD_API_HOSTS,
  downloadSuffixes: ONEDRIVE.downloadHostSuffixes,
  contextProtocol,
});

const stubFetch = () => {
  const f = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'));
  vi.stubGlobal('fetch', f);
  return f;
};

describe('cloudFetch allow-list', () => {
  it.each([
    'https://www.googleapis.com/drive/v3/files',
    'https://oauth2.googleapis.com/revoke',
    'https://api.dropboxapi.com/oauth2/token',
    'https://content.dropboxapi.com/2/files/download',
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    'https://graph.microsoft.com/v1.0/me/drive/special/approot:/rescue-sync.json',
  ])('lets the background reach %s, without cookies or redirects', async (url) => {
    const f = stubFetch();
    await cloudFetch(url, { method: 'POST', body: 'x' }, gate('chrome-extension:'));
    expect(f).toHaveBeenCalledOnce();
    expect(f.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  });

  it.each([
    'https://evil.com/',
    'http://www.googleapis.com/drive/v3/files',
    'https://www.googleapis.com.evil.com/',
    'https://evil.com/?https://www.googleapis.com',
    'https://user:pw@www.googleapis.com/',
    'https://www.googleapis.com:8443/',
    'https://www.reddit.com/api/me.json',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'not a url',
  ])('blocks %s before anything leaves', async (url) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = stubFetch();
    await expect(cloudFetch(url, {}, gate('moz-extension:'))).rejects.toBeInstanceOf(
      BlockedRequestError,
    );
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses every caller that is not an extension page (a content script on Reddit)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = stubFetch();
    for (const proto of ['https:', 'http:', 'about:', ''])
      await expect(
        cloudFetch('https://www.googleapis.com/drive/v3/files', {}, gate(proto)),
      ).rejects.toBeInstanceOf(BlockedRequestError);
    // Default: this test context's own location, which is not an extension page.
    await expect(
      cloudFetch(
        'https://www.googleapis.com/drive/v3/files',
        {},
        {
          hosts: CLOUD_API_HOSTS,
          downloadSuffixes: [],
        },
      ),
    ).rejects.toBeInstanceOf(BlockedRequestError);
    expect(f).not.toHaveBeenCalled();
  });

  it('allows a OneDrive download host only as a plain GET without Authorization', () => {
    const url = 'https://abc-by3301.files.1drv.com/y4mdownload';
    const c = (init: RequestInit) =>
      classifyCloud(url, init, 'chrome-extension:', CLOUD_API_HOSTS, ONEDRIVE.downloadHostSuffixes);
    expect(c({ method: 'GET' })).toBe('download');
    expect(c({ method: 'GET', headers: { Authorization: 'Bearer x' } })).toBe('blocked');
    expect(c({ method: 'PUT', body: 'x' })).toBe('blocked');
    expect(
      classifyCloud(
        'https://files.1drv.com.evil.com/',
        {},
        'chrome-extension:',
        CLOUD_API_HOSTS,
        ONEDRIVE.downloadHostSuffixes,
      ),
    ).toBe('blocked');
  });

  it('logs a blocked address by host name only', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch();
    await expect(
      cloudFetch('https://evil.com/path?access_token=SECRET123', {}, gate('chrome-extension:')),
    ).rejects.toThrow();
    expect(JSON.stringify(err.mock.calls)).not.toContain('SECRET123');
  });

  it('leaves the Reddit gate as it was: it still refuses provider hosts', async () => {
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
      'https://www.reddit.com/',
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = stubFetch();
    await expect(netFetch('https://www.googleapis.com/drive/v3/files')).rejects.toBeInstanceOf(
      BlockedRequestError,
    );
    expect(f).not.toHaveBeenCalled();
  });
});

describe('tokens', () => {
  const memory = () => {
    const data: Record<string, unknown> = {};
    return {
      data,
      get: async (k: string) => (k in data ? { [k]: data[k] } : {}),
      set: async (items: Record<string, unknown>) => void Object.assign(data, items),
      remove: async (k: string | string[]) => {
        for (const key of [k].flat()) delete data[key];
      },
    };
  };

  it('live under one storage.local key and read back', async () => {
    const area = memory();
    const t = {
      provider: 'dropbox' as const,
      accessToken: 'AAA',
      refreshToken: 'RRR',
      expiresAt: 5,
    };
    await saveTokens(area, t);
    expect(Object.keys(area.data)).toEqual([TOKENS_KEY]);
    expect(await loadTokens(area)).toEqual(t);
    area.data[TOKENS_KEY] = { provider: 'evil', accessToken: 'x' };
    expect(await loadTokens(area)).toBeNull();
  });

  it('redact removes token values and token-shaped text', () => {
    const t = {
      provider: 'google' as const,
      accessToken: 'ya29.secretvalue',
      refreshToken: 'refresh-secret',
      expiresAt: 0,
    };
    const out = redact(
      'failed ya29.secretvalue Bearer abc.def refresh-secret ?code=XYZ&access_token=QQQ',
      t,
    );
    for (const s of ['ya29.secretvalue', 'abc.def', 'refresh-secret', 'XYZ', 'QQQ'])
      expect(out).not.toContain(s);
  });
});
