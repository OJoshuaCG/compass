/**
 * Registro de aplicaciones cliente OIDC por HTTP (`/sso/clients`): ¿exige permiso y reautenticación,
 * muestra el secreto una sola vez y sin caché, nunca lo devuelve en el listado y aísla por organización?
 * El flujo de autorización en sí lo cubre `oidc-flow.e2e.test.ts`.
 */
import type { ProblemDetails } from '@iam/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  STRONG_PASSWORD,
  TestClient,
  enroll,
  freshTotp,
  inviteAndOnboard,
  startEnvironment,
} from './support/e2e.js';
import type { E2eEnvironment, EnrolledSession } from './support/e2e.js';

const REDIRECT_URI = 'https://grafana.example.test/login/generic_oauth';
const UNKNOWN_ROW_ID = '0190aaaa-0000-7000-8000-00000000ffff';
/** Rango de Operador: la matriz de permisos reserva `sso.clients.manage` a la Raíz y los Administradores. */
const OPERATOR_RANK = 3;

interface ClientBody {
  readonly id: string;
  readonly clientId: string;
  readonly status: string;
}
interface RegisteredBody {
  readonly data: { readonly client: ClientBody; readonly clientSecret: string };
}

let env: E2eEnvironment;
let root: EnrolledSession;
let otherRoot: EnrolledSession;
let operator: EnrolledSession;

async function reauthenticate(session: EnrolledSession): Promise<void> {
  const response = await session.client.post('/auth/reauth', {
    code: freshTotp(session.secret, env.clock),
  });
  expect(response.status).toBe(204);
}

async function bootstrapRoot(slug: string, ip: string): Promise<EnrolledSession> {
  await env.bootstrapOrganization({
    slug,
    rootEmail: `root@${slug}.test`,
    rootName: 'Ada Lovelace',
  });
  const client = new TestClient(env, ip);
  await client.post('/auth/login', { email: `root@${slug}.test`, password: STRONG_PASSWORD });
  return enroll(env, client);
}

beforeAll(async () => {
  env = await startEnvironment(inject('adminUrl'), { oidc: true });
  root = await bootstrapRoot('sso-clients', '203.0.113.150');
  otherRoot = await bootstrapRoot('sso-clients-other', '203.0.113.151');
  operator = await inviteAndOnboard(env, root.client, {
    email: 'operator@sso-clients.test',
    rank: OPERATOR_RANK,
  });
  await reauthenticate(operator);
});

afterAll(async () => {
  await env.close();
});

