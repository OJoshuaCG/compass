/**
 * Idempotencia de las peticiones que crean recursos.
 *
 * Invariantes de seguridad
 * - La clave es por organización y por actor: nadie puede reproducir ni leer la respuesta de otro.
 * - Una clave solo vale para la misma petición (misma huella); con otra petición se rechaza.
 * - La respuesta guardada se conserva 24 horas; mientras la original corre, la reserva dura poco
 *   (un minuto) para que una petición caída no bloquee la clave todo el día.
 * - Solo se guardan respuestas correctas: un error libera la clave y el reintento vuelve a ejecutarse.
 * - Cada paso usa su propia transacción corta; nunca envuelve a la transacción del caso de uso.
 */
import { DomainError } from '../../../shared/kernel/index.js';
import type { Clock, OrganizationId, UserId } from '../../../shared/kernel/index.js';
import type { CryptoPrimitives } from '../../crypto/index.js';
import type { TenantScope } from '../../organization/index.js';
import type { IdempotencyStore } from './ports/idempotency-store.js';

export const REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const IN_FLIGHT_MS = 60 * 1000;

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export type IdempotencyDecision =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'replay'; readonly statusCode: number; readonly body: unknown };

export interface IdempotencyCall {
  readonly organizationId: OrganizationId;
  readonly actorId: UserId;
  readonly requestId: string;
  readonly key: string;
}

const encoder = new TextEncoder();
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export class IdempotencyService {
  constructor(
    private readonly deps: {
      readonly scope: TenantScope;
      readonly store: IdempotencyStore;
      readonly primitives: CryptoPrimitives;
      readonly clock: Clock;
    },
  ) {}

  /** Valida la clave recibida; lanza el error de dominio si falta o es inválida. */
  parseKey(header: string | string[] | undefined): string {
    if (typeof header !== 'string' || !KEY_PATTERN.test(header)) {
      throw new DomainError('IDEMPOTENCY.KEY_REQUIRED', 'A valid Idempotency-Key is required');
    }
    return header;
  }

  /** Huella de la petición: método, ruta y cuerpo. */
  fingerprint(method: string, path: string, body: unknown): string {
    const text = `${method}\n${path}\n${JSON.stringify(body ?? null)}`;
    return toHex(this.deps.primitives.sha256(encoder.encode(text)));
  }

  begin(call: IdempotencyCall, requestHash: string): Promise<IdempotencyDecision> {
    const { scope, store, clock } = this.deps;
    return scope.runAs(this.contextOf(call), async () => {
      const now = clock.now();
      const expiresAt = new Date(now.getTime() + IN_FLIGHT_MS);
      if (await store.reserve({ actorId: call.actorId, key: call.key, requestHash, expiresAt })) {
        return { kind: 'proceed' };
      }
      const existing = await store.find(call.actorId, call.key);
      if (existing === null) return { kind: 'proceed' }; // la liberó otra petición entre medias
      if (existing.expiresAt <= now) {
        await store.takeOver({ actorId: call.actorId, key: call.key, requestHash, expiresAt });
        return { kind: 'proceed' };
      }
      if (existing.requestHash !== requestHash) {
        throw new DomainError('IDEMPOTENCY.KEY_REUSED', 'Key already used by another request');
      }
      if (existing.statusCode === null) {
        throw new DomainError('IDEMPOTENCY.IN_PROGRESS', 'The original request is in progress');
      }
      return { kind: 'replay', statusCode: existing.statusCode, body: existing.body };
    });
  }

  complete(call: IdempotencyCall, statusCode: number, body: unknown): Promise<void> {
    const { scope, store, clock } = this.deps;
    return scope.runAs(this.contextOf(call), () =>
      store.complete({
        actorId: call.actorId,
        key: call.key,
        statusCode,
        body: body ?? null,
        expiresAt: new Date(clock.now().getTime() + REPLAY_WINDOW_MS),
      }),
    );
  }

  release(call: IdempotencyCall): Promise<void> {
    return this.deps.scope.runAs(this.contextOf(call), () =>
      this.deps.store.release(call.actorId, call.key),
    );
  }

  private contextOf(call: IdempotencyCall) {
    return {
      organizationId: call.organizationId,
      actorId: call.actorId,
      requestId: call.requestId,
    };
  }
}
