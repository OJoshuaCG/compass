/**
 * Manejador de las alertas de infraestructura para la Raíz (ADR 0047), por los canales que ella eligió en su
 * panel: correo y/o Telegram (decisión del dueño del 2026-11-04, tabla `alert_settings`).
 *
 * Corre dentro del trabajador del outbox (ADR 0035), en la transacción del evento y con su organización
 * fijada por RLS. El outbox entrega AL MENOS una vez: el acuse es por (evento, destino) y el reintento solo
 * reenvía a los destinos pendientes. Entre un aviso duplicado y uno perdido se elige el duplicado.
 *
 * Invariantes de seguridad
 * - El token se descifra solo aquí, en memoria, y viaja únicamente al adaptador de Telegram.
 * - Nada del contenido del evento, del token, del chat, de los destinatarios ni de la respuesta de Telegram
 *   se escribe en un registro o en un error. El correo y el mensaje usan solo textos fijos por código.
 * - Se intentan TODOS los canales encendidos aunque uno falle; después se lanza si alguno falló, para que el
 *   trabajador reintente lo pendiente. Una falla permanente (por ejemplo, el bot rechazado) solo manda el
 *   evento a cuarentena si la alerta no llegó a NINGÚN destino: si la Raíz ya la recibió por el otro canal,
 *   el evento se da por atendido.
 * - Si con lo elegido no hay ningún destino (correo apagado y sin chat activo, o sin Raíz activa y sin chat),
 *   se lanza un error NO reintentable: el evento va a cuarentena en vez de perderse en silencio.
 */
import type { OrganizationId } from '../../../shared/kernel/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import {
  InfrastructureAlertDeliveryError,
  buildInfrastructureAlertText,
  infrastructureAlertEmailKey,
  infrastructureAlertTelegramKey,
  parseInfrastructureAlertPayload,
} from '../domain/infrastructure-alert.js';
import type { InfrastructureAlertPayload } from '../domain/infrastructure-alert.js';
import { integrationSecretContext } from '../domain/integration-secret-context.js';
import type { AlertSettingsStore } from './ports/alert-settings-store.js';
import type { TelegramChannelStore } from './ports/telegram-channel-store.js';
import type { TelegramSender } from './ports/telegram-sender.js';

/** Acuses de entrega del outbox; la clave de destino la arma el dominio. */
export interface InfrastructureAlertDeliveries {
  wasDelivered(eventId: string, destinationKey: string): Promise<boolean>;
  markDelivered(eventId: string, destinationKey: string): Promise<void>;
}

export interface NotifyInfrastructureAlertDeps {
  readonly settings: Pick<AlertSettingsStore, 'find'>;
  readonly channels: TelegramChannelStore;
  readonly cipher: Pick<SecretCipher, 'decrypt'>;
  readonly sender: TelegramSender;
  readonly directory: Pick<UserDirectory, 'listRootContacts'>;
  readonly mailer: Pick<Mailer, 'sendInfrastructureAlert'>;
  readonly deliveries: InfrastructureAlertDeliveries;
}

export interface InfrastructureAlertEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Organización del evento: es parte del contexto de cifrado del token. */
  readonly organizationId: OrganizationId;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

/**
 * Lo que pasó con un canal: cuántos destinos tenía, a cuántos les llegó la alerta (en este intento o en uno
 * anterior ya acusado) y el error si alguno falló.
 */
interface ChannelOutcome {
  readonly destinations: number;
  readonly delivered: number;
  readonly failure: InfrastructureAlertDeliveryError | null;
}

const NO_DESTINATIONS: ChannelOutcome = { destinations: 0, delivered: 0, failure: null };

export class NotifyInfrastructureAlert {
  constructor(private readonly deps: NotifyInfrastructureAlertDeps) {}

