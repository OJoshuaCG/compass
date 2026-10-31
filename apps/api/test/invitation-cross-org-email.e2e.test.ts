import type { CreateInvitationResponse, ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { STRONG_PASSWORD, TestClient, enroll, startEnvironment } from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// ADR 0041 (TODO.md C4a): el correo es único en toda la plataforma. Invitar desde la organización A
// a un correo que ya vive en la organización B no debe revelar que existe (la comprobación de
// "correo ya registrado" corre bajo el aislamiento por filas y no ve a la B), y al aceptar la
// restricción única global rechaza el alta con conflicto sin tocar al usuario de la B.
//
// Este bloque levanta su propio entorno y sus propias sesiones: no depende del reloj ni del estado
// de otros bloques.
const ORG_A_ROOT_EMAIL = 'root@xorg-a.test';
const ORG_B_ROOT_EMAIL = 'root@xorg-b.test';
const FREE_EMAIL = 'free@xorg-a.test';

let env: E2eEnvironment;
let orgAId: string;
let orgBId: string;
let rootA: EnrolledSession;

/** Cuántas filas de `users` hay con ese correo, en todas las organizaciones (cliente admin, sin RLS). */
const usersWithEmail = async (email: string): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ n: string }>('select count(*) as n from users where email = $1', [
        email,
      ])
    ).rows[0]?.n,
  );

/** La fila completa del usuario como JSON: cualquier cambio en cualquier columna la altera. */
const userSnapshot = async (email: string): Promise<unknown> =>
  (
    await env.db.admin.query<{ snapshot: unknown }>(
      'select to_jsonb(u) as snapshot from users u where email = $1',
      [email],
    )
  ).rows[0]?.snapshot;

const totalUsers = async (): Promise<number> =>
  Number((await env.db.admin.query<{ n: string }>('select count(*) as n from users')).rows[0]?.n);

const pendingInvitationsOf = async (email: string): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ n: string }>(
        `select count(*) as n from invitations
          where organization_id = $1 and email = $2 and accepted_at is null and revoked_at is null`,
        [orgAId, email],
      )
    ).rows[0]?.n,
  );

const acceptedAuditCount = async (): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ n: string }>(
        "select count(*) as n from audit_events where organization_id = $1 and action = 'user.invitation_accepted'",
        [orgAId],
      )
    ).rows[0]?.n,
  );

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));

  const orgA = await env.bootstrapOrganization({
    slug: 'xorg-a',
    rootEmail: ORG_A_ROOT_EMAIL,
    rootName: 'Ada Lovelace',
  });
  orgAId = orgA.organizationId;
  // La organización B existe y su Raíz es el usuario cuyo correo se intentará "robar" desde la A.
  const orgB = await env.bootstrapOrganization({
    slug: 'xorg-b',
    rootEmail: ORG_B_ROOT_EMAIL,
    rootName: 'Grace Hopper',
  });
  orgBId = orgB.organizationId;
  expect(orgBId).not.toBe(orgAId);

  const rootClient = new TestClient(env, '203.0.113.90');
  await rootClient.post('/auth/login', { email: ORG_A_ROOT_EMAIL, password: STRONG_PASSWORD });
  rootA = await enroll(env, rootClient);
});

afterAll(async () => {
  await env.close();
});

