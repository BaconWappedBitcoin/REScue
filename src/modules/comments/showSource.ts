/**
 * showSource (RES sourceSnudown's "source" button): a word "source" on comments and text posts
 * that shows the item's raw Markdown in a small REScue popup, with "copy" and "close" (Escape
 * closes too). The page has no Markdown, only Reddit's HTML, so the text comes from Reddit's
 * read-only thread JSON for the one clicked item (same origin, your session, raw_json=1 so `&amp;`
 * and friends come back as typed; PRIVACY.md), and only when you click: `/comments/<post>.json`
 * for a post's `selftext`, `/comments/<post>/_/<comment>.json` for a comment's `body`. (It used
 * /api/info.json until Reddit stopped serving that, live 2026-10-21: HTTP 403 while signed in.)
 * Signed out it asks nothing.
 *
 * In Reddit's normal layout the word is a chip in the item's tagline; the Old Reddit look draws its
 * own "source" word in its flat link row (oldSkin/comment.ts, oldSkin/post.ts) while this module is
 * on, and its stylesheet hides the chip there. Ported in spirit from RES
 * lib/modules/sourceSnudown.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { rescueButton } from '../../core/buttons';
import { h } from '../../core/dom';
import { jsonFor, type BoundGetJson } from '../../core/redditJson';
import { moduleOn } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';
import { onClick } from './commentUi';
import { deepActive, trapFocus } from './commentTools/focusTrap';

export const SOURCE_MODULE_ID = 'showSource';
export const SOURCE_POPUP_ID = 'rescue-source-popup';
/** The chip's class in Reddit's layout (the Old Reddit look hides it and shows its own word). */
export const SOURCE_CHIP_CLASS = 'rescue-source';
const TITLE = 'REScue: show the raw Markdown of this item (asks Reddit for its text)';
export const SIGNED_OUT_TEXT = 'Reddit only shares the source with signed-in readers.';
export const REFUSED_TEXT = 'Reddit refused to share this item’s text (HTTP 403).';

const FULLNAME = /^t[13]_[a-z0-9]{1,16}$/i;
const POST_FULLNAME = /^t3_[a-z0-9]{1,16}$/i;
/** Comment id -> its post's id, from the comments this module has seen (for both looks' word). */
const postOf = new Map<string, string>();

/** Whether this module is on in the current profile (the Old Reddit look asks before drawing "source"). */
export function sourceEnabled(ctx: ModuleContext): boolean {
  return moduleOn(ctx.settings, SOURCE_MODULE_ID);
}

export type SourceResult = { ok: true; text: string } | { ok: false; message: string };

const failed = (why: string): SourceResult => ({
  ok: false,
  message: `REScue could not load the source: ${why}`,
});

/**
 * The raw Markdown of one comment (`t1_…`, which needs its post's id `postId`) or post (`t3_…`),
 * read through the thread JSON (`comments`).
 */
export async function loadSource(
  id: string,
  get: BoundGetJson,
  signedIn: boolean,
  postId: string | null = null,
): Promise<SourceResult> {
  if (!FULLNAME.test(id)) return failed('this item has no Reddit id.');
  const key = id.toLowerCase();
  const isComment = key.startsWith('t1_');
  const post = isComment ? postId : id;
  if (!signedIn) return { ok: false, message: `REScue: ${SIGNED_OUT_TEXT}` };
  if (!post || !POST_FULLNAME.test(post))
    return failed('REScue does not know this comment’s post.');
  const res = isComment
    ? await get('comments', { id: post, comment: id, limit: 1, depth: 1 })
    : await get('comments', { id: post, limit: 1, depth: 0 });
  if (!res.ok) {
    if (res.reason === 'http' && /\b403\b/.test(res.message))
      return { ok: false, message: `REScue: ${REFUSED_TEXT}` };
    return failed(res.message);
  }
  const text = isComment
    ? res.data.comments.find((c) => c.id.toLowerCase() === key)?.body
    : res.data.post.id.toLowerCase() === key
      ? res.data.post.selftext
      : undefined;
  if (typeof text !== 'string') return failed('Reddit did not send this item’s text.');
  return { ok: true, text };
}

const PANEL =
  'position:fixed;z-index:2147483647;top:10vh;left:50%;transform:translateX(-50%);width:min(640px,calc(100vw - 16px));display:flex;flex-direction:column;gap:8px;box-sizing:border-box;padding:12px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#222);border:1px solid var(--rescue-border,#ccc);border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px system-ui,sans-serif';
