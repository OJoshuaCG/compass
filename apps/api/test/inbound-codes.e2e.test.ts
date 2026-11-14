import type {
  InboundCodesResponse,
  InboundHistoryResponse,
  ProblemDetails,
  Role,
} from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  DataKeyResolver,
  DekCache,
  NodeCryptoPrimitives,
  PgDataKeyRepository,
  SecretCipher,
} from '../src/modules/crypto/index.js';
import { inboundItemContext } from '../src/modules/inbound-codes/index.js';
import { asOrganizationId } from '../src/shared/kernel/index.js';
import { contextFor } from './support/context.js';
import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// IC-5a por HTTP real: lectura de códigos entrantes (USE) e historial (VIEW) por vista compartida.
// Los elementos se siembran por SQL con el valor cifrado por la misma gestión de claves que usa la API,
// porque el sondeo IMAP no corre dentro de estas pruebas.

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const MILLISECONDS_PER_MINUTE = 60_000;
const LIVE_CODE = '482913';
const SENSITIVE_CODE = '731560';
const EXPIRED_CODE = '905274';
const RESET_CODE = '246810';

let env: E2eEnvironment;
let organizationId: string;
let rootUserId: string;
let root: EnrolledSession;
let useReader: EnrolledSession;
let stranger: EnrolledSession;
let cipher: SecretCipher;
let viewId: string;
let liveItemId: string;

const userId = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

const insertOne = async (sql: string, values: readonly unknown[]): Promise<string> => {
  const result = await env.db.admin.query<{ id: string }>(sql, [...values]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  return id;
};

const inOrganization = <T>(fn: () => Promise<T>): Promise<T> =>
  env.container.requestContext.run(contextFor(organizationId), () => env.container.uow.run(fn));

interface ItemSeed {
  readonly templateId: string;
  readonly sourceId: string;
  readonly kind: 'login_code' | 'reset_code';
  readonly visibility: 'visible_with_use' | 'sensitive';
  readonly value: string;
  readonly expiresInMinutes: number;
}

async function seedItem(seed: ItemSeed): Promise<string> {
  const itemId = env.container.ids.next();
  const sealed = await inOrganization(() =>
    cipher.encrypt(
      inboundItemContext(asOrganizationId(organizationId), itemId),
      new TextEncoder().encode(seed.value),
    ),
  );
  if (!sealed.ok) throw new Error(sealed.error.code);
  const now = env.clock.now().getTime();
  await env.db.admin.query(
    `insert into inbound_items
       (id, organization_id, source_id, template_id, kind, value_type, visibility, ciphertext, nonce,
        dek_version, expires_at, created_at)
     values ($1, $2, $3, $4, $5, 'code', $6, $7, $8, $9, $10, $11)`,
    [
      itemId,
      organizationId,
      seed.sourceId,
      seed.templateId,
      seed.kind,
      seed.visibility,
      Buffer.from(sealed.value.ciphertext),
      Buffer.from(sealed.value.nonce),
      sealed.value.dekVersion,
      new Date(now + seed.expiresInMinutes * MILLISECONDS_PER_MINUTE),
      new Date(now - MILLISECONDS_PER_MINUTE),
    ],
  );
  return itemId;
}

const grantViewShare = (granteeId: string, level: 'USE' | 'VIEW' | 'EDIT' | 'MANAGE') =>
  env.db.admin.query(
    `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
     values ($1, 'mail_view', $2, 'user', $3, $4, $5)`,
    [organizationId, viewId, granteeId, level, rootUserId],
  );

const auditCount = async (action: string, actorId: string): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ n: string }>(
        'select count(*) as n from audit_events where organization_id = $1 and action = $2 and actor_id = $3',
        [organizationId, action, actorId],
      )
    ).rows[0]?.n,
  );

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'inbound-codes',
    rootEmail: 'root@inbound-codes.test',
    rootName: 'Ada Lovelace',
  });
  organizationId = created.organizationId;
  rootUserId = created.rootUserId;

  const rootClient = new TestClient(env, '203.0.113.91');
  await rootClient.post('/auth/login', {
    email: 'root@inbound-codes.test',
    password: STRONG_PASSWORD,
  });
  root = await enroll(env, rootClient);

  const roles = (await root.client.get<{ data: Role[] }>('/roles')).body.data;
  const operatorRoleId = roles.find((role) => role.name === 'Operator')?.id ?? '';
  useReader = await inviteAndOnboard(env, root.client, {
    email: 'reader@inbound-codes.test',
    rank: 3,
    roleIds: [operatorRoleId],
  });
  stranger = await inviteAndOnboard(env, root.client, {
    email: 'stranger@inbound-codes.test',
    rank: 3,
    roleIds: [operatorRoleId],
  });

  const clock = env.clock;
  cipher = new SecretCipher({
    keys: new DataKeyResolver({
      repository: new PgDataKeyRepository(env.container.uow),
      kms: env.kms,
      cache: new DekCache({ clock }),
      clock,
      independently: (fn) => env.container.uow.run(fn),
    }),
    primitives: new NodeCryptoPrimitives(),
  });

  const sourceId = await insertOne(
    `insert into mail_sources (organization_id, channel, address, display_name, created_by, status)
     values ($1, 'mail', 'codes@inbound-codes.example', 'Buzón', $2, 'active') returning id`,
    [organizationId, rootUserId],
  );
  viewId = await insertOne(
    `insert into mail_views (organization_id, source_id, name, created_by) values ($1, $2, 'Vista', $3) returning id`,
    [organizationId, sourceId, rootUserId],
  );
  const template = (kind: 'login_code' | 'reset_code') =>
    insertOne(
      `insert into inbound_templates (organization_id, name, kind, definition, created_by)
       values ($1, $2, $3, '{}'::jsonb, $4) returning id`,
      [organizationId, `Plantilla ${kind}`, kind, rootUserId],
    );
  const loginTemplateId = await template('login_code');
  const resetTemplateId = await template('reset_code');
  for (const templateId of [loginTemplateId, resetTemplateId]) {
    await env.db.admin.query(
      'insert into mail_view_templates (organization_id, view_id, template_id) values ($1, $2, $3)',
      [organizationId, viewId, templateId],
    );
  }

  liveItemId = await seedItem({
    templateId: loginTemplateId,
    sourceId,
    kind: 'login_code',
    visibility: 'visible_with_use',
    value: LIVE_CODE,
    expiresInMinutes: 10,
  });
  await seedItem({
    templateId: loginTemplateId,
    sourceId,
    kind: 'login_code',
    visibility: 'sensitive',
    value: SENSITIVE_CODE,
    expiresInMinutes: 10,
  });
  await seedItem({
    templateId: loginTemplateId,
    sourceId,
    kind: 'login_code',
    visibility: 'visible_with_use',
    value: EXPIRED_CODE,
    expiresInMinutes: -5,
  });
  await seedItem({
    templateId: resetTemplateId,
    sourceId,
    kind: 'reset_code',
    visibility: 'sensitive',
    value: RESET_CODE,
    expiresInMinutes: 10,
  });

  // Historial: una recepción aceptada y una en cuarentena; solo la primera debe verse.
  await env.db.admin.query(
    `insert into inbound_receipts
       (organization_id, source_id, message_fingerprint, outcome, reason, template_id, template_kind, received_at)
     values ($1, $2, 'fp-accepted', 'accepted', null, $3, 'login_code', $4),
            ($1, $2, 'fp-quarantined', 'quarantined', 'DKIM_FAILED', null, null, $4)`,
    [organizationId, sourceId, loginTemplateId, env.clock.now()],
  );

  await grantViewShare(await userId('reader@inbound-codes.test'), 'USE');
  await grantViewShare(rootUserId, 'MANAGE');
});

