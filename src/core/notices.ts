/**
 * Non-blocking notices (RES "notifications"). Rendered in a shadow root so page CSS cannot hide or
 * restyle them, and so they survive REScue's own layout being removed.
 *
 * Behaviour follows RES lib/modules/notifications.js (GPL-3.0, Copyright (C) the RES contributors):
 * a module header with a settings link, a per-type "don't show again" mute, a cooldown, closing
 * after a delay that pauses while the pointer is over the notice, and no duplicate messages.
 */
import { stamp } from './instance';
import { hint, label } from './hints';
import { ensureTheme } from './theme';
import type { NoticeApi, NoticeOptions } from './types';

const HOST_ID = 'rescue-notices';
const MODULE_ID = /^[A-Za-z0-9_-]+$/;
const STYLE = `
:host { all: initial; position: fixed; right: 12px; bottom: calc(var(--rescue-stack-h, 40px) + var(--rescue-nav-h, 0px) + 20px); z-index: 2147483646;
  display: flex; flex-direction: column; gap: 8px; color-scheme: var(--rescue-scheme, light); max-width: 360px; font: 13px/1.4 system-ui, sans-serif;
  pointer-events: none; }
.n { background: var(--rescue-bg, #fff); color: var(--rescue-fg, #1a1a1b); border: 1px solid var(--rescue-border, #ccc);
  border-left: 4px solid var(--rescue-accent, #336699);
  border-radius: 4px; padding: 8px 46px 8px 10px; box-shadow: 0 2px 8px var(--rescue-shadow, rgba(0,0,0,.2)); position: relative;
  pointer-events: auto; }
.n.warning { border-left-color: var(--rescue-warn, #c90); } .n.error { border-left-color: var(--rescue-danger, #c33); }
.head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 600; }
.head a { color: var(--rescue-meta, #666); text-decoration: none; }
.actions { margin-top: 6px; display: flex; gap: 6px; }
.actions button { position: static; font-size: 12px; border: 1px solid var(--rescue-accent, #336699); border-radius: 3px; padding: 2px 8px; background: var(--rescue-hover, #eef4fa); color: var(--rescue-fg, #1a1a1b); }
.mute { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 11px; color: var(--rescue-meta, #666); }
button.close { position: absolute; top: 4px; right: 6px; border: 0; background: none; cursor: pointer; font-size: 11px; color: inherit; }
`;

/** What the notice framework needs from the settings; wired up once the profile has loaded. */
export interface NoticeConfig {
  muted(): string[];
  setMuted(next: string[]): void;
  /** Close delay for info notices that set no timeout of their own; 0 keeps them open. */
  closeDelayMs(): number;
  /** How long a closing notice takes to fade away (RES fadeOutLength); 0 removes it at once. */
  fadeOutMs(): number;
  moduleTitle(id: string): string | undefined;
}

export interface NoticeHost extends NoticeApi {
  configure(config: Partial<NoticeConfig>): void;
}

/** The mute key of a notice: `<moduleId or -->:<type or id>`, or undefined when it has neither. */
export function muteKey(opts: Pick<NoticeOptions, 'moduleId' | 'type' | 'id'>): string | undefined {
  const type = opts.type ?? opts.id;
  return type ? `${opts.moduleId ?? '--'}:${type}` : undefined;
}

function hostRoot(doc: Document): ShadowRoot {
  let host = doc.getElementById(HOST_ID);
  if (!host) {
    ensureTheme(doc);
    host = doc.createElement('div');
    host.id = HOST_ID;
    stamp(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);
    (doc.body ?? doc.documentElement).appendChild(host);
  }
  return host.shadowRoot!;
}

