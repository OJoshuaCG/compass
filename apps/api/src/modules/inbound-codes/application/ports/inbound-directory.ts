import type { ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';
import type { SourceRecord } from './inbound-configuration-repository.js';

/** Vista legible por la persona, con lo justo para elegirla. Sin la dirección de la fuente ni la cuenta. */
export interface ReadableViewSummary {
  readonly id: string;
  readonly name: string;
  readonly sourceId: string;
  readonly sourceDisplayName: string;
  readonly channel: 'mail' | 'sms';
  readonly level: ShareLevel;
}

/** Vista no archivada, de una fuente no archivada, sobre la que la persona tiene un nivel efectivo. */
export interface ConfigurableViewSummary {
  readonly id: string;
  readonly sourceId: string;
  readonly name: string;
  readonly templateIds: readonly string[];
  readonly createdAt: Date;
  readonly level: ShareLevel;
}

/** Plantilla vigente de la organización: lo justo para referenciarla desde una vista. */
export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: 'login_code' | 'reset_code' | 'reset_link';
}

/** Fuente no archivada sobre la que la persona tiene un nivel efectivo. */
export interface ConfigurableSourceSummary extends SourceRecord {
  readonly level: ShareLevel;
}

/**
 * Directorio de fuentes y vistas de una persona. Corre en la transacción en curso con la organización fijada
 * por RLS; el filtro por acceso efectivo va en SQL, nunca en memoria (ADR 0036).
 */
export interface InboundDirectory {
  /**
   * Vistas que se pueden leer hoy (mismo criterio que `InboundViewReader.findLiveView`) sobre las que la
   * persona tiene un nivel, ordenadas por nombre e identificador. Devuelve hasta `limit` filas.
   */
  listReadableViews(userId: UserId, limit: number): Promise<readonly ReadableViewSummary[]>;

  /**
   * Fuentes no archivadas (activas o suspendidas) sobre las que la persona tiene un nivel, ordenadas por
   * nombre visible e identificador. Devuelve hasta `limit` filas.
   */
  listConfigurableSources(
    userId: UserId,
    limit: number,
  ): Promise<readonly ConfigurableSourceSummary[]>;

  /**
   * Vistas no archivadas de fuentes no archivadas (activas o suspendidas) sobre las que la persona tiene un
   * nivel, con sus plantillas ordenadas por identificador, ordenadas por nombre e identificador. Devuelve
   * hasta `limit` filas.
   */
  listConfigurableViews(
    userId: UserId,
    limit: number,
  ): Promise<readonly ConfigurableViewSummary[]>;

  /** Plantillas vigentes (no archivadas) de la organización, ordenadas por nombre e identificador. */
  listLiveTemplates(limit: number): Promise<readonly TemplateSummary[]>;
}
