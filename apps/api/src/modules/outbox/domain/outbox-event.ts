import type { OrganizationId } from '../../../shared/kernel/index.js';

/**
 * Evento tal como lo ve el trabajador. `payload` puede traer datos sensibles (direcciones, ids de
 * usuarios, motivos): solo se entrega al manejador y NUNCA se escribe en un registro ni en un error.
 */
export interface OutboxEvent {
  /** UUIDv7 del evento: es la clave de idempotencia de los manejadores (entrega al menos una vez). */
  readonly id: string;
  readonly organizationId: OrganizationId;
  readonly aggregate: string;
  readonly type: string;
  readonly payload: unknown;
  /** Intentos fallidos previos; 0 en la primera entrega. */
  readonly attempts: number;
}

/**
 * Un manejador debe ser idempotente por `event.id`: un evento puede entregarse más de una vez
 * (caída entre el efecto y la marca de publicado). Corre dentro de una transacción con el
 * `app.org_id` de la organización del evento; si lanza, esa transacción se revierte.
 */
export type OutboxEventHandler = (event: OutboxEvent) => Promise<void>;

/** Códigos estables de fallo. Solo se registran en el log; no llegan a ningún cliente. */
export const OUTBOX_FAILURE_CODES = {
  /** No hay manejador registrado para el tipo (p. ej. despliegue a medias). */
  unknownType: 'OUTBOX.UNKNOWN_TYPE',
  /** El manejador lanzó un error. */
  handlerFailed: 'OUTBOX.HANDLER_FAILED',
  /** El manejador no terminó dentro del plazo por evento (`OUTBOX_HANDLER_TIMEOUT_MS`). */
  handlerTimeout: 'OUTBOX.HANDLER_TIMEOUT',
} as const;

export type OutboxFailureCode = (typeof OUTBOX_FAILURE_CODES)[keyof typeof OUTBOX_FAILURE_CODES];
