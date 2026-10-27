/**
 * Motor de decisión (plan: "Motor de decisión"). Es una función pura y se niega por defecto:
 * cada paso solo puede cerrar la puerta. Los pasos 5 (compartición de la bóveda) llegan con la
 * fase 1b.
 *
 * Invariantes de seguridad
 * - El orden es fijo: organización, sesión, permiso, jerarquía, contexto. El primer fallo decide.
 * - Un permiso sin el nivel de compartición (o la jerarquía) correspondiente nunca basta.
 * - Un recurso de otra organización se niega siempre, incluso para quien tiene el permiso.
 */
import type { Permission } from '@iam/contracts';

import type { OrganizationId } from '../../../shared/kernel/index.js';
import { REAUTH_WINDOW_MS, policyFor } from './permission-catalog.js';
import type { Obligation } from './permission-catalog.js';

export type DenyReason = 'TENANT' | 'SESSION' | 'PERMISSION' | 'HIERARCHY' | 'REAUTH';

export type Decision =
  | { readonly allowed: true; readonly obligations: readonly Obligation[] }
  | { readonly allowed: false; readonly reason: DenyReason };

export interface DecisionInput {
  readonly permission: Permission;
  readonly contextOrganizationId: OrganizationId;
  readonly resourceOrganizationId: OrganizationId;
  readonly actorActive: boolean;
  readonly sessionValid: boolean;
  readonly actorPermissions: ReadonlySet<Permission>;
  /** Presente solo si el recurso es un usuario: resultado de `canManage`. */
  readonly managesTargetUser?: boolean;
  readonly reauthAt: Date | null;
  readonly now: Date;
}

const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

export function decide(input: DecisionInput): Decision {
  if (input.contextOrganizationId !== input.resourceOrganizationId) return deny('TENANT');
  if (!input.actorActive || !input.sessionValid) return deny('SESSION');
  if (!input.actorPermissions.has(input.permission)) return deny('PERMISSION');
  if (input.managesTargetUser === false) return deny('HIERARCHY');

  const policy = policyFor(input.permission);
  const obligations: Obligation[] = [];
  if (policy.reauth) {
    const fresh =
      input.reauthAt !== null && input.now.getTime() - input.reauthAt.getTime() <= REAUTH_WINDOW_MS;
    if (!fresh) return deny('REAUTH');
    obligations.push('REAUTH');
  }
  if (policy.writtenReason) obligations.push('WRITTEN_REASON');
  if (policy.criticalAudit) obligations.push('CRITICAL_AUDIT');
  return { allowed: true, obligations };
}
