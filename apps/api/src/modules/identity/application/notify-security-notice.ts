/**
 * Manejador del aviso de seguridad a la dueña de la cuenta (ADR 0035).
 *
 * Corre dentro del trabajador del outbox: en la transacción del evento, con la organización del evento fijada
 * por RLS y con un plazo por evento. El outbox entrega AL MENOS una vez, así que el manejador es idempotente
 * por (id del evento, destinataria).
 *
 * Invariantes de seguridad
 * - Solo lee el directorio de la organización del evento (RLS); nunca elige la organización por su cuenta.
 * - El correo dice qué pasó y cuándo (ver `SecurityNoticeMessage`): sin códigos, tokens, direcciones de red ni
 *   enlaces. Nada del contenido del evento ni el destinatario se escribe en un registro o en un error.
 * - El aviso va SOLO a la dueña de la cuenta, en su idioma.
 *
 * Qué se omite SIN enviar y SIN fallar (reintentar no lo arreglaría): la persona ya no existe o fue dada de
 * baja, así que no hay a quién avisar. Una persona suspendida o invitada sí recibe el aviso.
 *
 * Un fallo de envío LANZA: el trabajador revierte, reintenta con espera y, agotados los intentos, deja el
 * evento en cuarentena. El acuse se anota DESPUÉS de enviar y en una transacción independiente (sobrevive al
 * rollback del trabajador). Queda una ventana mínima (caída entre el envío y el acuse) donde el correo puede
 * repetirse: en un aviso de seguridad se prefiere un duplicado a perder la alerta.
 */
import { asUserId } from '../../../shared/kernel/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import {
  SecurityNoticeDeliveryError,
  parseSecurityNoticePayload,
} from '../domain/security-notice-event.js';

/** Acuses de entrega, ya atados al nombre de este manejador. */
export interface SecurityNoticeDeliveries {
  wasDelivered(eventId: string, recipientId: string): Promise<boolean>;
  markDelivered(eventId: string, recipientId: string): Promise<void>;
}

export interface NotifySecurityNoticeDeps {
  readonly directory: Pick<UserDirectory, 'findById'>;
  readonly mailer: Pick<Mailer, 'sendSecurityNotice'>;
  readonly deliveries: SecurityNoticeDeliveries;
}

export interface SecurityNoticeOutboxEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

export class NotifySecurityNotice {
  constructor(private readonly deps: NotifySecurityNoticeDeps) {}

  async handle(event: SecurityNoticeOutboxEvent): Promise<void> {
    const { directory, mailer, deliveries } = this.deps;
    const notice = parseSecurityNoticePayload(event.payload);

    const recipient = await directory.findById(asUserId(notice.userId));
    if (recipient === null || recipient.status === 'deactivated') return;

    if (await deliveries.wasDelivered(event.eventId, recipient.id)) return;

    try {
      await mailer.sendSecurityNotice({
        to: recipient.email,
        locale: recipient.locale,
        kind: notice.kind,
        occurredAt: notice.occurredAt,
      });
    } catch {
      // El error del proveedor puede citar el destinatario: se reemplaza por uno genérico sin datos.
      throw new SecurityNoticeDeliveryError();
    }
    await deliveries.markDelivered(event.eventId, recipient.id);
  }
}
