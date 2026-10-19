/**
 * REScue Firefox smoke (manual; never in CI). Playwright cannot load an extension into Firefox, so
 * this drives geckodriver with selenium-webdriver, installs the BUILT Firefox extension as a
 * temporary add-on in a FRESH profile (logged out; your real profile is never touched) and checks
 * the REScue-local features on real Reddit. Screenshots, results.json and the browser console go to
 * <out> (default ./firefox-output, not committed).
 *
 * READ-ONLY toward Reddit: no votes, posts, joins or saves. A page that shows a bot challenge
 * ("Prove your humanity", CAPTCHA) is recorded as blocked and never attempted.
 *
 * Run (needs `npm run build:firefox` first; Node's type stripping, no tsx):
 *   node --experimental-strip-types tests/live/firefox-smoke.ts --browser librewolf
 *   node --experimental-strip-types tests/live/firefox-smoke.ts --browser firefox
 * Options: --binary <exe> (override the browser path)  --ext <dir> (default .output/firefox-mv3)
 *          --out <dir>  --only a,b (check ids: install,menu,filter,keys,tag,media,lean,promoted,export,controls,reload,popular)
 *          --headless
 */
import selenium from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import LogInspector from 'selenium-webdriver/bidi/logInspector.js';
import { download } from 'geckodriver';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Builder, By, Key } = selenium;
type WebDriver = selenium.WebDriver;

const here = fileURLToPath(new URL('.', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : d;
};
const BROWSER = opt('browser', 'librewolf')!;
const BINARIES: Record<string, string> = {
  librewolf: 'C:\\Program Files\\LibreWolf\\librewolf.exe',
  firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
};
const BINARY = opt('binary', BINARIES[BROWSER])!;
const EXT = resolve(opt('ext', resolve(here, '../../.output/firefox-mv3'))!);
const OUT = resolve(opt('out', 'firefox-output')!);
const ONLY = opt('only')?.split(',');
const want = (id: string): boolean => !ONLY || ONLY.includes(id);
const HEADLESS = argv.includes('--headless');
const SHOTS = join(OUT, `${BROWSER}-screens`);
mkdirSync(SHOTS, { recursive: true });

/** Fixed so the extension's own pages (storage access) have a known address. */
const EXT_ID = 'rescue@rescue-extension';
const EXT_UUID = '3b1f2f06-5d8b-4c63-9a53-6a8e3f0c7a11';
const EXT_PAGE = `moz-extension://${EXT_UUID}/media-permission.html`;
const BLOCK_RE =
  /prove your humanity|verify you are (a )?human|are you a human|whoa there, pardner|blocked by network security|captcha|access denied/i;
const LEAN_WORDS = ['far left', 'left', 'lean left', 'neutral', 'lean right', 'right', 'far right'];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------------------------
type Status = 'pass' | 'fail' | 'blocked' | 'skipped';
interface Result {
  id: string;
  title: string;
  status: Status;
  evidence: string[];
}
const results: Result[] = [];
const consoleLog: Array<{ level: string; text: string; url?: string }> = [];
let current: Result | null = null;

const note = (s: string): void => {
  current?.evidence.push(s);
  console.log(`    ${s}`);
};
function fail(s: string): void {
  if (current && current.status === 'pass') current.status = 'fail';
  note(`FAIL: ${s}`);
}
function save(): void {
  writeFileSync(
    join(OUT, `${BROWSER}-results.json`),
    JSON.stringify({ results, consoleLog }, null, 2),
  );
}
async function check(id: string, title: string, fn: () => Promise<void>): Promise<void> {
  if (!want(id)) return;
  current = { id, title, status: 'pass', evidence: [] };
  results.push(current);
  console.log(`[${id}] ${title}`);
  try {
    await fn();
  } catch (e) {
    if (e instanceof Blocked) {
      current.status = 'blocked';
      note(`blocked by Reddit: ${e.message}`);
    } else {
      current.status = 'fail';
      note(`exception: ${(e as Error).message.split('\n')[0]}`);
      await shot(`${id}-failure`).catch(() => {});
      const diag = await js<string>(
        `return JSON.stringify({ settings: !!document.querySelector('#rescue-settings'), console: !!document.querySelector('#rescue-settings')?.shadowRoot?.querySelector('.console'), menu: !!document.querySelector('#rescue-menu'), consoleBox: document.querySelector('#rescue-settings')?.shadowRoot?.querySelector('.console')?.getBoundingClientRect() })`,
      ).catch(() => '');
      if (diag) note(`dom: ${diag}`);
    }
  }
  console.log(`  -> ${current.status}`);
  save();
}
class Blocked extends Error {}

// ---------------------------------------------------------------------------------------------
// driver helpers
// ---------------------------------------------------------------------------------------------
let driver: WebDriver;

async function shot(name: string): Promise<void> {
  const png = await driver.takeScreenshot();
  writeFileSync(join(SHOTS, `${name}.png`), png, 'base64');
}
const js = <T>(script: string, ...args: unknown[]): Promise<T> =>
  driver.executeScript<T>(script, ...args);

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  ms = 15000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(250);
  }
}
const exists = (css: string): Promise<boolean> =>
  js<boolean>('return !!document.querySelector(arguments[0])', css);
