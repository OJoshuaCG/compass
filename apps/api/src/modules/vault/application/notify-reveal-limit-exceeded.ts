/**
 * Manejador del aviso a la Raíz cuando una persona supera el tope de revelaciones (ADR 0031, R2a).
 *
 * Corre dentro del trabajador del outbox (ADR 0035): en la transacción del evento, con la organización
 * del evento fijada por RLS y con un plazo por evento. El outbox entrega AL MENOS una vez, así que
 * el manejador es idempotente por el id del evento y la destinataria.
 *
 * Invariantes de seguridad
 * - Solo lee el directorio de la organización del evento (RLS); nunca elige la organización por su cuenta.
 * - El correo no lleva credenciales, cuentas, motivos ni secretos (ver `RevealLimitAlertMessage`). Nada
 *   del contenido del evento, ni el destinatario, se escribe en un registro o en un error.
 * - Un fallo (sin Raíz activa, correo caído) LANZA: el trabajador revierte, reintenta con espera y,
 *   agotados los intentos, deja el evento en cuarentena para revisión humana. Un aviso de seguridad
 *   se pierde solo si nadie revisa la cuarentena, nunca en silencio por una condición pasajera.
 *
 * Idempotencia POR DESTINATARIA: el acuse es por (evento, Raíz). Antes de enviar a cada Raíz se consulta su
 * acuse y se omite si ya recibió el aviso; tras cada envío exitoso se anota su acuse en una transacción
 * independiente (sobrevive al rollback del trabajador). Si falla alguna, se lanza al final y el reintento
 * solo reenvía a las pendientes. Queda una ventana mínima (caída entre el envío y la anotación de ESA
 * destinataria) en la que su aviso puede repetirse: entre un duplicado y una alerta perdida se elige el
 * duplicado, porque la alerta es una señal de seguridad.
 */
import { asUserId } from '../../../shared/kernel/index.js';
import type { Clock } from '../../../shared/kernel/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import {
  RevealLimitNoticeDeliveryError,
  parseRevealLimitNoticePayload,
} from '../domain/reveal-limit-notice.js';

/** Acuses de entrega, ya atados al nombre de este manejador. */
export interface RevealLimitNoticeDeliveries {
  wasDelivered(eventId: string, recipientId: string): Promise<boolean>;
  markDelivered(eventId: string, recipientId: string): Promise<void>;
}

export interface NotifyRevealLimitExceededDeps {
  readonly directory: Pick<UserDirectory, 'findById' | 'listRootContacts'>;
  readonly mailer: Pick<Mailer, 'sendRevealLimitAlert'>;
  readonly deliveries: RevealLimitNoticeDeliveries;
  readonly clock: Clock;
}

export interface RevealLimitNoticeEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

export class NotifyRevealLimitExceeded {
  constructor(private readonly deps: NotifyRevealLimitExceededDeps) {}

  async handle(event: RevealLimitNoticeEvent): Promise<void> {
    const { directory, mailer, deliveries, clock } = this.deps;
    const notice = parseRevealLimitNoticePayload(event.payload);

    const recipients = await directory.listRootContacts();
    if (recipients.length === 0) {
      // Sin a quién avisar no se da por entregado: se reintenta y, si sigue así, queda en cuarentena.
      throw new RevealLimitNoticeDeliveryError('VAULT.REVEAL_NOTICE_NO_ROOT');
    }

    const actor = await directory.findById(asUserId(notice.actorId));
    const occurredAt = notice.raisedAt ?? clock.now();

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        if (await deliveries.wasDelivered(event.eventId, recipient.id)) return;
        await mailer.sendRevealLimitAlert({
          to: recipient.email,
          locale: recipient.locale,
          actorDisplayName: actor?.displayName ?? null,
          limitPerHour: notice.limitPerHour,
          revealedInWindow: notice.revealedInWindow,
          windowMinutes: notice.windowMinutes,
          occurredAt,
        });
        // Se anota de inmediato, por destinataria: si otra falla, esta no se repite en el reintento.
        await deliveries.markDelivered(event.eventId, recipient.id);
      }),
    );
    if (results.some((result) => result.status === 'rejected')) {
      throw new RevealLimitNoticeDeliveryError('VAULT.REVEAL_NOTICE_SEND_FAILED');
    }
  }
}
