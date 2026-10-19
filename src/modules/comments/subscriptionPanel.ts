/**
 * The "Subscriptions" panel opened from the REScue menu: every watched thread with a badge for
 * new comments, when the watch ends, and a word control to stop watching. It owns no storage; the
 * host loads and edits. All text is placed with the DOM builder, never as markup.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { listSubs, plural, type Sub, type SubMap } from './subscriptionModel';

export interface PanelHost {
  load(): Promise<SubMap>;
  unsubscribe(id: string): Promise<void>;
  clearNew(): Promise<void>;
}

const PANEL_ID = 'rescue-subscriptions';
const CSS =
  'position:fixed;z-index:2147483647;top:8vh;left:50%;transform:translateX(-50%);width:min(560px,calc(100vw - 16px));max-height:80vh;display:flex;flex-direction:column;box-sizing:border-box;padding:12px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#222);border:1px solid var(--rescue-border,#ccc);border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px system-ui,sans-serif';
const WORD =
  'background:none;border:0;padding:0 4px;font:inherit;cursor:pointer;text-decoration:underline;color:inherit';

let current: { root: HTMLElement; redraw(): void } | null = null;

export function closeSubscriptions(): void {
  current?.root.remove();
  current = null;
}

/** Redraw the panel if it is open (the host calls this when the subscriptions change). */
export function refreshSubscriptions(): void {
  current?.redraw();
}

function word(text: string, title: string): HTMLButtonElement {
  const b = h('button', { type: 'button', title }, text);
  b.style.cssText = WORD;
  return b;
}

export function openSubscriptions(host: PanelHost): void {
  closeSubscriptions();
  const list = h('div', { class: 'rescue-subs-list', title: hint.subsPanel });
  list.style.cssText = 'overflow:auto;flex:1;min-height:0';
  const clear = word(label.clear, hint.subsClear);
  const close = word(label.close, hint.subsClose);
  close.setAttribute('aria-label', 'Close');
  const head = h('div', null, h('strong', null, 'Subscriptions'), h('span', null, clear, close));
  head.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
  const root = h(
    'div',
    { id: PANEL_ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': 'Subscriptions' },
    head,
    list,
  );
  root.style.cssText = CSS;

  function row(s: Sub): HTMLElement {
    const link = h('a', { href: s.permalink, title: hint.subsRow(s.title) }, s.title);
    link.style.cssText = 'font-weight:600;word-break:break-word';
    const kids: Array<Node | string> = [link];
    if (s.newCount > 0) {
      const badge = h(
        'span',
        { class: 'rescue-subs-badge', title: hint.subsBadge(s.newCount) },
        plural(s.newCount),
      );
      badge.style.cssText =
        'margin-left:6px;padding:0 6px;border-radius:3px;font-size:11px;background:#ffd54a;color:#000';
      kids.push(badge);
    }
    const ends = new Date(s.expiresAt).toLocaleDateString();
    const meta = h(
      'div',
      { title: hint.subsExpires(ends) },
      `${s.subreddit ? `r/${s.subreddit} · ` : ''}${s.lastCount} comments · watching until ${ends}`,
    );
    meta.style.cssText = 'font-size:11px;opacity:.7';
    const un = word(label.unsubscribe, hint.subsUnsubscribe);
    un.addEventListener('click', () => void host.unsubscribe(s.id).then(redraw));
    const top = h('div', null, ...kids);
    const r = h('div', { class: 'rescue-subs-row', 'data-sub': s.id }, top, meta, un);
    r.style.cssText = 'padding:6px 0;border-bottom:1px solid var(--rescue-border,#ddd)';
    return r;
  }

  function redraw(): void {
    void host.load().then((subs) => {
      if (current?.root !== root) return;
      const rows = listSubs(subs);
      list.replaceChildren(
        ...(rows.length
          ? rows.map(row)
          : [h('p', { title: hint.subsEmpty }, 'You are not subscribed to any thread yet.')]),
      );
      clear.hidden = !rows.some((s) => s.newCount > 0);
    });
  }

  clear.addEventListener('click', () => void host.clearNew().then(redraw));
  close.addEventListener('click', closeSubscriptions);
  for (const t of ['keydown', 'keyup', 'keypress']) {
    root.addEventListener(t, (e) => {
      e.stopPropagation();
      if (t === 'keydown' && (e as KeyboardEvent).key === 'Escape') closeSubscriptions();
    });
  }
  document.body.append(root);
  current = { root, redraw };
  redraw();
  close.focus();
}
