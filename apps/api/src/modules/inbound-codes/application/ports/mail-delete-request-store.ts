import type { UserId } from '../../../../shared/kernel/index.js';

/** Recibo que se pidió borrar, con lo mínimo para decidir quién puede y dónde está el mensaje. */
export interface MailDeleteTarget {
  readonly receiptId: string;
  readonly sourceId: string;
  /** Quien dio de alta la fuente. */
  readonly sourceCreatedBy: UserId;
  /** Posición del mensaje en el buzón; `null` en recibos de SMS o anteriores a la migración 0037. */
  readonly mailboxUidValidity: number | null;
  readonly mailboxUid: number | null;
}

export interface NewMailDeleteRequest {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly mailboxUidValidity: number;
  readonly mailboxUid: number;
  readonly requestedBy: UserId;
}

export interface MailDeleteRequestStatus {
  readonly status: 'pending' | 'done' | 'failed';
  readonly resultCode: string | null;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
}

/**
 * Peticiones de borrar un correo del buzón real. La API solo registra y lee: el borrado lo ejecuta el
 * worker de sondeo, el único que descifra la contraseña del buzón. Corre en la transacción en curso con la
 * organización fijada por RLS.
 */
export interface MailDeleteRequestStore {
  /** Recibo de una fuente de correo activa; `null` si no existe o no es visible para la organización. */
  findTarget(receiptId: string): Promise<MailDeleteTarget | null>;

  /** `already_pending` si ese recibo ya tiene una petición pendiente: pulsar dos veces no manda dos borrados. */
  insertPending(request: NewMailDeleteRequest): Promise<'created' | 'already_pending'>;

  /** La petición más reciente del recibo, o `null` si nunca se pidió borrarlo. */
  findLatest(receiptId: string): Promise<MailDeleteRequestStatus | null>;
}
