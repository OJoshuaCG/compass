/**
 * Interacciones de login y consentimiento del proveedor OIDC (ADR 0051 §5, ADR 0052).
 *
 * Invariantes de seguridad
 * - Compass es la única raíz de sesión: aquí nunca se crea una sesión nueva; solo se traduce la sesión de
 *   Compass (cookie `__Host-session`) a la identidad que el proveedor firma.
 * - Sin sesión o sin segundo factor no se emite identidad: se manda a `/login`. Un cliente solo recibe
 *   personas de su organización y dentro de su rango máximo; lo demás termina en `access_denied`.
 * - Las llamadas al adaptador PG corren bajo el contexto ambiente de la sesión validada, de modo que la fila
 *   de la interacción debe pertenecer a esa misma sesión de Compass (L8).
 * - Un identificador de interacción inválido o vencido nunca revela detalles: respuesta 400 genérica.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { InteractionDetails } from 'oidc-provider';

import type { OidcAmbientContext } from '../application/ports/oidc-ambient.js';
import type { InteractionProvider } from '../application/ports/oidc-interaction-provider.js';
import { consentRequired, decideInteraction } from '../domain/interaction-policy.js';

/** Nivel de garantía que Compass declara: la sesión pasó por contraseña y segundo factor (ADR 0051 §5). */
export const COMPASS_MFA_ACR = 'urn:compass:acr:mfa';
export const COMPASS_MFA_AMR: readonly string[] = ['mfa'];

export const OIDC_INTERACTION_PATH_PREFIX = '/oidc/interaction';

const LOGIN_PATH = '/login';
const SSO_REAUTH_PATH = '/sso/reauth';
const SSO_CONSENT_PATH = '/sso/consent';

const HTTP_FOUND = 302;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

export interface InteractionPrincipal {
  readonly sessionId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly mfaAt: Date | null;
}

export interface InteractionEntryCheck {
  readonly allowed: boolean;
  readonly isExternal: boolean;
  /** Nombre que la persona ve en la pantalla de consentimiento. */
  readonly clientName?: string;
}

/** Lo que la pantalla de consentimiento muestra: quién pide acceso y a qué. */
export interface ConsentDescription {
  readonly clientName: string;
  readonly scopes: readonly string[];
}

export type ConsentAction = 'describe' | 'allow' | 'deny';

export interface OidcInteractionDeps {
  readonly provider: InteractionProvider<IncomingMessage, ServerResponse>;
  readonly authenticate: (token: string, requestId: string) => Promise<InteractionPrincipal | null>;
  /** Organización dueña de un cliente ACTIVO, o `null` si no existe o está deshabilitado. */
  readonly resolveClientOrganization: (clientId: string) => Promise<string | null>;
  /** Rango máximo del cliente contra el motor de acceso, con la auditoría de negaciones de siempre. */
  readonly checkEntry: (
    principal: InteractionPrincipal,
    clientId: string,
    requestId: string,
  ) => Promise<InteractionEntryCheck>;
  readonly runWithAmbient: <T>(context: OidcAmbientContext, fn: () => Promise<T>) => Promise<T>;
  readonly now: () => Date;
}

export interface InteractionRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly uid: string;
  readonly sessionToken: string | undefined;
  readonly requestId: string;
}

export const interactionPath = (uid: string): string =>
  `${OIDC_INTERACTION_PATH_PREFIX}/${encodeURIComponent(uid)}`;

const redirect = (response: ServerResponse, location: string): void => {
  response.statusCode = HTTP_FOUND;
  response.setHeader('Location', location);
  response.setHeader('Content-Length', '0');
  response.end();
};

const badRequest = (response: ServerResponse): void => {
  response.statusCode = HTTP_BAD_REQUEST;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end('Bad Request');
};

const readPromptNames = (params: InteractionDetails['params']): readonly string[] => {
  const prompt = params['prompt'];
  return typeof prompt === 'string' ? prompt.split(' ').filter((name) => name !== '') : [];
};

/** Scopes que el cliente pide y la persona aún no concedió, como los reporta el proveedor. */
const readMissingScopes = (details: InteractionDetails): readonly string[] => {
  const missing = details.prompt.details['missingOIDCScope'];
  return Array.isArray(missing)
    ? missing.filter((scope): scope is string => typeof scope === 'string')
    : [];
};

