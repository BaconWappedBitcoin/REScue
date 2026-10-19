import { defineConfig } from '@playwright/test';

// Live runs hit real Reddit: manual or scheduled only, never in CI on every push.
export default defineConfig({
  testDir: '.',
  testMatch: /(verify-contracts|smoke-extension)\.ts$/,
  workers: 1,
  reporter: [['list']],
  use: { browserName: 'chromium', headless: false, viewport: { width: 1280, height: 900 } },
});
