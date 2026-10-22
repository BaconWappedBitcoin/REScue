/**
 * Troubleshooter (RES troubleshooter) and About (RES version/announcements/about/RESTips/
 * onboarding, with contribute and submitIssue folded in).
 */
import { defaultProfile } from '../../core/settings';
import { removeStored, STORAGE_KEYS } from '../../core/storage/store';
import { disableForTab } from '../../core/tabDisable';
import { defineModule, type ModuleContext } from '../../core/types';
import { removeTallyOnlyTags, sanitizeTags } from '../users/tagStore';
import { compareVersions, newFeatureTips, randomTip, updateKind } from './updateNotice';
import privacyText from '../../../PRIVACY.md?raw';

/** Where the source, license and issue tracker live. */
export const REPO_URL = 'https://github.com/BaconWappedBitcoin/REScue';
/** The maintainer's donation addresses (Bitcoin bech32 and Ethereum EIP-55 checksums verified 2026-10-22). */
export const DONATE_BITCOIN = 'bc1que3qguxlvg0gkp4yqn6dju82rvqq5rmdaylj27';
export const DONATE_ETHEREUM = '0x23c46670511FfF3497A11f3ebbcdAc244b91F794';

function diagnostic(ctx: ModuleContext): string {
  const failing = ctx.settings.report().filter((r) => r.status !== 'ok' && r.status !== 'inactive');
  return JSON.stringify(
    {
      rescue: browser.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      host: location.host,
      page: ctx.route.kind,
      layout: 'native',
      modules: failing,
    },
    null,
    2,
  );
}

export const troubleshooter = defineModule({
  id: 'troubleshooter',
  resId: 'troubleshooter',
  category: 'core',
  title: 'Troubleshooter',
  description:
    'See which features this page broke, copy a diagnostic report for a bug report, or reset REScue.',
  enabledByDefault: true,
  options: {},
  actions: [
    {
      id: 'health',
      label: 'Show feature health on this page',
      run(ctx) {
        const off = ctx.settings
          .report()
          .filter((r) => r.status === 'disabled' || r.status === 'degraded');
        ctx.notices.show(
          off.length
            ? `Features affected on this page: ${off.map((r) => `${r.id} (${r.status}${r.failingContracts.length ? `: ${r.failingContracts.join(', ')}` : ''})`).join('; ')}`
            : 'All active REScue features are working on this page.',
          { id: 'health' },
        );
      },
    },
    {
      id: 'copy',
      label: 'Copy diagnostic report',
      async run(ctx) {
        // Contains no usernames, URLs paths, or settings: version, browser, host, page type, failing features.
        await navigator.clipboard.writeText(diagnostic(ctx));
        ctx.notices.show('REScue: diagnostic report copied. Paste it into your bug report.', {
          timeoutMs: 6000,
        });
      },
    },
    {
      id: 'clearCaches',
      label: 'Clear read history and hidden-comment memory',
      confirm:
        'Clear read history, collapsed comments and auto-hidden posts? Tags, filters and settings are kept.',
      async run(ctx) {
        // Through the store: a debounced write still pending would otherwise bring the data back.
        await removeStored([STORAGE_KEYS.read, STORAGE_KEYS.collapsed, STORAGE_KEYS.hiddenPosts]);
        ctx.notices.show('REScue: read history cleared.');
      },
    },
    {
      id: 'clearTags',
      label: 'Clear tags that only count my votes',
      confirm:
        'Remove the user records that hold nothing but a vote count? Tags you wrote and users you ignore are kept.',
      async run(ctx) {
        const { tags, removed } = removeTallyOnlyTags(
          sanitizeTags(await ctx.data.get<unknown>('userTags')),
        );
        if (removed) ctx.data.set('userTags', tags);
        ctx.notices.show(
          removed
            ? `REScue: removed ${removed} ${removed === 1 ? 'record' : 'records'} that only counted votes.`
            : 'REScue: there were no vote-count-only records to remove.',
        );
      },
    },
    {
      id: 'reset',
      label: 'Reset all settings',
      confirm:
        'Reset every REScue setting to its default? Tags, filters and saved comments are kept.',
      async run(ctx) {
        await ctx.settings.save(defaultProfile());
        ctx.notices.show('REScue: settings reset. Reload to apply.');
      },
    },
    {
      id: 'disableRES',
      label: 'Turn REScue off in this tab only',
      confirm:
        'Reload this tab without REScue? Other tabs and your settings are not changed; a button in this tab turns it back on.',
      run() {
        disableForTab();
        location.reload();
      },
    },
    {
      id: 'testNotifications',
      label: 'Show test notices',
      run(ctx) {
        ctx.notices.show('REScue: this is an information notice.', {
          id: 'test-info',
          timeoutMs: 8000,
        });
        ctx.notices.show('REScue: this is a warning notice.', {
          id: 'test-warning',
          kind: 'warning',
          timeoutMs: 8000,
        });
        ctx.notices.show('REScue: this is an error notice.', { id: 'test-error', kind: 'error' });
        ctx.notices.show(
          'REScue: this notice has a header, a button and a “don’t show again” box.',
          {
            id: 'test-full',
            moduleId: 'troubleshooter',
            type: 'test',
            timeoutMs: 8000,
            actions: [{ label: 'Close this', run: () => ctx.notices.dismiss('test-full') }],
          },
        );
      },
    },
  ],
});

