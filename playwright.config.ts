import { defineConfig } from '@playwright/test';

// Browser suites load the packed extension from .output/ (built by `npm run test:browser`).
// Fixture pages are served from tests/fixtures by the harness in tests/browser/harness.ts.
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  projects: [
    { name: 'chromium', testMatch: /.*\.spec\.ts/ },
    { name: 'firefox-smoke', testMatch: /.*\.smoke\.spec\.ts/, use: { browserName: 'firefox' } },
  ],
});
