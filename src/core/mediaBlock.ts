/**
 * Opt-in blocking of Reddit's media downloads (inlineMedia, constitution Principle I and Platform).
 * Hiding a media container does not stop images from downloading, so with the user's consent the
 * background installs one declarativeNetRequest rule that blocks image, media and xmlhttprequest
 * loads from Reddit's media hosts when the page that asks is on reddit.com. REScue only blocks: it
 * sends nothing anywhere.
 *
 * The permission (`declarativeNetRequest` plus `*.redd.it`) is optional and requested from an
 * extension page on a click, because content scripts cannot call `permissions.request`. This file
 * holds the rule building and the reconcile logic over an injected API so it can be tested; the
 * background wires it to the real browser.
 */
import { C } from '../contracts/reddit';
import { isModuleEnabled, normalizeProfile } from './settings';

/**
 * What "Block media downloads" asks for. Firefox already holds declarativeNetRequestWithHostAccess
 * (it rejects declarativeNetRequest as optional), so there only the media host is requested.
 */
export const MEDIA_PERMISSIONS = {
  permissions: import.meta.env.FIREFOX ? [] : ['declarativeNetRequest' as const],
  origins: ['*://*.redd.it/*'],
};

export const RESOURCE_TYPES = ['image', 'media', 'xmlhttprequest'];
export const BLOCK_RULE_ID = 9001;
/** Session "allow" rules for single tabs use this plus the tab id as their rule id. */
export const TAB_RULE_BASE = 100_000;

export interface DnrRule {
  id: number;
  priority: number;
  action: { type: 'block' | 'allow' };
  condition: {
    requestDomains: string[];
    resourceTypes: string[];
    initiatorDomains: string[];
    tabIds?: number[];
  };
}

function condition(): DnrRule['condition'] {
  return {
    requestDomains: [...C.mediaHosts],
    resourceTypes: [...RESOURCE_TYPES],
    initiatorDomains: [C.mediaInitiator],
  };
}

/** The one rule that blocks Reddit's media hosts for pages on reddit.com. */
export function blockRule(): DnrRule {
  return { id: BLOCK_RULE_ID, priority: 1, action: { type: 'block' }, condition: condition() };
}

/** A session rule that lets one tab download media again; it outranks the block rule. */
export function tabAllowRule(tabId: number): DnrRule {
  return {
    id: TAB_RULE_BASE + tabId,
    priority: 2,
    action: { type: 'allow' },
    condition: { ...condition(), tabIds: [tabId] },
  };
}

export interface BlockOptions {
  collapseMedia?: unknown;
  collapsePostMedia?: unknown;
  blockDownloads?: unknown;
}

/**
 * Blocking stops everything from Reddit's media servers, so it only makes sense while the posts'
 * own media is collapsed too (otherwise every post picture would be blocked, hidden or not): all
 * three options must be on.
 */
export function wantsBlocking(o: BlockOptions): boolean {
  return o.collapseMedia === true && o.collapsePostMedia === true && o.blockDownloads === true;
}

/** Does the stored settings profile ask for blocking? The module's own switch must be on too. */
export function profileWantsBlocking(settings: unknown, moduleId = 'inlineMedia'): boolean {
  const profile = normalizeProfile(settings);
  // inlineMedia is on by default; the background has no module list, so its default is named here.
  if (!isModuleEnabled({ id: moduleId, enabledByDefault: true }, profile)) return false;
  return wantsBlocking((profile.modules[moduleId]?.options ?? {}) as BlockOptions);
}

export type BlockState = 'off' | 'active' | 'needs-permission';

/** The slice of declarativeNetRequest this file uses. */
export interface DnrLike {
  updateDynamicRules(o: { removeRuleIds?: number[]; addRules?: DnrRule[] }): Promise<void>;
  updateSessionRules(o: { removeRuleIds?: number[]; addRules?: DnrRule[] }): Promise<void>;
  getSessionRules(): Promise<Array<{ id: number }>>;
}

export interface BlockApi {
  readSettings(): Promise<unknown>;
  hasPermission(): Promise<boolean>;
  /** Undefined while the permission is not granted. */
  dnr(): DnrLike | undefined;
  openPermissionPage(): Promise<void>;
}

export interface MediaBlocker {
  /** Bring the rules in line with the settings and the permission; returns the resulting state. */
  reconcile(): Promise<BlockState>;
  /** Reconcile, and when the permission is missing, open the page that asks for it. */
  ask(): Promise<BlockState>;
  /** Let one tab download media again (a session rule). Returns false when blocking is not on. */
  allowTab(tabId: number): Promise<boolean>;
  /** A tab closed: drop its allow rule. */
  forgetTab(tabId: number): Promise<void>;
}

export function createMediaBlocker(api: BlockApi): MediaBlocker {
  // One reconcile at a time, so two settings changes never interleave their rule updates.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  async function clearAll(dnr: DnrLike): Promise<void> {
    await dnr.updateDynamicRules({ removeRuleIds: [BLOCK_RULE_ID] });
    const session = await dnr.getSessionRules();
    const ids = session.map((r) => r.id).filter((id) => id >= TAB_RULE_BASE);
    if (ids.length) await dnr.updateSessionRules({ removeRuleIds: ids });
  }

  const reconcile = (): Promise<BlockState> =>
    serial(async () => {
      const want = profileWantsBlocking(await api.readSettings());
      const dnr = api.dnr();
      if (!want) {
        if (dnr) await clearAll(dnr);
        return 'off';
      }
      if (!(await api.hasPermission()) || !dnr) return 'needs-permission';
      await dnr.updateDynamicRules({ removeRuleIds: [BLOCK_RULE_ID], addRules: [blockRule()] });
      return 'active';
    });

  return {
    reconcile,
    async ask() {
      const state = await reconcile();
      if (state === 'needs-permission') await api.openPermissionPage();
      return state;
    },
    async allowTab(tabId) {
      if ((await reconcile()) !== 'active') return false;
      const dnr = api.dnr();
      if (!dnr) return false;
      const rule = tabAllowRule(tabId);
      await dnr.updateSessionRules({ removeRuleIds: [rule.id], addRules: [rule] });
      return true;
    },
    async forgetTab(tabId) {
      const dnr = api.dnr();
      if (dnr) await dnr.updateSessionRules({ removeRuleIds: [TAB_RULE_BASE + tabId] });
    },
  };
}
