/**
 * SENSIBLE (ruta protegida: acceso, auditoría y bóveda). Esta prueba la debe revisar una persona.
 *
 * Da de baja a una persona por la API real, contra PostgreSQL, y comprueba lo que la baja hace en la bóveda:
 * reasigna la cuenta que se queda sin responsable, retira sus comparticiones, exige rotar la credencial,
 * audita y encola el aviso (governance §2.4).
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

const SEVENTY_TWO_HOURS_IN_MILLISECONDS = 72 * 60 * 60 * 1000;
// El reloj de la prueba es manual y la baja es casi instantánea: una hora de margen sobra.
const DUE_DATE_TOLERANCE_IN_MILLISECONDS = 60 * 60 * 1000;

let env: E2eEnvironment;
let organizationId: string;
let rootUserId: string;
let admin: EnrolledSession;

const userIdOf = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

async function insertAccountManagedBy(name: string, managerId: string): Promise<string> {
  const account = await env.db.admin.query<{ id: string }>(
    `insert into accounts (organization_id, platform_id, display_name, created_by)
     values ($1, (select id from platforms where slug = 'custom' and organization_id is null), $2, $3)
     returning id`,
    [organizationId, name, rootUserId],
  );
  const accountId = account.rows[0]?.id ?? '';
  await env.db.admin.query(
    `insert into shares (organization_id, resource_type, resource_id, grantee_type, grantee_id, level, granted_by)
     values ($1, 'account', $2, 'user', $3, 'MANAGE', $4)`,
    [organizationId, accountId, managerId, rootUserId],
  );
  return accountId;
}

async function insertCredential(accountId: string): Promise<string> {
  const credential = await env.db.admin.query<{ id: string }>(
    `insert into credentials (organization_id, account_id, label, kind, created_by)
     values ($1, $2, 'cred', 'password', $3) returning id`,
    [organizationId, accountId, rootUserId],
  );
  return credential.rows[0]?.id ?? '';
}

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'offboarding',
    rootEmail: 'root@offboarding.test',
    rootName: 'Ada Lovelace',
  });
  organizationId = created.organizationId;
  rootUserId = created.rootUserId;

  const rootClient = new TestClient(env, '203.0.113.60');
  await rootClient.post('/auth/login', {
    email: 'root@offboarding.test',
    password: STRONG_PASSWORD,
  });
  const root = await enroll(env, rootClient);
  admin = await inviteAndOnboard(env, root.client, { email: 'admin@offboarding.test', rank: 1 });
  await inviteAndOnboard(env, admin.client, { email: 'leaver@offboarding.test', rank: 2 });
});

afterAll(async () => {
  await env.close();
});

describe('deactivating a person who is the only manager of an account', () => {
  it('hands the account over, revokes the share, asks for rotation, audits and queues the notice', async () => {
    const leaverId = await userIdOf('leaver@offboarding.test');
    const adminId = await userIdOf('admin@offboarding.test');
    const accountId = await insertAccountManagedBy('orphan', leaverId);
    const credentialId = await insertCredential(accountId);

    expect((await admin.client.post(`/users/${leaverId}/deactivate`)).status).toBe(204);

    const liveManagers = await env.db.admin.query<{ grantee_id: string }>(
      `select grantee_id from shares
        where resource_id = $1 and level = 'MANAGE' and revoked_at is null`,
      [accountId],
    );
    const managerIds = liveManagers.rows.map((row) => row.grantee_id);
    expect(managerIds).not.toContain(leaverId);
    expect(managerIds).toHaveLength(1);

    const tasks = await env.db.admin.query<{
      assigned_to: string;
      trigger: string;
      due_at: Date;
    }>(`select assigned_to, trigger, due_at from rotation_tasks where credential_id = $1`, [
      credentialId,
    ]);
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]?.trigger).toBe('user_deactivated');
    expect(tasks.rows[0]?.assigned_to).toBe(managerIds[0]);
    const dueInMilliseconds = (tasks.rows[0]?.due_at.getTime() ?? 0) - env.clock.now().getTime();
    expect(Math.abs(dueInMilliseconds - SEVENTY_TWO_HOURS_IN_MILLISECONDS)).toBeLessThan(
      DUE_DATE_TOLERANCE_IN_MILLISECONDS,
    );

    const reassignedAudit = await env.db.admin.query<{ target_type: string; target_id: string }>(
      `select target_type, target_id from audit_events
        where organization_id = $1 and action = 'account.offboarding_reassigned'`,
      [organizationId],
    );
    expect(reassignedAudit.rows).toEqual([{ target_type: 'account', target_id: accountId }]);

    const deactivatedAudit = await env.db.admin.query<{ metadata: Record<string, unknown> }>(
      `select metadata from audit_events
        where organization_id = $1 and action = 'user.deactivated' and target_id = $2`,
      [organizationId, leaverId],
    );
    expect(deactivatedAudit.rows[0]?.metadata).toMatchObject({
      reassignedAccounts: 1,
      unassignedAccounts: 0,
      rotationTasks: 1,
    });

    const notice = await env.db.admin.query<{ payload: Record<string, unknown> }>(
      `select payload from outbox_events where organization_id = $1 and type = 'user.offboarded'`,
      [organizationId],
    );
    expect(notice.rows).toHaveLength(1);
    expect(notice.rows[0]?.payload).toMatchObject({
      leaverId,
      actorId: adminId,
      assignedAccountCount: 1,
    });
    // El aviso viaja solo con ids y conteos: nunca correos ni nombres.
    expect(JSON.stringify(notice.rows[0]?.payload)).not.toContain('@');
  });
});
