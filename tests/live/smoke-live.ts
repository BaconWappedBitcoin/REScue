/**
 * REScue live smoke harness (manual; never in CI). Drives the BUILT extension on real Reddit with a
 * signed-in profile and records, for every page x theme x viewport, what REScue shows and whether
 * it is usable: screenshots, REScue console errors, DOM/contrast/overlap/theme checks, timing.
 * It writes data to <out>/results.json and <out>/issues.json; the triage report is written by hand.
 *
 * READ-ONLY toward Reddit: it never votes, posts, joins, saves/hides/reports on Reddit, or changes
 * Reddit account settings. It only uses REScue-local features (tags, filters, save-RES, settings,
 * collapsing) and restores extension storage afterwards. A challenged page ("Prove your humanity",
 * CAPTCHA) is recorded as blocked and never attempted.
 *
 * Run (needs `npm run build` first; tsx is not a dependency, so Node's built-in type stripping is used):
 *   node --experimental-strip-types tests/live/smoke-live.ts \
 *     --profile <signed-in chromium profile dir> --out smoke-output
 *
 * Options (all optional except --profile):
 *   --profile <dir>   signed-in profile. It is COPIED to a temp folder first; the original is untouched.
 *   --in-place        use --profile directly (no copy). Do not use with a profile another browser holds.
 *   --out <dir>       output folder (default ./smoke-output)
 *   --ext <dir>       built extension (default <repo>/.output/chrome-mv3)
 *   --themes a,b      light,dark (default both)       --viewports 1280,820 (default both)
 *   --only a,b        run only these steps: static,popups,features,offByDefault,sh
 *                     (features/offByDefault/sh run once, in the first light/first-width combo)
 *   --pause <ms>      delay between page loads (default 3500)
 */
// The in-page audit and the storage helpers handle untyped page data on purpose.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { chromium } from '@playwright/test';
import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------------------------
const here = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const flag = (n: string): boolean => argv.includes(`--${n}`);
const opt = (n: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : d;
};
const PROFILE_SRC = opt('profile');
if (!PROFILE_SRC) {
  console.error('usage: smoke-live.ts --profile <dir> [--out dir] [--themes light,dark] ...');
  process.exit(2);
}
const OUT = resolve(opt('out', 'smoke-output')!);
const EXT = resolve(opt('ext', resolve(here, '../../.output/chrome-mv3'))!);
const THEMES = opt('themes', 'light,dark')!.split(',') as Array<'light' | 'dark'>;
const WIDTHS = opt('viewports', '1280,820')!.split(',').map(Number);
const ONLY = opt('only')?.split(',');
const PAUSE = Number(opt('pause', '3500'));
const want = (s: string): boolean => !ONLY || ONLY.includes(s);

const SCREENS = join(OUT, 'screens');
mkdirSync(SCREENS, { recursive: true });

// ---------------------------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------------------------
type Sev = 'blocker' | 'major' | 'minor' | 'cosmetic' | 'info';
interface Issue {
  n: number;
  sev: Sev;
  module: string;
  where: string;
  what: string;
  evidence: string;
  cause: string;
}
const issues: Issue[] = [];
const results: Record<string, unknown>[] = [];
const notTested: string[] = [];
const cur = { where: '-', combo: '-', shot: '' };
const seen = new Set<string>();

