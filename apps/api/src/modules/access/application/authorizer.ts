/**
 * Invariantes de seguridad
 * - Es el único camino para decidir si una acción se permite; el guard del controlador solo es una
 *   red de seguridad.
 * - Se niega por defecto: sin actor, sin sesión o sin permiso, la respuesta es una negación.
 * - Toda negación se audita con su código de motivo, en una transacción INDEPENDIENTE (ADR 0022):
 *   la acción negada se revierte, pero el rastro de la negación debe quedar.
 */
import type { ErrorCode, Permission } from '@iam/contracts';

import { canManage } from '../../directory/index.js';
import type { UserDirectory, UserRecord } from '../../directory/index.js';
import { DomainError } from '../../../shared/kernel/index.js';
import type { Clock, RequestContextReader, UserId } from '../../../shared/kernel/index.js';
import type { AuditLog } from '../../audit/index.js';
import { decide } from '../domain/decision.js';
import type { DenialGrouper } from './denial-grouper.js';
import type { Decision, DenyReason } from '../domain/decision.js';
import { effectivePermissions } from '../domain/effective-permissions.js';
import type { Obligation } from '../domain/permission-catalog.js';
import type { RoleRepository } from './ports/role-repository.js';

export interface AuthorizationRequest {
  readonly permission: Permission;
  /** Presente cuando la acción recae sobre otro usuario (activa la regla de jerarquía). */
  readonly targetUserId?: UserId;
}

export interface AuthorizerDeps {
  readonly context: RequestContextReader;
  readonly directory: UserDirectory;
  readonly roles: RoleRepository;
  readonly audit: AuditLog;
  readonly clock: Clock;
  /** Agrupa las negaciones repetidas; una sola instancia por proceso (ADR 0039). */
  readonly denialGrouper: DenialGrouper;
  /** Ejecuta `fn` en una transacción propia que se confirma aunque la del llamador se revierta. */
  readonly independently: <T>(fn: () => Promise<T>) => Promise<T>;
}

const DENY_CODE = {
  TENANT: 'AUTHZ.TENANT',
  SESSION: 'AUTHZ.SESSION',
  PERMISSION: 'AUTHZ.PERMISSION',
  HIERARCHY: 'AUTHZ.HIERARCHY.NOT_IN_SUBTREE',
  REAUTH: 'AUTHZ.REAUTH_REQUIRED',
} as const satisfies Record<DenyReason, string>;

/** Acción de solo lectura que no es un permiso del catálogo; solo se usa para etiquetar la auditoría. */
const DIRECTORY_VIEW = 'directory.view';

export class Authorizer {
  constructor(private readonly deps: AuthorizerDeps) {}

  async authorize(request: AuthorizationRequest): Promise<Decision> {
    const { context, directory, roles, clock } = this.deps;
    const current = context.current();
    const actor = current.actorId === null ? null : await directory.findById(current.actorId);
    if (actor === null) return this.deny(request, 'SESSION');

    const actorPermissions = effectivePermissions(
      await roles.rolePermissionsOf(actor.id),
      actor.rank,
    );

    let managesTargetUser: boolean | undefined;
    if (request.targetUserId !== undefined) {
      const target = await directory.findById(request.targetUserId);
      managesTargetUser =
        target !== null &&
        canManage(actor, target, await directory.isInSubtree(actor.id, target.id));
    }

    const decision = decide({
      permission: request.permission,
      contextOrganizationId: current.organizationId,
      resourceOrganizationId: actor.organizationId,
      actorActive: actor.status === 'active',
      sessionValid: true,
      actorPermissions,
      ...(managesTargetUser === undefined ? {} : { managesTargetUser }),
      reauthAt: current.reauthAt,
      now: clock.now(),
    });
    return decision.allowed ? decision : this.deny(request, decision.reason);
  }

  /** Como `authorize`, pero lanza el error de dominio listo para convertirse en Problem Details. */
  async require(request: AuthorizationRequest): Promise<readonly Obligation[]> {
    const decision = await this.authorize(request);
    if (decision.allowed) return decision.obligations;
    throw new DomainError(DENY_CODE[decision.reason], 'Action not allowed');
  }

