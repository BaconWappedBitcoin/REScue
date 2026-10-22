/**
 * threadSubscriptions (RES newCommentCount: showSubscribeButton, subscriptionLength; US6): a
 * "subscribe" word on a thread's post line watches that thread. About every ten minutes, while a
 * Reddit tab is open, REScue asks Reddit (one batched read-only call, see core/redditJson.ts and
 * PRIVACY.md) how many comments each watched thread has now, and tells you when one grew. The
 * Subscriptions panel in the REScue menu lists them with a badge for new comments, and opening a
 * thread clears its badge. Watches end by themselves after "subscriptionLength" days. Ported in
 * spirit from RES lib/modules/newCommentCount.js (GPL-3.0, the RES contributors, commit 4defffc);
 * the code is new. Signed out, the control is shown disabled with a sign-in hint.
 *
 * Files: subscriptionModel.ts (data), subscriptionPoller.ts (the check and the cross-tab lock),
 * subscriptionPanel.ts (the panel). Nothing here is requested until a thread is subscribed to.
 */
import { browser } from 'wxt/browser';
import { hint } from '../../core/hints';
import { jsonFor, jsonHealth, type BoundGetJson } from '../../core/redditJson';
import { defineModule, type ModuleContext } from '../../core/types';
import type { Post } from '../../model/types';
import { linkButton } from './commentUi';
import {
  addSub,
  markSeen,
  plural,
  removeSub,
  sanitizeSubs,
  pruneExpired,
  clearNew,
  totalNew,
  type SubMap,
} from './subscriptionModel';
import {
  CHECK_EVERY_MS,
  SUBS_KEY,
  migrateLegacySubs,
  runCheck,
  storageCursor,
  storageLock,
} from './subscriptionPoller';
import { closeSubscriptions, openSubscriptions, refreshSubscriptions } from './subscriptionPanel';

interface State {
  ctx: ModuleContext;
  getJson: BoundGetJson;
  subs: SubMap;
  /** Subscribe buttons on this page, by post id, repainted whenever the subscriptions change. */
  buttons: Map<string, { btn: HTMLButtonElement; post: Post }>;
  removeMenu: (() => void) | null;
  timers: Array<ReturnType<typeof setTimeout>>;
  chain: Promise<unknown>;
}

let state: State | null = null;
const FIRST_CHECK_MS = 8000;
const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const signedIn = (s: State): boolean => s.ctx.session.signedIn;
const days = (s: State): number =>
  Math.max(1, Math.round(Number(s.ctx.options.subscriptionLength) || 2));

/**
 * The list lives under the shared key STORAGE_KEYS.threadSubscriptions (part of the backup),
 * written at once rather than through the debounced store, so another tab's read-modify-write
 * right after sees it and never puts back a stale copy.
 */
async function load(_s: State): Promise<SubMap> {
  const got = await browser.storage.local.get(SUBS_KEY);
  return pruneExpired(sanitizeSubs(got[SUBS_KEY]), Date.now());
}

const save = (subs: SubMap): Promise<void> => browser.storage.local.set({ [SUBS_KEY]: subs });

/** Read-modify-write against storage (another tab may have changed it), one at a time. */
function mutate(s: State, change: (subs: SubMap, now: number) => SubMap): Promise<SubMap> {
  const run = s.chain.then(async () => {
    const cur = await load(s);
    const next = change(cur, Date.now());
    if (next !== cur) await save(next);
    s.subs = next;
    paint(s);
    return next;
  });
  s.chain = run.catch(() => {});
  return run;
}

function paintButton(s: State, btn: HTMLButtonElement, post: Post): void {
  const on = post.id in s.subs;
  btn.textContent = on ? 'unsubscribe' : 'subscribe';
  btn.disabled = !signedIn(s);
  btn.title = signedIn(s) ? hint.threadSubscribe(on, days(s)) : hint.threadSubscribeSignedOut;
  btn.setAttribute('aria-pressed', String(on));
}

function paintMenu(s: State): void {
  s.removeMenu?.();
  const fresh = totalNew(s.subs);
  s.removeMenu = s.ctx.ui.addMenuItem({
    id: 'threadSubscriptions',
    label: !signedIn(s)
      ? 'Subscriptions (sign in)'
      : fresh
        ? `Subscriptions (${fresh} new)`
        : 'Subscriptions',
    order: 60,
    hint: () => (signedIn(s) ? hint.subsMenu(totalNew(s.subs)) : hint.signIn),
    onClick: () => openPanel(s),
  });
}

function paint(s: State): void {
  for (const { btn, post } of s.buttons.values()) paintButton(s, btn, post);
  paintMenu(s);
  refreshSubscriptions();
}

