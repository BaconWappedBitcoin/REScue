import { beforeEach, describe, expect, it } from 'vitest';
import { IGNORED_USER } from '../../src/core/hints';
import { Decorations } from '../../src/layout/decorations';
import { NativeAdapter } from '../../src/layout/native/adapter';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import type { ItemBatch, ModuleContext, ModuleUi } from '../../src/core/types';
import type { Post } from '../../src/model/types';
import { defaultProfile, resolveOptions, setOption } from '../../src/core/settings';
import {
  adjustTally,
  formatTally,
  readableText,
  removeTag,
  sanitizeTags,
  setIgnored,
  setTag,
  setTally,
  tagKey,
  validColor,
  validLink,
} from '../../src/modules/users/tagStore';
import { userTagger } from '../../src/modules/users/userTagger';
import { flatThreadHtml, listingHtml, mount, nestedThreadHtml, searchPageHtml } from '../fixtures/pages';

const NOW = 1_700_000_000_000;

describe('tag store', () => {
  it('keys by lower-cased username and strips a u/ prefix', () => {
    expect(tagKey('KleuDorian')).toBe('kleudorian');
    expect(tagKey('u/Spez')).toBe('spez');
    const tags = setTag({}, 'KleuDorian', { text: 'friend' }, NOW);
    expect(Object.keys(tags)).toEqual(['kleudorian']);
    expect(tags.kleudorian).toMatchObject({
      username: 'KleuDorian',
      text: 'friend',
      updatedAt: NOW,
    });
  });

  it('keeps the vote tally an integer', () => {
    let t = adjustTally({}, 'a_user', 1, NOW);
    t = adjustTally(t, 'a_user', 1.9, NOW);
    expect(t.a_user!.voteTally).toBe(2);
    t = setTally(t, 'a_user', -3.7, NOW);
    expect(t.a_user!.voteTally).toBe(-3);
    t = adjustTally(t, 'a_user', Number.NaN, NOW);
    expect(t.a_user!.voteTally).toBe(-3);
    expect(formatTally(3)).toBe('[+3]');
    expect(formatTally(-2)).toBe('[-2]');
  });

  it('tracks the ignored flag and keeps it when the tag text is cleared', () => {
    let t = setTag({}, 'bob', { text: 'x', color: '#ff0000' }, NOW);
    t = setIgnored(t, 'bob', true, NOW);
    t = setTag(t, 'bob', { text: '' }, NOW);
    expect(t.bob).toMatchObject({ ignored: true });
    expect(t.bob!.text).toBeUndefined();
    expect(t.bob!.color).toBeUndefined();
  });

  it('accepts only http(s) links', () => {
    expect(validLink('https://example.com/x')).toBe('https://example.com/x');
    expect(validLink('http://example.com')).toBe('http://example.com/');
    expect(validLink('javascript:alert(1)')).toBeUndefined();
    expect(validLink('data:text/html,hi')).toBeUndefined();
    expect(validLink('example.com')).toBeUndefined();
    const t = setTag({}, 'bob', { text: 'x', link: 'javascript:alert(1)' }, NOW);
    expect(t.bob!.link).toBeUndefined();
  });

  it('accepts only #rrggbb colours', () => {
    expect(validColor('#FF8800')).toBe('#ff8800');
    expect(validColor('red')).toBeUndefined();
    expect(validColor('#fff')).toBeUndefined();
    expect(validColor('#ff8800; background:url(x)')).toBeUndefined();
  });

  it('picks a readable text colour', () => {
    expect(readableText('#ffff00')).toBe('#000000');
    expect(readableText('#0055df')).toBe('#ffffff');
  });

  it('never prunes: unrelated and old records survive every change', () => {
    const old = {
      ancient: {
        username: 'Ancient',
        text: 'old',
        votesUp: 0,
        votesDown: 0,
        voteTally: 0,
        ignored: false,
        updatedAt: 1,
      },
    };
    let t = setTag(old, 'newbie', { text: 'n' }, NOW);
    t = adjustTally(t, 'third', 1, NOW);
    t = setIgnored(t, 'fourth', true, NOW);
    expect(t.ancient).toEqual(old.ancient);
    expect(Object.keys(t).sort()).toEqual(['ancient', 'fourth', 'newbie', 'third']);
    expect(Object.keys(removeTag(t, 'Newbie')).sort()).toEqual(['ancient', 'fourth', 'third']);
  });

  it('repairs malformed stored records instead of dropping them', () => {
    const t = sanitizeTags({
      a: {
        username: 'A',
        text: 'ok',
        color: 'nope',
        link: 'javascript:x',
        voteTally: 2.5,
        ignored: 'yes',
      },
      b: 'junk',
    });
    expect(t.a).toMatchObject({ text: 'ok', voteTally: 2, ignored: false });
    expect(t.a!.color).toBeUndefined();
    expect(t.a!.link).toBeUndefined();
    expect(t.b).toBeUndefined();
  });
});

