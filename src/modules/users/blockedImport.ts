/**
 * Import Reddit's blocked users as ignored (userTagger). Reads the users you blocked on Reddit
 * from its own read-only /prefs/blocked.json (same origin, your session, only when you press the
 * action; PRIVACY.md), shows who would be ignored, and only after you confirm sets `ignored` on
 * those users in REScue. Reddit's own block list is never changed. Signed out there is nothing to
 * read, so the action says so. All text is placed with the DOM builder.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { jsonFor } from '../../core/redditJson';
import type { ModuleAction, ModuleContext } from '../../core/types';
import { sanitizeTags, tagKey, type UserTags } from './tagStore';

export interface ImportPlan {
  /** Blocked users that are not ignored yet, with the casing Reddit gave. */
  toIgnore: string[];
  /** Blocked users that REScue already ignores. */
  already: number;
}

/** Who a blocked-users import would change. Your own name and repeats are left out. */
export function planImport(
  tags: UserTags,
  blocked: readonly string[],
  me: string | null,
): ImportPlan {
  const seen = new Set<string>();
  const self = me ? tagKey(me) : null;
  const toIgnore: string[] = [];
  let already = 0;
  for (const name of blocked) {
    const key = tagKey(name);
    if (!key || key === self || seen.has(key)) continue;
    seen.add(key);
    if (tags[key]?.ignored) already++;
    else toIgnore.push(name);
  }
  return { toIgnore, already };
}

const PREVIEW_ID = 'rescue-blocked-preview';
const PANEL =
  'position:fixed;z-index:2147483647;top:8vh;left:50%;transform:translateX(-50%);width:min(420px,calc(100vw - 16px));max-height:80vh;display:flex;flex-direction:column;box-sizing:border-box;padding:12px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#222);border:1px solid var(--rescue-border,#ccc);border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px system-ui,sans-serif';

export function closeBlockedPreview(): void {
  document.getElementById(PREVIEW_ID)?.remove();
}

/** Show who would be ignored; resolves true only when the reader confirms. */
export function previewImport(plan: ImportPlan): Promise<boolean> {
  closeBlockedPreview();
  return new Promise((resolve) => {
    const n = plan.toIgnore.length;
    const list = h(
      'ul',
      { class: 'rescue-blocked-list', title: hint.blockedPreview },
      ...plan.toIgnore.map((u) => h('li', null, `u/${u}`)),
    );
    list.style.cssText = 'overflow:auto;flex:1;min-height:0;margin:8px 0;padding-left:18px';
    const ok = h(
      'button',
      { type: 'button', class: 'rescue-blocked-confirm', title: hint.blockedConfirm(n) },
      `Ignore ${n} ${n === 1 ? 'user' : 'users'}`,
    );
    const cancel = h(
      'button',
      { type: 'button', class: 'rescue-blocked-cancel', title: hint.blockedCancel },
      'Cancel',
    );
    const actions = h('div', null, ok, ' ', cancel);
    const intro = h(
      'p',
      null,
      `You blocked ${n + plan.already} users on Reddit.${plan.already ? ` REScue already ignores ${plan.already} of them.` : ''} These ${n} would be ignored in REScue; Reddit's own block list is not changed:`,
    );
    const root = h(
      'div',
      {
        id: PREVIEW_ID,
        class: 'rescue-overlay',
        role: 'dialog',
        'aria-label': 'Import blocked users',
      },
      h('strong', null, 'Import blocked users as ignored'),
      intro,
      list,
      actions,
    );
    root.style.cssText = PANEL;
    const done = (yes: boolean) => {
      root.remove();
      resolve(yes);
    };
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(false);
      e.stopPropagation();
    });
    document.body.append(root);
    cancel.focus();
  });
}

export type IgnoreUsers = (ctx: ModuleContext, names: string[]) => Promise<void>;

/** The whole flow: read, preview, confirm, apply. */
export async function runImportBlocked(ctx: ModuleContext, ignore: IgnoreUsers): Promise<void> {
  const say = (message: string, kind: 'info' | 'error' = 'info') =>
    ctx.notices.show(message, { kind, id: 'blocked-import', moduleId: ctx.moduleId });
  if (!ctx.session.signedIn)
    return say('REScue: sign in to Reddit to import the users you blocked.');
  const res = await jsonFor(ctx.notices, ctx.moduleId)('blocked', {}, { fresh: true });
  if (!res.ok) return say(`REScue: could not read your blocked users. ${res.message}`, 'error');
  const tags = sanitizeTags(await ctx.data.get<unknown>('userTags'));
  const plan = planImport(tags, res.data.names, ctx.session.username);
  if (!plan.toIgnore.length) {
    return say(
      res.data.names.length
        ? 'REScue: every user you blocked is already ignored.'
        : 'REScue: you have not blocked anyone on Reddit.',
    );
  }
  if (!(await previewImport(plan))) return;
  await ignore(ctx, plan.toIgnore);
  say(
    `REScue: ${plan.toIgnore.length} blocked ${plan.toIgnore.length === 1 ? 'user is' : 'users are'} now ignored.`,
  );
}

export const blockedImportAction = (ignore: IgnoreUsers): ModuleAction => ({
  id: 'importBlocked',
  label: 'Import Reddit’s blocked users as ignored…',
  run: (ctx) => runImportBlocked(ctx, ignore),
});
