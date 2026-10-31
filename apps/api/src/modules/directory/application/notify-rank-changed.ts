/**
 * Manejador del aviso a la persona cuyo rango cambió (ADR 0035).
 *
 * Corre dentro del trabajador del outbox: en la transacción del evento, con la organización del evento fijada
 * por RLS y con un plazo por evento. El outbox entrega AL MENOS una vez, así que el manejador es idempotente
 * por (id del evento, destinataria).
 *
 * Invariantes de seguridad
 * - Solo lee el directorio de la organización del evento (RLS); nunca elige la organización por su cuenta.
 * - El correo lleva el nombre de quien hizo el cambio, los rangos y la fecha. NO lleva el motivo, la lista
 *   de roles retirados ni enlaces (ver `RankChangeNoticeMessage`). Nada del contenido del evento ni el
 *   destinatario se escribe en un registro o en un error.
 * - El idioma es el de la persona afectada, no el de quien hizo el cambio.
 *
 * Qué se omite SIN enviar y SIN fallar (reintentar no lo arreglaría): la persona ya no existe o fue dada de
 * baja, así que no hay a quién avisar. Una persona suspendida sí recibe el aviso: su rango cambió igual.
 *
 * Un fallo de envío LANZA: el trabajador revierte, reintenta con espera y, agotados los intentos, deja el
 * evento en cuarentena. El acuse se anota DESPUÉS de enviar y en una transacción independiente (sobrevive al
 * rollback del trabajador). Queda una ventana mínima (caída entre el envío y el acuse) donde el correo puede
 * repetirse: entre un duplicado y un aviso perdido se elige el duplicado.
 */
import { asUserId } from '../../../shared/kernel/index.js';
import type { Mailer } from '../../notification/index.js';
import {
  RankChangeNoticeDeliveryError,
  parseRankChangeNoticePayload,
} from '../domain/rank-change-notice.js';
import type { UserDirectory } from './ports/user-directory.js';

/** Acuses de entrega, ya atados al nombre de este manejador. */
export interface RankChangeNoticeDeliveries {
  wasDelivered(eventId: string, recipientId: string): Promise<boolean>;
  markDelivered(eventId: string, recipientId: string): Promise<void>;
}

export interface NotifyRankChangedDeps {
  readonly directory: Pick<UserDirectory, 'findById'>;
  readonly mailer: Pick<Mailer, 'sendRankChangeNotice'>;
  readonly deliveries: RankChangeNoticeDeliveries;
}

export interface RankChangeNoticeEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

export class NotifyRankChanged {
  constructor(private readonly deps: NotifyRankChangedDeps) {}

  async handle(event: RankChangeNoticeEvent): Promise<void> {
    const { directory, mailer, deliveries } = this.deps;
    const notice = parseRankChangeNoticePayload(event.payload);

    const recipient = await directory.findById(asUserId(notice.targetId));
    if (recipient === null || recipient.status === 'deactivated') return;

    if (await deliveries.wasDelivered(event.eventId, recipient.id)) return;

    const changedBy = await directory.findById(asUserId(notice.changedBy));
    try {
      await mailer.sendRankChangeNotice({
        to: recipient.email,
        locale: recipient.locale,
        changedByDisplayName: changedBy?.displayName ?? null,
        fromRank: notice.fromRank,
        toRank: notice.toRank,
        changedAt: notice.changedAt,
      });
    } catch {
      // El error del proveedor puede citar el destinatario: se reemplaza por uno genérico sin datos.
      throw new RankChangeNoticeDeliveryError();
    }
    await deliveries.markDelivered(event.eventId, recipient.id);
  }
}
