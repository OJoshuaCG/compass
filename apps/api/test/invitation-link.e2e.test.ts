import type {
  CreateInvitationResponse,
  CreateInvitationWithLinkResponse,
  PendingInvitation,
  ProblemDetails,
} from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  APP_ORIGIN,
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// SENSIBLE (revisión humana): entregar el enlace de una invitación permite aceptarla en lugar del
// invitado. Se prueba que exige permiso propio y reautenticación, que cada entrega se audita, que el
// enlace no se guarda en ningún lado y que un fallo del correo no deshace la invitación.
let env: E2eEnvironment;
let orgId: string;
let root: EnrolledSession;
let adminA: EnrolledSession;
let adminB: EnrolledSession;
let leaderWithoutLink: EnrolledSession;
let operator: EnrolledSession;

const audit = async (action: string) =>
  (
    await env.db.admin.query<{ outcome: string; metadata: Record<string, unknown> | null }>(
      'select outcome, metadata from audit_events where organization_id = $1 and action = $2 order by seq',
      [orgId, action],
    )
  ).rows;

const reauthenticate = (who: EnrolledSession) =>
  who.client.post('/auth/reauth', { code: freshTotp(who.secret, env.clock) });

const preview = (token: string) =>
  new TestClient(env, '198.51.100.99').post<ProblemDetails>('/invitations/preview', { token });

const tokenOf = (link: string): string => decodeURIComponent(link.split('#token=')[1] ?? '');

// El auditor agrupa las negaciones idénticas dentro de 60 s (ADR 0022).
const DENIAL_GROUPING_WINDOW_MS = 61_000;
// Un minuto más que la ventana de reautenticación (5 min) para dejarla vencida.
const REAUTH_WINDOW_MS = 6 * 60 * 1000;

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'il',
    rootEmail: 'root@il.test',
    rootName: 'Ada Lovelace',
  });
  orgId = created.organizationId;
  const client = new TestClient(env, '203.0.113.81');
  await client.post('/auth/login', { email: 'root@il.test', password: STRONG_PASSWORD });
  root = await enroll(env, client);
  adminA = await inviteAndOnboard(env, root.client, { email: 'a@il.test', rank: 1 });
  adminB = await inviteAndOnboard(env, root.client, { email: 'b@il.test', rank: 1 });
  // Líder: la plantilla de sistema "Leader" es una sola fila por organización, y a ella se le quita el permiso
  // del enlace (reproduce un rol de sistema anterior a la 0026). Los Administradores conservan el suyo.
  leaderWithoutLink = await inviteAndOnboard(env, root.client, { email: 'n@il.test', rank: 2 });
  operator = await inviteAndOnboard(env, adminA.client, { email: 'o@il.test', rank: 3 });
  await env.db.admin.query(
    `update roles set permissions = array_remove(permissions, 'user.invite_link')
      where organization_id = $1 and is_system and name = 'Leader'`,
    [orgId],
  );
});

afterAll(async () => {
  await env.close();
});

