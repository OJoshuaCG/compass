import type { EncryptedSecret } from '../../../crypto/index.js';

/** Canal de Telegram activo de una organización, con el token todavía cifrado. */
export interface ActiveTelegramChannel {
  readonly integrationId: string;
  /** Lo guarda la configuración (no es secreto, pero sí un dato personal); nunca se registra. */
  readonly chatId: string;
  readonly botTokenVersion: number;
  readonly botToken: EncryptedSecret;
}

export type TelegramChannelKind = 'telegram_infra' | 'telegram_security';

export interface TelegramChannelStore {
  /**
   * Devuelve el canal activo de ese tipo en la organización fijada por el aislamiento por filas, o `null`
   * si no existe, está archivado o le falta el token o el chat. Nunca descifra.
   */
  findActiveChannel(kind: TelegramChannelKind): Promise<ActiveTelegramChannel | null>;
}
