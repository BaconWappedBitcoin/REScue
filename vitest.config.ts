import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    // One happy-dom per worker instead of one per file (per-file module isolation is kept); the
    // forks pool spent most of a run creating happy-dom and sometimes timed out starting workers.
    pool: 'vmThreads',
    globals: true,
    include: ['tests/unit/**/*.test.ts'],
  },
});