/** Record an issue once per (module, what, where-kind). `dedupe` collapses repeats across combos. */
function issue(
  sev: Sev,
  module: string,
  what: string,
  o: { evidence?: string; cause?: string; dedupe?: string } = {},
): void {
  const key = `${module}|${o.dedupe ?? what}|${o.dedupe ? '' : cur.where}`;
  if (seen.has(key)) return;
  seen.add(key);
  issues.push({
    n: issues.length + 1,
    sev,
    module,
    where: cur.where,
    what,
    evidence: o.evidence ?? cur.shot,
    cause: o.cause ?? '',
  });
  console.log(`  [${sev}] ${module}: ${what.slice(0, 160)}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const safeName = (s: string): string => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

function save(): void {
  writeFileSync(join(OUT, 'issues.json'), JSON.stringify(issues, null, 2));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, notTested }, null, 2));
}

async function shot(page: Page, name: string): Promise<string> {
  const file = join(SCREENS, `${cur.combo}__${safeName(name)}.png`);
  try {
    await page.screenshot({ path: file, timeout: 15000 });
  } catch (e) {
    console.log('  screenshot failed', (e as Error).message.slice(0, 80));
  }
  cur.shot = file;
  return file;
}

// ---------------------------------------------------------------------------------------------
// profile + context
// ---------------------------------------------------------------------------------------------
function prepareProfile(): string {
  if (flag('in-place')) return resolve(PROFILE_SRC!);
  const dst = join(tmpdir(), 'rescue-smoke-profile');
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  cpSync(resolve(PROFILE_SRC!), dst, {
    recursive: true,
    filter: (p) => !/Singleton(Lock|Cookie|Socket)$|lockfile$/i.test(p),
  });
  return dst;
}

type Area = { chrome: { storage: { local: any } } };
async function worker(ctx: BrowserContext): Promise<Worker> {
  return ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
}
async function storeAll(ctx: BrowserContext): Promise<Record<string, any>> {
  const sw = await worker(ctx);
  return sw.evaluate(async () => (globalThis as unknown as Area).chrome.storage.local.get(null));
}
async function storeSet(ctx: BrowserContext, items: Record<string, unknown>): Promise<void> {
  const sw = await worker(ctx);
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set(v),
    items,
  );
}
async function storeReplace(ctx: BrowserContext, items: Record<string, unknown>): Promise<void> {
  const sw = await worker(ctx);
  await sw.evaluate(async (v) => {
    const l = (globalThis as unknown as Area).chrome.storage.local;
    await l.clear();
    await l.set(v);
  }, items);
}
/** Merge module settings (enabled/options) into the stored profile. */
async function configure(
  ctx: BrowserContext,
  mods: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>,
): Promise<void> {
  const all = await storeAll(ctx);
  const prev = all.settings ?? {
    schemaVersion: 1,
    modules: {},
    keybindings: {},
    syncEnabled: false,
  };
  const modules = { ...(prev.modules ?? {}) };
  for (const [id, v] of Object.entries(mods)) {
    modules[id] = {
      ...(modules[id] ?? {}),
      ...v,
      options: { ...(modules[id]?.options ?? {}), ...(v.options ?? {}) },
    };
  }
  await storeSet(ctx, { settings: { ...prev, modules } });
}

async function launch(scheme: 'light' | 'dark', profile: string): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://www.reddit.com',
    });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://sh.reddit.com',
    });
  } catch {
    notTested.push('Clipboard permission could not be granted: y (copy permalink) not verifiable.');
  }
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// the in-page audit (serialised into the page; uses no outer variables)
// ---------------------------------------------------------------------------------------------
interface ControlSpec {
  name: string;
  sel: string;
  /** must exist (>=1) on this page kind */
  expect: boolean;
  /** a single fixed control that must sit inside the viewport */
  fixed?: boolean;
}

const AUDIT = (cfg: { controls: ControlSpec[] }): any => {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const R: any = {
    vw,
    vh,
    controls: [],
    covers: [],
    overlaps: [],
    contrast: [],
    blank: [],
    surfaces: [],
    theme: {},
    nodes: 0,
  };
  const HOSTS = ['rescue-notices', 'rescue-settings'];

  // ---- helpers
  const parseColor = (s: string): any => {
    let m = s.match(/^rgba?\(([^)]+)\)/);
    const tok = (x: string): number => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x));
    if (m) {
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean);
      return { r: tok(p[0]!), g: tok(p[1]!), b: tok(p[2]!), a: p.length > 3 ? tok(p[3]!) : 1 };
    }
    m = s.match(/^color\(srgb ([^)]+)\)/);
    if (m) {
      const p = m[1]!.split(/[ /]+/).filter(Boolean);
      return {
        r: tok(p[0]!) * 255,
        g: tok(p[1]!) * 255,
        b: tok(p[2]!) * 255,
        a: p.length > 3 ? tok(p[3]!) : 1,
      };
    }
    return null;
  };
  const over = (f: any, b: any): any => {
    const a = f.a + b.a * (1 - f.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (f.r * f.a + b.r * b.a * (1 - f.a)) / a,
      g: (f.g * f.a + b.g * b.a * (1 - f.a)) / a,
      b: (f.b * f.a + b.b * b.a * (1 - f.a)) / a,
      a,
    };
  };
  const lum = (c: any): number => {
    const ch = (v: number): number => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const ratio = (a: any, b: any): number => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const parentOf = (el: any): any => {
    if (el.assignedSlot) return el.assignedSlot;
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root && root.host ? root.host : null;
  };
  const canvasBase = (): any => {
    const cs = getComputedStyle(document.documentElement);
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0.99) return c;
    const b = parseColor(getComputedStyle(document.body).backgroundColor);
    if (b && b.a > 0.99) return b;
    return /dark/.test(cs.colorScheme)
      ? { r: 18, g: 18, b: 18, a: 1 }
      : { r: 255, g: 255, b: 255, a: 1 };
  };
  const effectiveBg = (el: any): any => {
    const layers: any[] = [];
    let n = el;
    let guard = 0;
    while (n && guard++ < 60) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a > 0.99) break;
      }
      n = parentOf(n);
    }
    let acc = layers.length && layers[layers.length - 1].a > 0.99 ? layers.pop() : canvasBase();
    while (layers.length) acc = over(layers.pop(), acc);
    return acc;
  };
  const opacityOf = (el: any): number => {
    let o = 1;
    let n = el;
    let guard = 0;
    while (n && guard++ < 60) {
      o *= parseFloat(getComputedStyle(n).opacity || '1');
      n = parentOf(n);
    }
    return o;
  };
  const visible = (el: any): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
    return true;
  };
  const qa = (sel: string): any[] => {
    const out: any[] = [...document.querySelectorAll(sel)];
    for (const id of HOSTS) {
      const h = document.getElementById(id);
      if (h && h.shadowRoot) out.push(...h.shadowRoot.querySelectorAll(sel));
    }
    return out;
  };
  const sig = (el: any): string => {
    if (el.id) return `#${el.id}`;
    const cls = [...el.classList].filter((c: string) => c.startsWith('rescue-'))[0];
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  const deepTop = (x: number, y: number): any => {
    let el: any = document.elementFromPoint(x, y);
    let guard = 0;
    while (el && el.shadowRoot && guard++ < 10) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  };
  const inShadowOf = (el: any, hostId: string): boolean => {
    const root = el.getRootNode();
    return !!(root && root.host && root.host.id === hostId);
  };
  const isOwn = (el: any): boolean =>
    HOSTS.some((h) => inShadowOf(el, h)) || !!el.closest('[id^="rescue-"],[class*="rescue-"]');

  // ---- theme of the page vs REScue
  // The page's own background, taken from Reddit's header (content-independent), else the body.
  const themeEl = document.querySelector('header') || document.body;
  const pageBg = effectiveBg(themeEl);
  R.theme = {
    htmlClass: document.documentElement.className.slice(0, 200),
    redditDark: document.documentElement.classList.contains('theme-dark'),
    osDark: matchMedia('(prefers-color-scheme: dark)').matches,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    pageBgLum: +lum(pageBg).toFixed(3),
    pageBg: `rgb(${Math.round(pageBg.r)},${Math.round(pageBg.g)},${Math.round(pageBg.b)})`,
  };

  // ---- controls
  for (const c of cfg.controls) {
    const els = qa(c.sel);
    const vis = els.filter(visible);
    const rec: any = {
      name: c.name,
      found: els.length,
      visible: vis.length,
      expect: c.expect,
      problems: [],
    };
    const sample = vis.slice(0, 12);
    for (const el of sample) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // centre inside the viewport and below Reddit's sticky header (56px)
      const inView = cx >= 0 && cx < vw && cy >= 60 && cy < vh;
      if (c.fixed && (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1))
        rec.problems.push(
          `outside viewport (${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)})`,
        );
      if (inView) {
        const x = cx;
        const y = cy;
        const top = deepTop(x, y);
        const ok = top && (top === el || el.contains(top) || top.contains(el));
        // A page-scrolled control under one of REScue's own fixed surfaces (the shortcut bar, the
        // strip, a notice) is not a defect: the surface is recorded under "covers", and scrolling
        // moves the control out from under it.
        const fixedSurface =
          top?.closest?.('#rescue-subreddit-bar, #rescue-tools, #rescue-notices, #rescue-menu') &&
          !el.closest('#rescue-subreddit-bar, #rescue-tools, #rescue-notices, #rescue-menu');
        if (!ok && !fixedSurface) {
          const who = top
            ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}${top.className && typeof top.className === 'string' ? '.' + top.className.split(' ')[0] : ''}` +
              `${top.getAttribute?.('href') ? ' href=' + String(top.getAttribute('href')).slice(0, 60) : ''}` +
              ` (position ${getComputedStyle(top).position}, z ${getComputedStyle(top).zIndex}) over ${sig(el)}`
            : 'nothing';
          rec.problems.push(`covered by ${who} at centre`);
        }
      }
    }
    if (els.length && !vis.length)
      rec.problems.push('present but not visible (zero box or hidden)');
    R.controls.push(rec);
  }

  // ---- REScue-owned element census, contrast, blank
  const own = new Set<any>();
  for (const root of document.querySelectorAll('[id^="rescue-"],[class*="rescue-"]')) {
    own.add(root);
    for (const d of root.querySelectorAll('*')) own.add(d);
    if ((root as any).shadowRoot)
      for (const d of (root as any).shadowRoot.querySelectorAll('*')) own.add(d);
  }
  for (const id of HOSTS) {
    const h = document.getElementById(id);
    if (h && h.shadowRoot) for (const d of h.shadowRoot.querySelectorAll('*')) own.add(d);
  }
  R.nodes = own.size;
  const seenSig = new Set<string>();
  for (const el of own) {
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'style' || tag === 'script') continue;
    const text = [...el.childNodes]
      .filter((n: any) => n.nodeType === 3)
      .map((n: any) => n.textContent)
      .join('')
      .trim();
    if (/(^|\s)(undefined|NaN|null|\[object)(\s|$)/.test(text))
      R.blank.push({ sig: sig(el), text: text.slice(0, 60), why: 'bad text' });
    if (!text) {
      const r = el.getBoundingClientRect();
      const hollow =
        !el.children.length &&
        !el.shadowRoot &&
        !(
          tag === 'input' ||
          tag === 'img' ||
          tag === 'hr' ||
          tag === 'textarea' ||
          tag === 'select' ||
          tag === 'svg'
        );
      const cs = getComputedStyle(el);
      if (
        hollow &&
        tag !== 'td' &&
        tag !== 'th' &&
        r.width > 4 &&
        r.height > 4 &&
        cs.backgroundColor === 'rgba(0, 0, 0, 0)' &&
        cs.borderTopWidth === '0px' &&
        !el.getAttribute('aria-hidden')
      )
        R.blank.push({
          sig: sig(el),
          text: '',
          why: `empty visible ${Math.round(r.width)}x${Math.round(r.height)}`,
        });
      continue;
    }
    const fg = parseColor(getComputedStyle(el).color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const op = opacityOf(el);
    const eff = over({ ...fg, a: fg.a * op }, bg);
    const cr = ratio(eff, bg);
    if (op < 0.05) continue; // fully transparent (shown on hover only)
    // WCAG exempts inactive controls (a disabled "up" on the first row is dimmed on purpose).
    if ((el as any).disabled || el.closest?.('button:disabled, fieldset:disabled')) continue;
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) {
      const key = `${sig(el)}|${Math.round(eff.r)},${Math.round(eff.g)},${Math.round(eff.b)}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}`;
      if (seenSig.has(key)) continue;
      seenSig.add(key);
      R.contrast.push({
        sig: sig(el),
        text: text.slice(0, 40),
        ratio: +cr.toFixed(2),
        need,
        fg: `rgb(${Math.round(eff.r)},${Math.round(eff.g)},${Math.round(eff.b)})`,
        bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
        opacity: +op.toFixed(2),
        icon: text.length <= 2,
      });
    }
  }

  // ---- surfaces: theme, viewport containment, what each one covers
  const surfaceSel = [
    '#rescue-tools .rescue-tool-row',
    '#rescue-tools .rescue-banners > *',
    '#rescue-notices .n',
    '#rescue-subreddit-bar',
    '#rescue-menu',
    '#rescue-settings .console',
    '#rescue-cmdline',
    '.rescue-filter-menu',
    '.rescue-tag-editor',
    '.rescue-tags-manager',
    '#rescue-keyhelp',
    '#rescue-shortcut-popup',
    '.rescue-hover',
    '#rescue-saved-comments',
    '.rescue-sc-menu',
  ];
  const surfaces: any[] = [];
  for (const s of surfaceSel) for (const el of qa(s)) if (visible(el)) surfaces.push({ s, el });
  const overlays = [...document.querySelectorAll('[id^="rescue-"],.rescue-overlay,.rescue-hover')];
  for (const { s, el } of surfaces) {
    const r = el.getBoundingClientRect();
    const bg = effectiveBg(el);
    const L = lum(bg);
    const rec: any = {
      sel: s,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
      bgLum: +L.toFixed(3),
      bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      outside: r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1,
    };
    // theme mismatch against the page
    const pageDark = R.theme.pageBgLum < 0.2 || R.theme.redditDark;
    rec.themeMismatch = (pageDark && L > 0.6) || (!pageDark && R.theme.pageBgLum > 0.6 && L < 0.1);
    R.surfaces.push(rec);
  }
  // overlap among REScue surfaces
  // (popups sit above the page chrome on purpose; only the persistent pieces must not collide)
  const PERSIST = [
    '#rescue-tools .rescue-tool-row',
    '#rescue-tools .rescue-banners > *',
    '#rescue-notices .n',
    '#rescue-subreddit-bar',
    '#rescue-saved-comments',
  ];
  const rects = R.surfaces.filter((x: any) => PERSIST.includes(x.sel));
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].rect;
      const b = rects[j].rect;
      const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (w > 4 && h > 4)
        R.overlaps.push(
          `${rects[i].sel} overlaps ${rects[j].sel} by ${Math.round(w)}x${Math.round(h)}`,
        );
    }
  // what do the persistent surfaces cover? (pointer-events off while we look underneath)
  const prev: Array<[any, string]> = overlays.map((o: any) => [o, o.style.pointerEvents]);
  for (const o of overlays) (o as any).style.pointerEvents = 'none';
  const INTERACTIVE =
    'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="menuitem"]';
  const coverSeen = new Set<string>();
  for (const { s, el } of surfaces) {
    if (!(
      s.startsWith('#rescue-tools') ||
      s.startsWith('#rescue-notices') ||
      s === '#rescue-subreddit-bar'
    ))
      continue;
    const r = el.getBoundingClientRect();
    for (let ix = 0; ix < 6; ix++)
      for (let iy = 0; iy < 3; iy++) {
        const x = Math.min(vw - 1, Math.max(0, r.left + ((ix + 0.5) / 6) * r.width));
        const y = Math.min(vh - 1, Math.max(0, r.top + ((iy + 0.5) / 3) * r.height));
        let n: any = deepTop(x, y);
        let found: any = null;
        let g = 0;
        while (n && g++ < 40) {
          if (n.matches && n.matches(INTERACTIVE)) {
            found = n;
            break;
          }
          n = parentOf(n);
        }
        if (found && !isOwn(found)) {
          const label = (
            found.getAttribute('aria-label') ||
            found.textContent ||
            found.getAttribute('href') ||
            ''
          )
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 50);
          const k = `${s}|${found.tagName}|${label}`;
          if (!coverSeen.has(k)) {
            coverSeen.add(k);
            R.covers.push(`${s} covers <${found.tagName.toLowerCase()}> "${label}"`);
          }
        }
      }
  }
  prev.forEach(([o, v]) => ((o as any).style.pointerEvents = v));

  R.hscroll = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  // Only REScue-owned boxes that stick out of the viewport count against REScue (Reddit has its own).
  const scrolled = (el: any): boolean => {
    let n = parentOf(el);
    while (n) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      n = parentOf(n);
    }
    return false;
  };
  R.hscrollOwn = [...own]
    .filter(
      (el: any) =>
        visible(el) &&
        el.getBoundingClientRect().right > vw + 1 &&
        getComputedStyle(el).position !== 'fixed' &&
        !scrolled(el),
    )
    .slice(0, 5)
    .map((el: any) => `${sig(el)} right=${Math.round(el.getBoundingClientRect().right)}`);
  R.counts = {
    posts: document.querySelectorAll('shreddit-post').length,
    searchResults: document.querySelectorAll(
      'search-telemetry-tracker[view-events="search/view/post"]',
    ).length,
    comments: document.querySelectorAll('shreddit-comment').length,
  };
  return R;
};

// ---------------------------------------------------------------------------------------------
// per-visit plumbing
// ---------------------------------------------------------------------------------------------
interface Visit {
  page: Page;
  name: string;
  blocked: boolean;
  console: Array<{ type: string; text: string; url: string }>;
  pageErrors: Array<{ message: string; rescue: boolean }>;
  perf: string[];
  readyMs: number | null;
  loadMs: number | null;
}

const BLOCK_RE =
  /prove your humanity|verify you are (a )?human|are you a human|whoa there, pardner|blocked by network security|captcha|access denied/i;

async function isBlocked(page: Page): Promise<string | null> {
  try {
    const t = await page.evaluate(
      () => `${document.title}\n${(document.body?.innerText ?? '').slice(0, 600)}`,
    );
    const hasApp = await page.evaluate(
      () => !!document.querySelector('shreddit-app, shreddit-post, shreddit-comment'),
    );
    if (BLOCK_RE.test(t) && !hasApp) return t.split('\n')[0]!.slice(0, 100);
    // Signed-in Reddit pages embed idle captcha iframes; only a page with no app content is a challenge.
    const cap = await page.evaluate(
      () => !!document.querySelector('iframe[src*="captcha" i], form input[name="solution"]'),
    );
    if (cap && !hasApp) return 'captcha element';
  } catch {
    /* page navigating */
  }
  return null;
}

async function visit(
  ctx: BrowserContext,
  name: string,
  url: string,
  vw: number,
  waitFor?: string,
): Promise<Visit | null> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: vw, height: 900 });
  const v: Visit = {
    page,
    name,
    blocked: false,
    console: [],
    pageErrors: [],
    perf: [],
    readyMs: null,
    loadMs: null,
  };
  page.on('console', (m) => {
    const text = m.text();
    const url = m.location().url || '';
    if (text.startsWith('[REScue:perf]')) v.perf.push(text.slice(14));
    const mine = /rescue/i.test(text) || url.startsWith('chrome-extension:');
    if ((m.type() === 'error' || m.type() === 'warning') && mine)
      v.console.push({ type: m.type(), text: text.slice(0, 300), url: url.slice(0, 120) });
  });
  page.on('pageerror', (e) =>
    v.pageErrors.push({
      message: e.message.slice(0, 300),
      rescue: /chrome-extension|rescue/i.test(e.stack ?? ''),
    }),
  );
  await page.addInitScript(() => {
    const set = (): boolean => {
      if (document.documentElement) {
        document.documentElement.setAttribute('data-rescue-perf', '1');
        return true;
      }
      return false;
    };
    if (!set())
      new MutationObserver((_m, o) => set() && o.disconnect()).observe(document, {
        childList: true,
      });
  });
  cur.where = `${name} | ${cur.combo}`;
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    issue('major', 'page', `navigation failed: ${(e as Error).message.slice(0, 120)}`);
    await page.close();
    return null;
  }
  v.loadMs = Date.now() - t0;
  const blocked = await isBlocked(page);
  if (blocked) {
    v.blocked = true;
    await shot(page, `${name}-BLOCKED`);
    issue('info', 'page', `blocked by a Reddit challenge (not attempted): ${blocked}`);
    results.push({ combo: cur.combo, page: name, url, blocked });
    return v;
  }
  try {
    await page.waitForSelector('#rescue-gear', { timeout: 25000, state: 'attached' });
    v.readyMs = Date.now() - t0;
  } catch {
    issue('blocker', 'content-script', 'REScue never injected its gear within 25 s of DOM load', {
      cause: 'content script did not run or startup failed (check console errors)',
    });
  }
  if (waitFor)
    await page.waitForSelector(waitFor, { timeout: 20000, state: 'attached' }).catch(() => {});
  await sleep(2500);
  return v;
}

function controlsFor(
  kind: 'listing' | 'thread' | 'search' | 'profile' | 'other',
  _route: string,
): ControlSpec[] {
  const base: ControlSpec[] = [
    // The header button replaces the (then hidden) corner gear; the gear is only the fallback.
    {
      name: 'menu opener',
      sel: '#rescue-header-button, #rescue-gear',
      expect: true,
    },
  ];
  if (kind === 'listing' || kind === 'search')
    base.push(
      { name: 'filter button', sel: '.rescue-filter-btn', expect: true },
      { name: 'single-click [l+c]', sel: '.rescue-single-click', expect: kind === 'listing' },
      { name: 'tag button', sel: '.rescue-tag-btn', expect: kind === 'listing' },
      { name: 'upvote ratio', sel: '.rescue-upvote-ratio', expect: kind === 'listing' },
    );
  if (kind === 'thread')
    base.push(
      { name: 'tag button', sel: '.rescue-tag-btn', expect: true },
      { name: 'hide child comments', sel: '.rescue-hide-children', expect: true },
      { name: 'show parent', sel: '.rescue-show-parent', expect: true },
      { name: 'save-RES', sel: '.rescue-save-comment', expect: true },
      { name: 'single-click [l+c]', sel: '.rescue-single-click', expect: false },
      { name: 'upvote ratio', sel: '.rescue-upvote-ratio', expect: true },
    );
  if (kind === 'profile') base.push({ name: 'tag button', sel: '.rescue-tag-btn', expect: false });
  return base;
}

/** Run the audit, record issues, keep the raw data. */
async function audit(
  v: Visit,
  label: string,
  kind: Parameters<typeof controlsFor>[0],
  route: string,
  opts: { popup?: boolean } = {},
): Promise<any> {
  let R: any;
  try {
    // With every reply hidden ("hide-all") the reply-only controls are legitimately not visible.
    const controls = opts.popup
      ? []
      : controlsFor(kind, route).filter(
          (c) => !(label === 'hide-all' && ['show parent', 'hide child comments'].includes(c.name)),
        );
    R = await v.page.evaluate(AUDIT, { controls });
  } catch (e) {
    issue('major', 'harness', `audit threw: ${(e as Error).message.slice(0, 120)}`, {
      dedupe: `audit-throw-${label}`,
    });
    return null;
  }
  const where = `${v.name}/${label}`;
  if (!opts.popup) {
    for (const c of R.controls) {
      if (c.expect && c.found === 0)
        issue('major', `control:${c.name}`, `expected control not found on ${kind} page`, {
          dedupe: `missing-${c.name}-${kind}-${cur.combo}`,
        });
      for (const p of c.problems)
        issue('major', `control:${c.name}`, p, {
          dedupe: `prob-${c.name}-${p.replace(/\d+/g, '#')}-${cur.where}`,
        });
    }
  }
  const pg = `${v.name}`;
  for (const c of R.contrast)
    issue(
      // A faded element (a closing notice) is not meant to be read at that moment: info only.
      c.opacity < 0.5 ? 'info' : c.icon ? 'cosmetic' : 'minor',
      `contrast:${c.sig}`,
      `text "${c.text}" contrast ${c.ratio}:1 (needs ${c.need}) fg ${c.fg} on ${c.bg}, effective opacity ${c.opacity}`,
      {
        dedupe: `contrast-${c.sig}-${c.fg}-${c.bg}-${cur.combo}`,
      },
    );
  for (const s of R.surfaces) {
    if (s.themeMismatch)
      issue(
        'major',
        `theme:${s.sel}`,
        `surface background ${s.bg} (lum ${s.bgLum}) does not match the page (${R.theme.pageBg}, lum ${R.theme.pageBgLum}, redditDark=${R.theme.redditDark}, osDark=${R.theme.osDark})`,
        { dedupe: `theme-${s.sel}-${cur.combo}-${pg}` },
      );
    if (s.outside)
      issue(
        'major',
        `popup:${s.sel}`,
        `extends outside the ${R.vw}x${R.vh} viewport: ${s.rect.join(',')}`,
        { dedupe: `outside-${s.sel}-${cur.combo}-${pg}` },
      );
  }
  for (const o of R.overlaps)
    issue('major', 'overlap', o, { dedupe: `overlap-${o}-${cur.combo}-${pg}` });
  for (const c of R.covers)
    issue('info', 'covers-reddit', c, { dedupe: `covers-${c}-${cur.combo}-${pg}` });
  for (const b of R.blank)
    issue('minor', `blank:${b.sig}`, `${b.why}${b.text ? ` "${b.text}"` : ''}`, {
      dedupe: `blank-${b.sig}-${b.why}-${cur.combo}-${pg}`,
    });
  if (R.hscrollOwn.length)
    issue('minor', 'layout', `REScue boxes stick out of the viewport: ${R.hscrollOwn.join('; ')}`, {
      dedupe: `hscroll-${cur.combo}-${pg}`,
    });
  void where;
  return R;
}

function finishVisit(v: Visit, extra: Record<string, unknown> = {}): void {
  for (const c of v.console)
    issue('major', 'console', `${c.type}: ${c.text}`, {
      dedupe: `console-${c.text.slice(0, 80)}-${cur.combo}`,
    });
  for (const e of v.pageErrors)
    issue(e.rescue ? 'major' : 'info', e.rescue ? 'pageerror' : 'pageerror-reddit', e.message, {
      dedupe: `pageerror-${e.message.slice(0, 80)}-${cur.combo}`,
    });
  results.push({
    combo: cur.combo,
    page: v.name,
    loadMs: v.loadMs,
    readyMs: v.readyMs,
    perfBatches: v.perf.length,
    perfSample: v.perf.slice(0, 5),
    console: v.console,
    pageErrors: v.pageErrors,
    ...extra,
  });
  save();
}

// ---------------------------------------------------------------------------------------------
// discovery: a big thread and a custom feed
// ---------------------------------------------------------------------------------------------
const shared: { thread?: string; threadComments?: number; feed?: string } = {};

async function discoverThread(v: Visit): Promise<void> {
  if (shared.thread) return;
  const found = await v.page.evaluate(() => {
    const posts = [...document.querySelectorAll('shreddit-post')].map((p) => ({
      link: p.getAttribute('permalink') ?? '',
      cc: Number(p.getAttribute('comment-count') ?? 0),
    }));
    return posts.filter((p) => p.link).sort((a, b) => b.cc - a.cc)[0] ?? null;
  });
  if (found && found.cc >= 500) {
    shared.thread = new URL(found.link, 'https://www.reddit.com').href;
    shared.threadComments = found.cc;
  } else if (found) {
    shared.thread = new URL(found.link, 'https://www.reddit.com').href;
    shared.threadComments = found.cc;
    notTested.push(
      `No 500+ comment thread on r/science; used ${found.cc} comments (${shared.thread}).`,
    );
  }
}

async function discoverFeed(v: Visit): Promise<void> {
  if (shared.feed !== undefined) return;
  shared.feed = await v.page.evaluate(() => {
    const walk = (root: any, out: string[]): void => {
      for (const a of root.querySelectorAll('a[href]')) out.push((a as HTMLAnchorElement).href);
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, out);
    };
    const all: string[] = [];
    walk(document, all);
    return (
      all.find((h) => /\/(user|u)\/[^/]+\/m\/[^/]+\/?$/.test(h) || /\/me\/m\/[^/]+\/?$/.test(h)) ??
      ''
    );
  });
}

// ---------------------------------------------------------------------------------------------
// the static pass: every page x combo
// ---------------------------------------------------------------------------------------------
interface PageSpec {
  name: string;
  url: () => string | undefined;
  kind: 'listing' | 'thread' | 'search' | 'profile' | 'other';
  route: string;
  wait?: string;
}

const PAGES: PageSpec[] = [
  {
    name: 'front',
    url: () => 'https://www.reddit.com/',
    kind: 'listing',
    route: 'front',
    wait: 'shreddit-post',
  },
  {
    name: 'r-science',
    url: () => 'https://www.reddit.com/r/science/',
    kind: 'listing',
    route: 'subreddit',
    wait: 'shreddit-post',
  },
  {
    name: 'r-all',
    url: () => 'https://www.reddit.com/r/all/',
    kind: 'listing',
    route: 'all',
    wait: 'shreddit-post',
  },
  {
    name: 'thread-www',
    url: () => shared.thread,
    kind: 'thread',
    route: 'thread',
    wait: 'shreddit-comment',
  },
  {
    name: 'search',
    url: () => 'https://www.reddit.com/search/?q=science&type=posts',
    kind: 'search',
    route: 'search',
    wait: 'search-telemetry-tracker',
  },
  {
    name: 'user-spez',
    url: () => 'https://www.reddit.com/user/spez/',
    kind: 'profile',
    route: 'profile',
    wait: 'shreddit-post, shreddit-comment',
  },
  {
    name: 'sh-listing',
    url: () => 'https://sh.reddit.com/r/science/',
    kind: 'listing',
    route: 'subreddit',
    wait: 'shreddit-post',
  },
  {
    name: 'sh-thread',
    url: () => (shared.thread ? shared.thread.replace('://www.', '://sh.') : undefined),
    kind: 'thread',
    route: 'thread',
    wait: 'shreddit-comment',
  },
  {
    name: 'custom-feed',
    url: () => shared.feed || undefined,
    kind: 'listing',
    route: 'feed',
    wait: 'shreddit-post',
  },
];

async function openGearAndAudit(v: Visit, kind: PageSpec['kind'], route: string): Promise<void> {
  if (!(await v.page.locator('#rescue-gear, #rescue-header-button').count())) return;
  try {
    await openGearMenu(v.page);
    await sleep(500);
    await shot(v.page, `${v.name}-gear-menu`);
    const R = await audit(v, 'menu', kind, route, { popup: true });
    const ids = await v.page.$$eval('#rescue-menu [data-menu-id]', (els) =>
      els.map((e) => e.getAttribute('data-menu-id')),
    );
    if (!ids.length) issue('major', 'gear menu', 'menu opened with no items');
    // Thread tools and the subreddit filter live in the menu now (no strip controls to assert).
    const want =
      kind === 'thread'
        ? ['hideAllReplies', 'savedComments', 'commentNavigator']
        : route === 'subreddit'
          ? ['filterSubreddit']
          : [];
    for (const id of want)
      if (!ids.includes(id))
        issue('major', 'gear menu', `menu row "${id}" missing on ${v.name}`, {
          dedupe: `menu-row-${id}-${kind}-${route}-${cur.combo}`,
        });
    results.push({
      combo: cur.combo,
      gearMenu: v.name,
      items: ids,
      menuAudit: R && { surfaces: R.surfaces, covers: R.covers },
    });
    await v.page.keyboard.press('Escape');
    await sleep(250);
  } catch (e) {
    issue(
      'major',
      'gear menu',
      `could not open the gear menu: ${(e as Error).message.slice(0, 100)}`,
    );
  }
}

async function staticPass(ctx: BrowserContext, vw: number): Promise<void> {
  for (const spec of PAGES) {
    const url = spec.url();
    cur.where = `${spec.name} | ${cur.combo}`;
    if (!url) {
      notTested.push(
        `${spec.name} (${cur.combo}): no URL available (${spec.name === 'custom-feed' ? 'no custom feed link found in the left navigation' : 'thread discovery failed'}).`,
      );
      continue;
    }
    console.log(`\n== ${cur.combo} :: ${spec.name} ${url}`);
    const v = await visit(ctx, spec.name, url, vw, spec.wait);
    if (!v) continue;
    if (v.blocked) {
      await v.page.close();
      await sleep(PAUSE);
      continue;
    }
    if (spec.name === 'r-science') await discoverThread(v);
    if (spec.name === 'front') await discoverFeed(v);
    const t1 = Date.now();
    const decorated = await v.page
      .waitForSelector(
        '.rescue-filter-btn, .rescue-tag-btn, .rescue-hide-children, .rescue-single-click',
        { timeout: 15000, state: 'attached' },
      )
      .then(() => Date.now() - t1)
      .catch(() => null);
    await shot(v.page, `${spec.name}-load`);
    const A1 = await audit(v, 'load', spec.kind, spec.route);
    // scroll: lazily hydrated rows, the back-to-top control, the strip over real content
    await v.page.mouse.wheel(0, 1800);
    await sleep(1800);
    await shot(v.page, `${spec.name}-scrolled`);
    const A2 = await audit(v, 'scrolled', spec.kind, spec.route);
    const topBtn = await v.page.locator('.rescue-back-to-top').count();
    const extra = await v.page.evaluate(() => {
      const logo = document.querySelector(
        'header a[href="/"], header a[aria-label*="home" i], #reddit-logo',
      );
      return {
        finalUrl: location.href,
        logoHref: logo ? logo.getAttribute('href') : null,
        styleTweaks: !!document.getElementById('rescue-style-tweaks'),
        userCss: !!document.getElementById('rescue-user-css'),
      };
    });
    await openGearAndAudit(v, spec.kind, spec.route);
    finishVisit(v, {
      decoratedMs: decorated,
      counts: A1?.counts,
      theme: A1?.theme,
      controls: A1?.controls?.map((c: any) => ({
        n: c.name,
        found: c.found,
        vis: c.visible,
        p: c.problems,
      })),
      scrolledControls: A2?.controls?.map((c: any) => ({
        n: c.name,
        found: c.found,
        vis: c.visible,
        p: c.problems,
      })),
      backToTop: topBtn,
      ...extra,
      nodes: A1?.nodes,
      surfaces: A1?.surfaces,
    });
    await v.page.close();
    await sleep(PAUSE);
  }
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  if (!existsSync(join(EXT, 'manifest.json'))) {
    console.error(`Extension not built at ${EXT}. Run npm run build first.`);
    process.exit(2);
  }
  const profile = prepareProfile();
  console.log(`profile copy: ${profile}\nout: ${OUT}\nextension: ${EXT}`);
  for (const theme of THEMES) {
    const ctx = await launch(theme, profile);
    let original: Record<string, any> = {};
    try {
      await sleep(1500);
      original = await storeAll(ctx);
      if (!shared.thread) {
        cur.combo = `${theme}-discover`;
        for (const [name, url, fn] of [
          ['r-science', 'https://www.reddit.com/r/science/', discoverThread],
          ['front', 'https://www.reddit.com/', discoverFeed],
        ] as const) {
          const dv = await visit(ctx, `discover-${name}`, url, WIDTHS[0] ?? 1280, 'shreddit-post');
          if (dv && !dv.blocked) await fn(dv);
          await dv?.page.close();
          await sleep(PAUSE);
        }
        console.log(
          `thread: ${shared.thread} (${shared.threadComments} comments); feed: ${shared.feed || 'none'}`,
        );
      }
      for (const vw of WIDTHS) {
        cur.combo = `${theme}-${vw}`;
        if (want('static')) await staticPass(ctx, vw);
        await interactPasses(ctx, theme, vw);
      }
    } catch (e) {
      console.error('FATAL in', theme, e);
      issue('major', 'harness', `run aborted: ${(e as Error).message.slice(0, 200)}`);
    } finally {
      try {
        await storeReplace(ctx, original);
      } catch {
        notTested.push(
          'Extension storage could not be restored to its starting state (profile copy only).',
        );
      }
      save();
      await ctx.close();
    }
  }
  save();
  console.log(`\nDone. ${issues.length} issues recorded. ${join(OUT, 'issues.json')}`);
}

// ---------------------------------------------------------------------------------------------
// interaction helpers
// ---------------------------------------------------------------------------------------------
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`  - ${name}`);
  try {
    await fn();
  } catch (e) {
    issue(
      'major',
      `step:${name}`,
      `step failed (feature broken or not reachable): ${(e as Error).message.split('\n')[0]!.slice(0, 200)}`,
      { dedupe: `stepfail-${name}-${cur.combo}` },
    );
  }
}

const blur = (p: Page): Promise<void> =>
  p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

/** The first element matching `sel` whose centre is in the viewport, clear of Reddit's header and REScue's strip. */
async function inView(
  p: Page,
  sel: string,
): Promise<import('@playwright/test').ElementHandle | null> {
  const h = await p.evaluateHandle((s) => {
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (
        r.width > 0 &&
        r.height > 0 &&
        r.top > 80 &&
        r.bottom < innerHeight - 140 &&
        r.left >= 0 &&
        r.right <= innerWidth
      )
        return el;
    }
    return null;
  }, sel);
  return h.asElement();
}

/** Scroll the first visible match to the middle of the viewport and return it (null when none is rendered). */
async function inViewScroll(
  p: Page,
  sel: string,
): Promise<import('@playwright/test').ElementHandle | null> {
  const h = await p.evaluateHandle((s) => {
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        el.scrollIntoView({ block: 'center' });
        return el;
      }
    }
    return null;
  }, sel);
  await sleep(500);
  return h.asElement();
}

async function appears(
  p: Page,
  sel: string,
  module: string,
  what: string,
  sev: Sev = 'major',
  timeout = 4000,
): Promise<boolean> {
  try {
    await p.locator(sel).first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    issue(sev, module, `${what}: ${sel} did not appear`, {
      dedupe: `appear-${module}-${what}-${cur.combo}`,
    });
    return false;
  }
}

async function gone(
  p: Page,
  sel: string,
  module: string,
  what: string,
  timeout = 3000,
): Promise<boolean> {
  try {
    await p.locator(sel).first().waitFor({ state: 'detached', timeout });
    return true;
  } catch {
    issue('major', module, `${what}: ${sel} is still there`, {
      dedupe: `gone-${module}-${what}-${cur.combo}`,
    });
    return false;
  }
}

/** The visible menu opener: the header button, or the corner gear when the header anchor is missing. */
const MENU_OPENER = '#rescue-header-button:visible, #rescue-gear:visible';

/** Opens REScue's menu (a no-op when it is already open). */
async function openGearMenu(p: Page): Promise<void> {
  if (await p.locator('#rescue-menu').count()) return;
  await p.locator(MENU_OPENER).first().click({ timeout: 5000 });
  await p.locator('#rescue-menu').waitFor({ state: 'visible', timeout: 4000 });
}

/** The label of a menu row (null when the page does not list it); leaves the menu closed. */
async function menuRow(p: Page, id: string): Promise<string | null> {
  await openGearMenu(p);
  const row = p.locator(`#rescue-menu [data-menu-id="${id}"]`);
  const text = (await row.count()) ? ((await row.first().textContent()) ?? '').trim() : null;
  await p.keyboard.press('Escape');
  await p
    .locator('#rescue-menu')
    .waitFor({ state: 'detached', timeout: 3000 })
    .catch(() => {});
  return text;
}

/** Clicks a menu row by id (the menu closes itself for action rows). */
async function menuClick(p: Page, id: string): Promise<void> {
  await openGearMenu(p);
  await p.locator(`#rescue-menu [data-menu-id="${id}"]`).click({ timeout: 4000 });
  await sleep(300);
}

/** The comment navigator is hidden by default; shows it through its menu row. */
async function showNavigator(p: Page): Promise<Locator> {
  const nav = p.locator('.rescue-comment-nav');
  if (!(await nav.isVisible().catch(() => false))) await menuClick(p, 'commentNavigator');
  await nav.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  return nav;
}

async function openConsole(p: Page): Promise<void> {
  await openGearMenu(p);
  await p.locator('#rescue-menu [data-menu-id="settings"]').click();
  await p.locator('#rescue-settings .console').waitFor({ state: 'visible', timeout: 5000 });
  await sleep(400);
}

async function closeConsole(p: Page): Promise<void> {
  await p.keyboard.press('Escape');
  await sleep(300);
  if (await p.locator('#rescue-settings').count())
    await p
      .locator('#rescue-settings .close')
      .click({ timeout: 2000 })
      .catch(() => {});
}

/** Inspect the console box: size, inner overflow and scrollability. */
async function consoleMetrics(p: Page): Promise<any> {
  return p.evaluate(() => {
    const host = document.getElementById('rescue-settings');
    const sr = host?.shadowRoot;
    const con = sr?.querySelector('.console') as HTMLElement | null;
    const main = sr?.querySelector('main') as HTMLElement | null;
    const nav = sr?.querySelector('nav') as HTMLElement | null;
    if (!con) return null;
    const r = con.getBoundingClientRect();
    return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      vw: innerWidth,
      vh: innerHeight,
      mainScrollW: main?.scrollWidth,
      mainClientW: main?.clientWidth,
      mainScrollH: main?.scrollHeight,
      mainClientH: main?.clientHeight,
      navW: nav?.getBoundingClientRect().width,
      navH: nav?.getBoundingClientRect().height,
      conScrollW: con.scrollWidth,
      conClientW: con.clientWidth,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// popup pass (every combo): the REScue popups must be themed, readable and inside the viewport
// ---------------------------------------------------------------------------------------------
async function popupPassListing(v: Visit, route: string): Promise<void> {
  const p = v.page;
  await step('settings console', async () => {
    await openConsole(p);
    await shot(p, `${v.name}-console-core`);
    await audit(v, 'console', 'listing', route, { popup: true });
    const m = await consoleMetrics(p);
    if (m) {
      if (m.mainScrollW > m.mainClientW + 1)
        issue(
          'minor',
          'settings console',
          `main pane scrolls horizontally (${m.mainScrollW} > ${m.mainClientW})`,
          { dedupe: `console-hscroll-${cur.combo}` },
        );
      if (
        m.rect[0] < 0 ||
        m.rect[1] < 0 ||
        m.rect[0] + m.rect[2] > m.vw + 1 ||
        m.rect[1] + m.rect[3] > m.vh + 1
      )
        issue(
          'major',
          'settings console',
          `console box ${m.rect.join(',')} is outside the ${m.vw}x${m.vh} viewport`,
          { dedupe: `console-outside-${cur.combo}` },
        );
    }
    await p.locator('#rescue-settings nav button', { hasText: 'Browsing' }).click();
    await sleep(400);
    await shot(p, `${v.name}-console-browsing`);
    await audit(v, 'console-browsing', 'listing', route, { popup: true });
    await closeConsole(p);
    await gone(p, '#rescue-settings', 'settings console', 'Escape closes the console');
  });

  await step('command line', async () => {
    await blur(p);
    await p.keyboard.press('.');
    if (
      !(await appears(
        p,
        '#rescue-cmdline input',
        'commandLine',
        'pressing . opens the command line',
      ))
    )
      return;
    await shot(p, `${v.name}-cmdline`);
    await audit(v, 'cmdline', 'listing', route, { popup: true });
    await p.keyboard.type('?');
    await p.keyboard.press('Enter');
    await sleep(400);
    const lines = await p.locator('#rescue-cmdline li').count();
    if (!lines)
      issue('major', 'commandLine', '? then Enter listed no commands', {
        dedupe: `cmd-list-${cur.combo}`,
      });
    await shot(p, `${v.name}-cmdline-list`);
    await audit(v, 'cmdline-list', 'listing', route, { popup: true });
    await p.keyboard.press('Escape');
    await gone(p, '#rescue-cmdline', 'commandLine', 'Escape closes the command line');
  });

  await step('filter menu', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    const btn = await inView(p, '.rescue-filter-btn');
    if (!btn)
      return issue('major', 'filteReddit', 'no ⊘ button in the viewport to open', {
        dedupe: `no-filter-btn-${cur.combo}`,
      });
    await btn.click();
    if (
      !(await appears(p, '.rescue-filter-menu', 'filteReddit', 'clicking ⊘ opens the filter menu'))
    )
      return;
    await shot(p, `${v.name}-filter-menu`);
    await audit(v, 'filter-menu', 'listing', route, { popup: true });
    const labels = await p.locator('.rescue-filter-menu .rescue-filter-item').allTextContents();
    results.push({ combo: cur.combo, filterMenuItems: labels, page: v.name });
    await p.keyboard.press('Escape');
    await gone(p, '.rescue-filter-menu', 'filteReddit', 'Escape closes the ⊘ menu');
  });

  await step('tag editor', async () => {
    const btn = await inView(p, '.rescue-tag-btn');
    if (!btn)
      return issue('major', 'userTagger', 'no 🏷 button in the viewport to open', {
        dedupe: `no-tag-btn-${cur.combo}`,
      });
    await btn.click();
    if (!(await appears(p, '.rescue-tag-editor', 'userTagger', 'clicking 🏷 opens the tag editor')))
      return;
    await p.locator('.rescue-tag-editor input[name=text]').fill('smoke');
    await p.locator('.rescue-tag-editor .rescue-swatch').first().click();
    await shot(p, `${v.name}-tag-editor`);
    await audit(v, 'tag-editor', 'listing', route, { popup: true });
    await p.keyboard.press('Escape');
    await gone(p, '.rescue-tag-editor', 'userTagger', 'Escape closes the tag editor');
  });

  await step('keyboard help and selection', async () => {
    await blur(p);
    await p.keyboard.press('?');
    if (await appears(p, '#rescue-keyhelp', 'keyboardNav', 'pressing ? opens the key help')) {
      await shot(p, `${v.name}-keyhelp`);
      await audit(v, 'keyhelp', 'listing', route, { popup: true });
      await p.keyboard.press('Escape');
      await gone(p, '#rescue-keyhelp', 'keyboardNav', 'Escape closes the key help');
    }
    await p.keyboard.press('j');
    await sleep(500);
    if (await appears(p, '#rescue-selection', 'keyboardNav', 'j draws the selection outline')) {
      await shot(p, `${v.name}-selected`);
      await audit(v, 'selected', 'listing', route, { popup: true });
    }
    await p.keyboard.press('k');
    await p.keyboard.press('Escape');
  });
}

async function popupPassThread(v: Visit, route: string): Promise<void> {
  const p = v.page;
  await step('show parent popup', async () => {
    const link = await inViewScroll(p, '.rescue-show-parent');
    if (!link)
      return issue('minor', 'showParent', 'no "↑ parent" link rendered on the thread', {
        dedupe: `no-parent-link-${cur.combo}`,
      });
    await link.hover();
    if (
      !(await appears(
        p,
        '.rescue-hover .rescue-parent-preview',
        'showParent',
        'hovering ↑ parent shows the parent preview',
        'major',
        3000,
      ))
    )
      return;
    await shot(p, `${v.name}-parent-popup`);
    await audit(v, 'parent-popup', 'thread', route, { popup: true });
    await p.mouse.move(2, 2);
    await sleep(500);
  });

  await step('saved list', async () => {
    await menuClick(p, 'savedComments');
    if (
      !(await appears(
        p,
        '#rescue-saved-comments',
        'saveComments',
        'the Saved button opens the saved list',
      ))
    )
      return;
    await shot(p, `${v.name}-saved-list`);
    await audit(v, 'saved-list', 'thread', route, { popup: true });
    await p.keyboard.press('Escape');
    await sleep(300);
    if (await p.locator('#rescue-saved-comments').count())
      await p
        .locator('#rescue-saved-comments [aria-label*="lose"], #rescue-saved-comments button')
        .first()
        .click({ timeout: 1500 })
        .catch(() => {});
  });

  await step('comment navigator', async () => {
    const nav = await showNavigator(p);
    const options = await nav.locator('select option').allTextContents();
    results.push({ combo: cur.combo, page: v.name, navigatorCategories: options });
    await shot(p, `${v.name}-navigator`);
    await audit(v, 'navigator', 'thread', route, { popup: true });
  });
}

async function popupPass(ctx: BrowserContext, vw: number): Promise<void> {
  for (const spec of [PAGES[1]!, PAGES[3]!]) {
    const url = spec.url();
    if (!url) continue;
    cur.where = `${spec.name} popups | ${cur.combo}`;
    console.log(`\n== popups ${cur.combo} :: ${spec.name}`);
    const v = await visit(ctx, `${spec.name}-popups`, url, vw, spec.wait);
    if (!v || v.blocked) continue;
    await sleep(1500);
    if (spec.kind === 'thread') await popupPassThread(v, spec.route);
    else await popupPassListing(v, spec.route);
    finishVisit(v, { popups: true });
    await v.page.close();
    await sleep(PAUSE);
  }
}

// ---------------------------------------------------------------------------------------------
// feature pass (light 1280 only): exercise every control with REScue defaults
// ---------------------------------------------------------------------------------------------
const THREAD_ID = (): string => (shared.thread ?? '').match(/\/comments\/([a-z0-9]+)/i)?.[1] ?? '';

async function featGear(v: Visit, route: string): Promise<void> {
  const p = v.page;
  await step('gear: items, keyboard, close behaviours', async () => {
    await openGearMenu(p);
    const items = await p.$$eval(
      '#rescue-menu [data-menu-id], #rescue-menu button[aria-label]',
      (els) =>
        els.map((e) => ({
          id: e.getAttribute('data-menu-id'),
          label: (e.textContent ?? '').trim().slice(0, 40),
          role: e.getAttribute('role'),
          checked: e.getAttribute('aria-checked'),
          aria: e.getAttribute('aria-label'),
        })),
    );
    results.push({ combo: cur.combo, page: v.name, gearItems: items });
    for (const id of ['settings', 'commandLine', 'about'])
      if (!items.some((i) => i.id === id))
        issue('major', 'gear menu', `menu item "${id}" missing`, { dedupe: `gear-missing-${id}` });
    if (!items.some((i) => i.id?.startsWith('quick:')))
      issue('minor', 'gear menu', 'no quick toggle rows in the menu', { dedupe: 'gear-no-quick' });
    await shot(p, `${v.name}-gear-open`);
    // keyboard
    const focusId = (): Promise<string | null> =>
      p.evaluate(
        () =>
          (document.activeElement as HTMLElement | null)?.getAttribute?.('data-menu-id') ??
          (document.activeElement as HTMLElement | null)?.getAttribute?.('aria-label') ??
          null,
      );
    const f0 = await focusId();
    await p.keyboard.press('ArrowDown');
    const f1 = await focusId();
    await p.keyboard.press('End');
    const fEnd = await focusId();
    await p.keyboard.press('Home');
    const fHome = await focusId();
    if (f0 === f1)
      issue('minor', 'gear menu', 'ArrowDown did not move focus', { dedupe: 'gear-arrow' });
    if (!fEnd || fEnd === fHome)
      issue(
        'minor',
        'gear menu',
        `Home/End do not reach different rows (home=${fHome} end=${fEnd})`,
        { dedupe: 'gear-homeend' },
      );
    await p.keyboard.press('Escape');
    if (!(await gone(p, '#rescue-menu', 'gear menu', 'Escape closes the menu'))) return;
    await openGearMenu(p);
    await p.keyboard.press('Tab');
    await gone(p, '#rescue-menu', 'gear menu', 'Tab closes the menu');
    await openGearMenu(p);
    await p.evaluate(() =>
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })),
    );
    await gone(p, '#rescue-menu', 'gear menu', 'an outside click closes the menu');
  });

  await step('gear: quick toggles and notices', async () => {
    await openGearMenu(p);
    const toggles = p.locator('#rescue-menu [role="menuitemcheckbox"]');
    const n = await toggles.count();
    results.push({ combo: cur.combo, quickToggles: n });
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const t = toggles.nth(i);
      const id = await t.getAttribute('data-menu-id');
      const before = await t.getAttribute('aria-checked');
      await t.click();
      await sleep(400);
      const after = await t.getAttribute('aria-checked');
      if (before === after)
        issue('major', 'gear menu', `toggle ${id} did not flip (${before})`, {
          dedupe: `gear-toggle-${id}`,
        });
      if (i === 0) {
        await shot(p, `${v.name}-gear-toggle-notice`);
        await audit(v, 'notice', 'listing', route, { popup: true });
        const notice = p.locator('#rescue-notices .n').first();
        if (await notice.count()) {
          const hasHead = await notice.locator('.head').count();
          const link = await notice.locator('a[href^="#rescue:settings/"]').count();
          const mute = await notice.locator('.mute-box').count();
          const close = await notice.locator('button.close').count();
          results.push({
            combo: cur.combo,
            notice: {
              head: hasHead,
              settingsLink: link,
              mute,
              close,
              text: (await notice.locator('.msg').textContent()) ?? '',
            },
          });
          if (!hasHead || !link)
            issue(
              'minor',
              'notices',
              `notice lacks a module header (${hasHead}) or settings link (${link})`,
              { dedupe: 'notice-head' },
            );
          if (!mute)
            issue('minor', 'notices', 'notice has no mute checkbox', { dedupe: 'notice-mute' });
          if (link) {
            await notice.locator('a[href^="#rescue:settings/"]').click();
            if (
              await appears(
                p,
                '#rescue-settings .console',
                'notices',
                'the notice settings link opens the console',
              )
            ) {
              await shot(p, `${v.name}-notice-settings-link`);
              await closeConsole(p);
            }
          }
          if (mute) {
            await notice
              .locator('.mute-box')
              .check()
              .catch(() => {});
            await sleep(300);
          }
        } else {
          issue('minor', 'notices', `toggling ${id} showed no notice`, {
            dedupe: `notice-none-${id}`,
          });
        }
        await openGearMenu(p).catch(() => {});
      }
      // flip back
      const t2 = p.locator('#rescue-menu [role="menuitemcheckbox"]').nth(i);
      if (await t2.count()) {
        if ((await t2.getAttribute('aria-checked')) !== before) await t2.click();
      }
    }
    await p.keyboard.press('Escape');
  });
}

