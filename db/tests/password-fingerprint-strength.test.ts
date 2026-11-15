import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

const CHECK_VIOLATION = '23514';
const NO_FAILURE = 'none';
const MIN_SCORE = 0;
const MAX_SCORE = 4;
const SCORE_ABOVE_MAX = 5;
const SCORE_BELOW_MIN = -1;

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

async function setScore(tenant: Tenant, score: number | null): Promise<string> {
  return sqlState(
    app,
    `update password_fingerprints
        set strength_score = $2, strength_scored_at = now()
      where credential_id = $1`,
    [tenant.credentialId, score],
    tenant.orgId,
  );
}

describe('password_fingerprints: puntaje de fortaleza (0042)', () => {
  it('las huellas anteriores a la migración quedan sin puntaje, no con uno inventado', async () => {
    const { rows } = await admin.query<{ strength_score: number | null }>(
      'select strength_score from password_fingerprints where credential_id = $1',
      [a.credentialId],
    );
    expect(rows[0]?.strength_score).toBeNull();
  });

  it('acepta de 0 a 4 y rechaza lo que queda fuera del rango', async () => {
    expect(await setScore(a, MIN_SCORE)).toBe(NO_FAILURE);
    expect(await setScore(a, MAX_SCORE)).toBe(NO_FAILURE);
    expect(await setScore(a, SCORE_ABOVE_MAX)).toBe(CHECK_VIOLATION);
    expect(await setScore(a, SCORE_BELOW_MIN)).toBe(CHECK_VIOLATION);
  });

  it('el puntaje de una organización no es visible ni modificable desde otra', async () => {
    await setScore(b, 3);

    const { rows } = await inOrg(app, a.orgId, () =>
      app.query('select 1 from password_fingerprints where credential_id = $1', [b.credentialId]),
    );

    expect(rows).toHaveLength(0);
    const { rowCount } = await inOrg(app, a.orgId, () =>
      app.query('update password_fingerprints set strength_score = 0 where credential_id = $1', [
        b.credentialId,
      ]),
    );
    expect(rowCount).toBe(0);
  });
});