function openPanel(s: State): void {
  if (!signedIn(s)) {
    s.ctx.notices.show('REScue: sign in to Reddit to watch threads for new comments.', {
      kind: 'info',
      id: 'subs-sign-in',
      moduleId: s.ctx.moduleId,
    });
    return;
  }
  openSubscriptions({
    load: () => load(s),
    unsubscribe: async (id) => void (await mutate(s, (subs) => removeSub(subs, id))),
    clearNew: async () => void (await mutate(s, (subs) => clearNew(subs))),
  });
}

function addButton(s: State, post: Post): void {
  const btn = linkButton('rescue-subscribe', 'subscribe', '');
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn(s)) return;
    void mutate(s, (subs, now) =>
      post.id in subs
        ? removeSub(subs, post.id)
        : addSub(
            subs,
            {
              id: post.id,
              title: post.title,
              permalink: post.permalink,
              subreddit: post.subreddit,
              commentCount: post.commentCount,
            },
            days(s),
            now,
          ),
    );
  });
  s.buttons.set(post.id, { btn, post });
  paintButton(s, btn, post);
  s.ctx.ui.decorate(post, 'tagline', btn);
}

async function check(s: State): Promise<void> {
  await s.chain;
  const outcome = await runCheck({
    load: () => load(s),
    save: async (subs) => {
      await save(subs);
      s.subs = subs;
    },
    getJson: s.getJson,
    lock: storageLock(owner),
    cursor: storageCursor(),
    now: Date.now,
    onGrew: (grew) => {
      for (const { sub, added } of grew) {
        s.ctx.notices.show(`${plural(added)} in ${sub.title.slice(0, 80)}`, {
          id: `sub-${sub.id}`,
          type: 'subscription-growth',
          moduleId: s.ctx.moduleId,
          actions: [
            { label: 'Open', hint: hint.subsOpen, run: () => location.assign(sub.permalink) },
          ],
        });
      }
    },
  });
  if (outcome === 'ok') paint(s);
}

function schedule(s: State): void {
  if (!signedIn(s)) return;
  const tick = () => void check(s).catch((err) => console.error('[REScue] subscriptions', err));
  s.timers.push(setTimeout(tick, FIRST_CHECK_MS), setInterval(tick, CHECK_EVERY_MS));
}

function stop(s: State): void {
  for (const t of s.timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  s.timers = [];
  s.removeMenu?.();
  for (const { btn } of s.buttons.values()) btn.remove();
  s.buttons.clear();
  closeSubscriptions();
}

export const threadSubscriptions = defineModule({
  id: 'threadSubscriptions',
  category: 'comments',
  title: 'Thread subscriptions',
  description:
    'A “subscribe” word on a thread’s post line watches the thread. About every 10 minutes, while a Reddit tab is open, REScue asks Reddit how many comments each watched thread has (one read-only request for all of them, only when you watch something) and tells you when a thread grew. The Subscriptions panel in the REScue menu lists them with a badge for new comments; opening a thread clears its badge. A watch ends by itself after the number of days you choose. Needs you to be signed in. Your list stays on this device.',
  requiresSignIn: true,
  enabledByDefault: true,
  options: {
    showSubscribeButton: {
      type: 'boolean',
      default: true,
      title: 'Show a “subscribe” control on threads',
    },
    subscriptionLength: {
      type: 'number',
      default: 2,
      min: 1,
      max: 90,
      title: 'Watch a thread for this many days',
      description: 'After that the thread is dropped from your subscriptions.',
    },
  },

  async init(ctx) {
    const s: State = {
      ctx,
      getJson: jsonFor(ctx.notices, ctx.moduleId),
      subs: {},
      buttons: new Map(),
      removeMenu: null,
      timers: [],
      chain: Promise.resolve(),
    };
    state = s;
    await migrateLegacySubs().catch((err) => console.error('[REScue] subscriptions', err));
    s.subs = await load(s);
    paintMenu(s);
    schedule(s);
  },

  onItems(batch, ctx) {
    const s = state;
    if (!s || ctx.route.kind !== 'thread') return;
    s.ctx = ctx;
    for (const post of batch.posts) {
      if (ctx.options.showSubscribeButton && !s.buttons.has(post.id)) addButton(s, post);
      // Opening a watched thread is "seeing" its comments.
      if (post.id in s.subs) void mutate(s, (subs) => markSeen(subs, post.id, post.commentCount));
    }
  },

  onRoute(route, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = { ...ctx, route };
    for (const { btn } of s.buttons.values()) btn.remove();
    s.buttons.clear();
  },

  onSettings(ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    if (!ctx.options.showSubscribeButton) {
      for (const { btn } of s.buttons.values()) btn.remove();
      s.buttons.clear();
    }
    paint(s);
  },

  health() {
    return jsonHealth();
  },

  dispose() {
    if (state) stop(state);
    state = null;
  },
});
