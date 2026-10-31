/**
 * Manejador del aviso "tu segundo factor lleva más de 24 horas sin confirmarse" (S10, DF-6; ADR 0035).
 *
 * Corre dentro del trabajador del outbox: en la transacción del evento, con la organización del evento fijada
 * por RLS y con un plazo por evento. El outbox entrega AL MENOS una vez, así que el manejador es idempotente
 * por (id del evento, destinataria).
 *
 * Invariantes de seguridad
 * - Solo lee el directorio y el estado del segundo factor de la organización del evento (RLS).
 * - El correo no lleva la clave, ni códigos, ni nombres de cuenta o credencial, ni enlaces. Nada del contenido
 *   del evento ni el destinatario se escribe en un registro o en un error.
 * - Avisa ÚNICAMENTE a quien registró el segundo factor. El negocio no define avisar al dueño de la credencial
 *   ni a otra persona (decisión abierta en `odd/tasks/phase-1b-worker.md`).
 *
 * Qué se omite SIN enviar y SIN fallar (reintentar no lo arreglaría):
 * - El registro ya no está pendiente (se confirmó o se retiró entre el barrido y el envío) o fue re-registrado
 *   (su `registered_at` cambió): el aviso sería falso o repetiría uno de otro registro.
 * - La credencial se archivó entre el barrido y el envío (o ya no existe): el barrido excluye las archivadas y
 *   el manejador lo revalida aquí, porque pasa tiempo entre ambos y avisar de una credencial archivada sería
 *   falso y revelaría que existía.
 * - Quien registró ya no está activa (suspendida, dada de baja) o no existe: no hay a quién avisar y esa persona
 *   no puede confirmar nada. Es un aviso operativo, no una alerta de seguridad, así que no se manda a cuarentena.
 *
 * Un fallo de envío LANZA: el trabajador revierte, reintenta con espera y, agotados los intentos, deja el
 * evento en cuarentena. El acuse se anota DESPUÉS de enviar y en una transacción independiente (sobrevive al
 * rollback del trabajador). Queda una ventana mínima (caída entre el envío y el acuse) donde el correo puede
 * repetirse: se acepta un duplicado antes que perder el aviso.
 */
import { asUserId } from '../../../shared/kernel/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { Mailer } from '../../notification/index.js';
import {
  PendingTotpNoticeDeliveryError,
  parsePendingTotpNoticePayload,
} from '../domain/pending-totp-notice.js';
import type { CredentialRepository } from './ports/credential-repository.js';
import type { TotpRepository } from './ports/totp-repository.js';

/** Acuses de entrega, ya atados al nombre de este manejador. */
export interface PendingTotpNoticeDeliveries {
  wasDelivered(eventId: string, recipientId: string): Promise<boolean>;
  markDelivered(eventId: string, recipientId: string): Promise<void>;
}

export interface NotifyPendingTotpUnconfirmedDeps {
  readonly directory: Pick<UserDirectory, 'findById'>;
  readonly totps: Pick<TotpRepository, 'find'>;
  /** Lectura de la credencial (RLS: solo la organización del evento) para revalidar que no esté archivada. */
  readonly credentials: Pick<CredentialRepository, 'findById'>;
  readonly mailer: Pick<Mailer, 'sendPendingTotpNotice'>;
  readonly deliveries: PendingTotpNoticeDeliveries;
}

export interface PendingTotpNoticeEvent {
  /** Id del evento del outbox: es la clave de idempotencia. */
  readonly eventId: string;
  /** Contenido sin validar (viene de una columna jsonb). */
  readonly payload: unknown;
}

export class NotifyPendingTotpUnconfirmed {
  constructor(private readonly deps: NotifyPendingTotpUnconfirmedDeps) {}

  async handle(event: PendingTotpNoticeEvent): Promise<void> {
    const { directory, totps, credentials, mailer, deliveries } = this.deps;
    const notice = parsePendingTotpNoticePayload(event.payload);

    const current = await totps.find(notice.credentialId);
    const isStillPendingSameRegistration =
      current !== null &&
      current.status === 'pending' &&
      current.registeredAt.getTime() === notice.registeredAt.getTime();
    if (!isStillPendingSameRegistration) return;

    // Una credencial archivada se omite igual que un registro que ya no está pendiente: reintentar no lo arregla.
    const credential = await credentials.findById(notice.credentialId);
    const isCredentialAvailable = credential !== null && credential.archivedAt === null;
    if (!isCredentialAvailable) return;

    const recipient = await directory.findById(asUserId(notice.registeredBy));
    if (recipient === null || recipient.status !== 'active') return;

    if (await deliveries.wasDelivered(event.eventId, recipient.id)) return;

    try {
      await mailer.sendPendingTotpNotice({
        to: recipient.email,
        locale: recipient.locale,
        recipientDisplayName: recipient.displayName,
        registeredAt: notice.registeredAt,
      });
    } catch {
      // El error del proveedor puede citar el destinatario: se reemplaza por uno de dominio, sin causa.
      throw new PendingTotpNoticeDeliveryError();
    }
    await deliveries.markDelivered(event.eventId, recipient.id);
  }
}
