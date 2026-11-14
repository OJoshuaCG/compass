/**
 * Vista previa del asunto o del cuerpo de un correo del buzón real (ADR 0045, enmienda «borrado de correo a
 * petición»; odd/tasks/inbound-mail-delete.md, S4): sirve para confirmar qué mensaje se va a borrar.
 *
 * Invariantes de seguridad
 * - La API NUNCA habla con el buzón ni descifra su contraseña: registra una petición ya autorizada y auditada;
 *   la trae el worker, que deja el contenido cifrado. La API solo lo descifra al entregarlo.
 * - Asunto: permiso `inbound.delete_mail`. Cuerpo: ese permiso Y `inbound.reveal_reset` (techo 1: Raíz y
 *   Administración), con motivo escrito (`isValidRevealReason`). El motor de autorización exige reautenticación
 *   reciente en ambos. Sin motivo válido se niega, se audita y no se pide nada al buzón.
 * - Quien puede ver el correo es quien podría borrarlo: Administrador o superior, o quien dio de alta la fuente.
 *   Un recibo inexistente, de otra fuente no activa o ajena responde `NOT_FOUND` por igual, y la negación se audita.
 * - Auditoría crítica en la misma transacción: al pedir (`inbound.mail_preview_requested`) y al ENTREGAR
 *   (`inbound.mail_subject_viewed` o `inbound.mail_body_viewed` con el motivo). Si no se puede escribir se LANZA y
 *   no queda petición ni entrega. Nunca el contenido, el remitente ni el UID.
 * - El contenido se descifra con el módulo de criptografía, se entrega UNA sola vez (la fila se borra al tomarla)
 *   y el texto en bytes se pone en ceros. Un descifrado fallido deja auditoría de fallo y no entrega nada.
 */
import {
  isValidRevealReason,
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
} from '@iam/contracts';
import type { Permission } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UserDirectory } from '../../directory/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { MAIL_PREVIEW_TTL_MS, mailPreviewContext } from '../domain/mail-preview.js';
import type { MailPreviewKind } from '../domain/mail-preview.js';
import type {
  MailDeleteRequestStore,
  MailDeleteTarget,
} from './ports/mail-delete-request-store.js';
import type {
  MailPreviewRequestStatus,
  MailPreviewRequestStore,
} from './ports/mail-preview-request-store.js';

const SUBJECT_PERMISSION: Permission = 'inbound.delete_mail';
const BODY_PERMISSION: Permission = 'inbound.reveal_reset';

/** Rango máximo (número más bajo es más alto) que ve sin haber dado de alta la fuente: Administrador. */
const ADMINISTRATOR_RANK = 1;

export interface PreviewInboundMailDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly directory: Pick<UserDirectory, 'findById'>;
  /** Solo `findTarget`: la regla de «quién puede actuar sobre este recibo» es la misma que la del borrado. */
  readonly targets: Pick<MailDeleteRequestStore, 'findTarget'>;
  readonly previews: MailPreviewRequestStore;
  readonly cipher: SecretCipher;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export interface MailPreviewRequested {
  /** `true` si ya había una petición viva para ese recibo y clase y no se creó otra. */
  readonly alreadyPending: boolean;
}

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Inbound message not found');

export class PreviewInboundMail {
  constructor(private readonly deps: PreviewInboundMailDeps) {}

  request(
    receiptId: string,
    kind: MailPreviewKind,
    reason: string | undefined,
  ): Promise<Result<MailPreviewRequested, DomainError>> {
    const { context, uow, previews, audit, clock } = this.deps;
    return uow.run(async () => {
      const allowed = await this.authorize(receiptId, kind, reason);
      if (!allowed.ok) return allowed;
      const { actorId, target } = allowed.value;

      if (target.mailboxUid === null || target.mailboxUidValidity === null) {
        return err(
          new DomainError(
            'INBOUND.MAIL_NOT_PREVIEWABLE',
            'The mailbox position of this message was not recorded',
          ),
        );
      }

      const now = clock.now();
      const inserted = await previews.insertPending(
        {
          receiptId,
          sourceId: target.sourceId,
          kind,
          mailboxUidValidity: target.mailboxUidValidity,
          mailboxUid: target.mailboxUid,
          requestedBy: actorId,
          expiresAt: new Date(now.getTime() + MAIL_PREVIEW_TTL_MS),
        },
        now,
      );
      if (inserted === 'already_pending') return ok({ alreadyPending: true });

      const recorded = await audit.record({
        action: 'inbound.mail_preview_requested',
        actorId,
        targetType: 'inbound_receipt',
        targetId: receiptId,
        outcome: 'success',
        reasonCode: null,
        ip: null,
        requestId: context.current().requestId,
        metadata: { sourceId: target.sourceId, kind },
      });
      // Sin auditoría no hay petición: lanzar revierte la transacción completa.
      if (!recorded.ok) throw recorded.error;
      return ok({ alreadyPending: false });
    });
  }