/** userTagger running against the real decoration layer and native adapter. */
async function boot(stored: unknown, route: Partial<ModuleContext['route']> = {}) {
  const deco = new Decorations();
  const adapter = new NativeAdapter(deco);
  const store: Record<string, unknown> = { userTags: stored };
  const ui = {
    hide: (i, r) => deco.hide(i, r),
    unhide: (i, r) => deco.unhide(i, r),
    collapseBody: (i, on) => deco.collapseBody(i, on),
    markAuthor: (i, c) => deco.markAuthor(i, c),
    unmarkAuthor: (i, c) => deco.unmarkAuthor(i, c),
    decorate: (i, s, n) => deco.decorate(i, s, n),
    addClass: (i, c) => deco.addClass(i, c),
    setRevealHidden: (on) => deco.setReveal(on),
    addHeaderTool: () => {},
    addBanner: () => {},
    addMenuItem: () => () => {},
    openMenu: () => {},
    selection: () => undefined as never,
  } as ModuleUi;
  const ctx = {
    moduleId: 'userTagger',
    options: resolveOptions(userTagger, { modules: {} } as never),
    route: { kind: 'thread', path: '/', ...route },
    ui,
    data: {
      get: async (k: string) => store[k],
      set: (k: string, v: unknown) => void (store[k] = v),
    },
  } as unknown as ModuleContext;
  await userTagger.init!(ctx as never);
  const deliver = (batch: Partial<ItemBatch>) => {
    const full = { posts: [], comments: [], profileComments: [], ...batch };
    userTagger.onItems!(full, ctx as never);
    adapter.track(full);
  };
  return { deco, deliver, store, ctx };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const ownBody = (el: Element) =>
  [...el.querySelectorAll<HTMLElement>('[slot="comment"]')].find(
    (b) => b.closest('shreddit-comment') === el,
  )!;

describe('userTagger on native pages', () => {
  beforeEach(() => mount(nestedThreadHtml()));

  const tagFor = (user: string) => ({
    [user]: {
      username: user,
      text: 'friend',
      color: '#ffd700',
      link: 'https://example.com/u',
      voteTally: 3,
      ignored: false,
      updatedAt: 1,
    },
  });

  it('shows the tag, link and tally right after the author link', async () => {
    const { deliver } = await boot(tagFor('user2'));
    const comments = parseComments(document, null);
    deliver({ comments });
    const c = comments.find((x) => x.author === 'user2')!;
    const own = [...c.source.querySelectorAll('a[href^="/user/"]')].find(
      (l) => l.closest('shreddit-comment') === c.source,
    )!;
    const extras = own.nextElementSibling!;
    expect(extras.className).toBe('rescue-author-extras');
    const tag = extras.querySelector('.rescue-user-tag')!;
    expect(tag.textContent).toBe('friend');
    expect(tag.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    // An old record holding only a net tally of 3 shows as 3 upvotes.
    expect(extras.querySelector('.rescue-vote-tally')!.textContent).toBe('+3 −0');
    expect(extras.querySelector('button.rescue-tag-btn')).not.toBeNull();
  });

  it('never renders tag text as markup', async () => {
    const { deliver } = await boot({
      user2: {
        username: 'user2',
        text: '<img src=x onerror=alert(1)>',
        voteTally: 0,
        ignored: false,
        updatedAt: 1,
      },
    });
    deliver({ comments: parseComments(document, null) });
    expect(document.querySelector('.rescue-user-tag img')).toBeNull();
    expect(document.querySelector('.rescue-user-tag')!.textContent).toContain('<img');
  });

  it('editing a tag updates every instance in place without duplicating', async () => {
    mount(flatThreadHtml());
    const { deliver, store } = await boot({});
    const comments = parseComments(document, null);
    // user2 appears once; give a second comment the same author for the registry.
    document
      .querySelectorAll('shreddit-comment')[6]!
      .querySelector('a[href^="/user/"]')!
      .setAttribute('href', '/user/user2/');
    comments[6]!.author = 'user2';
    deliver({ comments });
    const buttons = document.querySelectorAll<HTMLButtonElement>('button[aria-label="Tag user2"]');
    expect(buttons.length).toBeGreaterThan(0);

    buttons[0]!.click();
    const editor = document.querySelector('.rescue-tag-editor')!;
    (editor.querySelector('input[name=text]') as HTMLInputElement).value = 'pal';
    (editor.querySelector('input[name=color]') as HTMLInputElement).value = '#00ff00';
    (editor.querySelector('.rescue-tag-save') as HTMLButtonElement).click();
    await tick();
    await tick();

    expect(document.querySelector('.rescue-tag-editor')).toBeNull();
    expect(document.querySelectorAll('.rescue-user-tag[data-user="user2"]')).toHaveLength(
      buttons.length,
    );
    expect(document.querySelectorAll('.rescue-author-extras')).toHaveLength(comments.length);
    expect((store.userTags as Record<string, { text: string }>).user2!.text).toBe('pal');

    // A second edit replaces, never appends.
    document.querySelector<HTMLButtonElement>('button[aria-label="Tag user2"]')!.click();
    (document.querySelector('.rescue-tag-delete') as HTMLButtonElement).click();
    await tick();
    await tick();
    expect(document.querySelectorAll('.rescue-user-tag')).toHaveLength(0);
    expect((store.userTags as object) && 'user2' in (store.userTags as object)).toBe(false);
  });

  it('rejects a javascript: link in the editor', async () => {
    const { deliver } = await boot({});
    deliver({ comments: parseComments(document, null) });
    document.querySelector<HTMLButtonElement>('button.rescue-tag-btn')!.click();
    const editor = document.querySelector('.rescue-tag-editor')!;
    (editor.querySelector('input[name=link]') as HTMLInputElement).value = 'javascript:alert(1)';
    (editor.querySelector('.rescue-tag-save') as HTMLButtonElement).click();
    expect(document.querySelector('.rescue-tag-editor')).not.toBeNull();
    expect(document.querySelector('.rescue-tag-error')!.textContent).toMatch(/http/);
    (editor.querySelector('.rescue-tag-cancel') as HTMLButtonElement).click();
  });

  it('collapses an ignored user’s comment body but not its replies, and show re-expands', async () => {
    const ignored = { user0: { ...tagFor('user0').user0!, ignored: true } };
    const { deliver } = await boot(ignored);
    const comments = parseComments(document, null);
    deliver({ comments });
    const parent = comments.find((c) => c.author === 'user0')!;
    const child = comments.find((c) => c.id === 't1_c1')!;
    expect(ownBody(parent.source).hasAttribute('data-rescue-collapsed')).toBe(true);
    expect(ownBody(child.source).hasAttribute('data-rescue-collapsed')).toBe(false);
    expect(parent.source.hasAttribute('data-rescue-hidden')).toBe(false);

    const toggle = parent.source.querySelector<HTMLButtonElement>('.rescue-ignore-toggle')!;
    expect(toggle.textContent).toContain('show');
    toggle.click();
    expect(ownBody(parent.source).hasAttribute('data-rescue-collapsed')).toBe(false);
    parent.source.querySelector<HTMLButtonElement>('.rescue-ignore-toggle')!.click();
    expect(ownBody(parent.source).hasAttribute('data-rescue-collapsed')).toBe(true);
  });

  it('hides a post by an ignored user and never un-hides what another module hid', async () => {
    mount(listingHtml());
    const post = parsePost(document.querySelector('shreddit-post#t3_text1')!)!;
    const { deco, deliver, store } = await boot({
      rockpaperblr: { username: 'rockpaperblr', voteTally: 0, ignored: true, updatedAt: 1 },
    });
    deco.hide(post, 'keyword'); // filteReddit got there first
    deliver({ posts: [post] });
    const article = post.source.closest('article')!;
    expect(article.hasAttribute('data-rescue-hidden')).toBe(true);

    document.querySelector<HTMLButtonElement>('button[aria-label="Tag rockpaperblr"]')!.click();
    (document.querySelector('input[name=ignore]') as HTMLInputElement).checked = false;
    (document.querySelector('.rescue-tag-save') as HTMLButtonElement).click();
    await tick();
    await tick();
    expect(deco.hiddenReason(post.id)).toBe('keyword');
    expect(article.getAttribute('data-rescue-hidden')).toBe('keyword');
    expect(store.userTags).toBeDefined();
  });

  it('shows an ignored user’s comments on their own profile', async () => {
    const ignored = { user0: { ...tagFor('user0').user0!, ignored: true } };
    const { deliver } = await boot(ignored, { kind: 'profile', username: 'user0' });
    const comments = parseComments(document, null);
    deliver({ comments });
    expect(document.querySelector('[data-rescue-collapsed]')).toBeNull();
  });
});

describe('comment ignore button', () => {
  beforeEach(() => mount(nestedThreadHtml()));

  const ignoreBtns = () => document.querySelectorAll<HTMLButtonElement>('.rescue-ignore-user');
  const extrasOf = (comment: Element) =>
    comment.querySelector(':scope > [slot="commentMeta"] .rescue-author-extras');

  function optionCtx(base: ModuleContext, options: Record<string, unknown>): ModuleContext {
    const profile = setOption(defaultProfile(), userTagger, 'ignoreButtonOnComments', false);
    const resolved = resolveOptions(userTagger, profile);
    // Merge any extra option overrides onto the resolved defaults.
    for (const [k, v] of Object.entries(options)) (resolved as Record<string, unknown>)[k] = v;
    return { ...base, options: resolved } as ModuleContext;
  }

  it('appears on other users’ comments and not on the reader’s own', async () => {
    const { deliver, ctx: _ctx } = await boot({});
    const comments = parseComments(document, null);
    // Make the first comment the reader’s own before it is registered.
    comments[0]!.author = 'me_the_reader';
    comments[0]!.source.setAttribute('author', 'me_the_reader');
    deliver({ comments });
    userTagger.onSettings!(
      { ..._ctx, session: { signedIn: true, username: 'me_the_reader' } } as never,
    );

    expect(extrasOf(comments[0]!.source)?.querySelector('.rescue-ignore-user')).toBeNull();
    expect(ignoreBtns().length).toBe(comments.length - 1);
  });

  it('toggles ignore, collapses the author’s comments, and restores them', async () => {
    const { deliver, store } = await boot({});
    const comments = parseComments(document, null);
    // Give two comments the same author so the registry updates both at once.
    comments[2]!.author = 'repeater';
    comments[2]!.source.setAttribute('author', 'repeater');
    comments[6]!.author = 'repeater';
    comments[6]!.source.setAttribute('author', 'repeater');
    deliver({ comments });

    const first = comments.find((c) => c.author === 'repeater')!;
    const btn = extrasOf(first.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!;
    expect(btn.textContent).toBe('ignore');
    btn.click();
    await tick();
    await tick();

    expect((store.userTags as Record<string, { ignored: boolean }>).repeater!.ignored).toBe(true);
    for (const c of comments.filter((c) => c.author === 'repeater')) {
      const body = ownBody(c.source);
      expect(body.hasAttribute('data-rescue-collapsed')).toBe(true);
      expect(extrasOf(c.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!.textContent).toBe('unignore');
    }

    const second = comments.filter((c) => c.author === 'repeater')[0]!;
    extrasOf(second.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!.click();
    await tick();
    await tick();

    expect((store.userTags as Record<string, { ignored: boolean }>).repeater).toBeUndefined();
    for (const c of comments.filter((c) => c.author === 'repeater')) {
      expect(ownBody(c.source).hasAttribute('data-rescue-collapsed')).toBe(false);
      expect(extrasOf(c.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!.textContent).toBe('ignore');
    }
  });

  it('disappears when the option is turned off and reappears when turned back on', async () => {
    const { deliver, ctx } = await boot({});
    const comments = parseComments(document, null);
    deliver({ comments });
    expect(ignoreBtns().length).toBe(comments.length);

    userTagger.onSettings!(optionCtx(ctx, { ignoreButtonOnComments: false }) as never);
    expect(ignoreBtns().length).toBe(0);

    userTagger.onSettings!(optionCtx(ctx, { ignoreButtonOnComments: true }) as never);
    expect(ignoreBtns().length).toBe(comments.length);
  });

  it('keeps exactly one button per comment after a settings change', async () => {
    const { deliver, ctx } = await boot({});
    const comments = parseComments(document, null);
    deliver({ comments });
    userTagger.onSettings!(ctx as never);
    for (const c of comments) {
      expect(extrasOf(c.source)!.querySelectorAll('.rescue-ignore-user')).toHaveLength(1);
    }
    expect(document.querySelectorAll('.rescue-author-extras')).toHaveLength(comments.length);
  });
});

describe('post ignore button', () => {
  const ignoreBtns = () => document.querySelectorAll<HTMLButtonElement>('.rescue-ignore-user');
  const extrasOf = (post: Element) => post.querySelector('.rescue-author-extras');

  function optionCtx(base: ModuleContext, options: Record<string, unknown>): ModuleContext {
    const profile = setOption(defaultProfile(), userTagger, 'ignoreButtonOnPosts', false);
    const resolved = resolveOptions(userTagger, profile);
    for (const [k, v] of Object.entries(options)) (resolved as Record<string, unknown>)[k] = v;
    return { ...base, options: resolved } as ModuleContext;
  }

  it('appears on other users’ posts and not on the reader’s own', async () => {
    mount(listingHtml());
    const posts = [...document.querySelectorAll('shreddit-post')]
      .map((el) => parsePost(el))
      .filter((p): p is Post => p !== null);
    const mine = posts[0]!;
    mine.author = 'me_the_reader';
    mine.source.setAttribute('author', 'me_the_reader');
    const { deliver, ctx: _ctx } = await boot({});
    deliver({ posts });
    userTagger.onSettings!(
      { ..._ctx, session: { signedIn: true, username: 'me_the_reader' } } as never,
    );

    expect(extrasOf(mine.source)?.querySelector('.rescue-ignore-user')).toBeNull();
    expect(ignoreBtns().length).toBe(posts.length - 1);
  });

  it('hides every post by the ignored author and leaves others visible', async () => {
    mount(listingHtml());
    const posts = [...document.querySelectorAll('shreddit-post')]
      .map((el) => parsePost(el))
      .filter((p): p is Post => p !== null);
    // Give two posts the same author so the registry updates both at once.
    posts[1]!.author = 'repeater';
    posts[1]!.source.setAttribute('author', 'repeater');
    posts[3]!.author = 'repeater';
    posts[3]!.source.setAttribute('author', 'repeater');
    const { deliver, deco, store } = await boot({});
    deliver({ posts });

    const first = posts.find((p) => p.author === 'repeater')!;
    const btn = extrasOf(first.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!;
    expect(btn.textContent).toBe('ignore');
    btn.click();
    await tick();
    await tick();

    expect((store.userTags as Record<string, { ignored: boolean }>).repeater!.ignored).toBe(true);
    for (const p of posts.filter((p) => p.author === 'repeater')) {
      expect(deco.hiddenReason(p.id)).toBe(IGNORED_USER);
    }
    for (const p of posts.filter((p) => p.author !== 'repeater')) {
      expect(deco.hiddenReason(p.id)).toBeUndefined();
    }
  });

  it('unignoring a hidden post restores all that author’s posts', async () => {
    mount(listingHtml());
    const posts = [...document.querySelectorAll('shreddit-post')]
      .map((el) => parsePost(el))
      .filter((p): p is Post => p !== null);
    posts[1]!.author = 'repeater';
    posts[1]!.source.setAttribute('author', 'repeater');
    posts[3]!.author = 'repeater';
    posts[3]!.source.setAttribute('author', 'repeater');
    const { deliver, deco, store } = await boot({});
    deliver({ posts });

    const first = posts.find((p) => p.author === 'repeater')!;
    extrasOf(first.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!.click();
    await tick();
    await tick();

    const second = posts.filter((p) => p.author === 'repeater')[0]!;
    extrasOf(second.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!.click();
    await tick();
    await tick();

    expect((store.userTags as Record<string, { ignored: boolean }>).repeater).toBeUndefined();
    for (const p of posts) {
      expect(deco.hiddenReason(p.id)).toBeUndefined();
    }
  });

  it('does not hide the thread’s own post when ignored, but flips the button', async () => {
    mount(listingHtml());
    const post = parsePost(document.querySelector('shreddit-post#t3_text1')!)!;
    const { deliver, deco } = await boot({}, { kind: 'thread', postId: post.id });
    deliver({ posts: [post] });

    const btn = () => extrasOf(post.source)!.querySelector<HTMLButtonElement>('.rescue-ignore-user')!;
    expect(btn().textContent).toBe('ignore');
    btn().click();
    await tick();
    await tick();

    expect(deco.hiddenReason(post.id)).toBeUndefined();
    expect(btn().textContent).toBe('unignore');

    btn().click();
    await tick();
    await tick();
    expect(btn().textContent).toBe('ignore');
  });

  it('disappears when the option is turned off and reappears when turned back on', async () => {
    mount(listingHtml());
    const posts = [...document.querySelectorAll('shreddit-post')]
      .map((el) => parsePost(el))
      .filter((p): p is Post => p !== null);
    const { deliver, ctx } = await boot({});
    deliver({ posts });
    expect(ignoreBtns().length).toBe(posts.length);

    userTagger.onSettings!(optionCtx(ctx, { ignoreButtonOnPosts: false }) as never);
    expect(ignoreBtns().length).toBe(0);

    userTagger.onSettings!(optionCtx(ctx, { ignoreButtonOnPosts: true }) as never);
    expect(ignoreBtns().length).toBe(posts.length);
  });

  it('keeps exactly one button per post after a settings change', async () => {
    mount(listingHtml());
    const posts = [...document.querySelectorAll('shreddit-post')]
      .map((el) => parsePost(el))
      .filter((p): p is Post => p !== null);
    const { deliver, ctx } = await boot({});
    deliver({ posts });
    userTagger.onSettings!(ctx as never);
    for (const p of posts) {
      expect(extrasOf(p.source)!.querySelectorAll('.rescue-ignore-user')).toHaveLength(1);
    }
    expect(document.querySelectorAll('.rescue-author-extras')).toHaveLength(posts.length);
  });

  it('adds a button to search results', async () => {
    mount(searchPageHtml());
    const { parseSearchPost } = await import('../../src/model/search-post');
    const results = [...document.querySelectorAll('search-telemetry-tracker')]
      .map((el) => parseSearchPost(el))
      .filter((p): p is Post => p !== null);
    const { deliver } = await boot({});
    deliver({ posts: results });
    expect(ignoreBtns().length).toBe(results.length);
  });
});