const count = (css: string): Promise<number> =>
  js<number>('return document.querySelectorAll(arguments[0]).length', css);
const visible = (css: string): Promise<boolean> =>
  js<boolean>(
    `const e=document.querySelector(arguments[0]); if(!e) return false;
     const r=e.getBoundingClientRect(); const s=getComputedStyle(e);
     return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';`,
    css,
  );
const clickCss = (css: string): Promise<void> =>
  js<void>(
    `const e=document.querySelector(arguments[0]); e.scrollIntoView({block:'center'}); e.click();`,
    css,
  );

/** Loads a Reddit page; throws Blocked on a bot challenge. Waits for `ready` (a selector) too. */
async function visit(url: string, ready: string): Promise<void> {
  await driver.get(url);
  const end = Date.now() + 30000;
  for (;;) {
    const state = await js<{ text: string; app: boolean; ready: boolean }>(
      `return { text: document.title+'\\n'+(document.body?.innerText??'').slice(0,600),
        app: !!document.querySelector('shreddit-app, shreddit-post, shreddit-comment'),
        ready: !!document.querySelector(arguments[0]) };`,
      ready,
    ).catch(() => null);
    if (state?.ready) break;
    if (state && BLOCK_RE.test(state.text) && !state.app)
      throw new Blocked(state.text.split('\n')[0]!.slice(0, 100));
    if (Date.now() > end) throw new Error(`${url}: "${ready}" never appeared`);
    await sleep(500);
  }
  await sleep(1500);
}

/** Opens the extension's own page in a second tab to read/write chrome.storage.local. */
let extTab = '';
let pageTab = '';
async function withExt<T>(fn: () => Promise<T>): Promise<T> {
  await driver.switchTo().window(extTab);
  try {
    return await fn();
  } finally {
    await driver.switchTo().window(pageTab);
  }
}
const storeAll = (): Promise<Record<string, unknown>> =>
  withExt(() =>
    driver.executeAsyncScript<Record<string, unknown>>(
      'const done=arguments[arguments.length-1]; browser.storage.local.get(null).then(done)',
    ),
  );
const storeSet = (items: Record<string, unknown>): Promise<void> =>
  withExt(() =>
    driver.executeAsyncScript<void>(
      'const done=arguments[arguments.length-1]; browser.storage.local.set(arguments[0]).then(()=>done())',
      items,
    ),
  );
async function configure(
  mods: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>,
): Promise<void> {
  const all = await storeAll();
  type Mods = Record<string, { enabled?: boolean; options?: Record<string, unknown> }>;
  const prev = (all.settings as { modules?: Mods } | undefined) ?? {
    schemaVersion: 1,
    modules: {},
    keybindings: {},
    syncEnabled: false,
  };
  const modules: Mods = { ...(prev.modules ?? {}) };
  for (const [id, v] of Object.entries(mods))
    modules[id] = {
      ...(modules[id] ?? {}),
      ...v,
      options: { ...(modules[id]?.options ?? {}), ...(v.options ?? {}) },
    };
  await storeSet({ settings: { ...prev, modules } });
}

