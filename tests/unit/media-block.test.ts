import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import {
  BLOCK_RULE_ID,
  blockRule,
  createMediaBlocker,
  MEDIA_PERMISSIONS,
  profileWantsBlocking,
  TAB_RULE_BASE,
  tabAllowRule,
  wantsBlocking,
  type BlockApi,
  type DnrLike,
  type DnrRule,
} from '../../src/core/mediaBlock';
import { shouldAsk } from '../../src/modules/listings/inlineMedia/blocking';

const settings = (options: object, enabled?: boolean) => ({
  modules: { inlineMedia: { ...(enabled === undefined ? {} : { enabled }), options } },
});
const ON = settings({ collapseMedia: true, collapsePostMedia: true, blockDownloads: true });

/** A fake declarativeNetRequest that keeps the rules it was given. */
function fakeDnr() {
  const dynamic = new Map<number, DnrRule>();
  const session = new Map<number, DnrRule>();
  const apply =
    (rules: Map<number, DnrRule>) =>
    async (o: { removeRuleIds?: number[]; addRules?: DnrRule[] }) => {
      for (const id of o.removeRuleIds ?? []) rules.delete(id);
      for (const r of o.addRules ?? []) rules.set(r.id, r);
    };
  const dnr: DnrLike = {
    updateDynamicRules: apply(dynamic),
    updateSessionRules: apply(session),
    getSessionRules: async () => [...session.values()],
  };
  return { dnr, dynamic, session };
}

function setup(over: { settings?: unknown; permission?: boolean; hasDnr?: boolean } = {}) {
  const fake = fakeDnr();
  const state = {
    settings: 'settings' in over ? over.settings : ON,
    permission: over.permission ?? true,
  };
  const openPermissionPage = vi.fn().mockResolvedValue(undefined);
  const api: BlockApi = {
    readSettings: async () => state.settings,
    hasPermission: async () => state.permission,
    dnr: () => (over.hasDnr === false ? undefined : fake.dnr),
    openPermissionPage,
  };
  return { ...fake, state, openPermissionPage, blocker: createMediaBlocker(api) };
}

describe('media block rules', () => {
  it('blocks image, media and xmlhttprequest from the redd.it hosts for reddit.com pages', () => {
    const rule = blockRule();
    expect(rule).toEqual({
      id: BLOCK_RULE_ID,
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: [
          'preview.redd.it',
          'external-preview.redd.it',
          'i.redd.it',
          'v.redd.it',
          'packaged-media.redd.it',
        ],
        resourceTypes: ['image', 'media', 'xmlhttprequest'],
        initiatorDomains: ['reddit.com'],
      },
    });
    // Nothing else is touched: no main_frame, script, stylesheet or Reddit's own hosts.
    expect(rule.condition.resourceTypes).not.toContain('main_frame');
    expect(rule.condition.requestDomains.every((d) => d.endsWith('.redd.it'))).toBe(true);
  });

  it('a tab allow rule outranks the block rule and covers one tab', () => {
    const allow = tabAllowRule(42);
    expect(allow.id).toBe(TAB_RULE_BASE + 42);
    expect(allow.action.type).toBe('allow');
    expect(allow.priority).toBeGreaterThan(blockRule().priority);
    expect(allow.condition.tabIds).toEqual([42]);
    expect(allow.condition.requestDomains).toEqual(blockRule().condition.requestDomains);
  });

  it('asks for exactly the optional permission the manifest declares', () => {
    // Chrome: declarativeNetRequest is optional. Firefox rejects that, so there the add-on holds
    // declarativeNetRequestWithHostAccess and only the media host is requested (wxt.config.ts).
    expect(MEDIA_PERMISSIONS).toEqual({
      permissions: import.meta.env.FIREFOX ? [] : ['declarativeNetRequest'],
      origins: ['*://*.redd.it/*'],
    });
  });

  it('wants blocking only while media is collapsed and the module is on', () => {
    expect(wantsBlocking({ collapseMedia: true, collapsePostMedia: true, blockDownloads: true })).toBe(true);
    expect(wantsBlocking({ collapseMedia: false, blockDownloads: true })).toBe(false);
    expect(wantsBlocking({ collapseMedia: true, collapsePostMedia: true })).toBe(false);
    expect(profileWantsBlocking(ON)).toBe(true);
    expect(
      profileWantsBlocking(settings({ collapseMedia: true, collapsePostMedia: true, blockDownloads: true }, false)),
    ).toBe(false);
    expect(profileWantsBlocking(undefined)).toBe(false);
    expect(profileWantsBlocking({ modules: {} })).toBe(false);
  });

  it('asks for the permission window only when blocking was just turned on', () => {
    expect(shouldAsk(false, true)).toBe(true);
    expect(shouldAsk(true, true)).toBe(false);
    expect(shouldAsk(true, false)).toBe(false);
    expect(shouldAsk(false, false)).toBe(false);
  });
});

