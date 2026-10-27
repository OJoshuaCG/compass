/**
 * Levanta la plataforma completa para las pruebas de navegador, igual que en producción salvo el
 * proveedor de correo y el KMS (de desarrollo): PostgreSQL real en un contenedor, migraciones con
 * el rol de migraciones, una organización con su Raíz, y la API sirviendo la SPA compilada desde
 * el MISMO origen (con su CSP estricta y la cookie de sesión `__Host-`).
 *
 * También expone un buzón de pruebas (solo local) para leer el enlace de la última invitación,
 * como lo haría la persona invitada desde su correo.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { bootstrapRoles, migrate } from '@iam/db';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';

import { buildContainer } from '../../apps/api/dist/app/container.js';
import { createApp } from '../../apps/api/dist/app/create-app.js';
import { LocalKeyManagement } from '../../apps/api/dist/modules/crypto/index.js';
import { NodeCryptoPrimitives } from '../../apps/api/dist/modules/crypto/index.js';
import { InMemoryMailer } from '../../apps/api/dist/modules/notification/index.js';
import {
  BootstrapOrganization,
  PgOrganizationSeeder,
} from '../../apps/api/dist/modules/provisioning/index.js';
import { createLogger } from '../../apps/api/dist/shared/infrastructure/logger.js';

export const API_PORT = 3100;
export const MAILBOX_PORT = 3101;
export const ROOT_EMAIL = 'root@e2e.test';
export const ROOT_PASSWORD = 'Correct-Horse-Battery-Staple-9';

const withCredentials = (
  base: string,
  user: string,
  password: string,
  database: string,
): string => {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
};

const container = await new PostgreSqlContainer('postgres:17-alpine').start();
const clusterUrl = container.getConnectionUri();
const database = 'iam_e2e';

const root = new Client({ connectionString: clusterUrl });
await root.connect();
await root.query(`create database ${database}`);
await root.end();

const admin = new URL(clusterUrl);
const adminUrl = withCredentials(clusterUrl, admin.username, admin.password, database);
await bootstrapRoles({ connectionString: adminUrl });
const adminClient = new Client({ connectionString: adminUrl });
await adminClient.connect();
await adminClient.query("alter role iam_migrator login password 'migrator-e2e-pw'");
await adminClient.query("alter role iam_app login password 'app-e2e-pw'");
await adminClient.end();
await migrate({
  connectionString: withCredentials(clusterUrl, 'iam_migrator', 'migrator-e2e-pw', database),
});

const appUrl = withCredentials(clusterUrl, 'iam_app', 'app-e2e-pw', database);
const pool = new Pool({ connectionString: appUrl, max: 8 });
const independentPool = new Pool({ connectionString: appUrl, max: 2 });
const adminPool = new Pool({ connectionString: adminUrl, max: 2 });

const kekDir = mkdtempSync(join(tmpdir(), 'iam-e2e-kek-'));
const mailer = new InMemoryMailer();
const logger = createLogger({ level: process.env['E2E_LOG'] ?? 'warn' });
const platform = buildContainer({
  pool,
  independentPool,
  mailer,
  logger,
  kms: new LocalKeyManagement({ keyFilePath: join(kekDir, 'kek.key'), nodeEnv: 'test' }),
});

await new BootstrapOrganization({
  seeder: new PgOrganizationSeeder(adminPool),
  hasher: platform.hasher,
  strength: platform.strength,
  ids: platform.ids,
  randomBytes: (length) => new NodeCryptoPrimitives().randomBytes(length),
  sha256: (data) => new NodeCryptoPrimitives().sha256(data),
}).execute({
  name: 'E2E Organization',
  slug: 'e2e',
  rootEmail: ROOT_EMAIL,
  rootDisplayName: 'Ada Lovelace',
  rootPassword: ROOT_PASSWORD,
});

const origin = `http://127.0.0.1:${String(API_PORT)}`;
const app = await createApp({
  logger,
  container: platform,
  appOrigin: origin,
  webDistDir: process.env['E2E_WEB_DIST'] ?? resolve(import.meta.dirname, '../../apps/web/dist'),
});
await app.listen(API_PORT, '127.0.0.1');

// Buzón de pruebas: solo escucha en local y solo lo usan las pruebas.
const mailbox = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/last') {
    response.end(JSON.stringify(mailer.last ?? null));
    return;
  }
  if (request.url === '/count') {
    response.end(JSON.stringify({ count: mailer.sent.length }));
    return;
  }
  response.statusCode = 404;
  response.end('{}');
});
await new Promise<void>((done) => mailbox.listen(MAILBOX_PORT, '127.0.0.1', done));

process.stdout.write(`E2E stack ready at ${origin}\n`);
process.stdout.write(
  [
    '',
    'Entorno local listo (datos efímeros: se borran al detener este proceso).',
    `  Aplicación : ${origin}`,
    `  Correo     : ${ROOT_EMAIL}`,
    `  Contraseña : ${ROOT_PASSWORD}`,
    `  Buzón de pruebas (último correo enviado): http://127.0.0.1:${String(MAILBOX_PORT)}/last`,
    '  La primera vez, la Raíz debe registrar su segundo factor (TOTP) al entrar.',
    '  Detener con Ctrl+C.',
    '',
  ].join('\n'),
);

const shutdown = async (): Promise<void> => {
  mailbox.close();
  await app.close();
  await platform.shutdown();
  await adminPool.end();
  rmSync(kekDir, { recursive: true, force: true });
  await container.stop();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
