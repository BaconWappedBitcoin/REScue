/**
 * The ONLY code that runs in the page's own JavaScript realm. On request it does a handful of
 * things — load a programmatic partial, press a native control (a comment's controls are looked
 * for only in its own action row), open an item's own overflow menu and press its Save / Hide row
 * (or just read it), focus or put text into Reddit's composer, press its submit — and announces
 * SPA navigations. It never reads storage, never fetches, and exposes no general eval
 * (contracts/messaging.md).
 *
 * Partial loading and the history patch are ported from Sheddit src/core/bridge.js (GPL-3.0,
 * kookaburrabarrel, cff40d7).
 */
import { C } from '../contracts/reddit';
import {
  CHANNEL_ATTR,
  NAVIGATED_EVENT,
  REF_ATTR,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  type BridgeRequest,
  type BridgeResponse,
  type Envelope,
  type MenuItemKind,
  type MenuKind,
  type NativeControl,
} from '../core/bridge-protocol';

export default defineContentScript({
  matches: ['*://www.reddit.com/*', '*://reddit.com/*', '*://sh.reddit.com/*'],
  excludeMatches: ['*://*.reddit.com/media*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const byRef = (ref: string): Element | null =>
      /^[a-z0-9-]{1,40}$/i.test(ref) ? document.querySelector(`[${REF_ATTR}="${ref}"]`) : null;

    /** querySelector that also searches open shadow roots below `root`. */
    const deepQuery = (root: Element, sel: string): Element | null => {
      const direct = root.querySelector(sel);
      if (direct) return direct;
      const stack: Element[] = [root];
      while (stack.length) {
        const el = stack.pop()!;
        const sr = (el as HTMLElement).shadowRoot;
        if (sr) {
          const hit = sr.querySelector(sel);
          if (hit) return hit;
          stack.push(...sr.querySelectorAll('*'));
        }
        stack.push(...el.children);
      }
      return null;
    };

    /** Every match below `root`, searching open shadow roots too. */
    const deepQueryAll = (root: Element, sel: string): Element[] => {
      const out: Element[] = [...root.querySelectorAll(sel)];
      const stack: Element[] = [root, ...root.querySelectorAll('*')];
      while (stack.length) {
        const sr = (stack.pop() as HTMLElement).shadowRoot;
        if (!sr) continue;
        out.push(...sr.querySelectorAll(sel));
        stack.push(...sr.querySelectorAll('*'));
      }
      return out;
    };

    const controlSelector: Partial<Record<NativeControl, string>> = {
      upvote: C.native.upvote,
      downvote: C.native.downvote,
      reply: C.native.reply,
      join: C.native.joinButton,
      share: C.native.share,
    };

    const isComment = (el: Element): boolean => el.matches(C.comment);

    /** The comment's OWN action row (a reply's row is not its parent's), or null if unhydrated. */
    const ownRow = (host: Element): Element | null => {
      for (const r of host.querySelectorAll(C.commentActions.row)) {
        if (r.closest(C.comment) === host) return r;
      }
      return null;
    };

    /**
     * Find a native control. A comment's controls are searched only inside its own action row, so a
     * nested reply's buttons are never taken for the parent's. A control that is not there yet is
     * given about a second to hydrate after the item is scrolled into view (lazy hydration).
     */
    const locate = async (
      el: Element,
      control: NativeControl,
      scrollFirst: boolean,
    ): Promise<Element | null> => {
      const comment = isComment(el);
      const sel =
        comment && control === 'reply' ? C.commentActions.replyButton : controlSelector[control];
      if (!sel) return null;
      const find = (): Element | null => {
        const root = comment ? ownRow(el) : el;
        return root ? deepQuery(root, sel) : null;
      };
      if (scrollFirst) el.scrollIntoView({ block: 'nearest' });
      let target = find();
      if (!target && !scrollFirst) el.scrollIntoView({ block: 'nearest' });
      for (let i = 0; i < 10 && !target; i++) {
        await sleep(100);
        target = find();
      }
      return target;
    };

    /** The row's vote-state attribute as -1 / 0 / 1; null when absent or not a known value. */
    const rowVoteState = (el: Element): -1 | 0 | 1 | null => {
      const v = ownRow(el)?.getAttribute(C.commentActions.voteStateAttr);
      if (v == null) return null;
      if (C.commentActions.voteStateUp.test(v)) return 1;
      if (C.commentActions.voteStateDown.test(v)) return -1;
      return C.commentActions.voteStateNone.test(v) ? 0 : null;
    };

    /** Open a comment's overflow menu and press its "Edit" item, found by its text. */
    const editComment = async (host: Element): Promise<BridgeResponse> => {
      // The row (and its menu) hydrate lazily: bring the comment into view and give it a second.
      let menu: Element | null | undefined = ownRow(host)?.querySelector(
        C.commentActions.overflowMenu,
      );
      if (!menu) host.scrollIntoView({ block: 'nearest' });
      for (let i = 0; i < 10 && !menu; i++) {
        await sleep(100);
        menu = ownRow(host)?.querySelector(C.commentActions.overflowMenu);
      }
      if (!menu) return { ok: false, error: 'not-found' };
      if (!C.commentActions.editableAttrs.some((a) => menu.hasAttribute(a))) {
        return { ok: false, error: 'not-editable' };
      }
      const trigger = deepQuery(menu, C.commentActions.overflowTrigger) as HTMLElement | null;
      if (!trigger) return { ok: false, error: 'not-found' };
      trigger.click();
      for (let i = 0; i < 10; i++) {
        await sleep(100);
        const item = deepQueryAll(menu, C.commentActions.menuItem).find((n) =>
          C.commentActions.editItemText.test(n.textContent ?? ''),
        );
        if (item) {
          (item as HTMLElement).click();
          return { ok: true };
        }
      }
      // No matching item: close the menu again rather than leave it open, and click nothing.
      if (trigger.getAttribute('aria-expanded') === 'true') trigger.click();
      return { ok: false, error: 'not-found' };
    };

    /** Item pattern: the wanted row's text, and its already-applied text. */
    const rowState = (item: MenuItemKind, text: string): 'on' | 'off' =>
      item === 'report'
        ? 'off'
        : (item === 'save' ? C.saveHide.saveOnText : C.saveHide.hideOnText).test(text)
          ? 'on'
          : 'off';

    /** Open the item's OWN overflow menu, find its Save / Hide row by text, and optionally press it. */
    const menuItemAction = async (
      host: Element,
      menu: MenuKind,
      item: MenuItemKind,
      click: boolean,
    ): Promise<BridgeResponse> => {
      const findMenu = (): Element | null =>
        menu === 'comment'
          ? (ownRow(host)?.querySelector(C.commentActions.overflowMenu) ?? null)
          : deepQuery(host, C.saveHide.postMenu);
      let box = findMenu();
      if (!box) host.scrollIntoView({ block: 'nearest' });
      for (let i = 0; i < 10 && !box; i++) {
        await sleep(100);
        box = findMenu();
      }
      if (!box) return { ok: false, error: 'not-found' };
      const trigger = (deepQuery(box, C.saveHide.trigger) ??
        deepQuery(box, C.saveHide.triggerFallback)) as HTMLElement | null;
      if (!trigger) return { ok: false, error: 'not-found' };
      const wanted =
        item === 'save'
          ? C.saveHide.saveText
          : item === 'hide'
            ? C.saveHide.hideText
            : C.saveHide.reportText;
      const findRow = (): Element | undefined =>
        deepQueryAll(box, C.saveHide.item).find((n) => wanted.test((n.textContent ?? '').trim()));
      const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
      if (!wasOpen) trigger.click();
      let row = findRow();
      for (let i = 0; i < 10 && !row; i++) {
        await sleep(100);
        row = findRow();
      }
      if (!row) {
        if (!wasOpen) trigger.click(); // close again; click nothing (fail safe)
        return { ok: false, error: 'not-found' };
      }
      const text = (row.textContent ?? '').trim();
      const state = rowState(item, text);
      if (!click) {
        if (!wasOpen) trigger.click(); // read only: close the menu again
        return { ok: true, itemState: state, itemText: text };
      }
      // A post-menu row is li[role=presentation] around the real div[role=menuitem]; only the inner
      // one acts (verified live 2026-10-16), so click it when present.
      ((row.querySelector('[role="menuitem"]') ?? row) as HTMLElement).click();
      return { ok: true, itemState: state, itemText: text };
    };

    const activeDeep = (): Element | null => {
      let a: Element | null = document.activeElement;
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
      return a;
    };

    /** Is `node` inside `host` itself, rather than inside a reply nested in it? */
    const ownedBy = (node: Element, host: Element): boolean => {
      let n: Node | null = node;
      while (n) {
        if (n === host) return true;
        if (n instanceof Element && n.matches(C.comment)) return false;
        n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode;
      }
      return false;
    };

    const focusComposer = async (host: Element): Promise<BridgeResponse> => {
      let editor: HTMLElement | null = null;
      for (let i = 0; i < 20 && !editor; i++) {
        editor =
          (deepQueryAll(host, C.composer.editor).find((n) => ownedBy(n, host)) as HTMLElement) ??
          null;
        if (!editor) await sleep(100);
      }
      if (!editor) return { ok: false, error: 'not-found' };
      editor.scrollIntoView({ block: 'nearest' });
      editor.focus();
      await sleep(50);
      const now = activeDeep();
      return { ok: true, focused: !!now && (now === editor || editor.contains(now)) };
    };

    const findOver18 = (): HTMLElement | null => {
      const host = document.querySelector(C.ageGate.host);
      if (!host) return null;
      const scope = (host as HTMLElement).shadowRoot ?? host;
      for (const b of scope.querySelectorAll('button, a[role="button"]')) {
        const text = (b.textContent ?? '').trim();
        if (C.ageGate.affirm.test(text) && !C.ageGate.decline.test(text)) return b as HTMLElement;
      }
      return null;
    };

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    async function handle(req: BridgeRequest): Promise<BridgeResponse> {
      if (req.op === 'native.click' && req.control === 'over18') {
        const btn = findOver18();
        if (!btn) return { ok: false, error: 'not-found' };
        btn.click();
        return { ok: true };
      }
      const el = byRef(req.ref);
      if (!el) return { ok: false, error: 'not-found' };
      switch (req.op) {
        case 'partial.load': {
          const fn = (el as unknown as Record<string, unknown>)[C.partialLoadMethod];
          if (typeof fn !== 'function') return { ok: false, error: 'no-method' };
          (fn as () => void).call(el);
          return { ok: true };
        }
        case 'native.click': {
          if (req.control === 'edit') {
            return isComment(el) ? editComment(el) : { ok: false, error: 'unsupported' };
          }
          if (!controlSelector[req.control]) return { ok: false, error: 'unsupported' };
          // Lazily hydrated controls need a position, so the item is scrolled into view first.
          const target = await locate(el, req.control, true);
          if (!target) return { ok: false, error: 'not-found' };
          (target as HTMLElement).click();
          return { ok: true };
        }
        case 'native.state': {
          // Read-only: report the control's pressed state so the isolated world can confirm an
          // action only after Reddit's own UI shows it (R10). Never clicks.
          if (!controlSelector[req.control]) return { ok: false, error: 'unsupported' };
          // Same lazy-hydration allowance as native.click: the control may not exist yet.
          const target = await locate(el, req.control, false);
          if (!target) return { ok: false, error: 'not-found' };
          const v = target.getAttribute(C.native.voteState);
          return {
            ok: true,
            pressed: v === 'true' ? true : v === 'false' ? false : null,
            ...(isComment(el) ? { voteState: rowVoteState(el) } : {}),
          };
        }
        case 'composer.focus':
          return focusComposer(el);
        case 'menu.item':
          return menuItemAction(el, req.menu, req.item, true);
        case 'menu.state':
          return menuItemAction(el, req.menu, req.item, false);
        case 'composer.insert': {
          const editor = deepQuery(el, C.composer.editor) as HTMLElement | null;
          if (!editor) return { ok: false, error: 'not-found' };
          editor.focus();
          if (editor instanceof HTMLTextAreaElement) {
            editor.value = req.text;
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            document.execCommand('selectAll');
            document.execCommand('insertText', false, req.text);
          }
          // Wait to see the text STAY: an editor may accept and then discard (Sheddit 0.48 lesson).
          await sleep(300);
          const now =
            editor instanceof HTMLTextAreaElement ? editor.value : (editor.textContent ?? '');
          return {
            ok: true,
            accepted: now.replace(/\s+/g, ' ').trim() === req.text.replace(/\s+/g, ' ').trim(),
          };
        }
        case 'composer.submit': {
          const btn = deepQuery(el, C.composer.submit) as HTMLElement | null;
          if (!btn) return { ok: false, error: 'not-found' };
          btn.click();
          return { ok: true };
        }
      }
    }

    addEventListener(REQUEST_EVENT, (e) => {
      const token = document.documentElement.getAttribute(CHANNEL_ATTR);
      let env: Envelope<BridgeRequest>;
      try {
        env = JSON.parse(String((e as CustomEvent).detail));
      } catch {
        return;
      }
      if (!token || env.token !== token) return;
      void handle(env.body)
        .catch((err: unknown) => ({ ok: false, error: `threw: ${String(err)}` }))
        .then((body) => {
          const res: Envelope<BridgeResponse> = { token, id: env.id, body };
          dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify(res) }));
        });
    });

    // Announce SPA navigations to the isolated world (route.ts listens).
    const PATCHED = '__rescueNavPatched';
    if (!(history as unknown as Record<string, unknown>)[PATCHED]) {
      Object.defineProperty(history, PATCHED, { value: true });
      for (const m of ['pushState', 'replaceState'] as const) {
        const orig = history[m];
        history[m] = function (this: History, ...args: Parameters<History['pushState']>) {
          const r = orig.apply(this, args);
          dispatchEvent(new Event(NAVIGATED_EVENT));
          return r;
        };
      }
    }
  },
});
