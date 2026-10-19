import { describe, expect, it } from 'vitest';
import {
  listCommands,
  openCommandLine,
  parseCommand,
  registerCommand,
} from '../../src/modules/core/commandLine';
import type { ModuleContext, ModuleDefinition, Route } from '../../src/core/types';

const defs = [
  { id: 'filteReddit', title: 'filteReddit', locked: false, enabledByDefault: true },
] as unknown as ModuleDefinition[];

const env = (route: Partial<Route> = {}, username: string | null = 'alice') =>
  ({
    route: { kind: 'subreddit', path: '/r/rust/', subreddit: 'rust', ...route },
    session: { signedIn: !!username, username },
    settings: { definitions: () => defs },
    keys: { list: () => [{ id: 'moveDown', title: 'Move down', keys: ['j'] }] },
  }) as never;

describe('command registry', () => {
  it('runs a registered command by name or alias, and unregisters it', () => {
    const off = registerCommand({
      name: 'hello',
      aliases: ['hi'],
      description: 'hello <who> - say hello',
      run: (args) => ({ kind: 'go', target: `/hello/${args}/`, description: 'hello' }),
    });
    expect(parseCommand('hello bob', env())).toMatchObject({ kind: 'go', target: '/hello/bob/' });
    expect(parseCommand('HI there', env())).toMatchObject({ target: '/hello/there/' });
    expect(listCommands().some((c) => c.name === 'hello')).toBe(true);
    off();
    expect(parseCommand('hello bob', env()).kind).toBe('unknown');
  });

  it('a pattern command gets the whole input and its match', () => {
    const off = registerCommand({
      name: 'issue/<n>',
      description: 'issue/<n> - open an issue',
      pattern: /^issue\/(\d+)$/,
      run: (_a, _e, m) => ({ kind: 'go', target: `/issues/${m![1]}/`, description: 'issue' }),
    });
    expect(parseCommand('issue/42', env()).target).toBe('/issues/42/');
    off();
  });

  it('registering the same name again replaces the command', () => {
    const a = registerCommand({
      name: 'dup',
      description: 'a',
      run: () => ({ kind: 'go', target: '/a/', description: '' }),
    });
    registerCommand({
      name: 'dup',
      description: 'b',
      run: () => ({ kind: 'go', target: '/b/', description: '' }),
    });
    expect(parseCommand('dup', env()).target).toBe('/b/');
    expect(listCommands().filter((c) => c.name === 'dup')).toHaveLength(1);
    a();
  });
});

describe('built-in command URLs', () => {
  it.each([
    ['me', '/user/alice/'],
    ['me/saved', '/user/alice/saved/'],
    ['/me/s', '/user/alice/saved/'],
    ['me/submitted', '/user/alice/submitted/'],
    ['me/sub', '/user/alice/submitted/'],
    ['me/comments', '/user/alice/comments/'],
    ['me/upvoted', '/user/alice/upvoted/'],
    ['me/downvoted', '/user/alice/downvoted/'],
    ['me/hidden', '/user/alice/hidden/'],
    ['m/news', '/user/alice/m/news/'],
    ['u/spez/m/tech', '/user/spez/m/tech/'],
    ['/u/spez/m/tech/', '/user/spez/m/tech/'],
    ['u/spez', '/user/spez/'],
    ['m', '/message/inbox/'],
    ['mm', 'https://mod.reddit.com/mail/all'],
    ['popular', '/r/popular/'],
    ['sr async rust', '/search/?q=async%20rust'],
    ['s tokio', '/r/rust/search/?q=tokio'],
    ['search tokio', '/r/rust/search/?q=tokio'],
    ['/n', '/r/rust/new/'],
    ['/h', '/r/rust/'],
    ['/r', '/r/rust/rising/'],
    ['/c', '/r/rust/controversial/'],
    ['/t', '/r/rust/top/'],
    ['/t week', '/r/rust/top/?t=week'],
    ['/t m', '/r/rust/top/?t=month'],
    ['/c all', '/r/rust/controversial/?t=all'],
    ['top year', '/r/rust/top/?t=year'],
    ['/n week', '/r/rust/new/'],
  ])('%s -> %s', (input, target) => {
    expect(parseCommand(input, env())).toMatchObject({ kind: 'go', target });
  });

  it('sorts follow the page: front page, profile, custom feed', () => {
    expect(
      parseCommand('/t day', env({ kind: 'front', path: '/', subreddit: undefined })).target,
    ).toBe('/top/?t=day');
    expect(
      parseCommand(
        '/t week',
        env({ kind: 'profile', path: '/user/bob/', subreddit: undefined, username: 'bob' }),
      ).target,
    ).toBe('/user/bob/?sort=top&t=week');
    expect(
      parseCommand(
        '/n',
        env({ kind: 'customFeed', path: '/user/bob/m/news', subreddit: undefined }),
      ).target,
    ).toBe('/user/bob/m/news/new/');
  });

  it('own pages and feeds need a sign-in', () => {
    for (const c of ['me', 'me/saved', 'm/news'])
      expect(parseCommand(c, env({}, null))).toMatchObject({ kind: 'message' });
  });

  it('rejects a bad period, an unknown me page and junk names', () => {
    expect(parseCommand('/t fortnight', env()).kind).toBe('message');
    expect(parseCommand('me/nonsense', env()).kind).toBe('message');
    expect(parseCommand('m/../x', env()).kind).toBe('unknown');
    expect(parseCommand('u/spez/m/a b', env()).kind).toBe('unknown');
  });

  it('? lists every command with its description', () => {
    const p = parseCommand('?', env());
    expect(p.kind).toBe('message');
    const text = (p.lines ?? []).join('\n');
    for (const piece of [
      'r/<subreddit>',
      'me, me/saved',
      'm - go to your inbox',
      'mm',
      '/n /t /h /r /c',
      'sr <words>',
      'settings',
    ])
      expect(text).toContain(piece);
    for (const c of listCommands().filter((c) => c.description))
      expect(p.lines).toContain(c.description);
  });

  it('keeps ? <words> as a search', () => {
    expect(parseCommand('? cats', env()).target).toBe('/r/rust/search/?q=cats');
  });
});

describe('command line input', () => {
  const ctx = () =>
    ({
      ...(env() as object),
      keys: { list: () => [], run: () => true },
      notices: { show: () => {} },
    }) as unknown as ModuleContext;

  const type = (value: string, init: KeyboardEventInit = { key: 'Enter' }) => {
    const input = document.querySelector<HTMLInputElement>('#rescue-cmdline input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ...init }));
  };

  it('? shows the list in the box and keeps it open', () => {
    openCommandLine(ctx());
    type('?');
    expect(document.querySelectorAll('#rescue-cmdline li').length).toBeGreaterThan(10);
    expect(document.getElementById('rescue-cmdline')).not.toBeNull();
    document.getElementById('rescue-cmdline')!.remove();
  });
});
