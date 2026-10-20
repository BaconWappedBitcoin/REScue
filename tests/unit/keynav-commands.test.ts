import { describe, expect, it } from 'vitest';
import { KeyDispatcher } from '../../src/core/keys';
import { Selection } from '../../src/layout/native/selection';
import { parsePost } from '../../src/model/post';
import type { Post } from '../../src/model/types';
import {
  buildCommands,
  commentsOf,
  linkOf,
  type NavEnv,
} from '../../src/modules/listings/keyboardNav/commands';
import { overridesFrom } from '../../src/modules/listings/keyboardNav';
import { listingHtml, mount } from '../fixtures/pages';

function env(over: Partial<NavEnv> = {}): NavEnv {
  return {
    ctx: { session: { signedIn: false, username: null } } as never,
    sel: () => new Selection(),
    route: () => ({ kind: 'front', path: '/' }),
    inNewTab: () => false,
    linkNumbers: () => ({ enabled: true, keys: 'digit', newTab: true }),
    openTabs: () => {},
    toggleHelp: () => {},
    helpOpen: () => false,
    closeHelp: () => {},
    ...over,
  };
}

describe('keyboard command table', () => {
  it('has unique ids and no two commands sharing a key in the same context', () => {
    const keys = new KeyDispatcher();
    const cmds = buildCommands(env());
    for (const c of cmds) keys.register(c);
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
    expect(keys.conflicts()).toEqual({});
  });

  it('keeps the RES defaults and the requested keys', () => {
    const byId = Object.fromEntries(buildCommands(env()).map((c) => [c.id, c.defaultKeys]));
    expect(byId.moveDown).toEqual(['j']);
    expect(byId.moveUp).toEqual(['k']);
    expect(byId.followLink).toEqual(expect.arrayContaining(['enter', 'o']));
    expect(byId.followComments).toEqual(['c']);
    expect(byId.followLinkAndCommentsNewTab).toEqual(
      expect.arrayContaining(['shift+enter', 'shift+o']),
    );
    expect(byId.moveToParent).toEqual(['p']);
    expect(byId.toggleHelp).toEqual(['?']);
    expect(byId.frontPage).toEqual(['g f']);
    expect(byId.slashAll).toBeUndefined();
    expect(byId.slashPopular).toEqual(['g p']);
    expect(byId.inbox).toEqual(['g i']);
    expect(byId.profile).toEqual(['g u']);
  });

  it('Escape clears the selection, but leaves the key to an open tag manager or editor', () => {
    mount(listingHtml());
    const selection = new Selection();
    const post = parsePost(document.querySelector('shreddit-post#t3_text1')!) as Post;
    selection.track({ posts: [post], comments: [], profileComments: [] });
    selection.select(post.id);
    const dismiss = buildCommands(env({ sel: () => selection })).find((c) => c.id === 'dismiss')!;
    expect(dismiss.enabled?.()).toBe(true);
    const manager = document.createElement('div');
    manager.className = 'rescue-tags-manager';
    document.body.append(manager);
    expect(dismiss.enabled?.()).toBe(false);
    manager.remove();
    expect(dismiss.enabled?.()).toBe(true);
  });

  it('shift+j/k mean sibling moves in a thread and top/bottom on a listing', () => {
    let kind: 'thread' | 'front' = 'front';
    const keys = new KeyDispatcher();
    const calls: string[] = [];
    const sel = {
      edge: (w: string) => (calls.push(`edge:${w}`), true),
      moveSibling: (d: number) => (calls.push(`sibling:${d}`), true),
    } as unknown as Selection;
    for (const c of buildCommands(env({ sel: () => sel, route: () => ({ kind, path: '/' }) })))
      keys.register(c);
    const press = (init: KeyboardEventInit) =>
      keys.handle(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    press({ key: 'J', shiftKey: true });
    kind = 'thread';
    press({ key: 'J', shiftKey: true });
    press({ key: 'K', shiftKey: true });
    expect(calls).toEqual(['edge:last', 'sibling:1', 'sibling:-1']);
  });
});

describe('selected item links', () => {
  const sel = new Selection();
  const post = (id: string): Post => {
    mount(listingHtml());
    return parsePost(document.querySelector(`shreddit-post#${id}`)!) as Post;
  };
  const pick = (p: Post) => {
    sel.track({ posts: [p], comments: [], profileComments: [] });
    sel.select(p.id);
    return sel.current();
  };

  it('a link post follows its external URL and a text post its comments page', () => {
    expect(linkOf(pick(post('t3_link1')))).toBe('https://example.co.uk/nasa');
    const path = (u: string | null) => new URL(u!).pathname;
    expect(path(linkOf(pick(post('t3_text1'))))).toBe('/r/Layoffs/comments/text1/got_laid_off/');
    expect(path(commentsOf(pick(post('t3_link1'))))).toBe('/r/nottheonion/comments/link1/nasa/');
    expect(linkOf(null)).toBeNull();
    expect(commentsOf(null)).toBeNull();
  });
});

describe('rebind table', () => {
  it('turns rows into dispatcher overrides, ignoring blanks', () => {
    expect(
      overridesFrom([
        { command: 'moveDown', keys: 'n, ctrl+j' },
        { command: 'moveUp', keys: '' },
        { keys: 'x' },
      ]),
    ).toEqual({ moveDown: ['n', 'ctrl+j'] });
  });
});