describe('/sso/clients', () => {
  it('exige reautenticación reciente antes de registrar', async () => {
    const response = await root.client.post<ProblemDetails>('/sso/clients', {
      name: 'Grafana',
      redirectUris: [REDIRECT_URI],
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('AUTHZ.REAUTH_REQUIRED');
  });

  it('niega a una persona sin el permiso, aunque haya reautenticado', async () => {
    const created = await operator.client.post<ProblemDetails>('/sso/clients', {
      name: 'Grafana',
      redirectUris: [REDIRECT_URI],
    });
    const listed = await operator.client.get<ProblemDetails>('/sso/clients');

    expect(created.status).toBe(403);
    expect(created.body.code).toBe('AUTHZ.PERMISSION');
    expect(listed.status).toBe(403);
  });

  it('sin sesión responde 401', async () => {
    const anonymous = new TestClient(env, '203.0.113.152');

    expect((await anonymous.get('/sso/clients')).status).toBe(401);
  });

  describe('con una Raíz reautenticada', () => {
    beforeAll(async () => {
      await reauthenticate(root);
      await reauthenticate(otherRoot);
    });

    it('registra con el secreto visible una sola vez y sin caché, y el listado nunca lo incluye', async () => {
      const registered = await root.client.post<RegisteredBody>('/sso/clients', {
        name: 'Grafana',
        redirectUris: [REDIRECT_URI],
      });

      expect(registered.status).toBe(201);
      expect(registered.headers['cache-control']).toBe('no-store');
      const { client, clientSecret } = registered.body.data;
      expect(client.status).toBe('active');
      expect(clientSecret.length).toBeGreaterThan(20);

      const listed = await root.client.get<{ data: ClientBody[] }>('/sso/clients');
      expect(listed.status).toBe(200);
      expect(listed.body.data.map((entry) => entry.clientId)).toContain(client.clientId);
      const serialized = JSON.stringify(listed.body);
      expect(serialized).not.toContain(clientSecret);
      expect(serialized.toLowerCase()).not.toContain('secret');
    });

    it('rechaza un cuerpo inválido con VALIDATION.FAILED sin devolver el valor recibido', async () => {
      const response = await root.client.post<ProblemDetails>('/sso/clients', {
        name: 'Grafana',
        redirectUris: ['not-a-url-LEAK-CHECK'],
      });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('VALIDATION.FAILED');
      expect(JSON.stringify(response.body)).not.toContain('LEAK-CHECK');
    });

    it('rota el secreto: cambia, no repite el anterior y también se entrega sin caché', async () => {
      const registered = await root.client.post<RegisteredBody>('/sso/clients', {
        name: 'Harbor',
        redirectUris: [REDIRECT_URI],
      });
      const { client, clientSecret: previousSecret } = registered.body.data;

      const rotated = await root.client.post<RegisteredBody>(
        `/sso/clients/${client.id}/rotate-secret`,
      );

      expect(rotated.status).toBe(200);
      expect(rotated.headers['cache-control']).toBe('no-store');
      expect(rotated.body.data.client.clientId).toBe(client.clientId);
      expect(rotated.body.data.clientSecret).not.toBe(previousSecret);
    });

    it('deshabilita un cliente y ya no deja rotarle el secreto', async () => {
      const registered = await root.client.post<RegisteredBody>('/sso/clients', {
        name: 'Jenkins',
        redirectUris: [REDIRECT_URI],
      });
      const { client } = registered.body.data;

      const disabled = await root.client.post<{ data: ClientBody }>(
        `/sso/clients/${client.id}/disable`,
      );
      expect(disabled.status).toBe(200);
      expect(disabled.body.data.status).toBe('disabled');

      const rotateAfter = await root.client.post<ProblemDetails>(
        `/sso/clients/${client.id}/rotate-secret`,
      );
      expect(rotateAfter.status).toBe(409);
      expect(rotateAfter.body.code).toBe('FEDERATION.CLIENT_DISABLED');
    });

    it('un id que no es UUID se rechaza y uno desconocido responde 404', async () => {
      const malformed = await root.client.post<ProblemDetails>('/sso/clients/not-a-uuid/disable');
      const unknown = await root.client.post<ProblemDetails>(
        `/sso/clients/${UNKNOWN_ROW_ID}/rotate-secret`,
      );

      expect(malformed.status).toBe(422);
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('NOT_FOUND');
    });

    it('otra organización no lista, rota ni deshabilita el cliente ajeno', async () => {
      const registered = await root.client.post<RegisteredBody>('/sso/clients', {
        name: 'Tailscale',
        redirectUris: [REDIRECT_URI],
      });
      const { client } = registered.body.data;

      const listed = await otherRoot.client.get<{ data: ClientBody[] }>('/sso/clients');
      const rotated = await otherRoot.client.post<ProblemDetails>(
        `/sso/clients/${client.id}/rotate-secret`,
      );
      const disabled = await otherRoot.client.post<ProblemDetails>(
        `/sso/clients/${client.id}/disable`,
      );

      expect(listed.body.data.map((entry) => entry.clientId)).not.toContain(client.clientId);
      expect(rotated.status).toBe(404);
      expect(disabled.status).toBe(404);
      const stillActive = await root.client.get<{ data: ClientBody[] }>('/sso/clients');
      expect(stillActive.body.data.find((entry) => entry.id === client.id)?.status).toBe('active');
    });
  });
});
