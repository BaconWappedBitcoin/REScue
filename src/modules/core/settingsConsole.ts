/**
 * Settings console entry point (RES "menu" + "settingsNavigation"): the gear and its dropdown
 * menu, and settings deep links (`#rescue:settings/<module>`), which open the console from the
 * address bar and from any link on the page.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import { openConsole } from '../../ui/settings-console/mount';

const HASH = /^#rescue:settings(?:\/([A-Za-z0-9_-]+))?$/;
const GEAR_ACTIONS = ['menu', 'settings', 'commandLine'] as const;
type GearAction = (typeof GEAR_ACTIONS)[number];

function open(ctx: ModuleContext, target?: string) {
  openConsole(
    {
      settings: ctx.settings,
      runAction: (def, action, file) => ctx.settings.runAction(def.id, action.id, file),
    },
    target,
  );
}

/** The `#rescue:settings/...` anchor a click went through, if any (also from inside shadow roots). */
export function settingsLinkTarget(e: Event): { module?: string } | null {
  for (const node of e.composedPath()) {
    if (!(node instanceof HTMLAnchorElement)) continue;
    const m = HASH.exec(node.hash);
    if (m) return { module: m[1] };
  }
  return null;
}

function gearAction(ctx: ModuleContext): GearAction {
  const v = ctx.settings.profile().modules.settingsConsole?.options?.gearClickAction;
  return GEAR_ACTIONS.find((a) => a === v) ?? 'menu';
}

let teardown: Array<() => void> = [];

export const settingsConsole = defineModule({
  id: 'settingsConsole',
  resId: 'menu',
  category: 'core',
  title: 'Settings console',
  description:
    'The gear menu and this console. Deep links: add #rescue:settings/<module> to any Reddit URL.',
  enabledByDefault: true,
  locked: true,
  options: {
    gearClickAction: {
      type: 'enum',
      default: 'menu',
      title: 'Clicking the gear',
      values: [
        { value: 'menu', label: 'Opens the menu' },
        { value: 'settings', label: 'Opens the settings console' },
        { value: 'commandLine', label: 'Opens the command line' },
      ],
    },
  },
  init(ctx) {
    const gear = h(
      'button',
      {
        id: 'rescue-gear',
        type: 'button',
        title: hint.gear(gearAction(ctx)),
        'aria-label': 'REScue menu',
        'aria-haspopup': 'menu',
      },
      label.gear,
    );
    gear.style.cssText =
      'cursor:pointer;font-size:12px;line-height:1;background:none;border:0;padding:2px 6px';
    // The click action is a setting, so the tooltip follows it whenever the pointer arrives.
    const retitle = () => (gear.title = hint.gear(gearAction(ctx)));
    gear.addEventListener('pointerenter', retitle);
    gear.addEventListener('focus', retitle);
    gear.addEventListener('click', () => {
      const action = gearAction(ctx);
      if (action === 'settings') open(ctx);
      else if (action === 'commandLine') ctx.keys.run('toggleCmdLine');
      else ctx.ui.openMenu(gear);
    });
    ctx.ui.addHeaderTool(gear);
    teardown.push(
      ctx.ui.addMenuItem({
        id: 'settings',
        label: 'Settings console',
        order: 10,
        onClick: () => open(ctx),
        hint: () => hint.menuSettings,
        secondary: {
          label: 'Search settings',
          icon: label.search,
          onClick: () => open(ctx),
          hint: hint.menuSettingsSearch,
        },
      }),
      ctx.ui.addMenuItem({
        id: 'about',
        label: 'About REScue',
        order: 90,
        hint: () => hint.menuAbout,
        onClick: () => open(ctx, 'about'),
      }),
    );

    const fromHash = () => {
      const m = HASH.exec(location.hash);
      if (m) open(ctx, m[1]);
    };
    // Capture phase, so Reddit's router cannot swallow the click before it gets here.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const link = settingsLinkTarget(e);
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      open(ctx, link.module);
    };
    window.addEventListener('hashchange', fromHash);
    document.addEventListener('click', onClick, true);
    teardown.push(
      () => window.removeEventListener('hashchange', fromHash),
      () => document.removeEventListener('click', onClick, true),
    );
    fromHash();
  },
  dispose() {
    for (const t of teardown) t();
    teardown = [];
  },
});
