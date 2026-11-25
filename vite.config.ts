import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // Some tests draw and read whole pictures; shared build machines are slow.
  test: { environment: 'node', testTimeout: 60_000 },
});