async function featConsole(v: Visit, route: string): Promise<void> {
  const p = v.page;
  await step('console: categories, theme, overflow', async () => {
    await openConsole(p);
    const cats = await p.locator('#rescue-settings nav button').allTextContents();
    for (const cat of cats) {
      await p.locator('#rescue-settings nav button', { hasText: cat }).first().click();
      await sleep(350);
      await shot(p, `${v.name}-console-${cat}`);
      await audit(v, `console-${cat}`, 'listing', route, { popup: true });
      const m = await consoleMetrics(p);
      results.push({ combo: cur.combo, consoleMetrics: { cat, ...m } });
      if (m && m.mainScrollW > m.mainClientW + 1)
        issue(
          'minor',
          'settings console',
          `${cat}: main pane scrolls horizontally (${m.mainScrollW} > ${m.mainClientW})`,
          { dedupe: `console-h-${cat}-${cur.combo}` },
        );
    }
    await closeConsole(p);
  });

  await step('console: search', async () => {
    await openConsole(p);
    const input = p.locator('#rescue-settings input.search');
    await input.fill('filter');
    await sleep(500);
    const n = await p.locator('#rescue-settings section.module').count();
    if (!n)
      issue('major', 'settings console', 'search "filter" matched no module', {
        dedupe: 'console-search-none',
      });
    const marks = await p.locator('#rescue-settings mark').count();
    results.push({ combo: cur.combo, consoleSearch: { query: 'filter', modules: n, marks } });
    await shot(p, `${v.name}-console-search`);
    await input.fill('zzqqxx');
    await sleep(300);
    if (!(await p.locator('#rescue-settings .empty').count()))
      issue(
        'minor',
        'settings console',
        'search with no match shows no "No settings match" message',
        { dedupe: 'console-search-empty' },
      );
    await input.fill('');
    await closeConsole(p);
  });

  await step('console: advanced, reset, defaults', async () => {
    await openConsole(p);
    await p.locator('#rescue-settings nav button', { hasText: 'Comments' }).click();
    await sleep(300);
    const adv = p.locator('#rescue-settings input[data-setting="showAdvanced"]');
    const before = await p.locator('#rescue-settings [data-option]').count();
    await adv.check();
    await sleep(400);
    const after = await p.locator('#rescue-settings [data-option]').count();
    results.push({ combo: cur.combo, advanced: { before, after } });
    if (after <= before)
      issue(
        'major',
        'settings console',
        `ticking "Show advanced options" revealed no extra options (${before} -> ${after})`,
        { dedupe: 'console-adv' },
      );
    const key = 'showParent.hoverDelay';
    const box = p.locator(`#rescue-settings [data-option="${key}"]`);
    if (!(await box.count()))
      return issue('major', 'settings console', `${key} not visible with advanced on`, {
        dedupe: 'console-adv-key',
      });
    await box.fill('750');
    await box.blur();
    await sleep(500);
    const reset = p.locator(`#rescue-settings [data-reset="${key}"]`);
    if (!(await reset.count()))
      issue('major', 'settings console', 'no per-option reset after changing a value', {
        dedupe: 'console-reset-missing',
      });
    else {
      await shot(p, `${v.name}-console-changed`);
      await reset.click();
      await sleep(300);
      if ((await box.inputValue()) !== '300')
        issue(
          'major',
          'settings console',
          `reset did not restore the default (value ${await box.inputValue()})`,
          { dedupe: 'console-reset-wrong' },
        );
    }
    await box.fill('900');
    await box.blur();
    p.once('dialog', (d) => void d.accept());
    await p.locator('#rescue-settings [data-reset-module="showParent"]').click();
    await sleep(500);
    if ((await box.inputValue()) !== '300')
      issue('major', 'settings console', 'Reset module to defaults did not restore the value', {
        dedupe: 'console-resetmod',
      });
    await adv.uncheck();
    await closeConsole(p);
  });

  await step('console: table add, reorder, toggle module', async () => {
    await openConsole(p);
    await p.locator('#rescue-settings nav button', { hasText: 'Browsing' }).click();
    await sleep(300);
    const table = p.locator('#rescue-settings [data-option="filteReddit.rules"]');
    await table.locator('button[data-action="add"]').click();
    await table.locator('button[data-action="add"]').click();
    const pats = table.locator('tbody input[data-col="pattern"]');
    await pats.nth(0).fill('smokefirst');
    await pats.nth(0).blur();
    await pats.nth(1).fill('smokesecond');
    await pats.nth(1).blur();
    await shot(p, `${v.name}-console-table`);
    await audit(v, 'console-table', 'listing', route, { popup: true });
    await table.locator('tbody tr').nth(0).locator('button[data-action="move-down"]').click();
    await sleep(300);
    if ((await pats.nth(0).inputValue()) !== 'smokesecond')
      issue('major', 'settings console', 'move-down did not reorder table rows', {
        dedupe: 'console-table-move',
      });
    const dragHandle = await table
      .locator('tbody tr')
      .nth(0)
      .locator('button[data-action="drag"]')
      .count();
    if (!dragHandle)
      issue('minor', 'settings console', 'table rows have no drag handle', {
        dedupe: 'console-table-drag',
      });
    const removeBtn = table.locator(
      'tbody tr button[data-action="remove"], tbody tr button[data-action="delete"]',
    );
    while (await removeBtn.count()) await removeBtn.first().click();
    // module on/off switch
    const sw = p.locator('#rescue-settings [data-module-toggle="singleClick"]');
    if (await sw.count()) {
      await sw.uncheck();
      await sleep(400);
      const left = await p.locator('.rescue-single-click').count();
      await sw.check();
      await sleep(400);
      results.push({ combo: cur.combo, singleClickLiveToggle: { afterOff: left } });
    }
    await closeConsole(p);
  });
}

