import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/temp/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'fixtures/envelopes/golden/**',
      '**/.vitest/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // noUncheckedIndexedAccess makes `!` the clearest way to state a checked index access.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Event payloads are plain JSON objects; deleting a key is how a field is removed from the wire.
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    files: ['**/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Plain-JS test infrastructure (mock server, e2e): typed loosely on purpose.
    files: ['e2e/**/*.js', 'e2e/**/*.mjs', 'tooling/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
);
