/**
 * The "highlight" word's shared logic: it adds or removes a user in User highlighting's own
 * "highlighted users" list (RES userInfo highlightButton), which has its own colour. Used by the
 * post author's hover-card actions and by the user info card.
 */
import { setOption } from '../../core/settings';
import type { ModuleContext } from '../../core/types';
import { tagKey } from './tagStore';
import { userHighlight } from './userHighlight';

type SettingsHolder = Pick<ModuleContext, 'settings'>;

export const highlightedOf = (ctx: SettingsHolder): string[] => {
  const v = ctx.settings.profile().modules.userHighlight?.options?.highlighted;
  return Array.isArray(v) ? (v as string[]) : [];
};

export const isHighlighted = (ctx: SettingsHolder, user: string): boolean =>
  highlightedOf(ctx).some((f) => tagKey(f) === tagKey(user));

export function toggleHighlight(ctx: SettingsHolder, user: string): Promise<void> {
  const rest = highlightedOf(ctx).filter((f) => tagKey(f) !== tagKey(user));
  const next = isHighlighted(ctx, user) ? rest : [...rest, user];
  return ctx.settings.save(setOption(ctx.settings.profile(), userHighlight, 'highlighted', next));
}