async function featCommandLine(v: Visit, route: string): Promise<void> {
  const p = v.page;
  await step('command line: / list / sort / escape', async () => {
    await blur(p);
    await p.keyboard.press('.');
    if (!(await appears(p, '#rescue-cmdline input', 'commandLine', '. opens the command line')))
      return;
    await p.keyboard.type('/t week');
    await sleep(400);
    const tip = (await p.locator('#rescue-cmdline .rescue-cmdline-tip').textContent()) ?? '';
    results.push({ combo: cur.combo, cmdTip: tip });
    await shot(p, `${v.name}-cmdline-typed`);
    await audit(v, 'cmdline-typed', 'listing', route, { popup: true });
    const before = p.url();
    await p.keyboard.press('Enter');
    await p.waitForURL((u) => u.href !== before, { timeout: 15000 }).catch(() => {});
    const after = p.url();
    results.push({ combo: cur.combo, cmdSortNavigated: { before, after } });
    if (!/[?&]t=week/.test(after))
      issue(
        'major',
        'commandLine',
        `"/t week" did not navigate to a ?t=week address (now ${after}); tip said: ${tip.slice(0, 80)}`,
        { dedupe: 'cmd-tweek' },
      );
    await sleep(2500);
    await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(2000);
  });
}

async function featFilterSession(ctx: BrowserContext, vw: number): Promise<void> {
  const v = await visit(ctx, 'r-all-filter', 'https://www.reddit.com/r/all/', vw, 'shreddit-post');
  if (!v || v.blocked) return;
  const p = v.page;
  let postId = '';
  await step('filter: ⊘ menu, apply, undo', async () => {
    await p.evaluate(() => scrollTo(0, 0));
    await sleep(600);
    const btn = await inView(p, '.rescue-filter-btn');
    if (!btn)
      return issue('major', 'filteReddit', 'no ⊘ in viewport on r/all', { dedupe: 'filter-nobtn' });
    const info = await btn.evaluate((el) => {
      const post = (el as Element).closest('shreddit-post');
      return {
        id: post?.id ?? '',
        sub: post?.getAttribute('subreddit-prefixed-name') ?? '',
        author: post?.getAttribute('author') ?? '',
      };
    });
    postId = info.id;
    await btn.click();
    await appears(p, '.rescue-filter-menu', 'filteReddit', '⊘ opens the menu');
    const kinds = await p
      .locator('.rescue-filter-menu .rescue-filter-item')
      .evaluateAll((els) => els.map((e) => ({ k: e.getAttribute('data-kind'), t: e.textContent })));
    results.push({ combo: cur.combo, filterKinds: kinds, post: info });
    const pick = p
      .locator('.rescue-filter-menu .rescue-filter-item[data-kind="subreddit"]')
      .first();
    if (!(await pick.count()))
      return issue(
        'major',
        'filteReddit',
        `no subreddit entry in ⊘ menu (kinds ${JSON.stringify(kinds)})`,
        { dedupe: 'filter-nosub' },
      );
    await pick.click();
    const post = p.locator(`shreddit-post#${postId}`);
    await sleep(900);
    const hiddenNow = !(await post.isVisible().catch(() => false));
    if (!hiddenNow)
      issue('major', 'filteReddit', `post ${postId} still visible after filtering ${info.sub}`, {
        dedupe: 'filter-notapplied',
      });
    await shot(p, `${v.name}-filter-applied`);
    await audit(v, 'filter-applied', 'listing', 'all', { popup: true });
    const undo = p.locator('#rescue-notices .n button', { hasText: 'Undo' });
    if (!(await undo.count()))
      return issue('major', 'filteReddit', 'no Undo button on the filter notice', {
        dedupe: 'filter-noundo',
      });
    await undo.first().click();
    await sleep(900);
    if (!(await post.isVisible().catch(() => false)))
      issue('major', 'filteReddit', `Undo did not bring post ${postId} back`, {
        dedupe: 'filter-undo-failed',
      });
    await shot(p, `${v.name}-filter-undone`);
  });

  await step('filter: banner, reveal chip, power switch', async () => {
    const btn = await inView(p, '.rescue-filter-btn');
    if (!btn) return;
    await btn.click();
    await p
      .locator('.rescue-filter-menu .rescue-filter-item[data-kind="subreddit"]')
      .first()
      .click();
    await sleep(900);
    const banner = p.locator('#rescue-tools .rescue-filter-banner');
    if (
      !(await appears(
        p,
        '#rescue-tools .rescue-filter-banner',
        'filteReddit',
        'filter banner after a filter',
      ))
    )
      return;
    const bannerText = ((await banner.textContent()) ?? '').trim();
    results.push({ combo: cur.combo, filterBanner: bannerText });
    await shot(p, `${v.name}-filter-banner`);
    await audit(v, 'filter-banner', 'listing', 'all');
    const post = p.locator(`shreddit-post#${postId}`);
    await banner.locator('.rescue-filter-toggle').click();
    await sleep(700);
    const chip = p.locator('.rescue-filter-reason:visible').first();
    if (!(await chip.count()))
      issue('major', 'filteReddit', 'reveal ("show") showed no reason chip', {
        dedupe: 'filter-nochip',
      });
    else {
      await shot(p, `${v.name}-filter-reveal`);
      await audit(v, 'filter-reveal', 'listing', 'all', { popup: true });
    }
    await banner.locator('.rescue-filter-toggle').click();
    await sleep(500);
    await banner.locator('.rescue-filter-power').click();
    await sleep(700);
    const visibleOff = await post.isVisible().catch(() => false);
    if (!visibleOff)
      issue('major', 'filteReddit', 'power switch off did not show the filtered post', {
        dedupe: 'filter-power-off',
      });
    await shot(p, `${v.name}-filter-power-off`);
    await audit(v, 'filter-power-off', 'listing', 'all');
    await banner.locator('.rescue-filter-power').click();
    await sleep(500);
    // Undo through the notice if it is still up, else via the storage restore at the end.
    const undo = p.locator('#rescue-notices .n button', { hasText: 'Undo' });
    if (await undo.count()) await undo.first().click();
  });
  finishVisit(v, { feature: 'filter' });
  await v.page.close();
  await sleep(PAUSE);

  // placeholder mode + a subreddit rule written the way the console does
  const v2 = await (async () => {
    await configure(ctx, {
      filteReddit: {
        enabled: true,
        options: {
          filteredDisplay: 'placeholder',
          showFilterline: true,
          rules: [
            {
              type: 'subreddit',
              pattern: 'askreddit',
              scope: 'everywhere',
              subreddits: '',
              enabled: true,
              toggle: '',
            },
            {
              type: 'keyword',
              pattern: 'the',
              scope: 'everywhere',
              subreddits: '',
              enabled: true,
              toggle: '',
            },
          ],
        },
      },
    });
    return visit(ctx, 'r-all-placeholder', 'https://www.reddit.com/r/all/', vw, 'shreddit-post');
  })();
  if (v2 && !v2.blocked) {
    const p2 = v2.page;
    await step('filter: placeholder mode', async () => {
      await sleep(1500);
      const rows = await p2.locator('.rescue-filter-placeholder').count();
      results.push({ combo: cur.combo, placeholders: rows });
      if (!rows)
        return issue(
          'major',
          'filteReddit',
          'placeholder mode with a matching rule left no placeholder rows',
          { dedupe: 'filter-noplaceholder' },
        );
      await p2.locator('.rescue-filter-placeholder').first().scrollIntoViewIfNeeded();
      await shot(p2, `${v2.name}-placeholder`);
      await audit(v2, 'placeholder', 'listing', 'all');
      await p2.locator('.rescue-filter-placeholder .rescue-filter-placeholder-btn').first().click();
      await sleep(600);
      await shot(p2, `${v2.name}-placeholder-shown`);
    });
    finishVisit(v2, { feature: 'placeholder' });
    await v2.page.close();
    await sleep(PAUSE);
  }
  await configure(ctx, {
    filteReddit: { options: { filteredDisplay: 'hide', showFilterline: false, rules: [] } },
  });
}