  /**
   * Permisos efectivos de la persona autenticada, SIN decidir ni auditar nada: sirve para que un caso
   * de uso ya autorizado decida cuánto detalle devolver o compare permisos (no escalamiento) sin
   * generar una negación por cada consulta. Se niega por defecto: sin actor activo de la organización
   * del contexto, el conjunto es vacío.
   */
  async actorPermissions(): Promise<ReadonlySet<Permission>> {
    const { context, directory, roles } = this.deps;
    const current = context.current();
    const actor = current.actorId === null ? null : await directory.findById(current.actorId);
    if (actor === null || actor.status !== 'active') return new Set();
    if (actor.organizationId !== current.organizationId) return new Set();
    return effectivePermissions(await roles.rolePermissionsOf(actor.id), actor.rank);
  }

  /**
   * Decide las consultas que no necesitan un permiso del catálogo, solo ser una persona activa de la
   * organización del contexto (el directorio visible de la regla 11 y la vista de gestión, que
   * después acota por jerarquía). Se niega por defecto y la negación se audita como cualquier otra.
   */
  async requireActiveMember(): Promise<UserRecord> {
    const { context, directory } = this.deps;
    const current = context.current();
    const actor = current.actorId === null ? null : await directory.findById(current.actorId);
    if (actor === null || actor.status !== 'active') {
      await this.recordDenial({ code: DENY_CODE.SESSION, permission: DIRECTORY_VIEW });
      throw new DomainError(DENY_CODE.SESSION, 'Authenticated session required');
    }
    if (actor.organizationId !== current.organizationId) {
      await this.recordDenial({ code: DENY_CODE.TENANT, permission: DIRECTORY_VIEW });
      throw new DomainError(DENY_CODE.TENANT, 'Action not allowed');
    }
    return actor;
  }

  /**
   * Audita una negación que decidió una regla de negocio fuera del motor (matriz de creación,
   * no escalamiento de roles). Corre en transacción independiente, igual que las del motor.
   */
  async auditDenial(input: {
    readonly code: ErrorCode;
    readonly permission: Permission;
    readonly targetUserId?: UserId;
    readonly targetAccountId?: string;
  }): Promise<void> {
    await this.recordDenial(input);
  }

  private async recordDenial(input: {
    readonly code: ErrorCode;
    readonly permission: Permission | typeof DIRECTORY_VIEW;
    readonly targetUserId?: UserId;
    readonly targetAccountId?: string;
  }): Promise<void> {
    const { audit, context, independently, denialGrouper } = this.deps;
    const current = context.current();
    // Una ráfaga de negaciones idénticas escribe un solo evento por ventana (ADR 0022).
    const groupKey = {
      organizationId: current.organizationId,
      actorId: current.actorId,
      code: input.code,
      permission: input.permission,
      targetUserId: input.targetUserId ?? null,
      targetAccountId: input.targetAccountId ?? null,
    };
    const grouping = denialGrouper.decide(groupKey);
    if (!grouping.record) return;
    // Una negación apunta a un usuario o a una cuenta, nunca a ambos.
    const targetType =
      input.targetUserId !== undefined
        ? 'user'
        : input.targetAccountId !== undefined
          ? 'account'
          : null;
    const recorded = await independently(async () => {
      return audit.record({
        action: 'authz.denied',
        actorId: current.actorId,
        targetType,
        targetId: input.targetUserId ?? input.targetAccountId ?? null,
        outcome: 'denied',
        reasonCode: input.code,
        ip: null,
        requestId: current.requestId,
        metadata: {
          permission: input.permission,
          resourceType: targetType ?? 'none',
          // Solo cuando hubo repeticiones agrupadas desde el evento anterior de esta clave.
          ...(grouping.suppressedCount > 0 ? { suppressedCount: grouping.suppressedCount } : {}),
        },
      });
    });
    // La ventana se abre solo si el evento quedó escrito; si falló, la próxima negación reintenta.
    if (recorded.ok) denialGrouper.confirmRecorded(groupKey, grouping.suppressedCount);
  }

  private async deny(request: AuthorizationRequest, reason: DenyReason): Promise<Decision> {
    await this.auditDenial({
      code: DENY_CODE[reason],
      permission: request.permission,
      ...(request.targetUserId === undefined ? {} : { targetUserId: request.targetUserId }),
    });
    return { allowed: false, reason };
  }
}
