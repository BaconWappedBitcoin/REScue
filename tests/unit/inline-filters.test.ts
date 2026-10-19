import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOptions } from '../../src/core/settings';
import type { ModuleContext, NoticeAction } from '../../src/core/types';
import { parsePost } from '../../src/model/post';
import type { Post } from '../../src/model/types';
import { filteReddit } from '../../src/modules/listings/filteReddit';
import {
  closeFilterMenu,
  domainRule,
  isFiltered,
  menuEntries,
  openFilterMenu,
  planAdd,
  planRemove,
  subredditRule,
  userRule,
  type Row,
} from '../../src/modules/listings/filteReddit/inline';
import {
  compileRules,
  matchPost,
  type FilterRule,
} from '../../src/modules/listings/filteReddit/rules';
import { listingHtml, mount } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

const postOf = (id: string): Post =>
  parsePost(document.querySelector(`shreddit-post#${id}`)!) as Post;
const asRule = (r: Row) => r as unknown as FilterRule;

describe('menu entries', () => {
  beforeEach(() => mount(listingHtml()));

  it('a text post offers its subreddit and its author, never a domain', () => {
    const entries = menuEntries(postOf('t3_text1'));
    expect(entries.map((e) => e.label)).toEqual(['Filter r/Layoffs', 'Filter u/rockpaperblr']);
  });

  it('a link post also offers its domain', () => {
    const entries = menuEntries(postOf('t3_link1'));
    expect(entries.map((e) => e.label)).toEqual([
      'Filter r/nottheonion',
      'Filter u/kleudorian',
      'Filter example.co.uk',
    ]);
  });

  it('an image post offers its host; Reddit’s own domain is not offered', () => {
    expect(menuEntries(postOf('t3_image1')).map((e) => e.kind)).toContain('domain');
    expect(menuEntries(postOf('t3_gallery1')).map((e) => e.kind)).toEqual(['subreddit', 'user']);
  });

  it('a deleted author has no user entry', () => {
    const post = { ...postOf('t3_link1'), author: null } as Post;
    expect(menuEntries(post).map((e) => e.kind)).toEqual(['subreddit', 'domain']);
  });
});

describe('the rule each action creates', () => {
  it('subreddit: RES default, hidden everywhere except on that subreddit’s own page', () => {
    expect(subredditRule('funny')).toEqual({
      type: 'subreddit',
      pattern: 'funny',
      scope: 'except',
      subreddits: 'funny',
      enabled: true,
      toggle: '',
    });
    const { rules } = compileRules([subredditRule('Funny')]);
    const post = { subreddit: 'funny', author: 'a', title: 't', domain: 'x.com' } as Post;
    const at = (subreddit: string | undefined) =>
      matchPost(post, rules, { subreddit, toggleOn: () => true });
    expect(at('all')).not.toBeNull();
    expect(at('popular')).not.toBeNull();
    expect(at(undefined)).not.toBeNull(); // the front page
    expect(at('pics')).not.toBeNull();
    expect(at('funny')).toBeNull();
    expect(at('FUNNY')).toBeNull();
  });

  it('user and domain: everywhere', () => {
    expect(userRule('bob')).toMatchObject({ type: 'user', pattern: 'bob', scope: 'everywhere' });
    expect(domainRule('x.com')).toMatchObject({
      type: 'domain',
      pattern: 'x.com',
      scope: 'everywhere',
    });
  });
});

describe('add / remove plans', () => {
  it('adds a rule and undoes exactly that one', () => {
    const mine: Row = { type: 'keyword', pattern: 'spoilers', scope: 'everywhere' };
    const a = planAdd([mine], subredditRule('funny'))!;
    expect(a.rows).toHaveLength(2);
    const other = { ...userRule('bob') };
    // Rows added or edited since are untouched by Undo.
    expect(a.undo([...a.rows, other])).toEqual([mine, other]);
  });

  it('does not add a duplicate, whatever the case, prefix or list order', () => {
    const rows: Row[] = [
      {
        type: 'subreddit',
        pattern: 'FUNNY',
        scope: 'except',
        subreddits: 'r/Funny',
        enabled: true,
      },
    ];
    expect(planAdd(rows, subredditRule('funny'))).toBeNull();
    expect(isFiltered(rows, subredditRule('funny'))).toBe(true);
    expect(planAdd(rows, subredditRule('pics'))).not.toBeNull();
  });

  it('a disabled twin is switched on, and Undo switches it off again', () => {
    const rows: Row[] = [{ ...userRule('bob'), enabled: false }];
    const a = planAdd(rows, userRule('bob'))!;
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]!.enabled).toBe(true);
    expect(a.undo(a.rows)[0]!.enabled).toBe(false);
  });

  it('remove drops every equivalent row; Undo adds it back; nothing to remove is null', () => {
    const keep: Row = { type: 'keyword', pattern: 'x', scope: 'everywhere' };
    const rows: Row[] = [keep, { ...subredditRule('funny') }];
    const r = planRemove(rows, subredditRule('funny'))!;
    expect(r.rows).toEqual([keep]);
    expect(r.undo(r.rows).map((x) => asRule(x).pattern)).toEqual(['x', 'funny']);
    expect(planRemove([keep], subredditRule('funny'))).toBeNull();
  });
});