const UPDATE_CHOICES = [
  { value: 'notification', label: 'Show a notice' },
  { value: 'none', label: 'Say nothing' },
];

export const about = defineModule({
  id: 'about',
  resId: 'about',
  category: 'core',
  title: 'About REScue',
  description:
    'REScue brings Reddit Enhancement Suite features to modern Reddit. It is free software (GPL-3.0) building on RES and Sheddit. It has no telemetry and stores everything on this device; see PRIVACY.md.',
  enabledByDefault: true,
  options: {
    showTips: { type: 'boolean', default: false, title: 'Show a tip when a page loads' },
    menuItem: {
      type: 'boolean',
      default: true,
      title: 'Put “Tips” in the REScue menu',
      description: 'Shows a different tip each time you choose it.',
    },
    newFeatureTips: {
      type: 'boolean',
      default: true,
      title: 'After an update, mention the new features',
    },
    updateNotification: {
      type: 'enum',
      default: 'notification',
      title: 'When REScue gets a new feature release (1.2.x to 1.3.0)',
      values: UPDATE_CHOICES,
    },
    patchUpdateNotification: {
      type: 'enum',
      default: 'notification',
      title: 'When REScue gets a bug-fix release (1.2.3 to 1.2.4)',
      values: UPDATE_CHOICES,
    },
  },
  links: () => [
    { label: `Version ${browser.runtime.getManifest().version}` },
    { label: 'Source code', href: REPO_URL },
    { label: 'License: GPL-3.0', href: `${REPO_URL}/blob/main/LICENSE` },
    { label: 'Report an issue', href: `${REPO_URL}/issues/new` },
    { label: 'Donate with Bitcoin:', copy: DONATE_BITCOIN },
    { label: 'Donate with Ethereum:', copy: DONATE_ETHEREUM },
    { label: 'Privacy policy', text: privacyText },
    {
      label:
        'Neutrality filter data, about 180 major outlets: Eady, Bonneau, Tucker & Nagler (2025), News Sharing on Social Media, Political Analysis 33(2), doi:10.1017/pan.2024.19, data doi:10.7910/DVN/1QMLOV, CC0 1.0',
      href: 'https://doi.org/10.7910/DVN/1QMLOV',
    },
    {
      label:
        'Neutrality filter data, all other domains: Robertson, Jiang, Joseph, Friedland, Lazer & Wilson (2018), Partisan Bias Scores for Web Domains, Harvard Dataverse, doi:10.7910/DVN/QAN5VX, CC0 1.0',
      href: 'https://doi.org/10.7910/DVN/QAN5VX',
    },
  ],
  actions: [
    {
      id: 'version',
      label: 'Show version',
      run(ctx) {
        ctx.notices.show(`REScue ${browser.runtime.getManifest().version}`, {
          id: 'version',
          timeoutMs: 5000,
        });
      },
    },
  ],
  init(ctx) {
    if (ctx.options.showTips) showTip(ctx);
    syncTipsMenu(ctx);
    // Read in the background: it must not hold up the other features' start.
    void announceUpdate(ctx).catch(() => undefined);
  },
  onSettings(ctx) {
    syncTipsMenu(ctx);
  },
  dispose() {
    removeTips?.();
    removeTips = null;
  },
});

const showTip = (ctx: ModuleContext, tip = randomTip()): void =>
  ctx.notices.show(`Tip: ${tip}`, { id: 'tip', timeoutMs: 10_000 });

let removeTips: (() => void) | null = null;

/** The “Tips” row of the REScue menu (RES RESTips menuItem). */
function syncTipsMenu(ctx: ModuleContext): void {
  removeTips?.();
  removeTips = null;
  if (ctx.options.menuItem !== true) return;
  removeTips = ctx.ui.addMenuItem({
    id: 'tips',
    label: 'Tips',
    order: 80,
    hint: () => 'REScue: show a tip about using REScue',
    onClick: () => showTip(ctx),
  });
}

/**
 * After REScue was updated, say so once (RES onboarding). The last version seen is kept on this
 * device; the first run, a downgrade and a reload say nothing. A feature release and a bug-fix
 * release each have their own choice, and new-feature tips ride along when they are on.
 */
async function announceUpdate(ctx: ModuleContext): Promise<void> {
  let now: string;
  try {
    now = browser.runtime.getManifest().version;
  } catch {
    return; // no extension runtime (a test page)
  }
  const last = await ctx.store.get<string>('lastVersion');
  if (last === now) return;
  ctx.store.set('lastVersion', compareVersions(now, last ?? '') >= 0 ? now : (last ?? now));
  if (!last) return;
  const kind = updateKind(last, now);
  if (kind === 'none') return;
  const choice =
    kind === 'patch' ? ctx.options.patchUpdateNotification : ctx.options.updateNotification;
  if (choice !== 'notification') return;
  const tips = ctx.options.newFeatureTips ? newFeatureTips(last, now) : [];
  ctx.notices.show(`REScue was updated to ${now}.${tips.length ? ` ${tips.join(' ')}` : ''}`, {
    id: 'updated',
    moduleId: 'about',
    type: 'updated',
    timeoutMs: 15_000,
    actions: [
      {
        label: 'Release notes',
        hint: 'REScue: open the list of what changed in each REScue release (opens a new tab)',
        run: () => void window.open(`${REPO_URL}/releases`, '_blank', 'noopener'),
      },
    ],
  });
}
