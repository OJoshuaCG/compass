/**
 * Revelación de restablecimientos (códigos o enlaces) de una vista de códigos entrantes (ADR 0045, IC-5c).
 *
 * Invariantes de seguridad
 * - Dos llaves: el permiso `inbound.reveal_reset` (techo 1: solo Raíz y Administración) y MANAGE sobre la
 *   VISTA. El motor de autorización exige además reautenticación reciente (política `reauth`). Sin nivel se
 *   responde `NOT_FOUND`; con nivel insuficiente, `AUTHZ.SHARE`. Toda negación se audita.
 * - Motivo escrito obligatorio con el mismo largo que la exportación de TOTP (`isValidRevealReason`); sin
 *   motivo válido se niega y se audita, y no se descifra nada.
 * - Solo el módulo de criptografía descifra. Todo se descifra ANTES de auditar: si un elemento no se puede
 *   abrir, la transacción no deja auditorías ni aviso de una revelación que no ocurrió.
 * - Una auditoría crítica `inbound.reset_revealed` por elemento y por revelación, cada vez (no se
 *   deduplica como la lectura de códigos). Lleva el motivo, nunca el valor. Un intento autorizado que no
 *   encuentra nada vigente también se audita (con la vista como destino) y uno que no puede descifrar deja
 *   una auditoría de fallo: nadie con MANAGE puede sondear la vista sin dejar rastro.
 * - Si una auditoría no se puede escribir se LANZA el error: la transacción revierte y ningún valor sale
 *   sin su auditoría (el `UnitOfWork` confirma ante cualquier retorno sin excepción).
 * - Con al menos un elemento revelado se encola el aviso a la Raíz en la misma transacción. Nada de esto
 *   sale por SSE.
 */
import {
  isValidRevealReason,
  REVEAL_REASON_MAX_LENGTH,
  REVEAL_REASON_MIN_LENGTH,
} from '@iam/contracts';
import type { Permission, ShareLevel } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { levelSatisfies } from '../../vault/index.js';
import { inboundItemContext } from '../domain/inbound-item-context.js';
import { isItemExpired } from '../domain/item-validity.js';
import type { InboundResetStore } from './ports/inbound-reset-store.js';
import type { InboundViewReader } from './ports/inbound-view-reader.js';

const REVEAL_PERMISSION: Permission = 'inbound.reveal_reset';
const REVEAL_REQUIRED_LEVEL: ShareLevel = 'MANAGE';

/** Tope de restablecimientos por revelación: cada uno deja una auditoría crítica, más sería abuso o ruido. */
export const MAX_RESETS_PER_REVEAL = 20;

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Inbound view not found');

export interface RevealInboundResetsDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly views: Pick<InboundViewReader, 'findLiveView' | 'effectiveLevel'>;
  readonly resets: InboundResetStore;
  readonly cipher: SecretCipher;
  readonly audit: AuditLog;
  readonly clock: Clock;
}

export interface RevealedInboundReset {
  readonly itemId: string;
  readonly kind: 'reset_code' | 'reset_link';
  readonly valueType: 'code' | 'link';
  readonly value: string;
  readonly expiresAt: Date;
}

export class RevealInboundResets {
  constructor(private readonly deps: RevealInboundResetsDeps) {}

