import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { hint, mediaLabel } from '../../src/core/hints';
import { parsePost } from '../../src/model/post';
import {
  collapseCss,
  galleryCount,
  mediaContainerOf,
  mediaKindOf,
} from '../../src/model/inline-media';
import { inlineMedia } from '../../src/modules/listings/inlineMedia';
import {
  EXPANDED_MAX,
  inScope,
  policyKey,
  pruneExpanded,
  sanitizeExpanded,
  shouldCollapse,
  subTable,
  validateSubRow,
  type Policy,
  type PostFacts,
} from '../../src/modules/listings/inlineMedia/policy';
import { buildCommands } from '../../src/modules/listings/keyboardNav/commands';
import { postHtml, mount, type FixturePost } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// --- fixtures -----------------------------------------------------------------------------------

const container = (inner: string) => `<div slot="post-media-container">${inner}</div>`;
const IMG = '<img src="https://i.redd.it/a.jpg">';

interface Media {
  post: FixturePost;
  inner?: string;
}
/** A listing of posts, each with an optional media container as the post's last child. */
function feed(items: Media[]): string {
  const posts = items.map(({ post, inner }) =>
    postHtml({ ...post, imgs: [] }).replace(
      '</shreddit-post>',
      `${inner ? container(inner) : ''}</shreddit-post>`,
    ),
  );
  return `<shreddit-app><div id="main-content"><shreddit-feed>${posts.join('')}</shreddit-feed></div></shreddit-app>`;
}

const base = (id: string, over: Partial<FixturePost> = {}): FixturePost => ({
  id,
  type: 'image',
  title: `Post ${id}`,
  permalink: `/r/aww/comments/${id.slice(3)}/x/`,
  domain: 'i.redd.it',
  score: '10',
  comments: '1',
  author: 'someone',
  sub: 'aww',
  ...over,
});

const ITEMS: Media[] = [
  { post: base('t3_img1'), inner: IMG },
  {
    post: base('t3_gal1', { type: 'gallery', sub: 'pics' }),
    inner: `<gallery-carousel><img src="https://preview.redd.it/g1.jpg"><img src="https://preview.redd.it/g2.jpg"></gallery-carousel>`,
  },
  {
    post: base('t3_vid1', { type: 'video', sub: 'videos', contentHref: 'https://v.redd.it/abc' }),
    inner: '<shreddit-player src="https://v.redd.it/abc"></shreddit-player>',
  },
  { post: base('t3_nsfw1', { nsfw: true, sub: 'adult' }), inner: IMG },
  { post: base('t3_txt1', { type: 'text', domain: 'self.aww' }) },
];

const route = { kind: 'front', path: '/' };

async function boot(options: Record<string, unknown> = {}, items = ITEMS, r = route) {
  mount(feed(items));
  const m = await bootModules([inlineMedia], {
    route: r,
    options: { inlineMedia: options as never },
  });
  m.flush();
  return m;
}

const host = (id: string) => document.querySelector(`shreddit-post#${id}`) as HTMLElement;
const collapsed = (id: string) => host(id).getAttribute('data-rescue-media') === 'collapsed';
const control = (id: string) =>
  host(id).querySelector('.rescue-media-toggle') as HTMLButtonElement | null;

// --- policy -------------------------------------------------------------------------------------

const policy = (over: Partial<Policy> = {}): Policy => ({
  collapseMedia: true,
  scope: 'both',
  onlyTypes: 'all',
  subs: new Map(),
  ...over,
});
const facts = (over: Partial<PostFacts> = {}): PostFacts => ({
  subreddit: 'aww',
  nsfw: false,
  spoiler: false,
  kind: 'image',
  ...over,
});

