import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, sqlState } from './helpers.js';

// SENSIBLE (revisión humana): migración 0047, auditoría de plataforma de la rotación de claves de firma OIDC
// (ADR 0052, opción C). Sin ella no se activa SSO en producción.
// Se comprueba que (1) toda alta o retiro de clave deja su fila en la MISMA sentencia, (2) sin actor no se
// escribe nada (falla cerrado), (3) la aplicación no toca la tabla, (4) la tabla es de solo agregar incluso
// para el administrador y (5) no queda ninguna función vieja que permita rotar sin auditar.

const NO_FAILURE = 'none';
const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';
const NO_PRIVILEGE = '42501';
const APPEND_ONLY_VIOLATION = 'P0001';
const CIPHERTEXT = '\\x00112233445566778899aabbccddeeff';
const OPERATOR_ACTOR = 'os:ocarrasco';

const ADD_KEY_SQL = 'select auth.add_oidc_signing_key($1, $2, $3::jsonb, $4, $5)';
const RETIRE_KEY_SQL = 'select auth.retire_oidc_signing_key($1, $2) as retired';

interface AuditRow {
  event_type: string;
  subject: string;
  details: Record<string, unknown>;
  actor: string;
}

let admin: Client;
let app: Client;

async function auditRowsFor(kid: string): Promise<AuditRow[]> {
  const { rows } = await admin.query<AuditRow>(
    `select event_type, subject, details, actor
       from platform_audit_events
      where subject = $1
      order by occurred_at, id`,
    [kid],
  );
  return rows;
}

