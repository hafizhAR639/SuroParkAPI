import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Source uses NodeNext with explicit `.js` import specifiers (valid for the compiled ESM
  // runtime under tsx/node). Vite/Vitest resolves those `.js` specifiers to their `.ts`
  // sources by stripping the extension, then using Vite's default `.ts` resolution.
  resolve: {
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }],
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
