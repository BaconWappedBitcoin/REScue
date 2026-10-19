/**
 * hoverCardActions: "tag", "ignore" and "highlight" word controls in a POST author's hover card
 * (comment authors have no card). "tag" opens the user tagger's editor, "ignore" flips the tagger's
 * ignore flag, and "highlight" adds or removes the user from User highlighting's highlighted users. The card
 * is Reddit's light-DOM `faceplate-hovercard`; REScue appends one node to its `div[slot=content]`
 * (contracts: chromeLive, verified live 2026-10-15) and puts it back when Reddit reloads the card.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { isModuleEnabled, setOption } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';
import { hoverCardContent, hoverCardUser, userHoverCards } from '../../model/chromeAnchors';
import { taggerApi } from './taggerApi';
import { tagKey } from './tagStore';
import { userHighlight } from './userHighlight';

export const HOVER_ACTIONS_CLASS = 'rescue-hover-actions';
const STYLE_ID = 'rescue-hover-actions-css';
const STYLE = `.${HOVER_ACTIONS_CLASS}{display:flex;gap:10px;padding:6px 12px;font-size:12px}
.${HOVER_ACTIONS_CLASS} button{background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:underline}
.${HOVER_ACTIONS_CLASS} button[aria-pressed="true"]{font-weight:700;text-decoration:none}`;
const SCAN_MS = 250;

interface Row {
  user: string;
  ignore: HTMLButtonElement | null;
  highlight: HTMLButtonElement | null;
}

let rows: Row[] = [];
let stops: Array<() => void> = [];

// The "highlight" word edits User highlighting's own "highlighted users" list (RES userInfo
// highlightButton), which has its own colour; the friends list is edited in settings only.
const highlightedOf = (ctx: ModuleContext): string[] => {
  const v = ctx.settings.profile().modules.userHighlight?.options?.highlighted;
  return Array.isArray(v) ? (v as string[]) : [];
};
const isHighlighted = (ctx: ModuleContext, user: string): boolean =>
  highlightedOf(ctx).some((f) => tagKey(f) === tagKey(user));

function toggleHighlight(ctx: ModuleContext, user: string): Promise<void> {
  const rest = highlightedOf(ctx).filter((f) => tagKey(f) !== tagKey(user));
  const next = isHighlighted(ctx, user) ? rest : [...rest, user];
  return ctx.settings.save(setOption(ctx.settings.profile(), userHighlight, 'highlighted', next));
}

function paint(ctx: ModuleContext): void {
  rows = rows.filter((r) => (r.ignore ?? r.highlight)?.isConnected);
  for (const r of rows) {
    if (r.ignore) {
      const on = taggerApi()?.isIgnored(r.user) === true;
      r.ignore.setAttribute('aria-pressed', String(on));
      r.ignore.title = hint.hoverIgnore(r.user, on);
    }
    if (r.highlight) {
      const on = isHighlighted(ctx, r.user);
      r.highlight.setAttribute('aria-pressed', String(on));
      r.highlight.title = hint.hoverHighlight(r.user, on);
    }
  }
}

function button(text: string, onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const b = h('button', { type: 'button' }, text);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

function addActions(ctx: ModuleContext, content: HTMLElement, user: string): void {
  const row: Row = { user, ignore: null, highlight: null };
  const box = h('div', { class: HOVER_ACTIONS_CLASS });
  const tagger = taggerApi();
  if (tagger && ctx.session?.username?.toLowerCase() !== user.toLowerCase()) {
    const tag = button(label.tag, (b) => taggerApi()?.edit(user, b));
    tag.title = hint.hoverTag(user);
    row.ignore = button(
      label.ignore,
      () =>
        void taggerApi()
          ?.toggleIgnore(user)
          .then(() => paint(ctx)),
    );
    box.append(tag, row.ignore);
  }
  if (isModuleEnabled(userHighlight, ctx.settings.profile())) {
    row.highlight = button(
      label.highlight,
      () => void toggleHighlight(ctx, user).then(() => paint(ctx)),
    );
    box.append(row.highlight);
  }
  if (!box.childElementCount) return;
  content.append(box);
  rows.push(row);
}

function scan(ctx: ModuleContext): void {
  for (const card of userHoverCards()) {
    const content = hoverCardContent(card);
    const user = hoverCardUser(card);
    if (!content || !user) continue;
    if (content.querySelector(`:scope > .${HOVER_ACTIONS_CLASS}`)) continue;
    addActions(ctx, content, user);
  }
  paint(ctx);
}

export const hoverCardActions = defineModule({
  id: 'hoverCardActions',
  category: 'users',
  title: 'Hover-card actions',
  description:
    'Adds “tag”, “ignore” and “highlight” links to the hover card Reddit shows over a post author’s name (comment authors have no card). “tag” opens the user tagger’s editor, “ignore” turns ignoring on or off, and “highlight” adds or removes the user from the highlighted users in User highlighting (their name gets its own colour). Needs those two features; a link whose feature is off is not shown.',
  enabledByDefault: true,
  dependsOn: ['userTagger', 'userHighlight'],
  options: {},

  init(ctx) {
    const style = h('style', { id: STYLE_ID }, STYLE);
    document.getElementById(STYLE_ID)?.remove();
    (document.head ?? document.documentElement).append(style);
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The card's content is re-rendered by Reddit's partial; look again after each burst of changes.
    const mo = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        scan(ctx);
      }, SCAN_MS);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    stops.push(
      () => mo.disconnect(),
      () => timer && clearTimeout(timer),
    );
    scan(ctx);
  },

  onSettings(ctx) {
    for (const c of document.querySelectorAll(`.${HOVER_ACTIONS_CLASS}`)) c.remove();
    rows = [];
    scan(ctx);
  },

  dispose() {
    for (const s of stops) s();
    stops = [];
    for (const c of document.querySelectorAll(`.${HOVER_ACTIONS_CLASS}`)) c.remove();
    document.getElementById(STYLE_ID)?.remove();
    rows = [];
  },
});