async function addKey(kid: string, actor: string | null = OPERATOR_ACTOR): Promise<string> {
  return sqlState(app, ADD_KEY_SQL, [kid, 'ES256', '{"kty":"EC"}', CIPHERTEXT, actor]);
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

describe('alta de una clave de firma', () => {
  it('guarda la clave y escribe su fila de auditoría con el actor y el algoritmo', async () => {
    const kid = 'audit-add-key-1';
    expect(await addKey(kid)).toBe(NO_FAILURE);

    const rows = await auditRowsFor(kid);
    expect(rows).toEqual([
      {
        event_type: 'oidc_signing_key.added',
        subject: kid,
        details: { alg: 'ES256' },
        actor: OPERATOR_ACTOR,
      },
    ]);
  });

  it('nunca guarda material de clave en la auditoría', async () => {
    const kid = 'audit-add-key-secret';
    await addKey(kid);
    const { rows } = await admin.query<{ serialized: string }>(
      'select to_jsonb(e)::text as serialized from platform_audit_events e where subject = $1',
      [kid],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.serialized).not.toContain('00112233');
    expect(rows[0]?.serialized).not.toContain('"kty"');
  });

  it('sin actor no se crea la clave ni la fila: falla cerrado', async () => {
    const kid = 'audit-add-key-no-actor';
    expect(await addKey(kid, null)).toBe(NOT_NULL_VIOLATION);
    expect(await addKey(kid, '')).toBe(CHECK_VIOLATION);

    expect(await auditRowsFor(kid)).toEqual([]);
    const { rows } = await app.query(
      'select kid from auth.list_oidc_signing_keys() where kid = $1',
      [kid],
    );
    expect(rows).toHaveLength(0);
  });

  it('un identificador repetido no deja una segunda fila de auditoría', async () => {
    const kid = 'audit-add-key-dup';
    expect(await addKey(kid)).toBe(NO_FAILURE);
    expect(await addKey(kid)).not.toBe(NO_FAILURE);
    expect(await auditRowsFor(kid)).toHaveLength(1);
  });
});

describe('retiro de una clave de firma', () => {
  it('retira la clave y escribe su fila de auditoría', async () => {
    const kid = 'audit-retire-key-1';
    await addKey(kid);

    const result = await app.query<{ retired: boolean }>(RETIRE_KEY_SQL, [kid, OPERATOR_ACTOR]);
    expect(result.rows[0]?.retired).toBe(true);

    const rows = await auditRowsFor(kid);
    expect(rows.map((row) => row.event_type)).toEqual([
      'oidc_signing_key.added',
      'oidc_signing_key.retired',
    ]);
    expect(rows[1]).toMatchObject({ details: { alg: 'ES256' }, actor: OPERATOR_ACTOR });
  });

  it('retirar una clave inexistente o ya retirada no escribe auditoría', async () => {
    const kid = 'audit-retire-key-twice';
    await addKey(kid);
    await app.query(RETIRE_KEY_SQL, [kid, OPERATOR_ACTOR]);
    const rowsBefore = await auditRowsFor(kid);

    const again = await app.query<{ retired: boolean }>(RETIRE_KEY_SQL, [kid, OPERATOR_ACTOR]);
    const missing = await app.query<{ retired: boolean }>(RETIRE_KEY_SQL, [
      'audit-retire-key-missing',
      OPERATOR_ACTOR,
    ]);

    expect(again.rows[0]?.retired).toBe(false);
    expect(missing.rows[0]?.retired).toBe(false);
    expect(await auditRowsFor(kid)).toEqual(rowsBefore);
    expect(await auditRowsFor('audit-retire-key-missing')).toEqual([]);
  });

  it('sin actor no se retira la clave: sigue activa y sin fila de retiro', async () => {
    const kid = 'audit-retire-key-no-actor';
    await addKey(kid);

    expect(await sqlState(app, RETIRE_KEY_SQL, [kid, null])).toBe(NOT_NULL_VIOLATION);

    const active = await app.query('select kid from auth.list_oidc_signing_keys() where kid = $1', [
      kid,
    ]);
    expect(active.rows).toHaveLength(1);
    expect((await auditRowsFor(kid)).map((row) => row.event_type)).toEqual([
      'oidc_signing_key.added',
    ]);
  });
});

describe('platform_audit_events (tabla de plataforma)', () => {
  it('la aplicación no la lee ni la escribe directamente', async () => {
    expect(await sqlState(app, 'select id from platform_audit_events')).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        app,
        `insert into platform_audit_events (event_type, subject, details, actor)
         values ('oidc_signing_key.added', 'direct-insert', '{}'::jsonb, 'app')`,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(await sqlState(app, 'update platform_audit_events set actor = actor')).toBe(
      NO_PRIVILEGE,
    );
    expect(await sqlState(app, 'delete from platform_audit_events')).toBe(NO_PRIVILEGE);
  });

  it('es de solo agregar: ni el administrador puede modificar, borrar ni truncar', async () => {
    await addKey('audit-append-only');

    expect(await sqlState(admin, `update platform_audit_events set actor = 'tampered'`)).toBe(
      APPEND_ONLY_VIOLATION,
    );
    expect(await sqlState(admin, 'delete from platform_audit_events')).toBe(APPEND_ONLY_VIOLATION);
    expect(await sqlState(admin, 'truncate platform_audit_events')).toBe(APPEND_ONLY_VIOLATION);

    const rows = await auditRowsFor('audit-append-only');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(OPERATOR_ACTOR);
  });

  it('solo admite los tipos de evento declarados', async () => {
    expect(
      await sqlState(
        admin,
        `insert into platform_audit_events (event_type, subject, details, actor)
         values ('cualquier.cosa', 'x', '{}'::jsonb, 'admin')`,
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('tiene el aislamiento por filas activo y forzado', async () => {
    const { rows } = await admin.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relrowsecurity, relforcerowsecurity from pg_class where relname = 'platform_audit_events'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe('funciones de claves de firma tras la migración 0047', () => {
  it('no queda ninguna versión que rote o retire sin auditar', async () => {
    const { rows } = await admin.query<{ proname: string; args: string }>(`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'auth'
       where p.proname in ('add_oidc_signing_key', 'retire_oidc_signing_key')
       order by p.proname`);
    expect(rows).toEqual([
      {
        proname: 'add_oidc_signing_key',
        args: 'p_kid text, p_alg text, p_public_jwk jsonb, p_private_jwk_ciphertext bytea, p_actor text',
      },
      { proname: 'retire_oidc_signing_key', args: 'p_kid text, p_actor text' },
    ]);
  });

  it('son SECURITY DEFINER con search_path fijo y de un rol sin BYPASSRLS', async () => {
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
       where p.proname in ('add_oidc_signing_key', 'retire_oidc_signing_key')`);
    expect(rows).toHaveLength(2);
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
