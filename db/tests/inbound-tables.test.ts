import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Client } from 'pg';
import { connect, createMigratedDatabase, inOrg, seedTenant, sqlState } from './helpers.js';
import type { Tenant } from './helpers.js';

const CIPHERTEXT = '\\x00112233445566778899aabbccddeeff';
const NONCE = '\\x000000000000000000000000';
const FINGERPRINT_ONE = 'fingerprint-0001';

let admin: Client;
let app: Client;
let a: Tenant;
let b: Tenant;

interface InboundFixture {
  sourceId: string;
  templateId: string;
  resetCodeTemplateId: string;
  resetLinkTemplateId: string;
  viewId: string;
}

async function insertReturningId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await app.query<{ id: string }>(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`no row returned for: ${sql}`);
  return row.id;
}

/** Fuente, plantilla y vista de una organización, creadas por iam_app bajo aislamiento por filas. */
async function createFixture(tenant: Tenant, tag: string): Promise<InboundFixture> {
  return inOrg(app, tenant.orgId, async () => {
    const sourceId = await insertReturningId(
      "insert into mail_sources (organization_id, channel, address, display_name, created_by) values ($1, 'mail', $2, 'Buzón', $3) returning id",
      [tenant.orgId, `codes-${tag}@inbound.example.test`, tenant.rootId],
    );
    const templateId = await insertReturningId(
      `insert into inbound_templates (organization_id, name, kind, definition, created_by)
       values ($1, 'Login', 'login_code', '{}'::jsonb, $2) returning id`,
      [tenant.orgId, tenant.rootId],
    );
    const resetCodeTemplateId = await insertReturningId(
      `insert into inbound_templates (organization_id, name, kind, definition, created_by)
       values ($1, 'Reset code', 'reset_code', '{}'::jsonb, $2) returning id`,
      [tenant.orgId, tenant.rootId],
    );
    const resetLinkTemplateId = await insertReturningId(
      `insert into inbound_templates (organization_id, name, kind, definition, created_by)
       values ($1, 'Reset link', 'reset_link', '{}'::jsonb, $2) returning id`,
      [tenant.orgId, tenant.rootId],
    );
    const viewId = await insertReturningId(
      "insert into mail_views (organization_id, source_id, name, created_by) values ($1, $2, 'Vista', $3) returning id",
      [tenant.orgId, sourceId, tenant.rootId],
    );
    await app.query(
      'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
      [tenant.orgId, viewId, templateId],
    );
    return { sourceId, templateId, resetCodeTemplateId, resetLinkTemplateId, viewId };
  });
}

let fixtureA: InboundFixture;
let fixtureB: InboundFixture;

beforeAll(async () => {
  const db = await createMigratedDatabase(inject('adminUrl'));
  a = await seedTenant(db.appUrl, db.adminUrl, 'a');
  b = await seedTenant(db.appUrl, db.adminUrl, 'b');
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
  fixtureA = await createFixture(a, 'a');
  fixtureB = await createFixture(b, 'b');
});

afterAll(async () => {
  await admin.end();
  await app.end();
});

const SHARE_INSERT =
  "insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by) values ($1, $2, $3, 'user', $4, 'USE', $5)";