async function featSubToggle(ctx: BrowserContext, vw: number): Promise<void> {
  const v = await visit(
    ctx,
    'r-science-subtoggle',
    'https://www.reddit.com/r/science/',
    vw,
    'shreddit-post',
  );
  if (!v || v.blocked) return;
  const p = v.page;
  await step('filter: subreddit-page toggle and Undo', async () => {
    // The toggle is a menu row now ("Filter r/science" / "Stop filtering r/science").
    const label = (): Promise<string | null> => menuRow(p, 'filterSubreddit');
    const t0 = await label();
    if (t0 === null)
      return void issue('major', 'filteReddit', 'sub toggle on r/science: menu row missing', {
        dedupe: 'subtoggle-missing',
      });
    await menuClick(p, 'filterSubreddit');
    await sleep(900);
    const t1 = await label();
    results.push({ combo: cur.combo, subToggle: [t0, t1] });
    if (t0 === t1)
      issue('major', 'filteReddit', `sub toggle label did not change after click ("${t0}")`, {
        dedupe: 'subtoggle-label',
      });
    await shot(p, `${v.name}-subtoggle-on`);
    await audit(v, 'subtoggle', 'listing', 'subreddit', { popup: true });
    const postsStillShown = await p.locator('shreddit-post:visible').count();
    if (!postsStillShown)
      issue(
        'major',
        'filteReddit',
        'filtering r/science hid the posts on r/science itself (should only hide it elsewhere)',
        { dedupe: 'subtoggle-hides-own' },
      );
    const undo = p.locator('#rescue-notices .n button', { hasText: 'Undo' });
    if (await undo.count()) await undo.first().click();
    else await menuClick(p, 'filterSubreddit');
    await sleep(700);
    const t2 = await label();
    if (t2 !== t0)
      issue('major', 'filteReddit', `Undo did not restore the toggle label ("${t2}" vs "${t0}")`, {
        dedupe: 'subtoggle-undo',
      });
  });
  finishVisit(v, { feature: 'subtoggle' });
  await v.page.close();
  await sleep(PAUSE);
}

