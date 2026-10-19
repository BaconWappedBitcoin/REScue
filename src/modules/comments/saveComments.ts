/**
 * saveComments (RES saveComments, US6): a "save" control on every comment that keeps a text
 * snapshot on this device, and a "Saved comments" item in REScue's menu that opens the list. This is
 * REScue's own local list; it does not touch Reddit's save. Ported in spirit from RES
 * lib/modules/saveComments.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { h, relativeTime } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { webUrl } from '../../core/tabs';
import { defineModule, type ModuleContext } from '../../core/types';
import type { Comment } from '../../model/types';
import { linkButton, onClick, panel } from './commentUi';
import {
  sanitizeSaved,
  savedList,
  snapshotOf,
  withSaved,
  withoutSaved,
  type SavedComment,
  type SavedMap,
} from './savedStore';

const PANEL_ID = 'rescue-saved-comments';
const EXPLAINED_KEY = 'explainerShown';
const EXPLAINER =
  'Saving comments: Reddit’s own “save” keeps a comment in your Reddit account, available wherever you are signed in, but the original text is lost if it is edited or deleted. “save-RES” keeps a copy of the text on this device only, and it survives an edit or deletion. Your REScue copies are listed under “Saved”.';

interface State {
  ctx: ModuleContext;
  saved: SavedMap;
  buttons: Map<string, HTMLButtonElement>;
  removeMenu: () => void;
  panel: HTMLElement | null;
  chain: Promise<void>;
}

let state: State | null = null;

function relabel(s: State): void {
  for (const [id, btn] of s.buttons) labelButton(s, id, btn);
  if (s.panel) fillPanel(s, s.panel);
}

function labelButton(s: State, id: string, btn: HTMLElement): void {
  const on = id in s.saved;
  const text = on ? 'saved-RES' : 'save-RES';
  if (btn.textContent !== text) btn.textContent = text;
  btn.setAttribute('aria-pressed', String(on));
  btn.title = hint.saveComment(on);
}

/** Once, the first time a comment is saved: what the difference from Reddit's own save is. */
async function explainOnce(s: State): Promise<void> {
  if (await s.ctx.store.get<boolean>(EXPLAINED_KEY)) return;
  s.ctx.store.set(EXPLAINED_KEY, true);
  s.ctx.notices.show(EXPLAINER, { id: 'saveRES-explainer', timeoutMs: 20000 });
}

/** Read-modify-write against storage (another tab may have changed it), one at a time. */
function mutate(s: State, change: (m: SavedMap) => SavedMap): void {
  s.saved = change(s.saved);
  relabel(s);
  s.chain = s.chain.then(async () => {
    const fresh = sanitizeSaved(await s.ctx.data.get<unknown>('savedComments'));
    s.ctx.data.set('savedComments', change(fresh));
  });
}

function toggle(s: State, c: Comment): void {
  if (c.id in s.saved) mutate(s, (m) => withoutSaved(m, c.id));
  else {
    const snap = snapshotOf(c, s.ctx.route.path, Date.now());
    mutate(s, (m) => withSaved(m, snap));
    void explainOnce(s);
  }
}

/** Keyboard (Shift+S): save the comment's text copy, or remove it. False when the feature is off. */
export function toggleSavedComment(c: Comment): boolean {
  if (!state) return false;
  toggle(state, c);
  return true;
}

