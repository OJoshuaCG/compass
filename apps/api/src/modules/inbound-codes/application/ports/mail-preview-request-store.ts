import type { UserId } from '../../../../shared/kernel/index.js';
import type { MailPreviewKind } from '../../domain/mail-preview.js';
import type { MailPreviewResultCode } from './mail-preview-work-store.js';

export interface NewMailPreviewRequest {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly kind: MailPreviewKind;
  /** Posición del mensaje copiada del recibo: el worker compara el `UIDVALIDITY` antes de descargar. */
  readonly mailboxUidValidity: number;
  readonly mailboxUid: number;
  readonly requestedBy: UserId;
  /** Límite de vida de la fila mientras espera al worker; el worker lo reinicia al dejar el contenido. */
  readonly expiresAt: Date;
}

export interface MailPreviewRequestStatus {
  readonly status: 'pending' | 'ready' | 'failed';
  readonly resultCode: MailPreviewResultCode | null;
  readonly requestedAt: Date;
}

/** Contenido cifrado listo para entregar; solo el módulo de criptografía lo abre. */
export interface ReadyMailPreview {
  readonly requestId: string;
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly dekVersion: number;
}

/**
 * Lado de la API de las vistas previas: registra la petición, consulta su estado y entrega el contenido una
 * sola vez. Corre en la transacción en curso con la organización fijada por RLS. La API nunca habla con el
 * buzón: lo trae el worker.
 */
export interface MailPreviewRequestStore {
  /**
   * Crea la petición. `already_pending` si ya hay una viva (pendiente o lista) para ese recibo y clase. Antes
   * limpia las filas vencidas del mismo recibo y clase, para que una fila muerta no bloquee volver a pedir.
   */
  insertPending(request: NewMailPreviewRequest, now: Date): Promise<'created' | 'already_pending'>;

  /** La petición vigente más reciente del recibo y clase, o `null` si no hay ninguna que no haya vencido. */
  findLatest(
    receiptId: string,
    kind: MailPreviewKind,
    now: Date,
  ): Promise<MailPreviewRequestStatus | null>;

  /**
   * Toma el contenido listo y no vencido y borra su fila en el mismo paso: el contenido se entrega una sola vez.
   * `null` si no hay nada listo.
   */
  takeReady(receiptId: string, kind: MailPreviewKind, now: Date): Promise<ReadyMailPreview | null>;
}
