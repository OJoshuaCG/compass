/**
 * SENSIBLE (ruta protegida: acceso, identidad, auditoría y criptografía de recuperación). Esta prueba la
 * debe revisar una persona.
 *
 * Recorre la transferencia de la Raíz por la API real contra PostgreSQL: proponer, aceptar, esperar 72 horas,
 * que el proceso periódico la complete y lo que el cierre cambia (jerarquía, rol, sesiones, factores,
 * códigos de emergencia, auditoría y aviso en el outbox). Después comprueba la cancelación (governance §2.4,
 * ADR 0048).
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { RootTransfer } from '@iam/contracts';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  signIn,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

const SEVENTY_TWO_HOURS_IN_MILLISECONDS = 72 * 60 * 60 * 1000;
const ONE_HOUR_IN_MILLISECONDS = 60 * 60 * 1000;
const EMERGENCY_CODES_PER_ORGANIZATION = 8;

let env: E2eEnvironment;
let organizationId: string;
let rootUserId: string;
let root: EnrolledSession;
let admin: EnrolledSession;
let otherAdmin: EnrolledSession;

const userIdOf = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

async function reauthenticate(session: EnrolledSession): Promise<void> {
  const response = await session.client.post('/auth/reauth', {
    code: freshTotp(session.secret, env.clock),
  });
  expect(response.status).toBe(204);
}

/** Tras avanzar el reloj decenas de horas las sesiones caducan: se vuelve a ingresar con el segundo factor. */
async function signInAgain(
  session: EnrolledSession,
  email: string,
  ip: string,
): Promise<EnrolledSession> {
  const client = await signIn(env, email, session.secret, STRONG_PASSWORD, ip);
  return { ...session, client };
}

async function runPeriodicJob(): Promise<string> {
  return env.container.tenantScope.runAs(
    { organizationId: organizationId as never, actorId: null, requestId: 'root-transfer-job' },
    () => env.container.completeRootTransfers.run(),
  );
}

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'root-transfer',
    rootEmail: 'root@root-transfer.test',
    rootName: 'Ada Lovelace',
  });
  organizationId = created.organizationId;
  rootUserId = created.rootUserId;

  const rootClient = new TestClient(env, '203.0.113.70');
  await rootClient.post('/auth/login', {
    email: 'root@root-transfer.test',
    password: STRONG_PASSWORD,
  });
  root = await enroll(env, rootClient);
  admin = await inviteAndOnboard(env, root.client, { email: 'admin@root-transfer.test', rank: 1 });
  otherAdmin = await inviteAndOnboard(env, root.client, {
    email: 'other@root-transfer.test',
    rank: 1,
  });
});

afterAll(async () => {
  await env.close();
});

