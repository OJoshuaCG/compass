import { baseConfig } from '@iam/config/eslint/base';

export default [
  // Artefactos generados por las pruebas de navegador: no son código del repositorio.
  { ignores: ['.web-dist/**', 'test-results/**', 'playwright-report/**'] },
  ...baseConfig({ node: true }),
];
