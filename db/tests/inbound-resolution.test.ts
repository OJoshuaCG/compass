import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

const CIPHERTEXT = '\\x00112233445566778899aabbccddeeff';
const NONCE = '\\x000000000000000000000000';
const CONCURRENCY_WAIT_MILLISECONDS = 400;

let admin: Client;
let app: Client;
let secondApp: Client;
let worker: Client;
let a: Tenant;
let b: Tenant;
let sourceAId: string;
let templateAId: string;

const INSERT_SOURCE_SQL =
  "insert into mail_sources (organization_id, channel, address, display_name, account_id, created_by) values ($1, $2, $3, 'Buzón', $4, $5) returning id";

async function insertSource(
  tenant: Tenant,
  address: string,
  options: { channel?: string; accountId?: string | null } = {},
): Promise<string> {
  const { rows } = await inOrg(app, tenant.orgId, () =>
    app.query<{ id: string }>(INSERT_SOURCE_SQL, [
      tenant.orgId,
      options.channel ?? 'mail',
      address,
      options.accountId ?? null,
      tenant.rootId,
    ]),
  );
  const row = rows[0];
  if (!row) throw new Error('source was not created');
  return row.id;
}

async function setAlias(tenant: Tenant, accountId: string, alias: string | null): Promise<string> {
  return sqlState(
    app,
    'update accounts set recovery_email_alias = $1 where id = $2',
    [alias, accountId],
    tenant.orgId,
  );
}

async function failureOf(
  operation: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await operation();
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    return { code: failure.code ?? 'unknown', message: failure.message ?? '' };
  }
  return { code: 'none', message: '' };
}

async function resolve(channel: string, address: string): Promise<Record<string, unknown>[]> {
  const { rows } = await app.query<Record<string, unknown>>(
    'select * from auth.resolve_inbound_address($1, $2)',
    [channel, address],
  );
  return rows;
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
  secondApp = await connect(db.appUrl);
  worker = await connect(db.workerUrl);
  sourceAId = await insertSource(a, 'codes-a@inbound.example.test');
  await insertSource(b, 'codes-b@inbound.example.test');
  const { rows } = await inOrg(app, a.orgId, () =>
    app.query<{ id: string }>(
      `insert into inbound_templates (organization_id, name, kind, definition, created_by)
       values ($1, 'Login', 'login_code', '{}'::jsonb, $2) returning id`,
      [a.orgId, a.rootId],
    ),
  );
  templateAId = rows[0]?.id ?? '';
});

afterAll(async () => {
  await admin.end();
  await app.end();
  await secondApp.end();
  await worker.end();
});