describe('creating an invitation and receiving its link', () => {
  it('refuses without a recent re-authentication: nothing is created or mailed, and the denial is audited', async () => {
    const mails = env.mailer.sent.length;
    const deniedBefore = (await audit('authz.denied')).length;
    const response = await adminA.client.post<ProblemDetails>('/invitations/with-link', {
      email: 'noreauth@il.test',
      rank: 2,
      roleIds: [],
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
    expect(JSON.stringify(response.body)).not.toContain('#token=');
    expect(env.mailer.sent.length).toBe(mails);
    const pending = (await adminA.client.get<{ data: PendingInvitation[] }>('/invitations')).body
      .data;
    expect(pending.map((i) => i.email)).not.toContain('noreauth@il.test');
    expect((await audit('authz.denied')).length).toBe(deniedBefore + 1);
    expect(await audit('user.invitation_link_revealed')).toEqual([]);
  });

  it('hands over a link that works, mails the same token, and audits the delivery without the link', async () => {
    expect((await reauthenticate(adminA)).status).toBe(204);
    const response = await adminA.client.post<CreateInvitationWithLinkResponse>(
      '/invitations/with-link',
      { email: 'visible@il.test', rank: 2, roleIds: [] },
    );
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.emailSent).toBe(true);
    expect(response.body.email).toBe('visible@il.test');

    const mailedToken = env.mailer.last?.token ?? '';
    expect(response.body.link).toBe(
      `${APP_ORIGIN}/invitation#token=${encodeURIComponent(mailedToken)}`,
    );
    expect((await preview(tokenOf(response.body.link))).status).toBe(200);

    const events = await audit('user.invitation_link_revealed');
    expect(events.map((e) => e.outcome)).toEqual(['success']);
    expect(events[0]?.metadata).toEqual({ emailSent: true });
    // Ni el token ni el enlace llegan a la auditoría.
    const everything = JSON.stringify(
      (await env.db.admin.query('select * from audit_events where organization_id = $1', [orgId]))
        .rows,
    );
    expect(everything).not.toContain(tokenOf(response.body.link));
  });

  it('keeps the invitation and still hands over the link when the mail server fails', async () => {
    expect((await reauthenticate(adminA)).status).toBe(204);
    const mails = env.mailer.sent.length;
    env.mailer.failNext = true;
    const response = await adminA.client.post<CreateInvitationWithLinkResponse>(
      '/invitations/with-link',
      { email: 'smtpdown@il.test', rank: 2, roleIds: [] },
    );
    expect(response.status).toBe(201);
    expect(response.body.emailSent).toBe(false);
    expect(env.mailer.sent.length).toBe(mails);
    expect((await preview(tokenOf(response.body.link))).status).toBe(200);

    const pending = (await adminA.client.get<{ data: PendingInvitation[] }>('/invitations')).body
      .data;
    expect(pending.map((i) => i.email)).toContain('smtpdown@il.test');
    const events = await audit('user.invitation_link_revealed');
    expect(events.at(-1)?.metadata).toEqual({ emailSent: false });
  });

  it('keeps the old behavior of the plain route: a mail failure leaves no invitation behind', async () => {
    env.mailer.failNext = true;
    const response = await adminA.client.post<ProblemDetails>('/invitations', {
      email: 'plain-fails@il.test',
      rank: 2,
      roleIds: [],
    });
    expect(response.status).toBeGreaterThanOrEqual(500);
    const pending = (await adminA.client.get<{ data: PendingInvitation[] }>('/invitations')).body
      .data;
    expect(pending.map((i) => i.email)).not.toContain('plain-fails@il.test');
  });

  it('never stores the link: the idempotency table has no trace, and a retry is not replayed', async () => {
    expect((await reauthenticate(adminA)).status).toBe(204);
    const key = { 'idempotency-key': 'link-retry-0001' };
    const body = { email: 'retry@il.test', rank: 2 as const, roleIds: [] };
    const first = await adminA.client.post<CreateInvitationWithLinkResponse>(
      '/invitations/with-link',
      body,
      key,
    );
    expect(first.status).toBe(201);
    const second = await adminA.client.post<ProblemDetails>('/invitations/with-link', body, key);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('INVITATION.CONFLICT');

    const stored = await env.db.admin.query<{ found: number }>(
      `select count(*)::int as found from idempotency_keys
        where organization_id = $1 and response::text like '%' || $2 || '%'`,
      [orgId, tokenOf(first.body.link)],
    );
    expect(stored.rows[0]?.found).toBe(0);
    const keyed = await env.db.admin.query<{ found: number }>(
      "select count(*)::int as found from idempotency_keys where organization_id = $1 and key = 'link-retry-0001'",
      [orgId],
    );
    expect(keyed.rows[0]?.found).toBe(0);
  });

  it('refuses someone who can invite but lacks user.invite_link, with an audited denial and nothing created', async () => {
    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    expect((await reauthenticate(leaderWithoutLink)).status).toBe(204);
    const mails = env.mailer.sent.length;
    const deniedBefore = (await audit('authz.denied')).length;
    const response = await leaderWithoutLink.client.post<ProblemDetails>('/invitations/with-link', {
      email: 'nolink@il.test',
      rank: 3,
      roleIds: [],
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.PERMISSION');
    expect(env.mailer.sent.length).toBe(mails);
    expect((await audit('authz.denied')).length).toBe(deniedBefore + 1);

    // La ruta de siempre sigue funcionando para esa persona: solo cambia la entrega del enlace.
    const plain = await leaderWithoutLink.client.post('/invitations', {
      email: 'plain-ok@il.test',
      rank: 3,
      roleIds: [],
    });
    expect(plain.status).toBe(201);
  });

  it('refuses an operator, and validates the body like the plain route does', async () => {
    expect((await reauthenticate(operator)).status).toBe(204);
    const denied = await operator.client.post('/invitations/with-link', {
      email: 'x@il.test',
      rank: 3,
      roleIds: [],
    });
    expect(denied.status).toBe(403);

    expect((await reauthenticate(adminA)).status).toBe(204);
    const invalid = await adminA.client.post('/invitations/with-link', {
      email: 'not-an-email',
      rank: 2,
    });
    expect(invalid.status).toBe(422);
    const rankZero = await adminA.client.post('/invitations/with-link', {
      email: 'rank0@il.test',
      rank: 0,
    });
    expect(rankZero.status).toBe(422);
  });
});

describe('resending an invitation and receiving the new link', () => {
  it('replaces the previous link, hands over the new one and audits both the resend and the delivery', async () => {
    expect((await reauthenticate(adminA)).status).toBe(204);
    const first = await adminA.client.post<CreateInvitationWithLinkResponse>(
      '/invitations/with-link',
      { email: 'resend@il.test', rank: 2, roleIds: [] },
    );
    const firstToken = tokenOf(first.body.link);
    expect((await preview(firstToken)).status).toBe(200);

    expect((await reauthenticate(adminA)).status).toBe(204);
    const resent = await adminA.client.post<CreateInvitationWithLinkResponse>(
      `/invitations/${first.body.id}/resend-with-link`,
    );
    expect(resent.status).toBe(201);
    expect(resent.headers['cache-control']).toBe('no-store');
    expect(resent.body.id).not.toBe(first.body.id);
    expect(resent.body.emailSent).toBe(true);
    expect(tokenOf(resent.body.link)).not.toBe(firstToken);

    expect((await preview(firstToken)).status).toBeGreaterThanOrEqual(400);
    expect((await preview(tokenOf(resent.body.link))).status).toBe(200);
    expect((await audit('user.invitation_resent')).length).toBeGreaterThanOrEqual(1);
    expect((await audit('user.invitation_link_revealed')).length).toBeGreaterThanOrEqual(2);

    // Reintentar con el mismo id ya no sirve (la invitación fue revocada): no hay otro enlace.
    expect((await reauthenticate(adminA)).status).toBe(204);
    const again = await adminA.client.post<ProblemDetails>(
      `/invitations/${first.body.id}/resend-with-link`,
    );
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(again.body)).not.toContain('#token=');
  });

  it('keeps the new invitation and hands over the link when the mail server fails on resend', async () => {
    expect((await reauthenticate(adminA)).status).toBe(204);
    const first = await adminA.client.post<CreateInvitationWithLinkResponse>(
      '/invitations/with-link',
      { email: 'resend-smtp@il.test', rank: 2, roleIds: [] },
    );
    expect((await reauthenticate(adminA)).status).toBe(204);
    env.mailer.failNext = true;
    const resent = await adminA.client.post<CreateInvitationWithLinkResponse>(
      `/invitations/${first.body.id}/resend-with-link`,
    );
    expect(resent.status).toBe(201);
    expect(resent.body.emailSent).toBe(false);
    expect((await preview(tokenOf(resent.body.link))).status).toBe(200);
  });

  it('refuses a peer outside the line, and someone without user.invite_link, without handing over anything', async () => {
    expect((await reauthenticate(adminA)).status).toBe(204);
    const mine = await adminA.client.post<CreateInvitationWithLinkResponse>(
      '/invitations/with-link',
      { email: 'peer@il.test', rank: 2, roleIds: [] },
    );
    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);

    expect((await reauthenticate(adminB)).status).toBe(204);
    const peer = await adminB.client.post<ProblemDetails>(
      `/invitations/${mine.body.id}/resend-with-link`,
    );
    expect(peer.status).toBe(403);
    expect(JSON.stringify(peer.body)).not.toContain('#token=');
    expect((await preview(tokenOf(mine.body.link))).status).toBe(200); // el enlace original sigue vivo

    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
    expect((await reauthenticate(leaderWithoutLink)).status).toBe(204);
    const without = await leaderWithoutLink.client.post<ProblemDetails>(
      `/invitations/${mine.body.id}/resend-with-link`,
    );
    expect(without.status).toBe(403);
    expect(JSON.stringify(without.body)).not.toContain('#token=');
  });

  // Reenviar una invitación PROPIA aísla el permiso y la reautenticación de la regla de jerarquía:
  // sin ellas, quitar cualquiera de las dos exigencias del reenvío con enlace no rompería otra cosa.
  it('refuses to resend an own invitation with the link without the permission, and nothing changes', async () => {
    const own = await leaderWithoutLink.client.post<CreateInvitationResponse>('/invitations', {
      email: 'own-noperm@il.test',
      rank: 3,
      roleIds: [],
    });
    expect(own.status).toBe(201);
    const mailedToken = env.mailer.last?.token ?? '';
    const mails = env.mailer.sent.length;
    const deniedBefore = (await audit('authz.denied')).length;
    env.clock.advance(DENIAL_GROUPING_WINDOW_MS);

    expect((await reauthenticate(leaderWithoutLink)).status).toBe(204);
    const response = await leaderWithoutLink.client.post<ProblemDetails>(
      `/invitations/${own.body.id}/resend-with-link`,
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.PERMISSION');
    expect(JSON.stringify(response.body)).not.toContain('#token=');
    expect(env.mailer.sent.length).toBe(mails);
    expect((await audit('authz.denied')).length).toBe(deniedBefore + 1);
    expect((await preview(mailedToken)).status).toBe(200);
  });

  it('refuses to resend an own invitation with the link without a recent re-authentication', async () => {
    expect((await reauthenticate(adminA)).status).toBe(204);
    const own = await adminA.client.post<CreateInvitationWithLinkResponse>(
      '/invitations/with-link',
      { email: 'own-noreauth@il.test', rank: 2, roleIds: [] },
    );
    const mails = env.mailer.sent.length;
    env.clock.advance(REAUTH_WINDOW_MS);

    const response = await adminA.client.post<ProblemDetails>(
      `/invitations/${own.body.id}/resend-with-link`,
    );
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
    expect(JSON.stringify(response.body)).not.toContain('#token=');
    expect(env.mailer.sent.length).toBe(mails);
    expect((await preview(tokenOf(own.body.link))).status).toBe(200);
  });

  it('answers the same for an unknown or malformed invitation id', async () => {
    expect((await reauthenticate(root)).status).toBe(204);
    const unknown = await root.client.post<ProblemDetails>(
      '/invitations/018f0000-0000-7000-8000-000000000000/resend-with-link',
    );
    expect(unknown.status).toBeGreaterThanOrEqual(400);
    expect((await root.client.post('/invitations/not-a-uuid/resend-with-link')).status).toBe(422);
  });
});
