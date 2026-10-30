import type { Permission } from '@iam/contracts';

import type { Rank } from '../../../shared/kernel/index.js';

/**
 * Techo de rango de cada permiso: el rango máximo (número más alto) que puede tenerlo. Un
 * Operador (3) nunca recibe un permiso con techo 1. Fuente: plan, "Catálogo de permisos".
 */
export const PERMISSION_CEILING: Readonly<Record<Permission, Rank>> = {
  'org.settings': 0,
  'role.manage': 1,
  'platform.manage': 1,
  'vault.inventory.read': 1,
  'vault.emergency_access': 1,
  'audit.read_all': 1,
  'sso.clients.manage': 1,
  'user.invite': 2,
  'user.update': 2,
  'user.change_rank': 1,
  'user.transfer': 2,
  'user.deactivate': 2,
  'role.assign': 2,
  'group.create': 2,
  'group.manage_members': 2,
  'account.create': 3,
  'account.update': 3,
  'account.archive': 2,
  'credential.create': 3,
  'credential.update': 3,
  'credential.restore_version': 3,
  'credential.reveal_password': 3,
  'credential.use_totp': 3,
  'credential.export_totp': 2,
  'share.manage': 3,
  'access_request.approve': 2,
  'rotation.manage': 2,
  'audit.read_scope': 2,
};

export const rankAllows = (permission: Permission, rank: Rank): boolean =>
  rank <= PERMISSION_CEILING[permission];

/** Obligaciones que acompañan a una acción permitida (plan: "Motor de decisión"). */
export type Obligation = 'REAUTH' | 'WRITTEN_REASON' | 'CRITICAL_AUDIT';

export interface ActionPolicy {
  /** Exige haber verificado un factor en los últimos 5 minutos. */
  readonly reauth: boolean;
  /** Exige un motivo escrito. */
  readonly writtenReason: boolean;
  /** Se audita como evento crítico (notifica en tiempo real a la Raíz y a los gestores). */
  readonly criticalAudit: boolean;
}

const NONE: ActionPolicy = { reauth: false, writtenReason: false, criticalAudit: false };

/**
 * Acciones con reautenticación: revelar contraseña, exportar secreto 2FA, cambiar rango o roles,
 * acceso de emergencia, transferir la Raíz y gestionar SSO. Con motivo escrito: revelar, exportar
 * y acceso de emergencia. Los eventos críticos están listados en "Gobernanza > Auditoría".
 */
export const ACTION_POLICY: Readonly<Partial<Record<Permission, ActionPolicy>>> = {
  'org.settings': { reauth: true, writtenReason: false, criticalAudit: true },
  'platform.manage': { reauth: true, writtenReason: false, criticalAudit: true },
  'sso.clients.manage': { reauth: true, writtenReason: false, criticalAudit: false },
  'user.change_rank': { reauth: true, writtenReason: false, criticalAudit: false },
  'role.assign': { reauth: true, writtenReason: false, criticalAudit: false },
  'vault.emergency_access': { reauth: true, writtenReason: true, criticalAudit: true },
  'credential.reveal_password': { reauth: true, writtenReason: true, criticalAudit: false },
  'credential.export_totp': { reauth: true, writtenReason: true, criticalAudit: true },
};

export const policyFor = (permission: Permission): ActionPolicy =>
  ACTION_POLICY[permission] ?? NONE;

/** Ventana de reautenticación (plan: "Reautenticación (step-up)"). */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;