describe('inlineMedia policy', () => {
  it('collapses nothing while the switch is off (the constitution default)', () => {
    expect(shouldCollapse(policy({ collapseMedia: false }), 'front', facts())).toBe(false);
    expect(inlineMedia.options.collapseMedia).toMatchObject({ default: false });
    expect(inlineMedia.options.blockDownloads).toMatchObject({ default: false });
  });

  it('collapses every media type when the switch is on', () => {
    for (const kind of ['image', 'gallery', 'video', 'embed', 'media'] as const)
      expect(shouldCollapse(policy(), 'front', facts({ kind }))).toBe(true);
  });

  it('honours the page scope', () => {
    const listing = policy({ scope: 'listings' });
    const threads = policy({ scope: 'threads' });
    expect(shouldCollapse(listing, 'subreddit', facts())).toBe(true);
    expect(shouldCollapse(listing, 'thread', facts())).toBe(false);
    expect(shouldCollapse(threads, 'thread', facts())).toBe(true);
    expect(shouldCollapse(threads, 'front', facts())).toBe(false);
    expect(inScope('both', 'thread')).toBe(true);
    expect(inScope('listings', 'profile')).toBe(true);
  });

  it('only-types: sensitive, video and gallery', () => {
    const sensitive = policy({ onlyTypes: 'sensitive' });
    expect(shouldCollapse(sensitive, 'front', facts())).toBe(false);
    expect(shouldCollapse(sensitive, 'front', facts({ nsfw: true }))).toBe(true);
    expect(shouldCollapse(sensitive, 'front', facts({ spoiler: true }))).toBe(true);
    const video = policy({ onlyTypes: 'video' });
    expect(shouldCollapse(video, 'front', facts({ kind: 'video' }))).toBe(true);
    expect(shouldCollapse(video, 'front', facts({ kind: 'image' }))).toBe(false);
    const gallery = policy({ onlyTypes: 'gallery' });
    expect(shouldCollapse(gallery, 'front', facts({ kind: 'gallery' }))).toBe(true);
    expect(shouldCollapse(gallery, 'front', facts({ kind: 'video' }))).toBe(false);
  });

  it('a subreddit row decides for its own posts, either way', () => {
    const subs = subTable([
      { subreddit: 'r/Aww', action: 'always show' },
      { subreddit: 'Pics', action: 'always collapse' },
    ]);
    // Always show beats the switch; always collapse works with the switch off and ignores the type.
    expect(shouldCollapse(policy({ subs }), 'front', facts({ subreddit: 'aww' }))).toBe(false);
    const off = policy({ subs, collapseMedia: false, onlyTypes: 'video' });
    expect(shouldCollapse(off, 'front', facts({ subreddit: 'PICS', kind: 'image' }))).toBe(true);
    // The page scope still applies to a subreddit row.
    const listings = policy({ subs, scope: 'listings' });
    expect(shouldCollapse(listings, 'thread', facts({ subreddit: 'pics' }))).toBe(false);
  });

  it('reads the table forgivingly and rejects bad names at input', () => {
    const t = subTable([
      { subreddit: '/r/Food', action: 'always collapse' },
      { subreddit: 'x', action: 'always collapse' }, // too short
      { subreddit: 'ok_name', action: 'whatever' }, // unknown action
      { subreddit: '', action: 'always show' },
    ]);
    expect([...t]).toEqual([['food', 'always collapse']]);
    expect(validateSubRow({ subreddit: '' })).toBeNull();
    expect(validateSubRow({ subreddit: 'r/ok_name' })).toBeNull();
    expect(validateSubRow({ subreddit: 'bad name!' })).toMatch(/2 to 21/);
  });

  it('policyKey changes only when a rule that decides collapsing changes', () => {
    const a = policyKey(policy());
    expect(policyKey(policy())).toBe(a);
    expect(policyKey(policy({ scope: 'threads' }))).not.toBe(a);
    expect(policyKey(policy({ collapseMedia: false }))).not.toBe(a);
    expect(policyKey(policy({ subs: new Map([['aww', 'always show']]) }))).not.toBe(a);
  });
});

