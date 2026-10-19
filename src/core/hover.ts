/**
 * Hover popup framework (RES "hover"): one popup at a time, open delay, fade-out on mouseout,
 * optional close-on-mouseout. Content is supplied asynchronously by the caller.
 */
import { hint, label } from './hints';

export interface HoverOptions {
  openDelayMs: number;
  fadeDelayMs: number;
  fadeSpeedMs: number;
  width: number;
  closeOnMouseOut: boolean;
  /** Open above the trigger instead of below it (default below). */
  placement?: 'above' | 'below';
  /** Which popup this is, so the per-popup overrides of the hover settings can find it. */
  name?: string;
}

export const DEFAULT_HOVER: HoverOptions = {
  openDelayMs: 500,
  fadeDelayMs: 500,
  fadeSpeedMs: 200,
  width: 512,
  closeOnMouseOut: true,
};

/** The hover settings (modules/core/hoverSettings.ts): defaults for every popup, and overrides by name. */
export interface HoverConfig {
  defaults: Partial<HoverOptions>;
  instances: Record<string, Partial<HoverOptions>>;
}

let config: HoverConfig = { defaults: {}, instances: {} };

export function setHoverConfig(next: HoverConfig): void {
  config = next;
}

/**
 * What a popup actually uses. Later wins: built-in defaults, the hover settings, the options its
 * owner set to something other than the built-in default, then the override for its name.
 */
export function resolveHover(opts: HoverOptions): HoverOptions {
  const own = Object.fromEntries(
    Object.entries(opts).filter(
      ([k, v]) => v !== undefined && v !== (DEFAULT_HOVER as unknown as Record<string, unknown>)[k],
    ),
  );
  return {
    ...DEFAULT_HOVER,
    ...config.defaults,
    ...own,
    ...(opts.name ? config.instances[opts.name] : undefined),
  };
}

type Content = (signal: AbortSignal) => Promise<Node | string | null>;

export class HoverManager {
  private popup: HTMLElement | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private anchor: Element | null = null;

  constructor(
    private opts: HoverOptions = DEFAULT_HOVER,
    private readonly doc: Document = document,
  ) {}

  private get cur(): HoverOptions {
    return resolveHover(this.opts);
  }

  configure(opts: Partial<HoverOptions>): void {
    this.opts = { ...this.opts, ...opts };
  }

  /** Wire a trigger element. Returns a disposer. */
  bind(trigger: Element, content: Content): () => void {
    const enter = () => this.scheduleOpen(trigger, content);
    const leave = () => this.scheduleClose();
    trigger.addEventListener('mouseenter', enter);
    trigger.addEventListener('mouseleave', leave);
    return () => {
      trigger.removeEventListener('mouseenter', enter);
      trigger.removeEventListener('mouseleave', leave);
      if (this.anchor === trigger) this.close();
    };
  }

  private scheduleOpen(trigger: Element, content: Content): void {
    this.cancelClose();
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = setTimeout(() => void this.open(trigger, content), this.cur.openDelayMs);
  }

  private scheduleClose(): void {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
    if (!this.cur.closeOnMouseOut || !this.popup) return;
    this.cancelClose();
    this.closeTimer = setTimeout(() => this.fadeOut(), this.cur.fadeDelayMs);
  }

  private cancelClose(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    if (this.popup) this.popup.style.opacity = '1';
  }

  async open(trigger: Element, content: Content): Promise<void> {
    this.close();
    this.anchor = trigger;
    this.abort = new AbortController();
    const pop = this.doc.createElement('div');
    pop.className = 'rescue-hover';
    pop.setAttribute('role', 'dialog');
    pop.style.cssText =
      `position:absolute;z-index:2147483645;max-width:${this.cur.width}px;box-sizing:border-box;` +
      'padding:6px 10px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);' +
      'border-radius:4px;box-shadow:0 4px 14px var(--rescue-shadow,rgba(0,0,0,.25));font:13px/1.4 system-ui,sans-serif;' +
      `transition:opacity ${this.cur.fadeSpeedMs}ms`;
    pop.textContent = 'Loading…';
    const r = trigger.getBoundingClientRect();
    pop.style.left = `${r.left + scrollX}px`;
    pop.style.top = `${r.bottom + scrollY + 4}px`;
    pop.addEventListener('mouseenter', () => this.cancelClose());
    pop.addEventListener('mouseleave', () => this.scheduleClose());
    const close = this.doc.createElement('button');
    close.type = 'button';
    close.className = 'rescue-hover-close';
    close.setAttribute('aria-label', 'Close');
    close.title = hint.hoverClose;
    close.textContent = label.close;
    close.addEventListener('click', () => this.close());
    this.doc.body.appendChild(pop);
    this.popup = pop;
    const signal = this.abort.signal;
    try {
      const body = await content(signal);
      if (signal.aborted || this.popup !== pop) return;
      pop.textContent = '';
      pop.append(close);
      if (body === null) pop.append('Nothing to show.');
      else pop.append(body);
      if (this.cur.placement === 'above') {
        pop.style.top = `${Math.max(scrollY, r.top + scrollY - pop.offsetHeight - 4)}px`;
      }
    } catch {
      if (!signal.aborted && this.popup === pop) pop.textContent = 'Info unavailable.';
    }
  }

  private fadeOut(): void {
    if (!this.popup) return;
    this.popup.style.opacity = '0';
    const pop = this.popup;
    setTimeout(() => {
      if (this.popup === pop) this.close();
    }, this.cur.fadeSpeedMs);
  }

  close(): void {
    this.abort?.abort();
    this.abort = null;
    this.popup?.remove();
    this.popup = null;
    this.anchor = null;
  }
}