export function createNotices(doc: Document = document): NoticeHost {
  let config: Partial<NoticeConfig> = {};
  const lastShown = new Map<string, number>();
  const restarters = new WeakMap<Element, () => void>();

  const render = (message: string, opts: NoticeOptions): void => {
    const root = hostRoot(doc);
    const kind = opts.kind ?? 'info';
    const key = muteKey(opts);
    if (key && config.muted?.().includes(key)) return;
    const memo = key ?? `msg:${kind}:${message}`;
    if (opts.cooldownMs) {
      const last = lastShown.get(memo);
      if (last !== undefined && Date.now() - last < opts.cooldownMs) return;
    }
    if (opts.id) root.querySelector(`[data-id="${CSS.escape(opts.id)}"]`)?.remove();
    // The same message already on screen: keep that one, and give it a fresh close timer.
    const same = [...root.querySelectorAll<HTMLElement>('.n')].find(
      (n) => n.dataset.kind === kind && n.dataset.message === message,
    );
    if (same) {
      restarters.get(same)?.();
      return;
    }
    lastShown.set(memo, Date.now());

    const el = doc.createElement('div');
    el.className = `n ${kind}`;
    el.dataset.kind = kind;
    el.dataset.message = message;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.title = hint.noticeRoot;
    if (opts.id) {
      el.dataset.id = opts.id;
      el.setAttribute('data-rescue-notice', opts.id);
    }
    if (opts.moduleId && MODULE_ID.test(opts.moduleId)) {
      const title = config.moduleTitle?.(opts.moduleId) ?? opts.moduleId;
      const link = doc.createElement('a');
      link.href = `#rescue:settings/${opts.moduleId}`;
      link.textContent = label.settings;
      link.title = hint.noticeSettings(title);
      link.setAttribute('aria-label', `Settings for ${title}`);
      const head = doc.createElement('div');
      head.className = 'head';
      const name = doc.createElement('span');
      name.title = hint.noticeName;
      name.textContent = title;
      head.append(name, link);
      el.appendChild(head);
    }
    const body = doc.createElement('div');
    body.className = 'msg';
    body.textContent = message;
    el.appendChild(body);
    if (opts.actions?.length) {
      const bar = doc.createElement('div');
      bar.className = 'actions';
      for (const a of opts.actions) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.title = a.hint ?? hint.noticeAction(a.label);
        b.textContent = a.label;
        b.addEventListener('click', () => {
          el.remove();
          a.run();
        });
        bar.appendChild(b);
      }
      el.appendChild(bar);
    }
    if (key && kind !== 'error' && config.setMuted) {
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.className = 'mute-box';
      box.title = hint.noticeMute;
      box.addEventListener('change', () => {
        const rest = (config.muted?.() ?? []).filter((k) => k !== key);
        config.setMuted?.(box.checked ? [...rest, key] : rest);
      });
      const label = doc.createElement('label');
      label.className = 'mute';
      label.title = hint.noticeMute;
      label.append(box, doc.createTextNode(' Don’t show this again'));
      el.appendChild(label);
    }
    const close = doc.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.title = hint.noticeClose;
    close.textContent = label.close;
    close.addEventListener('click', () => el.remove());
    el.appendChild(close);
    root.appendChild(el);

    const delay = opts.timeoutMs ?? (kind === 'info' ? (config.closeDelayMs?.() ?? 0) : 0);
    if (delay > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      // After the delay the notice fades for `fadeOutMs` (RES fadeOutLength), then goes; the
      // pointer coming back during the fade brings it back to full strength.
      const start = (): void => {
        clearTimeout(timer);
        el.style.opacity = '';
        timer = setTimeout(() => {
          const fade = config.fadeOutMs?.() ?? 0;
          if (fade <= 0) return el.remove();
          el.style.transition = `opacity ${fade}ms linear`;
          el.style.opacity = '0';
          timer = setTimeout(() => el.remove(), fade);
        }, delay);
      };
      const pause = (): void => {
        clearTimeout(timer);
        el.style.transition = 'none';
        el.style.opacity = '';
      };
      el.addEventListener('mouseenter', pause);
      el.addEventListener('mouseleave', start);
      el.addEventListener('focusin', pause);
      el.addEventListener('focusout', start);
      restarters.set(el, start);
      start();
    }
  };

  return {
    configure(next) {
      config = { ...config, ...next };
    },
    show(message, opts = {}) {
      if (doc.body) render(message, opts);
      else doc.addEventListener('DOMContentLoaded', () => render(message, opts), { once: true });
    },
    dismiss(id) {
      doc
        .getElementById(HOST_ID)
        ?.shadowRoot?.querySelector(`[data-id="${CSS.escape(id)}"]`)
        ?.remove();
    },
  };
}
