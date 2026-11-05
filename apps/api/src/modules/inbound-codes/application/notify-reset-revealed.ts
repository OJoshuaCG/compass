/**
 * Manejador del aviso a la Raíz cuando alguien revela restablecimientos de códigos entrantes (ADR 0045).
 *
 * Corre dentro del trabajador del outbox (ADR 0035), en la transacción del evento y con su organización
 * fijada por RLS. El outbox entrega AL MENOS una vez: el acuse es por (evento, Raíz) y el reintento solo
 * reenvía a las pendientes, igual que el aviso del tope de revelaciones.
 *
 * Invariantes de seguridad
 * - Solo lee el directorio de la organización del evento (RLS).
 * - El correo no lleva valores, motivos, direcciones ni nombres de vistas (ver `ResetRevealAlertMessage`).
 *   Nada del contenido del evento ni el destinatario se escribe en un registro o en un error.
 * - Un fallo (sin Raíz activa, correo caído) LANZA: el trabajador reintenta y, agotados los intentos, deja
 *   el evento en cuarentena. Entre un aviso duplicado y uno perdido se elige el duplicado.
 */
import { asUserId } from '../../../shared/kernel/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import {
  ResetRevealNoticeDeliveryError,
  parseResetRevealNoticePayload,
} from '../domain/reset-reveal-notice.js';

/** Acuses de entrega, ya atados al nombre de este manejador. */
export interface ResetRevealNoticeDeliveries {
  wasDelivered(eventId: string, recipientId: string): Promise<boolean>;
  markDelivered(eventId: string, recipientId: string): Promise<void>;
}

export interface NotifyResetRevealedDeps {
  readonly directory: Pick<UserDirectory, 'findById' | 'listRootContacts'>;
  readonly mailer: Pick<Mailer, 'sendResetRevealAlert'>;
  readonly deliveries: ResetRevealNoticeDeliveries;
}

export interface ResetRevealNoticeEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

export class NotifyResetRevealed {
  constructor(private readonly deps: NotifyResetRevealedDeps) {}

  async handle(event: ResetRevealNoticeEvent): Promise<void> {
    const { directory, mailer, deliveries } = this.deps;
    const notice = parseResetRevealNoticePayload(event.payload);

    const recipients = await directory.listRootContacts();
    if (recipients.length === 0) {
      // Sin a quién avisar no se da por entregado: se reintenta y, si sigue así, queda en cuarentena.
      throw new ResetRevealNoticeDeliveryError('INBOUND.RESET_NOTICE_NO_ROOT');
    }

    const actor = await directory.findById(asUserId(notice.actorId));

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        if (await deliveries.wasDelivered(event.eventId, recipient.id)) return;
        await mailer.sendResetRevealAlert({
          to: recipient.email,
          locale: recipient.locale,
          actorDisplayName: actor?.displayName ?? null,
          revealedCount: notice.revealedCount,
          occurredAt: notice.revealedAt,
        });
        // Se anota de inmediato, por destinataria: si otra falla, esta no se repite en el reintento.
        await deliveries.markDelivered(event.eventId, recipient.id);
      }),
    );
    if (results.some((result) => result.status === 'rejected')) {
      throw new ResetRevealNoticeDeliveryError('INBOUND.RESET_NOTICE_SEND_FAILED');
    }
  }
}
