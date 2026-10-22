/**
 * penaltyBox (RES penaltyBox): features report when you undo them (e.g. close a pop-up instantly);
 * after repeated penalties REScue suggests turning that feature off. It never turns anything off
 * by itself. Features start reporting penalties as they arrive (hover cards in US5, etc.).
 */
import { hint } from '../../core/hints';
import { saveOrNotify, setModuleEnabled } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';

const THRESHOLD = 10;
let active: ModuleContext | null = null;

/** Called by features when the reader undoes them. */
export async function penalize(moduleId: string, amount = 1): Promise<void> {
  const ctx = active;
  if (!ctx) return;
  const scores = (await ctx.store.get<Record<string, number>>('scores')) ?? {};
  const next = (scores[moduleId] ?? 0) + amount;
  scores[moduleId] = next;
  ctx.store.set('scores', scores);
  if (next >= THRESHOLD && ctx.options.suggest) {
    const def = ctx.settings.definitions().find((d) => d.id === moduleId);
    if (!def || def.locked) return;
    ctx.notices.show(`You often undo “${def.title}”. Turn it off?`, {
      id: `penalty-${moduleId}`,
      actions: [
        {
          label: 'Turn off',
          hint: hint.turnOff,
          run: () => void saveOrNotify(ctx, setModuleEnabled(ctx.settings.profile(), def, false)),
        },
        {
          label: 'Keep it',
          hint: hint.keepIt,
          run: () => ctx.store.set('scores', { ...scores, [moduleId]: -THRESHOLD }),
        },
      ],
    });
  }
}

export const penaltyBox = defineModule({
  id: 'penaltyBox',
  resId: 'penaltyBox',
  category: 'users',
  title: 'Penalty box',
  description:
    'Suggests turning off features you keep undoing. It only suggests; it never turns anything off by itself.',
  enabledByDefault: true,
  options: {
    suggest: {
      type: 'boolean',
      default: true,
      title: 'Suggest turning off features I keep undoing',
    },
  },
  init(ctx) {
    active = ctx;
  },
  dispose() {
    active = null;
  },
});
