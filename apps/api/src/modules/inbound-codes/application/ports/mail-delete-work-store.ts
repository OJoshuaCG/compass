import type { SourceRef } from './poll-state-store.js';

/** Petición pendiente tal como la ve el worker: solo lo necesario para borrar, sin personas ni contenido. */
export interface PendingMailDelete {
  readonly requestId: string;
  readonly mailboxUidValidity: number;
  readonly mailboxUid: number;
}

/** Resultado acotado que queda en la fila; nunca texto del servidor. */
export const MAIL_DELETE_RESULT_CODES = [
  'DELETED',
  'NOT_FOUND',
  'POSITION_CHANGED',
  'UNSUPPORTED',
  'CONNECTION',
  'CONNECTION_MISSING',
  'UNEXPECTED',
] as const;
export type MailDeleteResultCode = (typeof MAIL_DELETE_RESULT_CODES)[number];

/** Lado del worker de las peticiones de borrado: descubre, lee lo pendiente y cierra con el resultado. */
export interface MailDeleteWorkStore {
  /** Fuentes de correo activas con alguna petición pendiente, de cualquier organización. */
  listSourcesWithPending(): Promise<readonly SourceRef[]>;

  /** Pendientes de la fuente, de la más antigua a la más reciente, hasta `limit`. */
  listPending(source: SourceRef, limit: number): Promise<readonly PendingMailDelete[]>;

  /**
   * Cierra la petición con su resultado. Solo surte efecto si sigue pendiente: si otra pasada ya la cerró,
   * no se pisa su resultado.
   */
  close(
    source: SourceRef,
    requestId: string,
    resultCode: MailDeleteResultCode,
    now: Date,
  ): Promise<void>;
}