// SENSIBLE (revisión humana): aislamiento entre organizaciones de las tablas nuevas.
describe('inbound tables: tenant isolation', () => {
  it('an organization never sees sources, templates, views, items or receipts of another', async () => {
    await inOrg(app, a.orgId, async () => {
      const itemId = await insertReturningId(
        `insert into inbound_items (organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce, dek_version, expires_at)
         values ($1, $2, $3, 'login_code', 'code', 'visible_with_use', $4, $5, 1, now() + interval '10 minutes') returning id`,
        [a.orgId, fixtureA.sourceId, fixtureA.templateId, CIPHERTEXT, NONCE],
      );
      await app.query(
        `insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, template_kind, item_id, received_at)
         values ($1, $2, 'fingerprint-isolation', 'accepted', 'login_code', $3, now())`,
        [a.orgId, fixtureA.sourceId, itemId],
      );
    });

    for (const table of [
      'mail_sources',
      'inbound_templates',
      'mail_views',
      'mail_view_templates',
      'inbound_items',
      'inbound_receipts',
    ]) {
      const seenByB = await inOrg(app, b.orgId, () =>
        app.query<{ n: string }>(
          `select count(*)::text as n from ${table} where organization_id = $1`,
          [a.orgId],
        ),
      );
      expect(seenByB.rows[0]?.n, `${table}: rows of A visible to B`).toBe('0');
    }
  });

  it('rejects a source linked to an account of another organization', async () => {
    const state = await sqlState(
      app,
      "insert into mail_sources (organization_id, channel, address, display_name, account_id, created_by) values ($1, 'mail', 'cross-account@inbound.example.test', 'x', $2, $3)",
      [a.orgId, b.accountId, a.rootId],
      a.orgId,
    );
    expect(state).toBe('23503');
  });

  it('rejects a view over a source of another organization and a template of another organization', async () => {
    const viewOverForeignSource = await sqlState(
      app,
      "insert into mail_views (organization_id, source_id, name, created_by) values ($1, $2, 'Robada', $3)",
      [a.orgId, fixtureB.sourceId, a.rootId],
      a.orgId,
    );
    expect(viewOverForeignSource).toBe('23503');

    const foreignTemplateInView = await sqlState(
      app,
      'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
      [a.orgId, fixtureA.viewId, fixtureB.templateId],
      a.orgId,
    );
    expect(foreignTemplateInView).toBe('23503');
  });

  it('keeps an address unique across the whole database and in lower case', async () => {
    const duplicatedInOtherOrganization = await sqlState(
      app,
      "insert into mail_sources (organization_id, channel, address, display_name, created_by) values ($1, 'mail', 'codes-a@inbound.example.test', 'x', $2)",
      [b.orgId, b.rootId],
      b.orgId,
    );
    expect(duplicatedInOtherOrganization).toBe('23505');

    const upperCase = await sqlState(
      app,
      "insert into mail_sources (organization_id, channel, address, display_name, created_by) values ($1, 'mail', 'Mixed@Inbound.Example.Test', 'x', $2)",
      [a.orgId, a.rootId],
      a.orgId,
    );
    expect(upperCase).toBe('23514');
  });
});

// SENSIBLE (revisión humana): `mail_source` y `mail_view` pasan a ser recursos compartibles.
describe('shares: mail_source and mail_view resources', () => {
  it('accepts a share over an own source and an own view', async () => {
    for (const [type, id] of [
      ['mail_source', fixtureA.sourceId],
      ['mail_view', fixtureA.viewId],
    ] as const) {
      const state = await sqlState(
        app,
        SHARE_INSERT,
        [a.orgId, type, id, a.operatorId, a.rootId],
        a.orgId,
      );
      expect(state, type).toBe('none');
    }
  });

  it('rejects a share over a resource that does not exist', async () => {
    for (const type of ['mail_source', 'mail_view']) {
      const state = await sqlState(
        app,
        SHARE_INSERT,
        [a.orgId, type, '019b0000-0000-7000-8000-000000000000', a.adminId, a.rootId],
        a.orgId,
      );
      expect(state, type).toBe('23503');
    }
  });

  it('rejects a share over a resource of another organization', async () => {
    const foreignSource = await sqlState(
      app,
      SHARE_INSERT,
      [a.orgId, 'mail_source', fixtureB.sourceId, a.adminId, a.rootId],
      a.orgId,
    );
    expect(foreignSource).toBe('23503');
    const foreignView = await sqlState(
      app,
      SHARE_INSERT,
      [a.orgId, 'mail_view', fixtureB.viewId, a.adminId, a.rootId],
      a.orgId,
    );
    expect(foreignView).toBe('23503');
  });

  it('still rejects an unknown resource type and still validates accounts', async () => {
    const unknownType = await sqlState(
      app,
      SHARE_INSERT,
      [a.orgId, 'mail_box', fixtureA.sourceId, a.adminId, a.rootId],
      a.orgId,
    );
    expect(unknownType).toBe('23514');
    const foreignAccount = await sqlState(
      app,
      SHARE_INSERT,
      [a.orgId, 'account', b.accountId, a.adminId, a.rootId],
      a.orgId,
    );
    expect(foreignAccount).toBe('23503');
  });
});