function entry(s: State, c: SavedComment): HTMLElement {
  const href = webUrl(c.permalink);
  const open = href
    ? h(
        'a',
        {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'rescue-saved-open',
          title: hint.savedOpen,
        },
        'open',
      )
    : null;
  const remove = h(
    'button',
    {
      type: 'button',
      class: 'rescue-saved-remove',
      'aria-label': `unsave-RES the comment by ${c.author}`,
      title: hint.savedRemove(c.author),
    },
    'unsave-RES',
  );
  onClick(remove, () => mutate(s, (m) => withoutSaved(m, c.commentId)));
  const meta = h(
    'div',
    null,
    h('strong', null, `u/${c.author}`),
    c.subreddit ? ` in r/${c.subreddit}` : '',
    c.savedAt ? ` · saved ${relativeTime(new Date(c.savedAt))}` : '',
    ' · ',
    open,
    open ? ' · ' : null,
    remove,
  );
  meta.style.cssText = 'font-size:12px;margin-bottom:2px';
  const text = h('div', { class: 'rescue-saved-text' }, c.bodyText);
  text.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
  const item = h('li', { class: 'rescue-saved-item', 'data-comment': c.commentId }, meta, text);
  item.style.cssText = 'margin:0 0 10px;padding:0';
  return item;
}

function fillPanel(s: State, box: HTMLElement): void {
  const list = savedList(s.saved);
  const body = list.length
    ? h('ul', { class: 'rescue-saved-list' }, ...list.map((c) => entry(s, c)))
    : h('p', { class: 'rescue-saved-empty' }, 'No saved comments yet.');
  if (list.length) body.style.cssText = 'list-style:none;margin:0;padding:0';
  const close = h(
    'button',
    { type: 'button', 'aria-label': 'Close saved comments', title: hint.savedClose },
    label.close,
  );
  onClick(close, () => closePanel(s));
  const head = h('div', null, h('strong', null, 'Saved comments'), ' ', close);
  head.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';
  box.replaceChildren(head, body);
}

function closePanel(s: State): void {
  s.panel?.remove();
  s.panel = null;
}

function openPanel(s: State): void {
  if (s.panel) return closePanel(s);
  const box = panel(
    h('div', {
      id: PANEL_ID,
      role: 'dialog',
      'aria-label': 'Saved comments',
      title: hint.savedPanel,
    }),
  );
  box.style.cssText +=
    ';position:fixed;right:12px;top:64px;width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 64px - var(--rescue-stack-h,40px) - 32px);overflow:auto;z-index:2147483641;padding:8px 10px';
  s.panel = box;
  fillPanel(s, box);
  document.body.appendChild(box);
}

export const saveComments = defineModule({
  id: 'saveComments',
  resId: 'saveComments',
  category: 'comments',
  title: 'Saved comments',
  description:
    'Adds a “save-RES” link to every comment that keeps a copy of its text on this device, and a “Saved comments” item in the REScue menu that lists them (with “unsave-RES” to remove one). This is separate from Reddit’s own save, which keeps the comment in your Reddit account but not its text if it is edited or deleted. A short explanation appears the first time you save. Copies are never pruned.',
  enabledByDefault: true,
  options: {},

  async init(ctx) {
    const s: State = {
      ctx,
      saved: sanitizeSaved(await ctx.data.get<unknown>('savedComments')),
      buttons: new Map(),
      removeMenu: () => {},
      panel: null,
      chain: Promise.resolve(),
    };
    state = s;
    s.removeMenu = ctx.ui.addMenuItem({
      id: 'savedComments',
      get label() {
        const n = Object.keys(s.saved).length;
        return n ? `Saved comments (${n})` : 'Saved comments';
      },
      order: 40,
      visible: () => state === s,
      hint: () => hint.savedOpener(Object.keys(s.saved).length),
      onClick: () => openPanel(s),
    });
    relabel(s);
  },

  onItems(batch, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    for (const c of batch.comments) {
      const btn = linkButton('rescue-save-comment', 'save-RES', hint.saveComment(false));
      s.buttons.set(c.id, btn);
      onClick(btn, () => toggle(s, c));
      labelButton(s, c.id, btn);
      ctx.ui.decorate(c, 'tagline', btn);
    }
    if (s.panel) fillPanel(s, s.panel);
  },

  onRoute(_route, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    s.buttons.clear();
  },

  dispose() {
    if (state) {
      closePanel(state);
      state.removeMenu();
    }
    state = null;
  },
});
