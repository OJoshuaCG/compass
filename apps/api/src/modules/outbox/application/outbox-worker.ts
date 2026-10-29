import type { Clock, IdGenerator, OrganizationId } from '../../../shared/kernel/index.js';
import type { TenantScope } from '../../organization/index.js';
import { OUTBOX_FAILURE_CODES } from '../domain/outbox-event.js';
import type { OutboxEvent, OutboxEventHandler, OutboxFailureCode } from '../domain/outbox-event.js';
import {
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_HANDLER_TIMEOUT_MS,
  computeBackoffMs,
  hasExhaustedAttempts,
} from '../domain/retry-policy.js';
import type { OutboxHandlerRegistry } from './handler-registry.js';
import type { OutboxLogger, OutboxOrganizationSource } from './ports/outbox-ports.js';
import type { OutboxRepository } from './ports/outbox-repository.js';

/** Tope de eventos por organización y por pasada: una organización con cola larga no acapara el ciclo. */
export const OUTBOX_MAX_EVENTS_PER_ORGANIZATION_PER_RUN = 100;

export type OutboxOutcome =
  'published' | 'retry_scheduled' | 'dead_lettered' | 'deferred_unknown_type';

export interface OutboxRunSummary {
  readonly published: number;
  readonly retryScheduled: number;
  readonly deadLettered: number;
  /** Eventos sin manejador registrado: se pospusieron sin contar intentos ni entrar en cuarentena. */
  readonly deferredUnknownType: number;
  /** Organizaciones cuya pasada falló por un error de infraestructura; las demás se procesaron igual. */
  readonly failedOrganizations: number;
}

interface Dependencies {
  readonly organizations: OutboxOrganizationSource;
  readonly repository: OutboxRepository;
  readonly scope: TenantScope;
  readonly handlers: OutboxHandlerRegistry;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly logger: OutboxLogger;
}

export interface OutboxRunOptions {
  /**
   * Se consulta entre eventos y entre organizaciones. Si devuelve `true` la pasada termina sin
   * tomar más trabajo, de modo que el apagado espera como máximo al evento en curso.
   */
  readonly isStopping?: () => boolean;
}

/** Estado de una pasada: los conteos y, por tipo, cuántos eventos quedaron esperando manejador. */
interface PassState {
  readonly tally: {
    published: number;
    retryScheduled: number;
    deadLettered: number;
    deferredUnknownType: number;
    failedOrganizations: number;
  };
  readonly unknownTypeCounts: Map<string, number>;
  readonly isStopping: () => boolean;
}

/** El manejador no terminó dentro de `OUTBOX_HANDLER_TIMEOUT_MS`. */
class HandlerTimeoutError extends Error {
  constructor() {
    super('Outbox handler timed out');
    this.name = 'HandlerTimeoutError';
  }
}

/** El evento reclamado no pertenece a la organización del ámbito: no se procesa. */
class OrganizationMismatchError extends Error {
  constructor(
    readonly eventId: string,
    readonly eventOrganizationId: OrganizationId,
    readonly scopeOrganizationId: OrganizationId,
  ) {
    super('Outbox event does not belong to the scoped organization');
    this.name = 'OrganizationMismatchError';
  }
}

/** El manejador lanzó: se usa para salir de la transacción (y revertirla) sin perder qué evento era. */
class HandlerExecutionFailure extends Error {
  constructor(
    readonly event: OutboxEvent,
    readonly handlerError: unknown,
  ) {
    super('Outbox handler failed');
    this.name = 'HandlerExecutionFailure';
  }
}

/**
 * Publica los eventos de `outbox_events` (ADR 0035): entrega al menos una vez, reintentos con
 * espera exponencial y cuarentena tras agotar los intentos.
 *
 * Cada evento se procesa en SU PROPIA transacción y con el `app.org_id` de SU organización
 * (`TenantScope.runAs`, igual que la purga de efímeros, ADR 0038). Se eligió esto y no un rol con
 * BYPASSRLS ni un reclamo global porque así el manejador solo puede leer datos de la organización
 * del evento: un manejador defectuoso o comprometido no puede cruzar inquilinos. Además el efecto
 * del manejador y la marca de "publicado" se confirman juntos: si el manejador falla, nada queda a medias.
 */