describe('filteReddit inline controls, live', () => {
  beforeEach(() => {
    closeFilterMenu();
    document.body.replaceChildren();
  });

  async function boot(
    rules: Row[] = [],
    route = { kind: 'all', path: '/r/all/', subreddit: 'all' },
  ) {
    mount(listingHtml());
    const m = await bootModules([filteReddit], {
      route,
      username: 'me_the_reader',
      options: { filteReddit: { rules } },
    });
    const ctx = m.ctxs.get('filteReddit')! as ModuleContext;
    let profile = ctx.settings.profile();
    const saves: unknown[] = [];
    const notices: Array<{ message: string; actions: NoticeAction[] }> = [];
    ctx.settings = {
      profile: () => profile,
      save: async (next: never) => {
        profile = next;
        saves.push(next);
      },
    } as never;
    ctx.notices = {
      show: (message, o) => notices.push({ message, actions: o?.actions ?? [] }),
      dismiss: () => {},
    };
    const savedRules = () =>
      (resolveOptions(filteReddit, profile as never).rules as Row[]).map((r) => asRule(r));
    /** What the registry does when the console (or another tab) changes the settings. */
    const settingsChanged = () => {
      (ctx as { options: unknown }).options = resolveOptions(filteReddit, profile as never);
      filteReddit.onSettings!(ctx as never);
    };
    filteReddit.onRoute!(ctx.route, ctx as never); // forget posts remembered by earlier tests
    m.flush();
    return { m, ctx, savedRules, saves, notices, settingsChanged };
  }

  const hidden = (m: Awaited<ReturnType<typeof boot>>['m'], id: string) => m.deco.hiddenReason(id);
  const choose = async (label: RegExp, postId: string) => {
    const btn = document.querySelector<HTMLButtonElement>(`#${postId} .rescue-filter-btn`)!;
    btn.click();
    const item = [...document.querySelectorAll<HTMLButtonElement>('.rescue-filter-item')].find(
      (b) => label.test(b.textContent ?? ''),
    )!;
    item.click();
    await tick();
  };

  it('puts a filter button in each post’s tagline', async () => {
    await boot();
    const btn = document.querySelector('#t3_link1 .rescue-filter-btn')!;
    expect(btn.textContent).toBe('filter…');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('filtering a subreddit hides its posts at once, saves the rule and offers Undo', async () => {
    const { m, ctx, savedRules, notices } = await boot();
    expect(hidden(m, 't3_link1')).toBeUndefined();
    await choose(/Filter r\/nottheonion/, 't3_link1');
    expect(hidden(m, 't3_link1')).toBe('subreddit: nottheonion');
    expect(hidden(m, 't3_text1')).toBeUndefined();
    expect(savedRules()).toEqual([subredditRule('nottheonion')]);
    expect(notices.at(-1)!.message).toBe('Filtered r/nottheonion.');
    expect(notices.at(-1)!.actions.map((a) => a.label)).toEqual(['Undo']);

    notices.at(-1)!.actions[0]!.run();
    await tick();
    expect(hidden(m, 't3_link1')).toBeUndefined();
    expect(savedRules()).toEqual([]);
    expect(ctx.settings.profile()).toBeTruthy();
  });

  it('filtering a user and a domain use the user / domain rules', async () => {
    const { m, savedRules } = await boot();
    await choose(/Filter u\/dogperson/, 't3_image1');
    await choose(/Filter example\.co\.uk/, 't3_link1');
    expect(savedRules()).toEqual([userRule('dogperson'), domainRule('example.co.uk')]);
    expect(hidden(m, 't3_image1')).toBe('user: dogperson');
    expect(hidden(m, 't3_link1')).toBe('domain: example.co.uk');
  });

  it('does not add the same rule twice', async () => {
    const { savedRules, saves, notices } = await boot();
    await choose(/Filter u\/dogperson/, 't3_image1');
    await choose(/Filter u\/dogperson/, 't3_image1');
    expect(savedRules()).toHaveLength(1);
    expect(saves).toHaveLength(1);
    expect(notices.at(-1)!.message).toMatch(/already filtered/i);
  });

  it('a rule changed in the console re-evaluates posts already seen, both ways', async () => {
    const { m, ctx, settingsChanged } = await boot();
    const profile = ctx.settings.profile();
    await ctx.settings.save({
      ...profile,
      modules: {
        ...profile.modules,
        filteReddit: { options: { rules: [{ ...userRule('kleudorian') }] } },
      },
    });
    settingsChanged();
    expect(hidden(m, 't3_link1')).toBe('user: kleudorian');
    await ctx.settings.save({ ...profile, modules: { ...profile.modules } });
    settingsChanged();
    expect(hidden(m, 't3_link1')).toBeUndefined();
  });

  it('Undo removes only its own rule', async () => {
    const { m, savedRules, notices } = await boot([{ ...userRule('someone'), enabled: true }]);
    await choose(/Filter r\/aww/, 't3_image1');
    await choose(/Filter u\/kleudorian/, 't3_link1');
    expect(savedRules()).toHaveLength(3);
    notices.at(-2)!.actions[0]!.run(); // the older Undo: the aww rule
    await tick();
    expect(savedRules().map((r) => r.pattern)).toEqual(['someone', 'kleudorian']);
    expect(hidden(m, 't3_image1')).toBeUndefined();
    expect(hidden(m, 't3_link1')).toBe('user: kleudorian');
  });

  it('the inlineControls option shows and hides the buttons live', async () => {
    const { ctx, settingsChanged } = await boot();
    const btn = document.querySelector<HTMLElement>('#t3_link1 .rescue-filter-btn')!;
    expect(btn.hidden).toBe(false);
    const profile = ctx.settings.profile();
    await ctx.settings.save({
      ...profile,
      modules: { ...profile.modules, filteReddit: { options: { inlineControls: false } } },
    });
    settingsChanged();
    expect(btn.hidden).toBe(true);
  });

  it('Escape closes the menu and the click does not reach Reddit’s card', async () => {
    await boot();
    let reached = false;
    document.querySelector('article')!.addEventListener('click', () => (reached = true));
    const btn = document.querySelector<HTMLButtonElement>('#t3_text1 .rescue-filter-btn')!;
    btn.click();
    expect(reached).toBe(false);
    const menu = document.querySelector('.rescue-filter-menu')!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }),
    );
    expect(document.querySelector('.rescue-filter-menu')).toBeNull();
    openFilterMenu(btn, menuEntries(postOf('t3_text1')), () => {});
    expect(document.querySelector('.rescue-filter-menu')).not.toBeNull();
  });
});