describe('remembered expanded posts', () => {
  const DAY = 86_400_000;

  it('sanitizes what storage holds', () => {
    expect(sanitizeExpanded(null)).toEqual({});
    expect(sanitizeExpanded({ a: 1, b: 'x', c: NaN, d: 5 })).toEqual({ a: 1, d: 5 });
  });

  it('forgets entries older than 90 days and caps the newest', () => {
    const now = 1_000 * DAY;
    const kept = pruneExpanded({ old: now - 91 * DAY, fresh: now - 89 * DAY }, now);
    expect(Object.keys(kept)).toEqual(['fresh']);
    const many: Record<string, number> = {};
    for (let i = 0; i < EXPANDED_MAX + 5; i++) many[`t3_${i}`] = now - i;
    const capped = pruneExpanded(many, now);
    expect(Object.keys(capped)).toHaveLength(EXPANDED_MAX);
    expect(capped['t3_0']).toBeDefined(); // the newest survive
    expect(capped[`t3_${EXPANDED_MAX + 4}`]).toBeUndefined();
  });
});

// --- model --------------------------------------------------------------------------------------

describe('media container and type', () => {
  const post = (id: string, items = ITEMS) => {
    mount(feed(items));
    return parsePost(host(id));
  };

  it('finds the container only as a direct child of the post', () => {
    mount(feed(ITEMS));
    expect(mediaContainerOf(host('t3_img1'))?.getAttribute('slot')).toBe('post-media-container');
    expect(mediaContainerOf(host('t3_txt1'))).toBeNull();
    const nested = document.createElement('shreddit-post');
    nested.innerHTML = `<div><div slot="post-media-container"></div></div>`;
    expect(mediaContainerOf(nested)).toBeNull();
  });

  it('names the type from the post model first', () => {
    expect(mediaKindOf(post('t3_img1')!, mediaContainerOf(host('t3_img1')))).toBe('image');
    const gal = post('t3_gal1')!;
    expect(mediaKindOf(gal, mediaContainerOf(host('t3_gal1')))).toBe('gallery');
    expect(galleryCount(gal)).toBe(2);
    expect(mediaKindOf(post('t3_vid1')!, mediaContainerOf(host('t3_vid1')))).toBe('video');
    expect(mediaKindOf(post('t3_txt1')!, null)).toBeNull();
  });

  it('falls back to what the container holds for link posts with embeds', () => {
    const items: Media[] = [
      { post: base('t3_e1', { type: 'link' }), inner: '<shreddit-embed></shreddit-embed>' },
      { post: base('t3_e2', { type: 'link' }), inner: '<shreddit-player gif></shreddit-player>' },
      { post: base('t3_e3', { type: 'link' }), inner: '<div>who knows</div>' },
      { post: base('t3_e4', { type: 'link' }) },
    ];
    const kinds = ['t3_e1', 't3_e2', 't3_e3', 't3_e4'].map((id) => {
      const p = post(id, items)!;
      return mediaKindOf(p, mediaContainerOf(host(id)));
    });
    expect(kinds).toEqual(['embed', 'video', 'media', null]);
  });

  it('the stylesheet hides only the container of a collapsed post', () => {
    expect(collapseCss()).toBe(
      'shreddit-post[data-rescue-media="collapsed"] > div[slot="post-media-container"] { display: none !important; }',
    );
  });

  it('words: show/hide + type, with the gallery size', () => {
    expect(mediaLabel(true, 'image')).toBe('show image');
    expect(mediaLabel(false, 'video')).toBe('hide video');
    expect(mediaLabel(true, 'gallery', 5)).toBe('show gallery (5)');
    expect(mediaLabel(true, 'gallery', 1)).toBe('show gallery');
    expect(hint.mediaToggle(true, 'image')).toMatch(/^REScue: show this post's image/);
    expect(hint.mediaToggle(false, 'image').length).toBeLessThanOrEqual(120);
    expect(hint.menuHideMedia(true)).not.toBe(hint.menuHideMedia(false));
  });
});

// --- the module on a page -----------------------------------------------------------------------

describe('inlineMedia module', () => {
  it('does nothing visible while the switch is off', async () => {
    await boot();
    for (const id of ['t3_img1', 't3_gal1', 't3_vid1', 't3_nsfw1']) {
      expect(collapsed(id)).toBe(false);
      expect(control(id)?.hidden).toBe(true);
    }
    expect(control('t3_txt1')).toBeNull();
    expect(document.getElementById('rescue-inline-media-style')?.textContent).toContain(
      'post-media-container',
    );
  });

  it('collapses every post with media when on, with a word naming each type', async () => {
    await boot({ collapseMedia: true, collapsePostMedia: true });
    for (const id of ['t3_img1', 't3_gal1', 't3_vid1', 't3_nsfw1'])
      expect(collapsed(id)).toBe(true);
    expect(collapsed('t3_txt1')).toBe(false);
    expect(control('t3_img1')?.textContent).toBe('show image');
    expect(control('t3_gal1')?.textContent).toBe('show gallery (2)');
    expect(control('t3_vid1')?.textContent).toBe('show video');
    expect(control('t3_img1')?.title).toBe(hint.mediaToggle(true, 'image'));
    expect(control('t3_img1')?.hidden).toBe(false);
  });

  it('never touches the inside of the media container', async () => {
    mount(feed(ITEMS));
    const before = host('t3_gal1').querySelector('[slot="post-media-container"]')!.outerHTML;
    const m = await bootModules([inlineMedia], {
      route,
      options: { inlineMedia: { collapseMedia: true, collapsePostMedia: true } },
    });
    m.flush();
    expect(host('t3_gal1').querySelector('[slot="post-media-container"]')!.outerHTML).toBe(before);
  });

  it('clicking the word toggles that post only', async () => {
    await boot({ collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
    control('t3_img1')!.click();
    expect(collapsed('t3_img1')).toBe(false);
    expect(control('t3_img1')?.textContent).toBe('hide image');
    expect(collapsed('t3_gal1')).toBe(true);
    control('t3_img1')!.click();
    expect(collapsed('t3_img1')).toBe(true);
  });

  it('only-types and subreddit rules decide which posts start collapsed', async () => {
    await boot({ collapseMedia: true, collapsePostMedia: true, onlyTypes: 'video' });
    expect(collapsed('t3_vid1')).toBe(true);
    expect(collapsed('t3_img1')).toBe(false);
    document.body.innerHTML = '';
    await boot({
      collapseMedia: true, collapsePostMedia: true,
      perSubreddit: [
        { subreddit: 'aww', action: 'always show' },
        { subreddit: 'pics', action: 'always collapse' },
      ],
      onlyTypes: 'video',
    });
    expect(collapsed('t3_img1')).toBe(false); // aww: always show
    expect(collapsed('t3_gal1')).toBe(true); // pics: always collapse
  });

  it('does not collapse a thread page when the scope is listings', async () => {
    await boot({ collapseMedia: true, collapsePostMedia: true }, ITEMS.slice(0, 1), { kind: 'thread', path: '/x' });
    expect(collapsed('t3_img1')).toBe(false);
    document.body.innerHTML = '';
    await boot({ collapseMedia: true, collapsePostMedia: true, scope: 'threads' }, ITEMS.slice(0, 1), {
      kind: 'thread',
      path: '/x',
    });
    expect(collapsed('t3_img1')).toBe(true);
  });

  it('remembers posts you showed and keeps them open on the next visit', async () => {
    const m = await boot({ collapseMedia: true, collapsePostMedia: true });
    control('t3_img1')!.click();
    const saved = m.moduleStore.inlineMedia!.expanded as Record<string, number>;
    expect(Object.keys(saved)).toEqual(['t3_img1']);
    m.dispose();

    // The next visit starts from what the first one stored.
    const next = await bootWithStore({ inlineMedia: { expanded: saved } });
    expect(collapsed('t3_img1')).toBe(false);
    expect(collapsed('t3_gal1')).toBe(true);
    expect(control('t3_img1')?.textContent).toBe('hide image'); // and can be put away again
    next.dispose();
  });

  it('forgets nothing and remembers nothing when the option is off', async () => {
    const m = await boot({ collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
    control('t3_img1')!.click();
    expect(m.moduleStore.inlineMedia).toBeUndefined();
  });

  it('collapsing a remembered post forgets it', async () => {
    const holder: Record<string, Record<string, unknown>> = {
      inlineMedia: { expanded: { t3_img1: Date.now() } },
    };
    const m = await bootWithStore(holder);
    control('t3_img1')!.click();
    expect(collapsed('t3_img1')).toBe(true);
    expect(m.moduleStore.inlineMedia!.expanded).toEqual({});
  });

  it('X toggles the selected post; Shift+X toggles all', async () => {
    const m = await boot({ collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
    expect(m.keys.run('toggleMedia')).toBe(false); // nothing selected: the key is left alone
    m.selection.select('t3_gal1');
    expect(m.keys.run('toggleMedia')).toBe(true);
    expect(collapsed('t3_gal1')).toBe(false);
    expect(collapsed('t3_img1')).toBe(true);
    // Some are still collapsed, so Shift+X shows them all, and then hides them all.
    expect(m.keys.run('toggleAllMedia')).toBe(true);
    for (const id of ['t3_img1', 't3_gal1', 't3_vid1', 't3_nsfw1'])
      expect(collapsed(id)).toBe(false);
    m.keys.run('toggleAllMedia');
    for (const id of ['t3_img1', 't3_gal1', 't3_vid1', 't3_nsfw1'])
      expect(collapsed(id)).toBe(true);
  });

  it('X works with the switch off (it then hides just that post) and shows its word', async () => {
    const m = await boot();
    m.selection.select('t3_img1');
    m.keys.run('toggleMedia');
    expect(collapsed('t3_img1')).toBe(true);
    expect(control('t3_img1')?.hidden).toBe(false);
    expect(control('t3_img1')?.textContent).toBe('show image');
  });

  it('registers its keys with hover-able titles in the Media help section, without conflicts', async () => {
    const m = await boot();
    const mine = m.keys.list().filter((c) => c.id === 'toggleMedia' || c.id === 'toggleAllMedia');
    expect(mine.map((c) => [c.keys, c.section])).toEqual([
      [['x'], 'Media'],
      [['shift+x'], 'Media'],
    ]);
    // Neither key is taken by keyboardNav in any context (a shared key in different contexts
    // would not show up as a conflict, so compare the keys directly).
    const taken = buildCommands({
      ctx: { session: { signedIn: false, username: null } },
      sel: () => null,
      route: () => route,
      inNewTab: () => false,
      linkNumbers: () => ({ enabled: true, keys: 'digit', newTab: true }),
      openTabs: () => {},
      toggleHelp: () => {},
      helpOpen: () => false,
      closeHelp: () => {},
    } as never).flatMap((c) => c.defaultKeys);
    expect(taken).not.toContain('x');
    expect(taken).not.toContain('shift+x');
    expect(m.keys.conflicts()).toEqual({});
  });

  it('applies a change of settings live, and starts again from the rules when they change', async () => {
    const m = await boot({ collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
    control('t3_img1')!.click();
    expect(collapsed('t3_img1')).toBe(false);
    const ctx = m.ctxs.get('inlineMedia')!;
    // The menu switch turns the option off: everything is shown, and the words go away.
    inlineMedia.onSettings!({ ...ctx, options: { ...ctx.options, collapseMedia: false } } as never);
    for (const id of ['t3_img1', 't3_gal1']) expect(collapsed(id)).toBe(false);
    expect(control('t3_gal1')?.hidden).toBe(true);
    inlineMedia.onSettings!({ ...ctx, options: { ...ctx.options, collapseMedia: true, collapsePostMedia: true } } as never);
    expect(collapsed('t3_img1')).toBe(true); // your earlier choice does not outlive the change
    expect(collapsed('t3_gal1')).toBe(true);
  });

  it('puts every post back when the module is turned off', async () => {
    const m = await boot({ collapseMedia: true, collapsePostMedia: true });
    m.dispose();
    expect(collapsed('t3_img1')).toBe(false);
    expect(control('t3_img1')).toBeNull();
    expect(document.getElementById('rescue-inline-media-style')).toBeNull();
  });
});

/** Boot with a stored `expanded` map already in the module's store. */
async function bootWithStore(holder: Record<string, Record<string, unknown>>) {
  mount(feed(ITEMS));
  const m = await bootModulesWithStore(holder);
  m.flush();
  return m;
}

async function bootModulesWithStore(holder: Record<string, Record<string, unknown>>) {
  // The harness keeps module storage in `moduleStore`; seed it before init by pre-creating the
  // module context's store reader through a thin wrapper module.
  const wrapper = {
    ...inlineMedia,
    async init(ctx: Parameters<NonNullable<typeof inlineMedia.init>>[0]) {
      const seeded = {
        ...ctx,
        store: { get: async (k: string) => holder.inlineMedia?.[k], set: ctx.store.set },
      };
      await inlineMedia.init!(seeded as never);
    },
  };
  const m = await bootModules([wrapper as never], {
    route,
    options: { inlineMedia: { collapseMedia: true, collapsePostMedia: true } },
  });
  return m;
}

// --- opt-in download blocking, as the page sees it ------------------------------------------------

describe('inlineMedia download blocking (content side)', () => {
  const send = (reply: unknown) => {
    const spy = vi.spyOn(browser.runtime, 'sendMessage');
    spy.mockResolvedValue(reply as never);
    return spy;
  };
  const actions = (spy: ReturnType<typeof send>) =>
    spy.mock.calls.map((c) => ((c as unknown[])[0] as { action: string }).action);

  it('asks nothing while blocking is off', async () => {
    const spy = send({ ok: true, state: 'off' });
    await boot({ collapseMedia: true, collapsePostMedia: true });
    control('t3_img1')!.click();
    await tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it('turning blocking on asks the background (which opens the permission window)', async () => {
    const spy = send({ ok: true, state: 'needs-permission' });
    const m = await boot({ collapseMedia: true, collapsePostMedia: true });
    const ctx = m.ctxs.get('inlineMedia')!;
    inlineMedia.onSettings!({
      ...ctx,
      options: { ...ctx.options, blockDownloads: true },
    } as never);
    await tick();
    expect(actions(spy)).toEqual(['ask']);
    // A further settings change with blocking still on only checks, never re-opens the window.
    inlineMedia.onSettings!({
      ...ctx,
      options: { ...ctx.options, blockDownloads: true },
    } as never);
    await tick();
    expect(actions(spy)).toEqual(['ask', 'status']);
    // Without the permission at page load, a notice offers to ask.
    expect(m.notices.at(-1)?.message).toMatch(/needs your permission/);
  });

  it('showing media while blocked says so and offers to allow this tab or turn blocking off', async () => {
    const spy = send({ ok: true, state: 'active' });
    const m = await boot({ collapseMedia: true, collapsePostMedia: true, blockDownloads: true });
    const save = vi.fn().mockResolvedValue(undefined);
    (m.ctxs.get('inlineMedia')!.settings as { save?: unknown }).save = save;
    control('t3_img1')!.click();
    await tick();
    const note = m.notices.at(-1)!;
    expect(note.message).toBe('Downloads are blocked — turn off to load');
    expect(note.opts?.actions?.map((a) => a.label)).toEqual([
      'Allow in this tab',
      'Turn off blocking',
    ]);
    for (const a of note.opts!.actions!) expect(a.hint).toMatch(/^REScue: /);

    note.opts!.actions![0]!.run();
    await tick();
    expect(actions(spy)).toContain('allowTab');
    expect(m.notices.at(-1)?.opts?.actions?.[0]?.label).toBe('Reload');

    note.opts!.actions![1]!.run();
    await tick();
    const saved = save.mock.calls[0]![0] as { modules: Record<string, { options?: object }> };
    expect(saved.modules.inlineMedia!.options).toMatchObject({ collapseMedia: true, collapsePostMedia: true });
    expect(saved.modules.inlineMedia!.options).not.toHaveProperty('blockDownloads'); // back to off
  });

  it('says nothing about blocking when the background reports it is off', async () => {
    send({ ok: true, state: 'off' });
    const m = await boot({ collapseMedia: true, collapsePostMedia: true, blockDownloads: true });
    control('t3_img1')!.click();
    await tick();
    expect(m.notices.some((n) => /blocked/.test(n.message))).toBe(false);
  });
});
