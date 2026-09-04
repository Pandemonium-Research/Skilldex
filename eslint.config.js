// Flat config (ESLint 9). The repo previously had no ESLint config and no TypeScript
// parser installed, so `npm run lint` never ran — it only printed a migration notice.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly' },
      // Typed linting: `return-await` needs type information, and it is the rule that
      // would have caught the A1 cleanup race on its own.
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Caught the defect A1 fixed: a bare `return promise` inside a try whose finally
      // cleans up lets the cleanup run before the promise settles.
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests deliberately construct malformed input and lean on vitest's mock typing.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
)
