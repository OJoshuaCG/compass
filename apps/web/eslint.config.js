import { createRequire } from 'node:module';

import { baseConfig } from '@iam/config/eslint/base';

// Los plugins son dependencias de @iam/config (no de esta app): se resuelven desde allí
// para no duplicar versiones ni tocar el package.json de la app.
const requireFromConfig = createRequire(import.meta.resolve('@iam/config/eslint/base'));
const loadPlugin = (name) => {
  const mod = requireFromConfig(name);
  return mod.default ?? mod;
};
const boundaries = loadPlugin('eslint-plugin-boundaries');
const reactHooks = loadPlugin('eslint-plugin-react-hooks');

/**
 * Regla de dependencia de docs/frontend.md §3.2:
 * - `shared` solo importa `shared` (nunca `features`).
 * - Entre features, y desde `routes`/`app`, solo por la fachada `index.ts`.
 */
const boundariesConfig = {
  files: ['src/**/*.{ts,tsx}'],
  plugins: { boundaries },
  settings: {
    // El resolvedor por defecto no conoce .ts/.tsx: sin esto los imports no se asocian a
    // ningún elemento y la regla no detecta nada.
    'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js', '.json'] } },
    'boundaries/elements': [
      { type: 'app', pattern: 'src/app', partialMatch: false },
      { type: 'routes', pattern: 'src/routes', partialMatch: false },
      { type: 'feature', pattern: 'src/features/*', capture: ['featureName'], partialMatch: false },
      { type: 'shared', pattern: 'src/shared', partialMatch: false },
    ],
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        default: 'disallow',
        policies: [
          { from: { element: { type: 'shared' } }, allow: { to: { element: { type: 'shared' } } } },
          {
            from: { element: { type: 'feature' } },
            allow: { to: { element: { types: { anyOf: ['shared', 'feature'] } } } },
          },
          {
            from: { element: { type: 'routes' } },
            allow: { to: { element: { types: { anyOf: ['shared', 'feature', 'routes'] } } } },
          },
          {
            from: { element: { type: 'app' } },
            allow: {
              to: { element: { types: { anyOf: ['shared', 'feature', 'routes', 'app'] } } },
            },
          },
          // Entre features (y desde routes/app) solo se importa la fachada pública `index.ts`.
          // Va al final: la última política que coincide manda.
          {
            disallow: { to: { element: { type: 'feature', fileInternalPath: '!index.ts' } } },
            message: 'Importa el feature solo por su fachada index.ts (docs/frontend.md §3.2).',
          },
        ],
      },
    ],
  },
};

export default [
  ...baseConfig({ browser: true, node: false }),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules ?? {},
  },
  boundariesConfig,
  {
    // Seguridad en el navegador (docs/frontend.md §9): CSP estricta y Trusted Types.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Prohibido (CSP/Trusted Types).',
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'Sin estilos en línea (CSP estricta): usa clases.',
        },
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: 'Prohibido innerHTML.',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // vite.config.ts corre en Node.
    files: ['vite.config.ts'],
    languageOptions: { globals: { process: 'readonly' } },
  },
];
