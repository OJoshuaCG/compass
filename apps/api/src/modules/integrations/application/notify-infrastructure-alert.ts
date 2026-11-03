/**
 * Manejador de las alertas de infraestructura para el canal de Telegram de la Raíz (ADR 0047).
 *
 * Corre dentro del trabajador del outbox (ADR 0035), en la transacción del evento y con su organización
 * fijada por RLS. El outbox entrega AL MENOS una vez: entre un aviso duplicado y uno perdido se elige el
 * duplicado, así que no hay acuse por destinatario (hay un solo chat).
 *
 * Invariantes de seguridad
 * - El token se descifra solo aquí, en memoria, y viaja únicamente al adaptador de Telegram.
 * - Nada del contenido del evento, del token, del chat ni de la respuesta de Telegram se escribe en un
 *   registro o en un error.
 * - Sin canal configurado no hay a quién avisar: el evento se da por atendido (la integración es opcional).
 */
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import {
  InfrastructureAlertDeliveryError,
  buildInfrastructureAlertText,
  parseInfrastructureAlertPayload,
} from '../domain/infrastructure-alert.js';
import { integrationSecretContext } from '../domain/integration-secret-context.js';
import type { TelegramChannelStore } from './ports/telegram-channel-store.js';
import type { TelegramSender } from './ports/telegram-sender.js';

export interface NotifyInfrastructureAlertDeps {
  readonly channels: TelegramChannelStore;
  readonly cipher: Pick<SecretCipher, 'decrypt'>;
  readonly sender: TelegramSender;
}

export interface InfrastructureAlertEvent {
  /** Organización del evento: es parte del contexto de cifrado del token. */
  readonly organizationId: OrganizationId;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

export class NotifyInfrastructureAlert {
  constructor(private readonly deps: NotifyInfrastructureAlertDeps) {}

  async handle(event: InfrastructureAlertEvent): Promise<void> {
    const { channels, cipher, sender } = this.deps;
    const alert = parseInfrastructureAlertPayload(event.payload);

    const channel = await channels.findActiveChannel('telegram_infra');
    if (channel === null) return;

    const opened = await cipher.decrypt(
      integrationSecretContext(
        event.organizationId,
        channel.integrationId,
        'bot_token',
        channel.botTokenVersion,
      ),
      channel.botToken,
    );
    if (!opened.ok) {
      // Puede ser una falla pasajera del servicio de llaves: se reintenta dentro del tope del outbox.
      throw new InfrastructureAlertDeliveryError('INTEGRATIONS.ALERT_SECRET_UNAVAILABLE', true);
    }

    const result = await sender.send({
      botToken: new TextDecoder().decode(opened.value),
      chatId: channel.chatId,
      text: buildInfrastructureAlertText(alert),
    });
    if (!result.ok) {
      throw new InfrastructureAlertDeliveryError(
        'INTEGRATIONS.ALERT_SEND_FAILED',
        result.retryable,
      );
    }
  }
}
