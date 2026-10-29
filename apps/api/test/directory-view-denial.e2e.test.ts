import type { ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { asOrganizationId, asUserId } from '../src/shared/kernel/index.js';
import type { RequestContext } from '../src/shared/kernel/index.js';
import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

// F6a: `ListDirectory` y `ListManaged` exigen un actor activo (`Authorizer.requireActiveMember`) y
// auditan la negación como `authz.denied` con la etiqueta `directory.view`.
//
// Hallazgo: por HTTP la negación es inalcanzable para un actor suspendido o dado de baja. La
// autenticación de la sesión rechaza (401) antes de llegar al caso de uso y su sesión ya fue
// cerrada al suspenderlo. Por eso el bloque 1 prueba ese 401 (y que no deja fila `authz.denied`),
// y el bloque 2 invoca los casos de uso del contenedor real con el contexto del actor no activo,
// que es la defensa en profundidad que la regla describe.
const DIRECTORY_VIEW_LABEL = 'directory.view';
const SESSION_DENIAL_CODE = 'AUTHZ.SESSION';
// Ventana de agrupación de negaciones idénticas (misma persona, código y permiso): 60 s más un margen.
const DENIAL_GROUPING_WINDOW_MS = 61_000;

let env: E2eEnvironment;
let organizationId: string;
let admin: EnrolledSession;
let suspendedId: string;
let deactivatedId: string;
let activeId: string;
let suspendedSession: EnrolledSession;

const idOf = async (email: string): Promise<string> =>
  (await env.db.admin.query<{ id: string }>('select id from users where email = $1', [email]))
    .rows[0]?.id ?? '';

/** Contexto de petición nuevo por llamada: cada prueba usa su requestId, sin estado compartido. */
const contextOf = (actorId: string, requestId: string): RequestContext => ({
  organizationId: asOrganizationId(organizationId),
  actorId: asUserId(actorId),
  requestId,
  sessionId: null,
  reauthAt: null,
});

const denialsOf = async (requestId: string) =>
  (
    await env.db.admin.query<{
      outcome: string;
      reason_code: string | null;
      actor_id: string | null;
      target_type: string | null;
      metadata: Record<string, unknown>;
    }>(
      "select outcome, reason_code, actor_id, target_type, metadata from audit_events where organization_id = $1 and action = 'authz.denied' and request_id = $2",
      [organizationId, requestId],
    )
  ).rows;

const denialsOfActor = async (actorId: string): Promise<number> =>
  Number(
    (
      await env.db.admin.query<{ n: string }>(
        "select count(*) as n from audit_events where organization_id = $1 and action = 'authz.denied' and actor_id = $2",
        [organizationId, actorId],
      )
    ).rows[0]?.n,
  );

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'));
  const created = await env.bootstrapOrganization({
    slug: 'dirview',
    rootEmail: 'root@dirview.test',
    rootName: 'Ada Lovelace',
  });
  organizationId = created.organizationId;

  const rootClient = new TestClient(env, '203.0.113.60');
  await rootClient.post('/auth/login', { email: 'root@dirview.test', password: STRONG_PASSWORD });
  const root = await enroll(env, rootClient);

  admin = await inviteAndOnboard(env, root.client, { email: 'admin@dirview.test', rank: 1 });
  suspendedSession = await inviteAndOnboard(env, admin.client, {
    email: 'suspended@dirview.test',
    rank: 3,
  });
  await inviteAndOnboard(env, admin.client, { email: 'deactivated@dirview.test', rank: 3 });
  await inviteAndOnboard(env, admin.client, { email: 'active@dirview.test', rank: 3 });
  activeId = await idOf('active@dirview.test');
  suspendedId = await idOf('suspended@dirview.test');
  deactivatedId = await idOf('deactivated@dirview.test');

  // Flujo real de la API, no inserciones a mano: así también se cierran sus sesiones.
  expect((await admin.client.post(`/users/${suspendedId}/suspend`)).status).toBe(204);
  expect((await admin.client.post(`/users/${deactivatedId}/deactivate`)).status).toBe(204);
});

afterAll(async () => {
  await env.close();
});

describe('por HTTP un actor suspendido no llega al caso de uso', () => {
  it('su sesión cerrada recibe 401 en el directorio y en gestionados, sin fila authz.denied', async () => {
    const directory = await suspendedSession.client.get<ProblemDetails>('/users?limit=10');
    const managed = await suspendedSession.client.get<ProblemDetails>('/users/managed?limit=10');

    expect(directory.status).toBe(401);
    expect(managed.status).toBe(401);
    // La autenticación corta antes del motor de autorización: no hay negación que auditar.
    expect(await denialsOfActor(suspendedId)).toBe(0);
  });
});

describe('requireActiveMember con la base de datos real', () => {
  const nonActive = [
    ['suspendido', () => suspendedId],
    ['dado de baja', () => deactivatedId],
  ] as const;

  for (const [label, actorOf] of nonActive) {
    it(`ListDirectory niega a un actor ${label} y deja una sola fila directory.view`, async () => {
      // Sin salir de la ventana, el motor colapsa esta negación con la anterior de la misma persona y no
      // escribe fila para esta petición.
      env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
      const requestId = `dir-${label}-${String(Date.now())}`;
      await expect(
        env.container.requestContext.run(contextOf(actorOf(), requestId), () =>
          env.container.listDirectory.execute({ limit: 10 }),
        ),
      ).rejects.toMatchObject({ code: SESSION_DENIAL_CODE });

      const rows = await denialsOf(requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        outcome: 'denied',
        reason_code: SESSION_DENIAL_CODE,
        actor_id: actorOf(),
        target_type: null,
      });
      // Sin datos del directorio: solo la etiqueta del permiso y el tipo de recurso.
      expect(rows[0]?.metadata).toEqual({ permission: DIRECTORY_VIEW_LABEL, resourceType: 'none' });
    });

    it(`ListManaged niega a un actor ${label} y deja una sola fila directory.view`, async () => {
      // Sin salir de la ventana, el motor colapsa esta negación con la anterior de la misma persona y no
      // escribe fila para esta petición.
      env.clock.advance(DENIAL_GROUPING_WINDOW_MS);
      const requestId = `managed-${label}-${String(Date.now())}`;
      await expect(
        env.container.requestContext.run(contextOf(actorOf(), requestId), () =>
          env.container.listManaged.execute({ limit: 10 }),
        ),
      ).rejects.toMatchObject({ code: SESSION_DENIAL_CODE });

      const rows = await denialsOf(requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.metadata).toEqual({ permission: DIRECTORY_VIEW_LABEL, resourceType: 'none' });
    });
  }

  it('un actor activo lista el directorio y los gestionados sin generar authz.denied', async () => {
    const before = await denialsOfActor(activeId);
    const requestId = `active-${String(Date.now())}`;

    const page = await env.container.requestContext.run(contextOf(activeId, requestId), () =>
      env.container.listDirectory.execute({ limit: 10 }),
    );
    await env.container.requestContext.run(contextOf(activeId, `${requestId}-m`), () =>
      env.container.listManaged.execute({ limit: 10 }),
    );

    expect(page.rows.length).toBeGreaterThan(0);
    expect(await denialsOf(requestId)).toHaveLength(0);
    expect(await denialsOf(`${requestId}-m`)).toHaveLength(0);
    expect(await denialsOfActor(activeId)).toBe(before);
  });
});