export class OutboxWorker {
  constructor(private readonly deps: Dependencies) {}

  async runOnce(options: OutboxRunOptions = {}): Promise<OutboxRunSummary> {
    const state: PassState = {
      tally: {
        published: 0,
        retryScheduled: 0,
        deadLettered: 0,
        deferredUnknownType: 0,
        failedOrganizations: 0,
      },
      unknownTypeCounts: new Map<string, number>(),
      isStopping: options.isStopping ?? (() => false),
    };
    const organizationIds = await this.deps.organizations.listIds();

    for (const organizationId of organizationIds) {
      if (state.isStopping()) break;
      try {
        await this.drainOrganization(organizationId, state);
      } catch (error) {
        // Una organización con problemas de base de datos no debe frenar a las demás.
        state.tally.failedOrganizations += 1;
        this.deps.logger.error(
          { organizationId, outcome: 'organization_failed', errorName: errorNameOf(error) },
          'outbox pass failed for an organization',
        );
      }
    }
    this.logUnknownTypes(state.unknownTypeCounts);
    return state.tally;
  }

  private async drainOrganization(organizationId: OrganizationId, state: PassState): Promise<void> {
    for (let handled = 0; handled < OUTBOX_MAX_EVENTS_PER_ORGANIZATION_PER_RUN; handled += 1) {
      if (state.isStopping()) return;
      const outcome = await this.processNext(organizationId, state);
      if (outcome === null) return;
      if (outcome === 'published') state.tally.published += 1;
      if (outcome === 'retry_scheduled') state.tally.retryScheduled += 1;
      if (outcome === 'dead_lettered') state.tally.deadLettered += 1;
      if (outcome === 'deferred_unknown_type') state.tally.deferredUnknownType += 1;
    }
  }

  /** Procesa un evento de la organización; `null` si no hay ninguno listo. */
  private async processNext(
    organizationId: OrganizationId,
    state: PassState,
  ): Promise<OutboxOutcome | null> {
    const now = this.deps.clock.now();
    try {
      return await this.deps.scope.runAs(this.scopeFor(organizationId), async () => {
        const event = await this.deps.repository.claimNext(now);
        if (event === null) return null;

        // Defensa en profundidad: RLS ya limita el reclamo a la organización fijada, pero si
        // alguna vez dejara de hacerlo, un evento ajeno no debe llegar a ningún manejador.
        if (event.organizationId !== organizationId) {
          throw new OrganizationMismatchError(event.id, event.organizationId, organizationId);
        }

        const handler = this.deps.handlers.find(event.type);
        if (handler === undefined) {
          return this.deferUnknownType(event, now, state);
        }

        try {
          await this.runHandlerWithTimeout(handler, event);
        } catch (error) {
          // Se relanza para revertir lo que el manejador haya escrito; el fallo se anota fuera.
          throw new HandlerExecutionFailure(event, error);
        }
        await this.deps.repository.markPublished(event.id, now);
        this.logOutcome(event, 'published', null);
        return 'published' as const;
      });
    } catch (error) {
      if (error instanceof OrganizationMismatchError) {
        // Solo identificadores: nada del contenido del evento.
        this.deps.logger.error(
          {
            eventId: error.eventId,
            eventOrganizationId: error.eventOrganizationId,
            scopeOrganizationId: error.scopeOrganizationId,
            outcome: 'organization_mismatch',
          },
          'outbox event does not belong to the scoped organization',
        );
        // Se propaga: `runOnce` lo cuenta como organización fallida.
        throw error;
      }
      if (!(error instanceof HandlerExecutionFailure)) throw error;
      const failureCode =
        error.handlerError instanceof HandlerTimeoutError
          ? OUTBOX_FAILURE_CODES.handlerTimeout
          : OUTBOX_FAILURE_CODES.handlerFailed;
      // El intento se anota en una transacción nueva: la anterior se revirtió junto con el manejador.
      return this.deps.scope.runAs(this.scopeFor(organizationId), () =>
        this.recordFailure(error.event, failureCode, now, error.handlerError),
      );
    }
  }