const BOX =
  'box-sizing:border-box;width:100%;min-height:4em;max-height:60vh;resize:vertical;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:6px;background:inherit;color:inherit;border:1px solid var(--rescue-border,#ccc);border-radius:4px';

/** Lets go of the open popup's focus trap and gives the focus back to what opened it. */
let releaseFocus: (() => void) | null = null;

export function closeSourcePopup(): void {
  document.getElementById(SOURCE_POPUP_ID)?.remove();
  const release = releaseFocus;
  releaseFocus = null;
  release?.();
}

/**
 * The popup for `text` (one at a time: an open one is replaced). Tab stays inside it while it is
 * open; closing it gives the focus back to `opener` (by default whatever had it before).
 */
export function showSourcePopup(
  text: string,
  opener: HTMLElement | null = deepActive(),
): HTMLElement {
  closeSourcePopup();
  const box = h('textarea', {
    class: 'rescue-source-text',
    readonly: true,
    spellcheck: 'false',
    'aria-label': 'Source (Markdown)',
  });
  box.value = text;
  box.style.cssText = BOX;
  const copy = h(
    'button',
    { type: 'button', class: 'rescue-source-copy', title: 'REScue: copy the Markdown' },
    'copy',
  );
  const close = h(
    'button',
    { type: 'button', class: 'rescue-source-close', title: 'REScue: close (Escape)' },
    'close',
  );
  const root = h(
    'div',
    { id: SOURCE_POPUP_ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': 'Source' },
    h('strong', null, 'Source'),
    box,
    h('div', null, copy, ' ', close),
  );
  root.style.cssText = PANEL;
  const shut = (): void => {
    if (root.isConnected) closeSourcePopup();
  };
  onClick(close, shut);
  onClick(copy, () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        copy.textContent = 'copied';
        setTimeout(() => (copy.textContent = 'copy'), 1500);
      })
      .catch(() => {
        // No clipboard access: select the text so Ctrl+C copies it.
        box.select();
        copy.textContent = 'press Ctrl+C';
      });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shut();
    e.stopPropagation(); // REScue's and Reddit's shortcuts stay out of the popup
  });
  document.body.append(root);
  releaseFocus = trapFocus(root, opener);
  // As tall as the text, up to the box's 60vh limit.
  if (box.scrollHeight) box.style.height = `${box.scrollHeight + 2}px`;
  box.focus();
  return root;
}

const loading = new Set<string>();

/**
 * Load an item's Markdown and show it; a failure is a notice. Used by both looks. A comment's post
 * is `postId` when given, else the one its model carried when this module saw the comment.
 */
export async function openSourcePopup(
  id: string,
  ctx: ModuleContext,
  postId?: string | null,
  opener: HTMLElement | null = deepActive(),
): Promise<void> {
  if (loading.has(id)) return;
  loading.add(id);
  try {
    const get = jsonFor(ctx.notices, SOURCE_MODULE_ID);
    const post = postId ?? postOf.get(id) ?? null;
    const res = await loadSource(id, get, ctx.session.signedIn, post);
    if (res.ok) showSourcePopup(res.text, opener);
    else ctx.notices.show(res.message, { kind: 'error', id: 'show-source', timeoutMs: 6000 });
  } finally {
    loading.delete(id);
  }
}

function sourceChip(ctx: ModuleContext, id: string, postId?: string | null): HTMLButtonElement {
  const b = rescueButton(SOURCE_CHIP_CLASS, 'source', TITLE);
  onClick(b, () => void openSourcePopup(id, ctx, postId, b));
  return b;
}

export const showSource = defineModule({
  id: SOURCE_MODULE_ID,
  category: 'comments',
  title: 'Show source',
  description:
    'Adds a “source” word to comments and text posts. Clicking it asks Reddit for that one item’s text and shows it as the raw Markdown it was written in, with a button to copy it. Nothing is asked until you click. Needs you to be signed in to Reddit.',
  enabledByDefault: false,
  options: {},

  onItems(batch, ctx) {
    for (const c of batch.comments) {
      if (c.postId) postOf.set(c.id, c.postId);
      ctx.ui.decorate(c, 'tagline', sourceChip(ctx, c.id, c.postId));
    }
    for (const p of batch.posts) {
      if (p.type === 'text' || /^self\./.test(p.domain))
        ctx.ui.decorate(p, 'tagline', sourceChip(ctx, p.id));
    }
  },

  dispose() {
    closeSourcePopup();
    postOf.clear();
  },
});
