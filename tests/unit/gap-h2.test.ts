/**
 * T147 (gap build H2): hover settings, feed pause extras, sync restore decision, update notice and
 * tips, tab disable, presets, troubleshooter actions, profile pages, dashboard, user cards, Konami.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOVER, resolveHover, setHoverConfig, HoverManager } from '../../src/core/hover';
import { decideSyncRestore, fnv1a } from '../../src/core/storage/sync';
import {
  disableForTab,
  enableForTab,
  isTabDisabled,
  showDisabledNotice,
} from '../../src/core/tabDisable';
import { defaultProfile } from '../../src/core/settings';
import { hint, label } from '../../src/core/hints';
import { MODULES } from '../../src/modules';
import { cardsFrom } from '../../src/modules/appearance/dashboardModel';
import { dashboard } from '../../src/modules/appearance/dashboard';
import { easterEgg, konamiStep, KONAMI } from '../../src/modules/appearance/easterEgg';
import {
  profileNavigator,
  sectionItems,
  sectionPath,
} from '../../src/modules/appearance/profileNavigator';
import { searchHelper, userInSubredditHref } from '../../src/modules/appearance/searchHelper';
import { applyNoPopups, POPUP_MODULES } from '../../src/modules/core/presets';
import {
  hoverConfigFrom,
  hoverSettings,
  rowOverrides,
  validateRow,
} from '../../src/modules/core/hoverSettings';
import { about, troubleshooter } from '../../src/modules/core/troubleshooter';
import {
  compareVersions,
  newFeatureTips,
  NEW_FEATURE_TIPS,
  randomTip,
  updateKind,
} from '../../src/modules/core/updateNotice';
import { feedPause } from '../../src/modules/listings/feedPause';
import {
  customLandingPath,
  profileRedirect,
  profileRedirectTarget,
} from '../../src/modules/listings/listingTweaks';
import { redditUserInfo, STYLE_ID as CARD_STYLE } from '../../src/modules/users/redditUserInfo';
import { removeTallyOnlyTags, type UserTags } from '../../src/modules/users/tagStore';
import { listingHtml, mount } from '../fixtures/pages';
import { bootModules } from './module-harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let booted: Awaited<ReturnType<typeof bootModules>> | null = null;
const boot = async (...args: Parameters<typeof bootModules>) => {
  booted = await bootModules(...args);
  // Some features read what they remembered after their first draw, so that they never hold up the start.
  await wait(5);
  return booted;
};

afterEach(() => {
  booted?.dispose();
  booted = null;
  setHoverConfig({ defaults: {}, instances: {} });
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.className = '';
  for (const s of document.head.querySelectorAll('style')) s.remove();
  sessionStorage.clear();
  location.hash = '';
});

describe('hover settings', () => {
  it('the popup uses built-in numbers, then the settings, then its own, then a named override', () => {
    expect(resolveHover(DEFAULT_HOVER)).toEqual(DEFAULT_HOVER);
    setHoverConfig({
      defaults: { openDelayMs: 100, width: 300 },
      instances: { showParent: { width: 700 } },
    });
    expect(resolveHover(DEFAULT_HOVER)).toMatchObject({ openDelayMs: 100, width: 300 });
    // The owner chose 900 itself: that beats the settings but not the per-popup override.
    expect(resolveHover({ ...DEFAULT_HOVER, openDelayMs: 900 }).openDelayMs).toBe(900);
    expect(resolveHover({ ...DEFAULT_HOVER, name: 'showParent' }).width).toBe(700);
    expect(resolveHover({ ...DEFAULT_HOVER, name: 'other' }).width).toBe(300);
  });

  it('turns the module options and table rows into a config; blank cells inherit', () => {
    const cfg = hoverConfigFrom({
      openDelay: 250,
      fadeDelay: 400,
      fadeSpeed: 100,
      width: 480,
      closeOnMouseOut: false,
      instances: [
        { popup: 'showParent', openDelay: '50', width: '', closeOnMouseOut: 'yes' },
        { popup: '', openDelay: '1' },
      ],
    });
    expect(cfg.defaults).toEqual({
      openDelayMs: 250,
      fadeDelayMs: 400,
      fadeSpeedMs: 100,
      width: 480,
      closeOnMouseOut: false,
    });
    expect(cfg.instances).toEqual({ showParent: { openDelayMs: 50, closeOnMouseOut: true } });
    expect(rowOverrides({ width: '9999', fadeSpeed: 'x' })).toEqual({});
    expect(validateRow({ width: '9999' })).toMatch(/width must be a whole number/);
    expect(validateRow({ width: '' })).toBeNull();
  });

  it('the hover module hands its options to the popup framework and takes them back when off', async () => {
    await boot([hoverSettings], { options: { hover: { openDelay: 5 } } });
    expect(resolveHover(DEFAULT_HOVER).openDelayMs).toBe(5);
    booted!.dispose();
    booted = null;
    expect(resolveHover(DEFAULT_HOVER).openDelayMs).toBe(500);
  });

  it('a HoverManager follows the settings when they change after it was made', async () => {
    const mgr = new HoverManager({ ...DEFAULT_HOVER });
    const trigger = document.createElement('span');
    document.body.append(trigger);
    setHoverConfig({ defaults: { openDelayMs: 1, closeOnMouseOut: true }, instances: {} });
    mgr.bind(trigger, async () => 'hello');
    trigger.dispatchEvent(new Event('mouseenter'));
    await wait(30);
    expect(document.querySelector('.rescue-hover')?.textContent).toContain('hello');
    mgr.close();
  });
});

describe('feed pause extras', () => {
  const POST = (id: string) =>
    `<shreddit-post id="${id}" post-title="t" permalink="/r/a/comments/${id}/x/" author="u" subreddit-name="a"></shreddit-post>`;
  const LOADER =
    '<faceplate-partial slot="load-after" id="partial-more-posts-y" loading="programmatic" src="/svc/shreddit/community-more-posts/hot/?after=t3_y"></faceplate-partial>';
  const loaderEl = () =>
    [...document.querySelectorAll('shreddit-feed faceplate-partial')].find((p) =>
      p.getAttribute('src')!.includes("more-posts"),
    )!;
  const route = { kind: 'front', path: '/' };
  // Scrolled a little: the page's first loader then counts as a scroll-triggered page.
  beforeEach(() => Object.defineProperty(window, 'scrollY', { value: 300, configurable: true }));
  afterEach(() => Object.defineProperty(window, 'scrollY', { value: 0, configurable: true }));

  it('names the state instead of the action when asked', async () => {
    mount(listingHtml());
    const m = await boot([feedPause], {
      route,
      options: { feedPause: { reversePauseIcon: true, autoLoad: false } },
    });
    expect(m.menuText('feed:pause')).toBe(label.pausedState);
    m.menu('feed:pause');
    expect(m.menuText('feed:pause')).toBe(label.autoLoadingState);
  });

  it('remembers a pause the reader chose, and a resume', async () => {
    mount(listingHtml());
    const m = await boot([feedPause], { route });
    expect(m.menuText('feed:pause')).toBe('pause');
    m.menu('feed:pause');
    expect(m.moduleStore.feedPause?.paused).toBe(true);
    expect(document.getElementById('rescue-feed-pause')).not.toBeNull();
    m.menu('feed:pause');
    expect(m.moduleStore.feedPause?.paused).toBe(false);
    expect(document.getElementById('rescue-feed-pause')).toBeNull();
  });

  it('starts paused on the next page when the pause was remembered, unless that is switched off', async () => {
    mount(listingHtml());
    await boot([feedPause], { route, moduleStored: { feedPause: { paused: true } } });
    expect(document.getElementById('rescue-feed-pause')).not.toBeNull();
    booted!.dispose();
    document.getElementById('rescue-feed-pause')?.remove();
    await boot([feedPause], {
      route,
      moduleStored: { feedPause: { paused: true } },
      options: { feedPause: { rememberPause: false } },
    });
    expect(document.getElementById('rescue-feed-pause')).toBeNull();
  });

  it('marks the first post of a loaded page "Page 2", and says when the feed has ended', async () => {
    mount(listingHtml());
    const m = await boot([feedPause], { route });
    m.flush();
    await wait(400); // the first page settles before Reddit loads the next
    const feed = document.querySelector('shreddit-feed')!;
    // Reddit loaded a page: the loader that fetched it leaves, new posts and the next loader arrive.
    loaderEl().remove();
    feed.insertAdjacentHTML('afterbegin', POST('t3_pg2a') + POST('t3_pg2b') + LOADER);
    m.flush();
    await wait(500);
    // The marker goes on the page's topmost post, whichever order the pipeline handed them over in.
    const [top, other] = [...document.querySelectorAll('shreddit-post')]
      .map((p) => p.id)
      .filter((id) => id.startsWith('t3_pg2'));
    const marks = m.deco.slot(top!, 'tagline');
    expect(marks.map((n) => n.textContent)).toEqual(['Page 2']);
    expect((marks[0] as HTMLElement).title).toBe(hint.pageMarker(2));
    expect(m.deco.slot(other!, 'tagline')).toEqual([]);
    expect(m.notices.some((n) => /end of the feed/.test(n.message))).toBe(false);
    // The last page: its loader leaves and no other comes.
    loaderEl().remove();
    feed.insertAdjacentHTML('afterbegin', POST('t3_pg3a'));
    m.flush();
    await wait(2800);
    expect(m.deco.slot('t3_pg3a', 'tagline').map((n) => n.textContent)).toEqual(['Page 3']);
    expect(m.notices.filter((n) => /end of the feed/.test(n.message))).toHaveLength(1);
  });

  it('says the feed has ended on a short feed that never had a next-page loader', async () => {
    mount(listingHtml());
    loaderEl().remove();
    const m = await boot([feedPause], { route });
    await wait(2800);
    expect(m.notices.filter((n) => /end of the feed/.test(n.message))).toHaveLength(1);
  });

  it('says nothing about the end of a feed with no posts', async () => {
    mount(listingHtml([], { empty: true }));
    const m = await boot([feedPause], { route });
    loaderEl().remove();
    await wait(2800);
    expect(m.notices.some((n) => /end of the feed/.test(n.message))).toBe(false);
  });

  it('adds no markers or notice when they are off', async () => {
    mount(listingHtml());
    const m = await boot([feedPause], {
      route,
      options: { feedPause: { pageMarkers: false, endOfFeedNotice: false } },
    });
    m.flush();
    loaderEl().remove();
    document.querySelector('shreddit-feed')!.insertAdjacentHTML('afterbegin', POST('t3_pg2a'));
    m.flush();
    await wait(2800);
    expect(m.deco.slot('t3_pg2a', 'tagline')).toEqual([]);
    expect(m.notices.some((n) => /end of the feed/.test(n.message))).toBe(false);
  });
});

describe('settings sync restore decision', () => {
  const base = { syncEnabled: true, localHash: 'aaa', remoteHash: 'bbb', warn: true } as const;
  it('asks by default, applies when told not to ask, and ignores anything not new', () => {
    expect(decideSyncRestore(base)).toBe('ask');
    expect(decideSyncRestore({ ...base, warn: false })).toBe('apply');
    expect(decideSyncRestore({ ...base, syncEnabled: false })).toBe('ignore');
    expect(decideSyncRestore({ ...base, remoteHash: null })).toBe('ignore');
    expect(decideSyncRestore({ ...base, remoteHash: 'aaa' })).toBe('ignore');
    expect(decideSyncRestore({ ...base, knownHash: 'bbb' })).toBe('ignore');
    expect(fnv1a('x')).toBe(fnv1a('x'));
  });
});

describe('update notice and tips', () => {
  it('compares versions and classifies the step', () => {
    expect(compareVersions('1.2.3', '1.2.2')).toBe(1);
    expect(compareVersions('1.2.3', '1.10.0')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('x', '1.2.3')).toBe(0);
    expect(updateKind('1.2.3', '2.0.0')).toBe('major');
    expect(updateKind('1.2.3', '1.3.0')).toBe('minor');
    expect(updateKind('1.2.3', '1.2.4')).toBe('patch');
    expect(updateKind('1.2.3', '1.2.3')).toBe('none');
    expect(updateKind('1.2.3', '1.2.2')).toBe('none');
    expect(updateKind('', '1.2.2')).toBe('none');
  });

  it('lists the feature tips an update brings, and picks a random tip', () => {
    const since = NEW_FEATURE_TIPS[0]!.since;
    expect(newFeatureTips('0.0.1', since).length).toBeGreaterThan(0);
    expect(newFeatureTips(since, since)).toEqual([]);
    expect(newFeatureTips('0.0.1', '0.0.2')).toEqual([]);
    expect(randomTip(() => 0)).toMatch(/rescue:settings/);
  });

  const bootAbout = async (version: string, stored: Record<string, unknown>, options = {}) => {
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version } as never);
    return boot([about], {
      moduleStored: { about: stored },
      options: { about: options },
    });
  };

  it('says nothing on the first run or when the version is unchanged, and remembers the version', async () => {
    const first = await bootAbout('1.0.0', {});
    expect(first.notices).toEqual([]);
    expect(first.moduleStore.about?.lastVersion).toBe('1.0.0');
    first.dispose();
    const same = await bootAbout('1.0.0', { lastVersion: '1.0.0' });
    expect(same.notices).toEqual([]);
    booted = same;
  });

  it('shows a notice after an update, per kind of release, with a release notes button', async () => {
    const minor = await bootAbout('1.1.0', { lastVersion: '1.0.0' });
    expect(minor.notices[0]?.message).toMatch(/updated to 1\.1\.0/);
    expect(minor.notices[0]?.opts?.actions?.[0]?.label).toBe('Release notes');
    expect(minor.moduleStore.about?.lastVersion).toBe('1.1.0');
    minor.dispose();
    const patchOff = await bootAbout(
      '1.0.1',
      { lastVersion: '1.0.0' },
      { patchUpdateNotification: 'none' },
    );
    expect(patchOff.notices).toEqual([]);
    expect(patchOff.moduleStore.about?.lastVersion).toBe('1.0.1');
    patchOff.dispose();
    const minorOff = await bootAbout(
      '1.2.0',
      { lastVersion: '1.1.0' },
      { updateNotification: 'none' },
    );
    expect(minorOff.notices).toEqual([]);
    minorOff.dispose();
    const patchOn = await bootAbout('1.2.1', { lastVersion: '1.2.0' });
    expect(patchOn.notices).toHaveLength(1);
    booted = patchOn;
  });

  it('does not announce a downgrade, and keeps the newer version on record', async () => {
    const m = await bootAbout('1.0.0', { lastVersion: '1.5.0' });
    expect(m.notices).toEqual([]);
    expect(m.moduleStore.about?.lastVersion).toBe('1.5.0');
  });

  it('adds the new-feature tips to the notice only when that option is on', async () => {
    const since = NEW_FEATURE_TIPS[0]!.since;
    const on = await bootAbout(since, { lastVersion: '0.0.1' });
    expect(on.notices[0]?.message).toContain(NEW_FEATURE_TIPS[0]!.text);
    on.dispose();
    const off = await bootAbout(since, { lastVersion: '0.0.1' }, { newFeatureTips: false });
    expect(off.notices[0]?.message).not.toContain(NEW_FEATURE_TIPS[0]!.text);
    booted = off;
  });

  it('puts "Tips" in the menu, which shows a tip; off by option', async () => {
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '1.0.0' } as never);
    const m = await boot([about]);
    expect(m.menuText('tips')).toBe('Tips');
    m.menu('tips');
    expect(m.notices.some((n) => n.message.startsWith('Tip: '))).toBe(true);
    m.dispose();
    booted = await boot([about], { options: { about: { menuItem: false } } });
    expect(booted.menuText('tips')).toBeNull();
  });
});

describe('disable REScue in this tab', () => {
  it('keeps a flag for the tab and removes it again', () => {
    expect(isTabDisabled()).toBe(false);
    disableForTab();
    expect(isTabDisabled()).toBe(true);
    enableForTab();
    expect(isTabDisabled()).toBe(false);
    expect(isTabDisabled(undefined)).toBe(false);
  });

  it('leaves one note with a button that turns it back on', () => {
    showDisabledNotice();
    showDisabledNotice();
    const hosts = document.querySelectorAll('#rescue-tab-disabled');
    expect(hosts).toHaveLength(1);
    const root = hosts[0]!.shadowRoot!;
    expect(root.textContent).toContain('REScue is off in this tab');
    expect(root.querySelector('button')!.title).toMatch(/^REScue: /);
  });

  it('is a troubleshooter button that sets the flag', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...location, reload, hash: '' });
    const m = await boot([troubleshooter]);
    const action = troubleshooter.actions!.find((a) => a.id === 'disableRES')!;
    expect(action.confirm).toMatch(/other tabs/i);
    await action.run(m.ctxs.get('troubleshooter')!);
    expect(isTabDisabled()).toBe(true);
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('troubleshooter actions', () => {
  it('clears only the records that carry a vote tally and nothing else', () => {
    const tag = (over: Partial<UserTags[string]>): UserTags[string] => ({
      username: 'x',
      votesUp: 1,
      votesDown: 0,
      voteTally: 1,
      ignored: false,
      updatedAt: 1,
      ...over,
    });
    const tags: UserTags = {
      a: tag({}),
      b: tag({ text: 'friend' }),
      c: tag({ ignored: true }),
      d: tag({ votesUp: 0, voteTally: 0 }),
    };
    const out = removeTallyOnlyTags(tags);
    expect(Object.keys(out.tags)).toEqual(['b', 'c']);
    expect(out.removed).toBe(2);
    expect(removeTallyOnlyTags({}).removed).toBe(0);
  });

  it('the clearTags action writes the trimmed tags back and says how many went', async () => {
    const m = await boot([troubleshooter], {
      stored: {
        userTags: {
          a: {
            username: 'A',
            votesUp: 2,
            votesDown: 0,
            voteTally: 2,
            ignored: false,
            updatedAt: 1,
          },
          b: {
            username: 'B',
            text: 'pal',
            votesUp: 0,
            votesDown: 0,
            voteTally: 0,
            ignored: false,
            updatedAt: 1,
          },
        },
      },
    });
    await troubleshooter
      .actions!.find((a) => a.id === 'clearTags')!
      .run(m.ctxs.get('troubleshooter')!);
    expect(Object.keys(m.store.userTags as object)).toEqual(['b']);
    expect(m.notices.at(-1)?.message).toMatch(/removed 1 record/);
  });

  it('shows one notice of each kind for testing', async () => {
    const m = await boot([troubleshooter]);
    await troubleshooter
      .actions!.find((a) => a.id === 'testNotifications')!
      .run(m.ctxs.get('troubleshooter')!);
    expect(m.notices.map((n) => n.opts?.kind ?? 'info').sort()).toEqual([
      'error',
      'info',
      'info',
      'warning',
    ]);
  });
});

describe('No popups preset', () => {
  it('turns off the popup features and the tips, leaving the rest', () => {
    const base = defaultProfile();
    base.modules.feedPause = { enabled: true };
    const out = applyNoPopups(base, MODULES);
    for (const id of POPUP_MODULES) expect(out.modules[id]?.enabled, id).toBe(false);
    expect(out.modules.feedPause?.enabled).toBe(true);
    expect(out.modules.about?.options?.menuItem).toBe(false);
    expect(out.modules.about?.options?.newFeatureTips).toBe(false);
    // showTips is already off by default, so nothing is stored for it.
    expect(out.modules.about?.options?.showTips).toBeUndefined();
    const ids = new Set(MODULES.map((d) => d.id));
    for (const id of POPUP_MODULES) expect(ids.has(id), id).toBe(true);
  });
});

describe('profile pages', () => {
  const profile = { kind: 'profile', path: '/user/bob', username: 'bob' } as const;
  it('reads a custom landing page safely', () => {
    expect(customLandingPath('saved')).toBe('saved');
    expect(customLandingPath(' /upvoted/ ')).toBe('upvoted');
    expect(customLandingPath('a/b')).toBe('a/b');
    expect(customLandingPath('../x')).toBeNull();
    expect(customLandingPath('a?b=1')).toBeNull();
    expect(customLandingPath('http://x.test')).toBeNull();
    expect(customLandingPath('')).toBeNull();
  });

  it('redirects a bare profile to the custom page only when one is set', () => {
    expect(profileRedirectTarget(profile as never, 'custom', 'saved')).toBe('/user/bob/saved/');
    expect(profileRedirectTarget(profile as never, 'custom', '')).toBeNull();
    expect(profileRedirectTarget(profile as never, 'custom', '../x')).toBeNull();
    expect(
      profileRedirectTarget({ ...profile, path: '/user/bob/comments' } as never, 'custom', 'saved'),
    ).toBeNull();
    expect(profileRedirectTarget(profile as never, 'comments')).toBe('/user/bob/comments/');
    expect(profileRedirect.options.customFromLandingPage.default).toBe('');
  });

  it('lists your own pages in the menu when asked, from the table', async () => {
    expect(sectionPath({ url: './saved' })).toBe('saved');
    expect(sectionPath({ url: '../x' })).toBeNull();
    expect(
      sectionItems([{ label: 'mine', url: './saved' }, { url: 'bad/..' }], 'Bob Smith'),
    ).toEqual([{ label: 'mine', href: '/user/Bob%20Smith/saved/' }]);
    const off = await boot([profileNavigator], { username: 'bob' });
    expect(off.menuText('profile:0')).toBeNull();
    off.dispose();
    const on = await boot([profileNavigator], {
      username: 'bob',
      options: { profileNavigator: { sectionMenu: true } },
    });
    expect(on.menuText('profile:0')).toBe('My saved');
    on.dispose();
    booted = await boot([profileNavigator], {
      options: { profileNavigator: { sectionMenu: true } },
    });
    expect(booted.menuText('profile:0')).toBeNull(); // signed out
  });
});

describe('search a user in a subreddit', () => {
  it('builds the subreddit search for the author, and refuses a bad subreddit name', () => {
    const none = { sort: 'none', time: 'none' };
    expect(userInSubredditHref('bob', 'r/pics', none)).toBe(
      '/r/pics/search/?q=author%3Abob&restrict_sr=1',
    );
    expect(userInSubredditHref('bob', 'pics', { sort: 'new', time: 'week' })).toContain('sort=new');
    expect(userInSubredditHref('bob', 'a b', none)).toBeNull();
    expect(userInSubredditHref('bob', '', none)).toBeNull();
  });

  it('puts the box in the corner strip on a profile only, and searches on submit', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', {
      ...location,
      assign,
      replace: vi.fn(),
      href: 'https://www.reddit.com/user/bob/',
      hash: '',
    });
    const m = await boot([searchHelper], {
      route: { kind: 'profile', path: '/user/bob', username: 'bob' },
      options: { searchHelper: { userFilterBySubreddit: true } },
    });
    const form = document.querySelector<HTMLFormElement>('.rescue-user-in-sub')!;
    expect(form.textContent).toContain('search u/bob in r/');
    form.querySelector('input')!.value = 'pics';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(assign).toHaveBeenCalledWith('/r/pics/search/?q=author%3Abob&restrict_sr=1');
    m.goTo({ kind: 'front', path: '/' });
    expect(document.querySelector('.rescue-user-in-sub')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('is off by default', async () => {
    await boot([searchHelper], { route: { kind: 'profile', path: '/user/bob', username: 'bob' } });
    expect(document.querySelector('.rescue-user-in-sub')).toBeNull();
  });
});

describe('dashboard', () => {
  const o = { defaultSort: 'new', defaultSortSearch: 'top', includeShortcuts: true };
  it('turns widget rows into cards with sort links, and skips rows it cannot use', () => {
    const cards = cardsFrom(
      [
        { kind: 'subreddit', target: 'aww' },
        { kind: 'user', target: 'u/spez', label: 'Steve' },
        { kind: 'search', target: 'cat videos' },
        { kind: 'multi', target: 'u/bob/m/feed' },
        { kind: 'multi', target: 'aww' },
        { kind: 'user', target: '!!' },
        { kind: 'nope', target: 'x' },
        { kind: 'subreddit', target: '' },
      ],
      [],
      o,
    );
    expect(cards.map((c) => c.title)).toEqual([
      'r/aww',
      'Steve',
      'search: cat videos',
      'u/bob/m/feed',
    ]);
    expect(cards[0]!.href).toBe('/r/aww/new/');
    expect(cards[0]!.links.map((l) => l.text)).toEqual(['hot', 'new', 'top', 'rising']);
    expect(cards[1]!.href).toBe('/user/spez/');
    expect(cards[2]!.href).toBe('/search/?q=cat%20videos&sort=top');
    expect(cards[3]!.links[0]!.href).toBe('/user/bob/m/feed/hot/');
  });

  it('adds a card for each shortcut not already there, when asked', () => {
    const rows = [{ target: 'aww' }, { target: 'pics+cats' }, { target: 'r/all/top' }];
    const cards = cardsFrom([{ kind: 'subreddit', target: 'aww' }], rows, o);
    expect(cards.map((c) => c.href)).toEqual(['/r/aww/new/', '/r/pics+cats/new/', '/r/all/top/']);
    expect(cards[2]!.links).toEqual([]);
    expect(cardsFrom([], rows, { ...o, includeShortcuts: false })).toEqual([]);
  });

  it('opens a panel from the menu or the address, lists the cards, and closes with Escape', async () => {
    const m = await boot([dashboard], {
      options: { dashboard: { widgets: [{ kind: 'subreddit', target: 'aww' }] } },
      profileModules: { subredditManager: { options: { subreddits: [{ target: 'pics' }] } } },
    });
    expect(m.menuText('dashboard')).toBe('Dashboard');
    m.menu('dashboard');
    const panel = document.getElementById('rescue-dashboard')!;
    expect(
      [...panel.querySelectorAll('.rescue-dashboard-card')].map(
        (c) => c.querySelector('a')!.textContent,
      ),
    ).toEqual(['r/aww', 'r/pics']);
    expect(panel.querySelector<HTMLAnchorElement>('a')!.title).toMatch(/^REScue: /);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('rescue-dashboard')).toBeNull();

    const link = document.createElement('a');
    link.href = '#rescue:dashboard';
    document.body.append(link);
    link.click();
    expect(document.getElementById('rescue-dashboard')).not.toBeNull();
    panel.remove();
  });

  it('says what to do when there is nothing to show, and has no menu row when switched off', async () => {
    const m = await boot([dashboard], { options: { dashboard: { includeShortcuts: false } } });
    m.menu('dashboard');
    expect(document.getElementById('rescue-dashboard')!.textContent).toContain(
      'Nothing to show yet',
    );
    m.dispose();
    booted = await boot([dashboard], { options: { dashboard: { menuItem: false } } });
    expect(booted.menuText('dashboard')).toBeNull();
  });
});

describe('Reddit’s user cards', () => {
  it('hides the card only when asked, with a menu switch that shows it again', async () => {
    const off = await boot([redditUserInfo]);
    expect(document.getElementById(CARD_STYLE)).toBeNull();
    expect(off.menuText('redditUserInfo:cards')).toBeNull();
    off.dispose();
    const m = await boot([redditUserInfo], {
      options: { redditUserInfo: { hideAuthorTooltip: true } },
    });
    expect(document.getElementById(CARD_STYLE)!.textContent).toContain('display:none');
    expect(m.menuText('redditUserInfo:cards')).toBe('Reddit’s user cards');
    m.menu('redditUserInfo:cards');
    expect(document.getElementById(CARD_STYLE)).toBeNull();
    m.dispose();
    booted = null;
    expect(document.getElementById(CARD_STYLE)).toBeNull();
  });
});

describe('Konami code', () => {
  it('advances on the right keys, restarts on the first, and resets on a wrong one', () => {
    let p = 0;
    for (const k of KONAMI.slice(0, 5)) p = konamiStep(p, k);
    expect(p).toBe(5);
    expect(konamiStep(p, 'x')).toBe(0);
    expect(konamiStep(2, 'ArrowDown')).toBe(3);
    expect(konamiStep(2, 'ArrowUp')).toBe(1);
    expect(konamiStep(5, 'ArrowUp')).toBe(1);
    expect(konamiStep(8, 'B')).toBe(9);
  });

  it('shows a notice and a short bacon shower, ignoring typing in a box', async () => {
    const m = await boot([easterEgg]);
    const press = (key: string, target: EventTarget = document) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const input = document.createElement('input');
    document.body.append(input);
    for (const k of KONAMI) press(k, input);
    expect(m.notices).toEqual([]);
    for (const k of KONAMI) press(k);
    expect(m.notices[0]?.message).toBe('Bacon!');
    expect(document.getElementById('rescue-bacon')?.children.length).toBeGreaterThan(0);
    m.dispose();
    booted = null;
    expect(document.getElementById('rescue-bacon')).toBeNull();
  });

  it('is off by default', () => {
    expect(easterEgg.enabledByDefault).toBe(false);
    expect(dashboard.enabledByDefault).toBe(false);
  });
});
