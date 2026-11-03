import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

const CIPHERTEXT = '\\x00112233445566778899aabbccddeeff';
const NONCE = '\\x000000000000000000000000';
const WRAPPED_DEK = '\\x00112233445566778899aabbccddeeff';
const NO_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const NO_FAILURE = 'none';

let admin: Client;
let app: Client;
let worker: Client;
let a: Tenant;
let b: Tenant;
let sourceAId: string;
let sourceBId: string;

async function insertSource(
  tenant: Tenant,
  address: string,
  options: { channel?: string } = {},
): Promise<string> {
  const { rows } = await inOrg(app, tenant.orgId, () =>
    app.query<{ id: string }>(
      `insert into mail_sources (organization_id, channel, address, display_name, created_by)
       values ($1, $2, $3, 'Buzón', $4) returning id`,
      [tenant.orgId, options.channel ?? 'mail', address, tenant.rootId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error('source was not created');
  return row.id;
}

interface ConnectionOverrides {
  tlsMode?: string;
  port?: number;
  recipients?: string[];
  ciphertext?: string | null;
  nonce?: string | null;
  dekVersion?: number | null;
}

/** Inserta una conexión válida salvo por lo que se sobrescriba; devuelve el SQLSTATE o 'none'. */
async function insertConnection(
  tenant: Tenant,
  sourceId: string,
  overrides: ConnectionOverrides = {},
  client: Client = app,
): Promise<string> {
  const hasCiphertext = overrides.ciphertext === undefined ? true : overrides.ciphertext !== null;
  return sqlState(
    client,
    `insert into mail_source_connections
       (organization_id, source_id, host, port, username, tls_mode, authserv_id,
        accepted_recipients, password_ciphertext, password_nonce, dek_version, created_by)
     values ($1, $2, 'imap.example.test', $3, 'codes', $4, 'mx.example.test', $5, $6, $7, $8, $9)`,
    [
      tenant.orgId,
      sourceId,
      overrides.port ?? 993,
      overrides.tlsMode ?? 'tls',
      overrides.recipients ?? ['codes@example.test'],
      hasCiphertext ? (overrides.ciphertext ?? CIPHERTEXT) : null,
      hasCiphertext ? (overrides.nonce === undefined ? NONCE : overrides.nonce) : null,
      hasCiphertext ? (overrides.dekVersion ?? 1) : null,
      tenant.rootId,
    ],
    tenant.orgId,
  );
}

async function pollableSourceIds(): Promise<string[]> {
  const { rows } = await worker.query<{ source_id: string }>(
    'select source_id from auth.list_pollable_inbound_sources()',
  );
  return rows.map((row) => row.source_id);
}

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
  worker = await connect(db.workerUrl);
  sourceAId = await insertSource(a, 'codes-a@inbound.example.test');
  sourceBId = await insertSource(b, 'codes-b@inbound.example.test');
});

afterAll(async () => {
  await admin.end();
  await app.end();
  await worker.end();
});

describe('mail_source_connections: structure', () => {
  it('accepts a valid connection and rejects cleartext TLS mode', async () => {
    expect(await insertConnection(a, sourceAId)).toBe(NO_FAILURE);
    const other = await insertSource(a, 'plain@inbound.example.test');
    expect(await insertConnection(a, other, { tlsMode: 'plain' })).toBe(CHECK_VIOLATION);
  });

  it('rejects an out-of-range port and a second connection for the same source', async () => {
    const other = await insertSource(a, 'port@inbound.example.test');
    expect(await insertConnection(a, other, { port: 0 })).toBe(CHECK_VIOLATION);
    expect(await insertConnection(a, other, { port: 65536 })).toBe(CHECK_VIOLATION);
    expect(await insertConnection(a, sourceAId)).toBe('23505');
  });

  it('requires 1 to 10 exact lowercase accepted recipients', async () => {
    const other = await insertSource(a, 'recipients@inbound.example.test');
    expect(await insertConnection(a, other, { recipients: [] })).toBe(CHECK_VIOLATION);
    expect(await insertConnection(a, other, { recipients: ['Upper@example.test'] })).toBe(
      CHECK_VIOLATION,
    );
    const eleven = Array.from({ length: 11 }, (_, index) => `r${String(index)}@example.test`);
    expect(await insertConnection(a, other, { recipients: eleven })).toBe(CHECK_VIOLATION);
  });

  it('stores the password as a complete set or not at all', async () => {
    const other = await insertSource(a, 'password@inbound.example.test');
    expect(await insertConnection(a, other, { nonce: null })).toBe(CHECK_VIOLATION);
    expect(await insertConnection(a, other, { ciphertext: '\\x0011' })).toBe(CHECK_VIOLATION);
    expect(await insertConnection(a, other, { dekVersion: 7 })).toBe(FOREIGN_KEY_VIOLATION);
    expect(await insertConnection(a, other, { ciphertext: null })).toBe(NO_FAILURE);
  });
});

// SENSIBLE (revisión humana): aislamiento por organización y mínimo privilegio del worker.
describe('mail_source_connections: isolation and privileges', () => {
  it('does not show one organization the connection of another', async () => {
    expect(await insertConnection(b, sourceBId)).toBe(NO_FAILURE);
    const { rows } = await inOrg(app, a.orgId, () =>
      app.query('select source_id from mail_source_connections'),
    );
    expect(rows.map((row: { source_id: string }) => row.source_id)).not.toContain(sourceBId);
    // Con el contexto de A no se puede escribir una conexión de B.
    const state = await sqlState(
      app,
      `insert into mail_source_connections
         (organization_id, source_id, host, port, username, tls_mode, authserv_id, accepted_recipients, created_by)
       values ($1, $2, 'imap.example.test', 993, 'x', 'tls', 'mx', array['x@example.test'], $3)`,
      [b.orgId, sourceBId, b.rootId],
      a.orgId,
    );
    expect(state).not.toBe(NO_FAILURE);
  });

  it('lets the API change the server but not re-parent a connection or delete it', async () => {
    expect(
      await sqlState(
        app,
        "update mail_source_connections set host = 'imap2.example.test' where source_id = $1",
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
    expect(
      await sqlState(
        app,
        'update mail_source_connections set source_id = $2 where source_id = $1',
        [sourceAId, sourceBId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        app,
        'delete from mail_source_connections where source_id = $1',
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
  });

  it('lets the worker read the connection and its encrypted password but nothing else of it', async () => {
    const { rows } = await inOrg(worker, a.orgId, () =>
      worker.query<{ password_nonce: Buffer }>(
        'select host, password_ciphertext, password_nonce, secret_version from mail_source_connections where source_id = $1',
        [sourceAId],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(
      await sqlState(
        worker,
        'select created_by from mail_source_connections where source_id = $1',
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
  });

  it('never lets the worker write, change or delete a connection', async () => {
    expect(await insertConnection(a, sourceAId, {}, worker)).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        worker,
        "update mail_source_connections set host = 'evil.example.test' where source_id = $1",
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        worker,
        'delete from mail_source_connections where source_id = $1',
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
  });

  it('lets the worker read the wrapped key but never create or change data keys', async () => {
    expect(
      await sqlState(
        worker,
        'select version, wrapped_dek, kms_key_ref, status from data_keys',
        [],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
    expect(
      await sqlState(
        worker,
        `insert into data_keys (organization_id, version, wrapped_dek, kms_key_ref)
         values ($1, 2, $2, 'kms-test')`,
        [a.orgId, WRAPPED_DEK],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(await sqlState(worker, "update data_keys set status = 'retired'", [], a.orgId)).toBe(
      NO_PRIVILEGE,
    );
  });
});

describe('mail_source_poll_state', () => {
  it('lets the worker create and advance the cursor, but not move or delete the row', async () => {
    expect(
      await sqlState(
        worker,
        'insert into mail_source_poll_state (organization_id, source_id) values ($1, $2)',
        [a.orgId, sourceAId],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
    expect(
      await sqlState(
        worker,
        `update mail_source_poll_state
            set uid_validity = 4294967295, last_uid = 4294967290, consecutive_failures = 2,
                last_error_code = 'IMAP_CONNECT_FAILED', claimed_until = now()
          where source_id = $1`,
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
    expect(
      await sqlState(
        worker,
        'update mail_source_poll_state set source_id = $2 where source_id = $1',
        [sourceAId, sourceBId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        worker,
        'delete from mail_source_poll_state where source_id = $1',
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
  });

  it('keeps the cursor within 32 bits and the error code within the bounded alphabet', async () => {
    expect(
      await sqlState(
        worker,
        'update mail_source_poll_state set last_uid = 4294967296 where source_id = $1',
        [sourceAId],
        a.orgId,
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        worker,
        "update mail_source_poll_state set last_error_code = 'connection refused by 10.0.0.1' where source_id = $1",
        [sourceAId],
        a.orgId,
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('shows the API the state of its own organization only, read-only, and lets the purge delete it', async () => {
    expect(
      await sqlState(
        worker,
        'insert into mail_source_poll_state (organization_id, source_id) values ($1, $2)',
        [b.orgId, sourceBId],
        b.orgId,
      ),
    ).toBe(NO_FAILURE);
    const { rows } = await inOrg(app, a.orgId, () =>
      app.query('select source_id from mail_source_poll_state'),
    );
    expect(rows.map((row: { source_id: string }) => row.source_id)).toEqual([sourceAId]);
    expect(
      await sqlState(
        app,
        'update mail_source_poll_state set last_uid = 0 where source_id = $1',
        [sourceAId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        app,
        'insert into mail_source_poll_state (organization_id, source_id) values ($1, $2)',
        [a.orgId, sourceAId],
        a.orgId,
      ),
    ).toBe(NO_PRIVILEGE);
    expect(
      await sqlState(
        app,
        'delete from mail_source_poll_state where source_id = $1',
        [sourceBId],
        a.orgId,
      ),
    ).toBe(NO_FAILURE);
    const { rows: stillThere } = await inOrg(worker, b.orgId, () =>
      worker.query('select source_id from mail_source_poll_state'),
    );
    expect(stillThere).toHaveLength(1);
  });
});

// SENSIBLE (revisión humana): función que enumera entre organizaciones para un rol que no es la API.
describe('auth.list_pollable_inbound_sources', () => {
  it('is executable by the worker only and returns exactly organization and source', async () => {
    const { fields } = await worker.query('select * from auth.list_pollable_inbound_sources()');
    expect(fields.map((field) => field.name)).toEqual(['organization_id', 'source_id']);
    expect(await sqlState(app, 'select * from auth.list_pollable_inbound_sources()')).toBe(
      NO_PRIVILEGE,
    );
  });

  it('lists active mail sources with a password across organizations, new ones included', async () => {
    // Fuente A: con estado de sondeo y `next_attempt_at` vencido; fuente B: sin fila de estado.
    await admin.query(
      "update mail_source_poll_state set claimed_until = null, next_attempt_at = now() - interval '1 minute'",
    );
    const ids = await pollableSourceIds();
    expect(ids).toContain(sourceAId);
    expect(ids).toContain(sourceBId);
  });

  it('skips a source that is backing off, leased, suspended, archived, SMS or without password', async () => {
    const skipped = new Map<string, string>();

    async function addConnected(address: string, label: string): Promise<string> {
      const id = await insertSource(a, address);
      expect(await insertConnection(a, id)).toBe(NO_FAILURE);
      skipped.set(label, id);
      return id;
    }

    const backingOff = await addConnected('backoff@inbound.example.test', 'backoff');
    const leased = await addConnected('leased@inbound.example.test', 'leased');
    const suspended = await addConnected('suspended@inbound.example.test', 'suspended');
    const archived = await addConnected('archived@inbound.example.test', 'archived');
    await admin.query(
      `insert into mail_source_poll_state (organization_id, source_id, next_attempt_at, claimed_until)
       values ($1, $2, now() + interval '10 minutes', null),
              ($1, $3, now() - interval '1 minute', now() + interval '1 minute')`,
      [a.orgId, backingOff, leased],
    );
    await admin.query("update mail_sources set status = 'suspended' where id = $1", [suspended]);
    await admin.query(
      "update mail_sources set status = 'archived', archived_at = now() where id = $1",
      [archived],
    );
    const noPassword = await insertSource(a, 'nopassword@inbound.example.test');
    expect(await insertConnection(a, noPassword, { ciphertext: null })).toBe(NO_FAILURE);
    skipped.set('no password', noPassword);
    const smsSource = await insertSource(a, '+5215500000001', { channel: 'sms' });
    expect(await insertConnection(a, smsSource)).toBe(NO_FAILURE);
    skipped.set('sms', smsSource);
    const noConnection = await insertSource(a, 'noconnection@inbound.example.test');
    skipped.set('no connection', noConnection);

    const ids = await pollableSourceIds();
    for (const [label, id] of skipped) {
      expect(ids, label).not.toContain(id);
    }
  });

  it('is owned by the definer role with a fixed search_path and no PUBLIC execute', async () => {
    const { rows } = await admin.query<{ owner: string; config: string[]; definer: boolean }>(
      `select r.rolname as owner, p.proconfig as config, p.prosecdef as definer
         from pg_proc p
         join pg_roles r on r.oid = p.proowner
        where p.oid = 'auth.list_pollable_inbound_sources()'::regprocedure`,
    );
    expect(rows[0]?.owner).toBe('iam_auth_reader');
    expect(rows[0]?.definer).toBe(true);
    expect(rows[0]?.config).toEqual(['search_path=pg_catalog']);
    const { rows: acl } = await admin.query<{ allowed: boolean }>(
      `select has_function_privilege('public', 'auth.list_pollable_inbound_sources()', 'execute') as allowed`,
    );
    expect(acl[0]?.allowed).toBe(false);
  });
});

// SENSIBLE (revisión humana): el rol definidor no debe poder leer la contraseña cifrada ni el servidor.
describe('iam_auth_reader privileges on the new tables', () => {
  it('can see only the non-secret columns it needs', async () => {
    const { rows } = await admin.query<{ column_name: string; allowed: boolean }>(
      `select c.column_name,
              has_column_privilege('iam_auth_reader', 'public.mail_source_connections', c.column_name, 'select') as allowed
         from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'mail_source_connections'`,
    );
    const readable = rows
      .filter((row) => row.allowed)
      .map((row) => row.column_name)
      .sort();
    expect(readable).toEqual(['organization_id', 'password_nonce', 'source_id']);
  });
});
