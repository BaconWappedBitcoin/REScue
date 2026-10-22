/**
 * Security hardening (scan of 2026-10-21): the backup download, the network gate, the body
 * sanitizer, filter regexes, shortcut addresses from Reddit's JSON and the Markdown preview.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizedInner, sanitizeHtml, sanitizeNode } from '../../src/core/dom';
import { BlockedRequestError, netFetch } from '../../src/core/net';
import type { MineSub } from '../../src/core/redditJson';
import { renderMarkdown, PREVIEW_MAX_CHARS } from '../../src/model/markdownPreview';
import { mineHref, openMine, closeMine } from '../../src/modules/appearance/shortcutMine';
import { openBigEditor, closeBigEditor } from '../../src/modules/comments/commentTools/bigEditor';
import { downloadFile } from '../../src/modules/core/backupRestore';
import { parsePattern } from '../../src/modules/listings/filteReddit/pattern';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** Milliseconds `fn` takes (after one warm-up call on a small input). */
const timed = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe('backup download', () => {
  it('clicks a detached link (never in Reddit’s page) and revokes the address at once', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rescue/1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const seen: Array<{ connected: boolean; href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({ connected: this.isConnected, href: this.href, download: this.download });
    });
    const added = vi.fn();
    const watcher = new MutationObserver(added);
    watcher.observe(document, { childList: true, subtree: true });
    downloadFile('rescue-backup.json', '{"a":1}');
    expect(create).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      { connected: false, href: 'blob:rescue/1', download: 'rescue-backup.json' },
    ]);
    expect(watcher.takeRecords()).toEqual([]);
    watcher.disconnect();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:rescue/1');
  });
});

describe('netFetch', () => {
  beforeEach(() => {
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
      'https://www.reddit.com/r/aww/',
    );
  });

  const answer = (url: string, redirected = false) =>
    ({ ok: true, status: 200, url, redirected }) as unknown as Response;

  it('sends GET only, and refuses any other method or a body before anything leaves', async () => {
    const f = vi.fn(async () => answer('https://www.reddit.com/api/me.json'));
    vi.stubGlobal('fetch', f);
    await netFetch('/api/me.json', { headers: { Accept: 'application/json' } });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('GET');
    await expect(netFetch('/api/vote', { method: 'POST' })).rejects.toThrow(/GET/);
    await expect(netFetch('/api/me.json', { method: 'get', body: 'x' })).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('refuses an answer that was redirected away from the page’s own origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer('https://evil.example/steal', true)),
    );
    await expect(netFetch('/subreddits/mine.json')).rejects.toBeInstanceOf(BlockedRequestError);
  });

  it('accepts a same-origin redirect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer('https://www.reddit.com/r/aww/', true)),
    );
    await expect(netFetch('/r/Aww')).resolves.toMatchObject({ ok: true });
  });
});

describe('sanitizer', () => {
  it('builds copies in an inert document, so a picture in copied HTML never loads', () => {
    const made = vi.spyOn(document, 'createElement');
    const html = sanitizeHtml('<p>x<img src="https://i.example/a.png" alt="a"></p>');
    expect(html).toBe('<p>x<img src="https://i.example/a.png" alt="a"></p>');
    const src = document.createElement('div');
    src.innerHTML = '<p><img src="https://i.example/b.png"></p>';
    made.mockClear();
    expect(sanitizedInner(src)).toBe('<p><img src="https://i.example/b.png"></p>');
    const frag = sanitizeNode(src);
    expect(made.mock.calls.map((c) => c[0])).not.toContain('img');
    expect(frag.querySelector('img')?.getAttribute('src')).toBe('https://i.example/b.png');
  });

  it('refuses backslash and tab/newline tricks that make a path another host', () => {
    const out = sanitizeHtml(
      '<a href="/\\evil.example">a</a><a href="/\t/evil.example">b</a>' +
        '<a href="\n//evil.example">c</a><a href="/r/aww/">d</a><img src="/\\\\evil.example/x.png">',
    );
    const wrap = document.createElement('div');
    wrap.innerHTML = out;
    const hrefs = [...wrap.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([null, null, null, '/r/aww/']);
    expect(wrap.querySelector('img')!.getAttribute('src')).toBeNull();
  });
});

describe('filter regex patterns', () => {
  it('refuses nested repeats such as (a+)+ and says why', () => {
    for (const p of ['/(a+)+$/', '/(x*)*y/', '/(\\w+)*$/i', '/((ab)+c)+/', '/(?:a{2,})+/']) {
      const r = parsePattern(p, false);
      expect(r.ok, p).toBe(false);
      expect(!r.ok && r.error).toMatch(/repeats a group that already repeats/);
    }
  });

  it('refuses an over-long expression and says why', () => {
    const r = parsePattern(`/${'a'.repeat(400)}/`, false);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/at most 300 characters/);
  });

  it('keeps ordinary expressions and plain text working', () => {
    for (const p of ['/^(cat|dog)s?$/i', '/\\b(foo|bar)+\\b/', '/[a+]+/', '/(a)+(b+)/', 'a+b']) {
      expect(parsePattern(p, false).ok, p).toBe(true);
    }
    expect(parsePattern(`plain ${'x'.repeat(400)}`, false).ok).toBe(true);
  });
});

