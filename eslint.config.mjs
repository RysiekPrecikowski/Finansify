import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Package boundaries are enforced here, not by convention.
 *
 * The dependency arrow is one-directional and must stay that way:
 *
 *   apps/web  ->  packages/db  ->  packages/core
 *   apps/web  ->  packages/core
 *
 * `core` is pure: no I/O, no framework, no database. That is what makes it
 * cheap to test and safe to reuse later. If a rule below fires, the fix is to
 * move the code to the right package -- not to add an eslint-disable.
 */
const forbiddenInCore = [
  {
    group: ['@finansify/db', '@finansify/db/**'],
    message:
      'core must not depend on db. Pass data in as arguments instead; the caller owns I/O. See docs/architecture.md.',
  },
  {
    group: ['next', 'next/**', 'react', 'react-dom', 'react/**'],
    message: 'core must stay framework-free. UI code belongs in apps/web.',
  },
  {
    group: ['drizzle-orm', 'drizzle-orm/**', 'postgres', '@supabase/**'],
    message: 'core must stay I/O-free. Database and network access belongs in packages/db.',
  },
];

const forbiddenInDb = [
  {
    group: ['next', 'next/**', 'react', 'react-dom', 'react/**'],
    message: 'db must not depend on the web framework. Move UI concerns to apps/web.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      'packages/db/drizzle/**',
      'apps/web/src/components/ui/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenInCore }],
      // Money must never round through binary floating point.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use toDecimal() from ./money. See docs/domain.md.' },
        { name: 'parseInt', message: 'Use toDecimal() from ./money. See docs/domain.md.' },
      ],
    },
  },

  {
    files: ['packages/db/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenInDb }],
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },

  prettier,
);