  /**
   * Compite el manejador contra el plazo por evento. Si vence, el fallo revierte la transacción.
   * Limitación conocida: JavaScript no puede cancelar el manejador, que puede seguir ejecutándose
   * en segundo plano; por eso debe ser idempotente y sus errores tardíos se descartan aquí.
   */
  private async runHandlerWithTimeout(
    handler: OutboxEventHandler,
    event: OutboxEvent,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new HandlerTimeoutError());
      }, OUTBOX_HANDLER_TIMEOUT_MS);
    });
    // `then` captura también un manejador que lance de forma síncrona.
    const execution = Promise.resolve().then(() => handler(event));
    // Si el plazo gana y el manejador rechaza después, evita un rechazo sin atender.
    execution.catch(() => undefined);
    try {
      await Promise.race([execution, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Un evento sin manejador (p. ej. escrito antes de que su manejador exista) no es un fallo: se
   * deja pendiente, sin contar intento, y se vuelve a mirar en `OUTBOX_BACKOFF_CAP_MS`. Así no se
   * pierde por llegar a la cuarentena mientras el despliegue añade el manejador.
   */
  private async deferUnknownType(
    event: OutboxEvent,
    now: Date,
    state: PassState,
  ): Promise<OutboxOutcome> {
    const nextAttemptAt = new Date(now.getTime() + OUTBOX_BACKOFF_CAP_MS);
    await this.deps.repository.deferWithoutAttempt(event.id, nextAttemptAt);
    state.unknownTypeCounts.set(event.type, (state.unknownTypeCounts.get(event.type) ?? 0) + 1);
    return 'deferred_unknown_type';
  }

  /** Una línea por tipo y pasada, solo con el nombre del tipo y el conteo. */
  private logUnknownTypes(unknownTypeCounts: ReadonlyMap<string, number>): void {
    for (const [type, count] of unknownTypeCounts) {
      this.deps.logger.warn(
        {
          type,
          count,
          outcome: 'deferred_unknown_type',
          errorCode: OUTBOX_FAILURE_CODES.unknownType,
        },
        'outbox events wait for a handler that is not registered',
      );
    }
  }

  private async recordFailure(
    event: OutboxEvent,
    code: OutboxFailureCode,
    now: Date,
    cause?: unknown,
  ): Promise<OutboxOutcome> {
    const failedAttempts = event.attempts + 1;
    if (hasExhaustedAttempts(failedAttempts)) {
      await this.deps.repository.markDeadLettered(event.id, failedAttempts);
      this.logOutcome(event, 'dead_lettered', code, cause);
      return 'dead_lettered';
    }
    const nextAttemptAt = new Date(now.getTime() + computeBackoffMs(failedAttempts));
    await this.deps.repository.scheduleRetry(event.id, failedAttempts, nextAttemptAt);
    this.logOutcome(event, 'retry_scheduled', code, cause);
    return 'retry_scheduled';
  }

  /** Solo identificadores y resultado: jamás `payload` ni el mensaje del error del manejador. */
  private logOutcome(
    event: OutboxEvent,
    outcome: OutboxOutcome,
    code: OutboxFailureCode | null,
    cause?: unknown,
  ): void {
    const fields = {
      eventId: event.id,
      type: event.type,
      organizationId: event.organizationId,
      attempt: event.attempts + 1,
      outcome,
      ...(code === null ? {} : { errorCode: code }),
      ...(cause === undefined ? {} : { errorName: errorNameOf(cause) }),
    };
    if (outcome === 'published') this.deps.logger.info(fields, 'outbox event published');
    else if (outcome === 'retry_scheduled') this.deps.logger.warn(fields, 'outbox event failed');
    else this.deps.logger.error(fields, 'outbox event dead-lettered');
  }

  private scopeFor(organizationId: OrganizationId) {
    return { organizationId, actorId: null, requestId: this.deps.ids.next() };
  }
}

/** Solo el nombre de la clase: el mensaje del error puede arrastrar datos del evento. */
function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
