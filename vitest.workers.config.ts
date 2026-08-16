// Worker tests run in workerd, not in Node with mocks.
//
// Durable Object semantics — hibernation above all — do not survive being
// faked: the whole failure mode is that an object loses memory in a way a
// mock never would. `@cloudflare/vitest-pool-workers` runs the real runtime,
// and `runInDurableObject` reaches inside a live object to assert on it.
//
// Kept separate from vitest.config.ts so the 242 engine/server tests keep
// running in plain Node, untouched and fast.
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['tests/worker/**/*.test.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        // Off because these tests hold WebSockets open across assertions, and
        // the storage stack cannot unwind while a Durable Object still has live
        // connections. Every test uses its own room name, so the isolation it
        // provides is not needed here.
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // The act controls, so the dev path is covered by tests rather than
          // only in production where it must never be on.
          bindings: { LONG_NOON_DEV: '0' },
        },
      },
    },
  },
});
