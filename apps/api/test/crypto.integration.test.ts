import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  DataKeyResolver,
  DekCache,
  LocalKeyManagement,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from '../src/modules/crypto/index.js';
import { PgUnitOfWork } from '../src/modules/organization/index.js';
import { AsyncLocalRequestContext } from '../src/shared/infrastructure/async-local-request-context.js';
import { SystemClock } from '../src/shared/infrastructure/system-clock.js';
import { asOrganizationId } from '../src/shared/kernel/index.js';
import type { OrganizationId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

let db: TestDatabase;
let orgA: OrganizationId;
let orgB: OrganizationId;
let kekDir: string;
const requestContext = new AsyncLocalRequestContext();
let uow: PgUnitOfWork;
let keys: DataKeyResolver;
let cipher: SecretCipher;
let kms: LocalKeyManagement;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  orgA = asOrganizationId(await db.seedOrganization('crypto-a'));
  orgB = asOrganizationId(await db.seedOrganization('crypto-b'));
  kekDir = mkdtempSync(join(tmpdir(), 'iam-kek-'));
  uow = new PgUnitOfWork(db.appPool, requestContext, db.independentPool);
  kms = new LocalKeyManagement({ keyFilePath: join(kekDir, 'kek.key'), nodeEnv: 'test' });
  const clock = new SystemClock();
  keys = new DataKeyResolver({
    repository: new PgDataKeyRepository(uow),
    kms,
    cache: new DekCache({ clock }),
    clock,
    independently: (fn) => uow.runIndependent(fn),
  });
  cipher = new SecretCipher({ keys, primitives: new NodeCryptoPrimitives() });
});

afterAll(async () => {
  await db.close();
  rmSync(kekDir, { recursive: true, force: true });
});

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const read = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const inOrg = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
  requestContext.run(contextFor(org), () => uow.run(fn));
const ctx = (org: OrganizationId, resourceId = 'cred-1') => ({
  organizationId: org,
  resourceId,
  field: 'password',
  version: 1,
});