afterAll(async () => {
  await env.close();
});

describe('GET /inbound/views/:viewId/codes (HTTP)', () => {
  it('delivers only the live, visible login code to someone with USE, uncacheable', async () => {
    const response = await useReader.client.get<InboundCodesResponse>(
      `/inbound/views/${viewId}/codes`,
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.map((entry) => entry.code)).toEqual([LIVE_CODE]);
    expect(response.body.data[0]?.itemId).toBe(liveItemId);
    const body = JSON.stringify(response.body);
    for (const hidden of [SENSITIVE_CODE, EXPIRED_CODE, RESET_CODE]) {
      expect(body).not.toContain(hidden);
    }
  });

  it('audits one read per person and item, even when the same code is read again', async () => {
    const reader = await userId('reader@inbound-codes.test');
    const before = await auditCount('inbound.code_read', reader);

    await useReader.client.get(`/inbound/views/${viewId}/codes`);
    await useReader.client.get(`/inbound/views/${viewId}/codes`);

    expect(await auditCount('inbound.code_read', reader)).toBe(Math.max(before, 1));
    const audited = await env.db.admin.query<{ metadata: unknown }>(
      "select metadata from audit_events where organization_id = $1 and action = 'inbound.code_read'",
      [organizationId],
    );
    expect(JSON.stringify(audited.rows)).not.toContain(LIVE_CODE);
  });

  it('answers NOT_FOUND to someone with no share and audits the denial', async () => {
    const strangerId = await userId('stranger@inbound-codes.test');
    const before = await auditCount('authz.denied', strangerId);

    const response = await stranger.client.get<ProblemDetails>(`/inbound/views/${viewId}/codes`);

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(JSON.stringify(response.body)).not.toContain(LIVE_CODE);
    expect(await auditCount('authz.denied', strangerId)).toBeGreaterThan(before);
  });
});

describe('GET /inbound/views/:viewId/history (HTTP)', () => {
  it('refuses the history to someone with only USE', async () => {
    const response = await useReader.client.get<ProblemDetails>(
      `/inbound/views/${viewId}/history?limit=10`,
    );

    expect(response.status).toBe(HTTP_FORBIDDEN);
  });

  it('answers NOT_FOUND to someone with no share', async () => {
    const response = await stranger.client.get<ProblemDetails>(
      `/inbound/views/${viewId}/history?limit=10`,
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
  });

  it('lists only accepted receipts for someone with enough level, never quarantined ones', async () => {
    const response = await root.client.get<InboundHistoryResponse>(
      `/inbound/views/${viewId}/history?limit=10`,
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]?.templateKind).toBe('login_code');
    expect(JSON.stringify(response.body)).not.toContain('DKIM_FAILED');
  });
});
