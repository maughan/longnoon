import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The Durable Object tests need the real Workers runtime and have their own
    // config (vitest.workers.config.ts, `npm run test:worker`). Running them in
    // Node fails on `cloudflare:test`, which is not a module Node has.
    exclude: ['tests/worker/**', '**/node_modules/**'],
    environment: 'node',
  },
});
