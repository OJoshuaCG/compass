/**
 * Consola de claves de firma OIDC (ADR 0052, runbook `rotate-oidc-signing-keys`):
 * `list | rotate [ES256|RS256] | retire <kid>`. Imprime una línea JSON por acción con el kid, el
 * algoritmo, la hora UTC y el usuario del sistema operativo; nunca material de claves. Sale con
 * código 1 si la acción falla. La API carga las claves solo al arrancar: reiníciala después de
 * `rotate` y de `retire`.
 */
import { userInfo } from 'node:os';

import { Pool } from 'pg';

import { loadConfig } from './app/config.js';
import { createKeyManagement } from './app/key-management.js';
import {
  NodeCryptoPrimitives,
  NodeSigningKeyGenerator,
  PgSigningKeyStore,
  PlatformEnvelope,
  SigningKeyCommandError,
  SigningKeyOperations,
  SigningKeyService,
  formatSigningKeyRecord,
  parseSigningKeyArguments,
} from './modules/crypto/index.js';
import type { SigningKeyRecord } from './modules/crypto/index.js';
import { SystemClock } from './shared/infrastructure/system-clock.js';

function reportFailure(error: unknown): void {
  if (error instanceof SigningKeyCommandError) {
    process.stderr.write(`${error.code}: ${error.message}\n`);
    return;
  }
  // Los errores de dominio y de infraestructura pueden traer detalles internos: solo el nombre.
  const name = error instanceof Error ? error.name : 'UnknownError';
  const code = (error as { code?: unknown }).code;
  process.stderr.write(`Falló la operación (${typeof code === 'string' ? code : name})\n`);
}

function printRecords(records: readonly SigningKeyRecord[]): void {
  for (const record of records) process.stdout.write(`${formatSigningKeyRecord(record)}\n`);
}

try {
  const command = parseSigningKeyArguments(process.argv.slice(2));

  const config = loadConfig(process.env);
  if (config.DATABASE_URL === undefined) {
    throw new Error('Missing or invalid environment: DATABASE_URL');
  }

  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
  try {
    const operations = new SigningKeyOperations({
      service: new SigningKeyService({
        store: new PgSigningKeyStore(pool),
        generator: new NodeSigningKeyGenerator(),
        envelope: new PlatformEnvelope({
          kms: createKeyManagement(config),
          primitives: new NodeCryptoPrimitives(),
        }),
      }),
      clock: new SystemClock(),
      operator: userInfo().username,
    });

    if (command.action === 'list') printRecords(await operations.list());
    else if (command.action === 'rotate')
      printRecords([await operations.rotate(command.algorithm)]);
    else printRecords([await operations.retire(command.kid)]);
  } finally {
    await pool.end();
  }
} catch (error: unknown) {
  reportFailure(error);
  process.exitCode = 1;
}
