import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Reddit origins REScue runs on. old.reddit.com is handled by its own small entrypoint.
export const REDDIT_MATCHES = ['*://www.reddit.com/*', '*://reddit.com/*', '*://sh.reddit.com/*'];
export const REDDIT_EXCLUDES = ['*://*.reddit.com/media*'];

export default defineConfig({
  srcDir: 'src',
  // WXT_OUT_DIR builds elsewhere, e.g. on local disk when the repo is on a network share.
  outDir: process.env.WXT_OUT_DIR ?? '.output',
  vite: () => ({ plugins: [preact()] }),
  hooks: {
    // The neutrality scores ship as a plain data file the background reads on request (not inside
    // any script, so pages that do not use it never parse it). Not web-accessible.
    'build:publicAssets': (_wxt, files) => {
      files.push({
        absoluteSrc: resolve('src/data/neutrality-scores.json'),
        relativeDest: 'neutrality-scores.json',
      });
    },
  },
  // The AMO source upload: the project as reviewers need it, without the session notes.
  zip: { excludeSources: ['docs/handoff.md', 'test-results/**', 'tests/fixtures/captured/**'] },
  manifest: ({ browser }) => ({
    name: 'REScue',
    description: 'Reddit Enhancement Suite features for modern Reddit and sh.reddit.com.',
    homepage_url: 'https://github.com/BaconWappedBitcoin/REScue',
    // Firefox does not accept declarativeNetRequest as an optional permission. There REScue holds
    // declarativeNetRequestWithHostAccess (no install warning), which can only act on hosts the
    // user also granted, and *.redd.it stays optional: blocking is still opt-in.
    permissions:
      browser === 'firefox'
        ? ['storage', 'unlimitedStorage', 'declarativeNetRequestWithHostAccess']
        : ['storage', 'unlimitedStorage'],
    host_permissions: REDDIT_MATCHES,
    // Asked for only when the user turns on "Block media downloads" (inlineMedia), from the
    // extension's own permission page; nothing here is granted at install.
    ...(browser === 'firefox' ? {} : { optional_permissions: ['declarativeNetRequest'] }),
    optional_host_permissions: ['*://*.redd.it/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'rescue@rescue-extension',
              strict_min_version: '128.0',
              // AMO's declaration that the add-on collects and transmits no data.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : { minimum_chrome_version: '120' }),
  }),
});