describe('subreddit page toggle', () => {
  const sub = { kind: 'subreddit', path: '/r/funny/', subreddit: 'funny' };

  async function boot(rules: Row[] = []) {
    mount(listingHtml());
    const m = await bootModules([filteReddit], { route: sub, options: { filteReddit: { rules } } });
    const ctx = m.ctxs.get('filteReddit')! as ModuleContext;
    let profile = ctx.settings.profile();
    ctx.settings = {
      profile: () => profile,
      save: async (next: never) => void (profile = next),
    } as never;
    const notices: Array<{ message: string; actions: NoticeAction[] }> = [];
    ctx.notices = {
      show: (message, o) => notices.push({ message, actions: o?.actions ?? [] }),
      dismiss: () => {},
    };
    filteReddit.onRoute!(ctx.route, ctx as never); // forget posts remembered by earlier tests
    m.flush();
    const rulesNow = () => resolveOptions(filteReddit, profile as never).rules as Row[];
    // The row in REScue's menu (the strip no longer holds it).
    const tool = () => ({
      hidden: m.menuText('filterSubreddit') === null,
      textContent: m.menuText('filterSubreddit'),
      click: () => void m.menu('filterSubreddit'),
    });
    return { m, tool, rulesNow, notices };
  }

  it('adds the RES-default rule, then removes it, with Undo each way', async () => {
    const { tool, rulesNow, notices } = await boot();
    expect(tool().hidden).toBe(false);
    expect(tool().textContent).toBe('Filter r/funny');
    tool().click();
    await tick();
    expect(rulesNow()).toEqual([subredditRule('funny')]);
    expect(tool().textContent).toBe('Stop filtering r/funny');
    expect(notices.at(-1)!.message).toBe('Filtered r/funny.');

    notices.at(-1)!.actions[0]!.run(); // Undo
    await tick();
    expect(rulesNow()).toEqual([]);
    expect(tool().textContent).toBe('Filter r/funny');

    tool().click();
    await tick();
    tool().click(); // unfilter
    await tick();
    expect(rulesNow()).toEqual([]);
    expect(notices.at(-1)!.message).toBe('Unfiltered r/funny.');
    notices.at(-1)!.actions[0]!.run();
    await tick();
    expect(rulesNow()).toEqual([subredditRule('funny')]);
  });

  it('is hidden off a subreddit page', async () => {
    mount(listingHtml());
    const m = await bootModules([filteReddit], {
      route: { kind: 'all', path: '/r/all/', subreddit: 'all' },
    });
    expect(m.menuText('filterSubreddit')).toBeNull();
  });
});