  reveal(
    viewId: string,
    reason: string | undefined,
  ): Promise<Result<readonly RevealedInboundReset[], DomainError>> {
    const { context, uow, authorizer, views, resets, cipher, clock } = this.deps;
    return uow.run(async () => {
      // Permiso y reautenticación de 5 minutos: la decisión es del motor de autorización.
      await authorizer.require({ permission: REVEAL_PERMISSION });
      const actorId = this.requireActorId();

      const view = await views.findLiveView(viewId);
      if (view === null) return this.denyAsNotFound(viewId);
      const level = await views.effectiveLevel(viewId, actorId);
      if (level === null) return this.denyAsNotFound(viewId);
      if (!levelSatisfies(level, REVEAL_REQUIRED_LEVEL)) {
        await authorizer.auditDenial({
          code: 'AUTHZ.SHARE',
          permission: REVEAL_PERMISSION,
          targetViewId: viewId,
        });
        return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this inbound view'));
      }

      if (!isValidRevealReason(reason)) {
        await authorizer.auditDenial({
          code: 'CREDENTIAL.REASON_INVALID',
          permission: REVEAL_PERMISSION,
          targetViewId: viewId,
        });
        return err(
          new DomainError('CREDENTIAL.REASON_INVALID', 'A written reason is required', {
            minLength: REVEAL_REASON_MIN_LENGTH,
            maxLength: REVEAL_REASON_MAX_LENGTH,
          }),
        );
      }

      const now = clock.now();
      const records = await resets.listLiveResets(viewId, now, MAX_RESETS_PER_REVEAL);
      // Segunda barrera: la consulta ya filtra lo vencido, pero un reloj distinto no debe entregar un valor muerto.
      const live = records.filter((record) => !isItemExpired(record.expiresAt, now));

      const current = context.current();
      const trimmedReason = reason.trim();
      const auditMetadata = { sourceId: view.sourceId, viewId, reason: trimmedReason };
      const revealed: RevealedInboundReset[] = [];
      for (const record of live) {
        const opened = await cipher.decrypt(
          inboundItemContext(current.organizationId, record.itemId),
          {
            ciphertext: record.ciphertext,
            nonce: record.nonce,
            dekVersion: record.dekVersion,
          },
        );
        if (!opened.ok) {
          // Solo queda la auditoría de fallo: ningún valor se entrega, ni siquiera los ya abiertos.
          await this.recordAudit({
            actorId,
            targetType: 'inbound_item',
            targetId: record.itemId,
            outcome: 'failure',
            reasonCode: opened.error.code,
            requestId: current.requestId,
            metadata: auditMetadata,
          });
          return opened;
        }
        try {
          revealed.push({
            itemId: record.itemId,
            kind: record.kind,
            valueType: record.valueType,
            value: new TextDecoder().decode(opened.value),
            expiresAt: record.expiresAt,
          });
        } finally {
          opened.value.fill(0);
        }
      }

      // Sin nada vigente no hubo revelación ni aviso a la Raíz, pero el intento autorizado queda auditado
      // con la vista como destino (no con un elemento), para distinguirlo de una revelación real.
      if (revealed.length === 0) {
        await this.recordAudit({
          actorId,
          targetType: 'mail_view',
          targetId: viewId,
          outcome: 'success',
          reasonCode: null,
          requestId: current.requestId,
          metadata: auditMetadata,
        });
        return ok(revealed);
      }

      for (const item of revealed) {
        await this.recordAudit({
          actorId,
          targetType: 'inbound_item',
          targetId: item.itemId,
          outcome: 'success',
          reasonCode: null,
          requestId: current.requestId,
          metadata: auditMetadata,
        });
      }
      await resets.enqueueRevealNotice({
        actorId,
        viewId,
        revealedCount: revealed.length,
        revealedAt: now,
      });
      return ok(revealed);
    });
  }

  /** Escribe la auditoría crítica de la revelación; si no se puede escribir, lanza para revertir todo. */
  private async recordAudit(event: {
    readonly actorId: UserId;
    readonly targetType: 'inbound_item' | 'mail_view';
    readonly targetId: string;
    readonly outcome: 'success' | 'failure';
    readonly reasonCode: string | null;
    readonly requestId: string;
    readonly metadata: {
      readonly sourceId: string;
      readonly viewId: string;
      readonly reason: string;
    };
  }): Promise<void> {
    const recorded = await this.deps.audit.record({
      action: 'inbound.reset_revealed',
      actorId: event.actorId,
      targetType: event.targetType,
      targetId: event.targetId,
      outcome: event.outcome,
      reasonCode: event.reasonCode,
      ip: null,
      requestId: event.requestId,
      metadata: event.metadata,
    });
    if (!recorded.ok) throw recorded.error;
  }

  /** Vista inexistente, archivada, inactiva o sin acceso: se responde igual y la negación se audita. */
  private async denyAsNotFound(viewId: string): Promise<Result<never, DomainError>> {
    await this.deps.authorizer.auditDenial({
      code: 'AUTHZ.SHARE',
      permission: REVEAL_PERMISSION,
      targetViewId: viewId,
    });
    return err(notFound());
  }

  private requireActorId(): UserId {
    const actorId = this.deps.context.current().actorId;
    if (actorId === null) throw new DomainError('AUTHZ.SESSION', 'Authenticated session required');
    return actorId;
  }
}
