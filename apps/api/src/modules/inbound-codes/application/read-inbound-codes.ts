/**
 * Lectura de códigos entrantes por una vista compartida (ADR 0045, sección 4, IC-5a).
 *
 * Invariantes de seguridad
 * - Dos llaves, como en el resto de la bóveda: el permiso `inbound.read_codes` del catálogo y el nivel de
 *   acceso efectivo a la VISTA. Ver códigos pide USE; ver el historial, VIEW. Sin nivel se responde
 *   `NOT_FOUND`; con nivel insuficiente, `AUTHZ.SHARE`. En ambos casos la negación se audita.
 * - Solo se entregan `login_code` explícitos y vigentes. Un restablecimiento (código o enlace) y la
 *   cuarentena no salen por aquí nunca, con cualquier nivel: eso lo decide la consulta, no este código.
 * - Solo el módulo de criptografía descifra. El valor vive dentro de la llamada: se descifra, se copia a
 *   texto para la respuesta y el búfer se borra; nunca se registra ni se audita.
 * - Una auditoría `inbound.code_read` por (persona, elemento), en la primera entrega y en la misma
 *   transacción. Un refresco o un reenvío por SSE no escribe otra: el conteo sale de la propia auditoría y
 *   se protege con un bloqueo que se toma ANTES que el de la cadena de auditoría (ADR 0023).
 * - Todo se descifra ANTES de auditar: si un elemento no se puede abrir no queda una auditoría de una
 *   entrega que no ocurrió.
 * - El historial lista solo recepciones aceptadas que casaron con las plantillas de la vista, sin asunto,
 *   remitente ni valores.
 */
import type { Permission, ShareLevel } from '@iam/contracts';

import { DomainError, err, ok } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, Result, UserId } from '../../../shared/kernel/index.js';
import type { Authorizer } from '../../access/index.js';
import type { AuditEventCounter, AuditLog } from '../../audit/index.js';
import type { SecretCipher } from '../../crypto/index.js';
import type { UnitOfWork } from '../../organization/index.js';
import { levelSatisfies } from '../../vault/index.js';
import { decodeHistoryCursor, encodeHistoryCursor } from '../domain/history-cursor.js';
import { inboundItemContext } from '../domain/inbound-item-context.js';
import { isItemExpired } from '../domain/item-validity.js';
import type { InboundViewReader } from './ports/inbound-view-reader.js';

const READ_PERMISSION: Permission = 'inbound.read_codes';
const CODES_REQUIRED_LEVEL: ShareLevel = 'USE';
const HISTORY_REQUIRED_LEVEL: ShareLevel = 'VIEW';

/** Tope de códigos que se entregan en una lectura; con vigencia de 10 minutos, más sería ruido o abuso. */
export const MAX_CODES_PER_READ = 20;
export const MAX_HISTORY_PAGE_SIZE = 100;
export const DEFAULT_HISTORY_PAGE_SIZE = 25;

const notFound = (): DomainError => new DomainError('NOT_FOUND', 'Inbound view not found');

export interface ReadInboundCodesDeps {
  readonly context: RequestContextReader;
  readonly uow: UnitOfWork;
  readonly authorizer: Authorizer;
  readonly views: InboundViewReader;
  readonly cipher: SecretCipher;
  readonly audit: AuditLog;
  readonly auditCounter: AuditEventCounter;
  readonly clock: Clock;
}

export interface DeliveredInboundCode {
  readonly itemId: string;
  readonly code: string;
  readonly expiresAt: Date;
}

export interface InboundHistoryEntry {
  readonly receiptId: string;
  readonly receivedAt: Date;
  readonly signingDomain: string | null;
  readonly templateKind: 'login_code' | 'reset_code' | 'reset_link';
}

export interface InboundHistoryPage {
  readonly entries: readonly InboundHistoryEntry[];
  readonly nextCursor: string | null;
}

export class ReadInboundCodes {
  constructor(private readonly deps: ReadInboundCodesDeps) {}

