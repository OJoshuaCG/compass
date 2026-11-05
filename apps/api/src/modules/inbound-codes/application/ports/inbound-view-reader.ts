import type { ShareLevel } from '@iam/contracts';

import type { UserId } from '../../../../shared/kernel/index.js';
import type { HistoryCursor } from '../../domain/history-cursor.js';

/** Vista que se puede leer: no archivada, de una fuente activa y, si está ligada, de una cuenta activa. */
export interface ReadableView {
  readonly id: string;
  readonly sourceId: string;
}

/** Elemento `login_code` vigente de una vista, todavía cifrado. */
export interface LiveLoginCodeRecord {
  readonly itemId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
}

/** Recepción aceptada que casó con la vista. Nunca lleva asunto, remitente ni valor. */
export interface ReceiptHistoryRecord {
  readonly receiptId: string;
  readonly receivedAt: Date;
  readonly signingDomain: string | null;
  readonly templateKind: 'login_code' | 'reset_code' | 'reset_link';
}

/**
 * Lectura de una vista de códigos entrantes. Corre en la transacción en curso con la organización fijada
 * por RLS; cada método filtra en SQL, nunca en memoria (ADR 0036).
 */
export interface InboundViewReader {
  /** `null` si la vista no existe, está archivada, o su fuente está suspendida, archivada o ligada a una cuenta archivada. */
  findLiveView(viewId: string): Promise<ReadableView | null>;

  /** Nivel efectivo de la persona sobre la vista (la compartición directa y la de grupo, la mayor). */
  effectiveLevel(viewId: string, userId: UserId): Promise<ShareLevel | null>;

  /**
   * Elementos `login_code` visibles con USE que casan con la vista y no han vencido, del más reciente al más
   * antiguo. Un elemento vencido nunca se devuelve aunque la purga no haya corrido; un restablecimiento
   * (`sensitive`) nunca se devuelve por aquí.
   */
  listLiveLoginCodes(
    viewId: string,
    now: Date,
    limit: number,
  ): Promise<readonly LiveLoginCodeRecord[]>;

  /**
   * Recepciones ACEPTADAS cuya plantilla pertenece a la vista, de la más reciente a la más antigua. La
   * cuarentena pertenece a la fuente, no a la vista, y no se lista. Devuelve hasta `limit` filas.
   */
  listHistory(
    viewId: string,
    page: { readonly limit: number; readonly after: HistoryCursor | null },
  ): Promise<readonly ReceiptHistoryRecord[]>;

  /** Serializa las lecturas concurrentes de la misma persona sobre el mismo elemento (evita doble auditoría). */
  lockItemRead(userId: UserId, itemId: string): Promise<void>;
}
