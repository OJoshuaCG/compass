import { baseConfig } from '@iam/config/eslint/base';

export default [
  ...baseConfig({ browser: true }),
  // vitest.config.ts queda fuera del tsconfig del paquete (solo incluye src).
  { ignores: ['vitest.config.ts'] },
  {
    // Contratos de seguridad del frontend (docs/frontend.md §9).
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
    },
  },
];
