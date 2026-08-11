import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
    // The scaffold ships with no tests yet -- don't fail CI until the first one lands.
    passWithNoTests: true,
  },
});
