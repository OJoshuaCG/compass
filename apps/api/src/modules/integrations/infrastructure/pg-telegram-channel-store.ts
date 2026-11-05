/**
 * Invariantes de seguridad
 * - Todo corre en la transacción en curso: el aislamiento por filas limita las consultas a la organización fijada.
 * - Solo lee el texto cifrado del token; nunca lo descifra ni lo registra.
 */
import type { TransactionProvider } from '../../organization/index.js';
import type {
  ActiveTelegramChannel,
  TelegramChannelKind,
  TelegramChannelStore,
} from '../application/ports/telegram-channel-store.js';

interface ChannelRow {
  integration_id: string;
  chat_id: unknown;
  secret_version: number;
  ciphertext: Buffer;
  nonce: Buffer;
  dek_version: number;
}

export class PgTelegramChannelStore implements TelegramChannelStore {
  constructor(private readonly transactions: TransactionProvider) {}

  async findActiveChannel(kind: TelegramChannelKind): Promise<ActiveTelegramChannel | null> {
    // El índice único parcial garantiza a lo sumo un canal activo por tipo y organización.
    const result = await this.transactions.current().query<ChannelRow>(
      `select integrations.id as integration_id,
              integrations.config -> 'chatId' as chat_id,
              integration_secrets.secret_version,
              integration_secrets.ciphertext,
              integration_secrets.nonce,
              integration_secrets.dek_version
         from integrations
         join integration_secrets
           on integration_secrets.organization_id = integrations.organization_id
          and integration_secrets.integration_id = integrations.id
          and integration_secrets.field = 'bot_token'
        where integrations.kind = $1
          and integrations.status = 'active'
        limit 1`,
      [kind],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    // Un chat ilegible equivale a un canal sin configurar: nunca se envía a un destino inventado.
    if (typeof row.chat_id !== 'string' || row.chat_id.length === 0) return null;
    return {
      integrationId: row.integration_id,
      chatId: row.chat_id,
      botTokenVersion: row.secret_version,
      botToken: {
        ciphertext: new Uint8Array(row.ciphertext),
        nonce: new Uint8Array(row.nonce),
        dekVersion: row.dek_version,
      },
    };
  }
}
