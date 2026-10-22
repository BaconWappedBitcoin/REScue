/**
 * Isolated-world content script. REScue decorates Reddit's own layout and never replaces it.
 * Order: settings -> session -> registry -> pipeline -> native adapter. A startup failure logs a
 * notice and leaves Reddit's page exactly as it is (constitution Principle III).
 */
import { sweepOwn, takeOver, type Instance } from '../core/instance';
import { isTabDisabled, showDisabledNotice } from '../core/tabDisable';
import { ensureTheme } from '../core/theme';
import { BridgeClient } from '../core/bridge-client';
import { createActionApi } from '../core/actions';
import { createNotices } from '../core/notices';
import { Pipeline } from '../core/pipeline';
import { changedModules, createRegistry, rerunSet, settled } from '../core/registry';
import { classify, watchRoute } from '../core/route';
import {
  createSettingsSave,
  isModuleEnabled,
  loadProfile,
  resolveOptions,
  saveOrNotify,
  type SettingsProfile,
} from '../core/settings';
import { LocalStore, STORAGE_KEYS } from '../core/storage/store';
import type { ModuleContext, ModuleUi, SettingsApi, SharedData } from '../core/types';
import { KeyDispatcher } from '../core/keys';
import { Decorations } from '../layout/decorations';
import { NativeAdapter } from '../layout/native/adapter';
import { Selection } from '../layout/native/selection';
import { createToolbar } from '../layout/native/toolbar';
import { pageStartable, readSession, watchSession } from '../model/session';
import { MODULES } from '../modules';
import {
  applyEarlyCommentMedia,
  clearEarlyCommentMedia,
} from '../modules/listings/inlineMedia/earlyStyle';
import { applyEarlySkin, clearEarlySkin } from '../modules/appearance/oldSkin/early';
import { SKIN_STYLE_ID } from '../modules/appearance/oldRedditSkin';
import { applyEarlyFrontSort } from '../modules/appearance/logoLink';
import { PING } from '../core/startupCheck';
import { readNoticePrefs, withMutedTypes } from '../modules/core/noticeSettings';

const FROM_OLD_PARAM = 'rescue_from_old';
const PERF_ATTR = 'data-rescue-perf';
const PERF_PREFIX = '[REScue:perf]';
/** A burst of saves (a slider dragged, a table typed into) is followed once, after it settles. */
const SETTINGS_SETTLE_MS = 150;