// SENSIBLE (revisión humana): resolución previa a la organización, entrada de un tercero.
describe('auth.resolve_inbound_address (no app.org_id set)', () => {
  it('returns exactly organization, source, channel and status for the exact address', async () => {
    const { rows, fields } = await app.query<Record<string, unknown>>(
      'select * from auth.resolve_inbound_address($1, $2)',
      ['mail', 'codes-a@inbound.example.test'],
    );
    expect(fields.map((field) => field.name)).toEqual([
      'organization_id',
      'source_id',
      'channel',
      'status',
    ]);
    expect(rows).toEqual([
      { organization_id: a.orgId, source_id: sourceAId, channel: 'mail', status: 'active' },
    ]);
  });

  it('resolves each address to its own organization and ignores letter case', async () => {
    const upper = await resolve('mail', 'CODES-B@Inbound.Example.Test');
    expect(upper).toHaveLength(1);
    expect(upper[0]?.['organization_id']).toBe(b.orgId);
  });

  it('cannot be used to list, pattern-match or probe by channel', async () => {
    const probes: [string, string][] = [
      ['mail', '%'],
      ['mail', '%@inbound.example.test'],
      ['mail', 'codes-a@inbound.example.test '],
      ['mail', ''],
      ['mail', "' or 1=1 --"],
      ['sms', 'codes-a@inbound.example.test'],
      ['%', 'codes-a@inbound.example.test'],
    ];
    for (const [channel, address] of probes) {
      expect(await resolve(channel, address), `${channel} ${address}`).toEqual([]);
    }
  });

  it('answers an archived address exactly like a nonexistent one, and reports a suspended one', async () => {
    const archivedAddress = 'archived@inbound.example.test';
    const suspendedAddress = 'suspended@inbound.example.test';
    const archivedId = await insertSource(a, archivedAddress);
    const suspendedId = await insertSource(a, suspendedAddress);
    await inOrg(app, a.orgId, async () => {
      await app.query(
        "update mail_sources set status = 'archived', archived_at = now() where id = $1",
        [archivedId],
      );
      await app.query("update mail_sources set status = 'suspended' where id = $1", [suspendedId]);
    });

    const archived = await resolve('mail', archivedAddress);
    const nonexistent = await resolve('mail', 'never-created@inbound.example.test');
    expect(archived).toEqual([]);
    expect(archived).toEqual(nonexistent);

    const suspended = await resolve('mail', suspendedAddress);
    expect(suspended).toHaveLength(1);
    expect(suspended[0]?.['status']).toBe('suspended');
  });

  it('is SECURITY DEFINER with a fixed search_path, owned by a non-bypass role, executable only by the app and the worker', async () => {
    const { rows } = await admin.query<{
      prosecdef: boolean;
      proconfig: string[] | null;
      owner: string;
      bypass: boolean;
      public_can_execute: boolean;
      app_can_execute: boolean;
      worker_can_execute: boolean;
    }>(`
      select p.prosecdef, p.proconfig, r.rolname as owner, r.rolbypassrls as bypass,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_can_execute,
             has_function_privilege('iam_app', p.oid, 'EXECUTE') as app_can_execute,
             has_function_privilege('iam_inbound_worker', p.oid, 'EXECUTE') as worker_can_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'auth'
      join pg_roles r on r.oid = p.proowner
      where p.proname = 'resolve_inbound_address'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      prosecdef: true,
      proconfig: ['search_path=pg_catalog'],
      owner: 'iam_auth_reader',
      bypass: false,
      public_can_execute: false,
      app_can_execute: true,
      worker_can_execute: true,
    });
  });

  it('gives the definer role only the mail_sources and accounts columns it needs', async () => {
    const { rows } = await admin.query<{
      display_name: boolean;
      created_by: boolean;
      name: boolean;
    }>(
      `select has_column_privilege('iam_auth_reader', 'public.mail_sources', 'display_name', 'SELECT') as display_name,
              has_column_privilege('iam_auth_reader', 'public.mail_sources', 'created_by', 'SELECT') as created_by,
              has_column_privilege('iam_auth_reader', 'public.accounts', 'display_name', 'SELECT') as name`,
    );
    expect(rows[0]).toEqual({ display_name: false, created_by: false, name: false });
  });

  it('cannot be replaced or altered by the app or the worker role', async () => {
    const replacement = `create or replace function auth.resolve_inbound_address(p_channel text, p_address text)
      returns table (organization_id uuid, source_id uuid, channel text, status text)
      language sql as $$ select null::uuid, null::uuid, null::text, null::text $$`;
    expect(await sqlState(app, replacement)).toBe('42501');
    expect(await sqlState(worker, replacement)).toBe('42501');
    expect(
      await sqlState(
        app,
        'alter function auth.resolve_inbound_address(text, text) security invoker',
      ),
    ).toBe('42501');
  });

  it('keeps the alias guard functions as definer functions with a fixed search_path, owned by the definer role and closed to everyone', async () => {
    const { rows } = await admin.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      owner: string;
      public_can_execute: boolean;
      app_can_execute: boolean;
      worker_can_execute: boolean;
    }>(`
      select p.proname, p.prosecdef, p.proconfig, r.rolname as owner,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_can_execute,
             has_function_privilege('iam_app', p.oid, 'EXECUTE') as app_can_execute,
             has_function_privilege('iam_inbound_worker', p.oid, 'EXECUTE') as worker_can_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'auth'
      join pg_roles r on r.oid = p.proowner
      where p.prorettype = 'trigger'::regtype
      order by p.proname`);
    expect(rows.map((row) => row.proname)).toEqual([
      'accounts_alias_guard',
      'mail_sources_alias_guard',
    ]);
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(true);
      expect(row.proconfig, row.proname).toEqual(['search_path=pg_catalog']);
      expect(row.owner, row.proname).toBe('iam_auth_reader');
      expect(row.public_can_execute, row.proname).toBe(false);
      expect(row.app_can_execute, row.proname).toBe(false);
      expect(row.worker_can_execute, row.proname).toBe(false);
    }
  });
});

// SENSIBLE (revisión humana): una dirección no puede ser a la vez alias de una cuenta ajena y fuente.
describe('inbound address vs accounts.recovery_email_alias', () => {
  it('rejects a source whose address is the alias of another account, without echoing the address', async () => {
    const address = 'alias-taken@inbound.example.test';
    expect(await setAlias(a, a.accountId, address)).toBe('none');
    let message = '';
    try {
      await inOrg(app, a.orgId, () =>
        app.query(INSERT_SOURCE_SQL, [a.orgId, 'mail', address, null, a.rootId]),
      );
    } catch (error) {
      const failure = error as { code?: string; message: string };
      expect(failure.code).toBe('23505');
      message = failure.message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(address);
    expect(await setAlias(a, a.accountId, null)).toBe('none');
  });

  it('raises the same error text from both guards so the conflict gives no second oracle', async () => {
    const address = 'same-text@inbound.example.test';
    expect(await setAlias(b, b.accountId, address)).toBe('none');
    const sourceSideFailure = await failureOf(() =>
      inOrg(app, a.orgId, () =>
        app.query(INSERT_SOURCE_SQL, [a.orgId, 'mail', address, null, a.rootId]),
      ),
    );
    expect(await setAlias(b, b.accountId, null)).toBe('none');
    await insertSource(a, address);
    const aliasSideFailure = await failureOf(() =>
      inOrg(app, b.orgId, () =>
        app.query('update accounts set recovery_email_alias = $1 where id = $2', [
          address,
          b.accountId,
        ]),
      ),
    );
    expect(sourceSideFailure.code).toBe('23505');
    expect(aliasSideFailure.code).toBe('23505');
    expect(sourceSideFailure.message).toBe(aliasSideFailure.message);
  });

  it('rejects the conflict across organizations in both directions', async () => {
    const aliasOfB = 'alias-of-b@inbound.example.test';
    expect(await setAlias(b, b.accountId, aliasOfB)).toBe('none');
    expect(
      await sqlState(app, INSERT_SOURCE_SQL, [a.orgId, 'mail', aliasOfB, null, a.rootId], a.orgId),
    ).toBe('23505');
    expect(await setAlias(b, b.accountId, null)).toBe('none');

    await insertSource(a, 'source-of-a@inbound.example.test');
    expect(await setAlias(b, b.accountId, 'source-of-a@inbound.example.test')).toBe('23505');
  });

  it('allows the same address when the source is linked to the account that owns the alias', async () => {
    const address = 'shared-with-account@inbound.example.test';
    expect(await setAlias(a, a.accountId, address)).toBe('none');
    const linkedId = await insertSource(a, address, { accountId: a.accountId });
    expect(linkedId).not.toBe('');
    expect(await resolve('mail', address)).toHaveLength(1);
  });

  it('rejects setting an alias equal to the address of a source linked to a different account or to none', async () => {
    expect(await setAlias(b, b.accountId, 'shared-with-account@inbound.example.test')).toBe(
      '23505',
    );
    expect(await setAlias(b, b.accountId, 'codes-a@inbound.example.test')).toBe('23505');
  });

  it('rejects linking a source to another account when its address is the alias of the first one', async () => {
    const address = 'relink@inbound.example.test';
    const { rows } = await inOrg(app, a.orgId, () =>
      app.query<{ id: string }>(
        `insert into accounts (organization_id, platform_id, display_name, created_by)
         values ($1, $2, 'Other account', $3) returning id`,
        [a.orgId, a.platformId, a.rootId],
      ),
    );
    const otherAccountId = rows[0]?.id ?? '';
    expect(await setAlias(a, otherAccountId, address)).toBe('none');
    const sourceId = await insertSource(a, address, { accountId: otherAccountId });
    expect(
      await sqlState(
        app,
        'update mail_sources set account_id = $1 where id = $2',
        [a.accountId, sourceId],
        a.orgId,
      ),
    ).toBe('23505');
  });

  it('does not apply the guard to SMS numbers', async () => {
    const number = '+5215555550100';
    expect(await setAlias(a, a.accountId, number)).toBe('none');
    await insertSource(a, number, { channel: 'sms' });
    expect(await resolve('sms', number)).toHaveLength(1);
  });

  it('serializes concurrent writes of the same address from two transactions', async () => {
    const address = 'race@inbound.example.test';
    await app.query('begin');
    await app.query("select set_config('app.org_id', $1, true)", [a.orgId]);
    await app.query(INSERT_SOURCE_SQL, [a.orgId, 'mail', address, null, a.rootId]);

    await secondApp.query('begin');
    await secondApp.query("select set_config('app.org_id', $1, true)", [a.orgId]);
    const competingAlias = failureOf(() =>
      secondApp.query('update accounts set recovery_email_alias = $1 where id = $2', [
        address,
        a.accountId,
      ]),
    );

    await new Promise((resolveWait) => setTimeout(resolveWait, CONCURRENCY_WAIT_MILLISECONDS));
    await app.query('commit');
    const competingState = (await competingAlias).code;
    await secondApp.query('rollback');

    expect(competingState).toBe('23505');
  });

  it('serializes the opposite order too: the alias is written first and the source waits', async () => {
    const address = 'race-reverse@inbound.example.test';
    await app.query('begin');
    await app.query("select set_config('app.org_id', $1, true)", [a.orgId]);
    await app.query('update accounts set recovery_email_alias = $1 where id = $2', [
      address,
      a.accountId,
    ]);

    await secondApp.query('begin');
    await secondApp.query("select set_config('app.org_id', $1, true)", [a.orgId]);
    const competingSource = failureOf(() =>
      secondApp.query(INSERT_SOURCE_SQL, [a.orgId, 'mail', address, null, a.rootId]),
    );

    await new Promise((resolveWait) => setTimeout(resolveWait, CONCURRENCY_WAIT_MILLISECONDS));
    await app.query('commit');
    const competingState = (await competingSource).code;
    await secondApp.query('rollback');

    expect(competingState).toBe('23505');
  });
});

// SENSIBLE (revisión humana): mínimo privilegio del proceso que procesa mensajes de terceros.
describe('iam_inbound_worker least privilege', () => {
  it('sees no rows and cannot write without an organization context', async () => {
    const { rows } = await worker.query<{ n: string }>(
      'select count(*)::text as n from mail_sources',
    );
    expect(rows[0]?.n).toBe('0');
    expect(
      await sqlState(
        worker,
        `insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, reason, received_at)
        values ($1, $2, 'worker-no-context', 'quarantined', 'DKIM_INVALID', now())`,
        [a.orgId, sourceAId],
      ),
    ).toBe('42501');
  });

  it('reads only the columns it needs inside an organization and never other organizations', async () => {
    const seen = await inOrg(worker, a.orgId, () =>
      worker.query<{ id: string; organization_id: string }>(
        'select id, organization_id from mail_sources',
      ),
    );
    expect(seen.rows.length).toBeGreaterThan(0);
    for (const row of seen.rows) {
      expect(row.organization_id).toBe(a.orgId);
    }
    expect(await sqlState(worker, 'select display_name from mail_sources', [], a.orgId)).toBe(
      '42501',
    );
    expect(await sqlState(worker, 'select * from mail_sources', [], a.orgId)).toBe('42501');
    for (const table of ['accounts', 'users', 'shares', 'credentials', 'audit_events']) {
      expect(await sqlState(worker, `select 1 from ${table}`, [], a.orgId), table).toBe('42501');
    }
  });

  it('inserts items and receipts for its own organization but never reads the ciphertext back', async () => {
    const itemId = await inOrg(worker, a.orgId, async () => {
      const inserted = await worker.query<{ id: string }>(
        `insert into inbound_items (organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce, dek_version, expires_at)
         values ($1, $2, $3, 'login_code', 'code', 'visible_with_use', $4, $5, 1, now() + interval '10 minutes') returning id`,
        [a.orgId, sourceAId, templateAId, CIPHERTEXT, NONCE],
      );
      const id = inserted.rows[0]?.id ?? '';
      await worker.query(
        `insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, template_kind, item_id, received_at)
         values ($1, $2, 'worker-accepted-0001', 'accepted', 'login_code', $3, now())`,
        [a.orgId, sourceAId, id],
      );
      return id;
    });
    expect(itemId).not.toBe('');
    expect(
      await sqlState(
        worker,
        'select ciphertext from inbound_items where id = $1',
        [itemId],
        a.orgId,
      ),
    ).toBe('42501');
    for (const column of ['nonce', 'dek_version', 'expires_at', 'template_id', 'visibility']) {
      expect(
        await sqlState(
          worker,
          `select ${column} from inbound_items where id = $1`,
          [itemId],
          a.orgId,
        ),
        column,
      ).toBe('42501');
    }
    for (const column of ['reason', 'signing_domain', 'item_id', 'received_at']) {
      expect(
        await sqlState(worker, `select ${column} from inbound_receipts`, [], a.orgId),
        column,
      ).toBe('42501');
    }
  });

  it('cannot write into another organization, update, delete, or touch configuration tables', async () => {
    const crossOrganization = await sqlState(
      worker,
      `insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, reason, received_at)
       values ($1, $2, 'worker-cross-org', 'quarantined', 'DKIM_INVALID', now())`,
      [b.orgId, sourceAId],
      a.orgId,
    );
    expect(crossOrganization).toBe('42501');

    expect(
      await sqlState(
        worker,
        'update inbound_items set expires_at = now() where organization_id = $1',
        [a.orgId],
        a.orgId,
      ),
    ).toBe('42501');
    expect(await sqlState(worker, 'delete from inbound_items', [], a.orgId)).toBe('42501');
    expect(await sqlState(worker, 'delete from inbound_receipts', [], a.orgId)).toBe('42501');
    expect(await sqlState(worker, "update mail_sources set status = 'active'", [], a.orgId)).toBe(
      '42501',
    );
    expect(
      await sqlState(
        worker,
        "insert into mail_sources (organization_id, channel, address, display_name, created_by) values ($1, 'mail', 'worker-made@inbound.example.test', 'x', $2)",
        [a.orgId, a.rootId],
        a.orgId,
      ),
    ).toBe('42501');
    expect(
      await sqlState(
        worker,
        "insert into inbound_templates (organization_id, name, kind, definition, created_by) values ($1, 'x', 'login_code', '{}'::jsonb, $2)",
        [a.orgId, a.rootId],
        a.orgId,
      ),
    ).toBe('42501');
  });

  it('can resolve an address but cannot use the other pre-authentication functions or become another role', async () => {
    const resolved = await worker.query('select 1 from auth.resolve_inbound_address($1, $2)', [
      'mail',
      'codes-a@inbound.example.test',
    ]);
    expect(resolved.rowCount).toBe(1);
    expect(
      await sqlState(worker, 'select * from auth.find_login_by_email($1)', [a.rootEmail]),
    ).toBe('42501');
    expect(await sqlState(worker, 'set role iam_auth_reader')).toBe('42501');
    expect(await sqlState(worker, 'set role iam_app')).toBe('42501');
  });

  it('is not a superuser, does not bypass row level security and owns nothing', async () => {
    const { rows } = await admin.query<{ bypass: boolean; super: boolean; owned: string }>(
      `select r.rolbypassrls as bypass, r.rolsuper as super,
              (select count(*)::text from pg_class c where c.relowner = r.oid) as owned
       from pg_roles r where r.rolname = 'iam_inbound_worker'`,
    );
    expect(rows[0]).toEqual({ bypass: false, super: false, owned: '0' });
  });
});
