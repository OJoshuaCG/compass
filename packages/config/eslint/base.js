// Reglas base compartidas. Cada app añade sus propias reglas de límites (boundaries).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** @param {{ node?: boolean, browser?: boolean }} opts */
export function baseConfig({ node = false, browser = false } = {}) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', '.turbo/**', 'node_modules/**'] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        globals: { ...(node ? globals.node : {}), ...(browser ? globals.browser : {}) },
        parserOptions: { projectService: true },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        'no-console': ['error', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always'],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
  );
}
