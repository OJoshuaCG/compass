import type { OrganizationId } from '../../../../shared/kernel/index.js';

/** Recorrido de organizaciones para el trabajo de fondo (ADR 0038): solo identificadores. */
export interface OrganizationLister {
  listIds(): Promise<readonly OrganizationId[]>;
}

/**
 * Borra filas efímeras vencidas de la organización en curso (la transacción ya trae `app.org_id`).
 * Cada llamada borra como máximo `limit` filas y devuelve cuántas borró.
 */
export interface ExpiredEphemeralStore {
  purgeIdempotencyKeys(expiredBefore: Date, limit: number): Promise<number>;
  purgeWebauthnChallenges(expiredBefore: Date, limit: number): Promise<number>;
}

/**
 * Destruye físicamente, en la organización en curso, las versiones de secreto del segundo factor
 * (`credential_secrets.field = 'totp_uri'`) que fueron reemplazadas por un re-registro hace más de
 * `replacedBefore`. Nunca toca la versión vigente. Cada llamada borra como máximo `limit` filas y
 * devuelve cuántas borró. No descifra nada: solo borra filas.
 */
export interface ReplacedTotpSecretStore {
  purgeReplacedTotpSecrets(replacedBefore: Date, limit: number): Promise<number>;
}

/** Lo que borró un lote de la retención del outbox. */
export interface OutboxRetentionBatchResult {
  /** Eventos publicados borrados; el recorrido continúa mientras un lote llegue lleno. */
  readonly events: number;
  /** Acuses de entrega de esos eventos, borrados antes que ellos. */
  readonly deliveries: number;
}

/**
 * Borra, en la organización en curso, los eventos del outbox publicados antes de `publishedBefore` y sus
 * acuses de entrega (`outbox_deliveries`). Solo toca eventos con `published_at` no nulo: nunca los pendientes
 * ni los de cuarentena (`published_at` nulo y `next_attempt_at = 'infinity'`). Cada llamada procesa como
 * máximo `limit` eventos. No lee el contenido (`payload`).
 */
export interface OutboxRetentionStore {
  purgePublishedEvents(publishedBefore: Date, limit: number): Promise<OutboxRetentionBatchResult>;
}
