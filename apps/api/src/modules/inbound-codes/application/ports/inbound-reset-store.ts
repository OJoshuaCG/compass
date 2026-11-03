import type { ResetRevealNoticePayload } from '../../domain/reset-reveal-notice.js';

/** Restablecimiento (código o enlace) vigente de una vista, todavía cifrado. */
export interface LiveResetRecord {
  readonly itemId: string;
  readonly kind: 'reset_code' | 'reset_link';
  readonly valueType: 'code' | 'link';
  readonly expiresAt: Date;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
}

/**
 * Acceso a los restablecimientos (`sensitive`) de una vista. Es un puerto aparte del lector de códigos a
 * propósito: la lectura con USE no puede, ni por error, alcanzar un restablecimiento. Corre en la transacción
 * en curso con la organización fijada por RLS.
 */
export interface InboundResetStore {
  /**
   * Restablecimientos vigentes que casan con la vista (plantilla de la vista y elemento de SU fuente), del más
   * reciente al más antiguo, hasta `limit`. Lo vencido no se devuelve aunque la purga no haya corrido.
   */
  listLiveResets(viewId: string, now: Date, limit: number): Promise<readonly LiveResetRecord[]>;

  /** Encola el aviso a la Raíz en la transacción en curso: sin revelación no hay aviso y viceversa. */
  enqueueRevealNotice(notice: ResetRevealNoticePayload): Promise<void>;
}
