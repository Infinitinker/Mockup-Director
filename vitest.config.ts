import { defineConfig } from 'vitest/config';

// Unit tests in tests/, mirroring src/. They run in Node: the code they cover needs no DOM.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
