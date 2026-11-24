import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sha256, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

// Pruebas de la migración 0045 (ADR 0052): `oidc_clients`, `oidc_payloads`, `oidc_signing_keys` y las
// funciones `auth.*` que resuelven la organización antes de que exista contexto.

const NO_FAILURE = 'none';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const NO_PRIVILEGE = '42501';
const CIPHERTEXT = '\\x00112233445566778899aabbccddeeff';
// Desde la migración 0047 toda alta o retiro de clave de firma lleva su actor (platform-audit.test.ts).
const SIGNING_KEY_ACTOR = 'os:db-test';
const ONE_HOUR_FROM_NOW_SQL = "now() + interval '1 hour'";

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

async function insertClient(
  tenant: Tenant,
  clientId: string,
  extraColumns = '',
  extraValues = '',
  fixedOrganizationId: string = tenant.orgId,
): Promise<string> {
  return sqlState(
    app,
    `insert into oidc_clients
       (organization_id, client_id, name, secret_ciphertext, redirect_uris, created_by${extraColumns})
     values ($1, $2, 'Grafana', $3, array['https://grafana.example.test/login'], $4${extraValues})`,
    [fixedOrganizationId, clientId, CIPHERTEXT, tenant.rootId],
    tenant.orgId,
  );
}

async function insertSession(tenant: Tenant, label: string): Promise<string> {
  const { rows } = await inOrg(app, tenant.orgId, () =>
    app.query<{ id: string }>(
      `insert into sessions (organization_id, user_id, token_hash, expires_at)
       values ($1, $2, $3, ${ONE_HOUR_FROM_NOW_SQL}) returning id`,
      [tenant.orgId, tenant.rootId, sha256(`session-${tenant.tag}-${label}`)],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error('session was not created');
  return row.id;
}

async function insertPayload(
  tenant: Tenant,
  keyLabel: string,
  options: { sessionId?: string; uid?: string; expiresSql?: string } = {},
): Promise<string> {
  return sqlState(
    app,
    `insert into oidc_payloads
       (organization_id, model, key_hash, payload, uid, user_id, compass_session_id, expires_at)
     values ($1, 'AccessToken', $2, '{}'::jsonb, $3, $4, $5, ${options.expiresSql ?? ONE_HOUR_FROM_NOW_SQL})`,
    [tenant.orgId, sha256(keyLabel), options.uid ?? null, tenant.rootId, options.sessionId ?? null],
    tenant.orgId,
  );
}

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

describe('oidc_clients', () => {
  it('guarda un cliente válido y aísla las filas por organización', async () => {
    expect(await insertClient(a, 'client-org-a-1')).toBe(NO_FAILURE);
    const own = await inOrg(app, a.orgId, () =>
      app.query("select 1 from oidc_clients where client_id = 'client-org-a-1'"),
    );
    const other = await inOrg(app, b.orgId, () =>
      app.query("select 1 from oidc_clients where client_id = 'client-org-a-1'"),
    );
    expect(own.rowCount).toBe(1);
    expect(other.rowCount).toBe(0);
  });

  it('rechaza una fila de otra organización dentro del contexto actual', async () => {
    expect(await insertClient(a, 'client-cross-org', '', '', b.orgId)).toBe(NO_PRIVILEGE);
  });

  it('exige una justificación escrita para permitir refresh tokens', async () => {
    expect(await insertClient(a, 'client-refresh-no-why', ', allow_refresh_tokens', ', true')).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await insertClient(
        a,
        'client-refresh-with-why',
        ', allow_refresh_tokens, refresh_justification',
        ", true, 'Sesiones largas de panel de monitoreo'",
      ),
    ).toBe(NO_FAILURE);
  });

  it('mantiene único el client_id en toda la plataforma', async () => {
    expect(await insertClient(a, 'client-unique-id')).toBe(NO_FAILURE);
    expect(await insertClient(b, 'client-unique-id')).toBe(UNIQUE_VIOLATION);
  });

  it('acota el rango máximo y el formato del identificador', async () => {
    expect(await insertClient(a, 'client-bad-rank', ', max_rank', ', 4')).toBe(CHECK_VIOLATION);
    expect(await insertClient(a, 'bad id!')).toBe(CHECK_VIOLATION);
  });

  it('no permite borrar clientes (se deshabilitan)', async () => {
    expect(
      await sqlState(
        app,
        "delete from oidc_clients where client_id = 'client-org-a-1'",
        [],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
  });
});

describe('oidc_payloads', () => {
  it('aísla las filas por organización', async () => {
    expect(await insertPayload(a, 'token-a-1')).toBe(NO_FAILURE);
    const seenByB = await inOrg(app, b.orgId, () => app.query('select 1 from oidc_payloads'));
    expect(seenByB.rowCount).toBe(0);
  });

  it('no deja ligar una fila a la sesión de otra organización', async () => {
    const sessionOfA = await insertSession(a, 'cross');
    expect(await insertPayload(b, 'token-b-cross', { sessionId: sessionOfA })).toBe(
      FOREIGN_KEY_VIOLATION,
    );
    expect(await insertPayload(a, 'token-a-linked', { sessionId: sessionOfA })).toBe(NO_FAILURE);
  });

  it('impide repetir un identificador del mismo modelo', async () => {
    expect(await insertPayload(a, 'token-dup')).toBe(NO_FAILURE);
    expect(await insertPayload(b, 'token-dup')).toBe(UNIQUE_VIOLATION);
  });

  it('borra en bloque por sesión de Compass sin tocar otras sesiones', async () => {
    const sessionOne = await insertSession(a, 'one');
    const sessionTwo = await insertSession(a, 'two');
    await insertPayload(a, 'token-s1', { sessionId: sessionOne });
    await insertPayload(a, 'token-s2', { sessionId: sessionTwo });
    const deleted = await inOrg(app, a.orgId, () =>
      app.query('delete from oidc_payloads where compass_session_id = $1', [sessionOne]),
    );
    expect(deleted.rowCount).toBe(1);
    const remaining = await inOrg(app, a.orgId, () =>
      app.query('select 1 from oidc_payloads where compass_session_id = $1', [sessionTwo]),
    );
    expect(remaining.rowCount).toBe(1);
  });
});

describe('funciones auth.* de resolución de organización', () => {
  it('devuelve la organización de un client_id exacto y nada para patrones', async () => {
    await insertClient(b, 'client-lookup-b');
    const exact = await app.query<{ organization_id: string; status: string }>(
      'select * from auth.find_oidc_client_org($1)',
      ['client-lookup-b'],
    );
    expect(exact.rows).toEqual([{ organization_id: b.orgId, status: 'active' }]);
    for (const probe of ['%', 'client-lookup-%', "' or 1=1 --", '', 'client-lookup-b ']) {
      const result = await app.query('select * from auth.find_oidc_client_org($1)', [probe]);
      expect(result.rowCount, `probe: ${JSON.stringify(probe)}`).toBe(0);
    }
  });

  it('resuelve por hash de identificador y por uid, sin devolver filas vencidas', async () => {
    await insertPayload(a, 'token-lookup', { uid: 'uid-lookup-1' });
    await insertPayload(a, 'token-expired', {
      uid: 'uid-expired',
      expiresSql: "now() - interval '1 minute'",
    });
    const byHash = await app.query<{ organization_id: string }>(
      'select * from auth.find_oidc_payload_org($1, $2)',
      ['AccessToken', sha256('token-lookup')],
    );
    expect(byHash.rows).toEqual([{ organization_id: a.orgId }]);
    const byUid = await app.query<{ organization_id: string }>(
      'select * from auth.find_oidc_payload_org_by_uid($1, $2)',
      ['AccessToken', 'uid-lookup-1'],
    );
    expect(byUid.rows).toEqual([{ organization_id: a.orgId }]);
    const expired = await app.query('select * from auth.find_oidc_payload_org($1, $2)', [
      'AccessToken',
      sha256('token-expired'),
    ]);
    expect(expired.rowCount).toBe(0);
  });
});

describe('oidc_signing_keys (tabla de plataforma)', () => {
  it('la aplicación no la lee ni la escribe directamente', async () => {
    expect(await sqlState(app, 'select kid from oidc_signing_keys')).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        app,
        `insert into oidc_signing_keys (kid, alg, public_jwk, private_jwk_ciphertext)
         values ('direct-insert-key', 'ES256', '{}'::jsonb, $1)`,
        [CIPHERTEXT],
      ),
    ).toBe(NO_PRIVILEGE);
  });

  it('añade, lista y retira claves solo por las funciones', async () => {
    await app.query('select auth.add_oidc_signing_key($1, $2, $3::jsonb, $4, $5)', [
      'signing-key-one',
      'ES256',
      '{"kty":"EC"}',
      CIPHERTEXT,
      SIGNING_KEY_ACTOR,
    ]);
    const listed = await app.query<{ kid: string; alg: string }>(
      'select kid, alg from auth.list_oidc_signing_keys()',
    );
    expect(listed.rows).toContainEqual({ kid: 'signing-key-one', alg: 'ES256' });

    const retired = await app.query<{ retire_oidc_signing_key: boolean }>(
      'select auth.retire_oidc_signing_key($1, $2)',
      ['signing-key-one', SIGNING_KEY_ACTOR],
    );
    expect(retired.rows[0]?.retire_oidc_signing_key).toBe(true);
    const after = await app.query('select kid from auth.list_oidc_signing_keys()');
    expect(after.rows.map((row: { kid: string }) => row.kid)).not.toContain('signing-key-one');
    const again = await app.query<{ retire_oidc_signing_key: boolean }>(
      'select auth.retire_oidc_signing_key($1, $2)',
      ['signing-key-one', SIGNING_KEY_ACTOR],
    );
    expect(again.rows[0]?.retire_oidc_signing_key).toBe(false);
  });

  it('rechaza un identificador de clave repetido', async () => {
    await app.query('select auth.add_oidc_signing_key($1, $2, $3::jsonb, $4, $5)', [
      'signing-key-dup',
      'RS256',
      '{"kty":"RSA"}',
      CIPHERTEXT,
      SIGNING_KEY_ACTOR,
    ]);
    expect(
      await sqlState(app, 'select auth.add_oidc_signing_key($1, $2, $3::jsonb, $4, $5)', [
        'signing-key-dup',
        'RS256',
        '{"kty":"RSA"}',
        CIPHERTEXT,
        SIGNING_KEY_ACTOR,
      ]),
    ).toBe(UNIQUE_VIOLATION);
  });
});

describe('seguridad de las funciones auth.* de OIDC', () => {
  it('son SECURITY DEFINER con search_path fijo, de un rol sin BYPASSRLS y solo ejecutables por iam_app', async () => {
    const { rows } = await admin.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      owner: string;
      bypass: boolean;
      pub: boolean;
      app: boolean;
    }>(`
      select p.proname, p.prosecdef, p.proconfig, r.rolname as owner, r.rolbypassrls as bypass,
             has_function_privilege('public', p.oid, 'EXECUTE') as pub,
             has_function_privilege('iam_app', p.oid, 'EXECUTE') as app
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'auth'
      join pg_roles r on r.oid = p.proowner
      where p.proname like '%oidc%'
      order by p.proname`);
    expect(rows.map((row) => row.proname)).toEqual([
      'add_oidc_signing_key',
      'find_oidc_client_org',
      'find_oidc_payload_org',
      'find_oidc_payload_org_by_uid',
      'list_oidc_signing_keys',
      'retire_oidc_signing_key',
    ]);
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect(row.proconfig, row.proname).toContain('search_path=pg_catalog');
      expect(row.owner, row.proname).toBe('iam_auth_reader');
      expect(row.bypass, row.proname).toBe(false);
      expect(row.pub, row.proname).toBe(false);
      expect(row.app, row.proname).toBe(true);
    }
  });
});
