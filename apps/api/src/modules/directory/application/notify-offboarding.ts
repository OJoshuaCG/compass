/**
 * Manejador de los avisos de una baja (ADR 0035; governance §2.4).
 *
 * Corre dentro del trabajador del outbox: en la transacción del evento, con la organización del evento fijada
 * por RLS y con un plazo por evento. El outbox entrega AL MENOS una vez, así que cada aviso es idempotente por
 * (id del evento, papel, destinataria).
 *
 * Qué avisa, cada uno por separado
 * - A quien recibió cuentas FUERA de la rama de quien dio la baja (`notifyReceiver`): cuántas y que vencen
 *   tareas de rotación. Quien las recibe dentro de la rama no necesita aviso: lo hizo su propia rama.
 * - A los Administradores activos y a la Raíz si alguna cuenta quedó sin responsable.
 * - El informe a quien dio la baja, con solo conteos.
 *
 * Invariantes de seguridad
 * - Solo lee el directorio de la organización del evento (RLS); nunca elige la organización por su cuenta.
 * - El correo lleva el nombre de quien se fue, conteos y la hora. NO lleva nombres de cuentas ni de
 *   credenciales ni enlaces. Nada del contenido del evento ni los destinatarios se escribe en un registro o en
 *   un error.
 * - Una persona suspendida o dada de baja no recibe avisos (no puede actuar sobre ellos). El idioma es el de
 *   cada destinataria.
 *
 * Un fallo de envío LANZA: el trabajador revierte, reintenta con espera y, agotados los intentos, deja el
 * evento en cuarentena. El acuse se anota DESPUÉS de enviar y en una transacción independiente. Queda una
 * ventana mínima (caída entre el envío y el acuse) donde el correo puede repetirse: entre un duplicado y un
 * aviso perdido se elige el duplicado.
 */
import { asUserId } from '../../../shared/kernel/index.js';
import type { Mailer, OffboardingNoticeMessage } from '../../notification/index.js';
import {
  OffboardingNoticeDeliveryError,
  offboardingNoticeHandlerKey,
  parseOffboardingNoticePayload,
} from '../domain/offboarding-notice.js';
import type {
  OffboardingNoticePayload,
  OffboardingNoticeRole,
} from '../domain/offboarding-notice.js';
import type { UserDirectory } from './ports/user-directory.js';

/** Acuses de entrega por papel, ya atados al nombre de este manejador. */
export interface OffboardingNoticeDeliveries {
  wasDelivered(eventId: string, role: OffboardingNoticeRole, recipientId: string): Promise<boolean>;
  markDelivered(eventId: string, role: OffboardingNoticeRole, recipientId: string): Promise<void>;
}

/** Adapta un almacén de acuses por clave a los acuses por papel de este manejador. */
export function offboardingNoticeDeliveriesOver(receipts: {
  wasDelivered(eventId: string, handlerKey: string): Promise<boolean>;
  markDelivered(eventId: string, handlerKey: string): Promise<void>;
}): OffboardingNoticeDeliveries {
  return {
    wasDelivered: (eventId, role, recipientId) =>
      receipts.wasDelivered(eventId, offboardingNoticeHandlerKey(role, recipientId)),
    markDelivered: (eventId, role, recipientId) =>
      receipts.markDelivered(eventId, offboardingNoticeHandlerKey(role, recipientId)),
  };
}

export interface NotifyOffboardingDeps {
  readonly directory: Pick<
    UserDirectory,
    'findById' | 'listAdministratorRecipients' | 'listRootContacts'
  >;
  readonly mailer: Pick<Mailer, 'sendOffboardingNotice'>;
  readonly deliveries: OffboardingNoticeDeliveries;
}

export interface OffboardingNoticeEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

interface Recipient {
  readonly id: string;
  readonly email: string;
  readonly locale: 'es-MX' | 'en-US';
}

export class NotifyOffboarding {
  constructor(private readonly deps: NotifyOffboardingDeps) {}

  async handle(event: OffboardingNoticeEvent): Promise<void> {
    const { directory } = this.deps;
    const notice = parseOffboardingNoticePayload(event.payload);

    const leaver = await directory.findById(asUserId(notice.leaverId));
    const leaverDisplayName = leaver?.displayName ?? null;
    const base = { leaverDisplayName, occurredAt: notice.offboardedAt };

    if (notice.notifyReceiver && notice.receiverId !== null && notice.assignedAccountCount > 0) {
      const receiver = await this.activeRecipient(notice.receiverId);
      if (receiver !== null) {
        await this.deliver(event.eventId, 'receiver', receiver, {
          ...base,
          kind: 'accounts_assigned',
          accountCount: notice.assignedAccountCount,
          report: null,
        });
      }
    }

    if (notice.unassignedAccountCount > 0) {
      for (const recipient of await this.alertRecipients()) {
        await this.deliver(event.eventId, 'alert', recipient, {
          ...base,
          kind: 'accounts_unassigned',
          accountCount: notice.unassignedAccountCount,
          report: null,
        });
      }
    }

    const actor = await this.activeRecipient(notice.actorId);
    if (actor !== null) {
      await this.deliver(event.eventId, 'report', actor, {
        ...base,
        kind: 'report',
        accountCount: 0,
        report: reportOf(notice),
      });
    }
  }

  /** Administradores activos más la Raíz activa, sin repetir a nadie. */
  private async alertRecipients(): Promise<readonly Recipient[]> {
    const { directory } = this.deps;
    const byId = new Map<string, Recipient>();
    for (const recipient of [
      ...(await directory.listAdministratorRecipients()),
      ...(await directory.listRootContacts()),
    ]) {
      byId.set(recipient.id, recipient);
    }
    return [...byId.values()];
  }

  /** `null` si la persona ya no existe o no está activa: no puede actuar sobre el aviso. */
  private async activeRecipient(userId: string): Promise<Recipient | null> {
    const user = await this.deps.directory.findById(asUserId(userId));
    if (user === null || user.status !== 'active') return null;
    return { id: user.id, email: user.email, locale: user.locale };
  }

  private async deliver(
    eventId: string,
    role: OffboardingNoticeRole,
    recipient: Recipient,
    content: Omit<OffboardingNoticeMessage, 'to' | 'locale'>,
  ): Promise<void> {
    const { mailer, deliveries } = this.deps;
    if (await deliveries.wasDelivered(eventId, role, recipient.id)) return;
    try {
      await mailer.sendOffboardingNotice({
        ...content,
        to: recipient.email,
        locale: recipient.locale,
      });
    } catch {
      // El error del proveedor puede citar el destinatario: se reemplaza por uno genérico sin datos.
      throw new OffboardingNoticeDeliveryError();
    }
    await deliveries.markDelivered(eventId, role, recipient.id);
  }
}

function reportOf(notice: OffboardingNoticePayload) {
  return {
    assignedAccountCount: notice.assignedAccountCount,
    unassignedAccountCount: notice.unassignedAccountCount,
    rotationTaskCount: notice.rotationTaskCount,
  };
}