async function featThread(ctx: BrowserContext, vw: number, host = 'www'): Promise<void> {
  const url = shared.thread?.replace('://www.', `://${host}.`);
  if (!url) return;
  const v = await visit(ctx, `thread-${host}-feat`, url, vw, 'shreddit-comment');
  if (!v || v.blocked) return;
  const p = v.page;
  await sleep(1500);

  await step('userHighlight: mod comment', async () => {
    const counts = await p.evaluate(() => ({
      mod: document.querySelectorAll('.rescue-mod-author').length,
      admin: document.querySelectorAll('.rescue-admin-author').length,
      tagged: document.querySelectorAll('.rescue-tagged-author').length,
      modDistinguished: document.querySelectorAll(
        '[is-mod-distinguished], [is-mod-distinguished="true"]',
      ).length,
    }));
    results.push({ combo: cur.combo, page: v.name, highlight: counts });
    if (!counts.mod)
      issue(
        'major',
        'userHighlight',
        `no moderator highlight on the thread (is-mod-distinguished nodes: ${counts.modDistinguished}); AutoModerator is on screen`,
        { dedupe: `hl-${host}` },
      );
    else {
      const el = p.locator('.rescue-mod-author').first();
      await el.scrollIntoViewIfNeeded();
      await shot(p, `${v.name}-mod-highlight`);
      await audit(v, 'mod-highlight', 'thread', 'thread');
    }
    await p.evaluate(() => scrollTo(0, 0));
  });

  await step('userTagger: editor, save, preset, manager, ignore', async () => {
    const btn = await inViewScroll(p, '.rescue-tag-btn');
    if (!btn)
      return issue('major', 'userTagger', 'no 🏷 in the viewport on the thread', {
        dedupe: `tag-nobtn-${host}`,
      });
    const author = await btn.evaluate((el) => (el as Element).getAttribute('aria-label') ?? '');
    await btn.click();
    if (!(await appears(p, '.rescue-tag-editor', 'userTagger', 'editor opens'))) return;
    const ed = p.locator('.rescue-tag-editor');
    const sw = await ed.locator('.rescue-swatch').count();
    if (sw !== 21)
      issue('minor', 'userTagger', `editor shows ${sw} swatches (expected 21)`, {
        dedupe: `tag-swatches-${host}`,
      });
    await ed.locator('input[name=text]').fill('smoke-tag');
    await ed.locator('.rescue-swatch[data-color="orangered"]').click();
    const prev = await ed.locator('.rescue-tag-preview .rescue-user-tag').textContent();
    if (prev?.trim() !== 'smoke-tag')
      issue('major', 'userTagger', `live preview shows "${prev}" instead of the typed tag`, {
        dedupe: `tag-preview-${host}`,
      });
    await shot(p, `${v.name}-tag-editor`);
    await audit(v, 'tag-editor', 'thread', 'thread', { popup: true });
    // add preset then Enter to save
    await ed.locator('.rescue-tag-save-preset').click();
    await sleep(400);
    const presets = await ed.locator('.rescue-tag-preset').count();
    if (presets < 1)
      issue('major', 'userTagger', 'Add as preset did not add a preset chip', {
        dedupe: `tag-preset-${host}`,
      });
    await ed.locator('input[name=text]').press('Enter');
    await sleep(700);
    if (await p.locator('.rescue-tag-editor').count())
      issue('major', 'userTagger', 'Enter in the tag field did not save and close the editor', {
        dedupe: `tag-enter-${host}`,
      });
    const chip = p.locator('.rescue-user-tag').first();
    if (!(await chip.count()))
      issue('major', 'userTagger', 'saved tag chip not rendered', { dedupe: `tag-nochip-${host}` });
    else {
      await shot(p, `${v.name}-tag-chip`);
      await audit(v, 'tag-chip', 'thread', 'thread');
    }
    results.push({ combo: cur.combo, page: v.name, taggedUser: author });
    // Escape path + ignore + manager
    const btn2 = await inView(p, `.rescue-tag-btn[aria-label="${author}"]`);
    if (btn2) {
      await btn2.click();
      if (
        await appears(p, '.rescue-tag-editor', 'userTagger', 'editor re-opens for an existing tag')
      ) {
        await p.locator('.rescue-tag-editor input[name=text]').fill('typed-then-escape');
        await p.keyboard.press('Escape');
        await gone(p, '.rescue-tag-editor', 'userTagger', 'Escape closes the editor');
        const still = await p.locator('.rescue-user-tag').first().textContent();
        if (still?.trim() !== 'smoke-tag')
          issue('major', 'userTagger', `Escape saved the edit anyway ("${still}")`, {
            dedupe: `tag-escape-${host}`,
          });
      }
      await btn2.click();
      await appears(p, '.rescue-tag-editor', 'userTagger', 'editor opens for manager');
      const manage = p.locator('.rescue-tag-editor .rescue-tag-manage');
      if (await manage.count()) {
        await manage.click();
        if (
          await appears(p, '.rescue-tags-manager', 'userTagger', 'Tagged users opens the manager')
        ) {
          await shot(p, `${v.name}-tag-manager`);
          await audit(v, 'tag-manager', 'thread', 'thread', { popup: true });
          const rows = await p.locator('.rescue-tags-manager tbody tr[data-user]').count();
          if (!rows)
            issue('major', 'userTagger', 'manager lists no tagged users after tagging one', {
              dedupe: `tag-mgr-empty-${host}`,
            });
          const del = p.locator('.rescue-tags-manager .rescue-tags-delete').first();
          if (await del.count()) {
            await del.click();
            await del.click();
            await sleep(600);
          }
          await p.keyboard.press('Escape');
          await sleep(300);
          // Escape must close it; if not, say so and close it so later steps are not blocked.
          if (!(await gone(p, '.rescue-tags-manager', 'userTagger', 'Escape closes the manager')))
            await p
              .locator('.rescue-tags-manager .rescue-tags-close')
              .click({ timeout: 2000 })
              .catch(() => {});
        }
      } else
        issue('minor', 'userTagger', 'no "Tagged users" button in the editor', {
          dedupe: `tag-nomanage-${host}`,
        });
    }
    await p.evaluate(() => scrollTo(0, 0));
  });

  await step('comments: hide children (each + all)', async () => {
    const t = await inViewScroll(p, '.rescue-hide-children');
    if (!t)
      return issue('major', 'hideChildComments', 'no "hide child comments" in the viewport', {
        dedupe: `hide-none-${host}`,
      });
    const before = await p.locator('shreddit-comment:visible').count();
    const t0 = ((await t.textContent()) ?? '').trim();
    await t.click();
    await sleep(600);
    const after = await p.locator('shreddit-comment:visible').count();
    const t1 = ((await t.textContent()) ?? '').trim();
    results.push({ combo: cur.combo, page: v.name, hideChildren: { t0, t1, before, after } });
    if (after >= before)
      issue(
        'major',
        'hideChildComments',
        `clicking "${t0}" hid no comments (${before} -> ${after})`,
        { dedupe: `hide-noeffect-${host}` },
      );
    await shot(p, `${v.name}-hide-children`);
    await t.click();
    await sleep(400);
    await menuClick(p, 'hideAllReplies');
    await sleep(900);
    const afterAll = await p.locator('shreddit-comment:visible').count();
    const label = (await menuRow(p, 'hideAllReplies')) ?? '';
    results.push({ combo: cur.combo, page: v.name, hideAll: { label, afterAll } });
    await shot(p, `${v.name}-hide-all`);
    await audit(v, 'hide-all', 'thread', 'thread');
    await menuClick(p, 'hideAllReplies');
    await sleep(500);
  });

  await step('comments: show parent hover chain + goto', async () => {
    const link = await inViewScroll(p, '.rescue-show-parent');
    if (!link)
      return issue('major', 'showParent', 'no ↑ parent link in viewport', {
        dedupe: `parent-none-${host}`,
      });
    await link.hover();
    if (
      await appears(
        p,
        '.rescue-hover .rescue-parent-preview',
        'showParent',
        'hover shows the parent popup',
      )
    ) {
      const chain = await p
        .locator('.rescue-hover .rescue-parent-chain .rescue-parent-preview')
        .count();
      results.push({ combo: cur.combo, page: v.name, parentChainEntries: chain });
      await shot(p, `${v.name}-parent-chain`);
      await audit(v, 'parent-chain', 'thread', 'thread', { popup: true });
      const goto = p.locator('.rescue-hover .rescue-parent-goto').first();
      if (await goto.count()) {
        await goto.click();
        await sleep(800);
        if (!(await p.locator('[data-rescue-selected]').count()))
          issue('minor', 'showParent', '"goto comment" did not select the parent comment', {
            dedupe: `parent-goto-${host}`,
          });
        await shot(p, `${v.name}-parent-goto`);
      }
    }
    await p.mouse.move(2, 2);
  });

  await step('tableTools: sortable table in a comment (if any)', async () => {
    const n = await p.evaluate(
      () => document.querySelectorAll('shreddit-comment table, shreddit-post table').length,
    );
    results.push({ combo: cur.combo, page: v.name, tablesOnPage: n });
    if (!n) {
      notTested.push(
        `tableTools: no table in the sampled thread (${shared.thread}); sorting not exercised live.`,
      );
      return;
    }
    const th = await inViewScroll(p, 'shreddit-comment table th');
    if (!th) return;
    const before = await p.evaluate(() =>
      [...document.querySelectorAll('shreddit-comment table tbody tr td:first-child')].map(
        (c) => c.textContent,
      ),
    );
    await th.click();
    await sleep(300);
    const after = await p.evaluate(() =>
      [...document.querySelectorAll('shreddit-comment table tbody tr td:first-child')].map(
        (c) => c.textContent,
      ),
    );
    if (JSON.stringify(before) === JSON.stringify(after))
      issue('minor', 'tableTools', 'clicking a table heading did not reorder the rows', {
        dedupe: `table-sort-${host}`,
      });
  });

  await step('comments: save-RES, Saved list, unsave', async () => {
    const s = await inViewScroll(p, '.rescue-save-comment');
    if (!s)
      return issue('major', 'saveComments', 'no save-RES in viewport', {
        dedupe: `save-none-${host}`,
      });
    await s.click();
    await sleep(500);
    const lbl = ((await s.textContent()) ?? '').trim();
    if (lbl !== 'saved-RES')
      issue('major', 'saveComments', `label after click is "${lbl}" not "saved-RES"`, {
        dedupe: `save-label-${host}`,
      });
    const note = await p.locator('#rescue-notices .n').count();
    results.push({ combo: cur.combo, page: v.name, saveExplainerNotice: note });
    await shot(p, `${v.name}-saved-notice`);
    await audit(v, 'saved-notice', 'thread', 'thread', { popup: true });
    const openerText = (await menuRow(p, 'savedComments')) ?? '';
    if (!/\(1\)/.test(openerText))
      issue('minor', 'saveComments', `menu row reads "${openerText}" after saving one`, {
        dedupe: `save-count-${host}`,
      });
    await menuClick(p, 'savedComments');
    if (await appears(p, '#rescue-saved-comments', 'saveComments', 'Saved opens the list')) {
      await shot(p, `${v.name}-saved-list-filled`);
      await audit(v, 'saved-list-filled', 'thread', 'thread');
      await p.locator('#rescue-saved-comments .rescue-saved-remove').first().click();
      await sleep(400);
      if (!(await p.locator('#rescue-saved-comments .rescue-saved-empty').count()))
        issue('minor', 'saveComments', 'list is not empty after unsave-RES', {
          dedupe: `save-unsave-${host}`,
        });
      await p
        .locator('#rescue-saved-comments button[aria-label*="lose"]')
        .click()
        .catch(() => {});
    }
  });

  await step('comments: navigator categories, next/prev, close', async () => {
    await p.evaluate(() => scrollTo(0, 0));
    // Hidden by default: it only appears once its menu row is used.
    if (await p.locator('.rescue-comment-nav').isVisible())
      issue('minor', 'commentNavigator', 'navigator is visible before it was enabled', {
        dedupe: `nav-default-${host}`,
      });
    const nav = await showNavigator(p);
    if (
      !(await appears(p, '.rescue-comment-nav', 'commentNavigator', 'navigator via its menu row'))
    )
      return;
    const cats = await nav
      .locator('select option')
      .evaluateAll((o) =>
        o.map((x) => ({
          v: (x as HTMLOptionElement).value,
          t: x.textContent,
          // A disabled or hidden category cannot be chosen; stepping into it would only time out.
          off: (x as HTMLOptionElement).disabled || (x as HTMLOptionElement).hidden,
        })),
      );
    const out: Record<string, string> = {};
    for (const c of cats.filter((o) => !o.off)) {
      await nav.locator('select').selectOption(c.v);
      await sleep(200);
      out[c.v] = ((await nav.locator('.rescue-nav-count').textContent()) ?? '').trim();
    }
    results.push({ combo: cur.combo, page: v.name, navigator: out });
    // Step through a category that has matches ("none" means this thread has no such comment).
    const pick = ['op', 'all'].find((k) => /^\d+\/\d+$/.test(out[k] ?? '')) ?? 'all';
    await nav
      .locator('select')
      .selectOption(pick)
      .catch(() => {});
    await nav.locator('.rescue-nav-next').click();
    await sleep(700);
    const sel = await p.locator('[data-rescue-selected]').count();
    if (!sel)
      issue('minor', 'commentNavigator', `next did not select a comment (category ${pick})`, {
        dedupe: `nav-next-${host}`,
      });
    await shot(p, `${v.name}-navigator-next`);
    await audit(v, 'navigator-next', 'thread', 'thread');
    await nav.locator('.rescue-nav-close').click();
    await sleep(300);
    if (await nav.isVisible())
      issue('minor', 'commentNavigator', 'close (×) did not hide the navigator', {
        dedupe: `nav-close-${host}`,
      });
  });

  await step('keyboard: j/k, link numbers, Enter, Ctrl+Z, y, Alt+/, help', async () => {
    await p.evaluate(() => scrollTo(0, 0));
    await blur(p);
    await p.keyboard.press('j');
    await sleep(300);
    await p.keyboard.press('j');
    await sleep(500);
    const selCount = await p.locator('[data-rescue-selected]').count();
    if (selCount !== 1)
      issue('major', 'keyboardNav', `after j,j there are ${selCount} selected items`, {
        dedupe: `key-sel-${host}`,
      });
    // outline matches the selected item
    const geo = await p.evaluate(() => {
      const el = document.querySelector('[data-rescue-selected]');
      const box = document.getElementById('rescue-selection');
      if (!el || !box) return null;
      const a = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return {
        sel: [a.left, a.top, a.width, a.height].map(Math.round),
        box: [b.left, b.top, b.width, b.height].map(Math.round),
        vis: getComputedStyle(box).display !== 'none',
      };
    });
    results.push({ combo: cur.combo, page: v.name, selectionGeometry: geo });
    if (!geo)
      issue('major', 'keyboardNav', 'no #rescue-selection outline for the selected item', {
        dedupe: `key-outline-${host}`,
      });
    await shot(p, `${v.name}-keys-selected`);
    // collapse
    const sc = p.locator('shreddit-comment[data-rescue-selected] > details').first();
    if (await sc.count()) {
      const open0 = await sc.evaluate((d: HTMLDetailsElement) => d.open);
      await p.keyboard.press('Enter');
      await sleep(500);
      const open1 = await sc.evaluate((d: HTMLDetailsElement) => d.open);
      if (open0 === open1)
        issue('major', 'keyboardNav', 'Enter did not collapse/expand the selected comment', {
          dedupe: `key-enter-${host}`,
        });
      await shot(p, `${v.name}-keys-collapsed`);
      await p.keyboard.press('Enter');
      await sleep(400);
    }
    // undo
    await p.keyboard.press('j');
    await sleep(300);
    const idA = await p.evaluate(
      () =>
        document.querySelector('[data-rescue-selected]')?.getAttribute('thingid') ??
        document.querySelector('[data-rescue-selected]')?.id ??
        '',
    );
    await p.keyboard.press('Control+z');
    await sleep(400);
    const idB = await p.evaluate(
      () =>
        document.querySelector('[data-rescue-selected]')?.getAttribute('thingid') ??
        document.querySelector('[data-rescue-selected]')?.id ??
        '',
    );
    if (idA === idB)
      issue('minor', 'keyboardNav', 'Ctrl+Z did not move the selection back', {
        dedupe: `key-undo-${host}`,
      });
    // link numbers: walk down until a comment with links is selected
    let badges = 0;
    for (let i = 0; i < 25 && !badges; i++) {
      await p.keyboard.press('j');
      await sleep(250);
      badges = await p.locator('#rescue-link-numbers span').count();
    }
    results.push({ combo: cur.combo, page: v.name, linkBadges: badges });
    if (badges) {
      await shot(p, `${v.name}-link-numbers`);
      await audit(v, 'link-numbers', 'thread', 'thread', { popup: true });
      // each badge should sit by a link
      const places = await p.evaluate(() =>
        [...document.querySelectorAll('#rescue-link-numbers span')].map((s) => {
          const r = s.getBoundingClientRect();
          return [
            Math.round(r.left),
            Math.round(r.top),
            Math.round(r.width),
            Math.round(r.height),
            s.textContent,
          ];
        }),
      );
      results.push({ combo: cur.combo, linkBadgePlaces: places });
    } else
      issue(
        'minor',
        'keyboardNav',
        'no link-number badges appeared on any of 25 comments (none had links, or badges failed)',
        { dedupe: `key-badges-${host}` },
      );
    // y copies permalink
    await p.keyboard.press('y');
    await sleep(700);
    const copyNote = await p.locator('#rescue-notices [data-rescue-notice="copy-result"]').count();
    let clip = '';
    try {
      clip = await p.evaluate(() => navigator.clipboard.readText());
    } catch (e) {
      notTested.push(`Clipboard read after "y" failed: ${(e as Error).message.slice(0, 80)}`);
    }
    results.push({
      combo: cur.combo,
      page: v.name,
      yCopy: { notice: copyNote, clip: clip.slice(0, 120) },
    });
    if (!copyNote)
      issue('minor', 'keyboardNav', '"y" showed no copy-result notice', {
        dedupe: `key-y-${host}`,
      });
    // Alt+/
    await p.keyboard.press('Alt+/');
    await sleep(500);
    const focus = await p.evaluate(() => {
      let a: any = document.activeElement;
      while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
      return a
        ? `${a.tagName.toLowerCase()}${a.getAttribute?.('placeholder') ? ` [${a.getAttribute('placeholder')}]` : ''}${a.getAttribute?.('name') ? ` name=${a.getAttribute('name')}` : ''}`
        : 'none';
    });
    results.push({ combo: cur.combo, page: v.name, altSlashFocus: focus });
    if (!/input|search/i.test(focus))
      issue('minor', 'keyboardNav', `Alt+/ did not focus a search field (focus: ${focus})`, {
        dedupe: `key-altslash-${host}`,
      });
    await shot(p, `${v.name}-alt-slash`);
    await p.keyboard.press('Escape');
    await blur(p);
    // help sections incl. go-mode commands
    await p.keyboard.press('?');
    if (await appears(p, '#rescue-keyhelp', 'keyboardNav', '? opens key help')) {
      const txt = (await p.locator('#rescue-keyhelp').textContent()) ?? '';
      for (const needle of ['Go to', 'Modmail', 'Link numbers', 'Vote'])
        if (!txt.includes(needle))
          issue('minor', 'keyboardNav', `key help lacks "${needle}"`, {
            dedupe: `key-help-${needle}-${host}`,
          });
      await shot(p, `${v.name}-keyhelp-full`);
      await audit(v, 'keyhelp-full', 'thread', 'thread', { popup: true });
      await p.keyboard.press('Escape');
    }
    await p.keyboard.press('Escape');
  });

  finishVisit(v, { feature: `thread-${host}` });
  await v.page.close();
  await sleep(PAUSE);
}