// SENSIBLE (revisión humana): segunda barrera de la clasificación que falla cerrada.
describe('inbound_items: fail-closed visibility in the database', () => {
  const ITEM_INSERT = `insert into inbound_items (organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce, dek_version, expires_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, 1, now() + interval '10 minutes')`;

  // Perezoso: el fixture se crea en beforeAll, después de definir las pruebas.
  function templateFor(kind: string): string {
    const templateByKind: Record<string, string> = {
      login_code: fixtureA.templateId,
      reset_code: fixtureA.resetCodeTemplateId,
      reset_link: fixtureA.resetLinkTemplateId,
    };
    return templateByKind[kind] ?? '';
  }

  async function insertItem(
    kind: string,
    valueType: string,
    visibility: string,
    templateId: string = templateFor(kind),
  ): Promise<string> {
    return sqlState(
      app,
      ITEM_INSERT,
      [a.orgId, fixtureA.sourceId, templateId, kind, valueType, visibility, CIPHERTEXT, NONCE],
      a.orgId,
    );
  }

  it('rejects a visible item that is not an explicit login code, and a visible link', async () => {
    expect(await insertItem('reset_code', 'code', 'visible_with_use')).toBe('23514');
    expect(await insertItem('reset_link', 'link', 'visible_with_use')).toBe('23514');
    expect(await insertItem('login_code', 'link', 'visible_with_use')).toBe('23514');
  });

  it('rejects an item whose kind differs from the kind of its template', async () => {
    // El tipo del elemento viaja dentro de la clave foránea de la plantilla: no se declara a gusto.
    expect(
      await insertItem('login_code', 'code', 'visible_with_use', fixtureA.resetCodeTemplateId),
    ).toBe('23503');
    expect(await insertItem('reset_code', 'code', 'sensitive', fixtureA.templateId)).toBe('23503');
  });

  it('ties links to reset_link templates in both directions', async () => {
    expect(await insertItem('reset_link', 'code', 'sensitive')).toBe('23514');
    expect(await insertItem('reset_code', 'link', 'sensitive')).toBe('23514');
  });

  it('accepts a visible login code and any sensitive item', async () => {
    expect(await insertItem('login_code', 'code', 'visible_with_use')).toBe('none');
    expect(await insertItem('reset_link', 'link', 'sensitive')).toBe('none');
  });

  it('never lets the application modify an item (the ciphertext is immutable)', async () => {
    const state = await sqlState(
      app,
      "update inbound_items set visibility = 'visible_with_use' where organization_id = $1",
      [a.orgId],
      a.orgId,
    );
    expect(state).toBe('42501');
  });
});

describe('inbound_receipts: deduplication and consistency', () => {
  const RECEIPT_INSERT = `insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, reason, received_at)
    values ($1, $2, $3, $4, $5, now())`;

  it('stores a message once per source: the same fingerprint twice is a conflict', async () => {
    const first = await sqlState(
      app,
      RECEIPT_INSERT,
      [a.orgId, fixtureA.sourceId, FINGERPRINT_ONE, 'accepted', null],
      a.orgId,
    );
    const second = await sqlState(
      app,
      RECEIPT_INSERT,
      [a.orgId, fixtureA.sourceId, FINGERPRINT_ONE, 'accepted', null],
      a.orgId,
    );
    expect(first).toBe('none');
    expect(second).toBe('23505');
  });

  it('requires a reason exactly when the message was quarantined', async () => {
    const quarantinedWithoutReason = await sqlState(
      app,
      RECEIPT_INSERT,
      [a.orgId, fixtureA.sourceId, 'fingerprint-0002', 'quarantined', null],
      a.orgId,
    );
    const acceptedWithReason = await sqlState(
      app,
      RECEIPT_INSERT,
      [a.orgId, fixtureA.sourceId, 'fingerprint-0003', 'accepted', 'NO_MATCHING_TEMPLATE'],
      a.orgId,
    );
    const quarantinedWithReason = await sqlState(
      app,
      RECEIPT_INSERT,
      [a.orgId, fixtureA.sourceId, 'fingerprint-0004', 'quarantined', 'NO_MATCHING_TEMPLATE'],
      a.orgId,
    );
    expect(quarantinedWithoutReason).toBe('23514');
    expect(acceptedWithReason).toBe('23514');
    expect(quarantinedWithReason).toBe('none');
  });

  it('keeps the receipt when its item is purged', async () => {
    await inOrg(app, a.orgId, async () => {
      const itemId = await insertReturningId(
        `insert into inbound_items (organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce, dek_version, expires_at)
         values ($1, $2, $3, 'login_code', 'code', 'visible_with_use', $4, $5, 1, now() - interval '1 minute') returning id`,
        [a.orgId, fixtureA.sourceId, fixtureA.templateId, CIPHERTEXT, NONCE],
      );
      await app.query(
        `insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, item_id, received_at)
         values ($1, $2, 'fingerprint-purge', 'accepted', $3, now())`,
        [a.orgId, fixtureA.sourceId, itemId],
      );
      await app.query('delete from inbound_items where id = $1', [itemId]);
      const receipt = await app.query<{ item_id: string | null }>(
        "select item_id from inbound_receipts where message_fingerprint = 'fingerprint-purge'",
      );
      expect(receipt.rowCount).toBe(1);
      expect(receipt.rows[0]?.item_id).toBeNull();
    });
  });

  it('never lets the application update a receipt', async () => {
    const state = await sqlState(
      app,
      "update inbound_receipts set outcome = 'accepted' where organization_id = $1",
      [a.orgId],
      a.orgId,
    );
    expect(state).toBe('42501');
  });
});

