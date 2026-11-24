/**
 * Política de la interacción de login (ADR 0051 §5, ADR 0052): decide qué hacer con una petición de
 * autorización que llega a Compass. Es pura: la ruta aporta los hechos (sesión, rango, reloj) y aplica el
 * resultado. Compass es la única raíz de sesión; aquí solo se decide si esa sesión basta o hay que renovarla.
 */

export interface InteractionSession {
  readonly userId: string;
  readonly organizationId: string;
  /** Último segundo factor verificado en la sesión; `null` si nunca se completó. */
  readonly mfaAt: Date | null;
}

export interface InteractionFacts {
  readonly session: InteractionSession | null;
  readonly clientOrganizationId: string;
  /** Resultado del motor de acceso para el rango máximo del cliente (`requireClientEntry`). */
  readonly entryAllowed: boolean;
  readonly now: Date;
  /** Momento en que el proveedor abrió la interacción (`iat` de la interacción). */
  readonly interactionStartedAt: Date;
  readonly promptNames: readonly string[];
  readonly maxAgeSeconds: number | null;
}

export type InteractionDecision =
  | { readonly kind: 'sign_in' }
  | { readonly kind: 'deny' }
  | { readonly kind: 'reauthenticate' }
  | { readonly kind: 'authenticated'; readonly userId: string; readonly authTimeSeconds: number };

const MILLISECONDS_PER_SECOND = 1000;

export function decideInteraction(facts: InteractionFacts): InteractionDecision {
  const { session } = facts;

  // Sin sesión, o sin segundo factor: el SSO nunca emite identidad con una sesión a medias (ADR 0051 §5).
  if (session === null || session.mfaAt === null) {
    return { kind: 'sign_in' };
  }

  // Un cliente solo recibe personas de su propia organización; el motor de acceso decide el rango.
  if (session.organizationId !== facts.clientOrganizationId || !facts.entryAllowed) {
    return { kind: 'deny' };
  }

  const mfaAtMilliseconds = session.mfaAt.getTime();

  // `prompt=login`: vale solo un segundo factor posterior a la apertura de esta interacción.
  const loginForced = facts.promptNames.includes('login');
  if (loginForced && mfaAtMilliseconds < facts.interactionStartedAt.getTime()) {
    return { kind: 'reauthenticate' };
  }

  if (facts.maxAgeSeconds !== null) {
    const ageMilliseconds = facts.now.getTime() - mfaAtMilliseconds;
    if (ageMilliseconds > facts.maxAgeSeconds * MILLISECONDS_PER_SECOND) {
      return { kind: 'reauthenticate' };
    }
  }

  return {
    kind: 'authenticated',
    userId: session.userId,
    authTimeSeconds: Math.floor(mfaAtMilliseconds / MILLISECONDS_PER_SECOND),
  };
}

/** Consentimiento (decisión 4A): solo se pregunta a la persona para clientes externos. */
export function consentRequired(isExternalClient: boolean): boolean {
  return isExternalClient;
}
