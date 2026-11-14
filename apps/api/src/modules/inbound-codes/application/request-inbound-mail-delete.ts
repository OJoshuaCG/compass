/**
 * Petición de borrar un correo del buzón real (ADR 0045, enmienda «borrado de correo a petición»).
 *
 * Invariantes de seguridad
 * - La API NUNCA descifra la contraseña del buzón ni habla con el servidor IMAP: solo registra una petición
 *   ya autorizada. La ejecuta el worker de sondeo en su siguiente pasada (modelo de amenazas, fila del worker).
 * - Tres condiciones, todas obligatorias: el permiso `inbound.delete_mail` con reautenticación reciente y
 *   auditoría crítica (lo decide el motor de autorización); ser Administrador o superior, o quien dio de alta
 *   la fuente; y que el recibo tenga posición guardada. Quien solo recibe una vista compartida no cumple la
 *   segunda: nunca se le ofrece borrar.
 * - Un recibo inexistente, de otra fuente no activa, o de una fuente ajena a la persona responde
 *   `NOT_FOUND` por igual, y la negación se audita. No se revela si el mensaje existe.
 * - La petición COPIA la posición del recibo; el worker compara el `UIDVALIDITY` con el del buzón antes de
 *   borrar, así que un UID viejo nunca apunta a otro mensaje.
 * - Una auditoría crítica `inbound.mail_deleted` en la misma transacción que la petición: si no se puede
 *   escribir se LANZA y no queda petición. Solo el id de la fuente: nunca asunto, remitente, cuerpo ni UID.
 * - Idempotente: si el recibo ya tiene una petición pendiente se responde igual sin crear otra ni auditar
 *   de nuevo (la primera ya quedó auditada).
 */
import type { Permission } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import type {
  MailDeleteRequestStatus,
  MailDeleteRequestStore,
  MailDeleteTarget,
} from './ports/mail-delete-request-store.js';

const DELETE_PERMISSION: Permission = 'inbound.delete_mail';

/** Rango máximo (número más bajo es más alto) que borra sin haber dado de alta la fuente: Administrador. */
const ADMINISTRATOR_RANK = 1;

export interface RequestInboundMailDeleteDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly directory: Pick<UserDirectory, 'findById'>;
  readonly requests: MailDeleteRequestStore;
  readonly audit: AuditLog;
}

export interface MailDeleteRequested {
  /** `true` si el recibo ya tenía una petición pendiente y no se creó otra. */
  readonly alreadyPending: boolean;
}

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Inbound message not found');

export class RequestInboundMailDelete {
  constructor(private readonly deps: RequestInboundMailDeleteDeps) {}

  request(receiptId: string): Promise<Result<MailDeleteRequested, DomainError>> {
    const { context, uow, authorizer, requests } = this.deps;
    return uow.run(async () => {
      // Permiso, reautenticación de 5 minutos y marca de auditoría crítica: decisión del motor.
      await authorizer.require({ permission: DELETE_PERMISSION });
      const actorId = this.requireActorId();

      const found = await this.findOwnedTarget(receiptId, actorId);
      if (!found.ok) return found;
      const target = found.value;

      if (target.mailboxUid === null || target.mailboxUidValidity === null) {
        return err(
          new DomainError(
            'INBOUND.MAIL_NOT_DELETABLE',
            'The mailbox position of this message was not recorded',
          ),
        );
      }

      const inserted = await requests.insertPending({
        receiptId,
        sourceId: target.sourceId,
        mailboxUidValidity: target.mailboxUidValidity,
        mailboxUid: target.mailboxUid,
        requestedBy: actorId,
      });
      if (inserted === 'already_pending') return ok({ alreadyPending: true });

      const recorded = await this.deps.audit.record({
        action: 'inbound.mail_deleted',
        actorId,
        targetType: 'inbound_receipt',
        targetId: receiptId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { sourceId: target.sourceId },
      });
      // Sin auditoría no hay petición: lanzar revierte la transacción completa.
      if (!recorded.ok) throw recorded.error;
      return ok({ alreadyPending: false });
    });
  }

  /** Estado de la petición más reciente del recibo, para que la pantalla muestre «pendiente» o el resultado. */
  status(receiptId: string): Promise<Result<MailDeleteRequestStatus | null, DomainError>> {
    const { uow, authorizer, requests } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: DELETE_PERMISSION });
      const found = await this.findOwnedTarget(receiptId, this.requireActorId());
      if (!found.ok) return found;
      return ok(await requests.findLatest(receiptId));
    });
  }

  /** Recibo sobre el que la persona puede pedir borrado; si no, `NOT_FOUND` con la negación auditada. */
  private async findOwnedTarget(
    receiptId: string,
    actorId: UserId,
  ): Promise<Result<MailDeleteTarget, DomainError>> {
    const target = await this.deps.requests.findTarget(receiptId);
    if (target === null) return this.denyAsNotFound(null);
    const actor = await this.deps.directory.findById(actorId);
    const isAdministrator = actor !== null && actor.rank <= ADMINISTRATOR_RANK;
    const isSourceCreator = target.sourceCreatedBy === actorId;
    if (!isAdministrator && !isSourceCreator) return this.denyAsNotFound(target.sourceId);
    return ok(target);
  }

  private async denyAsNotFound(sourceId: string | null): Promise<Result<never, DomainError>> {
    await this.deps.authorizer.auditDenial({
      code: 'AUTHZ.PERMISSION',
      permission: DELETE_PERMISSION,
      ...(sourceId === null ? {} : { targetSourceId: sourceId }),
    });
    return err(notFound());
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}
