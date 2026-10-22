/** Presets (RES presets) and custom toggles (RES customToggles). */
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext, type ModuleDefinition } from '../../core/types';
import {
  isModuleEnabled,
  saveOrNotify,
  setOption,
  type SettingsProfile,
} from '../../core/settings';

/** Modules kept on by the "Lite" preset (ids of modules that exist now or arrive in later stories). */
export const LITE = new Set([
  'settingsConsole',
  'backupAndRestore',
  'filteReddit',
  'userTagger',
  'interstitials',
]);

type Preset = 'lite' | 'classicRes' | 'cleanSlate';

export function applyPreset(
  profile: SettingsProfile,
  defs: ModuleDefinition[],
  preset: Preset,
): SettingsProfile {
  const modules = { ...profile.modules };
  for (const d of defs) {
    if (d.locked) continue;
    const enabled =
      preset === 'classicRes' ? d.enabledByDefault : preset === 'lite' ? LITE.has(d.id) : false;
    modules[d.id] = { ...(modules[d.id] ?? {}), enabled };
  }
  return { ...profile, modules };
}

/** Features that open popups, switched off by the "No popups" preset (RES: hover, RESTips, showParent, ...). */
export const POPUP_MODULES = ['hover', 'showParent', 'hoverCardActions'];

/**
 * RES noPopups: turn off the features that open popups and the tips, and leave everything else as
 * it is. The popup features keep their own options, so turning them back on restores them.
 */
export function applyNoPopups(profile: SettingsProfile, defs: ModuleDefinition[]): SettingsProfile {
  let next: SettingsProfile = {
    ...profile,
    modules: { ...profile.modules },
  };
  for (const d of defs) {
    if (!POPUP_MODULES.includes(d.id) || d.locked) continue;
    next.modules[d.id] = { ...(next.modules[d.id] ?? {}), enabled: false };
  }
  const about = defs.find((d) => d.id === 'about');
  if (about) {
    for (const name of ['showTips', 'menuItem', 'newFeatureTips'])
      if (about.options[name]) next = setOption(next, about, name, false);
  }
  return next;
}

const presetAction = (
  id: Preset | 'noPopups',
  label: string,
  confirm: string,
  apply: (p: SettingsProfile, defs: ModuleDefinition[]) => SettingsProfile = (p, defs) =>
    applyPreset(p, defs, id as Preset),
) => ({
  id,
  label,
  confirm,
  async run(ctx: ModuleContext) {
    await ctx.settings.save(apply(ctx.settings.profile(), ctx.settings.definitions()));
    ctx.notices.show(`REScue: "${label}" applied. Reload to see it.`);
  },
});

export const presets = defineModule({
  id: 'presets',
  resId: 'presets',
  category: 'core',
  title: 'Presets',
  description: 'Turn many features on or off at once. Your options inside each feature are kept.',
  enabledByDefault: true,
  options: {},
  actions: [
    presetAction('lite', 'Lite', 'Turn off everything except the essentials?'),
    presetAction('classicRes', 'Classic RES', 'Restore every feature to its default on/off state?'),
    presetAction('cleanSlate', 'Clean slate', 'Turn off every feature except this console?'),
    presetAction(
      'noPopups',
      'No popups',
      'Turn off the show-parent popup, the hover-card buttons, hover popups and the tips? Everything else stays as it is.',
      applyNoPopups,
    ),
  ],
});

/** Named on/off switches; other modules (e.g. filteReddit rules) can be tied to them. */
export function customToggleOn(profile: SettingsProfile, name: string): boolean {
  const rows = (profile.modules.customToggles?.options?.toggles ?? []) as Array<{
    name?: string;
    enabled?: boolean;
  }>;
  if (!isModuleEnabled(customToggles, profile)) return true;
  const row = rows.find((r) => r.name === name);
  return row ? row.enabled !== false : true;
}

interface ToggleRow {
  name?: string;
  enabled?: boolean;
}

const toggleRows = (profile: SettingsProfile): ToggleRow[] =>
  (profile.modules.customToggles?.options?.toggles ?? []) as ToggleRow[];

let removeItems: Array<() => void> = [];

/** One gear-menu switch per named toggle, rebuilt whenever the settings change. */
function syncMenu(ctx: ModuleContext): void {
  for (const r of removeItems) r();
  removeItems = [];
  const names = [
    ...new Set(
      toggleRows(ctx.settings.profile())
        .map((r) => r.name)
        .filter((n): n is string => !!n),
    ),
  ];
  names.forEach((name, i) => {
    removeItems.push(
      ctx.ui.addMenuItem({
        id: `customToggle:${name}`,
        label: name,
        order: 30 + i / 1000,
        hint: () => hint.menuCustomToggle(name, customToggleOn(ctx.settings.profile(), name)),
        onClick: () => {},
        toggle: {
          get: () => customToggleOn(ctx.settings.profile(), name),
          set(on) {
            const profile = ctx.settings.profile();
            const rows = toggleRows(profile).map((r) =>
              r.name === name ? { ...r, enabled: on } : r,
            );
            const def = ctx.settings.definitions().find((d) => d.id === 'customToggles');
            if (def)
              void saveOrNotify(
                ctx,
                setOption(profile, def, 'toggles', rows as Array<Record<string, unknown>>),
              );
          },
        },
      }),
    );
  });
}

export const customToggles = defineModule({
  id: 'customToggles',
  resId: 'customToggles',
  category: 'core',
  title: 'Custom toggles',
  description:
    'Named on/off switches. Filter rules can be tied to a switch so you can turn a group of them off at once. A switch that is not listed counts as on.',
  enabledByDefault: true,
  options: {
    toggles: {
      type: 'table',
      default: [],
      title: 'Switches',
      columns: [
        { key: 'name', title: 'Name', type: 'text' },
        { key: 'enabled', title: 'On', type: 'boolean' },
      ],
    },
  },
  init: syncMenu,
  onSettings: syncMenu,
  dispose() {
    for (const r of removeItems) r();
    removeItems = [];
  },
});