describe('inviting an email that belongs to another organization (ADR 0041)', () => {
  it('creates the invitation and answers exactly like it does for a free email', async () => {
    const usersBefore = await totalUsers();

    const free = await rootA.client.post<CreateInvitationResponse>('/invitations', {
      email: FREE_EMAIL,
      rank: 1,
      roleIds: [],
    });
    const taken = await rootA.client.post<CreateInvitationResponse>('/invitations', {
      email: ORG_B_ROOT_EMAIL,
      rank: 1,
      roleIds: [],
    });

    // Misma respuesta: si el estado, la forma o los tipos difirieran, quien invita podría deducir
    // que el correo existe en otra organización.
    expect(free.status).toBe(201);
    expect(taken.status).toBe(free.status);
    expect(Object.keys(taken.body).sort()).toEqual(Object.keys(free.body).sort());
    for (const key of Object.keys(free.body) as (keyof CreateInvitationResponse)[]) {
      expect(typeof taken.body[key]).toBe(typeof free.body[key]);
    }
    expect(taken.body.email).toBe(ORG_B_ROOT_EMAIL);

    // Se crea la invitación (pendiente, de la organización A) y el correo se envía como siempre...
    expect(await pendingInvitationsOf(ORG_B_ROOT_EMAIL)).toBe(1);
    expect(env.mailer.last?.to).toBe(ORG_B_ROOT_EMAIL);
    // ...pero invitar nunca crea usuarios, ni siquiera para el correo libre.
    expect(await totalUsers()).toBe(usersBefore);
    expect(await usersWithEmail(ORG_B_ROOT_EMAIL)).toBe(1);
  });

  it('answers a conflict on accept and creates no user nor alters the other organization one', async () => {
    // Se busca la invitación pendiente al correo de la B (la deja el test anterior) y, si falta
    // porque se ejecuta aislado, se crea: así el test no depende del orden. Reenviarla da un token
    // conocido, porque quien invita nunca ve el token original.
    const existing = await env.db.admin.query<{ id: string }>(
      `select id from invitations
        where organization_id = $1 and email = $2 and accepted_at is null and revoked_at is null`,
      [orgAId, ORG_B_ROOT_EMAIL],
    );
    let invitationId = existing.rows[0]?.id ?? '';
    if (invitationId === '') {
      const created = await rootA.client.post<CreateInvitationResponse>('/invitations', {
        email: ORG_B_ROOT_EMAIL,
        rank: 1,
        roleIds: [],
      });
      expect(created.status).toBe(201);
      invitationId = created.body.id;
    }
    expect(invitationId).not.toBe('');
    const resent = await rootA.client.post(`/invitations/${invitationId}/resend`);
    expect(resent.status).toBeLessThan(300);
    const token = env.mailer.last?.token ?? '';
    expect(env.mailer.last?.to).toBe(ORG_B_ROOT_EMAIL);

    const usersBefore = await totalUsers();
    const countBefore = await usersWithEmail(ORG_B_ROOT_EMAIL);
    const snapshotBefore = await userSnapshot(ORG_B_ROOT_EMAIL);
    const acceptedAuditBefore = await acceptedAuditCount();

    const guest = new TestClient(env, '198.51.100.90');
    const accepted = await guest.post<ProblemDetails>('/invitations/accept', {
      token,
      displayName: 'Impostor Person',
      password: STRONG_PASSWORD,
    });

    // Conflicto con el código estable del dominio (409 INVITATION.CONFLICT), sin sesión.
    expect(accepted.status).toBe(409);
    expect(accepted.body.code).toBe('INVITATION.CONFLICT');
    expect(guest.cookie).toBeNull();

    // Ningún usuario nuevo y el existente de la B intacto, fila completa incluida.
    expect(await usersWithEmail(ORG_B_ROOT_EMAIL)).toBe(countBefore);
    expect(await totalUsers()).toBe(usersBefore);
    expect(await userSnapshot(ORG_B_ROOT_EMAIL)).toEqual(snapshotBefore);
    const owner = await env.db.admin.query<{ organization_id: string }>(
      'select organization_id from users where email = $1',
      [ORG_B_ROOT_EMAIL],
    );
    expect(owner.rows[0]?.organization_id).toBe(orgBId);

    // La aceptación se revirtió entera: la invitación sigue pendiente (vence por su plazo normal),
    // sin auditoría de aceptación y sin quedar marcada como aceptada.
    expect(await pendingInvitationsOf(ORG_B_ROOT_EMAIL)).toBe(1);
    expect(await acceptedAuditCount()).toBe(acceptedAuditBefore);
  });

  it('the existing user of the other organization still signs in with their own password', async () => {
    // Prueba de que el intento no cambió sus credenciales: la contraseña inicial sigue sirviendo.
    const client = new TestClient(env, '203.0.113.91');
    const login = await client.post('/auth/login', {
      email: ORG_B_ROOT_EMAIL,
      password: STRONG_PASSWORD,
    });
    expect(login.status).toBe(200);
  });
});
