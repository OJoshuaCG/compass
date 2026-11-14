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
  'EXPIRED',
] as const;
export type MailDeleteResultCode = (typeof MAIL_DELETE_RESULT_CODES)[number];

/** Una petición pendiente más vieja que esto ya no se ejecuta: la persona debe volver a pedirla. */
export const MAIL_DELETE_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** Lado del worker de las peticiones de borrado: descubre, lee lo pendiente y cierra con el resultado. */
export interface MailDeleteWorkStore {
  /** Fuentes de correo activas con alguna petición pendiente, de cualquier organización. */
  listSourcesWithPending(): Promise<readonly SourceRef[]>;

  /** Fuentes (activas o no) con alguna petición pendiente pedida antes de `cutoff`. */
  listSourcesWithStale(cutoff: Date): Promise<readonly SourceRef[]>;

  /** Pendientes de la fuente pedidas desde `notBefore`, de la más antigua a la más reciente, hasta `limit`. */
  listPending(
    source: SourceRef,
    limit: number,
    notBefore: Date,
  ): Promise<readonly PendingMailDelete[]>;

  /**
   * Cierra como `EXPIRED` las pendientes de la fuente pedidas antes de `cutoff`, sin tocar el buzón.
   * Devuelve cuántas cerró.
   */
  expireStale(source: SourceRef, cutoff: Date, now: Date): Promise<number>;

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