const MENU_OPENER = '#rescue-header-button, #rescue-gear';
async function openMenu(): Promise<void> {
  if (await exists('#rescue-menu')) return;
  await waitFor('REScue header button or gear', () => visible(MENU_OPENER), 20000);
  await js(
    `const o=[...document.querySelectorAll(arguments[0])].find(e=>e.getBoundingClientRect().width>0); o.click();`,
    MENU_OPENER,
  );
  await waitFor('#rescue-menu', () => visible('#rescue-menu'), 5000);
}
async function openConsole(): Promise<void> {
  await openMenu();
  await clickCss('#rescue-menu [data-menu-id="settings"]');
  await waitFor(
    'settings console',
    () =>
      js<boolean>(
        `return !!${CONSOLE_ROOT}?.querySelector('.console')?.getBoundingClientRect().width`,
      ),
    8000,
  );
  await sleep(400);
}
/** The console lives in an open shadow root on #rescue-settings. */
const CONSOLE_ROOT = `document.querySelector('#rescue-settings')?.shadowRoot`;
/**
 * Opens the console and one module's own page. The console shows a category overview first (the
 * sidebar lists that category's modules), so click the module link, falling back to its row on the
 * overview when its category is collapsed.
 */
async function openConsoleModule(moduleId: string): Promise<void> {
  await openConsole();
  const opened = await js<boolean>(
    `const r=${CONSOLE_ROOT}; const l=r?.querySelector(arguments[0]); if(!l) return false; l.click(); return true;`,
    `[data-module-link="${moduleId}"]`,
  );
  if (!opened)
    await js<boolean>(
      `const r=${CONSOLE_ROOT}; const o=r?.querySelector(arguments[0]); if(!o) return false; o.click(); return true;`,
      `[data-overview-module="${moduleId}"]`,
    );
  await waitFor(`the ${moduleId} module page`, () =>
    js<boolean>(`return !!${CONSOLE_ROOT}?.querySelector('#mod-' + arguments[0])`, moduleId),
  );
}
async function closeConsole(): Promise<void> {
  await js(`${CONSOLE_ROOT}?.querySelector('.close')?.click()`);
  await sleep(400);
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  if (!existsSync(join(EXT, 'manifest.json')))
    throw new Error(`no built extension at ${EXT}; run "npm run build:firefox" first`);
  const downloads = mkdtempSync(join(tmpdir(), 'rescue-ff-dl-'));
  const driverPath = await download(undefined, join(tmpdir(), 'rescue-geckodriver'));
  const options = new firefox.Options();
  options.setBinary(BINARY);
  options.enableBidi();
  if (HEADLESS) options.addArguments('-headless');
  options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [EXT_ID]: EXT_UUID }));
  options.setPreference('browser.download.folderList', 2);
  options.setPreference('browser.download.dir', downloads);
  options.setPreference('browser.download.useDownloadDir', true);
  options.setPreference('browser.helperApps.neverAsk.saveToDisk', 'application/json,text/plain');
  options.setPreference('browser.shell.checkDefaultBrowser', false);
  // Start from the light theme whatever the OS says (Firefox follows it; LibreWolf forces light).
  options.setPreference('layout.css.prefers-color-scheme.content-override', 1);
  // Lets the harness open the extension's own page (chrome context) for storage access.
  const service = new firefox.ServiceBuilder(driverPath).addArguments('--allow-system-access');
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();
  const caps = await driver.getCapabilities();
  const version = `${caps.get('browserName')} ${caps.get('browserVersion')}`;
  console.log(`browser: ${BROWSER} (${version}) at ${BINARY}`);
  writeFileSync(join(OUT, `${BROWSER}-version.txt`), `${BROWSER} ${version}\n`);

  try {
    const log = await LogInspector(driver);
    await log.onConsoleEntry((e: { level: string; text: string; args?: unknown[] }) =>
      consoleLog.push({ level: e.level, text: String(e.text).slice(0, 400) }),
    );
    await log.onJavascriptLog((e) => {
      consoleLog.push({
        level: `js-${e.level}`,
        text: String(e.text).slice(0, 400),
        url: String(e.stackTrace ?? '').slice(0, 200),
      });
    });
  } catch (e) {
    console.log(`console capture unavailable: ${(e as Error).message}`);
  }

  try {
    await (driver as unknown as firefox.Driver).installAddon(EXT, true);
    pageTab = await driver.getWindowHandle();
    // WebDriver may not navigate to moz-extension:// itself; open the extension page from the
    // browser (chrome) context instead, then drive it like any tab.
    const before = new Set(await driver.getAllWindowHandles());
    const ctxDriver = driver as unknown as { setContext(c: string): Promise<void> };
    await ctxDriver.setContext('chrome');
    await driver.executeScript(
      'gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })',
      EXT_PAGE,
    );
    await ctxDriver.setContext('content');
    await sleep(1500);
    extTab = (await driver.getAllWindowHandles()).find((h) => !before.has(h)) ?? '';
    if (!extTab) throw new Error('could not open the extension page tab');
    await driver.switchTo().window(extTab);
    console.log(`extension page: ${await driver.getCurrentUrl()}`);
    await driver.switchTo().window(pageTab);
    await run(downloads);
  } finally {
    save();
    await driver.quit().catch(() => {});
  }
}