async function featReadNew(ctx: BrowserContext, vw: number): Promise<void> {
  const id = THREAD_ID();
  if (!shared.thread || !id) return;
  const v = await visit(ctx, 'thread-readrecord', shared.thread, vw, 'shreddit-comment');
  if (!v || v.blocked) return;
  await sleep(2500);
  const rec1 = (await storeAll(ctx)).read?.[`t3_${id}`];
  results.push({ combo: cur.combo, readRecordAfterFirstVisit: rec1 });
  if (!rec1)
    issue('major', 'readComments', `no read record for t3_${id} after visiting the thread`, {
      dedupe: 'read-norecord',
    });
  await v.page.close();
  await sleep(PAUSE);
  // backdate: last visit 3 days ago, when the thread had 60 fewer comments
  const cc = shared.threadComments ?? 500;
  await storeSet(ctx, {
    read: {
      ...((await storeAll(ctx)).read ?? {}),
      [`t3_${id}`]: {
        lastVisit: Date.now() - 3 * 86400_000,
        commentCountAtVisit: Math.max(0, cc - 60),
      },
    },
  });
  const v2 = await visit(ctx, 'thread-newcomments', shared.thread, vw, 'shreddit-comment');
  if (v2 && !v2.blocked) {
    const p = v2.page;
    await step('newCommentCount in thread', async () => {
      await sleep(2000);
      const marks = await p.locator('.rescue-new-comment').count();
      const banner = (
        (await p
          .locator('#rescue-tools .rescue-new-banner')
          .textContent()
          .catch(() => '')) ?? ''
      ).trim();
      results.push({ combo: cur.combo, newMarks: marks, banner });
      if (!marks)
        issue(
          'major',
          'newCommentCount',
          'no "new" marks after backdating the read record 3 days',
          { dedupe: 'new-nomarks' },
        );
      if (!banner)
        issue('minor', 'newCommentCount', 'no "N new comments" banner in the strip', {
          dedupe: 'new-nobanner',
        });
      await shot(p, `${v2.name}`);
      await audit(v2, 'new-comments', 'thread', 'thread');
      const hide = p.locator('#rescue-notices .n button', { hasText: 'Hide read comments' });
      results.push({ combo: cur.combo, hideReadNotice: await hide.count() });
    });
    finishVisit(v2, { feature: 'newcomments' });
    await p.close();
    await sleep(PAUSE);
  }
  // listing side: "(N new)"
  await storeSet(ctx, {
    read: {
      ...((await storeAll(ctx)).read ?? {}),
      [`t3_${id}`]: {
        lastVisit: Date.now() - 3 * 86400_000,
        commentCountAtVisit: Math.max(0, cc - 60),
      },
    },
  });
  const v3 = await visit(
    ctx,
    'r-science-newcount',
    'https://www.reddit.com/r/science/',
    vw,
    'shreddit-post',
  );
  if (v3 && !v3.blocked) {
    await step('newCommentCount on listing', async () => {
      await sleep(1500);
      const n = await v3.page.locator('.rescue-new-count').count();
      results.push({ combo: cur.combo, listingNewCounts: n });
      if (!n)
        issue(
          'minor',
          'newCommentCount',
          `no "(N new)" on r/science although the backdated thread (${id}) may not be on the first page (informational)`,
          { dedupe: 'new-listing' },
        );
      else {
        await v3.page.locator('.rescue-new-count').first().scrollIntoViewIfNeeded();
        await shot(v3.page, `${v3.name}`);
        await audit(v3, 'new-listing', 'listing', 'subreddit');
      }
    });
    finishVisit(v3, { feature: 'newcount-listing' });
    await v3.page.close();
    await sleep(PAUSE);
  }
}

async function featFeatures(ctx: BrowserContext, vw: number): Promise<void> {
  const snap = await storeAll(ctx);
  try {
    // listing: gear + notices + console + command line
    const v = await visit(
      ctx,
      'r-science-features',
      'https://www.reddit.com/r/science/',
      vw,
      'shreddit-post',
    );
    if (v && !v.blocked) {
      await featGear(v, 'subreddit');
      await featConsole(v, 'subreddit');
      await featCommandLine(v, 'subreddit');
      finishVisit(v, { feature: 'gear/console/cmdline' });
      await v.page.close();
      await sleep(PAUSE);
    }
    await featFilterSession(ctx, vw);
    await featSubToggle(ctx, vw);
    await featThread(ctx, vw, 'www');
    await featReadNew(ctx, vw);
    // comment filter rules on the thread (read from settings before load)
    await configure(ctx, {
      filteReddit: {
        enabled: true,
        options: {
          commentRules: [
            { type: 'keyword', pattern: 'the', action: 'collapse', enabled: true },
            { type: 'depth', pattern: '2', action: 'hide', enabled: true },
          ],
        },
      },
    });
    const v4 = await visit(
      ctx,
      'thread-comment-filters',
      shared.thread ?? '',
      vw,
      'shreddit-comment',
    );
    if (v4 && !v4.blocked) {
      await step('filter: comment rules (collapse + hide) and banner', async () => {
        await sleep(2500);
        const banner = (
          (await v4.page
            .locator('#rescue-tools .rescue-filter-banner')
            .textContent()
            .catch(() => '')) ?? ''
        ).trim();
        const chips = await v4.page.locator('.rescue-filter-reason:visible').count();
        results.push({ combo: cur.combo, commentFilterBanner: banner, visibleChips: chips });
        if (!banner)
          issue('major', 'filteReddit', 'comment rules matched many comments but no banner shows', {
            dedupe: 'cfilter-nobanner',
          });
        await shot(v4.page, v4.name);
        await audit(v4, 'comment-filters', 'thread', 'thread');
      });
      finishVisit(v4, { feature: 'comment-filters' });
      await v4.page.close();
      await sleep(PAUSE);
    }
  } finally {
    await storeReplace(ctx, snap);
  }
}

