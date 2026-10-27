import { PERMISSIONS } from '@iam/contracts';
import type { Permission } from '@iam/contracts';

import { PERMISSION_CEILING } from './permission-catalog.js';

export type SystemRoleKey = 'root' | 'administrator' | 'leader' | 'operator';

export interface SystemRole {
  readonly key: SystemRoleKey;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/** Versión de las plantillas: se incrementa al cambiarlas, para poder migrar organizaciones existentes. */
export const SYSTEM_ROLES_VERSION = 1;

const withCeilingAtLeast = (minimum: number): Permission[] =>
  PERMISSIONS.filter((permission) => PERMISSION_CEILING[permission] >= minimum);

/**
 * Plantillas del sistema (no editables). Raíz: todo. Administrador: todo salvo la configuración de
 * la organización. Líder y Operador: el plan solo dice "conjuntos por defecto"; aquí se definen como
 * todo lo que su rango puede tener (decisión pendiente de confirmar con el negocio, ver
 * docs/business/roadmap-and-status.md).
 */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  { key: 'root', name: 'Root', permissions: [...PERMISSIONS] },
  {
    key: 'administrator',
    name: 'Administrator',
    permissions: PERMISSIONS.filter((permission) => permission !== 'org.settings'),
  },
  { key: 'leader', name: 'Leader', permissions: withCeilingAtLeast(2) },
  { key: 'operator', name: 'Operator', permissions: withCeilingAtLeast(3) },
];

export const systemRole = (key: SystemRoleKey): SystemRole => {
  const role = SYSTEM_ROLES.find((candidate) => candidate.key === key);
  if (role === undefined) throw new Error(`Unknown system role: ${key}`);
  return role;
};
