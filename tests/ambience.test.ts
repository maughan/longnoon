import { test, expect } from 'vitest';

// The Act I bed, and the lifecycle that broke it.
//
// Browser audio fails silently by design: a closed AudioContext throws inside an
// async method, the rejection goes unobserved, and the music simply never
// arrives. React StrictMode makes dispose-then-remount the DEFAULT path in
// development rather than an edge case, so this is worth a test even though
// nothing else in `client/` has one.

// Typechecked by client/tsconfig.json, not the root one: this file drives
// browser APIs and the root project has no DOM lib on purpose. See the
// `exclude` in tsconfig.json.

// A minimum viable AudioContext that behaves like the real one in the way that
// matters: everything throws once it has been closed.
function mockAudio() {
  const started: string[] = [];
  class Ctx {
    state = 'running'; currentTime = 0; closed = false;
    private guard() { if (this.closed) throw new Error('InvalidStateError'); }
    createGain() { this.guard(); return { gain: { value: 0,
      cancelScheduledValues() {}, setValueAtTime() {},
      exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {} }; }
    createBufferSource() {
      this.guard();
      return { buffer: null, loop: false, connect() {},
        start: () => started.push('play'), stop() {} };
    }
    async decodeAudioData() { this.guard(); return {} as AudioBuffer; }
    async resume() { this.guard(); }
    async close() { this.closed = true; }
  }
  (globalThis as any).AudioContext = Ctx;
  (globalThis as any).fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(8) });
  (globalThis as any).window = { addEventListener() {}, removeEventListener() {} };
  return started;
}

test('a disposed bed does not poison the remount (StrictMode)', async () => {
  const started = mockAudio();
  const { createAmbience } = await import('../client/src/components/Ambience');

  // What React StrictMode does in development: mount, tear down, mount again.
  let bed: ReturnType<typeof createAmbience> | null = null;

  bed ??= createAmbience();
  await bed.start(0.45);
  expect(started.length, 'first mount plays').toBe(1);

  bed.dispose();
  bed = null;                       // <- the fix. Without it the next ??= is a no-op.

  bed ??= createAmbience();
  await bed.start(0.45);
  expect(started.length, 'remount plays again').toBe(2);
});

test('a disposed bed is inert rather than throwing', async () => {
  mockAudio();
  const { createAmbience } = await import('../client/src/components/Ambience');
  const bed = createAmbience();
  await bed.start(0.4);
  bed.dispose();
  // These are what a late React cleanup or a slider drag would call.
  expect(() => bed.setVolume(0.2)).not.toThrow();
  expect(() => bed.fadeOut(1)).not.toThrow();
  expect(() => bed.dispose()).not.toThrow();
  await expect(bed.start(0.4)).resolves.toBeUndefined();
});

test('reusing a disposed bed is silent — which is why the ref must be cleared', async () => {
  const started = mockAudio();
  const { createAmbience } = await import('../client/src/components/Ambience');
  // The bug as it was: the ref survived dispose, so `??=` found a truthy value
  // and the remount called start() on a dead context. Nothing played, and
  // nothing was logged — the worst shape a bug can take.
  const bed = createAmbience();
  await bed.start(0.45);
  bed.dispose();
  await bed.start(0.45);
  expect(started.length, 'a dead bed can never play again').toBe(1);
});

test('starting twice does not layer a second loop', async () => {
  const started = mockAudio();
  const { createAmbience } = await import('../client/src/components/Ambience');
  const bed = createAmbience();
  await Promise.all([bed.start(0.4), bed.start(0.4), bed.start(0.4)]);
  expect(started.length).toBe(1);
});
