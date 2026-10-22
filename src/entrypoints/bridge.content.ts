/**
 * The ONLY code that runs in the page's own JavaScript realm. On request it does a handful of
 * things — load a programmatic partial, press a native control (a comment's controls are looked
 * for only in its own action row; a post's gallery arrows and video mute button only inside their
 * own gallery carousel / player), open an item's own overflow menu and press its Save / Hide row
 * (or just read it), focus or put text into Reddit's composer (all of it, or at the caret), read
 * its text, switch it to Markdown with its own button, press its submit — and announces
 * SPA navigations. It never reads storage, never fetches, and exposes no general eval
 * (contracts/messaging.md).
 *
 * Partial loading and the history patch are ported from Sheddit src/core/bridge.js (GPL-3.0,
 * kookaburrabarrel, cff40d7).
 */
import { C } from '../contracts/reddit';
import { deepQuery, deepQueryAll } from '../core/deepQuery';
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
  NOT_FOCUSED,
} from '../core/bridge-protocol';

export default defineContentScript({
  matches: ['*://www.reddit.com/*', '*://reddit.com/*', '*://sh.reddit.com/*'],
  excludeMatches: ['*://*.reddit.com/media*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    // One bridge per page: the background may start REScue a second time (core/startupCheck).
    const flags = window as unknown as Record<string, unknown>;
    if (flags.__rescueBridge) return;
    Object.defineProperty(flags, '__rescueBridge', { value: true });
    const byRef = (ref: string): Element | null =>
      /^[a-z0-9-]{1,64}$/i.test(ref) ? document.querySelector(`[${REF_ATTR}="${ref}"]`) : null;

    const controlSelector: Partial<Record<NativeControl, string>> = {
      upvote: C.native.upvote,
      downvote: C.native.downvote,
      reply: C.native.reply,
      join: C.native.joinButton,
      share: C.native.share,
      galleryPrev: C.mediaControls.galleryPrev,
      galleryNext: C.mediaControls.galleryNext,
      muteToggle: C.mediaControls.mute,
    };

    /**
     * A media control (gallery arrows, video mute) lives inside its OWN host inside the post: the
     * arrows in the post's gallery carousel, the mute button in its player (whose controls may sit
     * in nested open roots). The host is found first so the control is looked for only there,
     * never elsewhere in the post (verified live 2026-10-21).
     */
    const mediaHostOf = (post: Element, control: NativeControl): Element | null =>
      control === 'muteToggle'
        ? deepQuery(post, C.mediaControls.player)
        : deepQuery(post, C.mediaControls.gallery);

    const isMediaControl = (control: NativeControl): boolean =>
      control === 'galleryPrev' || control === 'galleryNext' || control === 'muteToggle';

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
    const locate = async (el: Element, control: NativeControl): Promise<Element | null> => {
      const comment = isComment(el);
      const sel =
        comment && control === 'reply' ? C.commentActions.replyButton : controlSelector[control];
      if (!sel) return null;
      const find = (): Element | null => {
        // A media control is searched for only inside its own host (the post's gallery carousel
        // or video player), so another carousel's or player's buttons are never taken.
        if (isMediaControl(control)) {
          const host = mediaHostOf(el, control);
          return host ? deepQuery(host, sel) : null;
        }
        const root = comment ? ownRow(el) : el;
        return root ? deepQuery(root, sel) : null;
      };
      // Scroll only when the control is not built yet (Reddit builds some lazily, once on screen):
      // scrolling a comment that is already there made the page jump on every vote.
      let target = find();
      if (!target) el.scrollIntoView({ block: 'nearest' });
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
    /**
     * Press a menu row. A post-menu row is li[role=presentation] around the real div[role=menuitem];
     * only the inner one acts (verified live 2026-10-16). A comment-menu row is li[role=menuitem]
     * around a clickable div that holds the handler (verified live 2026-10-19 and, for "Edit
     * comment", 2026-10-21: clicking the li did nothing); clicking that div still bubbles to the li.
     */
    const clickRow = (row: Element): void =>
      (
        (row.querySelector('[role="menuitem"]') ??
          row.querySelector(':scope > div') ??
          row) as HTMLElement
      ).click();

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
          clickRow(item);
          return { ok: true };
        }
      }
      // No matching item: close the menu again rather than leave it open, and click nothing.
      if (trigger.getAttribute('aria-expanded') === 'true') trigger.click();
      return { ok: false, error: 'not-found' };
    };

    /** Item pattern: the wanted row's text, and its already-applied text. */
    const rowState = (item: MenuItemKind, text: string): 'on' | 'off' =>
      item === 'report' || item === 'delete'
        ? 'off'
        : (item === 'save'
              ? C.saveHide.saveOnText
              : item === 'inbox'
                ? C.saveHide.inboxOnText
                : C.saveHide.hideOnText
            ).test(text)
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
      const wanted = {
        save: C.saveHide.saveText,
        hide: C.saveHide.hideText,
        report: C.saveHide.reportText,
        inbox: C.saveHide.inboxText,
        delete: C.saveHide.deleteText,
      }[item];
      const findRow = (): Element | undefined =>
        deepQueryAll(box, C.saveHide.item).find((n) => wanted.test((n.textContent ?? '').trim()));
      const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
      if (!wasOpen) trigger.click();
      let row = findRow();
      // A comment's menu fills its rows in lazily, a second or two after it first opens (live);
      // a post's menu has them at once.
      for (let i = 0; i < (menu === 'comment' ? 40 : 10) && !row; i++) {
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
      clickRow(row);
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

    // ---- comment tools: scoped to the comment-composer-host the caller referenced ----------
    const T = C.composerTools;
    /** Longest text a composer op types (Reddit's own comment limit is 10 000); badText checks. */
    const MAX_TEXT = 40_000;
    const shown = (el: Element): boolean => el instanceof HTMLElement && el.offsetWidth > 0;
    /**
     * Markdown mode: the composer says so, or it SHOWS a plain box and no rich-text editor (live
     * 2026-10-21 Reddit opened a reply box in Markdown, remembering the reader's choice, while its
     * `mode` attribute still said "richText"; Save then looked for a switch that was not there).
     */
    const isMarkdown = (host: Element): boolean =>
      T.markdownMode.test(deepQuery(host, T.composer)?.getAttribute(T.modeAttr) ?? '') ||
      (deepQueryAll(host, T.plainEditor).some(shown) &&
        !deepQueryAll(host, T.richEditor).some(shown));
    /**
     * The host's editable box: the plain box in Markdown mode, else the rich-text editor. A box on
     * screen wins over one Reddit keeps hidden (in Markdown mode the rich-text editor stays in the
     * DOM at zero width: live 2026-10-21, where writing into it lost the text).
     */
    const editorOf = (host: Element): HTMLElement | null => {
      const order = isMarkdown(host)
        ? [T.plainEditor, T.richEditor, C.composer.editor]
        : [T.richEditor, T.plainEditor, C.composer.editor];
      let hidden: HTMLElement | null = null;
      for (const sel of order) {
        for (const hit of deepQueryAll(host, sel)) {
          if (!(hit instanceof HTMLElement)) continue;
          if (hit.getClientRects().length && hit.offsetWidth > 0) return hit;
          hidden ??= hit;
        }
      }
      return hidden;
    };
    const editorText = (ed: HTMLElement): string =>
      ed instanceof HTMLTextAreaElement ? ed.value : (ed.textContent ?? '');
    const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const badText = (text: unknown): boolean => typeof text !== 'string' || text.length > MAX_TEXT;
    /**
     * Focus the box; true only once it (or something in it) really holds the focus. execCommand
     * types into whatever does, so if it stayed in another box nothing is typed (`not-focused`).
     */
    const focusInto = (editor: HTMLElement): boolean => {
      const inside = (n = activeDeep()): boolean => !!n && (n === editor || editor.contains(n));
      if (!inside()) editor.focus();
      return inside();
    };

    /** Put text at the caret (replacing a selection inside the box), never selecting all. */
    const insertAt = async (host: Element, text: string): Promise<BridgeResponse> => {
      const editor = editorOf(host);
      if (!editor) return { ok: false, error: 'not-found' };
      if (!focusInto(editor)) return { ok: false, error: NOT_FOCUSED };
      if (editor instanceof HTMLTextAreaElement) {
        const start = editor.selectionStart ?? editor.value.length;
        const end = editor.selectionEnd ?? start;
        editor.setRangeText(text, start, end, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('insertText', false, text);
      }
      await sleep(300);
      const want = squash(text);
      return { ok: true, accepted: want === '' || squash(editorText(editor)).includes(want) };
    };

    /** Press Reddit's own "Switch to Markdown" button unless the composer is already Markdown. */
    const markdownMode = async (host: Element): Promise<BridgeResponse> => {
      if (isMarkdown(host)) return { ok: true, accepted: true };
      const btn = deepQueryAll(host, T.switchButton).find((b) =>
        T.switchLabel.test(b.getAttribute('aria-label') ?? b.textContent ?? ''),
      ) as HTMLElement | undefined;
      if (!btn) return { ok: false, error: 'not-found' };
      btn.click();
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        if (isMarkdown(host)) return { ok: true, accepted: true };
      }
      return { ok: true, accepted: false };
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
          // A lazily built control is scrolled into view first; one that is there is not.
          const target = await locate(el, req.control);
          if (!target) return { ok: false, error: 'not-found' };
          (target as HTMLElement).click();
          return { ok: true };
        }
        case 'native.state': {
          // Read-only: report the control's pressed state so the isolated world can confirm an
          // action only after Reddit's own UI shows it (R10). Never clicks.
          if (!controlSelector[req.control]) return { ok: false, error: 'unsupported' };
          // Same lazy-hydration allowance as native.click: the control may not exist yet.
          const target = await locate(el, req.control);
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
          // Only a named composer host, documented text, and only once the box itself holds the
          // focus (selectAll would otherwise empty whatever box does).
          if (!el.matches(C.composer.host)) return { ok: false, error: 'not-composer' };
          if (badText(req.text)) return { ok: false, error: 'bad-request' };
          // The box Reddit shows (Markdown-aware), never a hidden one (editorOf).
          const editor = editorOf(el);
          if (!editor) return { ok: false, error: 'not-found' };
          if (!focusInto(editor)) return { ok: false, error: NOT_FOCUSED };
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
        case 'composer.insertAt':
        case 'composer.read':
        case 'composer.markdownMode': {
          // Only ever the composer host the caller named, and only the documented shapes.
          if (!el.matches(T.host)) return { ok: false, error: 'not-composer' };
          if (req.op === 'composer.markdownMode') return markdownMode(el);
          if (req.op === 'composer.insertAt')
            return badText(req.text) ? { ok: false, error: 'bad-request' } : insertAt(el, req.text);
          const editor = editorOf(el);
          if (!editor) return { ok: false, error: 'not-found' };
          return {
            ok: true,
            text: editorText(editor),
            mode: deepQuery(el, T.composer)?.getAttribute(T.modeAttr) ?? '',
          };
        }
        case 'composer.submit': {
          if (!el.matches(C.composer.host)) return { ok: false, error: 'not-composer' };
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
