import type { OrganizationId } from '../../../../shared/kernel/index.js';

/** Fuente de correo concreta: toda operación de los puertos del sondeo se acota a una organización. */
export interface SourceRef {
  readonly organizationId: OrganizationId;
  readonly sourceId: string;
}

export interface PollCursor {
  /** `null` mientras no se haya visto el buzón. */
  readonly uidValidity: number | null;
  readonly lastUid: number;
  readonly consecutiveFailures: number;
}

/**
 * Estado del sondeo por fuente (`mail_source_poll_state`). Cada método corre en su propia transacción corta,
 * nunca abierta durante la red (ADR 0045, reglas transversales).
 */
export interface PollStateStore {
  /**
   * Reclama la fuente hasta `now + leaseMs` si nadie la tiene (arrendamiento vencido o ausente). Devuelve
   * el cursor actual, o `null` si otra pasada la tiene.
   */
  claim(source: SourceRef, now: Date, leaseMs: number): Promise<PollCursor | null>;

  /** Guarda el cursor; no libera el arrendamiento. */
  saveCursor(
    source: SourceRef,
    cursor: { readonly uidValidity: number; readonly lastUid: number },
    now: Date,
  ): Promise<void>;

  /** Libera el arrendamiento, reinicia los fallos y anota la hora del sondeo. */
  releaseAfterSuccess(source: SourceRef, now: Date): Promise<void>;

  /**
   * Libera el arrendamiento, suma un fallo y fija el siguiente intento. `errorCode` es un código acotado
   * (`^[A-Z_.]{1,64}$`), nunca texto del servidor.
   */
  releaseAfterFailure(
    source: SourceRef,
    failure: { readonly errorCode: string; readonly nextAttemptAt: Date },
    now: Date,
  ): Promise<void>;
}
