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
}
