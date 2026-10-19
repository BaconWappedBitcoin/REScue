/**
 * Quick toggles in the gear menu. "Hide NSFW" flips filteReddit's `hideNsfw` option, the same
 * switch as in its settings; filteReddit re-applies on the settings change, so it takes effect at
 * once (no reload).
 */
import { hint } from '../../core/hints';
import { isModuleEnabled, setModuleEnabled, setOption } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';

const SKIN_ID = 'oldRedditSkin';

function oldLookOn(ctx: ModuleContext): boolean {
  const def = ctx.settings.definitions().find((d) => d.id === SKIN_ID);
  return !!def && isModuleEnabled(def, ctx.settings.profile());
}

/** Switches the old Reddit look module on or off; the module follows the switch live (no reload). */
function setOldLook(ctx: ModuleContext, on: boolean): void {
  const def = ctx.settings.definitions().find((d) => d.id === SKIN_ID);
  if (!def) return;
  void ctx.settings.save(setModuleEnabled(ctx.settings.profile(), def, on));
}

let remove: Array<() => void> = [];

function hideNsfwOn(ctx: ModuleContext): boolean {
  return ctx.settings.profile().modules.filteReddit?.options?.hideNsfw === true;
}

function setHideNsfw(ctx: ModuleContext, on: boolean): void {
  const def = ctx.settings.definitions().find((d) => d.id === 'filteReddit');
  if (!def) return;
  void ctx.settings.save(setOption(ctx.settings.profile(), def, 'hideNsfw', on)).then(() =>
    ctx.notices.show(`Hide NSFW posts is ${on ? 'on' : 'off'}.`, {
      id: 'quick-hideNsfw',
      type: 'hideNsfw',
      moduleId: 'filteReddit',
      timeoutMs: 8000,
    }),
  );
}

export const quickToggles = defineModule({
  id: 'quickToggles',
  category: 'core',
  title: 'Quick toggles',
  description:
    'Adds quick on/off switches to the gear menu, such as hiding NSFW posts and the old Reddit look.',
  enabledByDefault: true,
  options: {},
  init(ctx) {
    remove.push(
      ctx.ui.addMenuItem({
        id: 'quick:hideNsfw',
        label: 'Hide NSFW posts',
        order: 40,
        hint: () => hint.menuHideNsfw(hideNsfwOn(ctx)),
        onClick: () => {},
        toggle: { get: () => hideNsfwOn(ctx), set: (on) => setHideNsfw(ctx, on) },
      }),
      ctx.ui.addMenuItem({
        id: 'quick:oldLook',
        label: 'Old Reddit look',
        order: 42,
        hint: () => hint.menuOldLook(oldLookOn(ctx)),
        onClick: () => {},
        toggle: { get: () => oldLookOn(ctx), set: (on) => setOldLook(ctx, on) },
      }),
    );
  },
  dispose() {
    for (const r of remove) r();
    remove = [];
  },
});
