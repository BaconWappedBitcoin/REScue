import { beforeEach, describe, expect, it } from 'vitest';
import { Decorations } from '../../src/layout/decorations';
import { NativeAdapter } from '../../src/layout/native/adapter';
import { resolveOptions } from '../../src/core/settings';
import { parseComments } from '../../src/model/comment';
import type { ModuleContext, ModuleUi } from '../../src/core/types';
import {
  ADMIN_CLASS,
  FRIEND_CLASS,
  MOD_CLASS,
  SELF_CLASS,
  TAGGED_CLASS,
  highlightCss,
  userHighlight,
} from '../../src/modules/users/userHighlight';
import { mount, nestedThreadHtml, threadComments } from '../fixtures/pages';

const ownLink = (el: Element) =>
  [...el.querySelectorAll('a[href^="/user/"]')].find((l) => l.closest('shreddit-comment') === el)!;

async function run(
  options: Record<string, unknown>,
  tags: unknown = {},
  username: string | null = null,
) {
  const deco = new Decorations();
  const adapter = new NativeAdapter(deco);
  const ui = {
    markAuthor: (i, c) => deco.markAuthor(i, c),
    unmarkAuthor: (i, c) => deco.unmarkAuthor(i, c),
  } as ModuleUi;
  const profile = { modules: { userHighlight: { enabled: true, options } } } as never;
  const ctx = {
    moduleId: 'userHighlight',
    options: resolveOptions(userHighlight, profile),
    session: { signedIn: !!username, username },
    ui,
    data: { get: async () => tags, set: () => {} },
  } as unknown as ModuleContext;
  await userHighlight.init!(ctx as never);
  const comments = parseComments(document, null);
  const batch = { posts: [], comments, profileComments: [] };
  userHighlight.onItems!(batch, ctx as never);
  adapter.track(batch);
  return { comments };
}

describe('userHighlight', () => {
  beforeEach(() => {
    const comments = threadComments();
    comments[0]!.distinguished = 'moderator';
    comments[2]!.distinguished = 'admin';
    comments[1]!.author = 'palooza';
    mount(nestedThreadHtml(comments));
  });

  it('marks the moderator’s own author link, and only that one', async () => {
    const { comments } = await run({});
    const mod = comments.find((c) => c.id === 't1_c0')!;
    expect(mod.distinguished).toBe('moderator');
    expect(ownLink(mod.source).classList.contains(MOD_CLASS)).toBe(true);
    expect(document.querySelectorAll(`.${MOD_CLASS}`)).toHaveLength(1);
    expect(ownLink(comments.find((c) => c.id === 't1_c1')!.source).className).toBe('');
  });

  it('marks admins, friends (case-insensitive) and, when asked, tagged users', async () => {
    const { comments } = await run(
      { friends: ['u/Palooza'], highlightTagged: true },
      { user3: { username: 'user3', text: 't', voteTally: 0, ignored: false, updatedAt: 1 } },
    );
    const find = (id: string) => ownLink(comments.find((c) => c.id === id)!.source);
    expect(find('t1_c2').classList.contains(ADMIN_CLASS)).toBe(true);
    expect(find('t1_c1').classList.contains(FRIEND_CLASS)).toBe(true);
    expect(find('t1_c3').classList.contains(TAGGED_CLASS)).toBe(true);
  });

  it('marks the signed-in user’s own name only when "highlight myself" is on', async () => {
    const off = await run({}, {}, 'USER3');
    expect(document.querySelector(`.${SELF_CLASS}`)).toBeNull();
    expect(off.comments.length).toBeGreaterThan(0);
    const { comments } = await run({ highlightSelf: true }, {}, 'USER3');
    const mine = comments.filter((c) => c.author === 'user3');
    expect(mine.length).toBeGreaterThan(0);
    for (const c of mine) expect(ownLink(c.source).classList.contains(SELF_CLASS)).toBe(true);
    expect(document.querySelectorAll(`.${SELF_CLASS}`)).toHaveLength(mine.length);
    // Signed out: nobody is "me".
    mount(nestedThreadHtml(threadComments()));
    await run({ highlightSelf: true }, {}, null);
    expect(document.querySelector(`.${SELF_CLASS}`)).toBeNull();
  });

  it('colours "me" with the chosen colour, falling back to the default for a bad one', () => {
    expect(highlightCss({ mod: '', admin: '', friend: '', tagged: '', self: '#ff00ff' })).toContain(
      `a.${SELF_CLASS}{background:#ff00ff`,
    );
    expect(highlightCss({ mod: '', admin: '', friend: '', tagged: '', self: 'red' })).toContain(
      `a.${SELF_CLASS}{background:#336699`,
    );
  });

  it('does not mark tagged users by default, nor moderators when switched off', async () => {
    const { comments } = await run(
      { highlightMods: false },
      { user3: { username: 'user3', text: 't', voteTally: 0, ignored: false, updatedAt: 1 } },
    );
    expect(document.querySelector(`.${TAGGED_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${MOD_CLASS}`)).toBeNull();
    expect(comments.length).toBeGreaterThan(0);
  });

  it('only lets #rrggbb colours reach the stylesheet', () => {
    const css = highlightCss({
      mod: 'red; } body { display:none',
      admin: '#112233',
      friend: '#abcdef',
      tagged: 'url(x)',
    });
    expect(css).toContain('#228822');
    expect(css).toContain('#112233');
    expect(css).toContain('#abcdef');
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('url(');
  });
});
