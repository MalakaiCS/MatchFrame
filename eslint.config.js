import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['infra/media-spike/out/**', '.data/**', '**/test-results/**', '**/playwright-report/**', '**/dist/**', '**/.next/**', '**/node_modules/**', 'infra/media-spike/template/dist/**', '**/drizzle/**', '**/next-env.d.ts', '**/public/sw.js'] },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
);
