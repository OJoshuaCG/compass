/**
 * Manejador de los avisos de la transferencia de la Raíz (ADR 0035; governance, J3).
 *
 * Corre dentro del trabajador del outbox: en la transacción del evento, con la organización del evento fijada
 * por RLS. El outbox entrega AL MENOS una vez, así que cada aviso es idempotente por (evento, tipo,
 * transferencia, destinataria).
 *
 * A quién avisa: a la Raíz que entrega, a la persona que recibe y a todos los Administradores activos, cada
 * quien una sola vez y en su idioma. Toda cancelación y caducidad también avisa (decisión del dueño, L22).
 *
 * Invariantes de seguridad
 * - Solo lee el directorio de la organización del evento (RLS); nunca elige la organización por su cuenta.
 * - El correo lleva los nombres visibles, el tipo de aviso y fechas; sin enlaces, códigos ni correos de
 *   terceros. Nada del contenido del evento ni los destinatarios se escribe en un registro o en un error.
 * - Una persona suspendida o dada de baja no recibe avisos. La Raíz que acaba de entregar el puesto queda
 *   «invitada» (debe registrar sus factores de nuevo) y SÍ recibe el aviso de cierre.
 *
 * Un fallo de envío LANZA: el trabajador revierte, reintenta con espera y, agotados los intentos, deja el
 * evento en cuarentena. El acuse se anota DESPUÉS de enviar; queda una ventana mínima donde el correo puede
 * repetirse: entre un duplicado y un aviso perdido se elige el duplicado.
 */
import { asUserId } from '../../../shared/kernel/index.js';
import type { Mailer, RootTransferNoticeMessage } from '../../notification/index.js';
import {
  RootTransferNoticeDeliveryError,
  parseRootTransferNoticePayload,
  rootTransferNoticeHandlerKey,
} from '../domain/root-transfer-notice.js';
import type { RootTransferNoticePayload } from '../domain/root-transfer-notice.js';
import type { UserStatus } from '../domain/user.js';
import type { UserDirectory } from './ports/user-directory.js';

/** Acuses de entrega por clave (los mismos que usan los demás avisos del outbox). */
export interface RootTransferNoticeReceipts {
  wasDelivered(eventId: string, handlerKey: string): Promise<boolean>;
  markDelivered(eventId: string, handlerKey: string): Promise<void>;
}

export interface NotifyRootTransferDeps {
  readonly directory: Pick<UserDirectory, 'findById' | 'listAdministratorRecipients'>;
  readonly mailer: Pick<Mailer, 'sendRootTransferNotice'>;
  readonly receipts: RootTransferNoticeReceipts;
}

export interface RootTransferNoticeEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

interface Recipient {
  readonly id: string;
  readonly email: string;
  readonly locale: 'es-MX' | 'en-US';
  readonly role: RootTransferNoticeMessage['recipientRole'];
}

/** Estados que no pueden actuar sobre el aviso. */
const SILENT_STATUSES: readonly UserStatus[] = ['suspended', 'deactivated'];

export class NotifyRootTransfer {
  constructor(private readonly deps: NotifyRootTransferDeps) {}

  async handle(event: RootTransferNoticeEvent): Promise<void> {
    const notice = parseRootTransferNoticePayload(event.payload);
    const { directory } = this.deps;
    const from = await directory.findById(asUserId(notice.fromUserId));
    const to = await directory.findById(asUserId(notice.toUserId));
    const fromDisplayName = from?.displayName ?? null;
    const toDisplayName = to?.displayName ?? null;

    for (const recipient of await this.recipients(notice)) {
      const handlerKey = rootTransferNoticeHandlerKey(notice.kind, notice.transferId, recipient.id);
      if (await this.deps.receipts.wasDelivered(event.eventId, handlerKey)) continue;
      try {
        await this.deps.mailer.sendRootTransferNotice({
          to: recipient.email,
          locale: recipient.locale,
          kind: notice.kind,
          recipientRole: recipient.role,
          fromDisplayName,
          toDisplayName,
          automatic: notice.kind === 'cancelled' && notice.actorId === null,
          occurredAt: notice.occurredAt,
          executesAt: notice.executesAt,
        });
      } catch {
        // El error del proveedor puede citar el destinatario: se reemplaza por uno genérico sin datos.
        throw new RootTransferNoticeDeliveryError();
      }
      await this.deps.receipts.markDelivered(event.eventId, handlerKey);
    }
  }

  /** La Raíz que entrega, quien recibe y los Administradores activos, sin repetir a nadie. */
  private async recipients(notice: RootTransferNoticePayload): Promise<readonly Recipient[]> {
    const { directory } = this.deps;
    const byId = new Map<string, Recipient>();
    for (const administrator of await directory.listAdministratorRecipients()) {
      byId.set(administrator.id, { ...administrator, role: 'administrator' });
    }
    // Los papeles de las dos partes mandan sobre el de Administrador.
    const parties = [
      { id: notice.fromUserId, role: 'previous_root' },
      { id: notice.toUserId, role: 'new_root' },
    ] as const;
    for (const party of parties) {
      const user = await directory.findById(asUserId(party.id));
      if (user === null || SILENT_STATUSES.includes(user.status)) {
        byId.delete(party.id);
        continue;
      }
      byId.set(party.id, { id: user.id, email: user.email, locale: user.locale, role: party.role });
    }
    return [...byId.values()];
  }
}