describe('media blocker (background)', () => {
  it('installs the block rule when it is wanted and the permission is granted', async () => {
    const t = setup();
    expect(await t.blocker.reconcile()).toBe('active');
    expect([...t.dynamic.keys()]).toEqual([BLOCK_RULE_ID]);
    // Idempotent: a second reconcile replaces the rule, it does not add another.
    expect(await t.blocker.reconcile()).toBe('active');
    expect(t.dynamic.size).toBe(1);
  });

  it('installs nothing without the permission, and ask() opens the permission page', async () => {
    const t = setup({ permission: false });
    expect(await t.blocker.reconcile()).toBe('needs-permission');
    expect(t.dynamic.size).toBe(0);
    expect(t.openPermissionPage).not.toHaveBeenCalled();
    expect(await t.blocker.ask()).toBe('needs-permission');
    expect(t.openPermissionPage).toHaveBeenCalledTimes(1);
  });

  it('does not open the permission page when blocking is off or already granted', async () => {
    const off = setup({ settings: settings({ collapseMedia: true, collapsePostMedia: true }), permission: false });
    expect(await off.blocker.ask()).toBe('off');
    const granted = setup();
    expect(await granted.blocker.ask()).toBe('active');
    expect(off.openPermissionPage).not.toHaveBeenCalled();
    expect(granted.openPermissionPage).not.toHaveBeenCalled();
  });

  it('turning the option off removes the rules, including every tab allowance', async () => {
    const t = setup();
    await t.blocker.reconcile();
    await t.blocker.allowTab(7);
    await t.blocker.allowTab(9);
    expect(t.session.size).toBe(2);
    t.state.settings = settings({ collapseMedia: true, collapsePostMedia: true, blockDownloads: false });
    expect(await t.blocker.reconcile()).toBe('off');
    expect(t.dynamic.size).toBe(0);
    expect(t.session.size).toBe(0);
  });

  it('turning "hide inline media" off also removes the rules', async () => {
    const t = setup();
    await t.blocker.reconcile();
    t.state.settings = settings({ collapseMedia: false, blockDownloads: true });
    expect(await t.blocker.reconcile()).toBe('off');
    expect(t.dynamic.size).toBe(0);
  });

  it('copes with the optional API being absent (permission never granted or taken back)', async () => {
    const t = setup({ hasDnr: false, settings: settings({}) });
    expect(await t.blocker.reconcile()).toBe('off');
    const noApi = setup({ hasDnr: false });
    expect(await noApi.blocker.reconcile()).toBe('needs-permission');
  });

  it('allows one tab with a session rule, and drops it when the tab closes', async () => {
    const t = setup();
    expect(await t.blocker.allowTab(5)).toBe(true);
    expect(t.session.get(TAB_RULE_BASE + 5)?.condition.tabIds).toEqual([5]);
    expect(t.dynamic.has(BLOCK_RULE_ID)).toBe(true); // every other tab is still blocked
    await t.blocker.forgetTab(5);
    expect(t.session.size).toBe(0);
  });

  it('refuses to allow a tab when blocking is not on', async () => {
    const off = setup({ settings: settings({}) });
    expect(await off.blocker.allowTab(5)).toBe(false);
    const noPermission = setup({ permission: false });
    expect(await noPermission.blocker.allowTab(5)).toBe(false);
    expect(noPermission.session.size).toBe(0);
  });

  it('serialises concurrent reconciles so their rule updates never interleave', async () => {
    const t = setup();
    const results = await Promise.all([
      t.blocker.reconcile(),
      t.blocker.reconcile(),
      t.blocker.reconcile(),
    ]);
    expect(results).toEqual(['active', 'active', 'active']);
    expect(t.dynamic.size).toBe(1);
  });
});

describe('permission request page', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML =
      '<button id="allow"></button><button id="cancel"></button><div id="result"></div>';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const load = async (request: unknown) => {
    const b = browser as unknown as {
      permissions: { request: unknown };
      runtime: { sendMessage: unknown };
    };
    b.permissions = { request: vi.fn().mockResolvedValue(request) };
    const send = vi.fn().mockResolvedValue({ ok: true, state: 'active' });
    b.runtime.sendMessage = send;
    await import('../../src/entrypoints/media-permission/main');
    return { request: b.permissions.request as ReturnType<typeof vi.fn>, send };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('requests the optional permission from the click, then tells the background', async () => {
    const { request, send } = await load(true);
    expect(request).not.toHaveBeenCalled(); // nothing is asked before the click
    (document.getElementById('allow') as HTMLButtonElement).click();
    expect(request).toHaveBeenCalledWith(MEDIA_PERMISSIONS);
    await flush();
    expect(send).toHaveBeenCalledWith({ type: 'media.blocking', action: 'status' });
    expect(document.getElementById('result')?.textContent).toMatch(/now blocked/);
    expect((document.getElementById('allow') as HTMLButtonElement).title).toMatch(/^REScue: /);
  });

  it('says so when the permission is declined, and does not claim blocking', async () => {
    const { send } = await load(false);
    (document.getElementById('allow') as HTMLButtonElement).click();
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(document.getElementById('result')?.textContent).toMatch(/not given/);
  });
});