  async handle(event: InfrastructureAlertEvent): Promise<void> {
    const alert = parseInfrastructureAlertPayload(event.payload);
    const { infrastructure } = await this.deps.settings.find();

    const telegramOutcome = infrastructure.telegram
      ? await this.notifyTelegram(event, alert)
      : NO_DESTINATIONS;
    const emailOutcome = infrastructure.email
      ? await this.notifyEmail(event, alert)
      : NO_DESTINATIONS;

    if (telegramOutcome.destinations + emailOutcome.destinations === 0) {
      // Configuración que una persona debe corregir: reintentar no crea un destino.
      throw new InfrastructureAlertDeliveryError('INTEGRATIONS.ALERT_CONFIG_INVALID', false);
    }
    const failures = [telegramOutcome.failure, emailOutcome.failure].filter(
      (failure): failure is InfrastructureAlertDeliveryError => failure !== null,
    );
    const firstFailure = failures[0];
    if (firstFailure === undefined) return;
    // Basta con que una falla sea pasajera para reintentar: los acuses evitan repetir lo ya entregado.
    const retryableFailure = failures.find((failure) => failure.retryable);
    if (retryableFailure !== undefined) {
      throw new InfrastructureAlertDeliveryError(retryableFailure.code, true);
    }
    // Solo quedan fallas permanentes: si la alerta llegó a algún destino, la Raíz ya se enteró.
    const deliveredCount = telegramOutcome.delivered + emailOutcome.delivered;
    if (deliveredCount > 0) return;
    throw new InfrastructureAlertDeliveryError(firstFailure.code, false);
  }

  private async notifyTelegram(
    event: InfrastructureAlertEvent,
    alert: InfrastructureAlertPayload,
  ): Promise<ChannelOutcome> {
    const { channels, cipher, sender, deliveries } = this.deps;
    const channel = await channels.findActiveChannel('telegram_infra');
    if (channel === null) return NO_DESTINATIONS;

    const destinationKey = infrastructureAlertTelegramKey();
    if (await deliveries.wasDelivered(event.eventId, destinationKey)) {
      return { destinations: 1, delivered: 1, failure: null };
    }

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
      return {
        destinations: 1,
        delivered: 0,
        failure: new InfrastructureAlertDeliveryError(
          'INTEGRATIONS.ALERT_SECRET_UNAVAILABLE',
          true,
        ),
      };
    }

    const result = await sender.send({
      botToken: new TextDecoder().decode(opened.value),
      chatId: channel.chatId,
      text: buildInfrastructureAlertText(alert),
    });
    if (!result.ok) {
      return {
        destinations: 1,
        delivered: 0,
        failure: new InfrastructureAlertDeliveryError(
          'INTEGRATIONS.ALERT_SEND_FAILED',
          result.retryable,
        ),
      };
    }
    await deliveries.markDelivered(event.eventId, destinationKey);
    return { destinations: 1, delivered: 1, failure: null };
  }

  private async notifyEmail(
    event: InfrastructureAlertEvent,
    alert: InfrastructureAlertPayload,
  ): Promise<ChannelOutcome> {
    const { directory, mailer, deliveries } = this.deps;
    const recipients = await directory.listRootContacts();
    if (recipients.length === 0) return NO_DESTINATIONS;

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        const destinationKey = infrastructureAlertEmailKey(recipient.id);
        if (await deliveries.wasDelivered(event.eventId, destinationKey)) return;
        await mailer.sendInfrastructureAlert({
          to: recipient.email,
          locale: recipient.locale,
          code: alert.code,
          occurredAt: alert.occurredAt,
        });
        // Se anota de inmediato, por destinataria: si otra falla, esta no se repite en el reintento.
        await deliveries.markDelivered(event.eventId, destinationKey);
      }),
    );
    const rejectedCount = results.filter((result) => result.status === 'rejected').length;
    const anyRejected = rejectedCount > 0;
    return {
      destinations: recipients.length,
      delivered: recipients.length - rejectedCount,
      failure: anyRejected
        ? new InfrastructureAlertDeliveryError('INTEGRATIONS.ALERT_SEND_FAILED', true)
        : null,
    };
  }
}
