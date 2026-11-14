import type { MailPreviewKind } from '../../domain/mail-preview.js';
import type { SourceRef } from './poll-state-store.js';

/** Petición pendiente tal como la ve el worker: solo lo necesario para traer el mensaje, sin personas. */
export interface PendingMailPreview {
  readonly requestId: string;
  readonly kind: MailPreviewKind;
  readonly mailboxUidValidity: number;
  readonly mailboxUid: number;
}

/** Resultado acotado que queda en la fila; nunca texto del servidor ni contenido del mensaje. */
export const MAIL_PREVIEW_RESULT_CODES = [
  'READY',
  'NOT_FOUND',
  'POSITION_CHANGED',
  'CONNECTION',
  'CONNECTION_MISSING',
  'TOO_LARGE',
  'EMPTY',
  'UNEXPECTED',
] as const;
export type MailPreviewResultCode = (typeof MAIL_PREVIEW_RESULT_CODES)[number];

/** Resultado de cerrar una petición con un fallo: nunca lleva contenido. */
export type MailPreviewFailureCode = Exclude<MailPreviewResultCode, 'READY'>;

/**
 * Lado del worker de las vistas previas: descubre, lee lo pendiente, deja el contenido cifrado y purga lo
 * vencido. El cifrado ocurre dentro del adaptador, con el módulo de criptografía: el caso de uso nunca lo ve.
 */
export interface MailPreviewWorkStore {
  /** Fuentes de correo activas con alguna petición pendiente no vencida, de cualquier organización. */
  listSourcesWithPending(now: Date): Promise<readonly SourceRef[]>;

  /** Fuentes (activas o no) con alguna fila vencida, con o sin contenido. */
  listSourcesWithExpired(now: Date): Promise<readonly SourceRef[]>;

  /** Pendientes no vencidas de la fuente, de la más antigua a la más reciente, hasta `limit`. */
  listPending(source: SourceRef, limit: number, now: Date): Promise<readonly PendingMailPreview[]>;

  /**
   * Cifra `content` y lo deja en la petición como `READY`; reinicia su vencimiento a `expiresAt`. Solo actúa sobre
   * una fila todavía pendiente. Pone a cero la copia en claro que el adaptador haya creado.
   */
  complete(
    source: SourceRef,
    requestId: string,
    content: string,
    expiresAt: Date,
    now: Date,
  ): Promise<void>;

  /** Cierra la petición como fallida con un código acotado. Solo actúa sobre una fila todavía pendiente. */
  fail(
    source: SourceRef,
    requestId: string,
    code: MailPreviewFailureCode,
    now: Date,
  ): Promise<void>;

  /** Borra las filas vencidas de la fuente (contenido incluido). Devuelve cuántas borró. */
  purgeExpired(source: SourceRef, now: Date): Promise<number>;
}
