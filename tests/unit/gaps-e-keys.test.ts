import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyDispatcher } from '../../src/core/keys';
import { Selection } from '../../src/layout/native/selection';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import type { Comment, Post } from '../../src/model/types';
import { saveComments } from '../../src/modules/comments/saveComments';
import { registerBuiltinCommands } from '../../src/modules/core/commandBuiltins';
import { resolveCommand } from '../../src/modules/core/commandRegistry';
import { buildCommands } from '../../src/modules/listings/keyboardNav/commands';
import type { NavEnv } from '../../src/modules/listings/keyboardNav/env';
import { listingHtml, mount, nestedThreadHtml, threadComments } from '../fixtures/pages';
import { bootModules } from './module-harness';

const batch = (o: { posts?: Post[]; comments?: Comment[] }) => ({
  posts: o.posts ?? [],
  comments: o.comments ?? [],
  profileComments: [],
});
const posts = (): Post[] =>
  [...document.querySelectorAll('shreddit-post')]
    .map((el) => parsePost(el))
    .filter((p): p is Post => !!p);

describe('keyboard gaps', () => {
  let sel: Selection;
  let keys: KeyDispatcher;
  let opened: Array<{ urls: string[]; active: boolean }>;
  let assigned: string[];
  let notices: string[];

  const press = (init: KeyboardEventInit) =>
    keys.handle(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  beforeEach(() => {
    sel = new Selection();
    keys = new KeyDispatcher();
    opened = [];
    assigned = [];
    notices = [];
    vi.stubGlobal('location', {
      ...window.location,
      origin: 'https://www.reddit.com',
      assign: (u: string) => assigned.push(u),
    });
    const env: NavEnv = {
      ctx: {
        session: { signedIn: true, username: 'me_the_reader' },
        notices: { show: (m: string) => notices.push(m), dismiss: () => {} },
      } as never,
      sel: () => sel,
      route: () => ({ kind: 'front', path: '/', subreddit: 'programming' }),
      inNewTab: () => false,
      linkNumbers: () => ({ enabled: true, keys: 'digit', newTab: true }),
      openTabs: (urls, active) => opened.push({ urls, active }),
      toggleHelp: () => {},
      helpOpen: () => false,
      closeHelp: () => {},
    };
    for (const c of buildCommands(env)) keys.register(c);
  });
  afterEach(() => {
    sel.reset();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const selectPost = (id: string) => {
    mount(listingHtml());
    sel.track(batch({ posts: posts() }));
    sel.select(id);
  };

  it('binds the new commands to free keys', () => {
    expect(keys.conflicts()).toEqual({});
    const byId = Object.fromEntries(keys.list().map((c) => [c.id, c.keys]));
    expect(byId.followPermalink).toEqual(['ctrl+y']);
    expect(byId.followPermalinkNewTab).toEqual(['ctrl+shift+y']);
    expect(byId.followLinkNewTab).toEqual(['alt+o']);
    expect(byId.saveRES).toEqual(['shift+s']);
    // REScue's own `y` still copies the permalink.
    expect(byId.copyPermalink).toEqual(['y']);
  });

  it('Ctrl+Y opens the permalink, Ctrl+Shift+Y in a new tab', () => {
    selectPost('t3_text1');
    press({ key: 'y', ctrlKey: true });
    expect(assigned).toEqual(['https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/']);
    press({ key: 'y', ctrlKey: true, shiftKey: true });
    expect(opened).toEqual([
      { urls: ['https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/'], active: true },
    ]);
  });

  it('Alt+O opens only the post’s link in a new tab', () => {
    selectPost('t3_link1');
    press({ key: 'o', code: 'KeyO', altKey: true });
    expect(opened).toEqual([{ urls: ['https://example.co.uk/nasa'], active: true }]);
    expect(assigned).toEqual([]);
  });

  it('does nothing with no selection', () => {
    mount(listingHtml());
    press({ key: 'y', ctrlKey: true });
    expect(assigned).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('Shift+S saves and unsaves the selected comment through save-RES', async () => {
    mount(nestedThreadHtml(threadComments()));
    const m = await bootModules([saveComments], { route: { kind: 'thread', path: '/' } });
    sel.track(batch({ comments: parseComments(document, null) }));
    sel.select('t1_c0');
    press({ key: 'S', shiftKey: true });
    await m.tick();
    await m.tick();
    expect(Object.keys((m.store.savedComments ?? {}) as object)).toEqual(['t1_c0']);
    press({ key: 'S', shiftKey: true });
    await m.tick();
    await m.tick();
    expect(Object.keys((m.store.savedComments ?? {}) as object)).toEqual([]);
    m.dispose();
  });

  it('Shift+S passes through on a post and when save-RES is off', async () => {
    selectPost('t3_text1');
    press({ key: 'S', shiftKey: true });
    mount(nestedThreadHtml(threadComments()));
    sel.track(batch({ comments: parseComments(document, null) }));
    sel.select('t1_c0');
    const ev = new KeyboardEvent('keydown', { key: 'S', shiftKey: true, cancelable: true });
    keys.handle(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('the [number] command', () => {
  registerBuiltinCommands();
  const env = {
    route: { kind: 'front', path: '/' },
    settings: { definitions: () => [] },
    keys: { list: () => [], run: () => false },
  } as never;

  it('turns a typed number into the numbered-link command, 0 being the tenth', () => {
    for (const [text, id] of [
      ['3', 'openLink3'],
      ['[3]', 'openLink3'],
      ['1', 'openLink1'],
      ['0', 'openLink10'],
      ['[0]', 'openLink10'],
    ] as const) {
      expect(resolveCommand(text, env)).toMatchObject({ kind: 'command', target: id });
    }
  });

  it('leaves longer numbers and words alone', () => {
    expect(resolveCommand('12', env).kind).toBe('unknown');
    expect(resolveCommand('[x]', env).kind).toBe('unknown');
  });
});