const mineSub = (name: string, url: string): MineSub => ({
  name,
  prefixed: `r/${name}`,
  url,
  over18: false,
  subscribers: 1,
});

describe('my subreddits links', () => {
  it('takes only same-origin paths from Reddit’s answer', () => {
    expect(mineHref(mineSub('aww', '/r/aww/'))).toBe('/r/aww/');
    expect(mineHref(mineSub('u_bob', '/user/bob/'))).toBe('/user/bob/');
    for (const bad of ['javascript:alert(1)', 'https://evil.example/', '//evil.example/x', '']) {
      expect(mineHref(mineSub('x', bad)), bad).toBeNull();
    }
  });

  it('draws an address it does not trust as plain text, not a link', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    openMine(
      {
        host: {
          signedIn: true,
          list: async () => ({
            ok: true,
            subs: [mineSub('aww', '/r/aww/'), mineSub('evil', 'javascript:alert(1)')],
          }),
        },
        rows: () => [],
        save: async () => undefined,
      },
      anchor,
    );
    await new Promise((r) => setTimeout(r, 0));
    const rows = [...document.querySelectorAll('.rescue-mine-row')];
    expect(rows.map((r) => r.querySelector('a')?.getAttribute('href') ?? null)).toEqual([
      '/r/aww/',
      null,
    ]);
    expect(rows[1]!.textContent).toContain('r/evil');
    closeMine();
  });
});

describe('Markdown preview on hostile input', () => {
  const textOf = (src: string): string => {
    const box = document.createElement('div');
    box.append(renderMarkdown(src));
    return box.textContent ?? '';
  };

  it('keeps headings working, closing hashes included', () => {
    const box = document.createElement('div');
    box.append(renderMarkdown('# Title\n### Small ##\n## C#\n#  spaced  #  '));
    expect([...box.querySelectorAll('h1,h2,h3')].map((h) => h.textContent)).toEqual([
      'Title',
      'Small',
      'C#',
      'spaced',
    ]);
  });

  it('renders a heading line full of spaces quickly', () => {
    textOf('# a  b');
    expect(timed(() => textOf(`# a${' '.repeat(20_000)}x`))).toBeLessThan(50);
    expect(timed(() => textOf(`# a${' '.repeat(20_000)}#`))).toBeLessThan(50);
  });

  it('renders unclosed link and marker runs quickly', () => {
    textOf('[a](b) >!c!<');
    const hostile = [
      '['.repeat(40_000),
      '[a]('.repeat(10_000),
      `[${'](a'.repeat(13_000)}`,
      `[x](${'a '.repeat(20_000)}`,
      `[x](a "${'b'.repeat(39_000)}`,
      '>!a'.repeat(13_000),
      '^(a'.repeat(13_000),
      `${'a'.repeat(20_000)}${' '.repeat(19_000)}x`,
    ];
    for (const src of hostile) {
      expect(
        timed(() => textOf(src)),
        src.slice(0, 12),
      ).toBeLessThan(50);
    }
  });

  it('keeps links working', () => {
    const box = document.createElement('div');
    box.append(renderMarkdown('[a](https://x.example/p "t") [b]( /r/aww ) [c](javascript:x(1))'));
    expect([...box.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      'https://x.example/p',
      'https://www.reddit.com/r/aww',
    ]);
    expect(box.textContent).toContain('[c](javascript:x(1))');
  });

  it('renders only the first part of a very long text, and says so', () => {
    const out = textOf('a'.repeat(PREVIEW_MAX_CHARS + 5_000));
    expect(out.length).toBeLessThan(PREVIEW_MAX_CHARS + 200);
    expect(out).toMatch(/first 40,000 characters/);
    expect(textOf('short')).toBe('short');
  });
});

describe('big editor preview', () => {
  it('re-renders the preview once typing pauses (about 100 ms), not on every key', async () => {
    const host = document.createElement('comment-composer-host');
    document.body.append(host);
    const bridge = {
      ref: () => 'r1',
      request: vi.fn(async () => ({ ok: true, text: 'start' })),
    };
    const notices = { show: vi.fn() };
    await openBigEditor(host, {
      ctx: { bridge, notices } as never,
      swap: false,
    });
    vi.useFakeTimers();
    const box = document.querySelector<HTMLTextAreaElement>('.rescue-big-editor-text')!;
    const preview = document.querySelector('.rescue-big-editor-preview')!;
    expect(preview.textContent).toBe('start');
    for (const v of ['*', '**b', '**bold**']) {
      box.value = v;
      box.dispatchEvent(new Event('input'));
    }
    expect(preview.textContent).toBe('start');
    vi.advanceTimersByTime(100);
    expect(preview.querySelector('strong')?.textContent).toBe('bold');
    closeBigEditor();
  });
});