describe('envelope encryption on PostgreSQL', () => {
  it('creates the first DEK lazily, stores only the wrapped key, and round-trips a secret', async () => {
    const sealed = await inOrg(orgA, async () => {
      const result = await cipher.encrypt(ctx(orgA), text('hunter2'));
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    });

    expect(sealed.dekVersion).toBe(1);
    const opened = await inOrg(orgA, () => cipher.decrypt(ctx(orgA), sealed));
    expect(opened.ok && read(opened.value)).toBe('hunter2');

    const stored = await db.admin.query<{ wrapped_dek: Buffer; status: string }>(
      'select wrapped_dek, status from data_keys where organization_id = $1',
      [orgA],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.status).toBe('active');
    // Lo guardado es la DEK envuelta por el KMS (nonce + DEK cifrada + etiqueta), no 32 bytes en claro.
    expect(stored.rows[0]?.wrapped_dek.length).toBe(12 + 32 + 16);
  });

  it('creates exactly one active DEK when many instances race on first use', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        // Cada llamada usa su propia conexión (UoW propio) y su propia caché: simula 10 instancias.
        const clock = new SystemClock();
        const instance = new DataKeyResolver({
          repository: new PgDataKeyRepository(uow),
          kms,
          cache: new DekCache({ clock }),
          clock,
          independently: (fn) => uow.runIndependent(fn),
        });
        const racing = new SecretCipher({ keys: instance, primitives: new NodeCryptoPrimitives() });
        return inOrg(orgB, () => racing.encrypt(ctx(orgB, `race-${String(i)}`), text('v')));
      }),
    );

    expect(results.every((r) => r.ok)).toBe(true);
    const active = await db.admin.query<{ n: string }>(
      "select count(*) as n from data_keys where organization_id = $1 and status = 'active'",
      [orgB],
    );
    expect(active.rows[0]?.n).toBe('1');
    const versions = new Set(results.map((r) => (r.ok ? r.value.dekVersion : -1)));
    expect(versions.size).toBe(1);
  });

  it('rotates: new secrets use v2 while v1 ciphertexts stay readable', async () => {
    const old = await inOrg(orgA, async () => {
      const r = await cipher.encrypt(ctx(orgA, 'before-rotation'), text('old-secret'));
      if (!r.ok) throw new Error(r.error.code);
      return r.value;
    });

    const version = await inOrg(orgA, () => keys.rotate(orgA));
    expect(version).toBe(2);

    const states = await db.admin.query<{ version: number; status: string }>(
      'select version, status from data_keys where organization_id = $1 order by version',
      [orgA],
    );
    expect(states.rows).toEqual([
      { version: 1, status: 'retired' },
      { version: 2, status: 'active' },
    ]);

    const fresh = await inOrg(orgA, async () => {
      const r = await cipher.encrypt(ctx(orgA, 'after-rotation'), text('new-secret'));
      if (!r.ok) throw new Error(r.error.code);
      return r.value;
    });
    expect(fresh.dekVersion).toBe(2);
    const stillReadable = await inOrg(orgA, () =>
      cipher.decrypt(ctx(orgA, 'before-rotation'), old),
    );
    expect(stillReadable.ok && read(stillReadable.value)).toBe('old-secret');
  });

  it('keeps caches consistent when the caller transaction rolls back after creating the first DEK', async () => {
    const orgC = asOrganizationId(await db.seedOrganization('crypto-c'));

    // La primera DEK se crea dentro de una transacción del llamador que luego falla.
    await expect(
      inOrg(orgC, async () => {
        await cipher.encrypt(ctx(orgC, 'doomed'), text('lost'));
        throw new Error('caller failed after encrypting');
      }),
    ).rejects.toThrow('caller failed');

    // La DEK sobrevive al rollback ajeno (se confirmó en su propia transacción)...
    const persisted = await db.admin.query<{ n: string }>(
      'select count(*) as n from data_keys where organization_id = $1',
      [orgC],
    );
    expect(persisted.rows[0]?.n).toBe('1');

    // ...y lo que se cifra después usa esa misma DEK: un proceso nuevo (caché vacía) lo descifra.
    const sealed = await inOrg(orgC, async () => {
      const r = await cipher.encrypt(ctx(orgC, 'after'), text('kept'));
      if (!r.ok) throw new Error(r.error.code);
      return r.value;
    });
    const clock = new SystemClock();
    const freshProcess = new SecretCipher({
      keys: new DataKeyResolver({
        repository: new PgDataKeyRepository(uow),
        kms,
        cache: new DekCache({ clock }),
        clock,
        independently: (fn) => uow.runIndependent(fn),
      }),
      primitives: new NodeCryptoPrimitives(),
    });
    const opened = await inOrg(orgC, () => freshProcess.decrypt(ctx(orgC, 'after'), sealed));
    expect(opened.ok && read(opened.value)).toBe('kept');
  });

  it("cannot read another organization's keys through RLS", async () => {
    const seen = await inOrg(orgB, () => new PgDataKeyRepository(uow).findActive(orgA));
    expect(seen).toBeNull();
  });

  it('a ciphertext sealed for org A does not open as org B, even with the same ids', async () => {
    const sealed = await inOrg(orgA, async () => {
      const r = await cipher.encrypt(ctx(orgA, 'shared-id'), text('a-only'));
      if (!r.ok) throw new Error(r.error.code);
      return r.value;
    });
    // Se materializa también la DEK de B para que la prueba no falle por "sin clave".
    await inOrg(orgB, () => cipher.encrypt(ctx(orgB, 'shared-id'), text('b')));

    const asB = await inOrg(orgB, () => cipher.decrypt(ctx(orgB, 'shared-id'), sealed));

    expect(asB.ok).toBe(false);
  });

  it('keeps secrets out of the database: only ciphertext reaches a table', async () => {
    const marker = 'PLAINTEXT-MARKER-9f3a';
    await inOrg(orgA, () => cipher.encrypt(ctx(orgA, 'leak-check'), text(marker)));

    const dump = await db.admin.query<{ t: string }>(
      "select string_agg(wrapped_dek::text, '') as t from data_keys",
    );
    expect(dump.rows[0]?.t ?? '').not.toContain(marker);
  });
});
