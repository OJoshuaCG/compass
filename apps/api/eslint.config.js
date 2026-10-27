// Regla de dependencia de la arquitectura hexagonal (docs/backend.md §3.2).
// La regla entre módulos (solo por `index.ts`) y los ciclos los verifica dependency-cruiser.
import { baseConfig } from '@iam/config/eslint/base';

const CRYPTO_PATHS = [
  { name: 'node:crypto', message: 'La criptografía solo vive en modules/crypto (SecretCipher).' },
  { name: 'crypto', message: 'La criptografía solo vive en modules/crypto (SecretCipher).' },
];

const NEST = {
  group: ['@nestjs/*'],
  message: 'NestJS solo se usa en interface/ y en *.module.ts.',
};
const DATABASE = {
  group: ['drizzle-orm', 'drizzle-orm/*', 'pg'],
  message: 'El acceso a la base de datos solo vive en infrastructure/.',
};
const HTTP = {
  group: ['fastify', '@fastify/*'],
  message: 'Fastify solo se usa en interface/ y en los puntos de entrada.',
};
const NODE = {
  group: ['node:*'],
  message: 'domain y application no dependen de Node: usa un puerto.',
};
const UP_APPLICATION = { group: ['**/application/**'], message: 'domain no importa application.' };
const UP_INFRASTRUCTURE = {
  group: ['**/infrastructure/**'],
  message: 'Solo infrastructure y *.module.ts conocen los adaptadores.',
};
const UP_INTERFACE = {
  group: ['**/interface/**'],
  message: 'interface no se importa hacia dentro.',
};

/** @param {Array<{name: string, message: string}>} paths @param {Array<object>} patterns */
const restrict = (paths, patterns) => ({
  'no-restricted-imports': ['error', { paths, patterns }],
});

export default [
  ...baseConfig({ node: true }),
  // Todo el código: nada de criptografía fuera de modules/crypto.
  {
    files: ['src/**/*.ts'],
    rules: {
      ...restrict(CRYPTO_PATHS, []),
      // Los módulos de Nest (`@Module`) son clases vacías con decorador por diseño.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  // domain y kernel: TS puro.
  {
    files: ['src/modules/*/domain/**/*.ts', 'src/shared/kernel/**/*.ts'],
    rules: restrict(CRYPTO_PATHS, [
      NEST,
      DATABASE,
      HTTP,
      NODE,
      UP_APPLICATION,
      UP_INFRASTRUCTURE,
      UP_INTERFACE,
    ]),
  },
  // application: sin framework, sin base de datos, sin Node, sin adaptadores.
  {
    files: ['src/modules/*/application/**/*.ts'],
    rules: restrict(CRYPTO_PATHS, [NEST, DATABASE, HTTP, NODE, UP_INFRASTRUCTURE, UP_INTERFACE]),
  },
  // infrastructure: puede usar bibliotecas, nunca la capa de interfaz.
  {
    files: ['src/modules/*/infrastructure/**/*.ts'],
    rules: restrict(CRYPTO_PATHS, [UP_INTERFACE]),
  },
  // Único módulo autorizado a importar node:crypto.
  {
    files: ['src/modules/crypto/infrastructure/**/*.ts'],
    rules: restrict([], [UP_INTERFACE]),
  },
  // interface: llega a los casos de uso, no a los adaptadores (van por inyección).
  {
    files: ['src/modules/*/interface/**/*.ts'],
    rules: restrict(CRYPTO_PATHS, [UP_INFRASTRUCTURE]),
  },
  // Pruebas y dobles de prueba pueden usar utilidades de Node.
  {
    files: ['**/*.test.ts', 'src/modules/*/testing/**/*.ts', 'test/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