  /** Códigos `login_code` vigentes de la vista, del más reciente al más antiguo. */
  listCodes(viewId: string): Promise<Result<readonly DeliveredInboundCode[], DomainError>> {
    const { context, uow, authorizer, views, cipher, audit, auditCounter, clock } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: READ_PERMISSION });
      const actorId = this.requireActorId();

      const view = await views.findLiveView(viewId);
      if (view === null) return this.denyUnknownView(viewId);
      const level = await this.levelOrNotFound(viewId, actorId, CODES_REQUIRED_LEVEL);
      if (!level.ok) return level;

      const now = clock.now();
      const records = await views.listLiveLoginCodes(viewId, now, MAX_CODES_PER_READ);
      // Segunda barrera: la consulta ya filtra lo vencido, pero un reloj distinto no debe entregar un código muerto.
      const live = records.filter((record) => !isItemExpired(record.expiresAt, now));

      const organizationId = context.current().organizationId;
      const delivered: DeliveredInboundCode[] = [];
      for (const record of live) {
        const opened = await cipher.decrypt(inboundItemContext(organizationId, record.itemId), {
          ciphertext: record.ciphertext,
          nonce: record.nonce,
          dekVersion: record.dekVersion,
        });
        if (!opened.ok) return opened;
        try {
          delivered.push({
            itemId: record.itemId,
            code: new TextDecoder().decode(opened.value),
            expiresAt: record.expiresAt,
          });
        } finally {
          opened.value.fill(0);
        }
      }

      // Todos los bloqueos de lectura se toman primero y en orden estable: así dos lecturas concurrentes de la
      // misma persona nunca los cruzan, y ninguno se pide con el bloqueo de la cadena de auditoría ya retenido
      // (ADR 0023). Auditar intercalado con el bloqueo de cada elemento podía producir un interbloqueo.
      const itemIdsInLockOrder = live.map((record) => record.itemId).sort();
      for (const itemId of itemIdsInLockOrder) {
        await views.lockItemRead(actorId, itemId);
      }

      const current = context.current();
      for (const record of live) {
        const alreadyRead = await auditCounter.count({
          actorId,
          action: 'inbound.code_read',
          outcome: 'success',
          since: record.createdAt,
          targetId: record.itemId,
        });
        if (alreadyRead > 0) continue;
        await audit.record({
          action: 'inbound.code_read',
          actorId,
          targetType: 'inbound_item',
          targetId: record.itemId,
          outcome: 'success',
          reasonCode: null,
          ip: null,
          requestId: current.requestId,
          metadata: { sourceId: view.sourceId, viewId },
        });
      }
      return ok(delivered);
    });
  }

  /** Recepciones aceptadas que casaron con la vista, sin valores. Paginado por cursor opaco. */
  history(
    viewId: string,
    query: { readonly limit?: number; readonly cursor?: string },
  ): Promise<Result<InboundHistoryPage, DomainError>> {
    const { uow, authorizer, views } = this.deps;
    return uow.run(async () => {
      await authorizer.require({ permission: READ_PERMISSION });
      const actorId = this.requireActorId();

      const view = await views.findLiveView(viewId);
      if (view === null) return this.denyUnknownView(viewId);
      const level = await this.levelOrNotFound(viewId, actorId, HISTORY_REQUIRED_LEVEL);
      if (!level.ok) return level;

      const after = query.cursor === undefined ? null : decodeHistoryCursor(query.cursor);
      if (query.cursor !== undefined && after === null) {
        return err(new DomainError('VALIDATION.FAILED', 'Invalid history cursor'));
      }
      const limit = Math.min(query.limit ?? DEFAULT_HISTORY_PAGE_SIZE, MAX_HISTORY_PAGE_SIZE);

      // Se pide una fila de más para saber si hay otra página sin contarlas todas.
      const rows = await views.listHistory(viewId, { limit: limit + 1, after });
      const pageRows = rows.slice(0, limit);
      const last = pageRows.at(-1);
      const hasMore = rows.length > limit;
      return ok({
        entries: pageRows.map((row) => ({
          receiptId: row.receiptId,
          receivedAt: row.receivedAt,
          signingDomain: row.signingDomain,
          templateKind: row.templateKind,
        })),
        nextCursor:
          hasMore && last !== undefined
            ? encodeHistoryCursor({ receivedAt: last.receivedAt, id: last.receiptId })
            : null,
      });
    });
  }

  /**
   * Segunda llave: el nivel de acceso a la vista. Sin acceso se responde como si no existiera (y se audita
   * el intento); con menos nivel del requerido se niega con `AUTHZ.SHARE` y se audita la negación.
   */
  private async levelOrNotFound(
    viewId: string,
    actorId: UserId,
    required: ShareLevel,
  ): Promise<Result<ShareLevel, DomainError>> {
    const { authorizer, views } = this.deps;
    const level = await views.effectiveLevel(viewId, actorId);
    if (level === null) {
      await authorizer.auditDenial({
        code: 'AUTHZ.SHARE',
        permission: READ_PERMISSION,
        targetViewId: viewId,
      });
      return err(notFound());
    }
    if (!levelSatisfies(level, required)) {
      await authorizer.auditDenial({
        code: 'AUTHZ.SHARE',
        permission: READ_PERMISSION,
        targetViewId: viewId,
      });
      return err(new DomainError('AUTHZ.SHARE', 'Insufficient access to this inbound view'));
    }
    return ok(level);
  }

  /** Una vista inexistente, archivada o de una fuente inactiva se responde igual que una sin acceso, y también se audita. */
  private async denyUnknownView(viewId: string): Promise<Result<never, DomainError>> {
    await this.deps.authorizer.auditDenial({
      code: 'AUTHZ.SHARE',
      permission: READ_PERMISSION,
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
