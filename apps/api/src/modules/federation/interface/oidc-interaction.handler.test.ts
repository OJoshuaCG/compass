import type { IncomingMessage, ServerResponse } from 'node:http';

import type { InteractionDetails, InteractionResult } from 'oidc-provider';
import { describe, expect, it, vi } from 'vitest';

import { COMPASS_MFA_ACR, OidcInteractionHandler } from './oidc-interaction.handler.js';
import type {
  ConsentAction,
  InteractionEntryCheck,
  InteractionPrincipal,
  OidcInteractionDeps,
} from './oidc-interaction.handler.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const ORG = 'org-1';
const MFA_AT = new Date('2026-11-18T11:59:30.000Z');
const INTERACTION_STARTED_SECONDS = Math.floor(
  new Date('2026-11-18T11:59:00.000Z').getTime() / 1000,
);

const principal = (overrides: Partial<InteractionPrincipal> = {}): InteractionPrincipal => ({
  sessionId: 'session-1',
  organizationId: ORG,
  userId: 'user-1',
  mfaAt: MFA_AT,
  ...overrides,
});

const details = (overrides: Partial<InteractionDetails> = {}): InteractionDetails => ({
  uid: 'uid-1',
  iat: INTERACTION_STARTED_SECONDS,
  params: { client_id: 'client-1' },
  prompt: { name: 'login', details: {} },
  session: { accountId: 'user-1' },
  ...overrides,
});

class FakeResponse {
  statusCode = 200;
  headersSent = false;
  readonly headers: Record<string, string> = {};
  body = '';
  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  end(body = ''): void {
    this.body = body;
    this.headersSent = true;
  }
}

interface Scenario {
  readonly principal?: InteractionPrincipal | null;
  readonly details?: InteractionDetails | Error;
  readonly clientOrganization?: string | null;
  readonly entry?: InteractionEntryCheck;
  readonly token?: string | undefined;
  readonly consentAction?: ConsentAction;
}