  /** Estado de la petición vigente más reciente; nunca lleva contenido. */
  status(
    receiptId: string,
    kind: MailPreviewKind,
  ): Promise<Result<MailPreviewRequestStatus | null, DomainError>> {
    const { uow, previews, clock } = this.deps;
    return uow.run(async () => {
      // El estado no revela nada del mensaje: basta el permiso y la propiedad, sin pedir el motivo del cuerpo.
      const allowed = await this.authorize(receiptId, kind, undefined, { requireReason: false });
      if (!allowed.ok) return allowed;
      return ok(await previews.findLatest(receiptId, kind, clock.now()));
    });
  }

  /** Entrega el contenido listo una sola vez; `NOT_FOUND` si no hay nada listo o ya se entregó. */
  read(
    receiptId: string,
    kind: MailPreviewKind,
    reason: string | undefined,
  ): Promise<Result<string, DomainError>> {
    const { context, uow, previews, cipher, clock } = this.deps;
    return uow.run(async () => {
      const allowed = await this.authorize(receiptId, kind, reason);
      if (!allowed.ok) return allowed;
      const { actorId, target } = allowed.value;

      // Leer y borrar es un solo paso: aunque el descifrado falle, el contenido no queda disponible.
      const ready = await previews.takeReady(receiptId, kind, clock.now());
      if (ready === null) return err(new DomainError('NOT_FOUND', 'Mail preview not found'));

      const current = context.current();
      const opened = await cipher.decrypt(
        mailPreviewContext(current.organizationId, ready.requestId),
        {
          ciphertext: ready.ciphertext,
          nonce: ready.nonce,
          dekVersion: ready.dekVersion,
        },
      );
      if (!opened.ok) {
        await this.recordViewed(
          actorId,
          receiptId,
          kind,
          target.sourceId,
          reason,
          current.requestId,
          {
            outcome: 'failure',
            reasonCode: opened.error.code,
          },
        );
        return opened;
      }

      try {
        const content = new TextDecoder().decode(opened.value);
        await this.recordViewed(
          actorId,
          receiptId,
          kind,
          target.sourceId,
          reason,
          current.requestId,
          {
            outcome: 'success',
            reasonCode: null,
          },
        );
        return ok(content);
      } finally {
        opened.value.fill(0);
      }
    });
  }

  private async recordViewed(
    actorId: UserId,
    receiptId: string,
    kind: MailPreviewKind,
    sourceId: string,
    reason: string | undefined,
    requestId: string,
    result: { readonly outcome: 'success' | 'failure'; readonly reasonCode: string | null },
  ): Promise<void> {
    const recorded = await this.deps.audit.record({
      action: kind === 'body' ? 'inbound.mail_body_viewed' : 'inbound.mail_subject_viewed',
      actorId,
      targetType: 'inbound_receipt',
      targetId: receiptId,
      outcome: result.outcome,
      reasonCode: result.reasonCode,
      ip: null,
      requestId,
      metadata: kind === 'body' ? { sourceId, reason: (reason ?? '').trim() } : { sourceId },
    });
    // Sin auditoría no hay entrega: lanzar revierte la transacción y el contenido no sale.
    if (!recorded.ok) throw recorded.error;
  }

  /**
   * Permisos, propiedad del recibo y, para el cuerpo, motivo escrito. Toda negación se audita; un recibo
   * inexistente o ajeno responde `NOT_FOUND`.
   */
  private async authorize(
    receiptId: string,
    kind: MailPreviewKind,
    reason: string | undefined,
    options: { readonly requireReason: boolean } = { requireReason: true },
  ): Promise<Result<{ actorId: UserId; target: MailDeleteTarget }, DomainError>> {
    const { authorizer, targets, directory } = this.deps;
    // Permiso, reautenticación y marca de auditoría crítica: decisión del motor de autorización.
    await authorizer.require({ permission: SUBJECT_PERMISSION });
    if (kind === 'body') await authorizer.require({ permission: BODY_PERMISSION });
    const actorId = this.requireActorId();

    const target = await targets.findTarget(receiptId);
    if (target === null) return this.denyAsNotFound(kind, null);
    const actor = await directory.findById(actorId);
    const isAdministrator = actor !== null && actor.rank <= ADMINISTRATOR_RANK;
    if (!isAdministrator && target.sourceCreatedBy !== actorId) {
      return this.denyAsNotFound(kind, target.sourceId);
    }

    if (kind === 'body' && options.requireReason && !isValidRevealReason(reason)) {
      await authorizer.auditDenial({
        code: 'CREDENTIAL.REASON_INVALID',
        permission: BODY_PERMISSION,
        targetSourceId: target.sourceId,
      });
      return err(
        new DomainError('CREDENTIAL.REASON_INVALID', 'A written reason is required', {
          minLength: REVEAL_REASON_MIN_LENGTH,
          maxLength: REVEAL_REASON_MAX_LENGTH,
        }),
      );
    }
    return ok({ actorId, target });
  }

  private async denyAsNotFound(
    kind: MailPreviewKind,
    sourceId: string | null,
  ): Promise<Result<never, DomainError>> {
    await this.deps.authorizer.auditDenial({
      code: 'AUTHZ.PERMISSION',
      permission: kind === 'body' ? BODY_PERMISSION : SUBJECT_PERMISSION,
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
