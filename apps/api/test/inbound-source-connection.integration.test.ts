import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  PgInboundConfigurationRepository,
  PgInboundSourceConnectionRepository,
} from '../src/modules/inbound-codes/index.js';
import type { SourceConnectionWrite } from '../src/modules/inbound-codes/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { UuidV7Generator } from '../src/shared/infrastructure/uuid-v7-generator.js';
import { asUserId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Conexión IMAP de una fuente con el rol de la aplicación (`iam_app`, sin BYPASSRLS): ¿conservar, borrar y
 * guardar la contraseña tocan exactamente las tres columnas cifradas, y nada cruza de organización?
 */

let db: TestDatabase;
let uow: PgUnitOfWork;
let configuration: PgInboundConfigurationRepository;
let connections: PgInboundSourceConnectionRepository;
const requestContext = new AsyncLocalRequestContext();
const ids = new UuidV7Generator();

const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));

interface Fixture {
  readonly organization: string;
  readonly root: string;
  readonly sourceId: string;
  readonly rootEmail: string;
}

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  configuration = new PgInboundConfigurationRepository(uow);
  connections = new PgInboundSourceConnectionRepository(uow);
});

afterAll(async () => {
  await db.close();
});

async function seedFixture(slug: string): Promise<Fixture> {
  const organization = await db.seedOrganization(slug);
  const rootEmail = `root-${slug}@example.test`;
  const result = await db.admin.query<{ id: string }>(
    `insert into users (organization_id, email, display_name, rank, status)
     values ($1, $2, 'Raíz', 0, 'active') returning id`,
    [organization, rootEmail],
  );
  const root = result.rows[0]?.id;
  if (root === undefined) throw new Error('seed failed');
  // La FK de `dek_version` exige que la clave de datos exista; el contenido envuelto no se usa aquí. Solo
  // puede haber una clave activa por organización: la 1 queda retirada y la 3 activa.
  for (const [version, status] of [
    [1, 'retired'],
    [3, 'active'],
  ] as const) {
    await db.admin.query(
      "insert into data_keys (organization_id, version, wrapped_dek, kms_key_ref, status) values ($1, $2, '\\x0102', 'local/test', $3)",
      [organization, version, status],
    );
  }
  const sourceId = ids.next();
  const outcome = await inOrg(organization, () =>
    configuration.insertSource({
      id: sourceId,
      address: `codes@${slug}.example`,
      displayName: 'Buzón',
      accountId: null,
      createdBy: asUserId(root),
    }),
  );
  expect(outcome).toBe('inserted');
  return { organization, root, sourceId, rootEmail };
}

// La base exige al menos 16 bytes de cifrado (texto más etiqueta) y un nonce de 12.
const CIPHERTEXT_A = new Uint8Array(16).fill(1);
const NONCE_A = new Uint8Array(12).fill(2);
const CIPHERTEXT_B = new Uint8Array(24).fill(9);
const NONCE_B = new Uint8Array(12).fill(8);

function baseWrite(fixture: Fixture): SourceConnectionWrite {
  return {
    sourceId: fixture.sourceId,
    host: 'imap.example.com',
    port: 993,
    tlsMode: 'tls',
    username: 'codes@example.com',
    authservId: 'mx.example.com',
    acceptedRecipients: ['codes@example.com'],
    password: {
      kind: 'set',
      encrypted: {
        ciphertext: CIPHERTEXT_A,
        nonce: NONCE_A,
        dekVersion: 1,
      },
    },
    secretVersion: 1,
    createdBy: asUserId(fixture.root),
  };
}

interface PasswordColumns {
  readonly password_ciphertext: Buffer | null;
  readonly password_nonce: Buffer | null;
  readonly dek_version: number | null;
  readonly secret_version: number;
}

async function passwordColumns(sourceId: string): Promise<PasswordColumns | undefined> {
  const result = await db.admin.query<PasswordColumns>(
    `select password_ciphertext, password_nonce, dek_version, secret_version
       from mail_source_connections where source_id = $1`,
    [sourceId],
  );
  return result.rows[0];
}