const rescueErrors = (): typeof consoleLog =>
  consoleLog.filter(
    (c) =>
      /error|exception/i.test(c.level) &&
      (/rescue/i.test(c.text) ||
        /moz-extension|content-scripts|background\.js/i.test(`${c.url ?? ''} ${c.text}`)),
  );

async function run(downloads: string): Promise<void> {
  let hostNote = '';

  for (const host of ['www', 'sh']) {
    await check(
      'install',
      `extension installed, content script runs on ${host}.reddit.com`,
      async () => {
        await visit(`https://${host}.reddit.com/r/science/`, 'shreddit-post');
        const opener = await waitFor(
          'REScue header button / gear',
          () =>
            js<string | null>(
              `const o=document.querySelector(arguments[0]); return o ? (o.id + ' "' + (o.textContent||'').trim().slice(0,20) + '"') : null`,
              MENU_OPENER,
            ),
          20000,
        ).catch(() => null);
        if (!opener) {
          const diag = await js<string>(
            `return JSON.stringify({ theme: document.documentElement.getAttribute('data-rescue-theme'), posts: document.querySelectorAll('shreddit-post').length })`,
          );
          return fail(`no REScue header button or gear (${diag})`);
        }
        note(`opener: ${opener}; ${await count('shreddit-post')} posts on ${host}.`);
        hostNote = opener;
        await shot(`${host}-science`);
        const errs = rescueErrors();
        if (errs.length)
          fail(
            `REScue console errors: ${errs
              .slice(0, 3)
              .map((e) => e.text.slice(0, 120))
              .join(' | ')}`,
          );
        else
          note(`no REScue console errors (${consoleLog.length} console entries captured in total)`);
      },
    );
    if (current?.status === 'blocked' || current?.status === 'fail') break;
  }
  void hostNote;

  await check(
    'menu',
    'REScue menu and settings console open; console follows light/dark theme',
    async () => {
      await visit('https://www.reddit.com/r/science/', 'shreddit-post');
      await openMenu();
      const items = await js<string[]>(
        `return [...document.querySelectorAll('#rescue-menu [data-menu-id]')].map(e=>e.getAttribute('data-menu-id'))`,
      );
      note(
        `menu rows: ${items.slice(0, 8).join(', ')}${items.length > 8 ? `, ... (${items.length})` : ''}`,
      );
      if (!items.includes('settings')) fail('no "settings" row');
      await driver.findElement(By.css('body')).sendKeys(Key.ESCAPE);
      await openConsole();
      const bg = (): Promise<{ bg: string; theme: string | null }> =>
        js(
          `return { bg: getComputedStyle(document.querySelector('#rescue-settings').shadowRoot.querySelector('.console')).backgroundColor,
                 theme: document.documentElement.getAttribute('data-rescue-theme') }`,
        );
      const light = await bg();
      await shot('console-light');
      await js(`document.documentElement.classList.add('theme-dark')`);
      await sleep(1200);
      const dark = await bg();
      await shot('console-dark');
      await js(`document.documentElement.classList.remove('theme-dark')`);
      await sleep(1200);
      const back = await bg();
      note(
        `console background: light ${light.bg} (${light.theme}) -> dark ${dark.bg} (${dark.theme}) -> light ${back.bg} (${back.theme})`,
      );
      if (dark.theme !== 'dark' || dark.bg === light.bg)
        fail('console did not follow the dark theme class');
      if (back.theme !== 'light' || back.bg !== light.bg)
        fail('console did not return to the light theme');
      await closeConsole();
    },
  );

  await check('filter', 'keyword filter hides a post with reason, banner and "show"', async () => {
    await visit('https://www.reddit.com/r/all/', 'shreddit-post');
    // r/all changes between loads, so use a very common word and look at whatever got hidden.
    const word = 'the';
    note(`rule: keyword "${word}"`);
    await configure({
      filteReddit: {
        enabled: true,
        options: {
          filteredDisplay: 'hidden',
          showFilterline: true,
          rules: [
            {
              type: 'keyword',
              pattern: word,
              scope: 'everywhere',
              subreddits: '',
              enabled: true,
              toggle: '',
            },
          ],
        },
      },
    });
    await driver.navigate().refresh();
    await waitFor('posts', () => exists('shreddit-post'));
    await sleep(2500);
    const hiddenIds = await js<string[]>(
      `return [...document.querySelectorAll('shreddit-post')].filter(p=>p.getBoundingClientRect().height===0||getComputedStyle(p).display==='none').map(p=>p.id)`,
    );
    note(`hidden posts: ${hiddenIds.length} of ${await count('shreddit-post')}`);
    if (!hiddenIds.length) return fail('no post hidden by the rule');
    const target = { id: hiddenIds[0]! };
    const bannerText = await waitFor('filter banner', () =>
      js<string | null>(
        `const b=document.querySelector('.rescue-filter-banner'); return b && !b.hidden ? b.textContent.trim() : null`,
      ),
    ).catch(() => null);
    if (!bannerText) return fail('no filter banner');
    note(`banner: "${bannerText}"`);
    await shot('filter-hidden');
    await clickCss('.rescue-filter-toggle');
    await sleep(900);
    const reason = await js<string | null>(
      `const r=document.querySelector('.rescue-filter-reason:not([hidden])'); return r ? r.textContent.trim() : null`,
    );
    const shown = await js<boolean>(
      `const p=document.getElementById(arguments[0]); return !!p && p.getBoundingClientRect().height>0`,
      target.id,
    );
    note(`after "show": post ${target.id} visible=${shown}, reason chip="${reason}"`);
    if (!shown) fail('"show" did not reveal the post');
    if (!reason) fail('no reason chip on the revealed post');
    await shot('filter-revealed');
    await configure({ filteReddit: { options: { rules: [] } } });
  });

  await check('keys', 'j/k keyboard navigation moves the outline', async () => {
    await visit('https://www.reddit.com/r/science/', 'shreddit-post');
    await js(`window.scrollTo(0,0); document.activeElement?.blur?.()`);
    const body = driver.findElement(By.css('body'));
    const sel = (): Promise<string | null> =>
      js<string | null>(`return document.querySelector('[data-rescue-selected]')?.id ?? null`);
    await body.sendKeys('j');
    await sleep(400);
    await body.sendKeys('j');
    await sleep(600);
    const a = await sel();
    const outline = await js<number[] | null>(
      `const b=document.getElementById('rescue-selection'); if(!b) return null; const r=b.getBoundingClientRect(); return [r.left,r.top,r.width,r.height].map(Math.round)`,
    );
    note(`after j,j: selected ${a}, outline ${JSON.stringify(outline)}`);
    if (!a || !outline || outline[2]! <= 0) fail('no selection or outline after j,j');
    await shot('keys-j');
    await body.sendKeys('k');
    await sleep(600);
    const b = await sel();
    note(`after k: selected ${b}`);
    if (!b || b === a) fail('k did not move the selection back');
  });

  await check('tag', 'user tag shows beside the author and persists after reload', async () => {
    await visit('https://www.reddit.com/r/science/', 'shreddit-post');
    const link = await js<string | null>(
      `return document.querySelector('shreddit-post')?.getAttribute('permalink') ?? null`,
    );
    if (!link) return fail('no post permalink');
    await visit(`https://www.reddit.com${link}`, 'shreddit-post');
    await waitFor('tag button', () => exists('.rescue-tag-btn'), 15000);
    const author = await js<string>(
      `return document.querySelector('.rescue-tag-btn').getAttribute('aria-label')`,
    );
    note(`tagging ${author}`);
    await clickCss('.rescue-tag-btn');
    await waitFor('tag editor', () => visible('.rescue-tag-editor'), 5000);
    const input = await driver.findElement(By.css('.rescue-tag-editor input[name=text]'));
    await input.sendKeys('ffsmoke', Key.ENTER);
    await sleep(900);
    const chip = (): Promise<string | null> =>
      js<string | null>(
        `const c=[...document.querySelectorAll('.rescue-user-tag')].find(e=>e.textContent.includes('ffsmoke')); return c ? c.textContent.trim() : null`,
      );
    const c1 = await chip();
    note(`chip after save: ${c1}`);
    if (!c1) return fail('tag chip not shown after saving');
    await shot('tag-saved');
    await driver.navigate().refresh();
    await waitFor('posts', () => exists('shreddit-post'));
    await sleep(2500);
    const c2 = await chip();
    note(`chip after reload: ${c2}`);
    if (!c2) fail('tag did not persist after reload');
  });

  await check('media', 'inlineMedia collapses media with "show image" words', async () => {
    await configure({
      inlineMedia: {
        enabled: true,
        options: { collapseMedia: true, collapsePostMedia: true, scope: 'both', onlyTypes: 'all' },
      },
    });
    await visit('https://www.reddit.com/r/pics/', 'shreddit-post');
    await sleep(1500);
    const words = await js<string[]>(
      `return [...document.querySelectorAll('.rescue-media-toggle')].map(e=>e.textContent.trim())`,
    );
    note(`media controls: ${words.length} (${[...new Set(words)].slice(0, 5).join(' | ')})`);
    if (!words.length) return fail('no media toggles on r/pics');
    if (!words.every((w) => /^show (image|video|gallery|embed|media)/.test(w)))
      fail(`unexpected words: ${words.slice(0, 4).join(' | ')}`);
    const hid = await js<number>(
      `return [...document.querySelectorAll('shreddit-post div[slot=post-media-container]')].filter(e=>e.getBoundingClientRect().height===0||getComputedStyle(e).display==='none').length`,
    );
    note(`media containers collapsed: ${hid}`);
    if (!hid) fail('no media container is collapsed');
    await shot('media-collapsed');
    await clickCss('.rescue-media-toggle');
    await sleep(700);
    const after = await js<string>(
      `return document.querySelector('.rescue-media-toggle').textContent.trim()`,
    );
    note(`first control after click: "${after}"`);
    if (!/^hide /.test(after)) fail('clicking the control did not expand the media');
    await configure({ inlineMedia: { enabled: false } });
  });

  await check(
    'lean',
    'neutrality lean chips appear (background reads the bundled data)',
    async () => {
      await configure({
        neutralityFilter: { enabled: true, options: { showLean: true, showLeanScore: true } },
      });
      await visit('https://www.reddit.com/r/news/', 'shreddit-post');
      const chips = await waitFor(
        'lean chips',
        () =>
          js<string[] | null>(
            `const c=[...document.querySelectorAll('.rescue-lean-chip')].map(e=>e.textContent.trim()); return c.length?c:null`,
          ),
        20000,
      ).catch(() => [] as string[]);
      const posts = await count('shreddit-post');
      note(`${chips.length} chips on ${posts} posts: ${chips.slice(0, 6).join(' | ')}`);
      if (!chips.length) return fail('no lean chips');
      const bad = chips.filter((c) => {
        const m = /^(.+?)(?: ([+-]?\d\.\d\d))?$/.exec(c);
        const word = m?.[1] ?? '';
        const n = m?.[2] ? Number(m[2]) : null;
        if (!LEAN_WORDS.includes(word)) return true;
        if (n === null) return false;
        return (
          (word.includes('left') && n >= 0) ||
          (word.includes('right') && n <= 0) ||
          (word === 'neutral' && Math.abs(n) >= 0.3)
        );
      });
      if (bad.length)
        fail(
          `chips with an unexpected word or inconsistent number: ${bad.slice(0, 3).join(' | ')}`,
        );
      await shot('lean-chips');
      await configure({ neutralityFilter: { enabled: false } });
    },
  );

  await check('promoted', 'hide promoted posts (shreddit-ad-post)', async () => {
    await configure({ hidePromoted: { enabled: true } });
    await visit('https://www.reddit.com/r/science/', 'shreddit-post');
    await sleep(2500);
    const s = await js<{ ads: number; rendered: number; marked: number; banner: string | null }>(
      `const ads=[...document.querySelectorAll('shreddit-ad-post')];
       return { ads: ads.length, rendered: ads.filter(a=>a.getBoundingClientRect().height>0).length,
                marked: document.querySelectorAll('[data-rescue-promoted]').length,
                banner: document.querySelector('.rescue-promoted-banner')?.textContent?.trim() ?? document.body.innerText.match(/\\d+ promoted hidden/)?.[0] ?? null }`,
    );
    note(
      `shreddit-ad-post in DOM: ${s.ads}, rendered: ${s.rendered}, REScue-hidden: ${s.marked}, banner: ${s.banner}`,
    );
    if (s.rendered) fail('a promoted post is still rendered');
    if (!s.ads)
      note('no ad elements in the DOM (the blocker removed them; REScue counting 0 is correct)');
    await configure({ hidePromoted: { enabled: false } });
  });

  await check('export', 'settings export from the console produces data', async () => {
    await visit('https://www.reddit.com/r/science/', 'shreddit-post');
    await openConsoleModule('backupAndRestore');
    const clicked = await js<string | null>(
      `const m=${CONSOLE_ROOT}?.querySelector('#mod-backupAndRestore'); if(!m) return null;
       const b=[...m.querySelectorAll('button, a')].find(e=>/export backup file/i.test(e.textContent));
       if(!b) return null; b.scrollIntoView({block:'center'}); b.click(); return b.textContent.trim()`,
    );
    let file = '';
    if (clicked) {
      note(`clicked "${clicked}"`);
      file = await waitFor(
        'downloaded backup file',
        async () =>
          readdirSync(downloads).find(
            (f) => /\.json$/.test(f) && statSync(join(downloads, f)).size > 0,
          ) ?? null,
        8000,
      ).catch(() => '');
    } else note('no "Export backup file" button found on the Backup & restore module page');
    if (file) {
      const body = JSON.parse(readFileSync(join(downloads, file), 'utf8')) as Record<
        string,
        unknown
      >;
      note(`downloaded ${file}: keys ${Object.keys(body).slice(0, 6).join(', ')}`);
    } else {
      const r = await withExt(() =>
        driver.executeAsyncScript<{ ok: boolean; file?: Record<string, unknown> }>(
          `const done=arguments[arguments.length-1]; browser.runtime.sendMessage({type:'backup.export',includeRead:false}).then(done)`,
        ),
      );
      note(
        `fallback backup.export message: ok=${r?.ok}, keys ${Object.keys(r?.file ?? {})
          .slice(0, 6)
          .join(', ')}`,
      );
      if (!r?.ok) fail('backup.export failed');
      else if (clicked)
        fail('button clicked but no file was downloaded (export message itself works)');
    }
    await closeConsole();
  });

  // Per post, how many REScue controls of each kind there are (a kind = the first rescue-* class
  // that is not the shared look). More than one of a kind means a post is decorated twice.
  const KINDS = `
    const generic = new Set(['rescue-btn', 'rescue-label']);
    const out = { posts: 0, max: 0, dup: [], instance: document.documentElement.getAttribute('data-rescue-instance'), foreign: 0, tags: {} };
    const token = out.instance;
    out.foreign = [...document.querySelectorAll('[data-rescue-owner]')].filter(e => e.getAttribute('data-rescue-owner') !== token).length;
    for (const post of document.querySelectorAll('shreddit-post')) {
      out.posts++;
      out.tags[post.tagName] = (out.tags[post.tagName] || 0) + 1;
      const kinds = {};
      for (const el of post.querySelectorAll('[class*="rescue-"]')) {
        const k = [...el.classList].find(c => c.startsWith('rescue-') && !generic.has(c));
        if (k) kinds[k] = (kinds[k] || 0) + 1;
      }
      for (const [k, n] of Object.entries(kinds)) {
        out.max = Math.max(out.max, n);
        if (n > 1) out.dup.push(post.id + ':' + k + 'x' + n);
      }
    }
    return out;`;
  type Kinds = {
    posts: number;
    max: number;
    dup: string[];
    instance: string | null;
    foreign: number;
    tags: Record<string, number>;
  };

  await check(
    'controls',
    'each post has at most one REScue control per kind; credit-bar screenshot',
    async () => {
      await visit('https://www.reddit.com/r/science/', 'shreddit-post');
      await configure({
        filteReddit: { enabled: true, options: { inlineControls: true, rules: [] } },
      });
      await driver.navigate().refresh();
      await waitFor('filter buttons', () => exists('.rescue-filter-btn'), 20000);
      await sleep(2000);
      const k = await js<Kinds>(KINDS);
      note(
        `posts ${k.posts}, max controls of one kind on a post: ${k.max}, instance ${k.instance}`,
      );
      if (k.dup.length) fail(`duplicated controls: ${k.dup.slice(0, 5).join(', ')}`);
      const bar = await js<string>(
        `const p=document.querySelector('shreddit-post:has(.rescue-filter-btn)'); p.scrollIntoView({block:'center'});
       return [...p.querySelectorAll('.rescue-btn,.rescue-label')].map(e=>e.className.split(' ')[0]+'="'+e.textContent.trim()+'"').join(' | ')`,
      );
      note(`first post controls: ${bar}`);
      const el = await driver.findElement(By.css('shreddit-post:has(.rescue-filter-btn)'));
      writeFileSync(join(SHOTS, 'credit-bar.png'), await el.takeScreenshot(), 'base64');
      await js(`document.documentElement.classList.add('theme-dark')`);
      await sleep(1200);
      writeFileSync(join(SHOTS, 'credit-bar-dark.png'), await el.takeScreenshot(), 'base64');
      await js(`document.documentElement.classList.remove('theme-dark')`);
    },
  );

  await check(
    'reload',
    'reloading the add-on twice with the tab open leaves one set of controls',
    async () => {
      await visit('https://www.reddit.com/r/science/', 'shreddit-post');
      await waitFor('filter buttons', () => exists('.rescue-filter-btn'), 20000);
      const before = await js<Kinds>(KINDS);
      note(`before: instance ${before.instance}, max per kind ${before.max}`);
      for (let i = 1; i <= 2; i++) {
        await (driver as unknown as firefox.Driver).installAddon(EXT, true);
        await waitFor(
          'the new instance to decorate',
          () => exists('.rescue-filter-btn'),
          20000,
        ).catch(() => null);
        await sleep(1500);
        const k = await js<Kinds>(KINDS);
        note(
          `rescue nodes: ${await count('[data-rescue-owner]')}, gear: ${await exists('#rescue-gear')}, console tail: ${consoleLog
            .slice(-3)
            .map((c) => c.level + ':' + c.text.slice(0, 80))
            .join(' | ')}`,
        );
        const total = await count('.rescue-filter-btn');
        note(
          `after reload ${i}: instance ${k.instance}, max per kind ${k.max}, foreign nodes ${k.foreign}, filter buttons ${total}`,
        );
        if (k.max > 1)
          fail(`reload ${i}: a post has duplicated controls (${k.dup.slice(0, 3).join(', ')})`);
        if (k.foreign) fail(`reload ${i}: ${k.foreign} nodes of a dead instance remain`);
      }
      // A route change makes every live instance rescan the page; with several, each decorated it.
      await js(`history.pushState(null, '', '/r/science/new/')`);
      await sleep(4000);
      const routed = await js<Kinds>(KINDS);
      note(
        `after a route change: max per kind ${routed.max}, filter buttons ${await count('.rescue-filter-btn')} on ${routed.posts} posts`,
      );
      if (routed.max > 1)
        fail(`route change: duplicated controls (${routed.dup.slice(0, 3).join(', ')})`);
      await shot('after-reload');
    },
  );

  await check('popular', 'r/popular: is the page decorated? (logged out)', async () => {
    await visit('https://www.reddit.com/r/popular/', 'shreddit-post, shreddit-app');
    await sleep(3000);
    const k = await js<Kinds>(KINDS);
    const route = await js<string>(
      `return location.pathname + ' | html class: ' + document.documentElement.className.slice(0,80)`,
    );
    note(
      `${route}; posts ${k.posts} (${JSON.stringify(k.tags)}), instance ${k.instance}, filter buttons ${await count('.rescue-filter-btn')}, rescue nodes ${await count('[data-rescue-owner]')}, header button ${await exists(MENU_OPENER)}`,
    );
    await shot('popular');
  });

  console.log(`REScue console errors over the whole run: ${rescueErrors().length}`);
}

await main().catch((e) => {
  console.error(e);
  save();
  process.exit(1);
});
void here;