describe('a Root transfer that nobody cancels', () => {
  it('waits 72 hours from the acceptance and then hands the organization over', async () => {
    const adminId = await userIdOf('admin@root-transfer.test');
    const otherAdminId = await userIdOf('other@root-transfer.test');
    // El bootstrap de la organización ya emitió los códigos de emergencia: la prueba no siembra más.
    await reauthenticate(root);
    const proposal = await root.client.post<{ data: RootTransfer }>('/root-transfer', {
      targetUserId: adminId,
    });
    expect(proposal.status).toBe(201);
    expect(proposal.body.data.status).toBe('pending_acceptance');

    // Una segunda propuesta mientras hay una abierta no se acepta.
    await reauthenticate(root);
    const second = await root.client.post('/root-transfer', { targetUserId: otherAdminId });
    expect(second.status).toBe(409);

    // Sin aceptación no hay cuenta regresiva: el proceso periódico no hace nada.
    env.clock.advance(SEVENTY_TWO_HOURS_IN_MILLISECONDS + ONE_HOUR_IN_MILLISECONDS);
    expect(await runPeriodicJob()).not.toBe('completed');
    const stillRoot = await env.db.admin.query<{ rank: number }>(
      'select rank from users where id = $1',
      [rootUserId],
    );
    expect(stillRoot.rows[0]?.rank).toBe(0);
  });

  it('completes only after the wait counted from the acceptance', async () => {
    const adminId = await userIdOf('admin@root-transfer.test');
    // La propuesta anterior caducó a los 7 días solo si pasó ese plazo; aquí sigue vigente.
    admin = await signInAgain(admin, 'admin@root-transfer.test', '203.0.113.72');
    await reauthenticate(admin);
    const accepted = await admin.client.post<{ data: RootTransfer }>('/root-transfer/accept');
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.status).toBe('waiting');

    env.clock.advance(SEVENTY_TWO_HOURS_IN_MILLISECONDS - ONE_HOUR_IN_MILLISECONDS);
    expect(await runPeriodicJob()).toBe('not_due');

    env.clock.advance(2 * ONE_HOUR_IN_MILLISECONDS);
    expect(await runPeriodicJob()).toBe('completed');

    const users = await env.db.admin.query<{
      id: string;
      rank: number;
      managed_by: string | null;
      status: string;
    }>('select id, rank, managed_by, status from users where id = any($1::uuid[])', [
      [rootUserId, adminId],
    ]);
    const previousRoot = users.rows.find((row) => row.id === rootUserId);
    const newRoot = users.rows.find((row) => row.id === adminId);
    expect(newRoot).toMatchObject({ rank: 0, managed_by: null, status: 'active' });
    expect(previousRoot).toMatchObject({ rank: 1, managed_by: adminId, status: 'invited' });

    const roleNames = await env.db.admin.query<{ id: string; name: string }>(
      `select ur.user_id as id, r.name
         from user_roles ur join roles r on r.id = ur.role_id and r.organization_id = ur.organization_id
        where ur.organization_id = $1 and ur.user_id = any($2::uuid[])`,
      [organizationId, [rootUserId, adminId]],
    );
    expect(roleNames.rows.filter((row) => row.id === adminId).map((row) => row.name)).toContain(
      'Root',
    );
    expect(
      roleNames.rows.filter((row) => row.id === rootUserId).map((row) => row.name),
    ).not.toContain('Root');

    const liveEmergencyCodes = await env.db.admin.query(
      `select 1 from user_recovery_codes
        where organization_id = $1 and kind = 'emergency' and used_at is null`,
      [organizationId],
    );
    expect(liveEmergencyCodes.rows).toHaveLength(0);

    const liveSessions = await env.db.admin.query(
      'select 1 from sessions where user_id = $1 and revoked_at is null',
      [rootUserId],
    );
    expect(liveSessions.rows).toHaveLength(0);

    const audited = await env.db.admin.query<{ action: string; metadata: Record<string, unknown> }>(
      `select action, metadata from audit_events
        where organization_id = $1 and action like 'root_transfer.%' order by created_at, id`,
      [organizationId],
    );
    expect(audited.rows.map((row) => row.action)).toEqual([
      'root_transfer.requested',
      'root_transfer.accepted',
      'root_transfer.completed',
    ]);
    expect(audited.rows[2]?.metadata).toMatchObject({
      emergencyCodesInvalidated: EMERGENCY_CODES_PER_ORGANIZATION,
    });

    const notices = await env.db.admin.query<{ payload: Record<string, unknown> }>(
      `select payload from outbox_events where organization_id = $1 and type = 'root_transfer.notice'`,
      [organizationId],
    );
    expect(notices.rows.length).toBeGreaterThan(0);
    // Los avisos viajan solo con ids: nunca correos ni nombres.
    expect(JSON.stringify(notices.rows.map((row) => row.payload))).not.toContain('@');
  });

  it('makes the new Root able to open a transfer and cancel it', async () => {
    // La nueva Raíz (antes Administrador) ya no es la misma sesión: se vuelve a entrar con su factor.
    const newRoot = await signInAgain(admin, 'admin@root-transfer.test', '203.0.113.71');

    const otherAdminId = await userIdOf('other@root-transfer.test');
    await reauthenticate(newRoot);
    const proposal = await newRoot.client.post<{ data: RootTransfer }>('/root-transfer', {
      targetUserId: otherAdminId,
    });
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(201);

    // Cualquier Administrador puede cancelar mientras está abierta.
    otherAdmin = await signInAgain(otherAdmin, 'other@root-transfer.test', '203.0.113.73');
    const cancelledByAdmin = await otherAdmin.client.request('DELETE', '/root-transfer');
    expect(cancelledByAdmin.status).toBe(204);

    const reason = await env.db.admin.query<{ metadata: Record<string, unknown> }>(
      `select metadata from audit_events
        where organization_id = $1 and action = 'root_transfer.cancelled'`,
      [organizationId],
    );
    expect(reason.rows).toHaveLength(1);
    expect(await runPeriodicJob()).toBe('none');
  });
});