describe('PgInboundSourceConnectionRepository', () => {
  it('inserta con contraseña y la lectura solo informa que existe', async () => {
    const fixture = await seedFixture('conn-insert');

    const saved = await inOrg(fixture.organization, () => connections.insert(baseWrite(fixture)));
    const found = await inOrg(fixture.organization, () => connections.find(fixture.sourceId));

    expect(saved.hasPassword).toBe(true);
    expect(found).toMatchObject({
      sourceId: fixture.sourceId,
      host: 'imap.example.com',
      acceptedRecipients: ['codes@example.com'],
      hasPassword: true,
      secretVersion: 1,
    });
    expect(Object.keys(found ?? {})).not.toContain('passwordCiphertext');
    const columns = await passwordColumns(fixture.sourceId);
    expect(columns?.password_ciphertext).toEqual(Buffer.from(CIPHERTEXT_A));
    expect(columns?.dek_version).toBe(1);
  });

  it('keep conserva las columnas cifradas y clear las vacía las tres a la vez', async () => {
    const fixture = await seedFixture('conn-keep-clear');
    await inOrg(fixture.organization, () => connections.insert(baseWrite(fixture)));

    const kept = await inOrg(fixture.organization, () =>
      connections.update({
        ...baseWrite(fixture),
        authservId: 'mx2.example.com',
        password: { kind: 'keep' },
      }),
    );
    expect(kept.hasPassword).toBe(true);
    expect((await passwordColumns(fixture.sourceId))?.password_nonce).toEqual(Buffer.from(NONCE_A));

    const cleared = await inOrg(fixture.organization, () =>
      connections.update({
        ...baseWrite(fixture),
        host: 'imap2.example.com',
        password: { kind: 'clear' },
        secretVersion: 2,
      }),
    );
    expect(cleared.hasPassword).toBe(false);
    expect(await passwordColumns(fixture.sourceId)).toEqual({
      password_ciphertext: null,
      password_nonce: null,
      dek_version: null,
      secret_version: 2,
    });
  });

  it('set reemplaza la contraseña y guarda la versión nueva', async () => {
    const fixture = await seedFixture('conn-set');
    await inOrg(fixture.organization, () => connections.insert(baseWrite(fixture)));

    await inOrg(fixture.organization, () =>
      connections.update({
        ...baseWrite(fixture),
        password: {
          kind: 'set',
          encrypted: { ciphertext: CIPHERTEXT_B, nonce: NONCE_B, dekVersion: 3 },
        },
        secretVersion: 2,
      }),
    );

    expect(await passwordColumns(fixture.sourceId)).toEqual({
      password_ciphertext: Buffer.from(CIPHERTEXT_B),
      password_nonce: Buffer.from(NONCE_B),
      dek_version: 3,
      secret_version: 2,
    });
  });

  it('cuenta correos de personas solo de la propia organización', async () => {
    const mine = await seedFixture('conn-email-a');
    const other = await seedFixture('conn-email-b');

    const counts = await inOrg(mine.organization, async () => ({
      own: await connections.countUserEmails([mine.rootEmail, 'nobody@example.com']),
      foreign: await connections.countUserEmails([other.rootEmail]),
      none: await connections.countUserEmails(['nobody@example.com']),
    }));

    expect(counts).toEqual({ own: 1, foreign: 0, none: 0 });
  });

  it('no ve ni modifica la conexión de otra organización', async () => {
    const mine = await seedFixture('conn-iso-a');
    const other = await seedFixture('conn-iso-b');
    await inOrg(other.organization, () => connections.insert(baseWrite(other)));

    const seen = await inOrg(mine.organization, async () => ({
      find: await connections.find(other.sourceId),
      forUpdate: await connections.findForUpdate(other.sourceId),
    }));
    await expect(
      inOrg(mine.organization, () =>
        connections.update({ ...baseWrite(other), host: 'imap.attacker.example' }),
      ),
    ).rejects.toThrow();

    expect(seen).toEqual({ find: null, forUpdate: null });
    const theirs = await inOrg(other.organization, () => connections.find(other.sourceId));
    expect(theirs?.host).toBe('imap.example.com');
  });
});