// SENSIBLE (revisión humana): permisos mínimos de iam_app y escrituras entre organizaciones.
describe('inbound tables: least privilege and cross-organization writes', () => {
  it('rejects inserts that name another organization (with check) in every new table', async () => {
    const statements: [string, unknown[]][] = [
      [
        "insert into mail_sources (organization_id, channel, address, display_name, created_by) values ($1, 'mail', 'smuggled@inbound.example.test', 'x', $2)",
        [b.orgId, b.rootId],
      ],
      [
        "insert into inbound_templates (organization_id, name, kind, definition, created_by) values ($1, 'x', 'login_code', '{}'::jsonb, $2)",
        [b.orgId, b.rootId],
      ],
      [
        "insert into mail_views (organization_id, source_id, name, created_by) values ($1, $2, 'x', $3)",
        [b.orgId, fixtureB.sourceId, b.rootId],
      ],
      [
        'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
        [b.orgId, fixtureB.viewId, fixtureB.resetCodeTemplateId],
      ],
      [
        `insert into inbound_items (organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce, dek_version, expires_at)
         values ($1, $2, $3, 'login_code', 'code', 'visible_with_use', '\\x00112233445566778899aabbccddeeff', '\\x000000000000000000000000', 1, now() + interval '10 minutes')`,
        [b.orgId, fixtureB.sourceId, fixtureB.templateId],
      ],
      [
        "insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, received_at) values ($1, $2, 'fingerprint-smuggled', 'accepted', now())",
        [b.orgId, fixtureB.sourceId],
      ],
    ];
    for (const [sql, params] of statements) {
      expect(await sqlState(app, sql, params, a.orgId), sql).toBe('42501');
    }
  });

  it('does not let the application rewrite identity columns (address, kind, source)', async () => {
    const changeAddress = await sqlState(
      app,
      "update mail_sources set address = 'other@inbound.example.test' where id = $1",
      [fixtureA.sourceId],
      a.orgId,
    );
    const changeKind = await sqlState(
      app,
      "update inbound_templates set kind = 'login_code' where id = $1",
      [fixtureA.resetLinkTemplateId],
      a.orgId,
    );
    const moveView = await sqlState(
      app,
      'update mail_views set source_id = $2 where id = $1',
      [fixtureA.viewId, fixtureA.sourceId],
      a.orgId,
    );
    expect(changeAddress).toBe('42501');
    expect(changeKind).toBe('42501');
    expect(moveView).toBe('42501');
  });

  it('lets the application change the mutable columns', async () => {
    const rename = await sqlState(
      app,
      "update mail_sources set display_name = 'Renombrado', version = version + 1 where id = $1",
      [fixtureA.sourceId],
      a.orgId,
    );
    expect(rename).toBe('none');
  });

  it('only allows deleting view-template links, items and receipts', async () => {
    for (const table of ['mail_sources', 'inbound_templates', 'mail_views']) {
      const state = await sqlState(
        app,
        `delete from ${table} where organization_id = $1`,
        [a.orgId],
        a.orgId,
      );
      expect(state, table).toBe('42501');
    }
    const unlink = await sqlState(
      app,
      'delete from mail_view_templates where organization_id = $1 and view_id = $2',
      [a.orgId, fixtureA.viewId],
      a.orgId,
    );
    expect(unlink).toBe('none');
  });

  it('rejects a quarantined receipt that points to an item', async () => {
    const state = await sqlState(
      app,
      `insert into inbound_receipts (organization_id, source_id, message_fingerprint, outcome, reason, item_id, received_at)
       values ($1, $2, 'fingerprint-quarantine-item', 'quarantined', 'NO_MATCHING_TEMPLATE', uuid_generate_v7(), now())`,
      [a.orgId, fixtureA.sourceId],
      a.orgId,
    );
    expect(state).toBe('23514');
  });

  it('revalidates the resource of a share when it is changed afterwards', async () => {
    await inOrg(app, a.orgId, async () => {
      await app.query(SHARE_INSERT.replace("'user', $4", "'group', $4"), [
        a.orgId,
        'mail_source',
        fixtureA.sourceId,
        a.groupId,
        a.rootId,
      ]);
    });
    const state = await sqlState(
      app,
      "update shares set resource_id = '019b0000-0000-7000-8000-000000000000' where organization_id = $1 and resource_id = $2",
      [a.orgId, fixtureA.sourceId],
      a.orgId,
    );
    expect(state).toBe('23503');
  });
});