export default defineContentScript({
  matches: ['*://www.reddit.com/*', '*://reddit.com/*', '*://sh.reddit.com/*'],
  excludeMatches: ['*://*.reddit.com/media*'],
  runAt: 'document_start',
  main() {
    // Answer the background's startup check (core/startupCheck) so it does not start a second copy.
    browser.runtime.onMessage.addListener((msg: unknown) =>
      (msg as { type?: string })?.type === PING ? Promise.resolve(true) : undefined,
    );
    // Logo link › "Front page sort": a bare front page opens with the chosen sort at once.
    if (applyEarlyFrontSort(location.href)) return;
    // Troubleshooter › "Disable REScue in this tab": leave the page exactly as Reddit made it.
    if (isTabDisabled()) {
      showDisabledNotice();
      return;
    }
    // The newest REScue on the page wins: an older instance (the add-on was reloaded while this
    // tab stayed open) tears itself down, so no post ever shows two sets of controls.
    const disposers: Array<() => void> = [];
    /** Run `fn` when a newer instance takes over (at once if it already has). */
    const onDispose = (fn: () => void): void => {
      if (instance.alive()) disposers.push(fn);
      else fn();
    };
    const instance: Instance = takeOver(() => {
      for (const fn of disposers.splice(0).reverse()) {
        try {
          fn();
        } catch {
          /* already gone */
        }
      }
      sweepOwn(instance.token);
    });
    const notices = createNotices();
    let route = classify(location.href);
    // Comment media the reader chose to hide is hidden from the first paint (earlyStyle.ts).
    applyEarlyCommentMedia(location.href);
    // The Old Reddit look, likewise, from the first paint (oldSkin/early.ts).
    applyEarlySkin(location.href);

    // Start as soon as the header, the signed-in state and the first post are in, not when Reddit
    // has sent the whole page: on a long thread that was most of a second of hidden posts.
    const domReady = new Promise<void>((resolve) => {
      if (document.readyState !== 'loading' || pageStartable()) return resolve();
      const watch = new MutationObserver(() => {
        if (!pageStartable()) return;
        watch.disconnect();
        resolve();
      });
      watch.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          watch.disconnect();
          resolve();
        },
        { once: true },
      );
    });

    void (async () => {
      const deco = new Decorations();
      const bridge = new BridgeClient();
      const native = new NativeAdapter(deco);
      const selection = new Selection();
      deco.onChange(() => selection.refresh());
      const toolbar = createToolbar();
      ensureTheme(); // REScue's colours, following Reddit's light or dark mode
      const keys = new KeyDispatcher();
      try {
        const store = new LocalStore((err) =>
          notices.show(
            `REScue could not save your data: ${err instanceof Error ? err.message : String(err)}`,
            { kind: 'error' },
          ),
        );
        let profile: SettingsProfile = await loadProfile(store);
        let session = readSession();
        const actions = createActionApi({ bridge, session: () => session });

        const ui: ModuleUi = {
          hide: (i, r) => deco.hide(i, r),
          unhide: (i, r) => deco.unhide(i, r),
          collapseBody: (i, on) => deco.collapseBody(i, on),
          markAuthor: (i, c) => deco.markAuthor(i, c),
          unmarkAuthor: (i, c) => deco.unmarkAuthor(i, c),
          decorate: (i, s, n) => deco.decorate(i, s, n),
          removeDecorations: (k) => deco.removeKind(k),
          addClass: (i, c) => deco.addClass(i, c),
          addHeaderTool: (n) => toolbar.addHeaderTool(n),
          addBanner: (n) => toolbar.addBanner(n),
          addMenuItem: (item) => toolbar.addMenuItem(item),
          openMenu: (anchor) => toolbar.openMenu(anchor),
          setRevealHidden: (on) => deco.setReveal(on),
          selection: () => selection,
        };

        const data: SharedData = {
          get: (key) => store.get(key),
          set: (key, value) => store.set(key, value),
        };
        const contexts = new Map<string, ModuleContext>();
        const save = createSettingsSave({
          profile: () => profile,
          setProfile: (p) => {
            profile = p;
          },
          read: async () =>
            (await browser.storage.local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings],
          // Written immediately (not debounced): the console reports "saved" only after this.
          write: (p) => browser.storage.local.set({ [STORAGE_KEYS.settings]: p }),
          onSaved: () =>
            void browser.runtime.sendMessage({ type: 'settings.changed' }).catch(() => {}),
        });
        const settings: SettingsApi = {
          profile: () => profile,
          save,
          definitions: () => MODULES,
          status: (id) => registry.status(id),
          report: () => registry.report(),
          async runAction(moduleId, actionId, file) {
            const def = MODULES.find((d) => d.id === moduleId);
            const action = def?.actions?.find((a) => a.id === actionId);
            if (!def || !action) return;
            // A module that is off still exposes its actions (e.g. export while disabled).
            const ctx: ModuleContext = contexts.get(moduleId) ?? {
              moduleId,
              route,
              // Read live: contexts are made before the page is parsed, so a copy would stay signed out.
              get session() {
                return session;
              },
              store: store.scoped(moduleId),
              data,
              notices,
              ui,
              keys,
              bridge,
              actions,
              settings,
              options: resolveOptions(def, profile),
            };
            try {
              await action.run(ctx, file);
            } catch (err) {
              console.error(`[REScue] ${moduleId}.${actionId} failed`, err);
              notices.show(`REScue: “${action.label}” failed.`, { kind: 'error' });
            }
          },
        };

        notices.configure({
          muted: () => readNoticePrefs(profile).mutedTypes,
          setMuted: (next) =>
            void saveOrNotify({ settings, notices }, withMutedTypes(profile, next)),
          closeDelayMs: () => readNoticePrefs(profile).closeDelaySeconds * 1000,
          fadeOutMs: () => readNoticePrefs(profile).fadeOutSeconds * 1000,
          moduleTitle: (id) => MODULES.find((d) => d.id === id)?.title,
        });

        const registry = createRegistry({
          isEnabled: (def) => def.locked === true || isModuleEnabled(def, profile),
          notify: (m) => notices.show(m, { kind: 'warning' }),
          reloadNeeded: (def, enabled) =>
            notices.show(
              `REScue: reload this page to finish turning “${def.title}” ${enabled ? 'on' : 'off'}.`,
              {
                id: 'reload-needed',
                kind: 'warning',
                actions: [{ label: 'Reload', run: () => location.reload() }],
              },
            ),
          makeContext: (def): ModuleContext => {
            const ctx: ModuleContext = {
              moduleId: def.id,
              route,
              // Read live: contexts are made before the page is parsed, so a copy would stay signed out.
              get session() {
                return session;
              },
              store: store.scoped(def.id),
              data,
              notices,
              ui,
              keys,
              bridge,
              actions,
              settings,
              options: resolveOptions(def, profile, (id, opt) =>
                notices.show(`REScue: invalid setting ${id}.${opt} was reset to its default.`, {
                  kind: 'warning',
                }),
              ),
            };
            contexts.set(def.id, ctx);
            return ctx;
          },
        });
        for (const def of MODULES) registry.register(def);

        await domReady;
        session = readSession();
        if (new URLSearchParams(location.search).has(FROM_OLD_PARAM)) {
          const u = new URL(location.href);
          u.searchParams.delete(FROM_OLD_PARAM);
          history.replaceState(history.state, '', u.href);
          notices.show(
            'REScue opened this old.reddit link on Reddit’s current site, because old.reddit now asks for an account.',
            { id: 'from-old', timeoutMs: 8000 },
          );
        }

        await registry.start();
        // The module's own stylesheet has taken over (or the module is off): drop the early one.
        clearEarlyCommentMedia();
        clearEarlySkin(SKIN_STYLE_ID);
        onDispose(keys.attach(window));
        onDispose(() => registry.stop());
        onDispose(() => deco.clear());
        onDispose(() => native.stop());

        const pipeline = new Pipeline({
          onBatch(batch) {
            // Every module's changes to an item are placed once, when the item is tracked below.
            deco.batch(() => registry.items(batch));
            native.track(batch);
            selection.track(batch);
          },
          // Performance tests set this attribute on <html>; nothing is emitted otherwise.
          onTiming(ms, batch, startedAt) {
            if (!document.documentElement.hasAttribute(PERF_ATTR)) return;
            console.debug(
              PERF_PREFIX,
              JSON.stringify({
                ms,
                startedAt,
                posts: batch.posts.length,
                comments: batch.comments.length,
              }),
            );
          },
        });
        pipeline.start();
        onDispose(() => pipeline.stop());
        pipeline.flush();
        // Everything above is running and the first batch is tracked: a stable signal for tests
        // (and any other observer) to wait on instead of guessing a delay. Set only after the
        // modules have started, the keys are attached and the page's items have been consumed.
        document.documentElement.setAttribute('data-rescue-ready', '1');
        setTimeout(() => registry.checkHealth(), 3000);

        onDispose(
          watchSession((s) => {
            session = s;
          }),
        );
        onDispose(
          watchRoute((next) => {
            route = next;
            pipeline.reset();
            native.reset();
            selection.reset();
            deco.clear();
            registry.route(route);
            pipeline.flush();
          }),
        );

        // The settings as the modules last followed them (the saving tab has `profile` already).
        let applied: SettingsProfile = structuredClone(profile);
        const followSettings = async (): Promise<void> => {
          const p = await loadProfile(store);
          if (!instance.alive()) return;
          profile = p;
          const named = await registry.settingsChanged();
          const only = rerunSet(named, changedModules(applied, p));
          applied = structuredClone(p);
          if (only?.size === 0) return;
          // Modules that were switched on or whose settings changed decorate the items already on
          // the page again: the pipeline hands them its items in slices, nothing is parsed again.
          // Decorations.replace keeps duplicates from appearing.
          pipeline.replay((b) => deco.batch(() => registry.items(b, only ?? undefined)));
        };
        const followLater = settled(followSettings, SETTINGS_SETTLE_MS, (err) =>
          console.error('[REScue] following the new settings failed', err),
        );
        onDispose(() => followLater.stop());
        const onMessage = (msg: unknown) => {
          if (!instance.alive()) return undefined;
          if ((msg as { type?: string })?.type === 'settings.changed') followLater.poke();
          return undefined;
        };
        browser.runtime.onMessage.addListener(onMessage);
        onDispose(() => browser.runtime.onMessage.removeListener(onMessage));
        addEventListener('pagehide', () => {
          if (!instance.alive()) return;
          void store.flush();
          void browser.runtime
            .sendMessage({ type: 'health.report', report: registry.report() })
            .catch(() => {});
        });
      } catch (err) {
        clearEarlyCommentMedia();
        clearEarlySkin(SKIN_STYLE_ID);
        console.error('[REScue] startup failed', err);
        notices.show('REScue failed to start; Reddit is unchanged.', { kind: 'error' });
      }
    })();
  },
});
