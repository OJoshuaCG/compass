import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { PgSigningKeyStore } from '../src/modules/crypto/index.js';
import type { StoredSigningKey } from '../src/modules/crypto/index.js';
import { createTestDatabase } from './support/database.js';
import type { TestDatabase } from './support/database.js';

/**
 * Claves de firma del emisor OIDC con el rol de la aplicación (`iam_app`): ¿solo se alcanzan por las
 * funciones `auth.*`, el sobre cifrado viaja intacto y retirar una clave la saca del listado? (ADR 0052)
 */

let db: TestDatabase;
let store: PgSigningKeyStore;

beforeAll(async () => {
  db = await createTestDatabase(inject('adminUrl'));
  store = new PgSigningKeyStore(db.appPool);
});

afterAll(async () => {
  await db.close();
});

const AUDIT_ACTOR = 'os:integration-test';

const keyWith = (kid: string, ciphertext: number[]): StoredSigningKey => ({
  kid,
  algorithm: 'ES256',
  publicJwk: { kty: 'EC', crv: 'P-256', kid, alg: 'ES256', use: 'sig' },
  privateJwkCiphertext: Uint8Array.from(ciphertext),
});

describe('PgSigningKeyStore', () => {
  it('guarda una clave, la lista con su sobre intacto y la retira', async () => {
    const kid = `kid-${crypto.randomUUID()}`;
    await store.add(keyWith(kid, [1, 2, 3, 250]), AUDIT_ACTOR);

    const listed = (await store.listActive()).find((key) => key.kid === kid);
    expect(listed?.algorithm).toBe('ES256');
    expect(listed?.publicJwk).toMatchObject({ kid, alg: 'ES256' });
    expect(Array.from(listed?.privateJwkCiphertext ?? [])).toEqual([1, 2, 3, 250]);

    expect(await store.retire(kid, AUDIT_ACTOR)).toBe(true);
    expect((await store.listActive()).some((key) => key.kid === kid)).toBe(false);
  });

  it('cada alta y cada retiro dejan una fila de auditoría de plataforma con el actor', async () => {
    const kid = `kid-${crypto.randomUUID()}`;
    await store.add(keyWith(kid, [7]), AUDIT_ACTOR);
    await store.retire(kid, AUDIT_ACTOR);

    const audit = await db.admin.query<{ event_type: string; actor: string }>(
      'select event_type, actor from platform_audit_events where subject = $1 order by occurred_at',
      [kid],
    );
    expect(audit.rows).toEqual([
      { event_type: 'oidc_signing_key.added', actor: AUDIT_ACTOR },
      { event_type: 'oidc_signing_key.retired', actor: AUDIT_ACTOR },
    ]);
  });

  it('retirar una clave inexistente o ya retirada devuelve false', async () => {
    const kid = `kid-${crypto.randomUUID()}`;
    expect(await store.retire(kid, AUDIT_ACTOR)).toBe(false);
    await store.add(keyWith(kid, [9]), AUDIT_ACTOR);
    expect(await store.retire(kid, AUDIT_ACTOR)).toBe(true);
    expect(await store.retire(kid, AUDIT_ACTOR)).toBe(false);
  });

  it('lista de la más antigua a la más nueva', async () => {
    const first = `kid-${crypto.randomUUID()}`;
    const second = `kid-${crypto.randomUUID()}`;
    await store.add(keyWith(first, [1]), AUDIT_ACTOR);
    await store.add(keyWith(second, [2]), AUDIT_ACTOR);
    const kids = (await store.listActive()).map((key) => key.kid);
    expect(kids.indexOf(first)).toBeLessThan(kids.indexOf(second));
  });

  it('la aplicación no alcanza la tabla directamente: solo por las funciones auth.*', async () => {
    await expect(db.appPool.query('select * from oidc_signing_keys')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      db.appPool.query(`delete from oidc_signing_keys where status = 'active'`),
    ).rejects.toThrow(/permission denied/i);
  });
});