// ---------------------------------------------------------------------------------------------
// off-by-default modules, once: subredditManager, localDate (inline), disableChat, usernameHider,
// autoHide, wheelBrowse
// ---------------------------------------------------------------------------------------------
async function featOffByDefault(ctx: BrowserContext, vw: number): Promise<void> {
  const snap = await storeAll(ctx);
  try {
    const me: string = await (async () => {
      const probe = await visit(ctx, 'whoami', 'https://www.reddit.com/', vw, 'shreddit-post');
      let name = '';
      if (probe && !probe.blocked)
        name = await probe.page.evaluate(
          () => document.querySelector('shreddit-app')?.getAttribute('user-name') ?? '',
        );
      await probe?.page.close();
      await sleep(PAUSE);
      return name;
    })();
    await configure(ctx, {
      subredditManager: {
        enabled: true,
        options: {
          showDefaults: true,
          linkSaved: true,
          linkRandom: true,
          linkMod: true,
          subreddits: [
            { target: 'science', label: '', addedAt: 1 },
            { target: 'askscience+space+physics', label: '', addedAt: 2 },
            { target: 'aww', label: 'Aww!', addedAt: 3 },
            { target: 'worldnews', label: '', addedAt: 4 },
          ],
        },
      },
      localDate: { enabled: true, options: { display: 'both' } },
      disableChat: { enabled: true },
      usernameHider: { enabled: true, options: { hideOwn: true, hideUsers: ['spez'] } },
      autoHide: { enabled: true },
      wheelBrowse: { enabled: true },
    });
    const v = await visit(
      ctx,
      'offdefault-r-science',
      'https://www.reddit.com/r/science/',
      vw,
      'shreddit-post',
    );
    if (v && !v.blocked) {
      const p = v.page;
      await sleep(1500);
      await shot(p, `${v.name}-load`);
      const A = await audit(v, 'offdefault', 'listing', 'subreddit');
      results.push({
        combo: cur.combo,
        offDefaultAudit: { surfaces: A?.surfaces, covers: A?.covers, overlaps: A?.overlaps },
      });

      await step('subredditManager: bar, links, edit popup, sort, group menu, toggle', async () => {
        if (!(await appears(p, '#rescue-subreddit-bar', 'subredditManager', 'shortcut bar')))
          return;
        const labels = await p.locator('#rescue-subreddit-bar .rescue-sc a').allTextContents();
        const statics = await p
          .locator('#rescue-subreddit-bar .rescue-sc-viewport > a')
          .allTextContents();
        results.push({ combo: cur.combo, shortcuts: labels, statics });
        const bar = p.locator('#rescue-subreddit-bar');
        const box = await bar.boundingBox();
        results.push({ combo: cur.combo, shortcutBarBox: box });
        await shot(p, `${v.name}-shortcutbar`);
        await audit(v, 'shortcutbar', 'listing', 'subreddit');
        // edit popup
        await bar.locator('.rescue-sc[data-index="2"]').hover();
        await bar.locator('.rescue-sc[data-index="2"] .rescue-sc-edit').click({ timeout: 3000 });
        if (await appears(p, '#rescue-shortcut-popup', 'subredditManager', 'edit popup')) {
          await shot(p, `${v.name}-shortcut-edit`);
          await audit(v, 'shortcut-edit', 'listing', 'subreddit', { popup: true });
          await p.locator('#rescue-shortcut-popup input[name="label"]').fill('Cute');
          await p.locator('#rescue-shortcut-popup').getByRole('button', { name: 'Save' }).click();
          await sleep(500);
        }
        // add popup
        await bar.getByRole('button', { name: 'Add a shortcut' }).click({ timeout: 3000 });
        if (await appears(p, '#rescue-shortcut-popup', 'subredditManager', 'add popup')) {
          await p
            .locator('#rescue-shortcut-popup input[name="target"]')
            .fill('https://evil.example');
          await p.locator('#rescue-shortcut-popup').getByRole('button', { name: 'Save' }).click();
          if (!(await p.locator('#rescue-shortcut-popup [role="alert"]').count()))
            issue('minor', 'subredditManager', 'bad shortcut address not rejected in the popup', {
              dedupe: 'sc-badaddr',
            });
          await shot(p, `${v.name}-shortcut-add-error`);
          await p.locator('#rescue-shortcut-popup').getByRole('button', { name: 'Cancel' }).click();
        }
        // sort menu
        await bar.getByRole('button', { name: 'Sort shortcuts' }).click({ timeout: 3000 });
        await shot(p, `${v.name}-shortcut-sort`);
        await audit(v, 'shortcut-sort', 'listing', 'subreddit', { popup: true });
        await bar
          .getByRole('menuitem', { name: 'Name Z–A' })
          .click({ timeout: 3000 })
          .catch(() => {});
        await sleep(400);
        const sorted = await p.locator('#rescue-subreddit-bar .rescue-sc a').allTextContents();
        results.push({ combo: cur.combo, shortcutsAfterSort: sorted });
        // group dropdown
        const grp = bar.locator('.rescue-sc a', { hasText: /askscience/ }).first();
        if (await grp.count()) {
          await grp.hover();
          await sleep(500);
          await shot(p, `${v.name}-shortcut-group`);
          await audit(v, 'shortcut-group', 'listing', 'subreddit', { popup: true });
        }
        await p.mouse.move(700, 120);
        // drag: first to last
        const items = bar.locator('.rescue-sc');
        const n = await items.count();
        if (n >= 3) {
          // The strip scrolls sideways: drop on the last link that is fully inside it, not on one
          // scrolled out of view (that drop lands on whatever lies beyond the bar).
          const strip = (await bar.locator('.rescue-sc-viewport').boundingBox())!;
          const a = (await items.nth(0).boundingBox())!;
          let b = a;
          for (let i = n - 1; i > 0; i--) {
            const bb = await items.nth(i).boundingBox();
            if (bb && bb.x + bb.width <= strip.x + strip.width) {
              b = bb;
              break;
            }
          }
          const first0 =
            (await p.locator('#rescue-subreddit-bar .rescue-sc a').first().textContent()) ?? '';
          await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
          await p.mouse.down();
          await p.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 4, { steps: 3 });
          await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
          await p.mouse.up();
          await sleep(500);
          const first1 =
            (await p.locator('#rescue-subreddit-bar .rescue-sc a').first().textContent()) ?? '';
          results.push({ combo: cur.combo, dragFirst: [first0, first1] });
          if (first0 === first1)
            issue(
              'minor',
              'subredditManager',
              'dragging the first shortcut to the end did not reorder the bar',
              { dedupe: 'sc-drag' },
            );
        }
        // + r/name toggle
        const toggle = bar.locator('[data-rescue-toggle]');
        if (await toggle.count()) {
          const t0 = ((await toggle.textContent()) ?? '').trim();
          await toggle.click();
          await sleep(400);
          const t1 = ((await toggle.textContent()) ?? '').trim();
          results.push({ combo: cur.combo, scToggle: [t0, t1] });
          if (t0 === t1)
            issue('minor', 'subredditManager', `+ r/name toggle label unchanged ("${t0}")`, {
              dedupe: 'sc-toggle',
            });
          await toggle.click();
        } else
          issue('minor', 'subredditManager', 'no "+ r/name" toggle on a subreddit page', {
            dedupe: 'sc-notoggle',
          });
        // static links resolve
        const statLinks = await bar
          .locator('.rescue-sc-viewport > a')
          .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')));
        results.push({ combo: cur.combo, staticHrefs: statLinks });
      });

      await step('localDate inline', async () => {
        const n = await p.locator('.rescue-local-date').count();
        results.push({ combo: cur.combo, localDateLabels: n });
        if (!n)
          return issue(
            'major',
            'localDate',
            'no inline date labels on r/science with display=both',
            { dedupe: 'ld-none' },
          );
        const first = p.locator('.rescue-local-date').first();
        await first.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await shot(p, `${v.name}-localdate`);
        results.push({
          combo: cur.combo,
          localDateSample: ((await first.textContent()) ?? '').trim(),
        });
      });

      await step('wheelBrowse pad', async () => {
        const pad = p.locator('#rescue-wheelbrowse');
        if (!(await appears(p, '#rescue-wheelbrowse', 'wheelBrowse', 'wheel pad'))) return;
        const A2 = await audit(v, 'wheelbrowse', 'listing', 'subreddit');
        const padBox = await pad.boundingBox();
        results.push({ combo: cur.combo, wheelPadBox: padBox, overlaps: A2?.overlaps });
        await pad.hover();
        await p.mouse.wheel(0, 120);
        await sleep(500);
        const sel = await p.locator('[data-rescue-selected]').count();
        if (!sel)
          issue('minor', 'wheelBrowse', 'wheel over the pad moved no selection', {
            dedupe: 'wheel-nosel',
          });
        await shot(p, `${v.name}-wheelbrowse`);
      });

      await step('disableChat', async () => {
        const r = await p.evaluate(() => ({
          style: !!document.getElementById('rescue-disable-chat'),
          chat: [
            ...document.querySelectorAll(
              '#header-action-item-chat-button, #header-action-item-chat-button-badge, #reddit-chat',
            ),
          ].map((e) => ({ id: e.id, w: Math.round(e.getBoundingClientRect().width) })),
        }));
        results.push({ combo: cur.combo, disableChat: r });
        if (!r.style)
          issue('major', 'disableChat', 'REScue style element missing with the module on', {
            dedupe: 'dc-nostyle',
          });
        if (!r.chat.length)
          notTested.push(
            'disableChat: Reddit chat button not present in the header to compare (signed-in header differs).',
          );
        const visibleChat = r.chat.filter((c) => c.w > 0);
        if (visibleChat.length)
          issue(
            'major',
            'disableChat',
            `chat entry still visible with disableChat on: ${JSON.stringify(visibleChat)}`,
            { dedupe: 'dc-visible' },
          );
        await shot(p, `${v.name}-disablechat-header`);
      });
    }
    if (v) {
      finishVisit(v, { feature: 'offdefault-listing' });
      await v.page.close();
      await sleep(PAUSE);
    }

    // usernameHider on a profile + thread; autoHide after a read record exists
    const vp = await visit(
      ctx,
      'offdefault-user-spez',
      'https://www.reddit.com/user/spez/',
      vw,
      'shreddit-post, shreddit-comment',
    );
    if (vp && !vp.blocked) {
      await step('usernameHider', async () => {
        await sleep(1500);
        const r = await vp.page.evaluate(() => ({
          masked: (document.body.innerText.match(/~anon~/g) ?? []).length,
          spezText: (document.body.innerText.match(/\bspez\b/gi) ?? []).length,
          header: document.querySelector('shreddit-title, h1')?.textContent?.trim().slice(0, 60),
        }));
        results.push({ combo: cur.combo, usernameHider: r, me });
        await shot(vp.page, `${vp.name}`);
        await audit(vp, 'username-hider', 'profile', 'profile');
        if (!r.masked)
          issue(
            'minor',
            'usernameHider',
            `no "~anon~" masks on /user/spez/ with spez listed (spez still shown ${r.spezText} times in text)`,
            { dedupe: 'uh-none' },
          );
      });
      finishVisit(vp, { feature: 'usernameHider' });
      await vp.page.close();
      await sleep(PAUSE);
    }
    // autoHide: visit the thread (creates read record), then r/science
    if (shared.thread) {
      const vt = await visit(ctx, 'offdefault-thread', shared.thread, vw, 'shreddit-comment');
      await sleep(2500);
      if (vt) {
        await step('usernameHider in thread', async () => {
          const masked = await vt.page.evaluate(
            () => (document.body.innerText.match(/~anon~/g) ?? []).length,
          );
          results.push({ combo: cur.combo, threadMasked: masked });
          await shot(vt.page, `${vt.name}`);
        });
        finishVisit(vt, { feature: 'offdefault-thread' });
        await vt.page.close();
        await sleep(PAUSE);
      }
      const v5 = await visit(
        ctx,
        'offdefault-autohide',
        'https://www.reddit.com/r/science/',
        vw,
        'shreddit-post',
      );
      if (v5 && !v5.blocked) {
        await step('autoHide banner', async () => {
          await sleep(1500);
          const banner = (
            (await v5.page
              .locator('#rescue-tools .rescue-autohide-banner')
              .textContent()
              .catch(() => '')) ?? ''
          ).trim();
          results.push({ combo: cur.combo, autoHideBanner: banner });
          if (!banner)
            issue(
              'major',
              'autoHide',
              'no auto-hide banner although the thread was just opened (it may not be on page 1 of r/science)',
              { dedupe: 'ah-none' },
            );
          else {
            await shot(v5.page, `${v5.name}`);
            await audit(v5, 'autohide', 'listing', 'subreddit');
            // (a click through Playwright can be blocked by an overlapping notice, which the audit records)
            await v5.page
              .locator('#rescue-tools .rescue-autohide-toggle')
              .evaluate((b) => (b as HTMLElement).click());
            await sleep(500);
            await shot(v5.page, `${v5.name}-revealed`);
          }
        });
        finishVisit(v5, { feature: 'autoHide' });
        await v5.page.close();
        await sleep(PAUSE);
      }
    }
    // logoLink, searchHelper, styleTweaks with non-default options
    await configure(ctx, {
      logoLink: { enabled: true, options: { destination: 'all' } },
      searchHelper: { enabled: true, options: { defaultSort: 'top', defaultTime: 'week' } },
      styleTweaks: {
        enabled: true,
        options: { visitedLinks: true, topLevelSeparator: true, reduceMotion: true },
      },
    });
    const vl = await visit(
      ctx,
      'variants-r-science',
      'https://www.reddit.com/r/science/',
      vw,
      'shreddit-post',
    );
    if (vl && !vl.blocked) {
      await step('logoLink destination r/all', async () => {
        const href = await vl.page.evaluate(
          () =>
            document
              .querySelector(
                'a#reddit-logo, reddit-header-large a[href="/"], reddit-header-large a[href="/r/all/"]',
              )
              ?.getAttribute('href') ?? null,
        );
        results.push({ combo: cur.combo, logoHrefAfterAll: href });
        if (href !== '/r/all/')
          issue(
            'major',
            'logoLink',
            `logo href is ${href} with destination=all (expected /r/all/)`,
            { dedupe: 'logo-all' },
          );
        const style = await vl.page.evaluate(
          () => document.getElementById('rescue-style-tweaks')?.textContent?.slice(0, 300) ?? null,
        );
        results.push({ combo: cur.combo, styleTweaksCss: style });
        if (!style)
          issue('major', 'styleTweaks', 'no #rescue-style-tweaks style with options on', {
            dedupe: 'style-none',
          });
      });
      finishVisit(vl, { feature: 'variants' });
      await vl.page.close();
      await sleep(PAUSE);
    }
    const vs = await visit(
      ctx,
      'variants-search',
      'https://www.reddit.com/search/?q=science&type=posts',
      vw,
      'search-telemetry-tracker',
    );
    if (vs && !vs.blocked) {
      await step('searchHelper default sort/time', async () => {
        await sleep(2500);
        const url = vs.page.url();
        results.push({ combo: cur.combo, searchUrlAfterDefaults: url });
        if (!/sort=top/.test(url) || !/t=week/.test(url))
          issue(
            'major',
            'searchHelper',
            `search address did not get the default sort/time added: ${url}`,
            { dedupe: 'search-defaults' },
          );
        await shot(vs.page, vs.name);
      });
      finishVisit(vs, { feature: 'searchHelper' });
      await vs.page.close();
      await sleep(PAUSE);
    }
    // the shortcut bar on a narrow viewport and the thread (strip + bar together)
    const v6 = await visit(
      ctx,
      'offdefault-thread-bar',
      shared.thread ?? '',
      vw,
      'shreddit-comment',
    );
    if (v6 && !v6.blocked) {
      await sleep(1500);
      await shot(v6.page, v6.name);
      await audit(v6, 'bar+strip', 'thread', 'thread');
      finishVisit(v6, { feature: 'offdefault-thread-bar' });
      await v6.page.close();
    }
  } finally {
    await storeReplace(ctx, snap);
  }
}

// ---------------------------------------------------------------------------------------------
// sh.reddit.com feature subset
// ---------------------------------------------------------------------------------------------
async function featSh(ctx: BrowserContext, vw: number): Promise<void> {
  const snap = await storeAll(ctx);
  try {
    const v = await visit(
      ctx,
      'sh-listing-feat',
      'https://sh.reddit.com/r/science/',
      vw,
      'shreddit-post',
    );
    if (v && !v.blocked) {
      await popupPassListing(v, 'subreddit');
      await featGear(v, 'subreddit');
      finishVisit(v, { feature: 'sh-listing' });
      await v.page.close();
      await sleep(PAUSE);
    }
    await featThread(ctx, vw, 'sh');
  } finally {
    await storeReplace(ctx, snap);
  }
}

async function guarded(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`PASS FAILED ${name}`, e);
    issue(
      'major',
      'harness',
      `pass "${name}" aborted: ${(e as Error).message.split('\n')[0]!.slice(0, 160)}`,
      { dedupe: `pass-${name}-${cur.combo}` },
    );
  }
}

/** Which passes run in which combo: popups everywhere; the heavy ones where they add information. */
async function interactPasses(ctx: BrowserContext, theme: string, vw: number): Promise<void> {
  const first = vw === WIDTHS[0];
  const lightFirst = theme === THEMES[0] && first;
  if (want('popups')) await guarded('popups', () => popupPass(ctx, vw));
  if (
    want('features') &&
    (lightFirst || (first && theme !== THEMES[0]) || (theme === THEMES[0] && !first))
  )
    await guarded('features', () => featFeatures(ctx, vw));
  if (want('offByDefault')) await guarded('offByDefault', () => featOffByDefault(ctx, vw));
  if (want('sh') && (lightFirst || (theme !== THEMES[0] && !first)))
    await guarded('sh', () => featSh(ctx, vw));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