const readMaxAgeSeconds = (params: InteractionDetails['params']): number | null => {
  const raw = params['max_age'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
};

export class OidcInteractionHandler {
  constructor(private readonly deps: OidcInteractionDeps) {}

  /**
   * Ejecuta `work` (la entrega de una petición al proveedor) bajo el contexto ambiente de la sesión de Compass
   * cuando la cookie es válida; sin ella, `work` corre sin contexto y el adaptador rechaza lo que lo necesite.
   * Es lo que permite al proveedor guardar su sesión al reanudar la autorización tras el login (L8).
   */
  async runUnderCompassSession(
    sessionToken: string | undefined,
    requestId: string,
    work: () => void,
  ): Promise<void> {
    let principal: InteractionPrincipal | null = null;
    if (sessionToken !== undefined && sessionToken !== '') {
      try {
        principal = await this.deps.authenticate(sessionToken, requestId);
      } catch {
        principal = null;
      }
    }
    if (principal === null) {
      work();
      return;
    }
    const validated = principal;
    await this.deps.runWithAmbient(
      {
        organizationId: validated.organizationId,
        compassSessionId: validated.sessionId,
        userId: validated.userId,
      },
      () => {
        work();
        return Promise.resolve();
      },
    );
  }

  /**
   * Pantalla de consentimiento de un cliente externo (ADR 0052, decisión 4A). `describe` devuelve lo que se
   * muestra; `allow` y `deny` cierran la interacción. Solo vale con la sesión de Compass que inició la
   * interacción y solo para un cliente externo en el rango permitido: cualquier otra cosa es un 400 genérico.
   */
  async handleConsent(input: InteractionRequest, action: ConsentAction): Promise<void> {
    const { response } = input;
    try {
      const principal =
        input.sessionToken === undefined || input.sessionToken === ''
          ? null
          : await this.deps.authenticate(input.sessionToken, input.requestId);
      if (principal === null) {
        badRequest(response);
        return;
      }
      await this.deps.runWithAmbient(
        {
          organizationId: principal.organizationId,
          compassSessionId: principal.sessionId,
          userId: principal.userId,
        },
        () => this.handleConsentWithSession(input, principal, action),
      );
    } catch {
      if (!response.headersSent) badRequest(response);
    }
  }

  private async handleConsentWithSession(
    input: InteractionRequest,
    principal: InteractionPrincipal,
    action: ConsentAction,
  ): Promise<void> {
    const { provider } = this.deps;
    const { request, response } = input;
    const details = await provider.interactionDetails(request, response);
    const clientId = details.params['client_id'];
    if (typeof clientId !== 'string' || details.prompt.name !== 'consent') {
      badRequest(response);
      return;
    }
    // La cuenta de la sesión del proveedor debe ser la de la sesión de Compass, igual que al conceder.
    if (details.session?.accountId !== principal.userId) {
      badRequest(response);
      return;
    }
    const clientOrganizationId = await this.deps.resolveClientOrganization(clientId);
    if (clientOrganizationId === null || clientOrganizationId !== principal.organizationId) {
      badRequest(response);
      return;
    }
    const entry = await this.deps.checkEntry(principal, clientId, input.requestId);
    // Un cliente interno nunca pasa por esta pantalla: se concede solo. Tampoco se pregunta a quien no puede entrar.
    if (!entry.allowed || !consentRequired(entry.isExternal)) {
      badRequest(response);
      return;
    }

    if (action === 'describe') {
      const description: ConsentDescription = {
        clientName: entry.clientName ?? clientId,
        scopes: readMissingScopes(details),
      };
      response.statusCode = HTTP_OK;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(description));
      return;
    }
    if (action === 'deny') {
      await provider.interactionFinished(request, response, {
        error: 'access_denied',
        error_description: 'The person denied the request',
      });
      return;
    }
    const grantId = await provider.grantAll(details, principal.userId, clientId);
    await provider.interactionFinished(request, response, { consent: { grantId } });
  }

  async handle(input: InteractionRequest): Promise<void> {
    const { response } = input;
    try {
      const principal =
        input.sessionToken === undefined || input.sessionToken === ''
          ? null
          : await this.deps.authenticate(input.sessionToken, input.requestId);
      if (principal === null) {
        await this.handleWithoutSession(input);
        return;
      }
      await this.deps.runWithAmbient(
        {
          organizationId: principal.organizationId,
          compassSessionId: principal.sessionId,
          userId: principal.userId,
        },
        () => this.handleWithSession(input, principal),
      );
    } catch {
      // Interacción desconocida, vencida o de otra sesión: nunca se explica el motivo al navegador.
      if (!response.headersSent) badRequest(response);
    }
  }

  /** Sin sesión de Compass solo se puede mandar a iniciar sesión; la interacción debe existir. */
  private async handleWithoutSession(input: InteractionRequest): Promise<void> {
    await this.deps.provider.interactionDetails(input.request, input.response);
    redirect(
      input.response,
      `${LOGIN_PATH}?returnTo=${encodeURIComponent(interactionPath(input.uid))}`,
    );
  }

  private async handleWithSession(
    input: InteractionRequest,
    principal: InteractionPrincipal,
  ): Promise<void> {
    const { provider } = this.deps;
    const { request, response } = input;
    const details = await provider.interactionDetails(request, response);

    const clientIdParameter = details.params['client_id'];
    if (typeof clientIdParameter !== 'string') {
      badRequest(response);
      return;
    }
    const clientOrganizationId = await this.deps.resolveClientOrganization(clientIdParameter);
    if (clientOrganizationId === null) {
      badRequest(response);
      return;
    }

    const sameOrganization = principal.organizationId === clientOrganizationId;
    // El rango solo se consulta para personas de la organización del cliente: es la regla más barata y evita
    // auditar como negación del rango lo que en realidad es un cliente ajeno.
    const entry: InteractionEntryCheck = sameOrganization
      ? await this.deps.checkEntry(principal, clientIdParameter, input.requestId)
      : { allowed: false, isExternal: false };

    const decision = decideInteraction({
      session: {
        userId: principal.userId,
        organizationId: principal.organizationId,
        mfaAt: principal.mfaAt,
      },
      clientOrganizationId,
      entryAllowed: entry.allowed,
      now: this.deps.now(),
      interactionStartedAt: new Date(details.iat * 1000),
      promptNames: readPromptNames(details.params),
      maxAgeSeconds: readMaxAgeSeconds(details.params),
    });

    switch (decision.kind) {
      case 'sign_in':
        redirect(
          response,
          `${LOGIN_PATH}?returnTo=${encodeURIComponent(interactionPath(input.uid))}`,
        );
        return;
      case 'reauthenticate':
        redirect(response, `${SSO_REAUTH_PATH}?uid=${encodeURIComponent(input.uid)}`);
        return;
      case 'deny':
        await provider.interactionFinished(request, response, {
          error: 'access_denied',
          error_description: 'The person is not allowed to use this application',
        });
        return;
      case 'authenticated':
        await this.finishAuthenticated(input, details, principal, entry, decision.authTimeSeconds);
        return;
    }
  }

  private async finishAuthenticated(
    input: InteractionRequest,
    details: InteractionDetails,
    principal: InteractionPrincipal,
    entry: InteractionEntryCheck,
    authTimeSeconds: number,
  ): Promise<void> {
    const { provider } = this.deps;
    const { request, response } = input;

    if (details.prompt.name === 'login') {
      await provider.interactionFinished(request, response, {
        login: {
          accountId: principal.userId,
          acr: COMPASS_MFA_ACR,
          amr: COMPASS_MFA_AMR,
          ts: authTimeSeconds,
        },
      });
      return;
    }

    if (details.prompt.name === 'consent') {
      // La cuenta de la sesión del proveedor debe ser la de la sesión de Compass: nunca se concede por otra.
      if (details.session?.accountId !== principal.userId) {
        badRequest(response);
        return;
      }
      if (consentRequired(entry.isExternal)) {
        redirect(response, `${SSO_CONSENT_PATH}?uid=${encodeURIComponent(input.uid)}`);
        return;
      }
      const clientId = details.params['client_id'];
      if (typeof clientId !== 'string') {
        badRequest(response);
        return;
      }
      const grantId = await provider.grantAll(details, principal.userId, clientId);
      await provider.interactionFinished(request, response, { consent: { grantId } });
      return;
    }

    badRequest(response);
  }
}
