import { test, expect, type BrowserContext } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';

// FR-008 / quickstart scenario 16.
const URL = 'https://www.reddit.com/r/adultsub/';

const AGE_GATE = `<shreddit-app><div class="configured-xpromo-modal">
  <p>You must be 18+ to view this community</p>
  <button onclick="window.__over18 = (window.__over18 || 0) + 1">Yes, I'm over 18</button>
  <button onclick="window.__declined = 1">No, go back</button>
</div></shreddit-app>`;

const LOGIN_WALL = `<shreddit-app><div id="main-content"></div></shreddit-app>
<div id="desktop-dynamic-upsell-dialog">Log in to keep reading
  <a href="/login/" onclick="window.__loginClicked = 1; return false;">Log in</a>
  <a href="/register/" onclick="window.__signupClicked = 1; return false;">Sign up</a>
</div><script>document.body.classList.add('rpl-scroll-lock')</script>`;

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
});
test.afterEach(async () => {
  await ctx.close();
});

const mainWorld = <T>(page: import('@playwright/test').Page, expr: string) =>
  page.evaluate((e) => (0, eval)(e) as T, expr);

test('age gate: REScue notice appears; over18 is pressed only after Continue', async () => {
  await serveRedditPage(ctx, URL, htmlDoc(AGE_GATE));
  const page = await ctx.newPage();
  await page.goto(URL);
  const notice = page.locator('[data-rescue-notice="age-gate"]');
  await expect(notice).toBeVisible();
  await page.waitForTimeout(500);
  expect(await mainWorld(page, 'window.__over18')).toBeUndefined();
  await notice.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => mainWorld(page, 'window.__over18')).toBe(1);
  expect(await mainWorld(page, 'window.__declined')).toBeUndefined();
});

test('login wall: left alone by default; hidden only when enabled; never clicks log-in or sign-up', async () => {
  await serveRedditPage(ctx, URL, htmlDoc(LOGIN_WALL));
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForTimeout(800);
  await expect(page.locator('#desktop-dynamic-upsell-dialog')).toHaveCount(1);

  await page.goto(`${URL}#rescue:settings/interstitials`);
  await page.locator('#rescue-settings [data-option="interstitials.removeLoginWall"]').check();
  await page.goto(URL);
  await page.reload();
  await expect(page.locator('#desktop-dynamic-upsell-dialog')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/rpl-scroll-lock/);
  expect(await mainWorld(page, 'window.__loginClicked')).toBeUndefined();
  expect(await mainWorld(page, 'window.__signupClicked')).toBeUndefined();
});