function run(scenario: Scenario = {}) {
  const finished: InteractionResult[] = [];
  const checkEntry = vi.fn<OidcInteractionDeps['checkEntry']>(() =>
    Promise.resolve(scenario.entry ?? { allowed: true, isExternal: false }),
  );
  const grantAll = vi.fn(() => Promise.resolve('grant-1'));
  const interactionDetails = vi.fn(() => {
    const value = scenario.details ?? details();
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
  const deps: OidcInteractionDeps = {
    provider: {
      interactionDetails,
      interactionFinished: (_req, _res, result) => {
        finished.push(result);
        return Promise.resolve();
      },
      grantAll,
    },
    authenticate: () =>
      Promise.resolve(scenario.principal === undefined ? principal() : scenario.principal),
    resolveClientOrganization: () =>
      Promise.resolve(
        scenario.clientOrganization === undefined ? ORG : scenario.clientOrganization,
      ),
    checkEntry,
    runWithAmbient: (_context, fn) => fn(),
    now: () => NOW,
  };
  const response = new FakeResponse();
  const handler = new OidcInteractionHandler(deps);
  const input = {
    request: {} as IncomingMessage,
    response: response as unknown as ServerResponse,
    uid: 'uid-1',
    sessionToken: 'token' in scenario ? scenario.token : 'cookie-token',
    requestId: 'req-1',
  };
  const done =
    scenario.consentAction === undefined
      ? handler.handle(input)
      : handler.handleConsent(input, scenario.consentAction);
  return { done, response, finished, checkEntry, grantAll };
}

describe('OidcInteractionHandler', () => {
  it('sin cookie de Compass manda a /login y conserva el regreso a la interacción', async () => {
    const { done, response, finished } = run({ token: undefined });
    await done;
    expect(response.statusCode).toBe(302);
    expect(response.headers['Location']).toBe('/login?returnTo=%2Foidc%2Finteraction%2Fuid-1');
    expect(finished).toEqual([]);
  });

  it('con sesión de Compass válida cierra el login con auth_time, acr y amr de mfa_at', async () => {
    const { done, finished } = run();
    await done;
    expect(finished).toEqual([
      {
        login: {
          accountId: 'user-1',
          acr: COMPASS_MFA_ACR,
          amr: ['mfa'],
          ts: Math.floor(MFA_AT.getTime() / 1000),
        },
      },
    ]);
  });

  it('una sesión sin segundo factor no emite identidad y manda a /login', async () => {
    const { done, response, finished } = run({ principal: principal({ mfaAt: null }) });
    await done;
    expect(response.headers['Location']).toContain('/login?returnTo=');
    expect(finished).toEqual([]);
  });

  it('prompt=login con mfa_at anterior a la interacción manda a reautenticar', async () => {
    const { done, response, finished } = run({
      details: details({ params: { client_id: 'client-1', prompt: 'login' } }),
      principal: principal({ mfaAt: new Date('2026-11-18T11:00:00.000Z') }),
    });
    await done;
    expect(response.headers['Location']).toBe('/sso/reauth?uid=uid-1');
    expect(finished).toEqual([]);
  });

  it('max_age vencido manda a reautenticar', async () => {
    const { done, response } = run({
      details: details({ params: { client_id: 'client-1', max_age: '10' } }),
    });
    await done;
    expect(response.headers['Location']).toBe('/sso/reauth?uid=uid-1');
  });

  it('una persona de otra organización termina en access_denied sin consultar el rango', async () => {
    const { done, finished, checkEntry } = run({ clientOrganization: 'org-2' });
    await done;
    expect(finished).toEqual([
      { error: 'access_denied', error_description: expect.any(String) as string },
    ]);
    expect(checkEntry).not.toHaveBeenCalled();
  });

  it('un rango insuficiente termina en access_denied', async () => {
    const { done, finished } = run({ entry: { allowed: false, isExternal: false } });
    await done;
    expect(finished).toEqual([
      { error: 'access_denied', error_description: expect.any(String) as string },
    ]);
  });

  it('un cliente deshabilitado o inexistente responde 400 sin detalles', async () => {
    const { done, response, finished } = run({ clientOrganization: null });
    await done;
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('Bad Request');
    expect(finished).toEqual([]);
  });

  it('una interacción desconocida o vencida responde 400 genérico', async () => {
    const { done, response } = run({ details: new Error('SessionNotFound') });
    await done;
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('Bad Request');
  });

  describe('consentimiento', () => {
    const consentDetails = details({
      prompt: { name: 'consent', details: { missingOIDCScope: ['openid'] } },
    });

    it('concede solo sin preguntar a un cliente interno', async () => {
      const { done, finished, grantAll } = run({ details: consentDetails });
      await done;
      expect(grantAll).toHaveBeenCalledTimes(1);
      expect(finished).toEqual([{ consent: { grantId: 'grant-1' } }]);
    });

    it('manda a la pantalla de consentimiento si el cliente es externo y no concede aún', async () => {
      const { done, response, finished, grantAll } = run({
        details: consentDetails,
        entry: { allowed: true, isExternal: true },
      });
      await done;
      expect(response.headers['Location']).toBe('/sso/consent?uid=uid-1');
      expect(grantAll).not.toHaveBeenCalled();
      expect(finished).toEqual([]);
    });

    it('no concede si la cuenta de la sesión del proveedor no es la de la sesión de Compass', async () => {
      const { done, response, grantAll } = run({
        details: details({
          prompt: { name: 'consent', details: {} },
          session: { accountId: 'otra-persona' },
        }),
      });
      await done;
      expect(response.statusCode).toBe(400);
      expect(grantAll).not.toHaveBeenCalled();
    });
  });
  describe('pantalla de consentimiento', () => {
    const consentDetails = details({
      prompt: { name: 'consent', details: { missingOIDCScope: ['openid', 'email'] } },
    });
    const external: InteractionEntryCheck = {
      allowed: true,
      isExternal: true,
      clientName: 'Grafana',
    };

    it('describe quién pide acceso y qué scopes, sin guardar en caché', async () => {
      const { done, response, finished } = run({
        consentAction: 'describe',
        details: consentDetails,
        entry: external,
      });
      await done;
      expect(response.statusCode).toBe(200);
      expect(response.headers['Cache-Control']).toBe('no-store');
      expect(JSON.parse(response.body)).toEqual({
        clientName: 'Grafana',
        scopes: ['openid', 'email'],
      });
      expect(finished).toEqual([]);
    });

    it('allow concede lo pedido y cierra la interacción', async () => {
      const { done, finished, grantAll } = run({
        consentAction: 'allow',
        details: consentDetails,
        entry: external,
      });
      await done;
      expect(grantAll).toHaveBeenCalledTimes(1);
      expect(finished).toEqual([{ consent: { grantId: 'grant-1' } }]);
    });

    it('deny termina en access_denied sin conceder', async () => {
      const { done, finished, grantAll } = run({
        consentAction: 'deny',
        details: consentDetails,
        entry: external,
      });
      await done;
      expect(grantAll).not.toHaveBeenCalled();
      expect(finished).toEqual([
        { error: 'access_denied', error_description: expect.any(String) as string },
      ]);
    });

    it.each([
      ['sin sesión de Compass', { token: undefined, entry: external }],
      ['un cliente interno', { entry: { allowed: true, isExternal: false } }],
      ['un rango insuficiente', { entry: { allowed: false, isExternal: true } }],
      ['otra organización', { entry: external, clientOrganization: 'org-2' }],
      [
        'una cuenta distinta en la sesión del proveedor',
        { entry: external, details: details({ ...consentDetails, session: { accountId: 'x' } }) },
      ],
      ['una interacción que no pide consentimiento', { entry: external, details: details() }],
      ['una sesión sin segundo factor', { entry: external, principal: principal({ mfaAt: null }) }],
    ] as const)('rechaza con 400 y sin conceder: %s', async (_name, scenario) => {
      const { done, response, finished, grantAll } = run({
        consentAction: 'allow',
        details: consentDetails,
        ...scenario,
      });
      await done;
      expect(response.statusCode).toBe(400);
      expect(grantAll).not.toHaveBeenCalled();
      expect(finished).toEqual([]);
    });
  });
});
